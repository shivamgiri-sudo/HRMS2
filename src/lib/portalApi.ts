const HRMS_API_URL = (import.meta.env.VITE_HRMS_API_URL !== undefined && import.meta.env.VITE_HRMS_API_URL !== '')
  ? String(import.meta.env.VITE_HRMS_API_URL).replace(/\/$/, '')
  : (import.meta.env.DEV ? 'http://localhost:5055' : '');

function getPortalToken(): string | null {
  return localStorage.getItem("portal_token");
}

export function savePortalToken(token: string) {
  localStorage.setItem("portal_token", token);
}

export function clearPortalToken() {
  localStorage.removeItem("portal_token");
}

async function portalRequest<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = getPortalToken();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${HRMS_API_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json;
}

export const portalApi = {
  requestOtp: (email: string) =>
    portalRequest<{ ok: boolean }>("POST", "/api/portal/auth/request-otp", { email }),
  verifyOtp: (email: string, otp: string) =>
    portalRequest<{ token: string }>("POST", "/api/portal/auth/verify-otp", { email, otp }),
  getOverview: () =>
    portalRequest<{ data: any[] }>("GET", "/api/portal/overview"),
  getKpis: (processId: string, period?: string) =>
    portalRequest<{ data: any[] }>("GET", `/api/portal/processes/${processId}/kpis${period ? `?period=${period}` : ""}`),
  getGlidePaths: (processId: string, period?: string) =>
    portalRequest<{ data: any[] }>("GET", `/api/portal/processes/${processId}/glide-paths${period ? `?period=${period}` : ""}`),
  getActionPlans: (processId: string, params?: { metricId?: string; status?: string }) => {
    const q = new URLSearchParams(params as Record<string, string>).toString();
    return portalRequest<{ data: any[] }>("GET", `/api/portal/processes/${processId}/action-plans${q ? `?${q}` : ""}`);
  },
  getGovernance: (processId: string, period?: string) =>
    portalRequest<{ data: any[] }>("GET", `/api/portal/processes/${processId}/governance${period ? `?period=${period}` : ""}`),
  getAttrition: (processId: string, period?: string) =>
    portalRequest<{ data: any }>("GET", `/api/portal/processes/${processId}/attrition${period ? `?period=${period}` : ""}`),
  getCommentary: (processId: string, period?: string) =>
    portalRequest<{ data: any }>("GET", `/api/portal/processes/${processId}/commentary${period ? `?period=${period}` : ""}`),
  acknowledgeCommentary: (commentaryId: string) =>
    portalRequest<{ ok: boolean }>("POST", `/api/portal/commentary/${commentaryId}/acknowledge`),
  replyCommentary: (commentaryId: string, text: string) =>
    portalRequest<{ ok: boolean }>("POST", `/api/portal/commentary/${commentaryId}/reply`, { text }),
};
