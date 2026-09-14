import { apiBaseUrl } from "@/lib/apiBase";

const API_BASE = apiBaseUrl();

/**
 * Converts a relative /api/... path to a full absolute URL using the configured
 * backend base URL. Absolute URLs and data URIs are returned unchanged.
 * Returns undefined for empty/null input.
 */
export function normalizeMediaUrl(url?: string | null): string | undefined {
  if (!url) return undefined;
  if (/^https?:\/\//i.test(url) || url.startsWith("data:")) return url;
  // Legacy /uploads/employee-photos/ path → rewrite through /api/files/ so nginx proxy handles it
  if (url.startsWith("/uploads/employee-photos/")) {
    return `${API_BASE}/api/files/employee-photos/${url.split("/").pop()}`;
  }
  if (url.startsWith("/api/")) return `${API_BASE}${url}`;
  return url;
}
