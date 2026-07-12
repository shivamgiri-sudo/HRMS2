import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowRight,
  Bell,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Database,
  Lock,
  Play,
  RefreshCcw,
  RotateCcw,
  Send,
  ShieldCheck,
  Users,
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";
import { formatISTDate } from "@/lib/utils";

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

// ── Rotation Types Badge ───────────────────────────────────────────────────────

const ROTATION_LABELS: Record<string, { label: string; color: string }> = {
  frozen:   { label: "Frozen",   color: "bg-blue-100 text-blue-700" },
  weekly:   { label: "Weekly",   color: "bg-violet-100 text-violet-700" },
  daily:    { label: "Daily",    color: "bg-amber-100 text-amber-700" },
  rotating: { label: "Rotating", color: "bg-emerald-100 text-emerald-700" },
};

export function RotationTypeBadge({ type }: { type: string }) {
  const cfg = ROTATION_LABELS[type] ?? { label: type, color: "bg-slate-100 text-slate-700" };
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold ${cfg.color}`}>
      <RotateCcw className="h-3 w-3" />
      {cfg.label}
    </span>
  );
}

// ── Rotation Types Tab ─────────────────────────────────────────────────────────

function RotationTypesTab({ processId, branchId }: { processId: string; branchId: string }) {
  const qc = useQueryClient();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [newType, setNewType] = useState("frozen");
  const [notice, setNotice] = useState<{ type: "success" | "error"; msg: string } | null>(null);

  const summaryQ = useQuery({
    queryKey: ["rotation-summary", processId, branchId],
    enabled: !!processId,
    queryFn: async () => {
      const params = new URLSearchParams({ processId });
      if (branchId) params.set("branchId", branchId);
      const res = await hrmsApi.get<{ success: boolean; data: { summary: AnyRow[]; employees: AnyRow[] } }>(
        `/api/wfm/rotation-summary?${params}`
      );
      return res.data;
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, shift_rotation_type }: { id: string; shift_rotation_type: string }) =>
      hrmsApi.patch<{ success: boolean }>(`/api/wfm/employees/${id}/shift-rotation`, { shift_rotation_type }),
    onSuccess: () => {
      setEditingId(null);
      setNotice({ type: "success", msg: "Rotation type updated." });
      void qc.invalidateQueries({ queryKey: ["rotation-summary"] });
    },
    onError: (err: Error) => {
      setNotice({ type: "error", msg: err.message ?? "Update failed." });
    },
  });

  if (!processId) {
    return (
      <div className="rounded-3xl border bg-white p-5 shadow-sm text-center text-sm text-slate-400 py-12">
        Select a process in the Planner tab to manage rotation types.
      </div>
    );
  }

  const summary: AnyRow[] = summaryQ.data?.summary ?? [];
  const employees: AnyRow[] = summaryQ.data?.employees ?? [];

  return (
    <div className="rounded-3xl border bg-white p-5 shadow-sm space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="flex items-center gap-2 font-black text-slate-950">
            <RotateCcw className="h-5 w-5" /> Rotation Types
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Controls how the auto-roster engine assigns shifts per employee.
            Frozen = same shift always. Weekly/Daily/Rotating = auto-rotated.
          </p>
        </div>
        <button
          onClick={() => void qc.invalidateQueries({ queryKey: ["rotation-summary"] })}
          className="rounded-xl border p-2 text-slate-500 hover:bg-slate-100"
        >
          <RefreshCcw className="h-4 w-4" />
        </button>
      </div>

      {notice && (
        <div className={`rounded-xl border p-3 text-sm font-semibold ${
          notice.type === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-rose-200 bg-rose-50 text-rose-800"
        }`}>
          {notice.msg}
        </div>
      )}

      {/* Summary row */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {["frozen", "weekly", "daily", "rotating"].map((rt) => {
          const row = summary.find((s: AnyRow) => s.rotation_type === rt);
          return (
            <div key={rt} className="rounded-2xl border bg-slate-50 p-4 text-center">
              <RotationTypeBadge type={rt} />
              <p className="mt-2 text-2xl font-black text-slate-900">{row?.employee_count ?? 0}</p>
              <p className="text-xs text-slate-500">employees</p>
            </div>
          );
        })}
      </div>

      {/* Per-employee table */}
      {summaryQ.isLoading ? (
        <div className="text-center py-8 text-sm text-slate-400">Loading...</div>
      ) : employees.length === 0 ? (
        <div className="text-center py-8 text-sm text-slate-400">No active employees found for this process.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-slate-50 text-xs font-black uppercase tracking-wider text-slate-500 text-left">
                <th className="px-4 py-3">Employee</th>
                <th className="px-4 py-3">Designation</th>
                <th className="px-4 py-3">Rotation Type</th>
                <th className="px-4 py-3">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {employees.map((emp: AnyRow) => (
                <tr key={emp.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <p className="font-bold text-slate-900">{emp.full_name}</p>
                    <p className="text-xs text-slate-500">{emp.employee_code}</p>
                  </td>
                  <td className="px-4 py-3 text-slate-600 text-xs">{emp.designation ?? "—"}</td>
                  <td className="px-4 py-3">
                    {editingId === emp.id ? (
                      <select
                        value={newType}
                        onChange={(e) => setNewType(e.target.value)}
                        className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs focus:border-blue-500 focus:outline-none"
                      >
                        {["frozen", "weekly", "daily", "rotating"].map((rt) => (
                          <option key={rt} value={rt}>{ROTATION_LABELS[rt].label}</option>
                        ))}
                      </select>
                    ) : (
                      <RotationTypeBadge type={emp.shift_rotation_type ?? "frozen"} />
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {editingId === emp.id ? (
                      <div className="flex gap-2">
                        <button
                          disabled={updateMutation.isPending}
                          onClick={() => updateMutation.mutate({ id: emp.id, shift_rotation_type: newType })}
                          className="rounded-xl bg-slate-900 px-3 py-1.5 text-xs font-bold text-white hover:bg-slate-700 disabled:opacity-50"
                        >
                          Save
                        </button>
                        <button
                          onClick={() => setEditingId(null)}
                          className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-100"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => { setEditingId(emp.id); setNewType(emp.shift_rotation_type ?? "frozen"); }}
                        className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-100"
                      >
                        Change
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Planning Rules Embed ──────────────────────────────────────────────────────
function PlanningRulesEmbed({ processId }: { processId: string }) {
  const rulesQ = useQuery({
    queryKey: ["planning-rules-embed", processId],
    enabled: !!processId,
    queryFn: async () => (await hrmsApi.get<{ success: boolean; data: AnyRow[] }>(`/api/wfm/planning-rules?processId=${processId}`)).data ?? [],
  });
  if (!processId) return <p className="text-sm text-slate-400 py-4">Select a process above.</p>;
  if (rulesQ.isLoading) return <div className="flex justify-center py-8"><div className="h-6 w-6 animate-spin rounded-full border-4 border-slate-200 border-t-slate-950" /></div>;
  if (rulesQ.error) return <p className="text-sm text-rose-600">Failed to load planning rules.</p>;
  const rules: AnyRow[] = rulesQ.data ?? [];
  if (!rules.length) return <p className="text-sm text-slate-500 bg-slate-50 rounded-xl p-4">No planning rules configured for this process. <a href="/wfm/planning-rules" className="text-blue-600 underline">Add one →</a></p>;
  return (
    <div className="overflow-x-auto rounded-2xl border">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs font-black uppercase text-slate-500">
          <tr><th className="px-3 py-2">Workload Type</th><th className="px-3 py-2">Effective</th><th className="px-3 py-2">AHT</th><th className="px-3 py-2">Shrinkage</th><th className="px-3 py-2">Key Param</th></tr>
        </thead>
        <tbody className="divide-y">
          {rules.map((r) => (
            <tr key={r.id} className="hover:bg-slate-50">
              <td className="px-3 py-2 capitalize font-semibold">{String(r.workload_type).replace("_", " ")}</td>
              <td className="px-3 py-2 text-slate-600">{r.effective_from}{r.effective_to ? ` → ${r.effective_to}` : " → ongoing"}</td>
              <td className="px-3 py-2">{r.aht_seconds ?? "—"}</td>
              <td className="px-3 py-2">{r.shrinkage_pct ?? 0}%</td>
              <td className="px-3 py-2 text-slate-500 text-xs">{r.dials_per_agent_hour ? `${r.dials_per_agent_hour} dials/hr` : r.chat_concurrency ? `${r.chat_concurrency}× conc` : r.cases_per_agent_hour ? `${r.cases_per_agent_hour} cases/hr` : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Week-Off Rules Embed ──────────────────────────────────────────────────────
function WeekOffRulesEmbed({ processId }: { processId: string }) {
  const gridQ = useQuery({
    queryKey: ["weekoff-rules-embed", processId],
    enabled: !!processId,
    queryFn: async () => {
      const d = new Date(); const day = d.getDay(); const add = day === 1 ? 0 : (8 - day) % 7 || 7;
      d.setDate(d.getDate() + add); const ws = d.toISOString().slice(0, 10);
      const qs = new URLSearchParams({ processId, weekStartDate: ws });
      return (await hrmsApi.get<{ success: boolean; data: AnyRow[] }>(`/api/wfm/weekoff/day-rules/capacity-grid?${qs}`)).data ?? [];
    },
  });
  if (!processId) return <p className="text-sm text-slate-400 py-4">Select a process above.</p>;
  if (gridQ.isLoading) return <div className="flex justify-center py-8"><div className="h-6 w-6 animate-spin rounded-full border-4 border-slate-200 border-t-slate-950" /></div>;
  if (gridQ.error) return <p className="text-sm text-rose-600">Failed to load capacity grid.</p>;
  const grid: AnyRow[] = gridQ.data ?? [];
  if (!grid.length) return <p className="text-sm text-slate-500 bg-slate-50 rounded-xl p-4">No week-off day rules configured. <a href="/wfm/weekoff-day-rules" className="text-blue-600 underline">Configure →</a></p>;
  return (
    <div className="grid grid-cols-7 gap-2">
      {grid.map((g: any) => (
        <div key={g.day_of_week} className={`rounded-2xl border p-3 text-center ${g.is_safe ? "border-emerald-200" : "border-rose-300 bg-rose-50"}`}>
          <div className="text-xs font-black uppercase text-slate-500">{String(g.day_name ?? "").slice(0, 3)}</div>
          <div className={`mt-1 text-lg font-black ${g.is_safe ? "text-emerald-700" : "text-rose-600"}`}>{g.is_safe ? "✓" : "⚠"}</div>
          <div className="mt-1 text-xs text-slate-500">Min: {g.min_hc_required ?? 0}</div>
          <div className="text-xs text-slate-500">WO: {g.current_allocated ?? 0}/{g.max_weekoff_allowed ?? "∞"}</div>
        </div>
      ))}
    </div>
  );
}

// ── Wizard stepper ────────────────────────────────────────────────────────────
const WIZARD_STEPS = [
  { key: "process", label: "Process & Period" },
  { key: "requirements", label: "Slot Requirements" },
  { key: "generate", label: "Generate & Review" },
  { key: "submit", label: "Submit to PM" },
];

function WizardStepper({ activeStep }: { activeStep: number }) {
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {WIZARD_STEPS.map((s, i) => {
        const isDone = i < activeStep;
        const isCurrent = i === activeStep;
        return (
          <div key={s.key} className="flex items-center gap-1">
            <div className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-black
              ${isCurrent ? "bg-blue-600 text-white" : isDone ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-400"}`}>
              {isDone && <CheckCircle2 className="h-3 w-3" />}
              <span>{i + 1}. {s.label}</span>
            </div>
            {i < WIZARD_STEPS.length - 1 && <ChevronRight className="h-3 w-3 text-slate-300 flex-shrink-0" />}
          </div>
        );
      })}
    </div>
  );
}

// ── Status-aware primary action config ───────────────────────────────────────
const NEXT_ACTION: Record<string, { label: string; action: "generate" | "submit" | "approve" | "publish" | "queue-manager-tasks"; tone: string; icon: React.ReactNode }> = {
  draft:     { label: "Generate Draft",           action: "generate",            tone: "bg-blue-600 hover:bg-blue-700",     icon: <Play className="h-4 w-4" /> },
  generated: { label: "Submit to Process Manager", action: "submit",             tone: "bg-slate-900 hover:bg-slate-800",   icon: <Send className="h-4 w-4" /> },
  submitted: { label: "PM: Approve Roster",        action: "approve",            tone: "bg-emerald-600 hover:bg-emerald-700", icon: <CheckCircle2 className="h-4 w-4" /> },
  approved:  { label: "PM: Publish + Lock",        action: "publish",            tone: "bg-red-600 hover:bg-red-700",       icon: <Lock className="h-4 w-4" /> },
  published: { label: "Queue Manager Tasks",       action: "queue-manager-tasks", tone: "bg-purple-600 hover:bg-purple-700", icon: <ClipboardList className="h-4 w-4" /> },
};

// ── Generation progress animation ────────────────────────────────────────────
const GEN_STEPS = ["Fetching employees", "Computing week-offs", "Assigning shifts", "Recomputing coverage", "Finalising…"];

function GenerationProgress({ active }: { active: boolean }) {
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (!active) { setStep(0); return; }
    const t = setInterval(() => setStep((s) => Math.min(s + 1, GEN_STEPS.length - 1)), 900);
    return () => clearInterval(t);
  }, [active]);
  if (!active) return null;
  return (
    <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 space-y-2">
      <p className="text-xs font-black text-blue-700 uppercase tracking-wide">Generating roster…</p>
      <div className="flex flex-wrap gap-2">
        {GEN_STEPS.map((s, i) => (
          <div key={s} className={`flex items-center gap-1 rounded-full px-3 py-1 text-xs font-bold
            ${i < step ? "bg-blue-600 text-white" : i === step ? "animate-pulse bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-400"}`}>
            {i < step && <CheckCircle2 className="h-3 w-3" />}
            {s}
          </div>
        ))}
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-blue-100">
        <div className="h-full rounded-full bg-blue-600 transition-all duration-700" style={{ width: `${Math.round((step / (GEN_STEPS.length - 1)) * 100)}%` }} />
      </div>
    </div>
  );
}

export default function NativeWFMAutoRoster() {
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
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
    if (action === "generate") setGenerating(true);
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
      setGenerating(false);
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

  const planStatus = selectedPlan?.approval_status ?? selectedPlan?.plan_status ?? "draft";
  const nextAction = selectedPlanId ? NEXT_ACTION[planStatus] ?? null : null;
  const noRequirements = requirements.length === 0;

  // Wizard progress: 0=process, 1=requirements, 2=generate, 3=submit
  const wizardStep = !planForm.process_id ? 0
    : !selectedPlanId ? 0
    : requirements.length === 0 ? 1
    : planStatus === "draft" ? 2
    : planStatus === "generated" ? 3
    : 3;

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
            ["planning_rules", "Planning Rules"],
            ["weekoff_rules", "Week-Off Rules"],
            ["assignments", "Assignments"],
            ["rotation", "Rotation Types"],
            ["change", "PM Change Control"],
            ["events", "Events"],
            ["sync", "Table Sync Audit"],
          ].map(([k, label]) => (
            <button key={k} onClick={() => setTab(k)} className={`rounded-2xl px-4 py-2 text-sm font-black ${tab === k ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-700"}`}>{label}</button>
          ))}
          {/* Coverage tab with critical conflict badge */}
          <button onClick={() => setTab("coverage")} className={`relative rounded-2xl px-4 py-2 text-sm font-black ${tab === "coverage" ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-700"}`}>
            Coverage
            {openCritical > 0 && (
              <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-600 text-[10px] font-black text-white">{openCritical}</span>
            )}
          </button>
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
          <div className="space-y-5">
            {/* Wizard stepper */}
            <div className="rounded-3xl border bg-white p-5 shadow-sm">
              <p className="mb-3 text-xs font-black uppercase tracking-wider text-slate-500">Build Progress</p>
              <WizardStepper activeStep={wizardStep} />
            </div>

            <div className="grid gap-5 xl:grid-cols-2">
              {/* Step 1: Create plan */}
              <div className="rounded-3xl border bg-white p-5 shadow-sm">
                <h2 className="font-black text-slate-950">
                  <span className="mr-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-blue-600 text-xs font-black text-white">1</span>
                  Process & Period
                </h2>
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
                  <button disabled={loading} onClick={createPlan} className="rounded-2xl bg-slate-950 px-5 py-3 font-bold text-white disabled:bg-slate-300">
                    Create Cycle
                  </button>
                </div>
              </div>

              {/* Steps 2-4: Actions panel */}
              <div className="rounded-3xl border bg-white p-5 shadow-sm space-y-4">
                <h2 className="font-black text-slate-950">
                  <span className="mr-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-blue-600 text-xs font-black text-white">→</span>
                  Next Action
                </h2>

                {/* No-slot-requirement guard */}
                {selectedPlanId && noRequirements && planStatus === "draft" && (
                  <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                    <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                    <span>No slot requirements configured — generation will produce empty assignments. <button onClick={() => setTab("requirements")} className="font-bold underline">Add slot requirements →</button></span>
                  </div>
                )}

                {/* Generation progress */}
                <GenerationProgress active={generating} />

                {/* Primary status-aware action button */}
                {nextAction && (
                  <button
                    disabled={loading || !selectedPlanId}
                    onClick={() => planAction(nextAction.action)}
                    className={`inline-flex w-full items-center justify-center gap-2 rounded-2xl px-5 py-4 text-base font-black text-white transition-colors disabled:bg-slate-300 ${nextAction.tone}`}
                  >
                    {nextAction.icon}
                    {nextAction.label}
                    <ArrowRight className="h-4 w-4 ml-auto" />
                  </button>
                )}

                {/* Secondary: PM Reject (only in submitted state) */}
                {planStatus === "submitted" && (
                  <button
                    disabled={loading || !selectedPlanId}
                    onClick={rejectPlan}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-amber-300 bg-amber-50 px-5 py-3 text-sm font-bold text-amber-800 hover:bg-amber-100 disabled:opacity-50"
                  >
                    <AlertTriangle className="h-4 w-4" /> PM: Reject & Return to WFM
                  </button>
                )}

                <div className="rounded-2xl border border-dashed p-4 text-xs text-slate-500">
                  WFM: create → generate → submit. Process Manager: approve → publish+lock → queue manager tasks.
                  Every publish/change creates locked notification rows.
                </div>
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
          <div className="space-y-5">
            {/* Coverage heat-map: unique dates as columns, slots as rows */}
            {coverage.length > 0 && (() => {
              const uniqueDates = [...new Set(coverage.map((c) => c.roster_date as string))].sort().slice(0, 7);
              const uniqueSlots = [...new Set(coverage.map((c) => `${c.slot_start}-${c.slot_end}`))].sort();
              return (
                <div className="rounded-3xl border bg-white p-5 shadow-sm">
                  <h2 className="font-black text-slate-950 mb-4">Coverage Heat-Map</h2>
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-xs text-center">
                      <thead>
                        <tr>
                          <th className="px-3 py-2 text-left text-slate-500 font-bold">Slot</th>
                          {uniqueDates.map((d) => (
                            <th key={d} className="px-3 py-2 font-bold text-slate-700">
                              {new Date(d + "T00:00:00").toLocaleDateString("en-IN", { weekday: "short", day: "numeric" })}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {uniqueSlots.map((slot) => (
                          <tr key={slot}>
                            <td className="px-3 py-2 text-left font-semibold text-slate-600">{slot}</td>
                            {uniqueDates.map((d) => {
                              const cell = coverage.find((c) => c.roster_date === d && `${c.slot_start}-${c.slot_end}` === slot);
                              const pct = Number(cell?.coverage_pct ?? 0);
                              const bg = pct >= 95 ? "bg-emerald-100 text-emerald-800" : pct >= 80 ? "bg-amber-100 text-amber-800" : pct > 0 ? "bg-red-100 text-red-800" : "bg-slate-100 text-slate-400";
                              return (
                                <td key={d} className={`px-3 py-2 rounded font-black ${bg}`}>
                                  {cell ? `${pct}%` : "—"}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="mt-3 flex items-center gap-4 text-xs text-slate-500">
                    <span className="flex items-center gap-1"><span className="h-3 w-3 rounded bg-emerald-100 inline-block" /> ≥95% (Good)</span>
                    <span className="flex items-center gap-1"><span className="h-3 w-3 rounded bg-amber-100 inline-block" /> 80–94% (Caution)</span>
                    <span className="flex items-center gap-1"><span className="h-3 w-3 rounded bg-red-100 inline-block" /> &lt;80% (Gap)</span>
                  </div>
                </div>
              );
            })()}

            <div className="grid gap-5 xl:grid-cols-2">
              <div className="rounded-3xl border bg-white p-5 shadow-sm">
                <h2 className="font-black text-slate-950">Coverage detail table</h2>
                <div className="mt-4 max-h-[480px] overflow-auto">
                  <table className="w-full min-w-[900px] text-sm">
                    <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="p-3">Date</th><th className="p-3">Slot</th><th className="p-3">Required</th><th className="p-3">Planned</th><th className="p-3">Buffer</th><th className="p-3">Gap</th><th className="p-3">Coverage</th></tr></thead>
                    <tbody>{coverage.map((c) => <tr key={c.id} className="border-t"><td className="p-3">{c.roster_date}</td><td className="p-3">{c.slot_start} - {c.slot_end}</td><td className="p-3">{c.required_hc}</td><td className="p-3">{c.planned_hc}</td><td className="p-3">{c.buffer_hc}</td><td className="p-3 font-bold">{c.gap_hc}</td><td className="p-3">{c.coverage_pct}%</td></tr>)}</tbody>
                  </table>
                </div>
              </div>
              <div className="rounded-3xl border bg-white p-5 shadow-sm">
                <h2 className="font-black text-slate-950">
                  Conflict center
                  {openCritical > 0 && <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 text-xs font-black text-red-700">{openCritical} critical</span>}
                </h2>
                <div className="mt-4 max-h-[480px] space-y-2 overflow-auto">
                  {conflicts.length ? conflicts.map((c) => <div key={c.id} className="rounded-2xl border p-3"><div className="flex items-center justify-between gap-3"><b>{c.conflict_type}</b><Pill tone={c.severity === "critical" ? "red" : c.severity === "high" ? "amber" : "slate"}>{c.severity}</Pill></div><p className="mt-1 text-sm text-slate-600">{c.message}</p></div>) : <div className="rounded-2xl border border-dashed p-8 text-center text-sm text-slate-500">No conflicts loaded.</div>}
                </div>
              </div>
            </div>
          </div>
        )}

        {tab === "planning_rules" && (
          <div className="rounded-3xl border bg-white p-5 shadow-sm space-y-4">
            <h2 className="font-black text-slate-950">Process Planning Rules</h2>
            <p className="text-sm text-slate-500">View and manage HC calculation parameters. For full CRUD, use the dedicated <a href="/wfm/planning-rules" className="text-blue-600 underline font-semibold">Planning Rules page</a>.</p>
            <PlanningRulesEmbed processId={planForm.process_id} />
          </div>
        )}

        {tab === "weekoff_rules" && (
          <div className="rounded-3xl border bg-white p-5 shadow-sm space-y-4">
            <h2 className="font-black text-slate-950">Week-Off Day Rules</h2>
            <p className="text-sm text-slate-500">Set per-day minimum HC and max week-off limits. For full configuration, use the dedicated <a href="/wfm/weekoff-day-rules" className="text-blue-600 underline font-semibold">Day Rules page</a>.</p>
            <WeekOffRulesEmbed processId={planForm.process_id} />
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
                {changeRequests.map((c) => <div key={c.id} className="rounded-2xl border p-3"><div className="flex justify-between gap-3"><b>{c.change_category}</b><Pill tone="red">notification locked</Pill></div><p className="mt-1 text-sm text-slate-600">{c.change_reason}</p><p className="mt-1 text-xs text-slate-400">{formatISTDate(c.created_at)}</p></div>)}
              </div>
            </div>
          </div>
        )}

        {tab === "events" && (
          <div className="grid gap-5 xl:grid-cols-2">
            <div className="rounded-3xl border bg-white p-5 shadow-sm">
              <h2 className="font-black text-slate-950">Real-time event feed</h2>
              <div className="mt-4 max-h-[520px] space-y-2 overflow-auto">{events.map((e) => <div key={e.id} className="rounded-2xl border p-3"><div className="flex justify-between gap-3"><b>{e.event_title}</b><Pill tone={e.severity === "critical" ? "red" : e.severity === "high" ? "amber" : "blue"}>{e.severity}</Pill></div><p className="mt-1 text-sm text-slate-600">{e.event_message}</p><p className="mt-1 text-xs text-slate-400">{formatISTDate(e.created_at)}</p></div>)}</div>
            </div>
            <div className="rounded-3xl border bg-white p-5 shadow-sm">
              <h2 className="font-black text-slate-950">Approval log</h2>
              <div className="mt-4 max-h-[520px] space-y-2 overflow-auto">{approvalLog.map((a) => <div key={a.id} className="rounded-2xl border p-3"><b>{a.action}</b><p className="mt-1 text-sm text-slate-600">{a.remarks}</p><p className="mt-1 text-xs text-slate-400">{formatISTDate(a.created_at)}</p></div>)}</div>
            </div>
          </div>
        )}

        {tab === "rotation" && (
          <RotationTypesTab processId={planForm.process_id} branchId={planForm.branch_id} />
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
