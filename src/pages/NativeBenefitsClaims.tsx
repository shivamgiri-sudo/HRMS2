import { useEffect, useState } from "react";
import {
  BadgeCheck,
  CheckCircle2,
  ChevronDown,
  CreditCard,
  FileText,
  Loader,
  Plus,
  RefreshCcw,
  ShieldCheck,
  X,
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";
import { formatISTDate } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

type PlanType = "insurance" | "transport" | "meal" | "wellness" | "other";
type ClaimType = "travel" | "medical" | "meal" | "equipment" | "other";
type EnrollmentStatus = "active" | "inactive" | "pending";
type ClaimStatus = "draft" | "submitted" | "approved" | "rejected" | "paid";

interface BenefitPlan {
  id: string;
  plan_name: string;
  plan_type: PlanType;
  description: string | null;
  eligibility_rule: string | null;
  is_active: number;
  created_at: string;
}

interface BenefitEnrollment {
  id: string;
  employee_id: string;
  plan_id: string;
  plan_name: string;
  plan_type: PlanType;
  enrolled_date: string;
  effective_from: string;
  effective_to: string | null;
  status: EnrollmentStatus;
}

interface ReimbursementClaim {
  id: string;
  employee_id: string;
  employee_name: string | null;
  employee_code: string | null;
  claim_type: ClaimType;
  amount: number;
  claim_date: string;
  description: string | null;
  receipt_ref: string | null;
  status: ClaimStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
  remarks: string | null;
  created_at: string;
}

interface ClaimStats {
  total_submitted: number;
  total_approved: number;
  total_amount_approved: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const CLAIM_STATUS_COLORS: Record<ClaimStatus, string> = {
  draft:     "bg-slate-100 text-slate-600",
  submitted: "bg-blue-50 text-blue-700",
  approved:  "bg-emerald-50 text-emerald-700",
  rejected:  "bg-red-50 text-red-700",
  paid:      "bg-purple-50 text-purple-700",
};

const ENROLL_STATUS_COLORS: Record<EnrollmentStatus, string> = {
  active:   "bg-emerald-50 text-emerald-700",
  inactive: "bg-slate-100 text-slate-500",
  pending:  "bg-amber-50 text-amber-700",
};

const PLAN_TYPE_COLORS: Record<PlanType, string> = {
  insurance: "bg-blue-50 text-blue-700",
  transport: "bg-cyan-50 text-cyan-700",
  meal:      "bg-orange-50 text-orange-700",
  wellness:  "bg-violet-50 text-violet-700",
  other:     "bg-slate-100 text-slate-600",
};

const CLAIM_TYPES: ClaimType[] = ["travel", "medical", "meal", "equipment", "other"];
const PLAN_TYPES: PlanType[]   = ["insurance", "transport", "meal", "wellness", "other"];
const CLAIM_STATUSES: string[] = ["all", "draft", "submitted", "approved", "rejected", "paid"];

// ─── Small shared components ──────────────────────────────────────────────────

function StatusBadge({ status }: { status: ClaimStatus }) {
  const cls = CLAIM_STATUS_COLORS[status] ?? "bg-slate-100 text-slate-600";
  return (
    <span className={`rounded-full px-3 py-1 text-xs font-semibold capitalize ${cls}`}>
      {status}
    </span>
  );
}

function PlanTypeBadge({ type }: { type: PlanType }) {
  const cls = PLAN_TYPE_COLORS[type] ?? "bg-slate-100 text-slate-600";
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${cls}`}>
      {type}
    </span>
  );
}

function EnrollBadge({ status }: { status: EnrollmentStatus }) {
  const cls = ENROLL_STATUS_COLORS[status] ?? "bg-slate-100 text-slate-600";
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${cls}`}>
      {status}
    </span>
  );
}

function StatCard({
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

function ModalShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg rounded-3xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b p-6">
          <h2 className="text-lg font-black text-slate-950">{title}</h2>
          <button
            onClick={onClose}
            className="cursor-pointer text-slate-400 hover:text-slate-700 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function InputField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-sm font-semibold text-slate-700 mb-1.5">{label}</label>
      {children}
    </div>
  );
}

const inputCls =
  "w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 transition-colors";

// ─── Tab 1: My Claims ─────────────────────────────────────────────────────────

function MyClaimsTab() {
  const [claims, setClaims] = useState<ReimbursementClaim[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [showModal, setShowModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [form, setForm] = useState({
    claim_type: "travel" as ClaimType,
    amount: "",
    claim_date: "",
    description: "",
    receipt_ref: "",
  });

  const load = async () => {
    setLoading(true);
    setMessage("");
    try {
      const res = await hrmsApi.get<{ success: boolean; data: ReimbursementClaim[] }>(
        `/api/benefits/claims${statusFilter !== "all" ? `?status=${statusFilter}` : ""}`
      );
      setClaims(res.data ?? []);
    } catch (err: unknown) {
      setMessage((err as Error)?.message ?? "Failed to load claims");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [statusFilter]);

  const submit = async () => {
    if (!form.amount || !form.claim_date) {
      setMessage("Amount and claim date are required.");
      return;
    }
    setSubmitting(true);
    try {
      await hrmsApi.post("/api/benefits/claims", {
        claim_type: form.claim_type,
        amount: parseFloat(form.amount),
        claim_date: form.claim_date,
        description: form.description || null,
        receipt_ref: form.receipt_ref || null,
      });
      setShowModal(false);
      setForm({ claim_type: "travel", amount: "", claim_date: "", description: "", receipt_ref: "" });
      setMessage("Claim submitted successfully.");
      await load();
    } catch (err: unknown) {
      setMessage((err as Error)?.message ?? "Submission failed.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-black text-slate-950">My Reimbursement Claims</h2>
          <p className="mt-1 text-sm text-slate-500">Track and submit your expense claims.</p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 transition-colors cursor-pointer disabled:opacity-50"
          >
            <RefreshCcw className="h-4 w-4" />
            Refresh
          </button>
          <button
            onClick={() => setShowModal(true)}
            className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-5 py-2.5 text-sm font-bold text-white hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <Plus className="h-4 w-4" />
            Submit Claim
          </button>
        </div>
      </div>

      {message && (
        <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm font-bold text-blue-800">
          {message}
        </div>
      )}

      {/* Status pills */}
      <div className="flex flex-wrap gap-2">
        {CLAIM_STATUSES.map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`rounded-xl px-3 py-1.5 text-xs font-semibold capitalize transition-colors cursor-pointer ${
              statusFilter === s
                ? "bg-slate-950 text-white"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {/* Claims list */}
      <div className="overflow-hidden rounded-3xl border bg-white shadow-sm">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader className="h-8 w-8 animate-spin text-slate-400" />
          </div>
        ) : claims.length === 0 ? (
          <div className="py-16 text-center text-slate-400">
            <FileText className="mx-auto mb-3 h-10 w-10 opacity-30" />
            <p className="font-semibold">No claims found.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[700px] text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  {["Type", "Amount", "Date", "Status", "Remarks", "Submitted"].map((h) => (
                    <th key={h} className="p-4 font-semibold">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {claims.map((c) => (
                  <tr key={c.id} className="border-t hover:bg-slate-50/80 transition-colors">
                    <td className="p-4">
                      <span className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-semibold capitalize">
                        {c.claim_type}
                      </span>
                    </td>
                    <td className="p-4 font-bold text-slate-950">
                      ₹{Number(c.amount).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                    </td>
                    <td className="p-4 font-mono text-slate-600">{c.claim_date}</td>
                    <td className="p-4">
                      <StatusBadge status={c.status} />
                    </td>
                    <td className="p-4 max-w-[200px]">
                      {c.status === "rejected" && c.remarks ? (
                        <span className="text-xs text-red-600">{c.remarks}</span>
                      ) : (
                        <span className="text-slate-400 text-xs">–</span>
                      )}
                    </td>
                    <td className="p-4 font-mono text-xs text-slate-400">
                      {formatISTDate(c.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Submit Claim Modal */}
      {showModal && (
        <ModalShell title="Submit Claim" onClose={() => setShowModal(false)}>
          <div className="space-y-4 p-6">
            <InputField label="Claim Type">
              <select
                value={form.claim_type}
                onChange={(e) => setForm({ ...form, claim_type: e.target.value as ClaimType })}
                className={inputCls}
              >
                {CLAIM_TYPES.map((t) => (
                  <option key={t} value={t} className="capitalize">
                    {t.charAt(0).toUpperCase() + t.slice(1)}
                  </option>
                ))}
              </select>
            </InputField>
            <div className="grid grid-cols-2 gap-3">
              <InputField label="Amount (₹)">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: e.target.value })}
                  placeholder="0.00"
                  className={inputCls}
                />
              </InputField>
              <InputField label="Claim Date">
                <input
                  type="date"
                  value={form.claim_date}
                  onChange={(e) => setForm({ ...form, claim_date: e.target.value })}
                  className={inputCls}
                />
              </InputField>
            </div>
            <InputField label="Description">
              <textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Brief description of the expense…"
                rows={3}
                className={`${inputCls} resize-none`}
              />
            </InputField>
            <InputField label="Receipt Reference">
              <input
                value={form.receipt_ref}
                onChange={(e) => setForm({ ...form, receipt_ref: e.target.value })}
                placeholder="Invoice / receipt number"
                className={inputCls}
              />
            </InputField>
          </div>
          <div className="flex gap-3 border-t p-6">
            <button
              onClick={() => setShowModal(false)}
              className="flex-1 cursor-pointer rounded-2xl border border-slate-200 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => void submit()}
              disabled={submitting}
              className="flex-1 cursor-pointer rounded-2xl bg-slate-950 py-3 text-sm font-bold text-white hover:bg-slate-800 transition-colors disabled:opacity-50"
            >
              {submitting ? "Submitting…" : "Submit"}
            </button>
          </div>
        </ModalShell>
      )}
    </div>
  );
}

// ─── Tab 2: Claims Management ─────────────────────────────────────────────────

function ClaimsManagementTab() {
  const [claims, setClaims] = useState<ReimbursementClaim[]>([]);
  const [stats, setStats] = useState<ClaimStats>({
    total_submitted: 0,
    total_approved: 0,
    total_amount_approved: 0,
  });
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [reviewTarget, setReviewTarget] = useState<ReimbursementClaim | null>(null);
  const [reviewAction, setReviewAction] = useState<"approved" | "rejected">("approved");
  const [reviewRemarks, setReviewRemarks] = useState("");
  const [processing, setProcessing] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setMessage("");
    try {
      const res = await hrmsApi.get<{
        success: boolean;
        data: ReimbursementClaim[];
        stats: ClaimStats;
      }>(
        `/api/benefits/claims${statusFilter !== "all" ? `?status=${statusFilter}` : ""}`
      );
      setClaims(res.data ?? []);
      if (res.stats) setStats(res.stats);
    } catch (err: unknown) {
      setMessage((err as Error)?.message ?? "Failed to load claims");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [statusFilter]);

  const review = async () => {
    if (!reviewTarget) return;
    setProcessing(reviewTarget.id);
    try {
      await hrmsApi.patch(`/api/benefits/claims/${reviewTarget.id}/review`, {
        action: reviewAction,
        remarks: reviewRemarks || null,
      });
      setReviewTarget(null);
      setReviewRemarks("");
      setMessage(`Claim ${reviewAction}.`);
      await load();
    } catch (err: unknown) {
      setMessage((err as Error)?.message ?? "Review failed.");
    } finally {
      setProcessing(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-black text-slate-950">Claims Management</h2>
          <p className="mt-1 text-sm text-slate-500">Review and approve employee expense claims.</p>
        </div>
        <button
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 transition-colors cursor-pointer disabled:opacity-50"
        >
          <RefreshCcw className="h-4 w-4" />
          Refresh
        </button>
      </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-3">
        <StatCard
          title="Total Submitted"
          value={stats.total_submitted}
          icon={<FileText className="h-5 w-5" />}
          tone="bg-blue-50 text-blue-700"
        />
        <StatCard
          title="Total Approved"
          value={stats.total_approved}
          icon={<CheckCircle2 className="h-5 w-5" />}
          tone="bg-emerald-50 text-emerald-700"
        />
        <StatCard
          title="Amount Approved"
          value={`₹${Number(stats.total_amount_approved).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`}
          icon={<CreditCard className="h-5 w-5" />}
          tone="bg-purple-50 text-purple-700"
        />
      </div>

      {message && (
        <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm font-bold text-blue-800">
          {message}
        </div>
      )}

      {/* Status filter */}
      <div className="flex flex-wrap gap-2">
        {CLAIM_STATUSES.map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`rounded-xl px-3 py-1.5 text-xs font-semibold capitalize transition-colors cursor-pointer ${
              statusFilter === s
                ? "bg-slate-950 text-white"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-3xl border bg-white shadow-sm">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader className="h-8 w-8 animate-spin text-slate-400" />
          </div>
        ) : claims.length === 0 ? (
          <div className="py-16 text-center text-slate-400">
            <FileText className="mx-auto mb-3 h-10 w-10 opacity-30" />
            <p className="font-semibold">No claims found.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  {["Employee", "Type", "Amount", "Date", "Status", "Actions"].map((h) => (
                    <th key={h} className="p-4 font-semibold">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {claims.map((c) => (
                  <tr key={c.id} className="border-t hover:bg-slate-50/80 transition-colors">
                    <td className="p-4">
                      <div className="font-bold text-slate-950">
                        {c.employee_name ?? c.employee_id}
                      </div>
                      {c.employee_code && (
                        <div className="text-xs font-mono text-slate-400">{c.employee_code}</div>
                      )}
                    </td>
                    <td className="p-4">
                      <span className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-semibold capitalize">
                        {c.claim_type}
                      </span>
                    </td>
                    <td className="p-4 font-bold text-slate-950">
                      ₹{Number(c.amount).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                    </td>
                    <td className="p-4 font-mono text-slate-600">{c.claim_date}</td>
                    <td className="p-4">
                      <StatusBadge status={c.status} />
                    </td>
                    <td className="p-4">
                      {c.status === "submitted" && (
                        <div className="flex gap-2">
                          <button
                            onClick={() => {
                              setReviewTarget(c);
                              setReviewAction("approved");
                              setReviewRemarks("");
                            }}
                            disabled={processing === c.id}
                            className="cursor-pointer rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 transition-colors disabled:opacity-50"
                          >
                            Approve
                          </button>
                          <button
                            onClick={() => {
                              setReviewTarget(c);
                              setReviewAction("rejected");
                              setReviewRemarks("");
                            }}
                            disabled={processing === c.id}
                            className="cursor-pointer rounded-lg bg-red-600 px-2.5 py-1.5 text-xs font-bold text-white hover:bg-red-700 transition-colors disabled:opacity-50"
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

      {/* Review Dialog */}
      {reviewTarget && (
        <ModalShell
          title={reviewAction === "approved" ? "Approve Claim" : "Reject Claim"}
          onClose={() => setReviewTarget(null)}
        >
          <div className="space-y-4 p-6">
            <div className="rounded-2xl bg-slate-50 p-4 text-sm">
              <div className="font-semibold text-slate-700">
                {reviewTarget.employee_name ?? reviewTarget.employee_id}
              </div>
              <div className="mt-1 text-slate-500 capitalize">
                {reviewTarget.claim_type} &mdash; ₹
                {Number(reviewTarget.amount).toLocaleString("en-IN", {
                  minimumFractionDigits: 2,
                })}
              </div>
            </div>
            <InputField label="Remarks (optional)">
              <textarea
                value={reviewRemarks}
                onChange={(e) => setReviewRemarks(e.target.value)}
                placeholder="Add remarks for the employee…"
                rows={3}
                className={`${inputCls} resize-none`}
              />
            </InputField>
          </div>
          <div className="flex gap-3 border-t p-6">
            <button
              onClick={() => setReviewTarget(null)}
              className="flex-1 cursor-pointer rounded-2xl border border-slate-200 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => void review()}
              disabled={processing === reviewTarget.id}
              className={`flex-1 cursor-pointer rounded-2xl py-3 text-sm font-bold text-white transition-colors disabled:opacity-50 ${
                reviewAction === "approved"
                  ? "bg-emerald-600 hover:bg-emerald-700"
                  : "bg-red-600 hover:bg-red-700"
              }`}
            >
              {processing === reviewTarget.id
                ? "Processing…"
                : reviewAction === "approved"
                ? "Confirm Approve"
                : "Confirm Reject"}
            </button>
          </div>
        </ModalShell>
      )}
    </div>
  );
}

// ─── Tab 3: Benefit Plans ─────────────────────────────────────────────────────

function BenefitPlansTab() {
  const [plans, setPlans] = useState<BenefitPlan[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);

  const [selectedEmployeeId, setSelectedEmployeeId] = useState("");
  const [enrollments, setEnrollments] = useState<BenefitEnrollment[]>([]);
  const [loadingEnroll, setLoadingEnroll] = useState(false);
  const [enrolling, setEnrolling] = useState<string | null>(null);

  const [planForm, setPlanForm] = useState({
    plan_name: "",
    plan_type: "other" as PlanType,
    description: "",
    eligibility_rule: "",
  });

  const [enrollForm, setEnrollForm] = useState({
    enrolled_date: "",
    effective_from: "",
  });

  const loadPlans = async () => {
    setLoading(true);
    setMessage("");
    try {
      const res = await hrmsApi.get<{ success: boolean; data: BenefitPlan[] }>("/api/benefits/plans");
      setPlans(res.data ?? []);
    } catch (err: unknown) {
      setMessage((err as Error)?.message ?? "Failed to load plans");
    } finally {
      setLoading(false);
    }
  };

  const loadEnrollments = async (empId: string) => {
    if (!empId.trim()) return;
    setLoadingEnroll(true);
    try {
      const res = await hrmsApi.get<{ success: boolean; data: BenefitEnrollment[] }>(
        `/api/benefits/enrollments/${empId.trim()}`
      );
      setEnrollments(res.data ?? []);
    } catch (err: unknown) {
      setMessage((err as Error)?.message ?? "Failed to load enrollments");
    } finally {
      setLoadingEnroll(false);
    }
  };

  useEffect(() => {
    void loadPlans();
  }, []);

  const savePlan = async () => {
    if (!planForm.plan_name.trim()) {
      setMessage("Plan name is required.");
      return;
    }
    setSaving(true);
    try {
      await hrmsApi.post("/api/benefits/plans", {
        plan_name: planForm.plan_name.trim(),
        plan_type: planForm.plan_type,
        description: planForm.description || null,
        eligibility_rule: planForm.eligibility_rule || null,
      });
      setShowModal(false);
      setPlanForm({ plan_name: "", plan_type: "other", description: "", eligibility_rule: "" });
      setMessage("Plan created.");
      await loadPlans();
    } catch (err: unknown) {
      setMessage((err as Error)?.message ?? "Failed to create plan.");
    } finally {
      setSaving(false);
    }
  };

  const enroll = async (planId: string) => {
    if (!selectedEmployeeId.trim()) {
      setMessage("Enter an employee ID first.");
      return;
    }
    if (!enrollForm.enrolled_date || !enrollForm.effective_from) {
      setMessage("Enrolled date and effective from are required.");
      return;
    }
    setEnrolling(planId);
    try {
      await hrmsApi.post("/api/benefits/enrollments", {
        employee_id: selectedEmployeeId.trim(),
        plan_id: planId,
        enrolled_date: enrollForm.enrolled_date,
        effective_from: enrollForm.effective_from,
      });
      setMessage("Enrolled successfully.");
      await loadEnrollments(selectedEmployeeId);
    } catch (err: unknown) {
      setMessage((err as Error)?.message ?? "Enrollment failed.");
    } finally {
      setEnrolling(null);
    }
  };

  const isEnrolled = (planId: string) =>
    enrollments.some((e) => e.plan_id === planId && e.status !== "inactive");

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-black text-slate-950">Benefit Plans</h2>
          <p className="mt-1 text-sm text-slate-500">
            Manage benefit plans and employee enrollments.
          </p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => void loadPlans()}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 transition-colors cursor-pointer disabled:opacity-50"
          >
            <RefreshCcw className="h-4 w-4" />
            Refresh
          </button>
          <button
            onClick={() => setShowModal(true)}
            className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-5 py-2.5 text-sm font-bold text-white hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <Plus className="h-4 w-4" />
            Add Plan
          </button>
        </div>
      </div>

      {message && (
        <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm font-bold text-blue-800">
          {message}
        </div>
      )}

      {/* Employee enrollment lookup */}
      <div className="rounded-3xl border bg-white p-5 shadow-sm">
        <h3 className="mb-4 font-bold text-slate-950">Employee Enrollment View</h3>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">
              Employee UUID
            </label>
            <input
              value={selectedEmployeeId}
              onChange={(e) => setSelectedEmployeeId(e.target.value)}
              placeholder="Paste employee UUID to view / manage enrollments"
              className={inputCls}
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">
              Enrolled Date
            </label>
            <input
              type="date"
              value={enrollForm.enrolled_date}
              onChange={(e) => setEnrollForm({ ...enrollForm, enrolled_date: e.target.value })}
              className={inputCls}
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">
              Effective From
            </label>
            <input
              type="date"
              value={enrollForm.effective_from}
              onChange={(e) => setEnrollForm({ ...enrollForm, effective_from: e.target.value })}
              className={inputCls}
            />
          </div>
          <button
            onClick={() => void loadEnrollments(selectedEmployeeId)}
            disabled={loadingEnroll || !selectedEmployeeId.trim()}
            className="inline-flex items-center gap-2 rounded-2xl bg-blue-600 px-4 py-3 text-sm font-bold text-white hover:bg-blue-700 transition-colors cursor-pointer disabled:opacity-50"
          >
            <ChevronDown className="h-4 w-4" />
            Load
          </button>
        </div>

        {enrollments.length > 0 && (
          <div className="mt-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
              Current Enrollments
            </p>
            <div className="flex flex-wrap gap-2">
              {enrollments.map((e) => (
                <div
                  key={e.id}
                  className="flex items-center gap-2 rounded-2xl border bg-slate-50 px-3 py-2 text-sm"
                >
                  <span className="font-semibold text-slate-800">{e.plan_name}</span>
                  <EnrollBadge status={e.status} />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Plans list */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader className="h-8 w-8 animate-spin text-slate-400" />
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {plans.map((plan) => {
            const enrolled = isEnrolled(plan.id);
            return (
              <div
                key={plan.id}
                className="rounded-3xl border bg-white p-5 shadow-sm hover:shadow-md transition-shadow"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-black text-slate-950">{plan.plan_name}</h3>
                      <PlanTypeBadge type={plan.plan_type} />
                    </div>
                    {plan.description && (
                      <p className="mt-1.5 text-sm text-slate-500 line-clamp-2">
                        {plan.description}
                      </p>
                    )}
                    {plan.eligibility_rule && (
                      <p className="mt-2 text-xs text-slate-400">
                        <span className="font-semibold">Eligibility:</span> {plan.eligibility_rule}
                      </p>
                    )}
                  </div>
                  <div
                    className={`mt-0.5 rounded-full px-2 py-0.5 text-xs font-semibold ${
                      plan.is_active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"
                    }`}
                  >
                    {plan.is_active ? "Active" : "Inactive"}
                  </div>
                </div>

                {selectedEmployeeId.trim() && (
                  <div className="mt-4 border-t pt-4">
                    {enrolled ? (
                      <div className="flex items-center gap-2 text-sm text-emerald-700">
                        <BadgeCheck className="h-4 w-4" />
                        <span className="font-semibold">Already enrolled</span>
                      </div>
                    ) : (
                      <button
                        onClick={() => void enroll(plan.id)}
                        disabled={enrolling === plan.id}
                        className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-bold text-white hover:bg-slate-800 transition-colors cursor-pointer disabled:opacity-50"
                      >
                        {enrolling === plan.id ? (
                          <Loader className="h-4 w-4 animate-spin" />
                        ) : (
                          <ShieldCheck className="h-4 w-4" />
                        )}
                        Enroll Employee
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {plans.length === 0 && !loading && (
        <div className="py-16 text-center text-slate-400">
          <ShieldCheck className="mx-auto mb-3 h-10 w-10 opacity-30" />
          <p className="font-semibold">No benefit plans found.</p>
        </div>
      )}

      {/* Add Plan Modal */}
      {showModal && (
        <ModalShell title="Add Benefit Plan" onClose={() => setShowModal(false)}>
          <div className="space-y-4 p-6">
            <InputField label="Plan Name">
              <input
                value={planForm.plan_name}
                onChange={(e) => setPlanForm({ ...planForm, plan_name: e.target.value })}
                placeholder="e.g. Health Insurance Premium"
                className={inputCls}
              />
            </InputField>
            <InputField label="Plan Type">
              <select
                value={planForm.plan_type}
                onChange={(e) =>
                  setPlanForm({ ...planForm, plan_type: e.target.value as PlanType })
                }
                className={inputCls}
              >
                {PLAN_TYPES.map((t) => (
                  <option key={t} value={t} className="capitalize">
                    {t.charAt(0).toUpperCase() + t.slice(1)}
                  </option>
                ))}
              </select>
            </InputField>
            <InputField label="Description">
              <textarea
                value={planForm.description}
                onChange={(e) => setPlanForm({ ...planForm, description: e.target.value })}
                placeholder="Brief description of this plan…"
                rows={2}
                className={`${inputCls} resize-none`}
              />
            </InputField>
            <InputField label="Eligibility Rule">
              <input
                value={planForm.eligibility_rule}
                onChange={(e) =>
                  setPlanForm({ ...planForm, eligibility_rule: e.target.value })
                }
                placeholder="e.g. Permanent employees after 3 months"
                className={inputCls}
              />
            </InputField>
          </div>
          <div className="flex gap-3 border-t p-6">
            <button
              onClick={() => setShowModal(false)}
              className="flex-1 cursor-pointer rounded-2xl border border-slate-200 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => void savePlan()}
              disabled={saving}
              className="flex-1 cursor-pointer rounded-2xl bg-slate-950 py-3 text-sm font-bold text-white hover:bg-slate-800 transition-colors disabled:opacity-50"
            >
              {saving ? "Saving…" : "Create Plan"}
            </button>
          </div>
        </ModalShell>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

type Tab = "my-claims" | "manage-claims" | "plans";

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: "my-claims",      label: "My Claims",          icon: <FileText className="h-4 w-4" /> },
  { id: "manage-claims",  label: "Claims Management",  icon: <CheckCircle2 className="h-4 w-4" /> },
  { id: "plans",          label: "Benefit Plans",       icon: <ShieldCheck className="h-4 w-4" /> },
];

export default function NativeBenefitsClaims() {
  const [activeTab, setActiveTab] = useState<Tab>("my-claims");

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <p className="text-sm font-black uppercase tracking-[0.2em] text-blue-600">
            HR Operations
          </p>
          <h1 className="mt-2 text-3xl font-black text-slate-950">Benefits &amp; Claims</h1>
          <p className="mt-2 max-w-3xl text-slate-600">
            Manage benefit plans, employee enrollments, and reimbursement claims.
          </p>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 rounded-2xl bg-slate-100 p-1 w-fit">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-all cursor-pointer ${
                activeTab === tab.id
                  ? "bg-white text-slate-950 shadow-sm"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {activeTab === "my-claims"     && <MyClaimsTab />}
        {activeTab === "manage-claims" && <ClaimsManagementTab />}
        {activeTab === "plans"         && <BenefitPlansTab />}
      </div>
    </DashboardLayout>
  );
}
