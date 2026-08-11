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

export type HrmsApiError = Error & {
  status?: number;
  code?: string;
  payload?: unknown;
};

let _refreshPromise: Promise<boolean> | null = null;

async function refreshAccessToken(): Promise<boolean> {
  if (_refreshPromise) return _refreshPromise;
  _refreshPromise = (async () => {
    try {
      const res = await fetch(`${HRMS_API_URL}/api/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      });
      if (!res.ok) return false;
      const data = await res.json();
      const newToken = data?.data?.accessToken;
      if (!newToken) return false;
      localStorage.setItem("hrms_access_token", newToken);
      // Notify AuthContext that a new token was issued so it reschedules its refresh timer
      window.dispatchEvent(new CustomEvent("hrms:token-refreshed"));
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

function buildApiError(status: number, payload: unknown, fallbackMessage: string): HrmsApiError {
  const errorPayload = payload as { error?: unknown; message?: unknown; code?: unknown } | null;
  const raw = errorPayload?.error ?? errorPayload?.message ?? (typeof payload === "string" ? payload : null);
  let message: string;

  if (typeof raw === "string") {
    message = raw;
  } else if (raw && typeof raw === "object") {
    const fieldErrors = (raw as Record<string, unknown>).fieldErrors;
    if (fieldErrors && typeof fieldErrors === "object") {
      const first = Object.values(fieldErrors as Record<string, unknown[]>).flat()[0];
      message = typeof first === "string" ? first : `Validation error (${Object.keys(fieldErrors).join(", ")})`;
    } else {
      message = JSON.stringify(raw);
    }
  } else {
    message = fallbackMessage;
  }

  const error = new Error(message) as HrmsApiError;
  error.name = "HrmsApiError";
  error.status = status;
  error.payload = payload;
  if (typeof errorPayload?.code === "string") error.code = errorPayload.code;
  return error;
}

export function getHrmsApiErrorStatus(error: unknown): number | null {
  if (!error || typeof error !== "object" || !("status" in error)) return null;
  const status = (error as HrmsApiError).status;
  return typeof status === "number" ? status : null;
}

async function fetchOnce(normalizedPath: string, method: string, body: unknown, timeoutMs: number): Promise<Response> {
  const headers = getAuthHeader();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(`${HRMS_API_URL}${normalizedPath}`, {
      method,
      credentials: "include",
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

  // The account behind this session has been deactivated or blocked. The refresh
  // above cannot help — /api/auth/refresh rejects an inactive employee too — so
  // without this the app just throws on every call and leaves a leaver staring at
  // a broken screen with a dead session. Clear it and send them to the login page,
  // where the message explains why.
  //
  // Deliberately keyed on the explicit ACCOUNT_DEACTIVATED code and not on 401
  // alone: an ordinary expired token must keep its silent-refresh behaviour.
  if (res.status === 401 && (payload as { code?: string } | null)?.code === "ACCOUNT_DEACTIVATED") {
    localStorage.removeItem("hrms_access_token");
    localStorage.removeItem("hrms_refresh_token");
    localStorage.removeItem("hrms_demo_session");
    if (!window.location.pathname.startsWith("/login")) {
      window.location.assign("/login?reason=account_inactive");
    }
  }

  if (!res.ok) {
    throw buildApiError(res.status, payload, `HTTP ${res.status}`);
  }

  addLegacyDataAlias(path, payload);
  return payload as T;
}

export interface SseHandlers {
  onChunk?: (text: string) => void;
  /** The authoritative payload. Render this over anything the chunks built. */
  onDone?: (payload: unknown) => void;
  onError?: (payload: unknown) => void;
}

/**
 * POST that reads a Server-Sent Events response.
 *
 * EventSource only speaks GET and cannot carry an Authorization header, so this
 * reads the body stream directly. It lives here rather than beside its caller so
 * it inherits the same auth header and one-shot 401 refresh as every other call.
 */
async function requestStream(
  path: string,
  body: unknown,
  handlers: SseHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const normalizedPath = normalizeRequestPath(path);

  const send = () => fetch(`${HRMS_API_URL}${normalizedPath}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream", ...getAuthHeader() },
    body: JSON.stringify(body ?? {}),
    signal,
  });

  let res = await send();
  if (res.status === 401 && await refreshAccessToken()) {
    res = await send();
  }
  if (!res.ok || !res.body) {
    throw buildApiError(res.status, await parseResponse(res), `HTTP ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffered = "";

  const dispatch = (frame: string) => {
    const eventLine = frame.split("\n").find((line) => line.startsWith("event:"));
    const dataLine = frame.split("\n").find((line) => line.startsWith("data:"));
    if (!eventLine || !dataLine) return;

    const event = eventLine.slice(6).trim();
    let data: unknown;
    try {
      data = JSON.parse(dataLine.slice(5).trim());
    } catch {
      return;
    }

    if (event === "chunk") handlers.onChunk?.(String((data as { text?: string })?.text ?? ""));
    else if (event === "done") handlers.onDone?.(data);
    else if (event === "error") handlers.onError?.(data);
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffered += decoder.decode(value, { stream: true });
    // Frames are separated by a blank line; the tail may be a partial frame.
    const frames = buffered.split("\n\n");
    buffered = frames.pop() ?? "";
    frames.forEach(dispatch);
  }
  if (buffered.trim()) dispatch(buffered);
}

async function requestRaw(method: string, path: string): Promise<string> {
  const headers = getAuthHeader();

  const normalizedPath = normalizeRequestPath(path);

  const res = await fetch(`${HRMS_API_URL}${normalizedPath}`, {
    method,
    credentials: "include",
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
    credentials: "include",
    headers, // No Content-Type — browser sets multipart boundary automatically
    body,
  });
  const payload = await parseResponse(res);
  if (!res.ok) {
    throw buildApiError(res.status, payload, `HTTP ${res.status}`);
  }
  return payload as T;
}

async function requestBlob(path: string): Promise<Blob> {
  const headers = getAuthHeader();
  const normalizedPath = normalizeRequestPath(path);
  const res = await fetch(`${HRMS_API_URL}${normalizedPath}`, {
    method: "GET",
    credentials: "include",
    headers: { ...headers },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `HTTP ${res.status}`);
  }
  return res.blob();
}

/**
 * The envelope essentially every HRMS endpoint returns.
 *
 * Used as the DEFAULT type argument below. Without a default, `T` collapsed to `unknown`, so the
 * ordinary `const res = await hrmsApi.get(...); res.data` — correct at runtime, since request()
 * returns the parsed body — failed to compile in 44 places. `unknown` made right code look wrong,
 * which is the worst way for a type to be wrong: it trains people to stop reading the errors.
 *
 * Deliberately WITHOUT an index signature. `data`, `success`, `message` and `error` cover the
 * envelope, and anything else is still a compile error — so a typo like `res.dta`, or a caller
 * reading a field the endpoint returns at the top level, is caught rather than waved through.
 * Endpoints that do return payload at the top level (pnl/bulk-upload returns `imported`/`errors`
 * there) should pass their own type argument, which still works exactly as before.
 */
export interface HrmsEnvelope<T = any> {
  success?: boolean;
  data?: T;
  message?: string;
  error?: string;
}

export const hrmsApi = {
  get: <T = HrmsEnvelope>(path: string, timeoutMs?: number) => request<T>("GET", path, undefined, timeoutMs),
  post: <T = HrmsEnvelope>(path: string, body?: unknown, timeoutMs?: number) => request<T>("POST", path, body, timeoutMs),
  put: <T = HrmsEnvelope>(path: string, body?: unknown) => request<T>("PUT", path, body),
  patch: <T = HrmsEnvelope>(path: string, body?: unknown) => request<T>("PATCH", path, body),
  delete: <T = HrmsEnvelope>(path: string, opts?: { params?: Record<string, string>; data?: unknown }) => {
    const qs = opts?.params ? "?" + new URLSearchParams(opts.params).toString() : "";
    return request<T>("DELETE", path + qs, opts?.data);
  },
  postStream: (path: string, body: unknown, handlers: SseHandlers, signal?: AbortSignal) =>
    requestStream(path, body, handlers, signal),
  getRaw: (path: string) => requestRaw("GET", path),
  postForm: <T>(path: string, body: FormData) => requestForm<T>(path, body),
  getBlob: (path: string) => requestBlob(path),
};
