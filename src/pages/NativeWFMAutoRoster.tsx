import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Bell,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  Database,
  Lock,
  Play,
  RefreshCcw,
  Send,
  ShieldCheck,
  Users,
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";

type AnyRow = Record<string, any>;

type ApiResponse<T> = { success: boolean; data: T; message?: string };

const todayIso = () => new Date().toISOString().slice(0, 10);

function addDaysIso(days: number) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function Stat({ title, value, sub, icon }: { title: string; value: string | number; sub?: string; icon: React.ReactNode }) {
  return (
    <div className="rounded-3xl border bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-slate-500">{title}</p>
          <p className="mt-2 text-3xl font-black tracking-tight text-slate-950">{value}</p>
          {sub && <p className="mt-1 text-xs font-semibold text-slate-400">{sub}</p>}
        </div>
        <div className="rounded-2xl bg-slate-100 p-3 text-slate-700">{icon}</div>
      </div>
    </div>
  );
}

function Pill({ children, tone = "slate" }: { children: React.ReactNode; tone?: "slate" | "green" | "amber" | "red" | "blue" }) {
  const cls = {
    slate: "bg-slate-100 text-slate-700",
    green: "bg-emerald-50 text-emerald-700",
    amber: "bg-amber-50 text-amber-700",
    red: "bg-red-50 text-red-700",
    blue: "bg-blue-50 text-blue-700",
  }[tone];
  return <span className={`rounded-full px-2.5 py-1 text-xs font-black ${cls}`}>{children}</span>;
}

export default function NativeWFMAutoRoster() {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [tab, setTab] = useState("planner");

  const [masters, setMasters] = useState<{ processes: AnyRow[]; branches: AnyRow[]; shifts: AnyRow[] }>({ processes: [], branches: [], shifts: [] });
  const [introspection, setIntrospection] = useState<AnyRow[]>([]);
  const [plans, setPlans] = useState<AnyRow[]>([]);
  const [requirements, setRequirements] = useState<AnyRow[]>([]);
  const [assignments, setAssignments] = useState<AnyRow[]>([]);
  const [coverage, setCoverage] = useState<AnyRow[]>([]);
  const [conflicts, setConflicts] = useState<AnyRow[]>([]);
  const [events, setEvents] = useState<AnyRow[]>([]);
  const [approvalLog, setApprovalLog] = useState<AnyRow[]>([]);
  const [changeRequests, setChangeRequests] = useState<AnyRow[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState("");

  const [planForm, setPlanForm] = useState({
    plan_name: `Auto Roster ${todayIso()}`,
    process_id: "",
    branch_id: "",
    from_date: todayIso(),
    to_date: addDaysIso(6),
    shrinkage_pct: 15,
  });

  const [reqForm, setReqForm] = useState({
    process_id: "",
    branch_id: "",
    requirement_date: "",
    day_of_week: "1",
    slot_start: "09:00",
    slot_end: "18:00",
    required_hc: 10,
    shrinkage_pct: 15,
  });

  const [changeForm, setChangeForm] = useState({
    assignment_id: "",
    new_shift_start_time: "09:00",
    new_shift_end_time: "18:00",
    new_roster_status: "Rostered",
    change_category: "shift_change",
    change_reason: "",
  });

  const selectedPlan = useMemo(() => plans.find((p) => p.id === selectedPlanId), [plans, selectedPlanId]);

  const loadBase = async () => {
    setLoading(true);
    setMessage("");
    try {
      const [meta, masterRes, planRes, reqRes, eventRes] = await Promise.all([
        hrmsApi.get<ApiResponse<{ tables: AnyRow[] }>>("/api/wfm/auto-roster/introspect"),
        hrmsApi.get<ApiResponse<{ processes: AnyRow[]; branches: AnyRow[]; shifts: AnyRow[] }>>("/api/wfm/auto-roster/masters"),
        hrmsApi.get<ApiResponse<AnyRow[]>>("/api/wfm/auto-roster/plans"),
        hrmsApi.get<ApiResponse<AnyRow[]>>("/api/wfm/auto-roster/requirements"),
        hrmsApi.get<ApiResponse<AnyRow[]>>("/api/wfm/auto-roster/events"),
      ]);
      setIntrospection(meta.data.tables || []);
      setMasters(masterRes.data);
      setPlans(planRes.data || []);
      setRequirements(reqRes.data || []);
      setEvents(eventRes.data || []);
      if (!selectedPlanId && planRes.data?.[0]?.id) setSelectedPlanId(planRes.data[0].id);
    } catch (err: any) {
      setMessage(err.message || "Unable to load Auto Roster data.");
    } finally {
      setLoading(false);
    }
  };

  const loadPlanDetails = async (planId: string) => {
    if (!planId) return;
    setLoading(true);
    setMessage("");
    try {
      const [a, c, f, e, l, cr] = await Promise.all([
        hrmsApi.get<ApiResponse<AnyRow[]>>(`/api/wfm/auto-roster/plans/${planId}/assignments`),
        hrmsApi.get<ApiResponse<AnyRow[]>>(`/api/wfm/auto-roster/plans/${planId}/coverage`),
        hrmsApi.get<ApiResponse<AnyRow[]>>(`/api/wfm/auto-roster/plans/${planId}/conflicts`),
        hrmsApi.get<ApiResponse<AnyRow[]>>(`/api/wfm/auto-roster/plans/${planId}/events`),
        hrmsApi.get<ApiResponse<AnyRow[]>>(`/api/wfm/auto-roster/plans/${planId}/approval-log`),
        hrmsApi.get<ApiResponse<AnyRow[]>>(`/api/wfm/auto-roster/plans/${planId}/change-requests`),
      ]);
      setAssignments(a.data || []);
      setCoverage(c.data || []);
      setConflicts(f.data || []);
      setEvents(e.data || []);
      setApprovalLog(l.data || []);
      setChangeRequests(cr.data || []);
    } catch (err: any) {
      setMessage(err.message || "Unable to load selected plan details.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadBase(); }, []);
  useEffect(() => { void loadPlanDetails(selectedPlanId); }, [selectedPlanId]);

  const createRequirement = async () => {
    setLoading(true);
    setMessage("");
    try {
      await hrmsApi.post("/api/wfm/auto-roster/requirements", {
        ...reqForm,
        process_id: reqForm.process_id || null,
        branch_id: reqForm.branch_id || null,
        requirement_date: reqForm.requirement_date || null,
        day_of_week: reqForm.requirement_date ? null : Number(reqForm.day_of_week),
        required_hc: Number(reqForm.required_hc),
        shrinkage_pct: Number(reqForm.shrinkage_pct),
      });
      setMessage("Slot requirement saved.");
      await loadBase();
    } catch (err: any) {
      setMessage(err.message || "Requirement save failed.");
    } finally {
      setLoading(false);
    }
  };

  const createPlan = async () => {
    setLoading(true);
    setMessage("");
    try {
      const res = await hrmsApi.post<ApiResponse<AnyRow>>("/api/wfm/auto-roster/plans", {
        ...planForm,
        process_id: planForm.process_id || null,
        branch_id: planForm.branch_id || null,
        shrinkage_pct: Number(planForm.shrinkage_pct),
      });
      setSelectedPlanId(res.data.id);
      setMessage("Auto roster plan created using existing wfm_roster_plan table.");
      await loadBase();
    } catch (err: any) {
      setMessage(err.message || "Plan creation failed.");
    } finally {
      setLoading(false);
    }
  };

  const planAction = async (action: "generate" | "submit" | "approve" | "publish" | "queue-manager-tasks") => {
    if (!selectedPlanId) return setMessage("Select a plan first.");
    setLoading(true);
    setMessage("");
    try {
      const body = action === "approve" ? { remarks: "Approved from Auto Roster Builder" } : {};
      const res = await hrmsApi.post<ApiResponse<AnyRow>>(`/api/wfm/auto-roster/plans/${selectedPlanId}/${action}`, body);
      setMessage(res.message || `${action} completed.`);
      await loadBase();
      await loadPlanDetails(selectedPlanId);
    } catch (err: any) {
      setMessage(err.message || `${action} failed.`);
    } finally {
      setLoading(false);
    }
  };

  const rejectPlan = async () => {
    if (!selectedPlanId) return setMessage("Select a plan first.");
    const remarks = prompt("Enter rejection remarks for WFM:");
    if (!remarks) return;
    setLoading(true);
    try {
      await hrmsApi.post(`/api/wfm/auto-roster/plans/${selectedPlanId}/reject`, { remarks });
      setMessage("Plan rejected and returned to WFM.");
      await loadBase();
      await loadPlanDetails(selectedPlanId);
    } catch (err: any) {
      setMessage(err.message || "Reject failed.");
    } finally {
      setLoading(false);
    }
  };

  const applyPublishedChange = async () => {
    if (!changeForm.assignment_id) return setMessage("Select assignment to change.");
    setLoading(true);
    setMessage("");
    try {
      await hrmsApi.patch(`/api/wfm/auto-roster/assignments/${changeForm.assignment_id}/published-change`, {
        new_shift_start_time: changeForm.new_shift_start_time,
        new_shift_end_time: changeForm.new_shift_end_time,
        new_roster_status: changeForm.new_roster_status,
        change_category: changeForm.change_category,
        change_reason: changeForm.change_reason,
      });
      setMessage("Published roster changed with locked notification and impact recalculation.");
      await loadPlanDetails(selectedPlanId);
    } catch (err: any) {
      setMessage(err.message || "Published roster change failed.");
    } finally {
      setLoading(false);
    }
  };

  const coverageScore = selectedPlan?.last_coverage_score ?? 0;
  const openCritical = conflicts.filter((c) => c.severity === "critical" && c.resolution_status === "open").length;
  const pendingAck = assignments.filter((a) => a.acknowledgement_required && a.acknowledgement_status !== "acknowledged").length;

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-black uppercase tracking-[0.2em] text-blue-600">WFM Auto Roster Builder</p>
            <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-950">Synced Roster Planning & Change Control</h1>
            <p className="mt-2 max-w-5xl text-slate-600">
              Uses existing project tables first: wfm_roster_plan, wfm_roster_assignment, wfm_shift, week_off_preference, process_weekoff_capacity and leave_request.
              New tables are only control/event/coverage extensions for locked notifications and PM-only published roster changes.
            </p>
          </div>
          <button disabled={loading} onClick={loadBase} className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-5 py-3 text-sm font-bold text-white disabled:bg-slate-300">
            <RefreshCcw className="h-4 w-4" /> Refresh
          </button>
        </div>

        {message && <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm font-bold text-blue-800">{message}</div>}

        <div className="grid gap-4 md:grid-cols-4">
          <Stat title="Coverage Score" value={`${coverageScore || 0}%`} sub="from coverage matrix" icon={<ShieldCheck className="h-5 w-5" />} />
          <Stat title="Assignments" value={assignments.length} sub="selected plan" icon={<Users className="h-5 w-5" />} />
          <Stat title="Open Critical Gaps" value={openCritical} sub="publish blocker" icon={<AlertTriangle className="h-5 w-5" />} />
          <Stat title="Pending Acknowledgement" value={pendingAck} sub="after publish/change" icon={<Bell className="h-5 w-5" />} />
        </div>

        <div className="flex flex-wrap gap-2 rounded-3xl border bg-white p-3 shadow-sm">
          {[
            ["planner", "Planner"],
            ["requirements", "Slot Requirements"],
            ["coverage", "Coverage"],
            ["assignments", "Assignments"],
            ["change", "PM Change Control"],
            ["events", "Events"],
            ["sync", "Table Sync Audit"],
          ].map(([k, label]) => (
            <button key={k} onClick={() => setTab(k)} className={`rounded-2xl px-4 py-2 text-sm font-black ${tab === k ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-700"}`}>{label}</button>
          ))}
        </div>

        <div className="rounded-3xl border bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="font-black text-slate-950">Selected roster cycle</h2>
              <p className="text-sm text-slate-500">Process Manager owns approval, publish and all post-publish changes.</p>
            </div>
            <select value={selectedPlanId} onChange={(e) => setSelectedPlanId(e.target.value)} className="rounded-2xl border px-4 py-3 text-sm">
              <option value="">Select plan</option>
              {plans.map((p) => <option key={p.id} value={p.id}>{p.plan_name} · {p.from_date?.slice(0, 10)} to {p.to_date?.slice(0, 10)} · {p.approval_status || p.plan_status}</option>)}
            </select>
          </div>
          {selectedPlan && (
            <div className="mt-4 flex flex-wrap gap-2">
              <Pill tone="blue">{selectedPlan.approval_status || selectedPlan.plan_status}</Pill>
              <Pill tone={selectedPlan.publish_lock_status === "published_locked" ? "red" : "slate"}>{selectedPlan.publish_lock_status || "unlocked"}</Pill>
              <Pill tone="green">Shrinkage {selectedPlan.shrinkage_pct || 0}%</Pill>
            </div>
          )}
        </div>

        {tab === "planner" && (
          <div className="grid gap-5 xl:grid-cols-2">
            <div className="rounded-3xl border bg-white p-5 shadow-sm">
              <h2 className="font-black text-slate-950">Create synced auto roster cycle</h2>
              <div className="mt-4 grid gap-3">
                <input value={planForm.plan_name} onChange={(e) => setPlanForm({ ...planForm, plan_name: e.target.value })} className="rounded-2xl border px-4 py-3" placeholder="Plan name" />
                <select value={planForm.process_id} onChange={(e) => setPlanForm({ ...planForm, process_id: e.target.value })} className="rounded-2xl border px-4 py-3">
                  <option value="">All / select process</option>
                  {masters.processes.map((p) => <option key={p.id ?? p.process_name} value={p.id ?? ""}>{p.process_name}</option>)}
                </select>
                <select value={planForm.branch_id} onChange={(e) => setPlanForm({ ...planForm, branch_id: e.target.value })} className="rounded-2xl border px-4 py-3">
                  <option value="">All / select branch</option>
                  {masters.branches.map((b) => <option key={b.id ?? b.branch_name} value={b.id ?? ""}>{b.branch_name}</option>)}
                </select>
                <div className="grid gap-3 md:grid-cols-3">
                  <input type="date" value={planForm.from_date} onChange={(e) => setPlanForm({ ...planForm, from_date: e.target.value })} className="rounded-2xl border px-4 py-3" />
                  <input type="date" value={planForm.to_date} onChange={(e) => setPlanForm({ ...planForm, to_date: e.target.value })} className="rounded-2xl border px-4 py-3" />
                  <input type="number" value={planForm.shrinkage_pct} onChange={(e) => setPlanForm({ ...planForm, shrinkage_pct: Number(e.target.value) })} className="rounded-2xl border px-4 py-3" placeholder="Shrinkage %" />
                </div>
                <button disabled={loading} onClick={createPlan} className="rounded-2xl bg-slate-950 px-5 py-3 font-bold text-white disabled:bg-slate-300">Create Cycle</button>
              </div>
            </div>

            <div className="rounded-3xl border bg-white p-5 shadow-sm">
              <h2 className="font-black text-slate-950">Generation → PM approval → locked publish</h2>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <button disabled={loading || !selectedPlanId} onClick={() => planAction("generate")} className="inline-flex items-center justify-center gap-2 rounded-2xl bg-blue-600 px-5 py-3 font-bold text-white disabled:bg-slate-300"><Play className="h-4 w-4" /> Generate Draft</button>
                <button disabled={loading || !selectedPlanId} onClick={() => planAction("submit")} className="inline-flex items-center justify-center gap-2 rounded-2xl bg-slate-950 px-5 py-3 font-bold text-white disabled:bg-slate-300"><Send className="h-4 w-4" /> Submit to PM</button>
                <button disabled={loading || !selectedPlanId} onClick={() => planAction("approve")} className="inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-5 py-3 font-bold text-white disabled:bg-slate-300"><CheckCircle2 className="h-4 w-4" /> PM Approve</button>
                <button disabled={loading || !selectedPlanId} onClick={rejectPlan} className="inline-flex items-center justify-center gap-2 rounded-2xl bg-amber-500 px-5 py-3 font-bold text-white disabled:bg-slate-300"><AlertTriangle className="h-4 w-4" /> PM Reject</button>
                <button disabled={loading || !selectedPlanId} onClick={() => planAction("publish")} className="inline-flex items-center justify-center gap-2 rounded-2xl bg-red-600 px-5 py-3 font-bold text-white disabled:bg-slate-300"><Lock className="h-4 w-4" /> PM Publish + Lock</button>
                <button disabled={loading || !selectedPlanId} onClick={() => planAction("queue-manager-tasks")} className="inline-flex items-center justify-center gap-2 rounded-2xl bg-purple-600 px-5 py-3 font-bold text-white disabled:bg-slate-300"><ClipboardList className="h-4 w-4" /> Queue Manager Tasks</button>
              </div>
              <div className="mt-5 rounded-2xl border border-dashed p-4 text-sm text-slate-600">
                WFM can create/generate/submit. Process Manager approves, publishes and controls all published roster changes. Every publish/change creates locked notification rows.
              </div>
            </div>
          </div>
        )}

        {tab === "requirements" && (
          <div className="grid gap-5 xl:grid-cols-2">
            <div className="rounded-3xl border bg-white p-5 shadow-sm">
              <h2 className="font-black text-slate-950">Add client slot requirement</h2>
              <div className="mt-4 grid gap-3">
                <select value={reqForm.process_id} onChange={(e) => setReqForm({ ...reqForm, process_id: e.target.value })} className="rounded-2xl border px-4 py-3">
                  <option value="">All / select process</option>
                  {masters.processes.map((p) => <option key={p.id ?? p.process_name} value={p.id ?? ""}>{p.process_name}</option>)}
                </select>
                <select value={reqForm.branch_id} onChange={(e) => setReqForm({ ...reqForm, branch_id: e.target.value })} className="rounded-2xl border px-4 py-3">
                  <option value="">All / select branch</option>
                  {masters.branches.map((b) => <option key={b.id ?? b.branch_name} value={b.id ?? ""}>{b.branch_name}</option>)}
                </select>
                <div className="grid gap-3 md:grid-cols-2">
                  <input type="date" value={reqForm.requirement_date} onChange={(e) => setReqForm({ ...reqForm, requirement_date: e.target.value })} className="rounded-2xl border px-4 py-3" />
                  <select value={reqForm.day_of_week} onChange={(e) => setReqForm({ ...reqForm, day_of_week: e.target.value })} className="rounded-2xl border px-4 py-3" disabled={!!reqForm.requirement_date}>
                    {["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"].map((d, i) => <option key={d} value={i}>{d}</option>)}
                  </select>
                </div>
                <div className="grid gap-3 md:grid-cols-4">
                  <input type="time" value={reqForm.slot_start} onChange={(e) => setReqForm({ ...reqForm, slot_start: e.target.value })} className="rounded-2xl border px-4 py-3" />
                  <input type="time" value={reqForm.slot_end} onChange={(e) => setReqForm({ ...reqForm, slot_end: e.target.value })} className="rounded-2xl border px-4 py-3" />
                  <input type="number" value={reqForm.required_hc} onChange={(e) => setReqForm({ ...reqForm, required_hc: Number(e.target.value) })} className="rounded-2xl border px-4 py-3" />
                  <input type="number" value={reqForm.shrinkage_pct} onChange={(e) => setReqForm({ ...reqForm, shrinkage_pct: Number(e.target.value) })} className="rounded-2xl border px-4 py-3" />
                </div>
                <button disabled={loading} onClick={createRequirement} className="rounded-2xl bg-slate-950 px-5 py-3 font-bold text-white disabled:bg-slate-300">Save Requirement</button>
              </div>
            </div>
            <div className="rounded-3xl border bg-white p-5 shadow-sm">
              <h2 className="font-black text-slate-950">Current requirements</h2>
              <div className="mt-4 max-h-[460px] overflow-auto">
                <table className="w-full min-w-[760px] text-sm">
                  <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="p-3">Date/Day</th><th className="p-3">Slot</th><th className="p-3">Required</th><th className="p-3">Shrinkage</th></tr></thead>
                  <tbody>{requirements.map((r) => <tr key={r.id} className="border-t"><td className="p-3">{r.requirement_date || ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][r.day_of_week]}</td><td className="p-3">{r.slot_start} - {r.slot_end}</td><td className="p-3 font-bold">{r.required_hc}</td><td className="p-3">{r.shrinkage_pct ?? "Plan default"}%</td></tr>)}</tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {tab === "coverage" && (
          <div className="grid gap-5 xl:grid-cols-2">
            <div className="rounded-3xl border bg-white p-5 shadow-sm">
              <h2 className="font-black text-slate-950">Coverage matrix</h2>
              <div className="mt-4 max-h-[540px] overflow-auto">
                <table className="w-full min-w-[900px] text-sm">
                  <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="p-3">Date</th><th className="p-3">Slot</th><th className="p-3">Required</th><th className="p-3">Planned</th><th className="p-3">Buffer</th><th className="p-3">Gap</th><th className="p-3">Coverage</th></tr></thead>
                  <tbody>{coverage.map((c) => <tr key={c.id} className="border-t"><td className="p-3">{c.roster_date}</td><td className="p-3">{c.slot_start} - {c.slot_end}</td><td className="p-3">{c.required_hc}</td><td className="p-3">{c.planned_hc}</td><td className="p-3">{c.buffer_hc}</td><td className="p-3 font-bold">{c.gap_hc}</td><td className="p-3">{c.coverage_pct}%</td></tr>)}</tbody>
                </table>
              </div>
            </div>
            <div className="rounded-3xl border bg-white p-5 shadow-sm">
              <h2 className="font-black text-slate-950">Conflict center</h2>
              <div className="mt-4 max-h-[540px] space-y-2 overflow-auto">
                {conflicts.length ? conflicts.map((c) => <div key={c.id} className="rounded-2xl border p-3"><div className="flex items-center justify-between gap-3"><b>{c.conflict_type}</b><Pill tone={c.severity === "critical" ? "red" : c.severity === "high" ? "amber" : "slate"}>{c.severity}</Pill></div><p className="mt-1 text-sm text-slate-600">{c.message}</p></div>) : <div className="rounded-2xl border border-dashed p-8 text-center text-sm text-slate-500">No conflicts loaded.</div>}
              </div>
            </div>
          </div>
        )}

        {tab === "assignments" && (
          <div className="rounded-3xl border bg-white p-5 shadow-sm">
            <h2 className="font-black text-slate-950">Roster assignments using existing wfm_roster_assignment</h2>
            <div className="mt-4 overflow-auto">
              <table className="w-full min-w-[1100px] text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="p-3">Employee</th><th className="p-3">Date</th><th className="p-3">Status</th><th className="p-3">Shift</th><th className="p-3">Publish</th><th className="p-3">Lock</th><th className="p-3">Ack</th></tr></thead>
                <tbody>{assignments.map((a) => <tr key={a.id} className="border-t"><td className="p-3"><b>{a.employee_code || a.employee_id}</b><p className="text-xs text-slate-500">{a.employee_name}</p></td><td className="p-3">{a.roster_date}</td><td className="p-3">{a.roster_status}</td><td className="p-3">{a.shift_start_time || "-"} - {a.shift_end_time || "-"}</td><td className="p-3">{a.publish_status}</td><td className="p-3">{a.change_lock_status}</td><td className="p-3">{a.acknowledgement_status || "-"}</td></tr>)}</tbody>
              </table>
            </div>
          </div>
        )}

        {tab === "change" && (
          <div className="grid gap-5 xl:grid-cols-2">
            <div className="rounded-3xl border bg-white p-5 shadow-sm">
              <h2 className="font-black text-slate-950">Process Manager-only published roster change</h2>
              <p className="mt-1 text-sm text-slate-500">This works only after publish. Reason is mandatory. Notification is locked and impact is recalculated.</p>
              <div className="mt-4 grid gap-3">
                <select value={changeForm.assignment_id} onChange={(e) => setChangeForm({ ...changeForm, assignment_id: e.target.value })} className="rounded-2xl border px-4 py-3">
                  <option value="">Select assignment</option>
                  {assignments.map((a) => <option key={a.id} value={a.id}>{a.roster_date} · {a.employee_code || a.employee_id} · {a.roster_status}</option>)}
                </select>
                <div className="grid gap-3 md:grid-cols-3">
                  <input type="time" value={changeForm.new_shift_start_time} onChange={(e) => setChangeForm({ ...changeForm, new_shift_start_time: e.target.value })} className="rounded-2xl border px-4 py-3" />
                  <input type="time" value={changeForm.new_shift_end_time} onChange={(e) => setChangeForm({ ...changeForm, new_shift_end_time: e.target.value })} className="rounded-2xl border px-4 py-3" />
                  <select value={changeForm.new_roster_status} onChange={(e) => setChangeForm({ ...changeForm, new_roster_status: e.target.value })} className="rounded-2xl border px-4 py-3"><option>Rostered</option><option>Week Off</option><option>Leave</option><option>Training</option></select>
                </div>
                <select value={changeForm.change_category} onChange={(e) => setChangeForm({ ...changeForm, change_category: e.target.value })} className="rounded-2xl border px-4 py-3">
                  <option value="shift_change">Shift change</option>
                  <option value="weekoff_change">Week-off change</option>
                  <option value="leave_adjustment">Leave adjustment</option>
                  <option value="emergency">Emergency</option>
                  <option value="support_staff_update">Support staff update</option>
                </select>
                <textarea value={changeForm.change_reason} onChange={(e) => setChangeForm({ ...changeForm, change_reason: e.target.value })} className="min-h-28 rounded-2xl border px-4 py-3" placeholder="Mandatory change reason" />
                <button disabled={loading} onClick={applyPublishedChange} className="rounded-2xl bg-red-600 px-5 py-3 font-bold text-white disabled:bg-slate-300">Apply PM Change + Lock Notification</button>
              </div>
            </div>
            <div className="rounded-3xl border bg-white p-5 shadow-sm">
              <h2 className="font-black text-slate-950">Change request audit</h2>
              <div className="mt-4 max-h-[520px] space-y-2 overflow-auto">
                {changeRequests.map((c) => <div key={c.id} className="rounded-2xl border p-3"><div className="flex justify-between gap-3"><b>{c.change_category}</b><Pill tone="red">notification locked</Pill></div><p className="mt-1 text-sm text-slate-600">{c.change_reason}</p><p className="mt-1 text-xs text-slate-400">{c.created_at}</p></div>)}
              </div>
            </div>
          </div>
        )}

        {tab === "events" && (
          <div className="grid gap-5 xl:grid-cols-2">
            <div className="rounded-3xl border bg-white p-5 shadow-sm">
              <h2 className="font-black text-slate-950">Real-time event feed</h2>
              <div className="mt-4 max-h-[520px] space-y-2 overflow-auto">{events.map((e) => <div key={e.id} className="rounded-2xl border p-3"><div className="flex justify-between gap-3"><b>{e.event_title}</b><Pill tone={e.severity === "critical" ? "red" : e.severity === "high" ? "amber" : "blue"}>{e.severity}</Pill></div><p className="mt-1 text-sm text-slate-600">{e.event_message}</p><p className="mt-1 text-xs text-slate-400">{e.created_at}</p></div>)}</div>
            </div>
            <div className="rounded-3xl border bg-white p-5 shadow-sm">
              <h2 className="font-black text-slate-950">Approval log</h2>
              <div className="mt-4 max-h-[520px] space-y-2 overflow-auto">{approvalLog.map((a) => <div key={a.id} className="rounded-2xl border p-3"><b>{a.action}</b><p className="mt-1 text-sm text-slate-600">{a.remarks}</p><p className="mt-1 text-xs text-slate-400">{a.created_at}</p></div>)}</div>
            </div>
          </div>
        )}

        {tab === "sync" && (
          <div className="rounded-3xl border bg-white p-5 shadow-sm">
            <h2 className="flex items-center gap-2 font-black text-slate-950"><Database className="h-5 w-5" /> Table sync audit</h2>
            <p className="mt-1 text-sm text-slate-500">Existing tables are reused. New tables are only control, event, coverage and lock layers.</p>
            <div className="mt-4 overflow-auto">
              <table className="w-full min-w-[900px] text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="p-3">Table</th><th className="p-3">Exists</th><th className="p-3">Mode</th><th className="p-3">Columns</th></tr></thead>
                <tbody>{introspection.map((t) => <tr key={t.table} className="border-t"><td className="p-3 font-bold">{t.table}</td><td className="p-3">{t.exists ? <Pill tone="green">Yes</Pill> : <Pill tone="red">No</Pill>}</td><td className="p-3">{t.mode}</td><td className="p-3 text-xs text-slate-500">{(t.columns || []).slice(0, 18).join(", ")}{(t.columns || []).length > 18 ? "..." : ""}</td></tr>)}</tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
