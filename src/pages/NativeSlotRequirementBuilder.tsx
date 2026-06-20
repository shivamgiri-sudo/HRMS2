import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Calculator, Loader2, Plus, Save, X } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";

type Process = { id: string; process_name?: string; process_code?: string };
type SlotRow = Record<string, any>;

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

function today() { return new Date().toISOString().slice(0, 10); }
function weekEnd(start: string) { const d = new Date(start); d.setDate(d.getDate() + 6); return d.toISOString().slice(0, 10); }

export default function NativeSlotRequirementBuilder() {
  const qc = useQueryClient();
  const [processId, setProcessId] = useState("");
  const [fromDate, setFromDate] = useState(today());
  const [toDate, setToDate] = useState(weekEnd(today()));
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<Record<string, any>>({ workload_type: "inbound_voice", requirement_date: today(), slot_start: "00:00", slot_end: "23:59" });
  const [notice, setNotice] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const processesQ = useQuery({
    queryKey: ["processes"],
    queryFn: async () => (await hrmsApi.get<{ data: Process[] }>("/api/processes")).data ?? [],
  });

  const slotsQ = useQuery({
    queryKey: ["slot-requirements", processId, fromDate, toDate],
    enabled: !!processId,
    queryFn: async () => {
      const qs = new URLSearchParams({ processId, fromDate, toDate });
      return (await hrmsApi.get<{ success: boolean; data: SlotRow[] }>(`/api/wfm/slot-requirements?${qs}`)).data ?? [];
    },
  });

  const saveMut = useMutation({
    mutationFn: (data: Record<string, any>) => hrmsApi.post("/api/wfm/slot-requirements", data),
    onSuccess: () => { setNotice({ type: "success", text: "Slot requirement saved." }); setShowForm(false); void qc.invalidateQueries({ queryKey: ["slot-requirements"] }); },
    onError: (e: Error) => setNotice({ type: "error", text: e.message ?? "Save failed." }),
  });

  const calcMut = useMutation({
    mutationFn: (slotId: string) => hrmsApi.post<{ success: boolean; data: SlotRow }>("/api/wfm/slot-requirements/calculate", { slotId }),
    onSuccess: () => { setNotice({ type: "success", text: "HC calculated." }); void qc.invalidateQueries({ queryKey: ["slot-requirements"] }); },
    onError: (e: Error) => setNotice({ type: "error", text: e.message ?? "Calculation failed." }),
  });

  const calcBulkMut = useMutation({
    mutationFn: () => hrmsApi.post<{ success: boolean; data: { calculated: number; errors: string[] } }>("/api/wfm/slot-requirements/calculate-bulk", { processId, fromDate, toDate }),
    onSuccess: (res) => {
      const d = (res as any).data ?? res;
      setNotice({ type: "success", text: `Calculated ${d.calculated} slots. ${d.errors?.length ? d.errors.length + " errors." : ""}` });
      void qc.invalidateQueries({ queryKey: ["slot-requirements"] });
    },
    onError: (e: Error) => setNotice({ type: "error", text: e.message ?? "Bulk calculation failed." }),
  });

  const slots: SlotRow[] = slotsQ.data ?? [];
  const shortages = slots.filter((s) => s.coverage_status === "shortage");

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <header className="rounded-3xl bg-gradient-to-r from-sky-600 to-cyan-600 p-6 text-white">
          <p className="text-xs font-black uppercase tracking-[.22em] text-sky-200">WFM · Demand Planning</p>
          <h1 className="mt-2 text-3xl font-black">Slot Requirement Builder</h1>
          <p className="mt-2 text-sm opacity-90">Enter forecast volumes by slot. Calculate required HC from planning rules. Identify coverage gaps.</p>
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
              <select value={processId} onChange={(e) => setProcessId(e.target.value)} className="mt-1 block min-w-[200px] rounded-xl border bg-white p-3 text-sm text-slate-900">
                <option value="">Select process</option>
                {(processesQ.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.process_name ?? p.process_code}</option>)}
              </select>
            </label>
            <label className="text-xs font-bold uppercase text-slate-500">From
              <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="mt-1 block rounded-xl border p-3 text-sm" />
            </label>
            <label className="text-xs font-bold uppercase text-slate-500">To
              <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="mt-1 block rounded-xl border p-3 text-sm" />
            </label>
            {processId && (
              <>
                <button onClick={() => { setForm({ ...form, process_id: processId }); setShowForm(true); }} className="flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-3 text-sm font-bold text-white mt-5">
                  <Plus className="h-4 w-4" /> Add Slot
                </button>
                <button disabled={calcBulkMut.isPending} onClick={() => calcBulkMut.mutate()} className="flex items-center gap-2 rounded-xl bg-blue-700 px-4 py-3 text-sm font-bold text-white mt-5 disabled:opacity-50">
                  {calcBulkMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Calculator className="h-4 w-4" />} Calculate All HC
                </button>
              </>
            )}
          </div>
        </section>

        {showForm && (
          <section className="rounded-3xl border bg-sky-50 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-black text-sky-900">New Slot Requirement</h2>
              <button onClick={() => setShowForm(false)}><X className="h-4 w-4 text-sky-700" /></button>
            </div>
            <div className="grid gap-3 md:grid-cols-4">
              <label className="text-xs font-bold text-slate-600">Date
                <input type="date" value={form.requirement_date ?? ""} onChange={(e) => setForm({ ...form, requirement_date: e.target.value })} className="mt-1 block w-full rounded-xl border p-3 text-sm" />
              </label>
              <label className="text-xs font-bold text-slate-600">Slot Start
                <input type="time" value={form.slot_start ?? "00:00"} onChange={(e) => setForm({ ...form, slot_start: e.target.value })} className="mt-1 block w-full rounded-xl border p-3 text-sm" />
              </label>
              <label className="text-xs font-bold text-slate-600">Slot End
                <input type="time" value={form.slot_end ?? "23:59"} onChange={(e) => setForm({ ...form, slot_end: e.target.value })} className="mt-1 block w-full rounded-xl border p-3 text-sm" />
              </label>
              <label className="text-xs font-bold text-slate-600">Workload Type
                <select value={form.workload_type} onChange={(e) => setForm({ ...form, workload_type: e.target.value })} className="mt-1 block w-full rounded-xl border p-3 text-sm">
                  {WORKLOAD_TYPES.map((w) => <option key={w.value} value={w.value}>{w.label}</option>)}
                </select>
              </label>
            </div>
            <div className="grid gap-3 md:grid-cols-4">
              <label className="text-xs font-bold text-slate-600">Forecast Volume
                <input type="number" value={form.forecast_calls ?? ""} onChange={(e) => setForm({ ...form, forecast_calls: Number(e.target.value) })} className="mt-1 block w-full rounded-xl border p-3 text-sm" placeholder="Calls / chats / cases / emails" />
              </label>
              <label className="text-xs font-bold text-slate-600">Backlog Volume
                <input type="number" value={form.backlog_volume ?? ""} onChange={(e) => setForm({ ...form, backlog_volume: Number(e.target.value) })} className="mt-1 block w-full rounded-xl border p-3 text-sm" />
              </label>
              <label className="text-xs font-bold text-slate-600">SLA Due Volume
                <input type="number" value={form.sla_due_volume ?? ""} onChange={(e) => setForm({ ...form, sla_due_volume: Number(e.target.value) })} className="mt-1 block w-full rounded-xl border p-3 text-sm" />
              </label>
              <label className="text-xs font-bold text-slate-600">Source
                <select value={form.source_type ?? "manual"} onChange={(e) => setForm({ ...form, source_type: e.target.value })} className="mt-1 block w-full rounded-xl border p-3 text-sm">
                  <option value="manual">Manual</option><option value="csv_upload">CSV Upload</option><option value="api_push">API Push</option>
                </select>
              </label>
            </div>
            <button disabled={saveMut.isPending} onClick={() => saveMut.mutate({ ...form, process_id: processId })} className="flex items-center gap-2 rounded-xl bg-sky-700 px-5 py-3 text-sm font-bold text-white disabled:opacity-50">
              {saveMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save Slot
            </button>
          </section>
        )}

        {shortages.length > 0 && (
          <div className="rounded-2xl border-2 border-rose-300 bg-rose-50 p-4">
            <p className="text-sm font-black text-rose-800">{shortages.length} slot(s) with coverage shortage</p>
            <p className="text-xs text-rose-600 mt-1">Required HC exceeds scheduled HC for these slots. Review roster or adjust demand.</p>
          </div>
        )}

        {processId && (
          <section className="rounded-3xl border bg-white p-5">
            <h2 className="font-black text-slate-900 mb-4">Slot Requirements ({slots.length})</h2>
            {slotsQ.isLoading ? (
              <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
            ) : slots.length === 0 ? (
              <p className="rounded-xl bg-slate-50 border p-4 text-sm text-slate-500">No slot requirements for this process in the selected date range.</p>
            ) : (
              <div className="overflow-x-auto rounded-2xl border">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-slate-50 text-left font-black uppercase text-slate-500">
                    <tr><th className="px-3 py-2">Date</th><th className="px-3 py-2">Slot</th><th className="px-3 py-2">Type</th><th className="px-3 py-2">Forecast</th><th className="px-3 py-2">Req HC</th><th className="px-3 py-2">Planned HC</th><th className="px-3 py-2">Sched HC</th><th className="px-3 py-2">Delta</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Calc</th></tr>
                  </thead>
                  <tbody className="divide-y">
                    {slots.map((s) => (
                      <tr key={s.id} className={`hover:bg-slate-50 ${s.coverage_status === "shortage" ? "bg-rose-50" : ""}`}>
                        <td className="px-3 py-2 whitespace-nowrap">{s.requirement_date}</td>
                        <td className="px-3 py-2 whitespace-nowrap">{s.slot_start?.slice(0, 5)} – {s.slot_end?.slice(0, 5)}</td>
                        <td className="px-3 py-2 capitalize">{String(s.workload_type).replace("_", " ")}</td>
                        <td className="px-3 py-2">{s.forecast_calls ?? s.chat_volume ?? s.case_volume ?? s.production_volume ?? s.new_email_volume ?? "—"}</td>
                        <td className="px-3 py-2 font-semibold">{s.required_productive_hc ?? "—"}</td>
                        <td className="px-3 py-2 font-black text-blue-700">{s.required_planned_hc ?? "—"}</td>
                        <td className="px-3 py-2">{s.roster_scheduled_hc ?? "—"}</td>
                        <td className={`px-3 py-2 font-bold ${(s.coverage_delta ?? 0) < 0 ? "text-rose-600" : "text-emerald-600"}`}>{s.coverage_delta ?? "—"}</td>
                        <td className="px-3 py-2">
                          <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${s.coverage_status === "shortage" ? "bg-rose-100 text-rose-700" : s.coverage_status === "excess" ? "bg-amber-100 text-amber-700" : s.coverage_status === "ok" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                            {s.coverage_status ?? "pending"}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <button onClick={() => calcMut.mutate(s.id)} disabled={calcMut.isPending} className="rounded-lg bg-blue-50 p-1.5 text-blue-600 hover:bg-blue-100" title="Calculate HC">
                            <Calculator className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}
      </div>
    </DashboardLayout>
  );
}
