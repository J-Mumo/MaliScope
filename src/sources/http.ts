import { findSourceByUrl, isSourceApproved } from "./registry";

const MAX_HTML_BYTES = 2 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 15_000;

export class LiveSourceAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LiveSourceAccessError";
  }
}

export async function readHtmlWithinLimit(
  response: Response,
  maxBytes = MAX_HTML_BYTES,
): Promise<string> {
  if (!response.body) {
    throw new LiveSourceAccessError("The source returned an empty response.");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel();
      throw new LiveSourceAccessError(
        "The source page exceeds the import size limit.",
      );
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

export async function fetchApprovedSourceHtml(
  sourceUrl: string,
  fetcher: typeof fetch = fetch,
): Promise<string> {
  const source = findSourceByUrl(sourceUrl);
  if (!source) {
    throw new LiveSourceAccessError("The URL is not a registered source.");
  }
  if (!isSourceApproved(source)) {
    throw new LiveSourceAccessError(
      `${source.displayName} live import is ${source.accessStatus.replaceAll("_", " ")} and cannot contact the website.`,
    );
  }

  let response: Response;
  try {
    response = await fetcher(sourceUrl, {
      method: "GET",
      redirect: "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": source.userAgent,
      },
    });
  } catch (error: unknown) {
    const cause =
      error instanceof Error && error.cause instanceof Error
        ? error.cause
        : error;
    const code =
      cause && typeof cause === "object" && "code" in cause
        ? String(cause.code)
        : null;
    const reason =
      code ??
      (cause instanceof Error && cause.message
        ? cause.message
        : "network error");
    throw new LiveSourceAccessError(
      `${source.displayName} request failed: ${reason}.`,
    );
  }
  if (!response.ok) {
    throw new LiveSourceAccessError(
      `${source.displayName} returned HTTP ${response.status}.`,
    );
  }
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("text/html")) {
    throw new LiveSourceAccessError("The source did not return an HTML page.");
  }
  const declaredLength = Number(response.headers.get("content-length") ?? "0");
  if (declaredLength > MAX_HTML_BYTES) {
    throw new LiveSourceAccessError(
      "The source page exceeds the import size limit.",
    );
  }

  const html = await readHtmlWithinLimit(response);
  if (
    /_Incapsula_Resource|Incapsula incident ID|imperva/i.test(html) &&
    /noindex\s*,?\s*nofollow/i.test(html)
  ) {
    throw new LiveSourceAccessError(
      `${source.displayName} returned an Imperva bot-protection challenge instead of listing content.`,
    );
  }
  return html;
}
