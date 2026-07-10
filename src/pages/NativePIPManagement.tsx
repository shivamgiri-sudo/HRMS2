import { useEffect, useState } from "react";
import {
  AlertTriangle, CheckCircle2, ChevronDown, ChevronRight,
  Clock, Loader, Plus, RefreshCcw, TrendingDown, X,
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";
import { formatISTDate } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

type PipStatus = "active" | "completed" | "extended" | "terminated";
type PipOutcome = "improved" | "not_improved" | "resigned" | "terminated";
type CheckpointRating = "on_track" | "at_risk" | "off_track";

interface PipCheckpoint {
  id: string;
  pip_id: string;
  checkpoint_date: string;
  rating: CheckpointRating;
  notes: string | null;
  recorded_by: string | null;
  created_at: string;
}

interface PipRecord {
  id: string;
  employee_id: string;
  employee_name?: string;
  employee_code?: string;
  initiated_by: string;
  start_date: string;
  end_date: string;
  reason: string;
  goals: unknown;
  status: PipStatus;
  outcome: PipOutcome | null;
  review_notes: string | null;
  closed_by: string | null;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
  checkpoints?: PipCheckpoint[];
}

interface NewPipForm {
  employee_id: string;
  start_date: string;
  end_date: string;
  reason: string;
  goals: string;
}

interface CheckpointForm {
  checkpoint_date: string;
  rating: CheckpointRating;
  notes: string;
}

interface ClosePipForm {
  outcome: PipOutcome | "";
  review_notes: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<PipStatus, string> = {
  active: "bg-amber-50 text-amber-700",
  completed: "bg-emerald-50 text-emerald-700",
  extended: "bg-blue-50 text-blue-700",
  terminated: "bg-red-50 text-red-700",
};

const OUTCOME_COLORS: Record<PipOutcome, string> = {
  improved: "bg-emerald-50 text-emerald-700",
  not_improved: "bg-red-50 text-red-700",
  resigned: "bg-slate-100 text-slate-700",
  terminated: "bg-rose-50 text-rose-700",
};

const RATING_COLORS: Record<CheckpointRating, string> = {
  on_track: "bg-emerald-50 text-emerald-700",
  at_risk: "bg-amber-50 text-amber-700",
  off_track: "bg-red-50 text-red-700",
};

function StatusBadge({ status }: { status: PipStatus }) {
  return (
    <span className={`rounded-full px-3 py-1 text-xs font-semibold capitalize ${STATUS_COLORS[status]}`}>
      {status.replace(/_/g, " ")}
    </span>
  );
}

function OutcomeBadge({ outcome }: { outcome: PipOutcome | null }) {
  if (!outcome) return <span className="text-slate-400">—</span>;
  return (
    <span className={`rounded-full px-3 py-1 text-xs font-semibold capitalize ${OUTCOME_COLORS[outcome]}`}>
      {outcome.replace(/_/g, " ")}
    </span>
  );
}

function RatingBadge({ rating }: { rating: CheckpointRating }) {
  return (
    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${RATING_COLORS[rating]}`}>
      {rating.replace(/_/g, " ")}
    </span>
  );
}

function daysRemaining(endDate: string): number {
  const end = new Date(endDate);
  const now = new Date();
  return Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

// ─── Add Checkpoint Modal ─────────────────────────────────────────────────────

function AddCheckpointModal({
  pipId,
  onClose,
  onSaved,
}: {
  pipId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<CheckpointForm>({
    checkpoint_date: new Date().toISOString().slice(0, 10),
    rating: "on_track",
    notes: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    setError("");
    setSaving(true);
    try {
      await hrmsApi.post(`/api/career/pip/${pipId}/checkpoints`, {
        checkpoint_date: form.checkpoint_date,
        rating: form.rating,
        notes: form.notes || null,
      });
      onSaved();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to add checkpoint.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-3xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b p-6">
          <h2 className="text-lg font-black text-slate-950">Add Checkpoint</h2>
          <button onClick={onClose} className="cursor-pointer text-slate-400 hover:text-slate-700 transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="space-y-4 p-6">
          {error && (
            <div className="flex items-center gap-2 rounded-2xl bg-red-50 p-3 text-sm font-semibold text-red-700">
              <AlertTriangle className="h-4 w-4 flex-shrink-0" />
              {error}
            </div>
          )}
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Date</label>
            <input
              type="date"
              value={form.checkpoint_date}
              onChange={(e) => setForm({ ...form, checkpoint_date: e.target.value })}
              className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 transition-colors"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Rating</label>
            <div className="flex gap-3">
              {(["on_track", "at_risk", "off_track"] as CheckpointRating[]).map((r) => (
                <button
                  key={r}
                  onClick={() => setForm({ ...form, rating: r })}
                  className={`flex-1 rounded-2xl border px-3 py-2.5 text-xs font-bold capitalize transition-colors cursor-pointer ${
                    form.rating === r
                      ? `${RATING_COLORS[r]} border-current`
                      : "border-slate-200 text-slate-500 hover:bg-slate-50"
                  }`}
                >
                  {r.replace(/_/g, " ")}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Notes</label>
            <textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="Checkpoint observations…"
              rows={3}
              className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 resize-none transition-colors"
            />
          </div>
        </div>
        <div className="flex gap-3 border-t p-6">
          <button
            onClick={onClose}
            className="flex-1 cursor-pointer rounded-2xl border border-slate-200 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => void save()}
            disabled={saving}
            className="flex-1 cursor-pointer rounded-2xl bg-slate-950 py-3 text-sm font-bold text-white hover:bg-slate-800 transition-colors disabled:opacity-50"
          >
            {saving ? "Saving…" : "Add Checkpoint"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Close PIP Modal ──────────────────────────────────────────────────────────

function ClosePipModal({
  pip,
  onClose,
  onSaved,
}: {
  pip: PipRecord;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<ClosePipForm>({ outcome: "", review_notes: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    setError("");
    if (!form.outcome) return setError("Please select an outcome.");
    setSaving(true);
    try {
      await hrmsApi.patch(`/api/career/pip/${pip.id}`, {
        status: "completed",
        outcome: form.outcome,
        review_notes: form.review_notes || null,
      });
      onSaved();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to close PIP.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-3xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b p-6">
          <h2 className="text-lg font-black text-slate-950">Close PIP</h2>
          <button onClick={onClose} className="cursor-pointer text-slate-400 hover:text-slate-700 transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="space-y-4 p-6">
          {error && (
            <div className="flex items-center gap-2 rounded-2xl bg-red-50 p-3 text-sm font-semibold text-red-700">
              <AlertTriangle className="h-4 w-4 flex-shrink-0" />
              {error}
            </div>
          )}
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Outcome</label>
            <select
              value={form.outcome}
              onChange={(e) => setForm({ ...form, outcome: e.target.value as PipOutcome | "" })}
              className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400"
            >
              <option value="">Select outcome…</option>
              <option value="improved">Improved</option>
              <option value="not_improved">Not Improved</option>
              <option value="resigned">Resigned</option>
              <option value="terminated">Terminated</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Review Notes</label>
            <textarea
              value={form.review_notes}
              onChange={(e) => setForm({ ...form, review_notes: e.target.value })}
              placeholder="Final review notes…"
              rows={3}
              className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 resize-none transition-colors"
            />
          </div>
        </div>
        <div className="flex gap-3 border-t p-6">
          <button
            onClick={onClose}
            className="flex-1 cursor-pointer rounded-2xl border border-slate-200 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => void save()}
            disabled={saving}
            className="flex-1 cursor-pointer rounded-2xl bg-slate-950 py-3 text-sm font-bold text-white hover:bg-slate-800 transition-colors disabled:opacity-50"
          >
            {saving ? "Closing…" : "Close PIP"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── New PIP Modal ────────────────────────────────────────────────────────────

function NewPipModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<NewPipForm>({
    employee_id: "",
    start_date: "",
    end_date: "",
    reason: "",
    goals: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    setError("");
    if (!form.employee_id.trim()) return setError("Employee ID is required.");
    if (!form.start_date) return setError("Start date is required.");
    if (!form.end_date) return setError("End date is required.");
    if (!form.reason.trim()) return setError("Reason is required.");

    let parsedGoals: unknown = null;
    if (form.goals.trim()) {
      try {
        parsedGoals = JSON.parse(form.goals);
      } catch {
        // treat as plain text array item
        parsedGoals = [form.goals.trim()];
      }
    }

    setSaving(true);
    try {
      await hrmsApi.post("/api/career/pip", {
        employee_id: form.employee_id.trim(),
        start_date: form.start_date,
        end_date: form.end_date,
        reason: form.reason.trim(),
        goals: parsedGoals,
      });
      onSaved();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to create PIP.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg rounded-3xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b p-6">
          <h2 className="text-lg font-black text-slate-950">New PIP</h2>
          <button onClick={onClose} className="cursor-pointer text-slate-400 hover:text-slate-700 transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="space-y-4 p-6">
          {error && (
            <div className="flex items-center gap-2 rounded-2xl bg-red-50 p-3 text-sm font-semibold text-red-700">
              <AlertTriangle className="h-4 w-4 flex-shrink-0" />
              {error}
            </div>
          )}
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Employee ID / UUID</label>
            <input
              value={form.employee_id}
              onChange={(e) => setForm({ ...form, employee_id: e.target.value })}
              placeholder="Enter employee UUID"
              className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 transition-colors"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1.5">Start Date</label>
              <input
                type="date"
                value={form.start_date}
                onChange={(e) => setForm({ ...form, start_date: e.target.value })}
                className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1.5">End Date</label>
              <input
                type="date"
                value={form.end_date}
                onChange={(e) => setForm({ ...form, end_date: e.target.value })}
                className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Reason</label>
            <textarea
              value={form.reason}
              onChange={(e) => setForm({ ...form, reason: e.target.value })}
              placeholder="Reason for the PIP…"
              rows={3}
              className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 resize-none transition-colors"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Goals (JSON array or plain text)</label>
            <textarea
              value={form.goals}
              onChange={(e) => setForm({ ...form, goals: e.target.value })}
              placeholder='["Improve call quality", "Meet 95% attendance"] or plain text'
              rows={2}
              className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 resize-none transition-colors font-mono text-xs"
            />
          </div>
        </div>
        <div className="flex gap-3 border-t p-6">
          <button
            onClick={onClose}
            className="flex-1 cursor-pointer rounded-2xl border border-slate-200 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => void save()}
            disabled={saving}
            className="flex-1 cursor-pointer rounded-2xl bg-slate-950 py-3 text-sm font-bold text-white hover:bg-slate-800 transition-colors disabled:opacity-50"
          >
            {saving ? "Creating…" : "Create PIP"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── PIP Detail Panel ─────────────────────────────────────────────────────────

function PipDetailPanel({
  pip,
  onClose,
  onRefresh,
}: {
  pip: PipRecord & { checkpoints: PipCheckpoint[] };
  onClose: () => void;
  onRefresh: () => void;
}) {
  const [showCheckpointModal, setShowCheckpointModal] = useState(false);
  const [showCloseModal, setShowCloseModal] = useState(false);
  const days = daysRemaining(pip.end_date);

  return (
    <div className="rounded-3xl border bg-white shadow-sm">
      <div className="flex items-start justify-between border-b p-5">
        <div>
          <h3 className="font-black text-slate-950 text-lg">
            {pip.employee_name ?? pip.employee_id}
          </h3>
          {pip.employee_code && (
            <p className="font-mono text-xs text-slate-400">{pip.employee_code}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={pip.status} />
          <button
            onClick={onClose}
            className="cursor-pointer text-slate-400 hover:text-slate-700 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>

      <div className="space-y-5 p-5">
        {/* Duration */}
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-2xl bg-slate-50 p-3 text-xs">
            <p className="font-semibold text-slate-500">Start</p>
            <p className="mt-0.5 font-mono text-slate-700">{pip.start_date.slice(0, 10)}</p>
          </div>
          <div className="rounded-2xl bg-slate-50 p-3 text-xs">
            <p className="font-semibold text-slate-500">End</p>
            <p className="mt-0.5 font-mono text-slate-700">{pip.end_date.slice(0, 10)}</p>
          </div>
          <div className={`rounded-2xl p-3 text-xs ${days < 0 ? "bg-slate-100" : days <= 7 ? "bg-red-50" : "bg-amber-50"}`}>
            <p className="font-semibold text-slate-500">Days Left</p>
            <p className={`mt-0.5 font-bold ${days < 0 ? "text-slate-400" : days <= 7 ? "text-red-700" : "text-amber-700"}`}>
              {days < 0 ? "Elapsed" : `${days}d`}
            </p>
          </div>
        </div>

        {/* Reason */}
        <div>
          <p className="text-xs font-semibold text-slate-500 mb-1">Reason</p>
          <p className="text-sm text-slate-700">{pip.reason}</p>
        </div>

        {/* Goals */}
        {pip.goals && (
          <div>
            <p className="text-xs font-semibold text-slate-500 mb-2">Goals</p>
            {Array.isArray(pip.goals) ? (
              <ul className="space-y-1">
                {(pip.goals as string[]).map((g, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-slate-700">
                    <ChevronRight className="h-4 w-4 flex-shrink-0 mt-0.5 text-slate-400" />
                    {g}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-slate-700">{JSON.stringify(pip.goals)}</p>
            )}
          </div>
        )}

        {/* Checkpoints timeline */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-semibold text-slate-500">Checkpoints</p>
            {pip.status === "active" && (
              <button
                onClick={() => setShowCheckpointModal(true)}
                className="inline-flex items-center gap-1.5 rounded-xl bg-blue-50 px-3 py-1.5 text-xs font-bold text-blue-700 hover:bg-blue-100 transition-colors cursor-pointer"
              >
                <Plus className="h-3.5 w-3.5" />
                Add
              </button>
            )}
          </div>
          {pip.checkpoints.length === 0 ? (
            <p className="text-xs text-slate-400 italic">No checkpoints recorded yet.</p>
          ) : (
            <div className="relative space-y-3 pl-5">
              <div className="absolute left-1.5 top-0 h-full w-0.5 bg-slate-100" />
              {pip.checkpoints.map((cp) => (
                <div key={cp.id} className="relative">
                  <div className="absolute -left-4 top-1 h-2.5 w-2.5 rounded-full border-2 border-white bg-slate-300" />
                  <div className="rounded-2xl bg-slate-50 p-3">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-xs text-slate-500">{cp.checkpoint_date.slice(0, 10)}</span>
                      <RatingBadge rating={cp.rating} />
                    </div>
                    {cp.notes && <p className="mt-1.5 text-xs text-slate-600">{cp.notes}</p>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Review notes */}
        {pip.review_notes && (
          <div>
            <p className="text-xs font-semibold text-slate-500 mb-1">Review Notes</p>
            <p className="text-sm text-slate-700">{pip.review_notes}</p>
          </div>
        )}

        {/* Outcome */}
        {pip.outcome && (
          <div className="flex items-center gap-3">
            <p className="text-xs font-semibold text-slate-500">Outcome</p>
            <OutcomeBadge outcome={pip.outcome} />
          </div>
        )}
      </div>

      {/* Actions */}
      {pip.status === "active" && (
        <div className="border-t p-5">
          <button
            onClick={() => setShowCloseModal(true)}
            className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-5 py-2.5 text-sm font-bold text-white hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <CheckCircle2 className="h-4 w-4" />
            Close PIP
          </button>
        </div>
      )}

      {showCheckpointModal && (
        <AddCheckpointModal
          pipId={pip.id}
          onClose={() => setShowCheckpointModal(false)}
          onSaved={() => {
            setShowCheckpointModal(false);
            onRefresh();
          }}
        />
      )}

      {showCloseModal && (
        <ClosePipModal
          pip={pip}
          onClose={() => setShowCloseModal(false)}
          onSaved={() => {
            setShowCloseModal(false);
            onRefresh();
          }}
        />
      )}
    </div>
  );
}

// ─── Active PIPs Tab ──────────────────────────────────────────────────────────

function ActivePipsTab({
  pips,
  loading,
  onRefresh,
  onNew,
}: {
  pips: PipRecord[];
  loading: boolean;
  onRefresh: () => void;
  onNew: () => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<(PipRecord & { checkpoints: PipCheckpoint[] }) | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const active = pips.filter((p) => p.status === "active");

  const openDetail = async (id: string) => {
    setSelectedId(id);
    setLoadingDetail(true);
    try {
      const res = await hrmsApi.get<{ success: boolean; data: PipRecord & { checkpoints: PipCheckpoint[] } }>(
        `/api/career/pip/${id}`
      );
      setDetail(res.data);
    } catch {
      /* silent */
    } finally {
      setLoadingDetail(false);
    }
  };

  const refreshDetail = async () => {
    if (!selectedId) return;
    await openDetail(selectedId);
    onRefresh();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">{active.length} active PIP(s)</p>
        <div className="flex gap-3">
          <button
            onClick={onRefresh}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 transition-colors cursor-pointer disabled:opacity-50"
          >
            <RefreshCcw className="h-4 w-4" />
            Refresh
          </button>
          <button
            onClick={onNew}
            className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-5 py-2.5 text-sm font-bold text-white hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <Plus className="h-4 w-4" />
            New PIP
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader className="h-8 w-8 animate-spin text-slate-400" />
        </div>
      ) : active.length === 0 ? (
        <div className="rounded-3xl border bg-white py-16 text-center text-slate-400 shadow-sm">
          <TrendingDown className="mx-auto mb-3 h-10 w-10 opacity-30" />
          <p className="font-semibold">No active PIPs.</p>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {active.map((pip) => {
            const days = daysRemaining(pip.end_date);
            const isSelected = selectedId === pip.id;
            return (
              <div key={pip.id} className="space-y-3">
                <button
                  onClick={() => (isSelected ? setSelectedId(null) : void openDetail(pip.id))}
                  className={`w-full rounded-3xl border bg-white p-5 text-left shadow-sm hover:shadow-md transition-all cursor-pointer ${
                    isSelected ? "ring-2 ring-blue-400" : ""
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-black text-slate-950">{pip.employee_name ?? pip.employee_id}</p>
                      {pip.employee_code && (
                        <p className="font-mono text-xs text-slate-400">{pip.employee_code}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <StatusBadge status={pip.status} />
                      <ChevronDown className={`h-4 w-4 text-slate-400 transition-transform ${isSelected ? "rotate-180" : ""}`} />
                    </div>
                  </div>
                  <div className="mt-3 flex items-center gap-4 text-xs text-slate-500">
                    <span className="flex items-center gap-1">
                      <Clock className="h-3.5 w-3.5" />
                      {pip.start_date.slice(0, 10)} → {pip.end_date.slice(0, 10)}
                    </span>
                    <span className={`font-bold ${days < 0 ? "text-slate-400" : days <= 7 ? "text-red-600" : "text-amber-600"}`}>
                      {days < 0 ? "Elapsed" : `${days}d left`}
                    </span>
                  </div>
                </button>

                {isSelected && (
                  loadingDetail ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader className="h-6 w-6 animate-spin text-slate-400" />
                    </div>
                  ) : detail?.id === pip.id ? (
                    <PipDetailPanel
                      pip={detail}
                      onClose={() => { setSelectedId(null); setDetail(null); }}
                      onRefresh={refreshDetail}
                    />
                  ) : null
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── All PIPs Tab ─────────────────────────────────────────────────────────────

function AllPipsTab({
  pips,
  loading,
  onRefresh,
  onNew,
}: {
  pips: PipRecord[];
  loading: boolean;
  onRefresh: () => void;
  onNew: () => void;
}) {
  const [statusFilter, setStatusFilter] = useState<"all" | PipStatus>("all");

  const filtered = statusFilter === "all" ? pips : pips.filter((p) => p.status === statusFilter);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap gap-2">
          {(["all", "active", "completed", "extended", "terminated"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`rounded-xl px-3 py-1.5 text-xs font-semibold capitalize transition-colors cursor-pointer ${
                statusFilter === s ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
        <div className="flex gap-3">
          <button
            onClick={onRefresh}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 transition-colors cursor-pointer disabled:opacity-50"
          >
            <RefreshCcw className="h-4 w-4" />
            Refresh
          </button>
          <button
            onClick={onNew}
            className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-5 py-2.5 text-sm font-bold text-white hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <Plus className="h-4 w-4" />
            New PIP
          </button>
        </div>
      </div>

      <div className="overflow-hidden rounded-3xl border bg-white shadow-sm">
        <div className="border-b p-5">
          <h2 className="font-black text-slate-950">PIP History</h2>
          <p className="text-sm text-slate-500">{filtered.length} records</p>
        </div>
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader className="h-8 w-8 animate-spin text-slate-400" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center text-slate-400">
            <TrendingDown className="mx-auto mb-3 h-10 w-10 opacity-30" />
            <p className="font-semibold">No PIPs found.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[800px] text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  {["Employee", "Period", "Days", "Status", "Outcome", "Reason", "Created"].map((h) => (
                    <th key={h} className="p-4 font-semibold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((pip) => {
                  const days = daysRemaining(pip.end_date);
                  return (
                    <tr key={pip.id} className="border-t hover:bg-slate-50/80 transition-colors">
                      <td className="p-4">
                        <div className="font-bold text-slate-950">{pip.employee_name ?? pip.employee_id}</div>
                        {pip.employee_code && (
                          <div className="font-mono text-xs text-slate-400">{pip.employee_code}</div>
                        )}
                      </td>
                      <td className="p-4 font-mono text-xs text-slate-500">
                        {pip.start_date.slice(0, 10)}<br />{pip.end_date.slice(0, 10)}
                      </td>
                      <td className="p-4 text-xs font-bold">
                        {pip.status === "active" ? (
                          <span className={days < 0 ? "text-slate-400" : days <= 7 ? "text-red-600" : "text-amber-600"}>
                            {days < 0 ? "Elapsed" : `${days}d`}
                          </span>
                        ) : "—"}
                      </td>
                      <td className="p-4">
                        <StatusBadge status={pip.status} />
                      </td>
                      <td className="p-4">
                        <OutcomeBadge outcome={pip.outcome} />
                      </td>
                      <td className="p-4 max-w-[200px] truncate text-slate-600" title={pip.reason}>
                        {pip.reason}
                      </td>
                      <td className="p-4 font-mono text-xs text-slate-400">
                        {formatISTDate(pip.created_at)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

const TABS = ["Active PIPs", "All PIPs"] as const;
type Tab = (typeof TABS)[number];

export default function NativePIPManagement() {
  const [tab, setTab] = useState<Tab>("Active PIPs");
  const [pips, setPips] = useState<PipRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showNewModal, setShowNewModal] = useState(false);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await hrmsApi.get<{ success: boolean; data: PipRecord[] }>("/api/career/pip");
      setPips(res.data ?? []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load PIPs.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <p className="text-sm font-black uppercase tracking-[0.2em] text-blue-600">HR Operations</p>
          <h1 className="mt-2 text-3xl font-black text-slate-950">PIP Management</h1>
          <p className="mt-2 max-w-4xl text-slate-600">
            Manage Performance Improvement Plans, track checkpoints, and record outcomes.
          </p>
        </div>

        {error && (
          <div className="flex items-center gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">
            <AlertTriangle className="h-4 w-4 flex-shrink-0" />
            {error}
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 rounded-2xl bg-slate-100 p-1 w-fit">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded-xl px-5 py-2.5 text-sm font-semibold transition-colors cursor-pointer ${
                tab === t ? "bg-white text-slate-950 shadow-sm" : "text-slate-500 hover:text-slate-700"
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {tab === "Active PIPs" && (
          <ActivePipsTab
            pips={pips}
            loading={loading}
            onRefresh={() => void load()}
            onNew={() => setShowNewModal(true)}
          />
        )}
        {tab === "All PIPs" && (
          <AllPipsTab
            pips={pips}
            loading={loading}
            onRefresh={() => void load()}
            onNew={() => setShowNewModal(true)}
          />
        )}
      </div>

      {showNewModal && (
        <NewPipModal
          onClose={() => setShowNewModal(false)}
          onSaved={() => {
            setShowNewModal(false);
            void load();
          }}
        />
      )}
    </DashboardLayout>
  );
}
