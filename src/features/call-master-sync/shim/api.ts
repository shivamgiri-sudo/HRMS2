import { hrmsApi } from "@/lib/hrmsApi";

/*
 * axios-shaped adapter for the dashboards synced from tausifansari-mcn/Mydashboards (see
 * scripts/sync-mydashboards.mjs). Upstream calls `api.get('/call-master/...')` and reads `res.data.data`;
 * here the same call is served by the HRMS endpoint behind /api/mydashboards, with HRMS auth and branch scoping.
 */
const PREFIX = "/api/mydashboards/call-master";
const TIMEOUT_MS = 120_000;

const toQuery = (params?: Record<string, unknown>) => {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
  }
  const q = qs.toString();
  return q ? `?${q}` : "";
};

const api = {
  get: async <T = any>(url: string, config?: { params?: Record<string, unknown> }): Promise<{ data: T }> => ({
    data: (await hrmsApi.get<T>(`${PREFIX}${url.replace(/^\/call-master/, "")}${toQuery(config?.params)}`, TIMEOUT_MS)) as T,
  }),
};

export default api;
