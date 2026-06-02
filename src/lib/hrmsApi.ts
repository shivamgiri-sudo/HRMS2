// Empty string = use Vercel proxy (same origin, /api/* rewritten to Railway)
// Local dev = http://localhost:5055
const HRMS_API_URL = import.meta.env.VITE_HRMS_API_URL || 'http://localhost:5055';

async function getAuthHeader(): Promise<Record<string, string>> {
  // Demo session stored in localStorage by AuthContext
  const demoRaw = localStorage.getItem('hrms_demo_session');
  if (demoRaw) {
    try {
      const demo = JSON.parse(demoRaw);
      const token = demo?.access_token;
      if (token) return { Authorization: `Bearer ${token}` };
    } catch { /* fall through */ }
  }

  // MySQL JWT token — only auth method
  const mysqlToken = localStorage.getItem('hrms_access_token');
  if (mysqlToken) {
    return { Authorization: `Bearer ${mysqlToken}` };
  }
  return {};
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers = await getAuthHeader();
  const res = await fetch(`${HRMS_API_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json;
}

/** Returns raw response text (for file downloads such as CSV exports). */
async function requestRaw(method: string, path: string): Promise<string> {
  const headers = await getAuthHeader();
  const res = await fetch(`${HRMS_API_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `HTTP ${res.status}`);
  }
  return res.text();
}

export const hrmsApi = {
  get:    <T>(path: string)                => request<T>('GET',    path),
  post:   <T>(path: string, body: unknown) => request<T>('POST',   path, body),
  put:    <T>(path: string, body: unknown) => request<T>('PUT',    path, body),
  patch:  <T>(path: string, body: unknown) => request<T>('PATCH',  path, body),
  delete: <T>(path: string)               => request<T>('DELETE', path),
  /** Download a raw text response (e.g. CSV export). */
  getRaw: (path: string)                  => requestRaw('GET', path),
};
