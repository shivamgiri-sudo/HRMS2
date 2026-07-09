import { apiBaseUrl } from "@/lib/apiBase";

const HRMS_API_URL = apiBaseUrl();

function getCandidateAuthHeader(): Record<string, string> {
  const token = localStorage.getItem("candidate_token");
  if (token) return { Authorization: `Bearer ${token}` };
  return {};
}

function normalizeRequestPath(path: string): string {
  return HRMS_API_URL.endsWith("/api") && path.startsWith("/api/")
    ? path.replace(/^\/api/, "")
    : path;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers = getCandidateAuthHeader();
  const normalizedPath = normalizeRequestPath(path);

  const res = await fetch(`${HRMS_API_URL}${normalizedPath}`, {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (res.status === 204) return null as T;

  const text = await res.text();
  const payload = text ? JSON.parse(text) : null;

  if (!res.ok) {
    const msg = (payload as { message?: string } | null)?.message ?? `HTTP ${res.status}`;
    throw new Error(msg);
  }

  return payload as T;
}

async function requestForm<T>(path: string, body: FormData): Promise<T> {
  const headers = getCandidateAuthHeader();
  const normalizedPath = normalizeRequestPath(path);
  const res = await fetch(`${HRMS_API_URL}${normalizedPath}`, {
    method: "POST",
    headers,
    body,
  });
  const text = await res.text();
  const payload = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const msg = (payload as { message?: string } | null)?.message ?? `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return payload as T;
}

export const candidateApi = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
  put: <T>(path: string, body?: unknown) => request<T>("PUT", path, body),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body),
  postForm: <T>(path: string, body: FormData) => requestForm<T>(path, body),
};
