import { hrmsApi } from "@/lib/hrmsApi";

/*
 * axios-shaped adapter for the dashboards synced from tausifansari-mcn/Mydashboards (see
 * scripts/sync-mydashboards.mjs). Upstream calls `api.get('/call-master/...')` and reads `res.data.data`;
 * here the same call is served by the HRMS endpoint behind /api/mydashboards, with HRMS auth and branch scoping.
 */
const PREFIX = "/api/mydashboards";
const TIMEOUT_MS = 120_000;

const api = {
  get: async <T = any>(url: string): Promise<{ data: T }> => ({
    data: (await hrmsApi.get<T>(`${PREFIX}${url}`, TIMEOUT_MS)) as T,
  }),
};

export default api;
