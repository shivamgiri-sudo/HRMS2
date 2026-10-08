import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import type { DashboardDetail, DashboardMeta, DashboardSettings, DatasetDef, QueryResult, QuerySpec, Share, Widget } from "./types";

/** Data access for Dashboard Studio. Every number comes back already limited to the viewer's branch/process scope. */
const BASE = "/api/analytics-catalogue";
interface Env<T> { success: boolean; data: T }
export interface ScopeOptions { processes: Array<{ id: string; name: string; code: string | null; branchId: string | null }>; branches: Array<{ id: string; name: string }> }
export interface ShareTargets { roles: string[]; branches: Array<{ id: string; name: string }>; processes: Array<{ id: string; name: string }> }

export const useDatasets = () =>
  useQuery({ queryKey: ["studio", "datasets"], queryFn: async () => (await hrmsApi.get<Env<DatasetDef[]>>(`${BASE}/datasets`)).data, staleTime: 5 * 60_000 });

export const useScopeOptions = () =>
  useQuery({ queryKey: ["studio", "scope-options"], queryFn: async () => (await hrmsApi.get<Env<ScopeOptions>>(`${BASE}/scope-options`)).data, staleTime: 5 * 60_000 });

/** Run one widget's query. `refreshSec` re-runs it on an interval (dashboard auto-refresh). */
export function useWidgetData(spec: QuerySpec | null, enabled: boolean, refreshSec = 0) {
  return useQuery({
    queryKey: ["studio", "query", spec ? JSON.stringify(spec) : "none"],
    queryFn: async () => (await hrmsApi.post<Env<QueryResult>>(`${BASE}/query`, spec, 45_000)).data,
    enabled: enabled && !!spec, staleTime: 60_000, retry: false, refetchInterval: refreshSec > 0 ? refreshSec * 1000 : false,
    placeholderData: (prev) => prev,
  });
}

export const useFieldValues = (dataset: string | undefined, field: string | undefined, search: string) =>
  useQuery({
    queryKey: ["studio", "values", dataset, field, search],
    queryFn: async () => (await hrmsApi.get<Env<string[]>>(`${BASE}/datasets/${dataset}/values/${field}?q=${encodeURIComponent(search)}`)).data,
    enabled: !!dataset && !!field, staleTime: 60_000,
  });

export const useDashboards = () =>
  useQuery({ queryKey: ["studio", "dashboards"], queryFn: async () => (await hrmsApi.get<Env<DashboardMeta[]>>(`${BASE}/dashboards`)).data });

export const useDashboard = (id: string | undefined) =>
  useQuery({ queryKey: ["studio", "dashboard", id], queryFn: async () => (await hrmsApi.get<Env<DashboardDetail>>(`${BASE}/dashboards/${id}`)).data, enabled: !!id, retry: false });

export const useShareTargets = (enabled: boolean) =>
  useQuery({ queryKey: ["studio", "share-targets"], queryFn: async () => (await hrmsApi.get<Env<ShareTargets>>(`${BASE}/dashboards/share-targets`)).data, enabled, staleTime: 5 * 60_000 });

export const searchUsers = async (q: string) =>
  (await hrmsApi.get<Env<Array<{ userId: string; name: string; code: string }>>>(`${BASE}/dashboards/share-targets/users?q=${encodeURIComponent(q)}`)).data;

export interface DashboardInput { name: string; description?: string | null; theme?: string; homeBranchId?: string | null; homeProcessId?: string | null; settings?: DashboardSettings; isTemplate?: boolean }

export function useDashboardMutations() {
  const qc = useQueryClient();
  const put = (d: DashboardDetail) => { qc.setQueryData(["studio", "dashboard", d.dashboard.id], d); void qc.invalidateQueries({ queryKey: ["studio", "dashboards"] }); return d; };
  return {
    create: useMutation({ mutationFn: async (input: DashboardInput) => put((await hrmsApi.post<Env<DashboardDetail>>(`${BASE}/dashboards`, input)).data) }),
    update: useMutation({ mutationFn: async (v: { id: string; input: DashboardInput & { version: number } }) => put((await hrmsApi.put<Env<DashboardDetail>>(`${BASE}/dashboards/${v.id}`, v.input)).data) }),
    saveWidgets: useMutation({ mutationFn: async (v: { id: string; widgets: Widget[]; version: number }) => put((await hrmsApi.put<Env<DashboardDetail>>(`${BASE}/dashboards/${v.id}/widgets`, { widgets: v.widgets, version: v.version })).data) }),
    saveShares: useMutation({ mutationFn: async (v: { id: string; shares: Share[] }) => { const r = await hrmsApi.put<Env<unknown>>(`${BASE}/dashboards/${v.id}/shares`, { shares: v.shares }); void qc.invalidateQueries({ queryKey: ["studio", "dashboard", v.id] }); return r; } }),
    duplicate: useMutation({ mutationFn: async (v: { id: string; name?: string }) => put((await hrmsApi.post<Env<DashboardDetail>>(`${BASE}/dashboards/${v.id}/duplicate`, { name: v.name })).data) }),
    remove: useMutation({ mutationFn: async (id: string) => { await hrmsApi.delete(`${BASE}/dashboards/${id}`); void qc.invalidateQueries({ queryKey: ["studio", "dashboards"] }); } }),
  };
}

export const errorText = (e: unknown): string => (e instanceof Error && e.message ? e.message : "Something went wrong. Please try again.");
