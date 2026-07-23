import { apiBaseUrl } from "@/lib/apiBase";

// Production uses the same-origin /api proxy when VITE_HRMS_API_URL is not set.
const HRMS_API_URL = apiBaseUrl();
const DEMO_LOGIN_ENABLED = import.meta.env.DEV && import.meta.env.VITE_ENABLE_DEMO_LOGIN === "true";

const LEGACY_DOUBLE_DATA_PATHS = [
  "/api/clients",
  "/api/clients-stats",
  "/api/portal-users",
  "/api/clients-usage",
];

let _refreshPromise: Promise<boolean> | null = null;

async function refreshAccessToken(): Promise<boolean> {
  if (_refreshPromise) return _refreshPromise;
  _refreshPromise = (async () => {
    const raw = localStorage.getItem("hrms_refresh_token");
    if (!raw) return false;
    try {
      const res = await fetch(`${HRMS_API_URL}/api/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken: raw }),
      });
      if (!res.ok) return false;
      const data = await res.json();
      const newToken = data?.data?.accessToken;
      if (!newToken) return false;
      localStorage.setItem("hrms_access_token", newToken);
      return true;
    } catch {
      return false;
    } finally {
      _refreshPromise = null;
    }
  })();
  return _refreshPromise;
}

function getAuthHeader(): Record<string, string> {
  // Real JWT token always takes priority over demo session
  const mysqlToken = localStorage.getItem("hrms_access_token");
  if (mysqlToken) return { Authorization: `Bearer ${mysqlToken}` };

  const demoRaw = DEMO_LOGIN_ENABLED ? localStorage.getItem("hrms_demo_session") : null;
  if (demoRaw) {
    try {
      const demo = JSON.parse(demoRaw);
      const token = demo?.access_token;
      if (token) return { Authorization: `Bearer ${token}` };
    } catch {
      // Fall through
    }
  }

  return {};
}

function normalizeRequestPath(path: string): string {
  return HRMS_API_URL.endsWith("/api") && path.startsWith("/api/")
    ? path.replace(/^\/api/, "")
    : path;
}

function addLegacyDataAlias(path: string, payload: unknown): void {
  if (!LEGACY_DOUBLE_DATA_PATHS.some((prefix) => path.startsWith(prefix))) return;
  if (!payload || typeof payload !== "object" || !("data" in payload)) return;

  const data = (payload as { data?: unknown }).data;
  if (!data || typeof data !== "object" || "data" in data) return;

  // One older Client Master page used Axios-style res.data.data while hrmsApi
  // returns the parsed JSON directly. Keep a non-enumerable compatibility alias
  // until that legacy page is fully migrated, without changing normal callers.
  Object.defineProperty(data, "data", {
    value: data,
    enumerable: false,
    configurable: true,
  });
}

async function parseResponse(res: Response): Promise<unknown> {
  if (res.status === 204) return null;

  const text = await res.text();
  if (!text) return null;

  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      return JSON.parse(text);
    } catch {
      throw new Error("Backend returned invalid JSON");
    }
  }

  return text;
}

async function fetchOnce(normalizedPath: string, method: string, body: unknown, timeoutMs: number): Promise<Response> {
  const headers = getAuthHeader();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(`${HRMS_API_URL}${normalizedPath}`, {
      method,
      headers: { "Content-Type": "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error(`Request timed out after ${Math.round(timeoutMs / 1000)}s. The server is still processing — please refresh to check the result.`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function request<T>(method: string, path: string, body?: unknown, timeoutMs = 30000): Promise<T> {
  const normalizedPath = normalizeRequestPath(path);

  let res = await fetchOnce(normalizedPath, method, body, timeoutMs);

  // On 401, try a silent token refresh once and retry the original request
  if (res.status === 401 && !path.includes("/api/auth/")) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      res = await fetchOnce(normalizedPath, method, body, timeoutMs);
    }
  }

  const payload = await parseResponse(res);

  if (!res.ok) {
    const errorPayload = payload as { error?: unknown; message?: unknown } | null;
    const raw = errorPayload?.error ?? errorPayload?.message ?? (typeof payload === "string" ? payload : null);
    let message: string;
    if (typeof raw === "string") {
      message = raw;
    } else if (raw && typeof raw === "object") {
      // Zod validation error — extract first field-level message
      const fieldErrors = (raw as Record<string, unknown>).fieldErrors;
      if (fieldErrors && typeof fieldErrors === "object") {
        const first = Object.values(fieldErrors as Record<string, unknown[]>).flat()[0];
        message = typeof first === "string" ? first : `Validation error (${Object.keys(fieldErrors).join(", ")})`;
      } else {
        message = JSON.stringify(raw);
      }
    } else {
      message = `HTTP ${res.status}`;
    }
    throw new Error(message);
  }

  addLegacyDataAlias(path, payload);
  return payload as T;
}

async function requestRaw(method: string, path: string): Promise<string> {
  const headers = getAuthHeader();

  const normalizedPath = normalizeRequestPath(path);

  const res = await fetch(`${HRMS_API_URL}${normalizedPath}`, {
    method,
    headers: { "Content-Type": "application/json", ...headers },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `HTTP ${res.status}`);
  }

  return res.text();
}

export function getAuthToken(): string | null {
  // Real JWT token always takes priority
  const mysqlToken = localStorage.getItem("hrms_access_token");
  if (mysqlToken) return mysqlToken;

  const demoRaw = DEMO_LOGIN_ENABLED ? localStorage.getItem("hrms_demo_session") : null;
  if (demoRaw) {
    try {
      const demo = JSON.parse(demoRaw);
      const token = demo?.access_token;
      if (token) return token;
    } catch {
      // Fall through
    }
  }

  return null;
}

async function requestForm<T>(path: string, body: FormData): Promise<T> {
  const headers = getAuthHeader();
  const normalizedPath = normalizeRequestPath(path);
  const res = await fetch(`${HRMS_API_URL}${normalizedPath}`, {
    method: "POST",
    headers, // No Content-Type — browser sets multipart boundary automatically
    body,
  });
  const payload = await parseResponse(res);
  if (!res.ok) {
    const errorPayload = payload as { error?: unknown; message?: unknown } | null;
    const raw = errorPayload?.error ?? errorPayload?.message ?? null;
    throw new Error(typeof raw === "string" ? raw : `HTTP ${res.status}`);
  }
  return payload as T;
}

async function requestBlob(path: string, timeoutMs = 30000): Promise<Blob> {
  const headers = getAuthHeader();
  const normalizedPath = normalizeRequestPath(path);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${HRMS_API_URL}${normalizedPath}`, {
      method: "GET",
      headers: { ...headers },
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || `HTTP ${res.status}`);
    }
    return res.blob();
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error(`Download timed out after ${Math.round(timeoutMs / 1000)}s`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export const hrmsApi = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown, timeoutMs?: number) => request<T>("POST", path, body, timeoutMs),
  put: <T>(path: string, body?: unknown) => request<T>("PUT", path, body),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body),
  delete: <T>(path: string, opts?: { params?: Record<string, string>; data?: unknown }) => {
    const qs = opts?.params ? "?" + new URLSearchParams(opts.params).toString() : "";
    return request<T>("DELETE", path + qs, opts?.data);
  },
  getRaw: (path: string) => requestRaw("GET", path),
  postForm: <T>(path: string, body: FormData) => requestForm<T>(path, body),
  getBlob: (path: string) => requestBlob(path),
};
