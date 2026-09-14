import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Save, ShieldCheck, X } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";

type Process = { id: string; process_name?: string; process_code?: string };
type DayRule = Record<string, any>;
type CapacityGridItem = { day_of_week: number; day_name: string; min_hc_required: number; max_weekoff_allowed: number | null; current_allocated: number; slots_remaining: number | null; is_safe: boolean };

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAY_KEYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

function nextMonday() {
  const d = new Date();
  const day = d.getDay();
  const add = day === 1 ? 0 : (8 - day) % 7 || 7;
  d.setDate(d.getDate() + add);
  return d.toISOString().slice(0, 10);
}

export default function NativeWeekOffDayRuleConfig() {
  const qc = useQueryClient();
  const [processId, setProcessId] = useState("");
  const [weekStartDate, setWeekStartDate] = useState(nextMonday());
  const [form, setForm] = useState<Record<string, any>>({});
  const [notice, setNotice] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const processesQ = useQuery({
    queryKey: ["processes"],
    queryFn: async () => (await hrmsApi.get<{ data: Process[] }>("/api/processes")).data ?? [],
  });

  const rulesQ = useQuery({
    queryKey: ["weekoff-day-rules", processId, weekStartDate],
    enabled: !!processId && !!weekStartDate,
    queryFn: async () => {
      const qs = new URLSearchParams({ processId, weekStartDate });
      const res = await hrmsApi.get<{ success: boolean; data: DayRule[] }>(`/api/wfm/weekoff/day-rules?${qs}`);
      return res.data ?? [];
    },
  });

  const capacityGridQ = useQuery({
    queryKey: ["weekoff-capacity-grid", processId, weekStartDate],
    enabled: !!processId && !!weekStartDate,
    queryFn: async () => {
      const qs = new URLSearchParams({ processId, weekStartDate });
      return (await hrmsApi.get<{ success: boolean; data: CapacityGridItem[] }>(`/api/wfm/weekoff/day-rules/capacity-grid?${qs}`)).data ?? [];
    },
  });

  const saveMut = useMutation({
    mutationFn: (data: Record<string, any>) => hrmsApi.post("/api/wfm/weekoff/day-rules", data),
    onSuccess: () => {
      setNotice({ type: "success", text: "Week-off day rules saved." });
      void qc.invalidateQueries({ queryKey: ["weekoff-day-rules"] });
      void qc.invalidateQueries({ queryKey: ["weekoff-capacity-grid"] });
    },
    onError: (e: Error) => setNotice({ type: "error", text: e.message ?? "Save failed." }),
  });

  const existingRule = (rulesQ.data ?? [])[0] ?? null;
  const grid: CapacityGridItem[] = capacityGridQ.data ?? [];

  const getVal = (key: string) => form[key] ?? existingRule?.[key] ?? 0;
  const setVal = (key: string, value: any) => setForm({ ...form, [key]: value });

  function handleSave() {
    const payload: Record<string, any> = { process_id: processId, week_start_date: weekStartDate, ...form };
    saveMut.mutate(payload);
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <header className="rounded-3xl bg-gradient-to-r from-teal-600 to-emerald-600 p-6 text-white">
          <p className="text-xs font-black uppercase tracking-[.22em] text-teal-200">WFM · Demand Protection</p>
          <h1 className="mt-2 text-3xl font-black">Week-Off Day Rules</h1>
          <p className="mt-2 text-sm opacity-90">Set minimum HC floors and maximum week-off limits per day. The auto week-off engine will not grant week-offs that violate these rules.</p>
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
              <select value={processId} onChange={(e) => { setProcessId(e.target.value); setForm({}); }} className="mt-1 block min-w-[200px] rounded-xl border bg-white p-3 text-sm text-slate-900">
                <option value="">Select process</option>
                {(processesQ.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.process_name ?? p.process_code}</option>)}
              </select>
            </label>
            <label className="text-xs font-bold uppercase text-slate-500">Roster Week Start
              <input type="date" value={weekStartDate} onChange={(e) => { setWeekStartDate(e.target.value); setForm({}); }} className="mt-1 block rounded-xl border p-3 text-sm" />
            </label>
          </div>
        </section>

        {processId && weekStartDate && (
          <>
            {/* Capacity grid — live demand status */}
            <section className="rounded-3xl border bg-white p-5">
              <h2 className="flex items-center gap-2 font-black text-slate-900 mb-4"><ShieldCheck className="h-5 w-5" /> Live Capacity Status</h2>
              {capacityGridQ.isLoading ? (
                <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
              ) : grid.length === 0 ? (
                <p className="text-sm text-slate-500">No capacity data available. Configure rules below.</p>
              ) : (
                <div className="grid grid-cols-7 gap-2">
                  {grid.map((g) => {
                    const pct = g.max_weekoff_allowed && g.max_weekoff_allowed > 0 ? Math.round((g.current_allocated / g.max_weekoff_allowed) * 100) : null;
                    return (
                      <div key={g.day_of_week} className={`rounded-2xl border p-3 text-center ${g.is_safe ? "border-emerald-200 bg-white" : "border-rose-300 bg-rose-50"}`}>
                        <div className="text-xs font-black uppercase text-slate-500">{g.day_name.slice(0, 3)}</div>
                        <div className={`mt-1 text-xl font-black ${g.is_safe ? "text-emerald-700" : "text-rose-600"}`}>
                          {g.is_safe ? "Safe" : "At Risk"}
                        </div>
                        <div className="mt-1 text-xs text-slate-500">Min HC: {g.min_hc_required}</div>
                        <div className="text-xs text-slate-500">WO: {g.current_allocated}/{g.max_weekoff_allowed ?? "∞"}</div>
                        {pct !== null && (
                          <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
                            <div className={`h-full rounded-full ${pct >= 100 ? "bg-rose-500" : pct >= 80 ? "bg-amber-400" : "bg-emerald-400"}`} style={{ width: `${Math.min(pct, 100)}%` }} />
                          </div>
                        )}
                        {g.slots_remaining !== null && (
                          <div className={`mt-1 text-xs font-semibold ${g.slots_remaining <= 0 ? "text-rose-600" : "text-emerald-700"}`}>
                            {g.slots_remaining <= 0 ? "Full" : `${g.slots_remaining} left`}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            {/* Rule editor */}
            <section className="rounded-3xl border bg-white p-5 space-y-5">
              <h2 className="font-black text-slate-900">Per-Day Rules — Week of {weekStartDate}</h2>
              {rulesQ.isLoading ? (
                <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50 text-xs font-black uppercase text-slate-500">
                        <tr>
                          <th className="px-3 py-2 text-left">Day</th>
                          <th className="px-3 py-2">Min HC Required</th>
                          <th className="px-3 py-2">Max Week-offs</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {DAY_KEYS.map((dayKey, i) => (
                          <tr key={dayKey} className="hover:bg-slate-50">
                            <td className="px-3 py-2 font-semibold">{DAYS[i]}</td>
                            <td className="px-3 py-2 text-center">
                              <input type="number" min={0} value={getVal(`min_hc_${dayKey}`)} onChange={(e) => setVal(`min_hc_${dayKey}`, Number(e.target.value))} className="w-20 rounded-lg border px-2 py-1.5 text-center text-sm" />
                            </td>
                            <td className="px-3 py-2 text-center">
                              <input type="number" min={0} value={getVal(`max_weekoff_${dayKey}`) || ""} onChange={(e) => setVal(`max_weekoff_${dayKey}`, e.target.value ? Number(e.target.value) : null)} className="w-20 rounded-lg border px-2 py-1.5 text-center text-sm" placeholder="∞" />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="border-t pt-4 space-y-3">
                    <h3 className="text-sm font-black text-slate-700">Policy Flags</h3>
                    <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
                      {[
                        { key: "weekend_weekoff_allowed", label: "Weekend Week-off Allowed" },
                        { key: "fcfs_enabled", label: "FCFS Enabled" },
                        { key: "preference_priority_enabled", label: "Preference Priority" },
                        { key: "fairness_rotation_enabled", label: "Fairness Rotation" },
                        { key: "skill_based_restriction_enabled", label: "Skill-based Restriction" },
                        { key: "manager_override_allowed", label: "Manager Override Allowed" },
                        { key: "employee_rejection_allowed", label: "Employee Rejection Allowed" },
                        { key: "force_approval_allowed", label: "Force Approval Allowed" },
                      ].map((flag) => (
                        <label key={flag.key} className="flex items-center gap-2 text-sm">
                          <input type="checkbox" checked={!!getVal(flag.key)} onChange={(e) => setVal(flag.key, e.target.checked ? 1 : 0)} className="h-4 w-4 rounded border-slate-300" />
                          {flag.label}
                        </label>
                      ))}
                    </div>
                  </div>

                  <button disabled={saveMut.isPending} onClick={handleSave} className="flex items-center gap-2 rounded-xl bg-teal-700 px-5 py-3 text-sm font-bold text-white disabled:opacity-50">
                    {saveMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save Rules
                  </button>
                </>
              )}
            </section>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
