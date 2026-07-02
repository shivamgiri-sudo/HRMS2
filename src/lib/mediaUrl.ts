const API_BASE = (
  (import.meta as any).env?.VITE_HRMS_API_URL ||
  (import.meta as any).env?.VITE_API_URL ||
  "http://localhost:5055"
).replace(/\/$/, "");

/**
 * Converts a relative /api/... path to a full absolute URL using the configured
 * backend base URL. Absolute URLs and data URIs are returned unchanged.
 * Returns undefined for empty/null input.
 */
export function normalizeMediaUrl(url?: string | null): string | undefined {
  if (!url) return undefined;
  if (/^https?:\/\//i.test(url) || url.startsWith("data:")) return url;
  if (url.startsWith("/api/")) return `${API_BASE}${url}`;
  return url;
}
