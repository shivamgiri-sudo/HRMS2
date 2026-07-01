import { useEffect, useState } from "react";
import {
  AlertTriangle, Award, BarChart2, BookOpen, CheckCircle2,
  ChevronDown, Loader, Plus, RefreshCcw, Search, Star, Target, X,
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";

// ─── Types ────────────────────────────────────────────────────────────────────

type GoalType = "individual" | "team" | "department" | "company";
type GoalStatus = "draft" | "active" | "completed" | "cancelled";
type Proficiency = "beginner" | "intermediate" | "advanced" | "expert";
type AppraisalStatus = "pending" | "self_done" | "manager_done" | "calibrated" | "closed";
type CycleStatus = "draft" | "active" | "closed";

interface Goal {
  id: string;
  employee_id: string;
  employee_name?: string;
  employee_code?: string;
  title: string;
  description: string | null;
  goal_type: GoalType;
  period: string;
  target_value: number | null;
  actual_value: number | null;
  weightage: number;
  status: GoalStatus;
  created_at: string;
}

interface AppraisalCycle {
  id: string;
  cycle_name: string;
  period: string;
  start_date: string;
  end_date: string;
  status: CycleStatus;
  created_at: string;
}

interface AppraisalRating {
  id: string;
  cycle_id: string;
  employee_id: string;
  employee_name?: string;
  employee_code?: string;
  self_rating: number | null;
  manager_rating: number | null;
  final_rating: number | null;
  self_comments: string | null;
  manager_comments: string | null;
  status: AppraisalStatus;
}

interface SkillMaster {
  id: string;
  skill_name: string;
  skill_category: string | null;
  description: string | null;
  is_active: number;
}

interface EmployeeSkill {
  id: string;
  employee_id: string;
  skill_id: string;
  skill_name?: string;
  skill_category?: string | null;
  proficiency: Proficiency;
  certified: number;
  assessed_date: string | null;
  notes: string | null;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const GOAL_STATUS_COLORS: Record<GoalStatus, string> = {
  draft:     "bg-slate-100 text-slate-600",
  active:    "bg-blue-50 text-blue-700",
  completed: "bg-emerald-50 text-emerald-700",
  cancelled: "bg-rose-50 text-rose-600",
};

const GOAL_TYPE_COLORS: Record<GoalType, string> = {
  individual: "bg-violet-50 text-violet-700",
  team:       "bg-cyan-50 text-cyan-700",
  department: "bg-amber-50 text-amber-700",
  company:    "bg-slate-100 text-slate-700",
};

const APPRAISAL_STATUS_COLORS: Record<AppraisalStatus, string> = {
  pending:      "bg-slate-100 text-slate-600",
  self_done:    "bg-blue-50 text-blue-700",
  manager_done: "bg-amber-50 text-amber-700",
  calibrated:   "bg-violet-50 text-violet-700",
  closed:       "bg-emerald-50 text-emerald-700",
};

const PROFICIENCY_COLORS: Record<Proficiency, string> = {
  beginner:     "bg-slate-100 text-slate-600",
  intermediate: "bg-blue-50 text-blue-700",
  advanced:     "bg-emerald-50 text-emerald-700",
  expert:       "bg-purple-50 text-purple-700",
};

// ─── Small reusable components ────────────────────────────────────────────────

function Badge({ label, colorClass }: { label: string; colorClass: string }) {
  return (
    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${colorClass}`}>
      {label.replace(/_/g, " ")}
    </span>
  );
}

function StatCard({
  title, value, icon, tone,
}: {
  title: string;
  value: number;
  icon: React.ReactNode;
  tone: string;
}) {
  return (
    <div className="glass-card stat-card rounded-3xl p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-slate-500">{title}</p>
          <p className="mt-2 text-3xl font-black tracking-tight text-slate-950">{value}</p>
        </div>
        <div className={`rounded-2xl p-3 ${tone}`}>{icon}</div>
      </div>
    </div>
  );
}

function ProgressBar({ actual, target }: { actual: number | null; target: number | null }) {
  if (!target) return <span className="text-xs text-slate-400">No target</span>;
  const pct = Math.min(100, Math.round(((actual ?? 0) / target) * 100));
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-slate-100">
        <div
          className={`h-full rounded-full ${pct >= 100 ? "bg-emerald-500" : "bg-blue-500"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs font-semibold text-slate-600">{pct}%</span>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

type Tab = "goals" | "appraisal" | "skills";

export default function NativeGoalsAppraisal() {
  const [tab, setTab] = useState<Tab>("goals");

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <p className="text-sm font-black uppercase tracking-[0.2em] text-blue-600">
            Performance
          </p>
          <h1 className="mt-2 text-3xl font-black text-slate-950">Goals, Appraisal & Skills</h1>
          <p className="mt-2 max-w-4xl text-slate-600">
            Manage employee goals, run appraisal cycles, and track skill competencies.
          </p>
        </div>

        {/* Tab bar */}
        <div className="flex gap-1 rounded-2xl border bg-slate-50 p-1 w-fit">
          {(["goals", "appraisal", "skills"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`cursor-pointer rounded-xl px-5 py-2.5 text-sm font-semibold capitalize transition-colors ${
                tab === t
                  ? "bg-white text-slate-950 shadow-sm"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              {t === "goals" && <Target className="inline mr-1.5 h-4 w-4" />}
              {t === "appraisal" && <BarChart2 className="inline mr-1.5 h-4 w-4" />}
              {t === "skills" && <BookOpen className="inline mr-1.5 h-4 w-4" />}
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>

        {tab === "goals" && <GoalsTab />}
        {tab === "appraisal" && <AppraisalTab />}
        {tab === "skills" && <SkillsTab />}
      </div>
    </DashboardLayout>
  );
}

// ─── Goals Tab ────────────────────────────────────────────────────────────────

function GoalsTab() {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [period, setPeriod] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
  const [showAddModal, setShowAddModal] = useState(false);
  const [editGoal, setEditGoal] = useState<Goal | null>(null);
  const [saving, setSaving] = useState(false);

  const [addForm, setAddForm] = useState({
    employee_id: "",
    title: "",
    description: "",
    goal_type: "individual" as GoalType,
    period: "",
    target_value: "",
    weightage: "100",
  });

  const [editForm, setEditForm] = useState({
    actual_value: "",
    status: "active" as GoalStatus,
    description: "",
  });

  const load = async () => {
    setLoading(true);
    setMessage("");
    try {
      const res = await hrmsApi.get<{ success: boolean; data: Goal[] }>(
        `/api/goals/goals?period=${encodeURIComponent(period)}`
      );
      setGoals(res.data ?? []);
    } catch (err: unknown) {
      setMessage((err as Error)?.message ?? "Failed to load goals");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [period]);

  const submitAdd = async () => {
    if (!addForm.title.trim()) return setMessage("Title is required.");
    setSaving(true);
    try {
      await hrmsApi.post("/api/goals/goals", {
        employee_id: addForm.employee_id.trim() || undefined,
        title: addForm.title.trim(),
        description: addForm.description || null,
        goal_type: addForm.goal_type,
        period: addForm.period.trim() || period,
        target_value: addForm.target_value ? Number(addForm.target_value) : null,
        weightage: Number(addForm.weightage) || 100,
      });
      setShowAddModal(false);
      setAddForm({ employee_id: "", title: "", description: "", goal_type: "individual", period: "", target_value: "", weightage: "100" });
      await load();
    } catch (err: unknown) {
      setMessage((err as Error)?.message ?? "Failed to create goal");
    } finally {
      setSaving(false);
    }
  };

  const openEdit = (g: Goal) => {
    setEditGoal(g);
    setEditForm({
      actual_value: g.actual_value != null ? String(g.actual_value) : "",
      status: g.status,
      description: g.description ?? "",
    });
  };

  const submitEdit = async () => {
    if (!editGoal) return;
    setSaving(true);
    try {
      await hrmsApi.patch(`/api/goals/goals/${editGoal.id}`, {
        actual_value: editForm.actual_value !== "" ? Number(editForm.actual_value) : null,
        status: editForm.status,
        description: editForm.description || null,
      });
      setEditGoal(null);
      await load();
    } catch (err: unknown) {
      setMessage((err as Error)?.message ?? "Failed to update goal");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      {message && (
        <div className="flex items-center gap-3 rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm font-bold text-blue-800">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />
          {message}
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <label className="text-sm font-semibold text-slate-600">Period:</label>
          <input
            type="month"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            className="rounded-xl border px-3 py-2 text-sm outline-none focus:border-blue-400"
          />
        </div>
        <div className="flex-1" />
        <button
          onClick={() => load()}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 transition-colors cursor-pointer disabled:opacity-50"
        >
          <RefreshCcw className="h-4 w-4" />
          Refresh
        </button>
        <button
          onClick={() => { setShowAddModal(true); setMessage(""); }}
          className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-5 py-2.5 text-sm font-bold text-white hover:bg-slate-800 transition-colors cursor-pointer"
        >
          <Plus className="h-4 w-4" />
          Add Goal
        </button>
      </div>

      {/* Goals list */}
      <div className="overflow-hidden rounded-3xl border bg-white shadow-sm">
        <div className="border-b p-5">
          <h2 className="font-black text-slate-950">My Goals</h2>
          <p className="text-sm text-slate-500">{goals.length} goal(s) for {period}</p>
        </div>
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader className="h-8 w-8 animate-spin text-slate-400" />
          </div>
        ) : goals.length === 0 ? (
          <div className="py-16 text-center text-slate-400">
            <Target className="mx-auto mb-3 h-10 w-10 opacity-30" />
            <p className="font-semibold">No goals for this period.</p>
          </div>
        ) : (
          <div className="divide-y">
            {goals.map((g) => (
              <div key={g.id} className="flex flex-col gap-3 p-5 hover:bg-slate-50/60 transition-colors sm:flex-row sm:items-start">
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <span className="font-bold text-slate-950">{g.title}</span>
                    <Badge label={g.goal_type} colorClass={GOAL_TYPE_COLORS[g.goal_type]} />
                    <Badge label={g.status} colorClass={GOAL_STATUS_COLORS[g.status]} />
                  </div>
                  {g.employee_name && (
                    <p className="text-xs text-slate-500 mb-1">{g.employee_name}</p>
                  )}
                  {g.description && (
                    <p className="text-sm text-slate-500 line-clamp-2">{g.description}</p>
                  )}
                  <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-slate-500">
                    <span>Weightage: <strong className="text-slate-700">{g.weightage}%</strong></span>
                    {g.target_value != null && (
                      <span>Target: <strong className="text-slate-700">{g.target_value}</strong></span>
                    )}
                    {g.actual_value != null && (
                      <span>Actual: <strong className="text-slate-700">{g.actual_value}</strong></span>
                    )}
                    <ProgressBar actual={g.actual_value} target={g.target_value} />
                  </div>
                </div>
                <button
                  onClick={() => openEdit(g)}
                  className="cursor-pointer self-start rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 transition-colors"
                >
                  Edit
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add Goal Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-3xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b p-6">
              <h2 className="text-lg font-black text-slate-950">Add Goal</h2>
              <button onClick={() => setShowAddModal(false)} className="cursor-pointer text-slate-400 hover:text-slate-700 transition-colors">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-4 p-6 max-h-[70vh] overflow-y-auto">
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">Employee ID (admin only)</label>
                <input
                  value={addForm.employee_id}
                  onChange={(e) => setAddForm({ ...addForm, employee_id: e.target.value })}
                  placeholder="Leave blank to use your own"
                  className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 transition-colors"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">Title *</label>
                <input
                  value={addForm.title}
                  onChange={(e) => setAddForm({ ...addForm, title: e.target.value })}
                  placeholder="Goal title"
                  className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 transition-colors"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">Description</label>
                <textarea
                  value={addForm.description}
                  onChange={(e) => setAddForm({ ...addForm, description: e.target.value })}
                  rows={3}
                  className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 resize-none transition-colors"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1.5">Type</label>
                  <select
                    value={addForm.goal_type}
                    onChange={(e) => setAddForm({ ...addForm, goal_type: e.target.value as GoalType })}
                    className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400"
                  >
                    <option value="individual">Individual</option>
                    <option value="team">Team</option>
                    <option value="department">Department</option>
                    <option value="company">Company</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1.5">Period</label>
                  <input
                    type="month"
                    value={addForm.period || period}
                    onChange={(e) => setAddForm({ ...addForm, period: e.target.value })}
                    className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1.5">Target Value</label>
                  <input
                    type="number"
                    value={addForm.target_value}
                    onChange={(e) => setAddForm({ ...addForm, target_value: e.target.value })}
                    placeholder="Optional"
                    className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1.5">Weightage %</label>
                  <input
                    type="number"
                    value={addForm.weightage}
                    onChange={(e) => setAddForm({ ...addForm, weightage: e.target.value })}
                    min="0"
                    max="100"
                    className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400"
                  />
                </div>
              </div>
            </div>
            <div className="flex gap-3 border-t p-6">
              <button
                onClick={() => setShowAddModal(false)}
                className="flex-1 cursor-pointer rounded-2xl border border-slate-200 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={submitAdd}
                disabled={saving}
                className="flex-1 cursor-pointer rounded-2xl bg-slate-950 py-3 text-sm font-bold text-white hover:bg-slate-800 transition-colors disabled:opacity-50"
              >
                {saving ? "Saving…" : "Add Goal"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Goal Modal */}
      {editGoal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-3xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b p-6">
              <h2 className="text-lg font-black text-slate-950">Update Goal</h2>
              <button onClick={() => setEditGoal(null)} className="cursor-pointer text-slate-400 hover:text-slate-700 transition-colors">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-4 p-6">
              <p className="font-semibold text-slate-800">{editGoal.title}</p>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">Actual Value</label>
                <input
                  type="number"
                  value={editForm.actual_value}
                  onChange={(e) => setEditForm({ ...editForm, actual_value: e.target.value })}
                  placeholder="Enter actual value"
                  className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 transition-colors"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">Status</label>
                <select
                  value={editForm.status}
                  onChange={(e) => setEditForm({ ...editForm, status: e.target.value as GoalStatus })}
                  className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400"
                >
                  <option value="draft">Draft</option>
                  <option value="active">Active</option>
                  <option value="completed">Completed</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">Description</label>
                <textarea
                  value={editForm.description}
                  onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                  rows={3}
                  className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 resize-none transition-colors"
                />
              </div>
            </div>
            <div className="flex gap-3 border-t p-6">
              <button
                onClick={() => setEditGoal(null)}
                className="flex-1 cursor-pointer rounded-2xl border border-slate-200 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={submitEdit}
                disabled={saving}
                className="flex-1 cursor-pointer rounded-2xl bg-slate-950 py-3 text-sm font-bold text-white hover:bg-slate-800 transition-colors disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Appraisal Tab ────────────────────────────────────────────────────────────

function AppraisalTab() {
  const [cycles, setCycles] = useState<AppraisalCycle[]>([]);
  const [selectedCycle, setSelectedCycle] = useState<string>("");
  const [ratings, setRatings] = useState<AppraisalRating[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [showCycleModal, setShowCycleModal] = useState(false);
  const [selfRatingRow, setSelfRatingRow] = useState<AppraisalRating | null>(null);
  const [managerRatingRow, setManagerRatingRow] = useState<AppraisalRating | null>(null);
  const [saving, setSaving] = useState(false);

  const [cycleForm, setCycleForm] = useState({
    cycle_name: "", period: "", start_date: "", end_date: "",
  });

  const [selfForm, setSelfForm] = useState({ self_rating: "3", self_comments: "" });
  const [managerForm, setManagerForm] = useState({
    manager_rating: "3", final_rating: "", manager_comments: "",
  });

  const loadCycles = async () => {
    try {
      const res = await hrmsApi.get<{ success: boolean; data: AppraisalCycle[] }>(
        "/api/goals/appraisal/cycles"
      );
      const list = res.data ?? [];
      setCycles(list);
      if (list.length > 0 && !selectedCycle) setSelectedCycle(list[0].id);
    } catch {
      // Non-admin users won't have access; show empty
    }
  };

  const loadRatings = async () => {
    if (!selectedCycle) return;
    setLoading(true);
    setMessage("");
    try {
      const res = await hrmsApi.get<{ success: boolean; data: AppraisalRating[] }>(
        `/api/goals/appraisal/ratings?cycle_id=${encodeURIComponent(selectedCycle)}`
      );
      setRatings(res.data ?? []);
    } catch (err: unknown) {
      setMessage((err as Error)?.message ?? "Failed to load ratings");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadCycles(); }, []);
  useEffect(() => { void loadRatings(); }, [selectedCycle]);

  const stats = {
    pendingSelf:    ratings.filter((r) => r.status === "pending").length,
    pendingManager: ratings.filter((r) => r.status === "self_done").length,
    calibrated:     ratings.filter((r) => r.status === "calibrated").length,
    closed:         ratings.filter((r) => r.status === "closed").length,
  };

  const submitCycle = async () => {
    setSaving(true);
    try {
      await hrmsApi.post("/api/goals/appraisal/cycles", {
        cycle_name: cycleForm.cycle_name,
        period: cycleForm.period,
        start_date: cycleForm.start_date,
        end_date: cycleForm.end_date,
      });
      setShowCycleModal(false);
      setCycleForm({ cycle_name: "", period: "", start_date: "", end_date: "" });
      await loadCycles();
    } catch (err: unknown) {
      setMessage((err as Error)?.message ?? "Failed to create cycle");
    } finally {
      setSaving(false);
    }
  };

  const submitSelfRating = async () => {
    if (!selfRatingRow) return;
    setSaving(true);
    try {
      await hrmsApi.post(
        `/api/goals/appraisal/ratings/${selfRatingRow.cycle_id}/${selfRatingRow.employee_id}/self`,
        { self_rating: Number(selfForm.self_rating), self_comments: selfForm.self_comments || null }
      );
      setSelfRatingRow(null);
      await loadRatings();
    } catch (err: unknown) {
      setMessage((err as Error)?.message ?? "Failed to submit self rating");
    } finally {
      setSaving(false);
    }
  };

  const submitManagerRating = async () => {
    if (!managerRatingRow) return;
    setSaving(true);
    try {
      await hrmsApi.post(
        `/api/goals/appraisal/ratings/${managerRatingRow.cycle_id}/${managerRatingRow.employee_id}/manager`,
        {
          manager_rating: Number(managerForm.manager_rating),
          final_rating: managerForm.final_rating ? Number(managerForm.final_rating) : null,
          manager_comments: managerForm.manager_comments || null,
        }
      );
      setManagerRatingRow(null);
      await loadRatings();
    } catch (err: unknown) {
      setMessage((err as Error)?.message ?? "Failed to submit manager rating");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      {message && (
        <div className="flex items-center gap-3 rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm font-bold text-blue-800">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />
          {message}
        </div>
      )}

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-4">
        <StatCard title="Pending Self" value={stats.pendingSelf} icon={<Star className="h-5 w-5" />} tone="bg-slate-100 text-slate-700" />
        <StatCard title="Pending Manager" value={stats.pendingManager} icon={<Award className="h-5 w-5" />} tone="bg-amber-50 text-amber-700" />
        <StatCard title="Calibrated" value={stats.calibrated} icon={<BarChart2 className="h-5 w-5" />} tone="bg-violet-50 text-violet-700" />
        <StatCard title="Closed" value={stats.closed} icon={<CheckCircle2 className="h-5 w-5" />} tone="bg-emerald-50 text-emerald-700" />
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <select
            value={selectedCycle}
            onChange={(e) => setSelectedCycle(e.target.value)}
            className="appearance-none rounded-xl border px-4 py-2.5 pr-8 text-sm outline-none focus:border-blue-400 bg-white"
          >
            <option value="">Select cycle…</option>
            {cycles.map((c) => (
              <option key={c.id} value={c.id}>
                {c.cycle_name} ({c.period})
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        </div>
        <div className="flex-1" />
        <button
          onClick={() => { setShowCycleModal(true); setMessage(""); }}
          className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-5 py-2.5 text-sm font-bold text-white hover:bg-slate-800 transition-colors cursor-pointer"
        >
          <Plus className="h-4 w-4" />
          New Cycle
        </button>
      </div>

      {/* Ratings table */}
      <div className="overflow-hidden rounded-3xl border bg-white shadow-sm">
        <div className="border-b p-5">
          <h2 className="font-black text-slate-950">Appraisal Ratings</h2>
          <p className="text-sm text-slate-500">{ratings.length} employee(s)</p>
        </div>
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader className="h-8 w-8 animate-spin text-slate-400" />
          </div>
        ) : ratings.length === 0 ? (
          <div className="py-16 text-center text-slate-400">
            <BarChart2 className="mx-auto mb-3 h-10 w-10 opacity-30" />
            <p className="font-semibold">No ratings for this cycle.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[800px] text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  {["Employee", "Self Rating", "Manager Rating", "Final Rating", "Status", "Actions"].map((h) => (
                    <th key={h} className="p-4 font-semibold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ratings.map((r) => (
                  <tr key={r.id} className="border-t hover:bg-slate-50/80 transition-colors">
                    <td className="p-4">
                      <div className="font-bold text-slate-950">{r.employee_name ?? r.employee_id}</div>
                      <div className="text-xs text-slate-500 font-mono">{r.employee_code ?? r.employee_id.slice(0, 8)}</div>
                    </td>
                    <td className="p-4">
                      {r.self_rating != null ? (
                        <div className="flex items-center gap-1">
                          <Star className="h-3.5 w-3.5 text-amber-400" />
                          <span className="font-bold text-slate-700">{r.self_rating}</span>
                          <span className="text-slate-400">/5</span>
                        </div>
                      ) : (
                        <span className="text-xs text-slate-400">Pending</span>
                      )}
                    </td>
                    <td className="p-4">
                      {r.manager_rating != null ? (
                        <div className="flex items-center gap-1">
                          <Star className="h-3.5 w-3.5 text-blue-400" />
                          <span className="font-bold text-slate-700">{r.manager_rating}</span>
                          <span className="text-slate-400">/5</span>
                        </div>
                      ) : (
                        <span className="text-xs text-slate-400">Pending</span>
                      )}
                    </td>
                    <td className="p-4">
                      {r.final_rating != null ? (
                        <div className="flex items-center gap-1">
                          <Award className="h-3.5 w-3.5 text-emerald-500" />
                          <span className="font-bold text-slate-700">{r.final_rating}</span>
                          <span className="text-slate-400">/5</span>
                        </div>
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </td>
                    <td className="p-4">
                      <Badge label={r.status} colorClass={APPRAISAL_STATUS_COLORS[r.status]} />
                    </td>
                    <td className="p-4">
                      <div className="flex flex-wrap gap-1">
                        {(r.status === "pending" || r.status === "self_done") && (
                          <button
                            onClick={() => { setSelfRatingRow(r); setSelfForm({ self_rating: String(r.self_rating ?? 3), self_comments: r.self_comments ?? "" }); }}
                            className="cursor-pointer rounded-lg bg-blue-600 px-2.5 py-1.5 text-xs font-bold text-white hover:bg-blue-700 transition-colors"
                          >
                            Self Rate
                          </button>
                        )}
                        {["self_done", "manager_done"].includes(r.status) && (
                          <button
                            onClick={() => { setManagerRatingRow(r); setManagerForm({ manager_rating: String(r.manager_rating ?? 3), final_rating: String(r.final_rating ?? ""), manager_comments: r.manager_comments ?? "" }); }}
                            className="cursor-pointer rounded-lg bg-amber-600 px-2.5 py-1.5 text-xs font-bold text-white hover:bg-amber-700 transition-colors"
                          >
                            Manager Rate
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* New Cycle Modal */}
      {showCycleModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-3xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b p-6">
              <h2 className="text-lg font-black text-slate-950">New Appraisal Cycle</h2>
              <button onClick={() => setShowCycleModal(false)} className="cursor-pointer text-slate-400 hover:text-slate-700 transition-colors">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-4 p-6">
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">Cycle Name</label>
                <input
                  value={cycleForm.cycle_name}
                  onChange={(e) => setCycleForm({ ...cycleForm, cycle_name: e.target.value })}
                  placeholder="e.g. H1 2025 Appraisal"
                  className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 transition-colors"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">Period (YYYY-MM or YYYY-Q1)</label>
                <input
                  value={cycleForm.period}
                  onChange={(e) => setCycleForm({ ...cycleForm, period: e.target.value })}
                  placeholder="2025-Q1"
                  className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 transition-colors"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1.5">Start Date</label>
                  <input
                    type="date"
                    value={cycleForm.start_date}
                    onChange={(e) => setCycleForm({ ...cycleForm, start_date: e.target.value })}
                    className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1.5">End Date</label>
                  <input
                    type="date"
                    value={cycleForm.end_date}
                    onChange={(e) => setCycleForm({ ...cycleForm, end_date: e.target.value })}
                    className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400"
                  />
                </div>
              </div>
            </div>
            <div className="flex gap-3 border-t p-6">
              <button onClick={() => setShowCycleModal(false)} className="flex-1 cursor-pointer rounded-2xl border border-slate-200 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors">Cancel</button>
              <button onClick={submitCycle} disabled={saving} className="flex-1 cursor-pointer rounded-2xl bg-slate-950 py-3 text-sm font-bold text-white hover:bg-slate-800 transition-colors disabled:opacity-50">
                {saving ? "Saving…" : "Create Cycle"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Self Rating Modal */}
      {selfRatingRow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-3xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b p-6">
              <h2 className="text-lg font-black text-slate-950">Self Rating</h2>
              <button onClick={() => setSelfRatingRow(null)} className="cursor-pointer text-slate-400 hover:text-slate-700 transition-colors">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-4 p-6">
              <p className="text-sm text-slate-600">
                Rating for <strong>{selfRatingRow.employee_name ?? selfRatingRow.employee_id}</strong>
              </p>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">Rating (1–5)</label>
                <input
                  type="number"
                  min="1"
                  max="5"
                  step="0.5"
                  value={selfForm.self_rating}
                  onChange={(e) => setSelfForm({ ...selfForm, self_rating: e.target.value })}
                  className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 transition-colors"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">Comments</label>
                <textarea
                  value={selfForm.self_comments}
                  onChange={(e) => setSelfForm({ ...selfForm, self_comments: e.target.value })}
                  rows={3}
                  className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 resize-none transition-colors"
                />
              </div>
            </div>
            <div className="flex gap-3 border-t p-6">
              <button onClick={() => setSelfRatingRow(null)} className="flex-1 cursor-pointer rounded-2xl border border-slate-200 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors">Cancel</button>
              <button onClick={submitSelfRating} disabled={saving} className="flex-1 cursor-pointer rounded-2xl bg-blue-600 py-3 text-sm font-bold text-white hover:bg-blue-700 transition-colors disabled:opacity-50">
                {saving ? "Saving…" : "Submit"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Manager Rating Modal */}
      {managerRatingRow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-3xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b p-6">
              <h2 className="text-lg font-black text-slate-950">Manager Rating</h2>
              <button onClick={() => setManagerRatingRow(null)} className="cursor-pointer text-slate-400 hover:text-slate-700 transition-colors">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-4 p-6">
              <p className="text-sm text-slate-600">
                Rating for <strong>{managerRatingRow.employee_name ?? managerRatingRow.employee_id}</strong>
              </p>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">Manager Rating (1–5)</label>
                <input
                  type="number"
                  min="1"
                  max="5"
                  step="0.5"
                  value={managerForm.manager_rating}
                  onChange={(e) => setManagerForm({ ...managerForm, manager_rating: e.target.value })}
                  className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 transition-colors"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">Final Rating (1–5, optional)</label>
                <input
                  type="number"
                  min="1"
                  max="5"
                  step="0.5"
                  value={managerForm.final_rating}
                  onChange={(e) => setManagerForm({ ...managerForm, final_rating: e.target.value })}
                  placeholder="Leave blank to skip calibration"
                  className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 transition-colors"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">Comments</label>
                <textarea
                  value={managerForm.manager_comments}
                  onChange={(e) => setManagerForm({ ...managerForm, manager_comments: e.target.value })}
                  rows={3}
                  className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 resize-none transition-colors"
                />
              </div>
            </div>
            <div className="flex gap-3 border-t p-6">
              <button onClick={() => setManagerRatingRow(null)} className="flex-1 cursor-pointer rounded-2xl border border-slate-200 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors">Cancel</button>
              <button onClick={submitManagerRating} disabled={saving} className="flex-1 cursor-pointer rounded-2xl bg-amber-600 py-3 text-sm font-bold text-white hover:bg-amber-700 transition-colors disabled:opacity-50">
                {saving ? "Saving…" : "Submit"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Skills Tab ───────────────────────────────────────────────────────────────

function SkillsTab() {
  const [skillMaster, setSkillMaster] = useState<SkillMaster[]>([]);
  const [empSkills, setEmpSkills] = useState<EmployeeSkill[]>([]);
  const [empSearch, setEmpSearch] = useState("");
  const [selectedEmpId, setSelectedEmpId] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [showAddSkillModal, setShowAddSkillModal] = useState(false);
  const [showAddEmpSkillModal, setShowAddEmpSkillModal] = useState(false);
  const [saving, setSaving] = useState(false);

  const [skillForm, setSkillForm] = useState({
    skill_name: "", skill_category: "", description: "",
  });

  const [empSkillForm, setEmpSkillForm] = useState({
    skill_id: "",
    proficiency: "beginner" as Proficiency,
    certified: false,
    assessed_date: "",
    notes: "",
  });

  const loadSkillMaster = async () => {
    try {
      const res = await hrmsApi.get<{ success: boolean; data: SkillMaster[] }>("/api/goals/skills");
      setSkillMaster(res.data ?? []);
    } catch (err: unknown) {
      setMessage((err as Error)?.message ?? "Failed to load skills");
    }
  };

  const loadEmpSkills = async () => {
    if (!selectedEmpId.trim()) return;
    setLoading(true);
    try {
      const res = await hrmsApi.get<{ success: boolean; data: EmployeeSkill[] }>(
        `/api/goals/skills/employee/${encodeURIComponent(selectedEmpId.trim())}`
      );
      setEmpSkills(res.data ?? []);
    } catch (err: unknown) {
      setMessage((err as Error)?.message ?? "Failed to load employee skills");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadSkillMaster(); }, []);
  useEffect(() => { if (selectedEmpId) void loadEmpSkills(); }, [selectedEmpId]);

  const submitSkill = async () => {
    if (!skillForm.skill_name.trim()) return setMessage("Skill name is required.");
    setSaving(true);
    try {
      await hrmsApi.post("/api/goals/skills", {
        skill_name: skillForm.skill_name.trim(),
        skill_category: skillForm.skill_category.trim() || null,
        description: skillForm.description.trim() || null,
      });
      setShowAddSkillModal(false);
      setSkillForm({ skill_name: "", skill_category: "", description: "" });
      await loadSkillMaster();
    } catch (err: unknown) {
      setMessage((err as Error)?.message ?? "Failed to create skill");
    } finally {
      setSaving(false);
    }
  };

  const submitEmpSkill = async () => {
    if (!empSkillForm.skill_id) return setMessage("Skill is required.");
    if (!selectedEmpId.trim()) return setMessage("Select an employee first.");
    setSaving(true);
    try {
      await hrmsApi.post(
        `/api/goals/skills/employee/${encodeURIComponent(selectedEmpId.trim())}`,
        {
          skill_id: empSkillForm.skill_id,
          proficiency: empSkillForm.proficiency,
          certified: empSkillForm.certified ? 1 : 0,
          assessed_date: empSkillForm.assessed_date || null,
          notes: empSkillForm.notes.trim() || null,
        }
      );
      setShowAddEmpSkillModal(false);
      setEmpSkillForm({ skill_id: "", proficiency: "beginner", certified: false, assessed_date: "", notes: "" });
      await loadEmpSkills();
    } catch (err: unknown) {
      setMessage((err as Error)?.message ?? "Failed to add skill");
    } finally {
      setSaving(false);
    }
  };

  const filteredMaster = skillMaster.filter((s) => {
    const q = empSearch.toLowerCase();
    return !q || s.skill_name.toLowerCase().includes(q) || (s.skill_category ?? "").toLowerCase().includes(q);
  });

  const categories = [...new Set(skillMaster.map((s) => s.skill_category).filter(Boolean))];

  return (
    <div className="space-y-5">
      {message && (
        <div className="flex items-center gap-3 rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm font-bold text-blue-800">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />
          {message}
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Skill Master Panel */}
        <div className="overflow-hidden rounded-3xl border bg-white shadow-sm">
          <div className="flex items-center justify-between border-b p-5">
            <div>
              <h2 className="font-black text-slate-950">Skill Master</h2>
              <p className="text-sm text-slate-500">{skillMaster.length} skill(s)</p>
            </div>
            <button
              onClick={() => { setShowAddSkillModal(true); setMessage(""); }}
              className="inline-flex items-center gap-1.5 rounded-2xl bg-slate-950 px-4 py-2 text-xs font-bold text-white hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <Plus className="h-3.5 w-3.5" />
              Add Skill
            </button>
          </div>
          <div className="p-4">
            <div className="relative mb-4">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={empSearch}
                onChange={(e) => setEmpSearch(e.target.value)}
                placeholder="Search skills…"
                className="h-10 w-full rounded-xl border bg-slate-50 pl-10 pr-4 text-sm outline-none focus:border-blue-400 transition-colors"
              />
            </div>
            {categories.length > 0 && (
              <div className="space-y-4 max-h-80 overflow-y-auto">
                {categories.map((cat) => (
                  <div key={String(cat)}>
                    <p className="mb-2 text-xs font-black uppercase tracking-wider text-slate-400">{cat}</p>
                    <div className="space-y-1">
                      {filteredMaster
                        .filter((s) => s.skill_category === cat)
                        .map((s) => (
                          <div key={s.id} className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2">
                            <span className="text-sm font-semibold text-slate-700">{s.skill_name}</span>
                          </div>
                        ))}
                    </div>
                  </div>
                ))}
                {filteredMaster.filter((s) => !s.skill_category).length > 0 && (
                  <div>
                    <p className="mb-2 text-xs font-black uppercase tracking-wider text-slate-400">Uncategorised</p>
                    {filteredMaster.filter((s) => !s.skill_category).map((s) => (
                      <div key={s.id} className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 mb-1">
                        <span className="text-sm font-semibold text-slate-700">{s.skill_name}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            {skillMaster.length === 0 && (
              <div className="py-8 text-center text-slate-400">
                <BookOpen className="mx-auto mb-2 h-8 w-8 opacity-30" />
                <p className="text-sm font-semibold">No skills yet.</p>
              </div>
            )}
          </div>
        </div>

        {/* Employee Skills Panel */}
        <div className="overflow-hidden rounded-3xl border bg-white shadow-sm">
          <div className="flex items-center justify-between border-b p-5">
            <div>
              <h2 className="font-black text-slate-950">Employee Skills</h2>
              <p className="text-sm text-slate-500">{empSkills.length} skill(s)</p>
            </div>
            <button
              onClick={() => { setShowAddEmpSkillModal(true); setMessage(""); }}
              disabled={!selectedEmpId.trim()}
              className="inline-flex items-center gap-1.5 rounded-2xl bg-slate-950 px-4 py-2 text-xs font-bold text-white hover:bg-slate-800 transition-colors cursor-pointer disabled:opacity-40"
            >
              <Plus className="h-3.5 w-3.5" />
              Add Skill
            </button>
          </div>
          <div className="p-4 space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1.5">Employee ID</label>
              <input
                value={selectedEmpId}
                onChange={(e) => setSelectedEmpId(e.target.value)}
                placeholder="Enter employee UUID to search skills"
                className="h-10 w-full rounded-xl border bg-slate-50 px-4 text-sm outline-none focus:border-blue-400 transition-colors"
              />
            </div>
            {loading ? (
              <div className="flex items-center justify-center py-10">
                <Loader className="h-6 w-6 animate-spin text-slate-400" />
              </div>
            ) : empSkills.length === 0 && selectedEmpId ? (
              <div className="py-8 text-center text-slate-400">
                <BookOpen className="mx-auto mb-2 h-8 w-8 opacity-30" />
                <p className="text-sm font-semibold">No skills found.</p>
              </div>
            ) : (
              <div className="space-y-2 max-h-80 overflow-y-auto">
                {empSkills.map((es) => (
                  <div key={es.id} className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2.5">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-slate-800">{es.skill_name}</span>
                        {es.certified === 1 && (
                          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-700">Certified</span>
                        )}
                      </div>
                      {es.skill_category && (
                        <p className="text-xs text-slate-400">{es.skill_category}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge label={es.proficiency} colorClass={PROFICIENCY_COLORS[es.proficiency]} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Add Skill Modal */}
      {showAddSkillModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-3xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b p-6">
              <h2 className="text-lg font-black text-slate-950">New Skill</h2>
              <button onClick={() => setShowAddSkillModal(false)} className="cursor-pointer text-slate-400 hover:text-slate-700 transition-colors">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-4 p-6">
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">Skill Name *</label>
                <input
                  value={skillForm.skill_name}
                  onChange={(e) => setSkillForm({ ...skillForm, skill_name: e.target.value })}
                  placeholder="e.g. React, SQL, Leadership"
                  className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 transition-colors"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">Category</label>
                <input
                  value={skillForm.skill_category}
                  onChange={(e) => setSkillForm({ ...skillForm, skill_category: e.target.value })}
                  placeholder="e.g. Technical, Soft Skills"
                  className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 transition-colors"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">Description</label>
                <textarea
                  value={skillForm.description}
                  onChange={(e) => setSkillForm({ ...skillForm, description: e.target.value })}
                  rows={2}
                  className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 resize-none transition-colors"
                />
              </div>
            </div>
            <div className="flex gap-3 border-t p-6">
              <button onClick={() => setShowAddSkillModal(false)} className="flex-1 cursor-pointer rounded-2xl border border-slate-200 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors">Cancel</button>
              <button onClick={submitSkill} disabled={saving} className="flex-1 cursor-pointer rounded-2xl bg-slate-950 py-3 text-sm font-bold text-white hover:bg-slate-800 transition-colors disabled:opacity-50">
                {saving ? "Saving…" : "Create Skill"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Employee Skill Modal */}
      {showAddEmpSkillModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-3xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b p-6">
              <h2 className="text-lg font-black text-slate-950">Add Employee Skill</h2>
              <button onClick={() => setShowAddEmpSkillModal(false)} className="cursor-pointer text-slate-400 hover:text-slate-700 transition-colors">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-4 p-6">
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">Skill *</label>
                <select
                  value={empSkillForm.skill_id}
                  onChange={(e) => setEmpSkillForm({ ...empSkillForm, skill_id: e.target.value })}
                  className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400"
                >
                  <option value="">Select a skill…</option>
                  {skillMaster.map((s) => (
                    <option key={s.id} value={s.id}>{s.skill_name}{s.skill_category ? ` (${s.skill_category})` : ""}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">Proficiency</label>
                <select
                  value={empSkillForm.proficiency}
                  onChange={(e) => setEmpSkillForm({ ...empSkillForm, proficiency: e.target.value as Proficiency })}
                  className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400"
                >
                  <option value="beginner">Beginner</option>
                  <option value="intermediate">Intermediate</option>
                  <option value="advanced">Advanced</option>
                  <option value="expert">Expert</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">Assessed Date</label>
                <input
                  type="date"
                  value={empSkillForm.assessed_date}
                  onChange={(e) => setEmpSkillForm({ ...empSkillForm, assessed_date: e.target.value })}
                  className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400"
                />
              </div>
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  id="certified"
                  checked={empSkillForm.certified}
                  onChange={(e) => setEmpSkillForm({ ...empSkillForm, certified: e.target.checked })}
                  className="h-4 w-4 rounded border-slate-300"
                />
                <label htmlFor="certified" className="text-sm font-semibold text-slate-700 cursor-pointer">
                  Certified
                </label>
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">Notes</label>
                <textarea
                  value={empSkillForm.notes}
                  onChange={(e) => setEmpSkillForm({ ...empSkillForm, notes: e.target.value })}
                  rows={2}
                  className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 resize-none transition-colors"
                />
              </div>
            </div>
            <div className="flex gap-3 border-t p-6">
              <button onClick={() => setShowAddEmpSkillModal(false)} className="flex-1 cursor-pointer rounded-2xl border border-slate-200 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors">Cancel</button>
              <button onClick={submitEmpSkill} disabled={saving} className="flex-1 cursor-pointer rounded-2xl bg-slate-950 py-3 text-sm font-bold text-white hover:bg-slate-800 transition-colors disabled:opacity-50">
                {saving ? "Saving…" : "Add Skill"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
