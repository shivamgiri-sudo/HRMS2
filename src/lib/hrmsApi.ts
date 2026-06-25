function apiBaseUrl(): string {
  const configured = import.meta.env.VITE_HRMS_API_URL;
  if (configured !== undefined) return String(configured).replace(/\/$/, "");
  return import.meta.env.DEV ? "http://localhost:5055" : "";
}

// Production uses the same-origin /api proxy when VITE_HRMS_API_URL is not set.
const HRMS_API_URL = apiBaseUrl();

const LEGACY_DOUBLE_DATA_PATHS = [
  "/api/clients",
  "/api/clients-stats",
  "/api/portal-users",
  "/api/clients-usage",
];

function getAuthHeader(): Record<string, string> {
  // Real JWT token always takes priority over demo session
  const mysqlToken = localStorage.getItem("hrms_access_token");
  if (mysqlToken) return { Authorization: `Bearer ${mysqlToken}` };

  const demoRaw = localStorage.getItem("hrms_demo_session");
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

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers = getAuthHeader();

  const normalizedPath =
    HRMS_API_URL === "/api" && path.startsWith("/api/")
      ? path.replace(/^\/api/, "")
      : path;

  const res = await fetch(`${HRMS_API_URL}${normalizedPath}`, {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const payload = await parseResponse(res);

  if (!res.ok) {
    const errorPayload = payload as { error?: unknown; message?: unknown } | null;
    let raw = errorPayload?.error ?? errorPayload?.message ?? (typeof payload === "string" ? payload : null);
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

  const normalizedPath =
    HRMS_API_URL === "/api" && path.startsWith("/api/")
      ? path.replace(/^\/api/, "")
      : path;

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

  const demoRaw = localStorage.getItem("hrms_demo_session");
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
  const normalizedPath =
    HRMS_API_URL === "/api" && path.startsWith("/api/")
      ? path.replace(/^\/api/, "")
      : path;
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

export const hrmsApi = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
  put: <T>(path: string, body?: unknown) => request<T>("PUT", path, body),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body),
  delete: <T>(path: string) => request<T>("DELETE", path),
  getRaw: (path: string) => requestRaw("GET", path),
  postForm: <T>(path: string, body: FormData) => requestForm<T>(path, body),
};
