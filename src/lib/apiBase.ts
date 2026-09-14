export function isLocalApiUrl(value: string): boolean {
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?($|\/)/i.test(value);
}

export function apiBaseUrl(): string {
  const configured = import.meta.env.VITE_HRMS_API_URL || import.meta.env.VITE_API_URL;
  if (configured !== undefined && configured !== "") {
    const normalized = String(configured).trim().replace(/\/$/, "");
    if (import.meta.env.PROD && isLocalApiUrl(normalized)) return "";
    return normalized === "/api" ? "" : normalized;
  }
  return import.meta.env.DEV ? "http://localhost:5055" : "";
}

export function apiUrl(path: string): string {
  const base = apiBaseUrl();
  const normalizedPath =
    base.endsWith("/api") && path.startsWith("/api/")
      ? path.replace(/^\/api/, "")
      : path;
  return `${base}${normalizedPath}`;
}
