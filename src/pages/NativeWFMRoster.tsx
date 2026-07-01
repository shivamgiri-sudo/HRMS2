import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Loader2, Play, X } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";

type Process = { id: string; process_name?: string; process_code?: string };
type Shift = { id: string; shift_code: string; shift_name: string; start_time: string; end_time: string; version: number };
type Cycle = { id: string; week_start_date: string; week_end_date: string; status: string };
type Row = { id: string; employee_id: string; roster_date: string; shift_template_id: string | null; is_week_off: number; acknowledgement_status: string };
type GenerationRun = {
  id: string;
  cycle_id: string;
  run_type: string;
  status: string;
  employees_processed: number;
  assignments_created: number;
  weekoffs_allocated: number;
  conflicts_found: number;
  triggered_by: string;
  started_at: string;
  completed_at: string | null;
  error_details?: { message?: string } | null;
};
type DecisionAuditRow = {
  id: string;
  employee_id: string;
  roster_date: string;
  decision_type: string;
  is_week_off: number;
  preferred_day: number | null;
  allocated_day: number | null;
  rule_applied: string | null;
  override_by: string | null;
  employee_code: string;
  first_name: string;
  last_name: string;
};
type ActualRow = {
  id: string;
  employee_id: string;
  process_id: string;
  employee_code: string;
  employee_name: string;
  roster_date: string;
  roster_status: string;
  publish_status: string;
  shift_code: string;
  shift_name: string;
  shift_start_time: string | null;
  shift_end_time: string | null;
  branch_name: string | null;
  process_name: string | null;
};
const next: Record<string, string> = { draft: "submitted", submitted: "reviewed", reviewed: "published", published: "acknowledged", acknowledged: "active", active: "variance_review", variance_review: "attendance_locked", attendance_locked: "payroll_input_ready", payroll_input_ready: "closed" };
const today = new Date().toISOString().slice(0, 10);

export default function NativeWFMRoster() {
  const qc = useQueryClient();
  const [processId, setProcessId] = useState("");
  const [cycleId, setCycleId] = useState("");
  const [notice, setNotice] = useState("");
  const [shift, setShift] = useState({ code: "DAY", name: "Day Shift", start: "09:00", end: "18:00" });
  const [cycle, setCycle] = useState({ start: today, end: today, hc: "" });
  const [action, setAction] = useState({ date: today, gap: "", cause: "", plan: "" });
  const [rowsJson, setRowsJson] = useState("[]");
  const [showRunHistory, setShowRunHistory] = useState(false);
  const [auditRunId, setAuditRunId] = useState<string | null>(null);

  const processes = useQuery({ queryKey: ["processes"], queryFn: async () => (await hrmsApi.get<{ data: Process[] }>("/api/processes")).data ?? [] });
  const actualProcess = useQuery({
    queryKey: ["actual-roster-process"],
    queryFn: async () =>
      (await hrmsApi.get<{ data: { process_id: string } | null }>("/api/wfm/roster/actual-process")).data,
  });
  const shifts = useQuery({ queryKey: ["gov-shifts", processId], enabled: !!processId, queryFn: async () => (await hrmsApi.get<{ data: Shift[] }>(`/api/roster-gov/shifts/templates?process_id=${processId}&active_status=1`)).data ?? [] });
  const cycles = useQuery({ queryKey: ["gov-cycles", processId], enabled: !!processId, queryFn: async () => (await hrmsApi.get<{ data: Cycle[] }>(`/api/roster-gov/cycles?process_id=${processId}`)).data ?? [] });
  const assignments = useQuery({ queryKey: ["gov-rows", cycleId], enabled: !!cycleId, queryFn: async () => (await hrmsApi.get<{ data: Row[] }>(`/api/roster-gov/cycles/${cycleId}/assignments`)).data ?? [] });
  const actualAssignments = useQuery({
    queryKey: ["actual-roster-assignments", processId],
    enabled: !!processId,
    queryFn: async () =>
      (await hrmsApi.get<{ data: ActualRow[] }>(
        `/api/wfm/roster/actual-assignments?processId=${processId}&limit=500`
      )).data ?? [],
  });
  const generationRuns = useQuery({
    queryKey: ["generation-runs", cycleId],
    enabled: !!cycleId && showRunHistory,
    queryFn: async () => (await hrmsApi.get<{ data: GenerationRun[] }>(`/api/roster-gov/cycles/${cycleId}/generation-runs`)).data ?? [],
  });
  const decisionAudit = useQuery({
    queryKey: ["decision-audit", auditRunId],
    enabled: !!auditRunId,
    queryFn: async () => (await hrmsApi.get<{ rows: DecisionAuditRow[]; total: number }>(`/api/roster-gov/runs/${auditRunId}/decision-audit?page=1&limit=200`)).rows ?? [],
  });

  const generateMutation = useMutation({
    mutationFn: (cid: string) => hrmsApi.post<{ data: GenerationRun }>(`/api/roster-gov/cycles/${cid}/generate`, {}),
    onSuccess: () => {
      setNotice("Roster generation started. Check run history for results.");
      setShowRunHistory(true);
      void qc.invalidateQueries({ queryKey: ["generation-runs", cycleId] });
    },
    onError: (err: Error) => setNotice(err.message ?? "Generation failed."),
  });

  const selected = (cycles.data ?? []).find((c) => c.id === cycleId);

  useEffect(() => {
    if (!processId && actualProcess.data?.process_id) {
      setProcessId(actualProcess.data.process_id);
    } else if (!processId && actualProcess.isSuccess && processes.data?.length) {
      setProcessId(processes.data[0].id);
    }
  }, [actualProcess.data?.process_id, actualProcess.isSuccess, processId, processes.data]);

  async function run(task: () => Promise<void>, success: string) {
    setNotice("");
    try { await task(); setNotice(success); } catch (error: any) { setNotice(error.message ?? "Action failed"); }
  }

  return <DashboardLayout><div className="space-y-6">
    <header className="rounded-3xl bg-slate-950 p-6 text-white">
      <p className="text-xs font-black uppercase tracking-[.22em] text-blue-300">WFM · Roster Governance</p>
      <h1 className="mt-2 text-3xl font-black">Weekly Roster & Shift Control</h1>
      <p className="mt-2 text-sm text-slate-300">Process Manager and WFM jointly own draft-to-publish planning in their mapped process. TL/AM manage exceptions, not published roster truth.</p>
    </header>
    {notice && <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm font-semibold text-blue-800">{notice}</div>}
    <section className="rounded-3xl border bg-white p-5">
      <label className="text-sm font-bold">Authorised Process<select value={processId} onChange={(e) => { setProcessId(e.target.value); setCycleId(""); }} className="mt-2 block w-full rounded-xl border bg-white p-3 text-slate-900"><option value="">Select process</option>{(processes.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.process_name ?? p.process_code ?? p.id}</option>)}</select></label>
    </section>
    {processId && <>
      <Panel title="Actual Roster Records" hint="Live assignments saved in wfm_roster_assignment for the selected process.">
        {actualAssignments.isLoading ? (
          <p className="text-sm text-slate-500">Loading roster records...</p>
        ) : actualAssignments.error ? (
          <p className="rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-700">
            {(actualAssignments.error as Error).message}
          </p>
        ) : (actualAssignments.data ?? []).length === 0 ? (
          <p className="rounded-xl bg-amber-50 p-3 text-sm font-semibold text-amber-800">
            No roster assignments are stored for this process yet.
          </p>
        ) : (
          <div className="max-h-[420px] overflow-auto rounded-2xl border">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="sticky top-0 bg-slate-50 text-left text-slate-600">
                <tr><th className="p-3">Employee</th><th>Date</th><th>Shift</th><th>Timing</th><th>Branch</th><th>Status</th><th>Publish</th></tr>
              </thead>
              <tbody>
                {(actualAssignments.data ?? []).map((row) => (
                  <tr key={row.id} className="border-t">
                    <td className="p-3"><b>{row.employee_name || row.employee_code}</b><div className="text-xs text-slate-500">{row.employee_code}</div></td>
                    <td>{row.roster_date}</td>
                    <td>{row.shift_name || row.shift_code || "Assigned shift"}</td>
                    <td>{[row.shift_start_time, row.shift_end_time].filter(Boolean).join(" - ") || "Not set"}</td>
                    <td>{row.branch_name || "Not set"}</td>
                    <td>{row.roster_status}</td>
                    <td className="capitalize">{row.publish_status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title="Shift Template" hint="Mapped WFM/Admin creates process shift versions.">
          <div className="grid gap-2 sm:grid-cols-2"><Field label="Code" value={shift.code} set={(v) => setShift({ ...shift, code: v })}/><Field label="Name" value={shift.name} set={(v) => setShift({ ...shift, name: v })}/><Field label="Start" type="time" value={shift.start} set={(v) => setShift({ ...shift, start: v })}/><Field label="End" type="time" value={shift.end} set={(v) => setShift({ ...shift, end: v })}/></div>
          <button className="mt-3 rounded-xl bg-slate-950 px-4 py-3 text-sm font-bold text-white" onClick={() => run(async () => { await hrmsApi.post("/api/roster-gov/shifts/templates", { process_id: processId, shift_code: shift.code, shift_name: shift.name, start_time: shift.start, end_time: shift.end, effective_from: today }); await qc.invalidateQueries({ queryKey: ["gov-shifts", processId] }); }, "Shift template created.")}>Save Shift</button>
          <div className="mt-3 space-y-2">{(shifts.data ?? []).map((s) => <div key={s.id} className="rounded-xl border p-3 text-sm"><b>{s.shift_code}</b> · {s.shift_name}<span className="float-right text-slate-500">{s.start_time}–{s.end_time}</span></div>)}</div>
        </Panel>
        <Panel title="Weekly Cycle" hint="Mapped Process Manager/WFM creates and publishes.">
          <div className="grid gap-2 sm:grid-cols-3"><Field label="Start" type="date" value={cycle.start} set={(v) => setCycle({ ...cycle, start: v })}/><Field label="End" type="date" value={cycle.end} set={(v) => setCycle({ ...cycle, end: v })}/><Field label="Required HC" type="number" value={cycle.hc} set={(v) => setCycle({ ...cycle, hc: v })}/></div>
          <button className="mt-3 rounded-xl bg-blue-700 px-4 py-3 text-sm font-bold text-white" onClick={() => run(async () => { const r = await hrmsApi.post<{ data: Cycle }>("/api/roster-gov/cycles", { process_id: processId, week_start_date: cycle.start, week_end_date: cycle.end, required_hc_json: { weekly_required_hc: Number(cycle.hc || 0) } }); setCycleId(r.data.id); await qc.invalidateQueries({ queryKey: ["gov-cycles", processId] }); }, "Draft cycle created.")}>Create Draft Cycle</button>
          <div className="mt-3 space-y-2">{(cycles.data ?? []).map((c) => <button key={c.id} onClick={() => setCycleId(c.id)} className={`block w-full rounded-xl border p-3 text-left text-sm ${cycleId === c.id ? "bg-blue-50 border-blue-400" : ""}`}><b>{c.week_start_date} – {c.week_end_date}</b><span className="float-right capitalize">{c.status.replaceAll("_", " ")}</span></button>)}</div>
        </Panel>
      </div>
      {selected && <>
        <Panel title={`Selected Cycle · ${selected.status.replaceAll("_", " ")}`} hint="Published roster assignments cannot be overwritten without recorded change control.">
          <div className="flex flex-wrap gap-3">
            {next[selected.status] && <button className="rounded-xl bg-emerald-700 px-4 py-3 text-sm font-bold text-white" onClick={() => run(async () => { await hrmsApi.post(`/api/roster-gov/cycles/${cycleId}/status`, { status: next[selected.status] }); await qc.invalidateQueries({ queryKey: ["gov-cycles", processId] }); }, `Roster moved to ${next[selected.status]}.`)}>Advance to {next[selected.status].replaceAll("_", " ")}</button>}
            {(selected.status === "draft" || selected.status === "submitted") && (
              <button
                disabled={generateMutation.isPending}
                onClick={() => generateMutation.mutate(cycleId)}
                className="flex items-center gap-2 rounded-xl bg-violet-700 px-4 py-3 text-sm font-bold text-white disabled:opacity-60 hover:bg-violet-800"
              >
                {generateMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                Generate Roster
              </button>
            )}
            <button
              onClick={() => { setShowRunHistory((p) => !p); setAuditRunId(null); }}
              className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50"
            >
              {showRunHistory ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              Run History
            </button>
          </div>

          {showRunHistory && (
            <div className="mt-4 space-y-3">
              <h3 className="text-sm font-bold text-slate-700">Generation Runs</h3>
              {generationRuns.isLoading ? (
                <p className="text-sm text-slate-500">Loading...</p>
              ) : (generationRuns.data ?? []).length === 0 ? (
                <p className="rounded-xl bg-slate-50 border p-3 text-sm text-slate-500">No runs yet for this cycle.</p>
              ) : (
                <div className="overflow-x-auto rounded-2xl border">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-left text-xs font-black uppercase tracking-wider text-slate-500">
                      <tr>
                        <th className="px-3 py-2">Started</th>
                        <th className="px-3 py-2">Type</th>
                        <th className="px-3 py-2">Status</th>
                        <th className="px-3 py-2">Employees</th>
                        <th className="px-3 py-2">Assignments</th>
                        <th className="px-3 py-2">Week-offs</th>
                        <th className="px-3 py-2">Conflicts</th>
                        <th className="px-3 py-2">Audit</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {(generationRuns.data ?? []).map((r) => (
                        <tr key={r.id} className={`hover:bg-slate-50 ${auditRunId === r.id ? "bg-violet-50" : ""}`}>
                          <td className="px-3 py-2 text-slate-700 whitespace-nowrap">{r.started_at ? new Date(r.started_at).toLocaleString("en-IN") : "—"}</td>
                          <td className="px-3 py-2 capitalize">{r.run_type.replace("_", " ")}</td>
                          <td className="px-3 py-2">
                            <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${r.status === "completed" ? "bg-emerald-100 text-emerald-700" : r.status === "running" ? "bg-blue-100 text-blue-700" : "bg-rose-100 text-rose-700"}`}>
                              {r.status}
                            </span>
                            {r.error_details?.message && <p className="mt-0.5 text-xs text-rose-600">{r.error_details.message}</p>}
                          </td>
                          <td className="px-3 py-2 text-slate-700">{r.employees_processed ?? 0}</td>
                          <td className="px-3 py-2 text-slate-700">{r.assignments_created ?? 0}</td>
                          <td className="px-3 py-2 text-slate-700">{r.weekoffs_allocated ?? 0}</td>
                          <td className="px-3 py-2 text-slate-700">{r.conflicts_found ?? 0}</td>
                          <td className="px-3 py-2">
                            <button
                              onClick={() => setAuditRunId((prev) => prev === r.id ? null : r.id)}
                              className="flex items-center gap-1 rounded-lg bg-slate-900 px-2 py-1 text-xs font-bold text-white hover:bg-slate-700"
                            >
                              {auditRunId === r.id ? <X className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                              {auditRunId === r.id ? "Close" : "View"}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {auditRunId && (
                <div className="mt-3 rounded-2xl border bg-violet-50 p-4">
                  <h4 className="mb-3 text-sm font-black text-violet-800">Decision Audit — Run {auditRunId.slice(0, 8)}…</h4>
                  {decisionAudit.isLoading ? (
                    <p className="text-sm text-slate-500">Loading audit rows…</p>
                  ) : (decisionAudit.data ?? []).length === 0 ? (
                    <p className="text-sm text-slate-500">No audit rows found.</p>
                  ) : (
                    <div className="max-h-96 overflow-auto rounded-2xl border bg-white">
                      <table className="w-full text-xs">
                        <thead className="sticky top-0 bg-slate-50 text-left font-black uppercase tracking-wider text-slate-500">
                          <tr>
                            <th className="px-3 py-2">Employee</th>
                            <th className="px-3 py-2">Date</th>
                            <th className="px-3 py-2">Decision</th>
                            <th className="px-3 py-2">Week-off</th>
                            <th className="px-3 py-2">Pref Day</th>
                            <th className="px-3 py-2">Alloc Day</th>
                            <th className="px-3 py-2">Rule</th>
                            <th className="px-3 py-2">Override By</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {(decisionAudit.data ?? []).map((row) => (
                            <tr key={row.id} className="hover:bg-slate-50">
                              <td className="px-3 py-1.5 font-medium text-slate-900">{row.first_name} {row.last_name}<div className="text-slate-500">{row.employee_code}</div></td>
                              <td className="px-3 py-1.5 text-slate-700 whitespace-nowrap">{row.roster_date}</td>
                              <td className="px-3 py-1.5 capitalize">{row.decision_type.replace("_", " ")}</td>
                              <td className="px-3 py-1.5">{row.is_week_off ? <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-amber-700 font-bold">WO</span> : "—"}</td>
                              <td className="px-3 py-1.5 text-slate-500">{row.preferred_day ?? "—"}</td>
                              <td className="px-3 py-1.5 text-slate-500">{row.allocated_day ?? "—"}</td>
                              <td className="px-3 py-1.5 text-slate-500 max-w-[160px] truncate" title={row.rule_applied ?? ""}>{row.rule_applied ?? "—"}</td>
                              <td className="px-3 py-1.5 text-slate-500">{row.override_by ?? "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </Panel>
        <div className="grid gap-5 xl:grid-cols-2">
          <Panel title="Draft Allocations" hint="JSON import until grid editor is added; validated against process and active shift.">
            <textarea className="w-full rounded-xl border p-3 font-mono text-xs" rows={6} value={rowsJson} onChange={(e) => setRowsJson(e.target.value)} />
            <button className="mt-3 rounded-xl bg-slate-950 px-4 py-3 text-sm font-bold text-white" onClick={() => run(async () => { await hrmsApi.post(`/api/roster-gov/cycles/${cycleId}/assignments/bulk`, { assignments: JSON.parse(rowsJson) }); await qc.invalidateQueries({ queryKey: ["gov-rows", cycleId] }); }, "Assignments validated and saved.")}>Save Assignments</button>
          </Panel>
          <Panel title="Coverage Accountability" hint="TL/AM can raise or close scoped recovery actions without changing roster truth.">
            <div className="grid gap-2 sm:grid-cols-2"><Field label="Date" type="date" value={action.date} set={(v) => setAction({ ...action, date: v })}/><Field label="Gap HC" type="number" value={action.gap} set={(v) => setAction({ ...action, gap: v })}/><Field label="Root Cause" value={action.cause} set={(v) => setAction({ ...action, cause: v })}/><Field label="Recovery Plan" value={action.plan} set={(v) => setAction({ ...action, plan: v })}/></div>
            <button className="mt-3 rounded-xl bg-amber-600 px-4 py-3 text-sm font-bold text-white" onClick={() => run(async () => { await hrmsApi.post("/api/roster-gov/coverage-actions", { cycle_id: cycleId, action_date: action.date, coverage_gap: Number(action.gap || 0), root_cause: action.cause, recovery_plan: action.plan }); }, "Coverage action raised.")}>Raise Action</button>
          </Panel>
        </div>
        <Panel title="Roster Assignments" hint="Acknowledgement is captured employee-wise after publication."><table className="w-full text-sm"><thead><tr className="border-b text-left text-slate-500"><th className="p-2">Employee</th><th>Date</th><th>Shift</th><th>WO</th><th>Acknowledgement</th></tr></thead><tbody>{(assignments.data ?? []).map((r) => <tr className="border-b" key={r.id}><td className="p-2">{r.employee_id}</td><td>{r.roster_date}</td><td>{r.shift_template_id ?? "—"}</td><td>{r.is_week_off ? "Yes" : "No"}</td><td className="capitalize">{r.acknowledgement_status}</td></tr>)}</tbody></table></Panel>
      </>}
    </>}
  </div></DashboardLayout>;
}
function Panel({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) { return <section className="rounded-3xl border bg-white p-5 shadow-sm"><h2 className="text-lg font-black">{title}</h2><p className="mb-4 mt-1 text-sm text-slate-500">{hint}</p>{children}</section>; }
function Field({ label, value, set, type = "text" }: { label: string; value: string; set: (v: string) => void; type?: string }) { return <label className="text-xs font-bold uppercase text-slate-500">{label}<input className="mt-1 block w-full rounded-xl border p-3 text-sm text-slate-900" type={type} value={value} onChange={(e) => set(e.target.value)} /></label>; }
