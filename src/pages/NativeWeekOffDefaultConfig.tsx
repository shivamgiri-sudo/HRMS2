import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { CalendarOff, Loader2, Save, X } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";

type ScopeType = "global" | "branch" | "process";
type Process = { id: string; process_name?: string; process_code?: string };
type Branch = { id: string; branch_name?: string; name?: string };
type WeekOffDefaultRow = {
  id: string;
  scope_type: ScopeType;
  process_id: string | null;
  branch_id: string | null;
  default_week_off_day: number;
  effective_from: string;
  effective_to: string | null;
  active_status: number;
  change_reason: string | null;
};

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const SCOPE_LABELS: Record<ScopeType, string> = {
  global: "Organization (last resort, applies when nothing more specific resolves)",
  branch: "Branch",
  process: "Process",
};

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export default function NativeWeekOffDefaultConfig() {
  const qc = useQueryClient();
  const [notice, setNotice] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [form, setForm] = useState<{
    scope_type: ScopeType;
    process_id: string;
    branch_id: string;
    default_week_off_day: string;
    effective_from: string;
    effective_to: string;
    change_reason: string;
  }>({
    scope_type: "global",
    process_id: "",
    branch_id: "",
    default_week_off_day: "",
    effective_from: todayISO(),
    effective_to: "",
    change_reason: "",
  });

  const policiesQ = useQuery({
    queryKey: ["week-off-default-config"],
    queryFn: async () => (await hrmsApi.get<{ success: boolean; data: WeekOffDefaultRow[] }>("/api/roster-gov/week-off-policy-default")).data ?? [],
  });

  const processesQ = useQuery({
    queryKey: ["processes"],
    enabled: form.scope_type === "process",
    queryFn: async () => (await hrmsApi.get<{ data: Process[] }>("/api/processes")).data ?? [],
  });

  // /api/access/branches (admin/hr only) — NOT /api/branches, which doesn't exist anywhere
  // in the backend. A wfm-only user (this page's own route allows wfm) will get a 403 here
  // even though they can write a branch-scoped default just fine at the API level; the
  // branch dropdown below degrades to a plain ID input on any fetch error rather than
  // silently showing an empty, permanently-loading "Select branch" with no explanation.
  const branchesQ = useQuery({
    queryKey: ["branches"],
    enabled: form.scope_type === "branch",
    retry: false,
    queryFn: async () => (await hrmsApi.get<{ data: Branch[] }>("/api/access/branches")).data ?? [],
  });

  const createMut = useMutation({
    mutationFn: (payload: Record<string, unknown>) => hrmsApi.post("/api/roster-gov/week-off-policy-default", payload),
    onSuccess: () => {
      setNotice({ type: "success", text: "Week-off default saved." });
      setForm((f) => ({ ...f, default_week_off_day: "", change_reason: "" }));
      void qc.invalidateQueries({ queryKey: ["week-off-default-config"] });
    },
    onError: (e: Error) => setNotice({ type: "error", text: e.message ?? "Save failed." }),
  });

  const deactivateMut = useMutation({
    mutationFn: (id: string) => hrmsApi.delete(`/api/roster-gov/week-off-policy-default/${id}`),
    onSuccess: () => {
      setNotice({ type: "success", text: "Default deactivated." });
      void qc.invalidateQueries({ queryKey: ["week-off-default-config"] });
    },
    onError: (e: Error) => setNotice({ type: "error", text: e.message ?? "Deactivation failed." }),
  });

  function handleSubmit() {
    if (form.default_week_off_day === "") {
      setNotice({ type: "error", text: "Select a week-off day." });
      return;
    }
    if (form.scope_type === "process" && !form.process_id) {
      setNotice({ type: "error", text: "Select a process for this default." });
      return;
    }
    if (form.scope_type === "branch" && !form.branch_id) {
      setNotice({ type: "error", text: "Select a branch for this default." });
      return;
    }
    createMut.mutate({
      scope_type: form.scope_type,
      process_id: form.scope_type === "process" ? form.process_id : null,
      branch_id: form.scope_type === "branch" ? form.branch_id : null,
      default_week_off_day: Number(form.default_week_off_day),
      effective_from: form.effective_from,
      effective_to: form.effective_to || null,
      change_reason: form.change_reason || null,
    });
  }

  const rows = policiesQ.data ?? [];

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <header className="rounded-3xl bg-gradient-to-r from-amber-600 to-orange-600 p-6 text-white">
          <p className="text-xs font-black uppercase tracking-[.22em] text-amber-200">WFM · Roster Controls</p>
          <h1 className="mt-2 text-3xl font-black">Week-Off Default Policy</h1>
          <p className="mt-2 text-sm opacity-90">
            The last-resort week-off day for an employee when neither their own approved preference nor their
            process's roster template resolves one — process &gt; branch &gt; organization. Deliberately never
            defaults to Sunday: an unconfigured scope stays unresolved rather than substituting a guess.
          </p>
        </header>

        {notice && (
          <div className={`flex items-center justify-between rounded-xl border p-4 text-sm font-semibold ${notice.type === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-rose-200 bg-rose-50 text-rose-800"}`}>
            <span>{notice.text}</span>
            <button onClick={() => setNotice(null)}><X className="h-4 w-4" /></button>
          </div>
        )}

        <section className="rounded-3xl border bg-white p-5 space-y-4">
          <h2 className="flex items-center gap-2 font-black text-slate-900"><CalendarOff className="h-5 w-5" /> New Default</h2>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            <label className="text-xs font-bold uppercase text-slate-500">Scope
              <select
                value={form.scope_type}
                onChange={(e) => setForm({ ...form, scope_type: e.target.value as ScopeType, process_id: "", branch_id: "" })}
                className="mt-1 block w-full rounded-xl border bg-white p-3 text-sm text-slate-900"
              >
                {(Object.keys(SCOPE_LABELS) as ScopeType[]).map((s) => (
                  <option key={s} value={s}>{SCOPE_LABELS[s]}</option>
                ))}
              </select>
            </label>

            {form.scope_type === "process" && (
              <label className="text-xs font-bold uppercase text-slate-500">Process
                <select value={form.process_id} onChange={(e) => setForm({ ...form, process_id: e.target.value })} className="mt-1 block w-full rounded-xl border bg-white p-3 text-sm text-slate-900">
                  <option value="">Select process</option>
                  {(processesQ.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.process_name ?? p.process_code}</option>)}
                </select>
              </label>
            )}
            {form.scope_type === "branch" && (
              <label className="text-xs font-bold uppercase text-slate-500">Branch
                {branchesQ.isError ? (
                  <>
                    <input value={form.branch_id} onChange={(e) => setForm({ ...form, branch_id: e.target.value })} placeholder="branch UUID" className="mt-1 block w-full rounded-xl border p-3 text-sm" />
                    <span className="mt-1 block text-[11px] font-normal normal-case text-amber-700">
                      Couldn't load the branch list ({branchesQ.error instanceof Error ? branchesQ.error.message : "permission or network error"}) — enter the branch ID directly.
                    </span>
                  </>
                ) : (
                  <select value={form.branch_id} onChange={(e) => setForm({ ...form, branch_id: e.target.value })} className="mt-1 block w-full rounded-xl border bg-white p-3 text-sm text-slate-900">
                    <option value="">{branchesQ.isLoading ? "Loading branches…" : "Select branch"}</option>
                    {(branchesQ.data ?? []).map((b) => <option key={b.id} value={b.id}>{b.branch_name ?? b.name}</option>)}
                  </select>
                )}
              </label>
            )}

            <label className="text-xs font-bold uppercase text-slate-500">Default Week-off Day
              <select value={form.default_week_off_day} onChange={(e) => setForm({ ...form, default_week_off_day: e.target.value })} className="mt-1 block w-full rounded-xl border bg-white p-3 text-sm text-slate-900">
                <option value="">Select day</option>
                {DAYS.map((d, i) => <option key={i} value={i}>{d}</option>)}
              </select>
            </label>

            <label className="text-xs font-bold uppercase text-slate-500">Effective From
              <input type="date" value={form.effective_from} onChange={(e) => setForm({ ...form, effective_from: e.target.value })} className="mt-1 block w-full rounded-xl border p-3 text-sm" />
            </label>
            <label className="text-xs font-bold uppercase text-slate-500">Effective To (optional)
              <input type="date" value={form.effective_to} onChange={(e) => setForm({ ...form, effective_to: e.target.value })} className="mt-1 block w-full rounded-xl border p-3 text-sm" />
            </label>

            <label className="text-xs font-bold uppercase text-slate-500 md:col-span-2 lg:col-span-3">Reason
              <textarea value={form.change_reason} onChange={(e) => setForm({ ...form, change_reason: e.target.value })} rows={2} placeholder="Why this default — shown in the audit trail" className="mt-1 block w-full rounded-xl border p-3 text-sm" />
            </label>
          </div>

          <button disabled={createMut.isPending} onClick={handleSubmit} className="flex items-center gap-2 rounded-xl bg-amber-700 px-5 py-3 text-sm font-bold text-white disabled:opacity-50">
            {createMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save Default
          </button>
        </section>

        <section className="rounded-3xl border bg-white p-5">
          <h2 className="font-black text-slate-900 mb-4">Configured Defaults</h2>
          {policiesQ.isLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
          ) : rows.length === 0 ? (
            <p className="text-sm text-slate-500">No default configured at any tier yet. Employees with no approved preference and no matching roster template fall through to WEEK_OFF_POLICY_MISSING.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs font-black uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2 text-left">Scope</th>
                    <th className="px-3 py-2 text-left">Default Day</th>
                    <th className="px-3 py-2 text-left">Effective</th>
                    <th className="px-3 py-2 text-left">Status</th>
                    <th className="px-3 py-2 text-left">Reason</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {rows.map((r) => (
                    <tr key={r.id} className="hover:bg-slate-50">
                      <td className="px-3 py-2 font-semibold">
                        {r.scope_type}
                        {r.process_id ? ` · ${r.process_id.slice(0, 8)}…` : ""}
                        {r.branch_id ? ` · ${r.branch_id.slice(0, 8)}…` : ""}
                      </td>
                      <td className="px-3 py-2">{DAYS[r.default_week_off_day]}</td>
                      <td className="px-3 py-2 text-xs">{r.effective_from} → {r.effective_to ?? "open-ended"}</td>
                      <td className="px-3 py-2">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${r.active_status ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-600"}`}>
                          {r.active_status ? "Active" : "Inactive"}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-500">{r.change_reason ?? "—"}</td>
                      <td className="px-3 py-2 text-right">
                        {r.active_status ? (
                          <button
                            disabled={deactivateMut.isPending}
                            onClick={() => { if (confirm("Deactivate this default?")) deactivateMut.mutate(r.id); }}
                            className="text-xs font-bold text-rose-600 hover:underline disabled:opacity-50"
                          >
                            Deactivate
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </DashboardLayout>
  );
}
