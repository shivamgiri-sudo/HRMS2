import { apiBaseUrl } from "@/lib/apiBase";

const HRMS_API_URL = apiBaseUrl();

/**
 * KPI engine types, mirroring backend/src/modules/portal/portal.types.ts's PortalKpiMetric/
 * PortalRag and portal.kpi-engine.service.ts's ProcessKpiResult. PortalKpiBoard.tsx imports
 * these but they were never added here -- same dropped-during-merge gap as the backend side,
 * and it broke the frontend build the same way. PortalKpiBoard is not yet wired into
 * PortalProcessDashboard.tsx (still on the old getKpis() shape below) -- that integration is
 * unfinished elsewhere and out of scope here; this only restores the types so the file compiles.
 */
export type PortalRag = "red" | "amber" | "green" | "no_data";

export interface SparklinePoint {
  period: string;
  value: number;
}

export interface PortalKpiMetric {
  metric_code: string;
  metric_name: string;
  unit: string;
  direction: "higher_is_better" | "lower_is_better";
  target: number;
  target_source: "process_specific" | "portal_default" | "engine_fallback";
  actual: number | null;
  achievement_pct: number | null;
  rag: PortalRag;
  description: string | null;
  no_data_reason: string | null;
  numerator: number | null;
  denominator: number | null;
  delta_vs_previous: number | null;
  improved: boolean | null;
  sparkline: SparklinePoint[];
}

export interface PortalKpiDetail {
  process_id: string;
  period: string;
  metrics: PortalKpiMetric[];
  summary: {
    active_headcount: number;
    employees_with_activity: number;
    expected_days: number;
    unconfirmed_days: number;
    inferred_process_pct: number;
    data_through: string | null;
  };
}

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
  getProcess: (processId: string) =>
    portalRequest<{ data: { process_name?: string; client_name?: string; rag?: string } }>("GET", `/api/portal/processes/${processId}/info`),
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
