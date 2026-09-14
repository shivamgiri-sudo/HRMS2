import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Calculator, Loader2, Plus, Save, Trash2, X } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";

type Process = { id: string; process_name?: string; process_code?: string };
type PlanningRule = Record<string, any>;

const WORKLOAD_TYPES = [
  { value: "inbound_voice", label: "Inbound Voice" },
  { value: "outbound_voice", label: "Outbound Voice" },
  { value: "chat", label: "Chat" },
  { value: "email", label: "Email" },
  { value: "backoffice", label: "Backoffice" },
  { value: "data_verification", label: "Data Verification" },
  { value: "audit_quality", label: "Audit / Quality" },
  { value: "blended", label: "Blended" },
];

const FIELDS_BY_TYPE: Record<string, { key: string; label: string; type: string }[]> = {
  inbound_voice: [
    { key: "aht_seconds", label: "AHT (seconds)", type: "number" },
    { key: "shrinkage_pct", label: "Shrinkage %", type: "number" },
    { key: "service_level_target_pct", label: "Service Level Target %", type: "number" },
    { key: "answer_time_seconds", label: "Answer Time (seconds)", type: "number" },
    { key: "abandonment_target_pct", label: "Abandonment Target %", type: "number" },
    { key: "occupancy_target_pct", label: "Occupancy Target %", type: "number" },
  ],
  outbound_voice: [
    { key: "campaign_target_type", label: "Campaign Target Type", type: "text" },
    { key: "target_attempts", label: "Target Attempts", type: "number" },
    { key: "target_contacts", label: "Target Contacts", type: "number" },
    { key: "target_sales", label: "Target Sales", type: "number" },
    { key: "connect_rate_pct", label: "Connect Rate %", type: "number" },
    { key: "conversion_rate_pct", label: "Conversion Rate %", type: "number" },
    { key: "dials_per_agent_hour", label: "Dials/Agent/Hour", type: "number" },
    { key: "dialer_mode", label: "Dialer Mode", type: "text" },
    { key: "shrinkage_pct", label: "Shrinkage %", type: "number" },
  ],
  chat: [
    { key: "avg_chat_duration_seconds", label: "Avg Chat Duration (sec)", type: "number" },
    { key: "chat_concurrency", label: "Chat Concurrency", type: "number" },
    { key: "first_response_sla_seconds", label: "First Response SLA (sec)", type: "number" },
    { key: "shrinkage_pct", label: "Shrinkage %", type: "number" },
  ],
  email: [
    { key: "emails_per_agent_hour", label: "Emails/Agent/Hour", type: "number" },
    { key: "email_sla_hours", label: "Email SLA (hours)", type: "number" },
    { key: "backlog_clearance_hours", label: "Backlog Clearance (hours)", type: "number" },
    { key: "shrinkage_pct", label: "Shrinkage %", type: "number" },
  ],
  backoffice: [
    { key: "cases_per_agent_hour", label: "Cases/Agent/Hour", type: "number" },
    { key: "aht_seconds", label: "AHT (seconds)", type: "number" },
    { key: "tat_hours", label: "TAT (hours)", type: "number" },
    { key: "quality_recheck_pct", label: "QA Recheck %", type: "number" },
    { key: "shrinkage_pct", label: "Shrinkage %", type: "number" },
  ],
  data_verification: [
    { key: "cases_per_agent_hour", label: "Cases/Agent/Hour", type: "number" },
    { key: "tat_hours", label: "TAT (hours)", type: "number" },
    { key: "quality_recheck_pct", label: "QA Recheck %", type: "number" },
    { key: "shrinkage_pct", label: "Shrinkage %", type: "number" },
  ],
  audit_quality: [
    { key: "audit_sample_pct", label: "Audit Sample %", type: "number" },
    { key: "audits_per_qa_hour", label: "Audits/QA/Hour", type: "number" },
    { key: "shrinkage_pct", label: "Shrinkage %", type: "number" },
  ],
  blended: [
    { key: "aht_seconds", label: "AHT (seconds)", type: "number" },
    { key: "shrinkage_pct", label: "Shrinkage %", type: "number" },
    { key: "notes", label: "Blended Config Notes", type: "text" },
  ],
};

function today() { return new Date().toISOString().slice(0, 10); }

export default function NativeWFMPlanningRules() {
  const qc = useQueryClient();
  const [processId, setProcessId] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<Record<string, any>>({ workload_type: "inbound_voice", effective_from: today() });
  const [calcInput, setCalcInput] = useState<Record<string, any>>({ workload_type: "inbound_voice" });
  const [calcResult, setCalcResult] = useState<any>(null);
  const [notice, setNotice] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const processesQ = useQuery({
    queryKey: ["processes"],
    queryFn: async () => (await hrmsApi.get<{ data: Process[] }>("/api/processes")).data ?? [],
  });

  const rulesQ = useQuery({
    queryKey: ["planning-rules", processId],
    enabled: !!processId,
    queryFn: async () => (await hrmsApi.get<{ success: boolean; data: PlanningRule[] }>(`/api/wfm/planning-rules?processId=${processId}`)).data ?? [],
  });

  const createMut = useMutation({
    mutationFn: (data: Record<string, any>) => hrmsApi.post("/api/wfm/planning-rules", data),
    onSuccess: () => { setNotice({ type: "success", text: "Planning rule saved." }); setShowForm(false); void qc.invalidateQueries({ queryKey: ["planning-rules"] }); },
    onError: (e: Error) => setNotice({ type: "error", text: e.message ?? "Failed to save." }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => hrmsApi.delete(`/api/wfm/planning-rules/${id}`),
    onSuccess: () => { setNotice({ type: "success", text: "Rule deactivated." }); void qc.invalidateQueries({ queryKey: ["planning-rules"] }); },
    onError: (e: Error) => setNotice({ type: "error", text: e.message ?? "Failed." }),
  });

  const calcMut = useMutation({
    mutationFn: (data: Record<string, any>) => hrmsApi.post<{ success: boolean; data: any }>("/api/wfm/planning-rules/calculate", data),
    onSuccess: (res) => setCalcResult((res as any).data ?? res),
    onError: (e: Error) => setCalcResult({ errors: [e.message] }),
  });

  const fields = FIELDS_BY_TYPE[form.workload_type] ?? FIELDS_BY_TYPE.inbound_voice;
  const calcFields = FIELDS_BY_TYPE[calcInput.workload_type] ?? FIELDS_BY_TYPE.inbound_voice;

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <header className="rounded-3xl bg-gradient-to-r from-indigo-600 to-violet-600 p-6 text-white">
          <p className="text-xs font-black uppercase tracking-[.22em] text-indigo-200">WFM · Capacity Planning</p>
          <h1 className="mt-2 text-3xl font-black">Process Planning Rules</h1>
          <p className="mt-2 text-sm opacity-90">Define HC calculation parameters per process and workload type. One active rule per process/type/effective period.</p>
        </header>

        {notice && (
          <div className={`flex items-center justify-between rounded-xl border p-4 text-sm font-semibold ${notice.type === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-rose-200 bg-rose-50 text-rose-800"}`}>
            <span>{notice.text}</span>
            <button onClick={() => setNotice(null)}><X className="h-4 w-4" /></button>
          </div>
        )}

        <section className="rounded-3xl border bg-white p-5">
          <div className="flex flex-wrap gap-3 items-end">
            <label className="text-xs font-bold uppercase text-slate-500">Process
              <select value={processId} onChange={(e) => setProcessId(e.target.value)} className="mt-1 block w-full min-w-[200px] rounded-xl border bg-white p-3 text-sm text-slate-900">
                <option value="">Select process</option>
                {(processesQ.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.process_name ?? p.process_code}</option>)}
              </select>
            </label>
            {processId && (
              <button onClick={() => { setForm({ workload_type: "inbound_voice", effective_from: today(), process_id: processId }); setShowForm(true); }} className="flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-3 text-sm font-bold text-white">
                <Plus className="h-4 w-4" /> New Rule
              </button>
            )}
          </div>
        </section>

        {showForm && (
          <section className="rounded-3xl border bg-violet-50 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-black text-violet-900">New Planning Rule</h2>
              <button onClick={() => setShowForm(false)} className="rounded-xl p-2 hover:bg-violet-100"><X className="h-4 w-4 text-violet-700" /></button>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <label className="text-xs font-bold text-slate-600">Workload Type
                <select value={form.workload_type} onChange={(e) => setForm({ ...form, workload_type: e.target.value })} className="mt-1 block w-full rounded-xl border p-3 text-sm">
                  {WORKLOAD_TYPES.map((w) => <option key={w.value} value={w.value}>{w.label}</option>)}
                </select>
              </label>
              <label className="text-xs font-bold text-slate-600">Effective From
                <input type="date" value={form.effective_from ?? ""} onChange={(e) => setForm({ ...form, effective_from: e.target.value })} className="mt-1 block w-full rounded-xl border p-3 text-sm" />
              </label>
              <label className="text-xs font-bold text-slate-600">Effective To (optional)
                <input type="date" value={form.effective_to ?? ""} onChange={(e) => setForm({ ...form, effective_to: e.target.value })} className="mt-1 block w-full rounded-xl border p-3 text-sm" />
              </label>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              {fields.map((f) => (
                <label key={f.key} className="text-xs font-bold text-slate-600">{f.label}
                  <input type={f.type} value={form[f.key] ?? ""} onChange={(e) => setForm({ ...form, [f.key]: f.type === "number" ? Number(e.target.value) : e.target.value })} className="mt-1 block w-full rounded-xl border p-3 text-sm" />
                </label>
              ))}
            </div>
            <button disabled={createMut.isPending} onClick={() => createMut.mutate({ ...form, process_id: processId })} className="flex items-center gap-2 rounded-xl bg-violet-700 px-5 py-3 text-sm font-bold text-white disabled:opacity-50">
              {createMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save Rule
            </button>
          </section>
        )}

        {processId && (
          <section className="rounded-3xl border bg-white p-5">
            <h2 className="font-black text-slate-900 mb-4">Active Rules</h2>
            {rulesQ.isLoading ? (
              <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
            ) : (rulesQ.data ?? []).length === 0 ? (
              <p className="rounded-xl bg-slate-50 border p-4 text-sm text-slate-500">No planning rules configured for this process. Click "New Rule" to add one.</p>
            ) : (
              <div className="overflow-x-auto rounded-2xl border">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs font-black uppercase text-slate-500">
                    <tr><th className="px-3 py-2">Type</th><th className="px-3 py-2">Effective</th><th className="px-3 py-2">AHT</th><th className="px-3 py-2">Shrinkage</th><th className="px-3 py-2">Key Param</th><th className="px-3 py-2">Action</th></tr>
                  </thead>
                  <tbody className="divide-y">
                    {(rulesQ.data ?? []).map((r) => (
                      <tr key={r.id} className="hover:bg-slate-50">
                        <td className="px-3 py-2 capitalize font-semibold">{String(r.workload_type).replace("_", " ")}</td>
                        <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{r.effective_from}{r.effective_to ? ` → ${r.effective_to}` : " → ongoing"}</td>
                        <td className="px-3 py-2">{r.aht_seconds ?? "—"}</td>
                        <td className="px-3 py-2">{r.shrinkage_pct ?? 0}%</td>
                        <td className="px-3 py-2 text-slate-500 text-xs max-w-[180px] truncate">
                          {r.dials_per_agent_hour ? `${r.dials_per_agent_hour} dials/hr` : r.chat_concurrency ? `${r.chat_concurrency}× conc` : r.cases_per_agent_hour ? `${r.cases_per_agent_hour} cases/hr` : r.emails_per_agent_hour ? `${r.emails_per_agent_hour} emails/hr` : r.audits_per_qa_hour ? `${r.audits_per_qa_hour} audits/hr` : "—"}
                        </td>
                        <td className="px-3 py-2">
                          <button onClick={() => deleteMut.mutate(r.id)} disabled={deleteMut.isPending} className="rounded-lg bg-rose-50 p-1.5 text-rose-600 hover:bg-rose-100"><Trash2 className="h-3.5 w-3.5" /></button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        <section className="rounded-3xl border bg-white p-5 space-y-4">
          <h2 className="flex items-center gap-2 font-black text-slate-900"><Calculator className="h-5 w-5" /> HC Calculator (Preview)</h2>
          <p className="text-sm text-slate-500">Test HC formulas without saving. Enter forecast data and parameters to see the calculated headcount.</p>
          <div className="grid gap-3 md:grid-cols-4">
            <label className="text-xs font-bold text-slate-600">Workload Type
              <select value={calcInput.workload_type} onChange={(e) => setCalcInput({ ...calcInput, workload_type: e.target.value })} className="mt-1 block w-full rounded-xl border p-3 text-sm">
                {WORKLOAD_TYPES.map((w) => <option key={w.value} value={w.value}>{w.label}</option>)}
              </select>
            </label>
            <label className="text-xs font-bold text-slate-600">Forecast Volume
              <input type="number" value={calcInput.forecast_calls ?? calcInput.chat_volume ?? calcInput.case_volume ?? ""} onChange={(e) => {
                const v = Number(e.target.value);
                const t = calcInput.workload_type;
                if (t === "chat") setCalcInput({ ...calcInput, chat_volume: v });
                else if (t === "email") setCalcInput({ ...calcInput, new_email_volume: v });
                else if (t === "backoffice" || t === "data_verification") setCalcInput({ ...calcInput, case_volume: v });
                else if (t === "audit_quality") setCalcInput({ ...calcInput, production_volume: v });
                else setCalcInput({ ...calcInput, forecast_calls: v });
              }} className="mt-1 block w-full rounded-xl border p-3 text-sm" />
            </label>
            {calcFields.slice(0, 4).map((f) => (
              <label key={f.key} className="text-xs font-bold text-slate-600">{f.label}
                <input type={f.type} value={calcInput[f.key] ?? ""} onChange={(e) => setCalcInput({ ...calcInput, [f.key]: f.type === "number" ? Number(e.target.value) : e.target.value })} className="mt-1 block w-full rounded-xl border p-3 text-sm" />
              </label>
            ))}
          </div>
          <button onClick={() => calcMut.mutate(calcInput)} disabled={calcMut.isPending} className="flex items-center gap-2 rounded-xl bg-blue-700 px-5 py-3 text-sm font-bold text-white disabled:opacity-50">
            {calcMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Calculator className="h-4 w-4" />} Calculate HC
          </button>
          {calcResult && (
            <div className="rounded-2xl border bg-blue-50 p-4 space-y-2">
              <div className="flex gap-6">
                <div><span className="text-xs font-bold text-slate-500">Productive HC</span><p className="text-2xl font-black text-slate-900">{calcResult.productive_hc ?? "—"}</p></div>
                <div><span className="text-xs font-bold text-slate-500">Planned HC (with shrinkage)</span><p className="text-2xl font-black text-blue-700">{calcResult.planned_hc ?? "—"}</p></div>
                <div><span className="text-xs font-bold text-slate-500">Method</span><p className="text-sm font-semibold text-slate-700">{calcResult.calculation_method ?? "—"}</p></div>
              </div>
              {calcResult.errors?.length > 0 && (
                <div className="rounded-xl bg-rose-50 border border-rose-200 p-3 text-xs text-rose-700">{calcResult.errors.join("; ")}</div>
              )}
              {calcResult.notes && (
                <details className="text-xs text-slate-500">
                  <summary className="cursor-pointer font-bold">Calculation Notes</summary>
                  <pre className="mt-1 overflow-auto rounded-xl bg-white border p-2">{JSON.stringify(calcResult.notes, null, 2)}</pre>
                </details>
              )}
            </div>
          )}
        </section>
      </div>
    </DashboardLayout>
  );
}
