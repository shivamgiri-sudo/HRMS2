import { useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowLeftRight,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  Clock,
  Loader,
  Plus,
  RefreshCcw,
  TrendingDown,
  UserCheck,
  Users,
  X,
  Zap,
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SwapStatus = "pending" | "approved" | "rejected";

interface SwapRequest {
  id: string;
  requester_employee_id: string;
  requester_name?: string;
  target_employee_id: string;
  target_name?: string;
  swap_date: string;
  shift_id: string;
  shift_name?: string;
  reason: string;
  status: SwapStatus;
  created_at: string;
}

type ConflictSeverity = "low" | "medium" | "high" | "critical";
type ConflictStatus = "open" | "resolved";

interface RosterConflict {
  id: string;
  conflict_type: string;
  conflict_date: string;
  employees_involved: string[];
  employee_names?: string[];
  severity: ConflictSeverity;
  status: ConflictStatus;
  resolution_remarks?: string;
  created_at: string;
}

interface CoverageGap {
  process?: string;
  branch?: string;
  gap_count: number;
  note?: string;
}

interface CoverageData {
  required_headcount: number;
  available_headcount: number;
  coverage_pct: number;
  gaps: CoverageGap[];
}

interface AttritionByReason {
  reason: string;
  count: number;
  pct: number;
}

interface AttritionSummary {
  total_exits: number;
  voluntary: number;
  involuntary: number;
  attrition_rate: number;
  by_reason: AttritionByReason[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type TabKey = "swaps" | "conflicts" | "coverage" | "attrition";

const SWAP_STATUS_CLS: Record<SwapStatus, string> = {
  pending:  "bg-amber-50 text-amber-700",
  approved: "bg-emerald-50 text-emerald-700",
  rejected: "bg-red-50 text-red-700",
};

const SEVERITY_CLS: Record<ConflictSeverity, string> = {
  low:      "bg-slate-100 text-slate-600",
  medium:   "bg-amber-50 text-amber-700",
  high:     "bg-orange-50 text-orange-700",
  critical: "bg-red-50 text-red-700",
};

function Badge({ label, cls }: { label: string; cls: string }) {
  return (
    <span className={`rounded-full px-3 py-1 text-xs font-semibold capitalize ${cls}`}>
      {label}
    </span>
  );
}

function coverageColor(pct: number): string {
  if (pct >= 90) return "text-emerald-600";
  if (pct >= 70) return "text-amber-600";
  return "text-red-600";
}

function coverageBg(pct: number): string {
  if (pct >= 90) return "bg-emerald-50 border-emerald-200";
  if (pct >= 70) return "bg-amber-50 border-amber-200";
  return "bg-red-50 border-red-200";
}

function Label({ children }: { children: React.ReactNode }) {
  return <label className="block text-sm font-semibold text-slate-700 mb-1.5">{children}</label>;
}

function FieldInput({
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 transition-colors"
    />
  );
}

function FieldSelect({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full appearance-none rounded-2xl border px-4 py-3 pr-9 text-sm outline-none focus:border-blue-400 transition-colors bg-white"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
    </div>
  );
}

function ModalShell({
  title,
  onClose,
  children,
  footer,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg rounded-3xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b p-6">
          <h2 className="text-lg font-black text-slate-950">{title}</h2>
          <button onClick={onClose} className="cursor-pointer text-slate-400 hover:text-slate-700 transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="space-y-4 p-6">{children}</div>
        <div className="flex gap-3 border-t p-6">{footer}</div>
      </div>
    </div>
  );
}

function SummaryCard({
  title,
  value,
  sub,
  icon,
  tone,
}: {
  title: string;
  value: string | number;
  sub?: string;
  icon: React.ReactNode;
  tone: string;
}) {
  return (
    <div className="glass-card stat-card rounded-3xl p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-slate-500">{title}</p>
          <p className="mt-2 text-3xl font-black tracking-tight text-slate-950">{value}</p>
          {sub && <p className="mt-1 text-xs text-slate-400">{sub}</p>}
        </div>
        <div className={`rounded-2xl p-3 ${tone}`}>{icon}</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: Roster Swaps
// ---------------------------------------------------------------------------

function RosterSwapsTab() {
  const [swaps, setSwaps] = useState<SwapRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | SwapStatus>("all");
  const [showCreate, setShowCreate] = useState(false);
  const [reviewTarget, setReviewTarget] = useState<SwapRequest | null>(null);
  const [reviewAction, setReviewAction] = useState<"approved" | "rejected">("approved");
  const [reviewRemarks, setReviewRemarks] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const [createForm, setCreateForm] = useState({
    requester_employee_id: "",
    target_employee_id: "",
    swap_date: "",
    shift_id: "",
    reason: "",
  });

  const load = async () => {
    setLoading(true);
    setMessage("");
    try {
      const params = new URLSearchParams();
      if (statusFilter !== "all") params.set("status", statusFilter);
      const res = await hrmsApi.get<{ success: boolean; data: SwapRequest[] }>(
        `/api/wfm-ext/roster/swaps?${params.toString()}`
      );
      setSwaps(res.data ?? []);
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Failed to load swap requests");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [statusFilter]);

  const submitCreate = async () => {
    if (!createForm.requester_employee_id.trim() || !createForm.target_employee_id.trim()) {
      setMessage("Requester and target employee IDs are required.");
      return;
    }
    setSubmitting(true);
    try {
      await hrmsApi.post("/api/wfm-ext/roster/swaps", createForm);
      setShowCreate(false);
      setCreateForm({ requester_employee_id: "", target_employee_id: "", swap_date: "", shift_id: "", reason: "" });
      setMessage("Swap request created.");
      await load();
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Failed to create swap request");
    } finally {
      setSubmitting(false);
    }
  };

  const submitReview = async () => {
    if (!reviewTarget) return;
    setSubmitting(true);
    try {
      await hrmsApi.post(`/api/wfm-ext/roster/swaps/${reviewTarget.id}/review`, {
        action: reviewAction,
        remarks: reviewRemarks,
      });
      setReviewTarget(null);
      setReviewRemarks("");
      setMessage(`Swap request ${reviewAction}.`);
      await load();
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Failed to review swap request");
    } finally {
      setSubmitting(false);
    }
  };

  const STATUS_OPTIONS: { value: "all" | SwapStatus; label: string }[] = [
    { value: "all", label: "All" },
    { value: "pending", label: "Pending" },
    { value: "approved", label: "Approved" },
    { value: "rejected", label: "Rejected" },
  ];

  return (
    <>
      {message && (
        <div className="flex items-center gap-3 rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm font-bold text-blue-800">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />
          {message}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {STATUS_OPTIONS.map((o) => (
            <button
              key={o.value}
              onClick={() => setStatusFilter(o.value)}
              className={`rounded-xl px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
                statusFilter === o.value
                  ? "bg-slate-950 text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => load()}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 transition-colors cursor-pointer disabled:opacity-50"
          >
            <RefreshCcw className="h-4 w-4" />
            Refresh
          </button>
          <button
            onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-bold text-white hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <Plus className="h-4 w-4" />
            Request Swap
          </button>
        </div>
      </div>

      <div className="overflow-hidden rounded-3xl border bg-white shadow-sm">
        <div className="border-b p-5">
          <h2 className="font-black text-slate-950">Swap Requests</h2>
          <p className="text-sm text-slate-500">{swaps.length} records</p>
        </div>
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader className="h-8 w-8 animate-spin text-slate-400" />
          </div>
        ) : swaps.length === 0 ? (
          <div className="py-16 text-center text-slate-400">
            <ArrowLeftRight className="mx-auto mb-3 h-10 w-10 opacity-30" />
            <p className="font-semibold">No swap requests found.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  {["Requester", "Target Employee", "Swap Date", "Shift", "Reason", "Status", "Actions"].map((h) => (
                    <th key={h} className="p-4 font-semibold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {swaps.map((s) => (
                  <tr key={s.id} className="border-t hover:bg-slate-50/80 transition-colors">
                    <td className="p-4">
                      <div className="font-bold text-slate-950">{s.requester_name ?? s.requester_employee_id}</div>
                      <div className="text-xs text-slate-400 font-mono">{s.requester_employee_id.slice(0, 8)}</div>
                    </td>
                    <td className="p-4">
                      <div className="font-semibold text-slate-700">{s.target_name ?? s.target_employee_id}</div>
                      <div className="text-xs text-slate-400 font-mono">{s.target_employee_id.slice(0, 8)}</div>
                    </td>
                    <td className="p-4 font-mono text-slate-600">{s.swap_date}</td>
                    <td className="p-4 text-slate-500">{s.shift_name ?? s.shift_id}</td>
                    <td className="p-4 max-w-[180px] truncate text-slate-500" title={s.reason}>{s.reason || "–"}</td>
                    <td className="p-4">
                      <Badge label={s.status} cls={SWAP_STATUS_CLS[s.status]} />
                    </td>
                    <td className="p-4">
                      {s.status === "pending" && (
                        <div className="flex gap-1">
                          <button
                            onClick={() => { setReviewTarget(s); setReviewAction("approved"); }}
                            className="cursor-pointer rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 transition-colors"
                          >
                            Approve
                          </button>
                          <button
                            onClick={() => { setReviewTarget(s); setReviewAction("rejected"); }}
                            className="cursor-pointer rounded-lg border border-rose-200 px-2.5 py-1.5 text-xs font-bold text-rose-600 hover:bg-rose-50 transition-colors"
                          >
                            Reject
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create Swap Modal */}
      {showCreate && (
        <ModalShell
          title="Request Roster Swap"
          onClose={() => setShowCreate(false)}
          footer={
            <>
              <button
                onClick={() => setShowCreate(false)}
                className="flex-1 cursor-pointer rounded-2xl border border-slate-200 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={submitCreate}
                disabled={submitting}
                className="flex-1 cursor-pointer rounded-2xl bg-slate-950 py-3 text-sm font-bold text-white hover:bg-slate-800 transition-colors disabled:opacity-50"
              >
                {submitting ? "Submitting…" : "Submit Request"}
              </button>
            </>
          }
        >
          <div>
            <Label>Requester Employee ID</Label>
            <FieldInput
              value={createForm.requester_employee_id}
              onChange={(v) => setCreateForm({ ...createForm, requester_employee_id: v })}
              placeholder="Enter requester UUID"
            />
          </div>
          <div>
            <Label>Target Employee ID</Label>
            <FieldInput
              value={createForm.target_employee_id}
              onChange={(v) => setCreateForm({ ...createForm, target_employee_id: v })}
              placeholder="Enter target UUID"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Swap Date</Label>
              <FieldInput
                type="date"
                value={createForm.swap_date}
                onChange={(v) => setCreateForm({ ...createForm, swap_date: v })}
              />
            </div>
            <div>
              <Label>Shift ID</Label>
              <FieldInput
                value={createForm.shift_id}
                onChange={(v) => setCreateForm({ ...createForm, shift_id: v })}
                placeholder="e.g. SHIFT-001"
              />
            </div>
          </div>
          <div>
            <Label>Reason</Label>
            <textarea
              value={createForm.reason}
              onChange={(e) => setCreateForm({ ...createForm, reason: e.target.value })}
              placeholder="Brief reason for the swap…"
              rows={3}
              className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 resize-none transition-colors"
            />
          </div>
        </ModalShell>
      )}

      {/* Review Modal */}
      {reviewTarget && (
        <ModalShell
          title={`Review Swap Request`}
          onClose={() => { setReviewTarget(null); setReviewRemarks(""); }}
          footer={
            <>
              <button
                onClick={() => { setReviewTarget(null); setReviewRemarks(""); }}
                className="flex-1 cursor-pointer rounded-2xl border border-slate-200 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={submitReview}
                disabled={submitting}
                className={`flex-1 cursor-pointer rounded-2xl py-3 text-sm font-bold text-white transition-colors disabled:opacity-50 ${
                  reviewAction === "approved" ? "bg-emerald-600 hover:bg-emerald-700" : "bg-rose-600 hover:bg-rose-700"
                }`}
              >
                {submitting ? "Saving…" : reviewAction === "approved" ? "Approve" : "Reject"}
              </button>
            </>
          }
        >
          <div className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-700 space-y-1">
            <p><span className="font-semibold">Requester:</span> {reviewTarget.requester_name ?? reviewTarget.requester_employee_id}</p>
            <p><span className="font-semibold">Target:</span> {reviewTarget.target_name ?? reviewTarget.target_employee_id}</p>
            <p><span className="font-semibold">Swap Date:</span> {reviewTarget.swap_date}</p>
          </div>
          <div>
            <Label>Action</Label>
            <FieldSelect
              value={reviewAction}
              onChange={(v) => setReviewAction(v as "approved" | "rejected")}
              options={[
                { value: "approved", label: "Approve" },
                { value: "rejected", label: "Reject" },
              ]}
            />
          </div>
          <div>
            <Label>Remarks</Label>
            <textarea
              value={reviewRemarks}
              onChange={(e) => setReviewRemarks(e.target.value)}
              placeholder="Add remarks (optional)…"
              rows={3}
              className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 resize-none transition-colors"
            />
          </div>
        </ModalShell>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Tab: Roster Conflicts
// ---------------------------------------------------------------------------

function ConflictsTab() {
  const [conflicts, setConflicts] = useState<RosterConflict[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | ConflictStatus>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [resolveTarget, setResolveTarget] = useState<RosterConflict | null>(null);
  const [resolution, setResolution] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    setLoading(true);
    setMessage("");
    try {
      const params = new URLSearchParams();
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (dateFrom) params.set("date_from", dateFrom);
      if (dateTo) params.set("date_to", dateTo);
      const res = await hrmsApi.get<{ success: boolean; data: RosterConflict[] }>(
        `/api/wfm-ext/roster/conflicts?${params.toString()}`
      );
      setConflicts(res.data ?? []);
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Failed to load conflicts");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [statusFilter, dateFrom, dateTo]);

  const submitResolve = async () => {
    if (!resolveTarget) return;
    if (!resolution.trim()) { setMessage("Resolution action is required."); return; }
    setSubmitting(true);
    try {
      await hrmsApi.post(`/api/wfm-ext/roster/conflicts/${resolveTarget.id}/resolve`, {
        resolution_action: resolution,
        remarks: resolution,
      });
      setResolveTarget(null);
      setResolution("");
      setMessage("Conflict resolved.");
      await load();
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Failed to resolve conflict");
    } finally {
      setSubmitting(false);
    }
  };

  const STATUS_OPTIONS: { value: "all" | ConflictStatus; label: string }[] = [
    { value: "all", label: "All" },
    { value: "open", label: "Open" },
    { value: "resolved", label: "Resolved" },
  ];

  return (
    <>
      {message && (
        <div className="flex items-center gap-3 rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm font-bold text-blue-800">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />
          {message}
        </div>
      )}

      <div className="rounded-3xl border bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex flex-wrap gap-2">
            {STATUS_OPTIONS.map((o) => (
              <button
                key={o.value}
                onClick={() => setStatusFilter(o.value)}
                className={`rounded-xl px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
                  statusFilter === o.value
                    ? "bg-slate-950 text-white"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 ml-auto">
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="rounded-xl border px-3 py-1.5 text-xs outline-none focus:border-blue-400 transition-colors"
            />
            <span className="text-xs text-slate-400">to</span>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="rounded-xl border px-3 py-1.5 text-xs outline-none focus:border-blue-400 transition-colors"
            />
            <button
              onClick={() => load()}
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer disabled:opacity-50"
            >
              <RefreshCcw className="h-3.5 w-3.5" />
              Refresh
            </button>
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-3xl border bg-white shadow-sm">
        <div className="border-b p-5">
          <h2 className="font-black text-slate-950">Roster Conflicts</h2>
          <p className="text-sm text-slate-500">{conflicts.length} records</p>
        </div>
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader className="h-8 w-8 animate-spin text-slate-400" />
          </div>
        ) : conflicts.length === 0 ? (
          <div className="py-16 text-center text-slate-400">
            <CheckCircle2 className="mx-auto mb-3 h-10 w-10 opacity-30" />
            <p className="font-semibold">No conflicts found.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  {["Type", "Date", "Employees Involved", "Severity", "Status", "Actions"].map((h) => (
                    <th key={h} className="p-4 font-semibold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {conflicts.map((c) => (
                  <tr key={c.id} className="border-t hover:bg-slate-50/80 transition-colors">
                    <td className="p-4 font-semibold text-slate-950 capitalize">{c.conflict_type.replace(/_/g, " ")}</td>
                    <td className="p-4 font-mono text-slate-600">{c.conflict_date}</td>
                    <td className="p-4">
                      <div className="flex flex-wrap gap-1">
                        {(c.employee_names ?? c.employees_involved).slice(0, 3).map((n, i) => (
                          <span key={i} className="rounded-lg bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{n}</span>
                        ))}
                        {c.employees_involved.length > 3 && (
                          <span className="rounded-lg bg-slate-100 px-2 py-0.5 text-xs text-slate-400">
                            +{c.employees_involved.length - 3}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="p-4">
                      <Badge label={c.severity} cls={SEVERITY_CLS[c.severity]} />
                    </td>
                    <td className="p-4">
                      {c.status === "resolved" ? (
                        <Badge label="Resolved" cls="bg-emerald-50 text-emerald-700" />
                      ) : (
                        <Badge label="Open" cls="bg-amber-50 text-amber-700" />
                      )}
                    </td>
                    <td className="p-4">
                      {c.status === "open" && (
                        <button
                          onClick={() => setResolveTarget(c)}
                          className="cursor-pointer rounded-lg bg-slate-950 px-2.5 py-1.5 text-xs font-bold text-white hover:bg-slate-700 transition-colors"
                        >
                          Resolve
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

      {/* Resolve Modal */}
      {resolveTarget && (
        <ModalShell
          title="Resolve Conflict"
          onClose={() => { setResolveTarget(null); setResolution(""); }}
          footer={
            <>
              <button
                onClick={() => { setResolveTarget(null); setResolution(""); }}
                className="flex-1 cursor-pointer rounded-2xl border border-slate-200 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={submitResolve}
                disabled={submitting}
                className="flex-1 cursor-pointer rounded-2xl bg-emerald-600 py-3 text-sm font-bold text-white hover:bg-emerald-700 transition-colors disabled:opacity-50"
              >
                {submitting ? "Resolving…" : "Resolve"}
              </button>
            </>
          }
        >
          <div className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-700 space-y-1">
            <p><span className="font-semibold">Type:</span> {resolveTarget.conflict_type.replace(/_/g, " ")}</p>
            <p><span className="font-semibold">Date:</span> {resolveTarget.conflict_date}</p>
            <p><span className="font-semibold">Severity:</span> {resolveTarget.severity}</p>
          </div>
          <div>
            <Label>Resolution Action</Label>
            <textarea
              value={resolution}
              onChange={(e) => setResolution(e.target.value)}
              placeholder="Describe how the conflict was resolved…"
              rows={4}
              className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 resize-none transition-colors"
            />
          </div>
        </ModalShell>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Tab: Coverage
// ---------------------------------------------------------------------------

function CoverageTab() {
  const [coverageDate, setCoverageDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [processId, setProcessId] = useState("");
  const [branchId, setBranchId] = useState("");
  const [coverage, setCoverage] = useState<CoverageData | null>(null);
  const [loading, setLoading] = useState(false);
  const [snapLoading, setSnapLoading] = useState(false);
  const [message, setMessage] = useState("");

  const load = async () => {
    setLoading(true);
    setMessage("");
    try {
      const params = new URLSearchParams({ date: coverageDate });
      if (processId) params.set("process_id", processId);
      if (branchId) params.set("branch_id", branchId);
      const res = await hrmsApi.get<CoverageData>(`/api/wfm-ext/coverage?${params.toString()}`);
      setCoverage(res);
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Failed to load coverage data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [coverageDate, processId, branchId]);

  const takeSnapshot = async () => {
    setSnapLoading(true);
    try {
      await hrmsApi.post("/api/wfm-ext/coverage/snapshot", {
        date: coverageDate,
        process_id: processId || undefined,
      });
      setMessage("Coverage snapshot archived successfully.");
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Failed to take snapshot");
    } finally {
      setSnapLoading(false);
    }
  };

  return (
    <>
      {message && (
        <div className="flex items-center gap-3 rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm font-bold text-blue-800">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />
          {message}
        </div>
      )}

      {/* Filters */}
      <div className="rounded-3xl border bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <p className="mb-1 text-xs font-semibold text-slate-500">Date</p>
            <input
              type="date"
              value={coverageDate}
              onChange={(e) => setCoverageDate(e.target.value)}
              className="rounded-2xl border px-3 py-2 text-sm outline-none focus:border-blue-400 transition-colors"
            />
          </div>
          <div className="flex-1 min-w-[140px]">
            <p className="mb-1 text-xs font-semibold text-slate-500">Process ID</p>
            <input
              value={processId}
              onChange={(e) => setProcessId(e.target.value)}
              placeholder="All processes"
              className="w-full rounded-2xl border px-3 py-2 text-sm outline-none focus:border-blue-400 transition-colors"
            />
          </div>
          <div className="flex-1 min-w-[140px]">
            <p className="mb-1 text-xs font-semibold text-slate-500">Branch ID</p>
            <input
              value={branchId}
              onChange={(e) => setBranchId(e.target.value)}
              placeholder="All branches"
              className="w-full rounded-2xl border px-3 py-2 text-sm outline-none focus:border-blue-400 transition-colors"
            />
          </div>
          <div className="flex gap-2 items-end pb-0.5">
            <button
              onClick={() => load()}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 transition-colors cursor-pointer disabled:opacity-50"
            >
              <RefreshCcw className="h-4 w-4" />
              Refresh
            </button>
            <button
              onClick={takeSnapshot}
              disabled={snapLoading}
              className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-4 py-2 text-sm font-bold text-white hover:bg-slate-800 transition-colors cursor-pointer disabled:opacity-50"
            >
              <Zap className="h-4 w-4" />
              {snapLoading ? "Archiving…" : "Take Snapshot"}
            </button>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader className="h-8 w-8 animate-spin text-slate-400" />
        </div>
      ) : coverage ? (
        <div className="space-y-4">
          {/* Summary Cards */}
          <div className="grid gap-4 md:grid-cols-3">
            <SummaryCard
              title="Required Headcount"
              value={coverage.required_headcount}
              icon={<Users className="h-5 w-5" />}
              tone="bg-slate-100 text-slate-700"
            />
            <SummaryCard
              title="Available Headcount"
              value={coverage.available_headcount}
              icon={<UserCheck className="h-5 w-5" />}
              tone="bg-blue-50 text-blue-700"
            />
            <div className={`glass-card stat-card rounded-3xl border p-5 ${coverageBg(coverage.coverage_pct)}`}>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-slate-500">Coverage %</p>
                  <p className={`mt-2 text-3xl font-black tracking-tight ${coverageColor(coverage.coverage_pct)}`}>
                    {coverage.coverage_pct.toFixed(1)}%
                  </p>
                  <p className="mt-1 text-xs text-slate-400">
                    {coverage.coverage_pct >= 90 ? "Fully covered" : coverage.coverage_pct >= 70 ? "Partial coverage" : "Under-staffed"}
                  </p>
                </div>
                <div className={`rounded-2xl p-3 ${
                  coverage.coverage_pct >= 90 ? "bg-emerald-100 text-emerald-700" :
                  coverage.coverage_pct >= 70 ? "bg-amber-100 text-amber-700" :
                  "bg-red-100 text-red-700"
                }`}>
                  <CalendarDays className="h-5 w-5" />
                </div>
              </div>
              <div className="mt-4 h-2 w-full rounded-full bg-white/60">
                <div
                  className={`h-2 rounded-full transition-all ${
                    coverage.coverage_pct >= 90 ? "bg-emerald-500" :
                    coverage.coverage_pct >= 70 ? "bg-amber-500" :
                    "bg-red-500"
                  }`}
                  style={{ width: `${Math.min(coverage.coverage_pct, 100)}%` }}
                />
              </div>
            </div>
          </div>

          {/* Gaps */}
          <div className="overflow-hidden rounded-3xl border bg-white shadow-sm">
            <div className="border-b p-5">
              <h2 className="font-black text-slate-950">Coverage Gaps</h2>
              <p className="text-sm text-slate-500">{coverage.gaps.length} gap{coverage.gaps.length !== 1 ? "s" : ""} identified</p>
            </div>
            {coverage.gaps.length === 0 ? (
              <div className="py-12 text-center text-slate-400">
                <CheckCircle2 className="mx-auto mb-3 h-10 w-10 opacity-30" />
                <p className="font-semibold">No coverage gaps for this date.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                    <tr>
                      {["Process", "Branch", "Gap Count", "Note"].map((h) => (
                        <th key={h} className="p-4 font-semibold">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {coverage.gaps.map((g, i) => (
                      <tr key={i} className="border-t hover:bg-slate-50/80 transition-colors">
                        <td className="p-4 text-slate-700">{g.process ?? "–"}</td>
                        <td className="p-4 text-slate-500">{g.branch ?? "–"}</td>
                        <td className="p-4">
                          <span className={`font-black text-lg ${g.gap_count > 5 ? "text-red-600" : g.gap_count > 2 ? "text-amber-600" : "text-slate-700"}`}>
                            {g.gap_count}
                          </span>
                        </td>
                        <td className="p-4 text-slate-400 text-xs">{g.note ?? "–"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="py-16 text-center text-slate-400">
          <CalendarDays className="mx-auto mb-3 h-10 w-10 opacity-30" />
          <p className="font-semibold">Select a date to view coverage data.</p>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Tab: Attrition
// ---------------------------------------------------------------------------

interface AttritionFormState {
  employee_id: string;
  exit_date: string;
  reason_category: string;
  is_voluntary: boolean;
}

const REASON_CATEGORIES = [
  "better_opportunity",
  "salary_dissatisfaction",
  "work_environment",
  "personal_reasons",
  "health_issues",
  "relocation",
  "higher_studies",
  "contract_end",
  "termination",
  "absconding",
  "other",
];

function AttritionTab() {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [processId, setProcessId] = useState("");
  const [summary, setSummary] = useState<AttritionSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [showRecord, setShowRecord] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");

  const [form, setForm] = useState<AttritionFormState>({
    employee_id: "",
    exit_date: "",
    reason_category: "better_opportunity",
    is_voluntary: true,
  });

  const load = async () => {
    setLoading(true);
    setMessage("");
    try {
      const params = new URLSearchParams({ month });
      if (processId) params.set("process_id", processId);
      const res = await hrmsApi.get<AttritionSummary>(`/api/wfm-ext/attrition/summary?${params.toString()}`);
      setSummary(res);
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Failed to load attrition summary");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [month, processId]);

  const submitRecord = async () => {
    if (!form.employee_id.trim()) { setMessage("Employee ID is required."); return; }
    if (!form.exit_date) { setMessage("Exit date is required."); return; }
    setSubmitting(true);
    try {
      await hrmsApi.post("/api/wfm-ext/attrition/record", {
        employee_id: form.employee_id.trim(),
        exit_date: form.exit_date,
        reason_category: form.reason_category,
        is_voluntary: form.is_voluntary,
      });
      setShowRecord(false);
      setForm({ employee_id: "", exit_date: "", reason_category: "better_opportunity", is_voluntary: true });
      setMessage("Attrition record saved.");
      await load();
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Failed to record attrition");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      {message && (
        <div className="flex items-center gap-3 rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm font-bold text-blue-800">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />
          {message}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <p className="mb-1 text-xs font-semibold text-slate-500">Month</p>
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="rounded-2xl border px-3 py-2 text-sm outline-none focus:border-blue-400 transition-colors"
          />
        </div>
        <div className="flex-1 min-w-[160px]">
          <p className="mb-1 text-xs font-semibold text-slate-500">Process ID</p>
          <input
            value={processId}
            onChange={(e) => setProcessId(e.target.value)}
            placeholder="All processes"
            className="w-full rounded-2xl border px-3 py-2 text-sm outline-none focus:border-blue-400 transition-colors"
          />
        </div>
        <div className="flex gap-2 items-end pb-0.5">
          <button
            onClick={() => load()}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 transition-colors cursor-pointer disabled:opacity-50"
          >
            <RefreshCcw className="h-4 w-4" />
            Refresh
          </button>
          <button
            onClick={() => setShowRecord(true)}
            className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-4 py-2 text-sm font-bold text-white hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <Plus className="h-4 w-4" />
            Record Attrition
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader className="h-8 w-8 animate-spin text-slate-400" />
        </div>
      ) : summary ? (
        <div className="space-y-4">
          {/* Summary Cards */}
          <div className="grid gap-4 md:grid-cols-4">
            <SummaryCard
              title="Total Exits"
              value={summary.total_exits}
              icon={<TrendingDown className="h-5 w-5" />}
              tone="bg-slate-100 text-slate-700"
            />
            <SummaryCard
              title="Voluntary"
              value={summary.voluntary}
              sub={summary.total_exits > 0 ? `${((summary.voluntary / summary.total_exits) * 100).toFixed(0)}% of exits` : undefined}
              icon={<UserCheck className="h-5 w-5" />}
              tone="bg-amber-50 text-amber-700"
            />
            <SummaryCard
              title="Involuntary"
              value={summary.involuntary}
              sub={summary.total_exits > 0 ? `${((summary.involuntary / summary.total_exits) * 100).toFixed(0)}% of exits` : undefined}
              icon={<X className="h-5 w-5" />}
              tone="bg-rose-50 text-rose-700"
            />
            <div className="glass-card stat-card rounded-3xl p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-slate-500">Attrition Rate</p>
                  <p className={`mt-2 text-3xl font-black tracking-tight ${
                    summary.attrition_rate < 5 ? "text-emerald-600" :
                    summary.attrition_rate < 10 ? "text-amber-600" :
                    "text-red-600"
                  }`}>
                    {summary.attrition_rate.toFixed(1)}%
                  </p>
                  <p className="mt-1 text-xs text-slate-400">This month</p>
                </div>
                <div className={`rounded-2xl p-3 ${
                  summary.attrition_rate < 5 ? "bg-emerald-50 text-emerald-700" :
                  summary.attrition_rate < 10 ? "bg-amber-50 text-amber-700" :
                  "bg-red-50 text-red-700"
                }`}>
                  <TrendingDown className="h-5 w-5" />
                </div>
              </div>
            </div>
          </div>

          {/* By Reason */}
          <div className="overflow-hidden rounded-3xl border bg-white shadow-sm">
            <div className="border-b p-5">
              <h2 className="font-black text-slate-950">Exits by Reason</h2>
              <p className="text-sm text-slate-500">{summary.by_reason.length} reason{summary.by_reason.length !== 1 ? "s" : ""} recorded</p>
            </div>
            {summary.by_reason.length === 0 ? (
              <div className="py-12 text-center text-slate-400">
                <TrendingDown className="mx-auto mb-3 h-10 w-10 opacity-30" />
                <p className="font-semibold">No attrition data for this period.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                    <tr>
                      {["Reason Category", "Count", "% Share", "Distribution"].map((h) => (
                        <th key={h} className="p-4 font-semibold">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {summary.by_reason
                      .slice()
                      .sort((a, b) => b.count - a.count)
                      .map((r) => (
                        <tr key={r.reason} className="border-t hover:bg-slate-50/80 transition-colors">
                          <td className="p-4 font-semibold text-slate-950 capitalize">
                            {r.reason.replace(/_/g, " ")}
                          </td>
                          <td className="p-4 font-black text-slate-700">{r.count}</td>
                          <td className="p-4 text-slate-500">{r.pct.toFixed(1)}%</td>
                          <td className="p-4 w-[200px]">
                            <div className="h-2 w-full rounded-full bg-slate-100">
                              <div
                                className="h-2 rounded-full bg-slate-400 transition-all"
                                style={{ width: `${Math.min(r.pct, 100)}%` }}
                              />
                            </div>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="py-16 text-center text-slate-400">
          <TrendingDown className="mx-auto mb-3 h-10 w-10 opacity-30" />
          <p className="font-semibold">Select a month to view attrition data.</p>
        </div>
      )}

      {/* Record Attrition Modal */}
      {showRecord && (
        <ModalShell
          title="Record Attrition"
          onClose={() => setShowRecord(false)}
          footer={
            <>
              <button
                onClick={() => setShowRecord(false)}
                className="flex-1 cursor-pointer rounded-2xl border border-slate-200 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={submitRecord}
                disabled={submitting}
                className="flex-1 cursor-pointer rounded-2xl bg-slate-950 py-3 text-sm font-bold text-white hover:bg-slate-800 transition-colors disabled:opacity-50"
              >
                {submitting ? "Saving…" : "Record"}
              </button>
            </>
          }
        >
          <div>
            <Label>Employee ID / UUID</Label>
            <FieldInput
              value={form.employee_id}
              onChange={(v) => setForm({ ...form, employee_id: v })}
              placeholder="Enter employee UUID"
            />
          </div>
          <div>
            <Label>Exit Date</Label>
            <FieldInput
              type="date"
              value={form.exit_date}
              onChange={(v) => setForm({ ...form, exit_date: v })}
            />
          </div>
          <div>
            <Label>Reason Category</Label>
            <FieldSelect
              value={form.reason_category}
              onChange={(v) => setForm({ ...form, reason_category: v })}
              options={REASON_CATEGORIES.map((r) => ({ value: r, label: r.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) }))}
            />
          </div>
          <div className="flex items-center justify-between rounded-2xl border px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-slate-700">Voluntary Exit</p>
              <p className="text-xs text-slate-400">Toggle off for involuntary exits</p>
            </div>
            <button
              type="button"
              onClick={() => setForm({ ...form, is_voluntary: !form.is_voluntary })}
              className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                form.is_voluntary ? "bg-emerald-500" : "bg-slate-300"
              }`}
            >
              <span
                className={`inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                  form.is_voluntary ? "translate-x-5" : "translate-x-0"
                }`}
              />
            </button>
          </div>
        </ModalShell>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

const TABS: { key: TabKey; label: string; icon: React.ReactNode }[] = [
  { key: "swaps",     label: "Roster Swaps",  icon: <ArrowLeftRight className="h-4 w-4" /> },
  { key: "conflicts", label: "Conflicts",      icon: <AlertTriangle className="h-4 w-4" /> },
  { key: "coverage",  label: "Coverage",       icon: <CalendarDays className="h-4 w-4" /> },
  { key: "attrition", label: "Attrition",      icon: <TrendingDown className="h-4 w-4" /> },
];

export default function NativeWFMExtensions() {
  const [activeTab, setActiveTab] = useState<TabKey>("swaps");

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-black uppercase tracking-[0.2em] text-blue-600">Workforce Management</p>
            <h1 className="mt-2 text-3xl font-black text-slate-950">WFM Extensions</h1>
            <p className="mt-2 max-w-4xl text-slate-600">
              Manage roster swaps, resolve scheduling conflicts, monitor coverage, and track attrition trends.
            </p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex flex-wrap gap-2 border-b border-slate-200">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`inline-flex items-center gap-2 rounded-t-xl px-5 py-3 text-sm font-bold transition-colors cursor-pointer -mb-px ${
                activeTab === tab.key
                  ? "border border-b-white border-slate-200 bg-white text-slate-950"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div className="space-y-5">
          {activeTab === "swaps"     && <RosterSwapsTab />}
          {activeTab === "conflicts" && <ConflictsTab />}
          {activeTab === "coverage"  && <CoverageTab />}
          {activeTab === "attrition" && <AttritionTab />}
        </div>
      </div>
    </DashboardLayout>
  );
}
