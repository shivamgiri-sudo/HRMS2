import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Save, ShieldAlert, X } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";

type ScopeType = "organization" | "branch" | "process" | "employee";
type Process = { id: string; process_name?: string; process_code?: string };
type Branch = { id: string; branch_name?: string; name?: string };
type RestPolicyRow = {
  id: string;
  scope_type: ScopeType;
  scope_id: string | null;
  minimum_rest_minutes: number;
  allows_emergency_override: number;
  effective_from: string;
  effective_to: string | null;
  active_status: number;
  reason: string | null;
};

const SCOPE_LABELS: Record<ScopeType, string> = {
  organization: "Organization (applies to everyone with no more specific policy)",
  branch: "Branch",
  process: "Process",
  employee: "Employee (approved exception)",
};

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export default function NativeWFMRestPolicyConfig() {
  const qc = useQueryClient();
  const [notice, setNotice] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [form, setForm] = useState<{
    scope_type: ScopeType;
    scope_id: string;
    minimum_rest_minutes: string;
    allows_emergency_override: boolean;
    effective_from: string;
    effective_to: string;
    reason: string;
  }>({
    scope_type: "organization",
    scope_id: "",
    minimum_rest_minutes: "",
    allows_emergency_override: false,
    effective_from: todayISO(),
    effective_to: "",
    reason: "",
  });

  const policiesQ = useQuery({
    queryKey: ["rest-policy-config"],
    queryFn: async () => (await hrmsApi.get<{ success: boolean; data: RestPolicyRow[] }>("/api/wfm/rest-policy")).data ?? [],
  });

  const processesQ = useQuery({
    queryKey: ["processes"],
    enabled: form.scope_type === "process",
    queryFn: async () => (await hrmsApi.get<{ data: Process[] }>("/api/processes")).data ?? [],
  });

  const branchesQ = useQuery({
    queryKey: ["branches"],
    enabled: form.scope_type === "branch",
    queryFn: async () => (await hrmsApi.get<{ data: Branch[] }>("/api/branches")).data ?? [],
  });

  const createMut = useMutation({
    mutationFn: (payload: Record<string, unknown>) => hrmsApi.post("/api/wfm/rest-policy", payload),
    onSuccess: () => {
      setNotice({ type: "success", text: "Rest policy saved." });
      setForm((f) => ({ ...f, scope_id: "", minimum_rest_minutes: "", reason: "" }));
      void qc.invalidateQueries({ queryKey: ["rest-policy-config"] });
    },
    onError: (e: Error) => setNotice({ type: "error", text: e.message ?? "Save failed." }),
  });

  const deactivateMut = useMutation({
    mutationFn: (id: string) => hrmsApi.delete(`/api/wfm/rest-policy/${id}`),
    onSuccess: () => {
      setNotice({ type: "success", text: "Policy deactivated." });
      void qc.invalidateQueries({ queryKey: ["rest-policy-config"] });
    },
    onError: (e: Error) => setNotice({ type: "error", text: e.message ?? "Deactivation failed." }),
  });

  function handleSubmit() {
    const minutes = Number(form.minimum_rest_minutes);
    if (!Number.isInteger(minutes) || minutes <= 0) {
      setNotice({ type: "error", text: "Minimum rest must be a positive whole number of minutes." });
      return;
    }
    if (form.scope_type !== "organization" && !form.scope_id) {
      setNotice({ type: "error", text: `Select a ${form.scope_type} for this policy.` });
      return;
    }
    createMut.mutate({
      scope_type: form.scope_type,
      scope_id: form.scope_type === "organization" ? null : form.scope_id,
      minimum_rest_minutes: minutes,
      allows_emergency_override: form.allows_emergency_override,
      effective_from: form.effective_from,
      effective_to: form.effective_to || null,
      reason: form.reason || null,
    });
  }

  const rows = policiesQ.data ?? [];

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <header className="rounded-3xl bg-gradient-to-r from-indigo-600 to-violet-600 p-6 text-white">
          <p className="text-xs font-black uppercase tracking-[.22em] text-indigo-200">WFM · Roster Controls</p>
          <h1 className="mt-2 text-3xl font-black">Minimum Rest Between Shifts</h1>
          <p className="mt-2 text-sm opacity-90">
            Configure the shortest gap allowed between one shift ending and the next beginning, resolved
            employee &gt; process &gt; branch &gt; organization. No configured policy means every roster write for
            that employee is blocked until one exists — there is no silent default.
          </p>
        </header>

        {notice && (
          <div className={`flex items-center justify-between rounded-xl border p-4 text-sm font-semibold ${notice.type === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-rose-200 bg-rose-50 text-rose-800"}`}>
            <span>{notice.text}</span>
            <button onClick={() => setNotice(null)}><X className="h-4 w-4" /></button>
          </div>
        )}

        <section className="rounded-3xl border bg-white p-5 space-y-4">
          <h2 className="flex items-center gap-2 font-black text-slate-900"><ShieldAlert className="h-5 w-5" /> New Policy</h2>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            <label className="text-xs font-bold uppercase text-slate-500">Scope
              <select
                value={form.scope_type}
                onChange={(e) => setForm({ ...form, scope_type: e.target.value as ScopeType, scope_id: "" })}
                className="mt-1 block w-full rounded-xl border bg-white p-3 text-sm text-slate-900"
              >
                {(Object.keys(SCOPE_LABELS) as ScopeType[]).map((s) => (
                  <option key={s} value={s}>{SCOPE_LABELS[s]}</option>
                ))}
              </select>
            </label>

            {form.scope_type === "process" && (
              <label className="text-xs font-bold uppercase text-slate-500">Process
                <select value={form.scope_id} onChange={(e) => setForm({ ...form, scope_id: e.target.value })} className="mt-1 block w-full rounded-xl border bg-white p-3 text-sm text-slate-900">
                  <option value="">Select process</option>
                  {(processesQ.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.process_name ?? p.process_code}</option>)}
                </select>
              </label>
            )}
            {form.scope_type === "branch" && (
              <label className="text-xs font-bold uppercase text-slate-500">Branch
                <select value={form.scope_id} onChange={(e) => setForm({ ...form, scope_id: e.target.value })} className="mt-1 block w-full rounded-xl border bg-white p-3 text-sm text-slate-900">
                  <option value="">Select branch</option>
                  {(branchesQ.data ?? []).map((b) => <option key={b.id} value={b.id}>{b.branch_name ?? b.name}</option>)}
                </select>
              </label>
            )}
            {form.scope_type === "employee" && (
              <label className="text-xs font-bold uppercase text-slate-500">Employee ID
                <input value={form.scope_id} onChange={(e) => setForm({ ...form, scope_id: e.target.value })} placeholder="employee UUID" className="mt-1 block w-full rounded-xl border p-3 text-sm" />
              </label>
            )}

            <label className="text-xs font-bold uppercase text-slate-500">Minimum Rest (minutes)
              <input
                type="number" min={1} max={1440}
                value={form.minimum_rest_minutes}
                onChange={(e) => setForm({ ...form, minimum_rest_minutes: e.target.value })}
                placeholder="e.g. 660 = 11 hours"
                className="mt-1 block w-full rounded-xl border p-3 text-sm"
              />
            </label>

            <label className="text-xs font-bold uppercase text-slate-500">Effective From
              <input type="date" value={form.effective_from} onChange={(e) => setForm({ ...form, effective_from: e.target.value })} className="mt-1 block w-full rounded-xl border p-3 text-sm" />
            </label>
            <label className="text-xs font-bold uppercase text-slate-500">Effective To (optional)
              <input type="date" value={form.effective_to} onChange={(e) => setForm({ ...form, effective_to: e.target.value })} className="mt-1 block w-full rounded-xl border p-3 text-sm" />
            </label>

            <label className="flex items-center gap-2 text-sm self-end pb-3">
              <input type="checkbox" checked={form.allows_emergency_override} onChange={(e) => setForm({ ...form, allows_emergency_override: e.target.checked })} className="h-4 w-4 rounded border-slate-300" />
              Allow emergency override (still requires a reason + approver at publish time)
            </label>

            <label className="text-xs font-bold uppercase text-slate-500 md:col-span-2 lg:col-span-3">Reason
              <textarea value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} rows={2} placeholder="Why this value — shown in the audit trail" className="mt-1 block w-full rounded-xl border p-3 text-sm" />
            </label>
          </div>

          <button disabled={createMut.isPending} onClick={handleSubmit} className="flex items-center gap-2 rounded-xl bg-indigo-700 px-5 py-3 text-sm font-bold text-white disabled:opacity-50">
            {createMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save Policy
          </button>
        </section>

        <section className="rounded-3xl border bg-white p-5">
          <h2 className="font-black text-slate-900 mb-4">Configured Policies</h2>
          {policiesQ.isLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
          ) : rows.length === 0 ? (
            <p className="text-sm text-slate-500">No policy configured at any tier yet — every roster write is currently blocked until at least an organization-level policy exists.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs font-black uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2 text-left">Scope</th>
                    <th className="px-3 py-2 text-left">Minimum Rest</th>
                    <th className="px-3 py-2 text-left">Override</th>
                    <th className="px-3 py-2 text-left">Effective</th>
                    <th className="px-3 py-2 text-left">Status</th>
                    <th className="px-3 py-2 text-left">Reason</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {rows.map((r) => (
                    <tr key={r.id} className="hover:bg-slate-50">
                      <td className="px-3 py-2 font-semibold">{r.scope_type}{r.scope_id ? ` · ${r.scope_id.slice(0, 8)}…` : ""}</td>
                      <td className="px-3 py-2">{r.minimum_rest_minutes} min ({(r.minimum_rest_minutes / 60).toFixed(1)}h)</td>
                      <td className="px-3 py-2">{r.allows_emergency_override ? "Allowed" : "Hard block"}</td>
                      <td className="px-3 py-2 text-xs">{r.effective_from} → {r.effective_to ?? "open-ended"}</td>
                      <td className="px-3 py-2">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${r.active_status ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-600"}`}>
                          {r.active_status ? "Active" : "Inactive"}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-500">{r.reason ?? "—"}</td>
                      <td className="px-3 py-2 text-right">
                        {r.active_status ? (
                          <button
                            disabled={deactivateMut.isPending}
                            onClick={() => { if (confirm("Deactivate this policy?")) deactivateMut.mutate(r.id); }}
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
