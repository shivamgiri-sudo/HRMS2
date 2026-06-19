import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";

type Process = { id: string; process_name?: string; process_code?: string };
type Shift = { id: string; shift_code: string; shift_name: string; start_time: string; end_time: string; version: number };
type Cycle = { id: string; week_start_date: string; week_end_date: string; status: string };
type Row = { id: string; employee_id: string; roster_date: string; shift_template_id: string | null; is_week_off: number; acknowledgement_status: string };
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
          {next[selected.status] && <button className="rounded-xl bg-emerald-700 px-4 py-3 text-sm font-bold text-white" onClick={() => run(async () => { await hrmsApi.post(`/api/roster-gov/cycles/${cycleId}/status`, { status: next[selected.status] }); await qc.invalidateQueries({ queryKey: ["gov-cycles", processId] }); }, `Roster moved to ${next[selected.status]}.`)}>Advance to {next[selected.status].replaceAll("_", " ")}</button>}
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
