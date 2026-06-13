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
  const res = await fetch(`${HRMS_API_URL}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const payload = await parseResponse(res);

  if (!res.ok) {
    const errorPayload = payload as { error?: string; message?: string } | null;
    const message = errorPayload?.error ?? errorPayload?.message ?? (typeof payload === "string" ? payload : `HTTP ${res.status}`);
    throw new Error(message);
  }

  addLegacyDataAlias(path, payload);
  return payload as T;
}

async function requestRaw(method: string, path: string): Promise<string> {
  const headers = getAuthHeader();
  const res = await fetch(`${HRMS_API_URL}${path}`, {
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

export const hrmsApi = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
  put: <T>(path: string, body?: unknown) => request<T>("PUT", path, body),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body),
  delete: <T>(path: string) => request<T>("DELETE", path),
  getRaw: (path: string) => requestRaw("GET", path),
};
