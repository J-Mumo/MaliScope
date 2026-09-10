# Multi-stage Dockerfile for MaliScope (Next.js 15, output: "standalone").
#
# Runs on Hetzner behind the shared Caddy proxy. Container name will be
# `maliscope-web-1` — the proxy reverse_proxies to it on the external `web`
# network (see ~/proxy/Caddyfile).

# ---------------------------------------------------------------------------
# 1) deps — install node_modules with npm ci (deterministic)
# ---------------------------------------------------------------------------
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---------------------------------------------------------------------------
# 2) build — produce .next/standalone
# ---------------------------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Next.js reads .env.production at build time for public NEXT_PUBLIC_* vars;
# secrets stay in the runtime `.env` mounted via compose.
ENV NEXT_TELEMETRY_DISABLED=1
# `public/` is optional in Next.js — ensure it exists so the runtime COPY works
RUN mkdir -p public && npm run build

# ---------------------------------------------------------------------------
# 3) runtime — small image with just the standalone server + public assets
# ---------------------------------------------------------------------------
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Non-root user (Alpine ships this UID/GID by default via nodejs image)
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001 -G nodejs

# Standalone output — self-contained server.js + minimal node_modules
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=build --chown=nextjs:nodejs /app/public ./public

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
