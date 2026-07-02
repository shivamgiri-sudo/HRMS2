import { useEffect, useState } from "react";
import {
  RefreshCcw, UserCheck, Clock, CheckCircle2, XCircle,
  AlertTriangle, Eye, ChevronRight, Plus, Search,
  ArrowLeft, Users, Calendar, Building2, Briefcase,
  ShieldAlert, TrendingUp, FileText, ChevronDown
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";
import { useAuth } from "@/contexts/AuthContext";

// ── Types ─────────────────────────────────────────────────────────────────────

type ReactivationRequest = {
  id: string;
  employee_id: string;
  employee_name?: string;
  employee_code?: string;
  old_employment_status: string;
  proposed_joining_date: string;
  reinstatement_reason: string;
  gap_days: number;
  same_cost_centre: number;
  ff_already_paid: number;
  status: "pending" | "branch_head_approved" | "approved" | "rejected" | "cancelled";
  branch_name?: string;
  cost_centre_name?: string;
  branch_head_remarks?: string;
  branch_head_actioned_at?: string;
  hr_final_remarks?: string;
  hr_final_actioned_at?: string;
  initiated_by_name?: string;
  branch_head_name?: string;
  hr_final_name?: string;
  created_at: string;
  exit_request_id?: string;
};

type InactiveEmployee = {
  id: string;
  employee_code: string;
  first_name: string;
  last_name: string;
  employment_status: string;
  date_of_exit?: string;
  branch_name?: string;
  cost_centre_name?: string;
};

type AllList = { data: ReactivationRequest[]; total: number; page: number; limit: number };

// ── Status Configuration ──────────────────────────────────────────────────────

const STATUS_CONFIG = {
  pending: {
    label: "Pending Branch Head",
    bg: "bg-amber-50",
    text: "text-amber-700",
    border: "border-amber-200",
    dot: "bg-amber-400",
  },
  branch_head_approved: {
    label: "Pending HR Final",
    bg: "bg-blue-50",
    text: "text-blue-700",
    border: "border-blue-200",
    dot: "bg-blue-500",
  },
  approved: {
    label: "Reactivated",
    bg: "bg-emerald-50",
    text: "text-emerald-700",
    border: "border-emerald-200",
    dot: "bg-emerald-500",
  },
  rejected: {
    label: "Rejected",
    bg: "bg-red-50",
    text: "text-red-700",
    border: "border-red-200",
    dot: "bg-red-400",
  },
  cancelled: {
    label: "Cancelled",
    bg: "bg-slate-100",
    text: "text-slate-500",
    border: "border-slate-200",
    dot: "bg-slate-400",
  },
} as const;

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status as keyof typeof STATUS_CONFIG] ?? {
    label: status, bg: "bg-slate-100", text: "text-slate-600", border: "border-slate-200", dot: "bg-slate-400",
  };
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${cfg.bg} ${cfg.text} ${cfg.border}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${cfg.dot}`} />
      {cfg.label}
    </span>
  );
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function fmtDate(d: string | undefined | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

// ── Initiate Dialog ───────────────────────────────────────────────────────────

function InitiateDialog({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [step, setStep] = useState<"search" | "form">("search");
  const [search, setSearch] = useState("");
  const [employees, setEmployees] = useState<InactiveEmployee[]>([]);
  const [selected, setSelected] = useState<InactiveEmployee | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [joiningDate, setJoiningDate] = useState("");
  const [reason, setReason] = useState("");
  const [newBranch, setNewBranch] = useState("");
  const [newProcess, setNewProcess] = useState("");
  const [newCostCentre, setNewCostCentre] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [earliestEligible, setEarliestEligible] = useState<string | null>(null);

  async function searchEmployees() {
    if (!search.trim()) return;
    setSearchLoading(true);
    setSearchError(null);
    try {
      const res = await hrmsApi.get<{ success: boolean; data: InactiveEmployee[] }>(
        `/api/employees?status=inactive&search=${encodeURIComponent(search)}&limit=20`
      );
      const inactive = (res.data ?? []).filter(
        (e: any) => e.employment_status !== "Active" && e.active_status !== 1
      );
      setEmployees(inactive);
    } catch {
      setSearchError("Failed to search employees");
    } finally {
      setSearchLoading(false);
    }
  }

  function selectEmployee(emp: InactiveEmployee) {
    setSelected(emp);
    setStep("form");
    setEarliestEligible(null);
    setSubmitError(null);
    if (emp.date_of_exit) {
      setJoiningDate(addDays(emp.date_of_exit, 31));
    }
  }

  async function handleSubmit() {
    if (!selected) return;
    if (!joiningDate) { setSubmitError("Proposed joining date is required"); return; }
    if (reason.trim().length < 10) { setSubmitError("Reinstatement reason must be at least 10 characters"); return; }

    setSubmitting(true);
    setSubmitError(null);
    setEarliestEligible(null);
    try {
      await hrmsApi.post("/api/employees/reactivation/initiate", {
        employee_id: selected.id,
        proposed_joining_date: joiningDate,
        reinstatement_reason: reason.trim(),
        new_branch_id: newBranch || null,
        new_process_id: newProcess || null,
        new_cost_centre_id: newCostCentre || null,
      });
      onSuccess();
    } catch (err: any) {
      setSubmitError(err?.message ?? "Submission failed");
      if (err?.earliest_eligible_date) setEarliestEligible(err.earliest_eligible_date);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4">
      <div className="w-full sm:max-w-xl rounded-t-3xl sm:rounded-3xl bg-white shadow-2xl flex flex-col max-h-[92dvh]">
        {/* Header */}
        <div className="flex items-center gap-3 px-6 pt-6 pb-4 border-b border-slate-100 shrink-0">
          {step === "form" && (
            <button
              onClick={() => { setStep("search"); setSelected(null); }}
              className="rounded-xl p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
              aria-label="Back"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
          )}
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-bold text-slate-900">
              {step === "search" ? "Find Employee" : "Reactivation Details"}
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              {step === "search" ? "Search inactive or absconding employees" : `For ${selected?.first_name} ${selected?.last_name}`}
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-xl p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
            aria-label="Close"
          >
            <XCircle className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {/* STEP 1: Search */}
          {step === "search" && (
            <>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                    placeholder="Name or employee code…"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && searchEmployees()}
                    autoFocus
                  />
                </div>
                <button
                  onClick={searchEmployees}
                  disabled={searchLoading || !search.trim()}
                  className="rounded-xl bg-blue-600 text-white px-4 py-2.5 text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer min-w-[80px]"
                >
                  {searchLoading ? "…" : "Search"}
                </button>
              </div>

              {searchError && (
                <div className="flex items-center gap-2 rounded-xl bg-red-50 border border-red-100 px-4 py-3 text-sm text-red-700">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  {searchError}
                </div>
              )}

              {employees.length > 0 && (
                <div className="space-y-2">
                  {employees.map(emp => (
                    <button
                      key={emp.id}
                      onClick={() => selectEmployee(emp)}
                      className="w-full flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3 text-left hover:border-blue-300 hover:bg-blue-50/30 transition-all cursor-pointer group"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-semibold text-slate-900">
                            {emp.first_name} {emp.last_name}
                          </p>
                          <span className="text-xs text-slate-400 font-mono">{emp.employee_code}</span>
                        </div>
                        <p className="text-xs text-slate-500 mt-0.5 flex items-center gap-1.5">
                          {emp.branch_name && <span>{emp.branch_name}</span>}
                          {emp.branch_name && emp.cost_centre_name && <span>·</span>}
                          {emp.cost_centre_name && <span>{emp.cost_centre_name}</span>}
                          <span>·</span>
                          <span className="capitalize text-amber-600 font-medium">{emp.employment_status}</span>
                          {emp.date_of_exit && <><span>·</span><span>Exit: {fmtDate(emp.date_of_exit)}</span></>}
                        </p>
                      </div>
                      <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-blue-500 transition-colors shrink-0 ml-2" />
                    </button>
                  ))}
                </div>
              )}

              {employees.length === 0 && !searchLoading && search && (
                <div className="rounded-xl border-2 border-dashed border-slate-200 px-6 py-8 text-center">
                  <Users className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                  <p className="text-sm text-slate-400">No inactive employees found for "{search}"</p>
                </div>
              )}
            </>
          )}

          {/* STEP 2: Form */}
          {step === "form" && selected && (
            <>
              {/* Employee card */}
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center shrink-0 text-sm font-bold">
                    {selected.first_name[0]}{selected.last_name[0]}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-slate-900">{selected.first_name} {selected.last_name}</p>
                    <p className="text-xs text-slate-500 flex items-center gap-1">
                      <span className="font-mono">{selected.employee_code}</span>
                      {selected.date_of_exit && <><span>·</span><span>Exit: {fmtDate(selected.date_of_exit)}</span></>}
                    </p>
                  </div>
                </div>
              </div>

              {/* 31-day gap notice */}
              <div className="flex items-start gap-2.5 rounded-xl bg-amber-50 border border-amber-200 px-4 py-3">
                <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
                <div className="text-xs text-amber-700">
                  <strong>31-day minimum gap required</strong> between exit date and proposed joining date.
                  {selected.date_of_exit && (
                    <span className="block mt-0.5">
                      Earliest eligible: <strong>{fmtDate(addDays(selected.date_of_exit, 31))}</strong>
                    </span>
                  )}
                </div>
              </div>

              {/* Date picker */}
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-slate-700">
                  Proposed Joining Date <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                  <input
                    type="date"
                    className="w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all cursor-pointer"
                    value={joiningDate}
                    onChange={e => setJoiningDate(e.target.value)}
                  />
                </div>
                {earliestEligible && (
                  <p className="text-xs text-red-600 flex items-center gap-1">
                    <XCircle className="w-3 h-3" /> Earliest eligible date: {fmtDate(earliestEligible)}
                  </p>
                )}
              </div>

              {/* Reason */}
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-slate-700">
                  Reinstatement Reason <span className="text-red-500">*</span>
                </label>
                <textarea
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all resize-none"
                  rows={3}
                  placeholder="Explain the reason for reactivating this employee (min. 10 characters)…"
                  value={reason}
                  onChange={e => setReason(e.target.value)}
                />
                <p className="text-xs text-slate-400 text-right">{reason.length} chars</p>
              </div>

              {/* Advanced overrides (collapsible) */}
              <div className="rounded-xl border border-slate-200 overflow-hidden">
                <button
                  onClick={() => setShowAdvanced(!showAdvanced)}
                  className="w-full flex items-center justify-between px-4 py-3 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition-colors cursor-pointer"
                >
                  <span className="flex items-center gap-2">
                    <Building2 className="w-3.5 h-3.5 text-slate-400" />
                    Override Branch / Process / Cost Centre (optional)
                  </span>
                  <ChevronDown className={`w-3.5 h-3.5 text-slate-400 transition-transform ${showAdvanced ? "rotate-180" : ""}`} />
                </button>
                {showAdvanced && (
                  <div className="px-4 pb-4 pt-1 space-y-2.5 border-t border-slate-100">
                    {[
                      { label: "New Branch ID", value: newBranch, setter: setNewBranch, icon: Building2 },
                      { label: "New Process ID", value: newProcess, setter: setNewProcess, icon: Briefcase },
                      { label: "New Cost Centre ID", value: newCostCentre, setter: setNewCostCentre, icon: TrendingUp },
                    ].map(({ label, value, setter, icon: Icon }) => (
                      <div key={label} className="space-y-1">
                        <label className="block text-xs text-slate-500">{label}</label>
                        <div className="relative">
                          <Icon className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-300" />
                          <input
                            className="w-full rounded-lg border border-slate-200 bg-slate-50 pl-8 pr-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            placeholder="Leave blank to keep current"
                            value={value}
                            onChange={e => setter(e.target.value)}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Error */}
              {submitError && (
                <div className="flex items-start gap-2.5 rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
                  <XCircle className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>{submitError}</span>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        {step === "form" && (
          <div className="px-6 py-4 border-t border-slate-100 shrink-0">
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="w-full rounded-xl bg-blue-600 text-white py-3 text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
            >
              {submitting ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  Submitting request…
                </span>
              ) : (
                "Submit Reactivation Request"
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Action Modal ──────────────────────────────────────────────────────────────

function ActionModal({
  request,
  mode,
  onClose,
  onSuccess,
}: {
  request: ReactivationRequest;
  mode: "branch_head" | "hr_final";
  onClose: () => void;
  onSuccess: () => void;
}) {
  const isBranchHead = mode === "branch_head";
  const [action, setAction] = useState<string>(isBranchHead ? "approved" : "confirmed");
  const [remarks, setRemarks] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const options = isBranchHead
    ? [
        { value: "approved", label: "Approve Request", icon: CheckCircle2, color: "text-emerald-600" },
        { value: "rejected", label: "Reject Request", icon: XCircle, color: "text-red-600" },
      ]
    : [
        { value: "confirmed", label: "Confirm & Reactivate Employee", icon: UserCheck, color: "text-emerald-600" },
        { value: "rejected", label: "Reject Request", icon: XCircle, color: "text-red-600" },
      ];

  const isDestructive = action === "rejected";

  async function handleSubmit() {
    if (remarks.trim().length < 5) { setError("Remarks must be at least 5 characters"); return; }
    setSubmitting(true);
    setError(null);
    try {
      const endpoint = isBranchHead
        ? `/api/employees/reactivation/${request.id}/branch-action`
        : `/api/employees/reactivation/${request.id}/hr-action`;
      await hrmsApi.post(endpoint, { action, remarks: remarks.trim() });
      onSuccess();
    } catch (err: any) {
      setError(err?.message ?? "Action failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4">
      <div className="w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl bg-white shadow-2xl">
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-slate-100">
          <div>
            <h2 className="text-base font-bold text-slate-900">
              {isBranchHead ? "Branch Head Review" : "HR Final Action"}
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              {request.employee_name} · {request.employee_code}
            </p>
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded-xl p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors cursor-pointer">
            <XCircle className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          {/* Summary card */}
          <div className="rounded-xl bg-slate-50 border border-slate-200 px-4 py-3 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-500">Proposed joining</span>
              <span className="text-xs font-semibold text-slate-900">{fmtDate(request.proposed_joining_date)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-500">Gap since exit</span>
              <span className="text-xs font-semibold text-slate-900">{request.gap_days} days</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-500">Cost centre change</span>
              <span className="text-xs font-semibold text-slate-900">{request.same_cost_centre ? "No" : "Yes"}</span>
            </div>
          </div>

          {request.ff_already_paid === 1 && (
            <div className="flex items-start gap-2.5 rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-xs text-amber-700">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span><strong>F&F settlement already paid</strong> for this employee. Payroll head will be notified upon approval.</span>
            </div>
          )}

          <p className="text-xs text-slate-400 line-clamp-2 italic">"{request.reinstatement_reason}"</p>

          {/* Action selection */}
          <div className="space-y-2">
            {options.map(opt => {
              const Icon = opt.icon;
              const isSelected = action === opt.value;
              return (
                <button
                  key={opt.value}
                  onClick={() => setAction(opt.value)}
                  className={`w-full flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition-all cursor-pointer ${
                    isSelected
                      ? "border-blue-300 bg-blue-50"
                      : "border-slate-200 hover:border-slate-300 hover:bg-slate-50"
                  }`}
                >
                  <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${
                    isSelected ? "border-blue-600 bg-blue-600" : "border-slate-300"
                  }`}>
                    {isSelected && <span className="w-1.5 h-1.5 rounded-full bg-white" />}
                  </div>
                  <Icon className={`w-4 h-4 ${opt.color}`} />
                  <span className={`text-sm font-medium ${isSelected ? "text-slate-900" : "text-slate-600"}`}>
                    {opt.label}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Remarks */}
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-slate-700">
              Remarks <span className="text-red-500">*</span>
            </label>
            <textarea
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all resize-none"
              rows={3}
              placeholder="Add your remarks (min. 5 characters)…"
              value={remarks}
              onChange={e => setRemarks(e.target.value)}
            />
          </div>

          {error && (
            <div className="flex items-center gap-2 rounded-xl bg-red-50 border border-red-100 px-4 py-3 text-sm text-red-700">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              {error}
            </div>
          )}

          <button
            onClick={handleSubmit}
            disabled={submitting}
            className={`w-full rounded-xl py-3 text-sm font-semibold text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer ${
              isDestructive ? "bg-red-600 hover:bg-red-700" : "bg-blue-600 hover:bg-blue-700"
            }`}
          >
            {submitting ? (
              <span className="flex items-center justify-center gap-2">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                Submitting…
              </span>
            ) : (
              `Confirm: ${options.find(o => o.value === action)?.label}`
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Detail Drawer ─────────────────────────────────────────────────────────────

function DetailDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const [data, setData] = useState<ReactivationRequest | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    hrmsApi.get<{ success: boolean; data: ReactivationRequest }>(`/api/employees/reactivation/${id}`)
      .then(r => setData(r.data ?? null))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end"
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-md bg-white h-full overflow-y-auto shadow-2xl flex flex-col">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-slate-100 px-6 pt-6 pb-4 flex items-center gap-3 z-10 shrink-0">
          <button
            onClick={onClose}
            className="rounded-xl p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
            aria-label="Close"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <h2 className="text-base font-bold text-slate-900">Reactivation Detail</h2>
            {data && <p className="text-xs text-slate-400 mt-0.5">{data.employee_name}</p>}
          </div>
        </div>

        {loading && (
          <div className="flex-1 flex items-center justify-center">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-slate-200 border-t-slate-600" />
          </div>
        )}

        {data && (
          <div className="flex-1 px-6 py-5 space-y-6">
            {/* Employee summary */}
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-blue-100 text-blue-600 flex items-center justify-center text-base font-bold shrink-0">
                {data.employee_name?.split(" ").map(n => n[0]).slice(0, 2).join("") ?? "?"}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-base font-bold text-slate-900">{data.employee_name}</p>
                  <StatusBadge status={data.status} />
                </div>
                <p className="text-xs text-slate-500 mt-0.5 font-mono">{data.employee_code}</p>
              </div>
            </div>

            {/* Key metrics */}
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: "Previous Status", value: data.old_employment_status, icon: ShieldAlert },
                { label: "Gap (days)", value: `${data.gap_days} days`, icon: Calendar },
                { label: "Proposed Joining", value: fmtDate(data.proposed_joining_date), icon: UserCheck },
                { label: "Cost Centre", value: data.cost_centre_name ?? "—", icon: Building2 },
                { label: "Same Cost Centre", value: data.same_cost_centre ? "Yes" : "No", icon: TrendingUp },
                { label: "F&F Paid", value: data.ff_already_paid ? "Yes ⚠" : "No", icon: FileText },
              ].map(({ label, value, icon: Icon }) => (
                <div key={label} className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <Icon className="w-3 h-3 text-slate-400" />
                    <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wide">{label}</span>
                  </div>
                  <p className={`text-sm font-bold ${label === "F&F Paid" && data.ff_already_paid ? "text-amber-600" : "text-slate-900"}`}>
                    {value}
                  </p>
                </div>
              ))}
            </div>

            {/* Reason */}
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wide mb-2">Reinstatement Reason</p>
              <p className="text-sm text-slate-700 leading-relaxed">{data.reinstatement_reason}</p>
            </div>

            {/* Approval timeline */}
            <div>
              <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-4">Approval Timeline</p>
              <div className="space-y-0">
                <TimelineStep
                  label="Request Initiated"
                  by={data.initiated_by_name}
                  at={data.created_at}
                  state="done"
                  isLast={false}
                />
                <TimelineStep
                  label="Branch Head Review"
                  by={data.branch_head_name}
                  at={data.branch_head_actioned_at}
                  remarks={data.branch_head_remarks}
                  state={
                    data.branch_head_actioned_at
                      ? data.status === "rejected" && !data.hr_final_actioned_at
                        ? "rejected"
                        : "done"
                      : "pending"
                  }
                  isLast={false}
                />
                <TimelineStep
                  label="HR Final Action"
                  by={data.hr_final_name}
                  at={data.hr_final_actioned_at}
                  remarks={data.hr_final_remarks}
                  state={
                    data.hr_final_actioned_at
                      ? data.status === "approved"
                        ? "done"
                        : "rejected"
                      : "pending"
                  }
                  isLast
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function TimelineStep({
  label, by, at, remarks, state, isLast,
}: {
  label: string;
  by?: string | null;
  at?: string | null;
  remarks?: string | null;
  state: "done" | "pending" | "rejected";
  isLast: boolean;
}) {
  const iconCls =
    state === "done" ? "bg-emerald-500 text-white"
    : state === "rejected" ? "bg-red-500 text-white"
    : "bg-slate-200 text-slate-400";
  const Icon = state === "done" ? CheckCircle2 : state === "rejected" ? XCircle : Clock;

  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${iconCls}`}>
          <Icon className="w-3.5 h-3.5" />
        </div>
        {!isLast && <div className={`w-px flex-1 mt-1 mb-1 min-h-[24px] ${state !== "pending" ? "bg-slate-200" : "bg-dashed bg-slate-100"}`} />}
      </div>
      <div className={`${isLast ? "pb-0" : "pb-5"} min-w-0 flex-1`}>
        <p className="text-sm font-semibold text-slate-800">{label}</p>
        {by && <p className="text-xs text-slate-500">{by}</p>}
        {at && <p className="text-xs text-slate-400">{fmtDate(at)}</p>}
        {!at && state === "pending" && <p className="text-xs text-slate-400 italic">Awaiting action…</p>}
        {remarks && (
          <p className="mt-1.5 text-xs text-slate-600 bg-slate-50 rounded-lg px-3 py-2 border border-slate-100 italic">
            "{remarks}"
          </p>
        )}
      </div>
    </div>
  );
}

// ── Request Card ──────────────────────────────────────────────────────────────

function RequestCard({
  request, onDetail, onAction, isHR, isBranchHead,
}: {
  request: ReactivationRequest;
  onDetail: () => void;
  onAction: (mode: "branch_head" | "hr_final") => void;
  isHR: boolean;
  isBranchHead: boolean;
}) {
  const canBranchAct = (isBranchHead || isHR) && request.status === "pending";
  const canHRAct = isHR && request.status === "branch_head_approved";

  return (
    <div className="group rounded-2xl border border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm transition-all p-5">
      <div className="flex items-start gap-4">
        {/* Avatar */}
        <div className="w-10 h-10 rounded-2xl bg-slate-100 text-slate-600 flex items-center justify-center shrink-0 text-sm font-bold">
          {request.employee_name?.split(" ").map(n => n[0]).slice(0, 2).join("") ?? "?"}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0 space-y-1.5">
          <div className="flex items-start gap-2 flex-wrap">
            <p className="text-sm font-bold text-slate-900">{request.employee_name}</p>
            <span className="text-xs text-slate-400 font-mono">{request.employee_code}</span>
            <StatusBadge status={request.status} />
            {request.ff_already_paid === 1 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 border border-amber-200 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                <AlertTriangle className="w-2.5 h-2.5" /> F&F Paid
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 flex-wrap text-xs text-slate-500">
            {request.branch_name && (
              <span className="flex items-center gap-1"><Building2 className="w-3 h-3" />{request.branch_name}</span>
            )}
            <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />Join: {fmtDate(request.proposed_joining_date)}</span>
            <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{request.gap_days}d gap</span>
          </div>

          <p className="text-xs text-slate-400 line-clamp-1 italic">"{request.reinstatement_reason}"</p>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 shrink-0 pl-2">
          <button
            onClick={onDetail}
            className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 hover:border-slate-300 transition-all cursor-pointer flex items-center gap-1.5"
          >
            <Eye className="w-3.5 h-3.5" /> View
          </button>

          {canBranchAct && (
            <button
              onClick={() => onAction("branch_head")}
              className="rounded-xl bg-blue-600 text-white px-3 py-1.5 text-xs font-semibold hover:bg-blue-700 transition-colors cursor-pointer"
            >
              Review
            </button>
          )}

          {canHRAct && (
            <button
              onClick={() => onAction("hr_final")}
              className="rounded-xl bg-emerald-600 text-white px-3 py-1.5 text-xs font-semibold hover:bg-emerald-700 transition-colors cursor-pointer flex items-center gap-1.5"
            >
              <UserCheck className="w-3.5 h-3.5" /> Finalise
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function NativeEmployeeReactivation() {
  const { user } = useAuth();
  const role = (user as any)?.role ?? "";
  const isHR = ["hr", "admin", "super_admin"].includes(role);
  const isBranchHead = role === "branch_head" || isHR;
  const isPayrollHead = role === "payroll_head";

  const [tab, setTab] = useState<"pending" | "all">(isHR || isBranchHead ? "pending" : "all");
  const [pending, setPending] = useState<ReactivationRequest[]>([]);
  const [all, setAll] = useState<AllList | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [showInitiate, setShowInitiate] = useState(false);
  const [actionTarget, setActionTarget] = useState<{ request: ReactivationRequest; mode: "branch_head" | "hr_final" } | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [allPage, setAllPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState("");

  async function fetchPending() {
    setLoading(true);
    setError(null);
    try {
      const res = await hrmsApi.get<{ success: boolean; data: ReactivationRequest[] }>("/api/employees/reactivation/pending");
      setPending(res.data ?? []);
    } catch (err: any) {
      setError(err?.message ?? "Failed to load pending requests");
    } finally {
      setLoading(false);
    }
  }

  async function fetchAll(page = 1) {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page), limit: "20" });
      if (statusFilter) params.set("status", statusFilter);
      const res: any = await hrmsApi.get(`/api/employees/reactivation/all?${params}`);
      setAll({ data: res.data ?? [], total: res.total ?? 0, page: res.page ?? 1, limit: res.limit ?? 20 });
    } catch (err: any) {
      setError(err?.message ?? "Failed to load reactivations");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (tab === "pending") fetchPending();
    else fetchAll(allPage);
  }, [tab, allPage, statusFilter]);

  function handleSuccess() {
    setShowInitiate(false);
    setActionTarget(null);
    fetchPending();
    if (tab === "all") fetchAll(allPage);
  }

  const pendingCount = pending.length;

  const summaryStats = [
    { label: "Pending Review", value: pending.filter(r => r.status === "pending").length, color: "text-amber-600", bg: "bg-amber-50" },
    { label: "Awaiting HR", value: pending.filter(r => r.status === "branch_head_approved").length, color: "text-blue-600", bg: "bg-blue-50" },
    { label: "Reactivated (Month)", value: all?.data?.filter(r => r.status === "approved").length ?? 0, color: "text-emerald-600", bg: "bg-emerald-50" },
    { label: "Rejected", value: all?.data?.filter(r => r.status === "rejected").length ?? 0, color: "text-red-600", bg: "bg-red-50" },
  ];

  return (
    <DashboardLayout>
      <div className="min-h-screen bg-slate-50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-6">

          {/* Page header */}
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h1 className="text-2xl font-black text-slate-900 tracking-tight">Employee Reactivation</h1>
              <p className="text-sm text-slate-500 mt-1">Manage rejoining workflows for inactive and absconding employees</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => { if (tab === "pending") fetchPending(); else fetchAll(allPage); }}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 hover:border-slate-300 transition-all cursor-pointer flex items-center gap-2"
              >
                <RefreshCcw className="w-4 h-4" />
                <span className="hidden sm:inline">Refresh</span>
              </button>
              {isHR && (
                <button
                  onClick={() => setShowInitiate(true)}
                  className="rounded-xl bg-blue-600 text-white px-4 py-2 text-sm font-semibold hover:bg-blue-700 transition-colors cursor-pointer flex items-center gap-2"
                >
                  <Plus className="w-4 h-4" />
                  Initiate Request
                </button>
              )}
            </div>
          </div>

          {/* Summary stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {summaryStats.map(s => (
              <div key={s.label} className="rounded-2xl border border-slate-200 bg-white px-4 py-4">
                <p className="text-xs text-slate-500 font-medium">{s.label}</p>
                <p className={`text-2xl font-black mt-1 ${s.color}`}>{s.value}</p>
              </div>
            ))}
          </div>

          {/* Tabs */}
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl w-fit">
            {(isHR || isBranchHead) && (
              <button
                onClick={() => setTab("pending")}
                className={`relative rounded-lg px-4 py-2 text-sm font-semibold transition-all cursor-pointer ${
                  tab === "pending" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
                }`}
              >
                Pending Action
                {pendingCount > 0 && (
                  <span className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-amber-500 text-white text-[9px] font-black flex items-center justify-center">
                    {pendingCount > 9 ? "9+" : pendingCount}
                  </span>
                )}
              </button>
            )}
            {(isHR || isPayrollHead) && (
              <button
                onClick={() => setTab("all")}
                className={`rounded-lg px-4 py-2 text-sm font-semibold transition-all cursor-pointer ${
                  tab === "all" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
                }`}
              >
                All Requests
              </button>
            )}
          </div>

          {/* Error banner */}
          {error && (
            <div className="flex items-center gap-3 rounded-2xl bg-red-50 border border-red-200 px-5 py-4 text-sm text-red-700">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              <span>{error}</span>
              <button
                onClick={() => { if (tab === "pending") fetchPending(); else fetchAll(allPage); }}
                className="ml-auto text-xs font-semibold text-red-700 underline cursor-pointer"
              >
                Retry
              </button>
            </div>
          )}

          {/* Pending Tab */}
          {tab === "pending" && (
            <div className="space-y-3">
              {loading && (
                <div className="space-y-3">
                  {[1, 2, 3].map(i => (
                    <div key={i} className="h-24 rounded-2xl bg-slate-200/60 animate-pulse" />
                  ))}
                </div>
              )}
              {!loading && pending.length === 0 && (
                <div className="rounded-3xl border-2 border-dashed border-slate-200 bg-white px-8 py-16 text-center">
                  <div className="w-14 h-14 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto mb-4">
                    <CheckCircle2 className="w-7 h-7" />
                  </div>
                  <p className="text-base font-bold text-slate-700">All clear!</p>
                  <p className="text-sm text-slate-400 mt-1">No pending reactivation requests require your action.</p>
                </div>
              )}
              {!loading && pending.map(r => (
                <RequestCard
                  key={r.id}
                  request={r}
                  onDetail={() => setDetailId(r.id)}
                  onAction={mode => setActionTarget({ request: r, mode })}
                  isHR={isHR}
                  isBranchHead={isBranchHead}
                />
              ))}
            </div>
          )}

          {/* All Tab */}
          {tab === "all" && (
            <div className="space-y-4">
              {/* Filters */}
              <div className="flex items-center gap-3 flex-wrap">
                <select
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
                  value={statusFilter}
                  onChange={e => { setStatusFilter(e.target.value); setAllPage(1); }}
                >
                  <option value="">All statuses</option>
                  <option value="pending">Pending</option>
                  <option value="branch_head_approved">Pending HR Final</option>
                  <option value="approved">Approved / Reactivated</option>
                  <option value="rejected">Rejected</option>
                  <option value="cancelled">Cancelled</option>
                </select>
                {all && (
                  <p className="text-xs text-slate-400">{all.total} total request{all.total !== 1 ? "s" : ""}</p>
                )}
              </div>

              {loading && (
                <div className="space-y-3">
                  {[1, 2].map(i => <div key={i} className="h-24 rounded-2xl bg-slate-200/60 animate-pulse" />)}
                </div>
              )}

              {!loading && (all?.data ?? []).length === 0 && (
                <div className="rounded-3xl border-2 border-dashed border-slate-200 bg-white px-8 py-14 text-center">
                  <Users className="w-10 h-10 text-slate-300 mx-auto mb-3" />
                  <p className="text-sm font-semibold text-slate-500">No requests found</p>
                  <p className="text-xs text-slate-400 mt-1">Try changing the status filter.</p>
                </div>
              )}

              {!loading && (all?.data ?? []).map(r => (
                <RequestCard
                  key={r.id}
                  request={r}
                  onDetail={() => setDetailId(r.id)}
                  onAction={mode => setActionTarget({ request: r, mode })}
                  isHR={isHR}
                  isBranchHead={isBranchHead}
                />
              ))}

              {/* Pagination */}
              {all && all.total > all.limit && (
                <div className="flex items-center justify-center gap-3 pt-2">
                  <button
                    onClick={() => setAllPage(p => Math.max(1, p - 1))}
                    disabled={all.page <= 1}
                    className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer"
                  >
                    Previous
                  </button>
                  <span className="text-sm text-slate-500 font-medium">
                    Page {all.page} of {Math.ceil(all.total / all.limit)}
                  </span>
                  <button
                    onClick={() => setAllPage(p => p + 1)}
                    disabled={all.page * all.limit >= all.total}
                    className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer"
                  >
                    Next
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Overlays */}
      {showInitiate && (
        <InitiateDialog onClose={() => setShowInitiate(false)} onSuccess={handleSuccess} />
      )}
      {actionTarget && (
        <ActionModal
          request={actionTarget.request}
          mode={actionTarget.mode}
          onClose={() => setActionTarget(null)}
          onSuccess={handleSuccess}
        />
      )}
      {detailId && (
        <DetailDrawer id={detailId} onClose={() => setDetailId(null)} />
      )}
    </DashboardLayout>
  );
}
