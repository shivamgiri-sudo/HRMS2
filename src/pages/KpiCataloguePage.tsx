import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, RefreshCw, CheckCircle2 } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";
import { useWorkforceAccess } from "@/hooks/useUserRole";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/**
 * KPI Catalogue: the one place that says which KPIs exist for each process, how each is computed, where the data
 * comes from, how fresh it is and which roles / departments see it. KPI Studio and the older KPI models are reconciled
 * to it; the Conflicts tab lists every place they still disagree.
 */

type ProcessSummary = { process_key: string; process_name: string; kpi_count: number; with_data: number; employee_grain: number; realtime: number };
type RoleDept = { role_key: string; department_key: string; kpi_count: number };
type CatalogueKpi = {
  id: string; metric_key: string; metric_name: string; theme: string; unit: string; direction: string; grain: string;
  source_kind: string; source_ref: string | null; formula: string | null; freshness: string; dimensions: string[];
  has_data: boolean; metric_code: string | null; roles: Array<{ role_key: string; department_key: string; access: string }>;
};
type Conflict = { id: string; conflict_type: string; process_key: string | null; metric_key: string | null; detail: Record<string, unknown>; resolved: boolean };

const ADMIN_ROLES = ["admin", "super_admin"];
const FRESH_STYLE: Record<string, string> = {
  realtime: "bg-emerald-100 text-emerald-800 border-emerald-300",
  hourly: "bg-sky-100 text-sky-800 border-sky-300",
  daily: "bg-slate-100 text-slate-700 border-slate-300",
  upload: "bg-amber-100 text-amber-800 border-amber-300",
};
const ALL = "__all__";

export default function KpiCataloguePage() {
  const qc = useQueryClient();
  const { roleKeys } = useWorkforceAccess();
  const isAdmin = roleKeys.some((r) => ADMIN_ROLES.includes(r));
  const [processKey, setProcessKey] = useState<string>("");
  const [role, setRole] = useState(ALL);
  const [department, setDepartment] = useState(ALL);
  const [theme, setTheme] = useState(ALL);
  const [showNoData, setShowNoData] = useState(true);

  const processes = useQuery<ProcessSummary[]>({
    queryKey: ["kpi-catalogue", "processes"],
    queryFn: () => hrmsApi.get<any>("/api/kpi-catalogue/processes").then((d: any) => d.data ?? []),
  });
  const roles = useQuery<RoleDept[]>({
    queryKey: ["kpi-catalogue", "roles"],
    queryFn: () => hrmsApi.get<any>("/api/kpi-catalogue/roles").then((d: any) => d.data ?? []),
  });

  const activeKey = processKey || processes.data?.[0]?.process_key || "";
  const kpis = useQuery<CatalogueKpi[]>({
    queryKey: ["kpi-catalogue", "process", activeKey, role, department, theme, showNoData],
    enabled: Boolean(activeKey),
    queryFn: () => {
      const qs = new URLSearchParams();
      if (role !== ALL) qs.set("role", role);
      if (department !== ALL) qs.set("department", department);
      if (theme !== ALL) qs.set("theme", theme);
      if (showNoData) qs.set("includeNoData", "1");
      return hrmsApi.get<any>(`/api/kpi-catalogue/process/${activeKey}?${qs}`).then((d: any) => d.data ?? []);
    },
  });
  const conflicts = useQuery<Conflict[]>({
    queryKey: ["kpi-catalogue", "conflicts"],
    queryFn: () => hrmsApi.get<any>("/api/kpi-catalogue/conflicts").then((d: any) => d.data ?? []),
    retry: false,
  });

  const sync = useMutation({
    mutationFn: () => hrmsApi.post<any>("/api/kpi-catalogue/sync", {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["kpi-catalogue"] }),
  });
  const recheck = useMutation({
    mutationFn: () => hrmsApi.post<any>("/api/kpi-catalogue/drift/record", {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["kpi-catalogue", "conflicts"] }),
  });
  const resolve = useMutation({
    mutationFn: (id: string) => hrmsApi.post<any>(`/api/kpi-catalogue/conflicts/${id}/resolve`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["kpi-catalogue", "conflicts"] }),
  });

  const themes = useMemo(() => Array.from(new Set((kpis.data ?? []).map((k) => k.theme))).sort(), [kpis.data]);
  const departments = useMemo(() => Array.from(new Set((roles.data ?? []).map((r) => r.department_key))).sort(), [roles.data]);
  const current = processes.data?.find((p) => p.process_key === activeKey);
  const conflictCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of conflicts.data ?? []) m.set(c.conflict_type, (m.get(c.conflict_type) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [conflicts.data]);

  return (
    <DashboardLayout>
      <div className="p-6 max-w-[1400px] mx-auto space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">KPI Catalogue</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Every KPI per process, with its formula, data source, freshness and the roles and departments that see it.
            </p>
          </div>
          {isAdmin && (
            <Button onClick={() => sync.mutate()} disabled={sync.isPending} className="min-h-[44px]">
              {sync.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
              Sync catalogue
            </Button>
          )}
        </div>
        {sync.isSuccess && (
          <p className="text-sm text-emerald-700 flex items-center gap-1"><CheckCircle2 className="h-4 w-4" /> Catalogue synced and reconciled.</p>
        )}
        {sync.isError && <p className="text-sm text-red-600">{(sync.error as Error)?.message ?? "Sync failed"}</p>}

        <Tabs defaultValue="kpis">
          <TabsList>
            <TabsTrigger value="kpis">KPIs</TabsTrigger>
            <TabsTrigger value="conflicts">Conflicts{conflicts.data?.length ? ` (${conflicts.data.length})` : ""}</TabsTrigger>
          </TabsList>

          <TabsContent value="kpis" className="space-y-4">
            <div className="flex flex-wrap items-end gap-3">
              <FilterSelect label="Process" value={activeKey} onChange={setProcessKey}
                options={(processes.data ?? []).map((p) => ({ value: p.process_key, label: `${p.process_name} (${p.kpi_count})` }))} />
              <FilterSelect label="Role" value={role} onChange={setRole} all
                options={Array.from(new Set((roles.data ?? []).map((r) => r.role_key))).sort().map((r) => ({ value: r, label: r }))} />
              <FilterSelect label="Department" value={department} onChange={setDepartment} all options={departments.map((d) => ({ value: d, label: d }))} />
              <FilterSelect label="Theme" value={theme} onChange={setTheme} all options={themes.map((t) => ({ value: t, label: t }))} />
              <label className="flex items-center gap-2 text-sm pb-2"><Switch checked={showNoData} onCheckedChange={setShowNoData} /> Include KPIs with no data</label>
            </div>
            {current && (
              <p className="text-xs text-muted-foreground">
                {current.kpi_count} KPIs · {current.with_data} with data · {current.employee_grain} employee-level · {current.realtime} real-time
              </p>
            )}
            {(processes.isLoading || kpis.isLoading) && <p className="text-sm flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>}
            {processes.data?.length === 0 && !processes.isLoading && (
              <p className="text-sm text-muted-foreground">The catalogue is empty{isAdmin ? ": click Sync catalogue to load it." : "."}</p>
            )}
            {!!kpis.data?.length && (
              <div className="overflow-x-auto border rounded-lg">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-left">
                    <tr>{["KPI", "Theme", "Better", "Grain", "Source", "Formula", "Fresh", "Dimensions", "Roles"].map((h) => <th key={h} className="px-3 py-2 font-medium whitespace-nowrap">{h}</th>)}</tr>
                  </thead>
                  <tbody>
                    {kpis.data.map((k) => (
                      <tr key={k.id} className="border-t align-top">
                        <td className="px-3 py-2 min-w-[200px]">
                          <div className="font-medium">{k.metric_name}</div>
                          <div className="text-xs text-muted-foreground">{k.unit}{k.metric_code ? ` · ${k.metric_code}` : ""}</div>
                          {!k.has_data && <Badge variant="outline" className="mt-1 text-amber-700 border-amber-300">no data</Badge>}
                        </td>
                        <td className="px-3 py-2">{k.theme}</td>
                        <td className="px-3 py-2 whitespace-nowrap">{k.direction === "higher_is_better" ? "higher" : "lower"}</td>
                        <td className="px-3 py-2">{k.grain}</td>
                        <td className="px-3 py-2 text-xs min-w-[200px]">{k.source_ref}</td>
                        <td className="px-3 py-2 text-xs min-w-[220px]">{k.formula}</td>
                        <td className="px-3 py-2"><span className={`text-xs px-2 py-0.5 rounded border ${FRESH_STYLE[k.freshness] ?? ""}`}>{k.freshness}</span></td>
                        <td className="px-3 py-2 text-xs">{k.dimensions.join(", ")}</td>
                        <td className="px-3 py-2 text-xs min-w-[180px]">{summariseRoles(k.roles)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {kpis.data?.length === 0 && !kpis.isLoading && <p className="text-sm text-muted-foreground">No KPIs match these filters.</p>}
          </TabsContent>

          <TabsContent value="conflicts" className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              {conflictCounts.map(([t, n]) => <Badge key={t} variant="outline">{t}: {n}</Badge>)}
              {isAdmin && (
                <Button size="sm" variant="outline" onClick={() => recheck.mutate()} disabled={recheck.isPending}>
                  {recheck.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-1" />} Re-check
                </Button>
              )}
            </div>
            {conflicts.isError && <p className="text-sm text-muted-foreground">You don't have access to the conflict list.</p>}
            {!conflicts.isError && conflicts.data?.length === 0 && <p className="text-sm text-muted-foreground">No open conflicts.</p>}
            <div className="space-y-2">
              {(conflicts.data ?? []).slice(0, 300).map((c) => (
                <div key={c.id} className="border rounded-lg p-3 text-sm flex items-start justify-between gap-3">
                  <div>
                    <div className="font-medium">{c.conflict_type}{c.process_key ? ` · ${c.process_key}` : ""}{c.metric_key ? ` · ${c.metric_key}` : ""}</div>
                    <pre className="text-xs text-muted-foreground whitespace-pre-wrap mt-1">{JSON.stringify(c.detail, null, 1)}</pre>
                  </div>
                  {isAdmin && <Button size="sm" variant="ghost" onClick={() => resolve.mutate(c.id)}>Mark resolved</Button>}
                </div>
              ))}
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}

function summariseRoles(roles: CatalogueKpi["roles"]): string {
  const byDept = new Map<string, string[]>();
  for (const r of roles) byDept.set(r.department_key, [...(byDept.get(r.department_key) ?? []), r.role_key]);
  return [...byDept.entries()].map(([d, rs]) => `${d}: ${rs.join(", ")}`).join(" | ");
}

function FilterSelect({ label, value, onChange, options, all }: {
  label: string; value: string; onChange: (v: string) => void; options: Array<{ value: string; label: string }>; all?: boolean;
}) {
  return (
    <div className="min-w-[180px]">
      <div className="text-xs text-muted-foreground mb-1">{label}</div>
      <Select value={value || (all ? ALL : "")} onValueChange={onChange}>
        <SelectTrigger className="min-h-[44px]"><SelectValue placeholder={label} /></SelectTrigger>
        <SelectContent>
          {all && <SelectItem value={ALL}>All</SelectItem>}
          {options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}
