import { defineConfig } from "drizzle-kit";

try {
  process.loadEnvFile(".env.local");
} catch (error: unknown) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}

const configuredUrl = process.env.DATABASE_URL;
const databaseUrl =
  configuredUrl && !configuredUrl.includes("${")
    ? configuredUrl
    : process.env.PGUSER &&
        process.env.PGPASSWORD &&
        process.env.PGHOST &&
        process.env.PGPORT &&
        process.env.PGDATABASE
      ? `postgresql://${encodeURIComponent(process.env.PGUSER)}:${encodeURIComponent(process.env.PGPASSWORD)}@${process.env.PGHOST}:${process.env.PGPORT}/${process.env.PGDATABASE}`
      : undefined;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for database commands");
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: databaseUrl,
  },
});
