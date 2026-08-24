import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, ArrowRight, CheckCircle2, ChevronRight, ClipboardList,
  Loader, Lock, RefreshCcw, Search, ShieldCheck, UserMinus, X,
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { useWorkforceAccess } from "@/hooks/useUserRole";
import { hrmsApi } from "@/lib/hrmsApi";

// ─── Types ────────────────────────────────────────────────────────────────────

type ExitRequest = {
  id: string;
  employee_id: string;
  employee_name?: string;
  employee_code?: string;
  branch_name?: string;
  department_name?: string;
  designation_name?: string;
  exit_type: string;
  exit_sub_type?: string;
  last_working_day_confirmed?: string;
  last_working_day_proposed?: string;
  status: string;
  created_at: string;
  clearance_total?: number;
  clearance_cleared?: number;
  risk_label?: string | null;
  regrettable_exit?: number | boolean | null;
  is_ff_provisional?: number | boolean | null;
  notice_period_days?: number;
  reason?: string;
};

type FFCalculation = {
  id: string;
  exit_request_id: string;
  calculation_date: string;
  notice_period_days: number;
  notice_shortfall_days: number;
  notice_recovery: number;
  gratuity_amount: number;
  salary_hold: number;
  advances_recovery: number;
  net_payable: number;
  status: "draft" | "verified" | "approved" | "paid";
  is_ff_provisional?: number;
  approved_at?: string;
  created_at?: string;
};

export type FFFormState = {
  calculation_date: string;
  notice_period_days: string;
  notice_shortfall_days: string;
  notice_recovery: string;
  gratuity_amount: string;
  salary_hold: string;
  advances_recovery: string;
  net_payable: string;
};

// Mirrors ff-compute.service.ts's FfComputePreview — only the fields this form needs.
export type ComputedComponent = { value: number; status: "computed" | "not_applicable" | "pending_configuration"; note: string };
export type FfComputePreview = {
  notice: { recovery_amount: ComputedComponent };
  gratuity: { amount: number; status: "draft" | "not_eligible" | "pending_configuration"; note: string };
  advances_loans: { total_recovery: ComputedComponent };
};

// ─── Constants & Helpers ──────────────────────────────────────────────────────

export const DEVIATION_TOLERANCE = 0.01;

export function computedFieldsFromPreview(preview: FfComputePreview | null): Partial<Record<keyof FFFormState, ComputedComponent>> {
  if (!preview) return {};
  const fields: Partial<Record<keyof FFFormState, ComputedComponent>> = {
    notice_recovery: preview.notice.recovery_amount,
    advances_recovery: preview.advances_loans.total_recovery,
  };
  if (preview.gratuity.status === "draft") {
    fields.gratuity_amount = { value: preview.gratuity.amount, status: "computed", note: preview.gratuity.note };
  }
  return fields;
}

export function deviatingFields(form: FFFormState, preview: FfComputePreview | null): string[] {
  const computed = computedFieldsFromPreview(preview);
  return (Object.keys(computed) as (keyof FFFormState)[]).filter((key) => {
    const c = computed[key];
    if (!c || c.status !== "computed") return false;
    return Math.abs(toNum(form[key]) - c.value) > DEVIATION_TOLERANCE;
  });
}

const INR = (v: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(v ?? 0);
const toNum = (v: string): number => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };
const fmtDate = (v?: string | null) => v ? v.slice(0, 10).split("-").reverse().join("/") : "—";

const EMPTY_FORM: FFFormState = {
  calculation_date: new Date().toISOString().slice(0, 10),
  notice_period_days: "30",
  notice_shortfall_days: "0",
  notice_recovery: "0",
  gratuity_amount: "0",
  salary_hold: "0",
  advances_recovery: "0",
  net_payable: "0",
};

const FF_STATUS_COLORS: Record<string, string> = {
  draft: "bg-slate-100 text-slate-700",
  verified: "bg-blue-50 text-blue-700",
  approved: "bg-emerald-50 text-emerald-700",
  paid: "bg-violet-50 text-violet-700",
};

const EXIT_STATUS_COLORS: Record<string, string> = {
  approved: "bg-emerald-50 text-emerald-700",
  notice_period: "bg-cyan-50 text-cyan-700",
  notice_serving: "bg-cyan-50 text-cyan-700",
  exit_confirmed: "bg-green-100 text-green-800",
  exited: "bg-green-100 text-green-800",
  accepted: "bg-blue-50 text-blue-700",
};

function normalizeExitStatus(status: string) { return status === "exit_confirmed" ? "exited" : status; }
function human(v?: string | null) { return v ? v.replace(/_/g, " ") : "—"; }

function Badge({ label, cls }: { label: string; cls: string }) {
  return <span className={`rounded-full px-3 py-1 text-xs font-semibold capitalize ${cls}`}>{human(label)}</span>;
}
function clearancePct(req: ExitRequest | null) {
  const total = Number(req?.clearance_total ?? 0);
  const cleared = Number(req?.clearance_cleared ?? 0);
  return total ? Math.round((cleared / total) * 100) : 0;
}
function hasOpenClearance(req: ExitRequest | null) {
  return Number(req?.clearance_total ?? 0) > Number(req?.clearance_cleared ?? 0);
}

export function netFromForm(form: FFFormState) {
  return toNum(form.gratuity_amount)
    - toNum(form.notice_recovery) - toNum(form.salary_hold) - toNum(form.advances_recovery);
}

function netFromFF(ff: FFCalculation) {
  return ff.gratuity_amount - ff.notice_recovery - ff.salary_hold - ff.advances_recovery;
}

function rowBorderClass(req: ExitRequest): string {
  if (req.is_ff_provisional === 1 || req.is_ff_provisional === true) return "border-l-4 border-l-red-400";
  const s = normalizeExitStatus(req.status);
  if (s === "paid") return "border-l-4 border-l-blue-400";
  if (s === "exited" || s === "exit_confirmed") return "border-l-4 border-l-blue-400";
  if (s === "approved") return "border-l-4 border-l-emerald-400";
  return "border-l-4 border-l-amber-300";
}

// ─── ExitDetailDrawer ──────────────────────────────────────────────────────────

function ExitDetailDrawer({
  req, ffCalc, onClose,
}: {
  req: ExitRequest;
  ffCalc: FFCalculation | null;
  onClose: () => void;
}) {
  const pct = clearancePct(req);
  const status = normalizeExitStatus(req.status);
  const isProvisional = req.is_ff_provisional === 1 || req.is_ff_provisional === true;

  const fields: { label: string; value: string }[] = [
    { label: "Employee Code", value: req.employee_code ?? "—" },
    { label: "Branch", value: req.branch_name ?? "—" },
    { label: "Department", value: req.department_name ?? "—" },
    { label: "Designation", value: req.designation_name ?? "—" },
    { label: "Exit Type", value: human(req.exit_type) },
    { label: "Exit Sub-Type", value: human(req.exit_sub_type) },
    { label: "LWD Proposed", value: fmtDate(req.last_working_day_proposed) },
    { label: "LWD Confirmed", value: fmtDate(req.last_working_day_confirmed) },
    { label: "Notice Period", value: req.notice_period_days ? `${req.notice_period_days} days` : "—" },
    { label: "Request Date", value: fmtDate(req.created_at) },
    { label: "Risk Label", value: req.risk_label ?? "—" },
    { label: "Regrettable Exit", value: req.regrettable_exit ? "Yes" : "No" },
    { label: "Reason", value: req.reason ?? "—" },
  ];

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm"
        onClick={onClose}
      />
      {/* Drawer */}
      <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-2xl flex-col bg-white shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b bg-gradient-to-r from-rose-600 to-pink-600 px-6 py-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-rose-200 mb-0.5">Exit Request Detail</p>
            <h2 className="text-lg font-black text-white">
              {req.employee_name ?? req.employee_id}
            </h2>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-white/20 px-2.5 py-0.5 text-xs font-bold text-white capitalize">
                {human(status)}
              </span>
              {isProvisional && (
                <span className="rounded-full bg-red-300/40 px-2.5 py-0.5 text-xs font-bold text-red-100 border border-red-300/40">
                  Provisional
                </span>
              )}
              {ffCalc && (
                <span className="rounded-full bg-white/20 px-2.5 py-0.5 text-xs font-bold text-white">
                  F&F: {human(ffCalc.status)}
                </span>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-xl bg-white/20 p-1.5 text-white hover:bg-white/30 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">

          {/* Employee & Exit Info */}
          <section>
            <h3 className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-3">Employee & Exit Details</h3>
            <div className="grid grid-cols-2 gap-3">
              {fields.map(({ label, value }) => (
                <div key={label} className="rounded-xl bg-slate-50 px-4 py-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</p>
                  <p className="mt-1 text-sm font-bold text-slate-800 capitalize">{value}</p>
                </div>
              ))}
            </div>
          </section>

          {/* Clearance Progress */}
          <section>
            <h3 className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-3">Clearance Progress</h3>
            <div className="rounded-2xl border bg-slate-50 p-4">
              <div className="flex items-center justify-between text-sm font-bold text-slate-700 mb-2">
                <span className="flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-emerald-600" />
                  Clearance Status
                </span>
                <span className={pct === 100 ? "text-emerald-700" : "text-amber-700"}>
                  {Number(req.clearance_cleared ?? 0)}/{Number(req.clearance_total ?? 0)} ({pct}%)
                </span>
              </div>
              <div className="h-3 rounded-full bg-white border">
                <div
                  className={`h-3 rounded-full transition-all ${pct === 100 ? "bg-emerald-500" : "bg-amber-400"}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              {pct === 100 ? (
                <p className="mt-2 text-xs font-semibold text-emerald-700">All clearance items completed.</p>
              ) : (
                <p className="mt-2 text-xs font-semibold text-amber-700">
                  {Number(req.clearance_total ?? 0) - Number(req.clearance_cleared ?? 0)} item(s) pending clearance.
                </p>
              )}
            </div>
          </section>

          {/* F&F Settlement */}
          {ffCalc ? (
            <section>
              <h3 className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-3">F&F Settlement</h3>
              <div className="rounded-2xl border bg-white overflow-hidden">
                <div className="grid grid-cols-2 divide-x divide-y">
                  {([
                    ["Notice Recovery", ffCalc.notice_recovery, "deduction"],
                    ["Gratuity Amount", ffCalc.gratuity_amount, "credit"],
                    ["Salary Hold", ffCalc.salary_hold, "deduction"],
                    ["Advance Recovery", ffCalc.advances_recovery, "deduction"],
                  ] as [string, number, string][]).map(([label, amount, type]) => (
                    <div key={label} className="p-4">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</p>
                      <p className={`mt-1 text-base font-black font-mono ${type === "credit" ? "text-emerald-700" : "text-rose-600"}`}>
                        {type === "deduction" ? "– " : ""}{INR(amount)}
                      </p>
                    </div>
                  ))}
                </div>
                <div className="border-t bg-slate-950 px-5 py-4 flex items-center justify-between">
                  <p className="text-sm font-bold text-slate-400">Net Payable</p>
                  <p className="text-xl font-black text-white font-mono">{INR(ffCalc.net_payable)}</p>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-3">
                <div className="rounded-xl bg-slate-50 px-3 py-2.5">
                  <p className="text-xs font-semibold text-slate-400">Notice Period</p>
                  <p className="mt-0.5 text-sm font-bold text-slate-800">{ffCalc.notice_period_days} days</p>
                </div>
                <div className="rounded-xl bg-slate-50 px-3 py-2.5">
                  <p className="text-xs font-semibold text-slate-400">Shortfall</p>
                  <p className="mt-0.5 text-sm font-bold text-slate-800">{ffCalc.notice_shortfall_days} days</p>
                </div>
                <div className="rounded-xl bg-slate-50 px-3 py-2.5">
                  <p className="text-xs font-semibold text-slate-400">Calc. Date</p>
                  <p className="mt-0.5 text-sm font-bold text-slate-800 font-mono">{fmtDate(ffCalc.calculation_date)}</p>
                </div>
              </div>
              {ffCalc.approved_at && (
                <div className="mt-3 rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-2.5">
                  <p className="text-xs font-semibold text-emerald-700">
                    Approved on {fmtDate(ffCalc.approved_at)}
                  </p>
                </div>
              )}
            </section>
          ) : (
            <section>
              <h3 className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-3">F&F Settlement</h3>
              <div className="rounded-2xl border border-dashed border-slate-200 p-6 text-center text-slate-400">
                <ClipboardList className="mx-auto mb-2 h-8 w-8 opacity-30" />
                <p className="text-sm font-semibold">No F&F settlement prepared yet.</p>
              </div>
            </section>
          )}

        </div>

        {/* Footer */}
        <div className="border-t bg-slate-50 px-6 py-4 text-right">
          <button
            onClick={onClose}
            className="rounded-xl border border-slate-200 bg-white px-5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </>
  );
}

// ─── PrepareFFForm ─────────────────────────────────────────────────────────────

function PrepareFFForm({
  form, onChange, onSubmit, submitting, preview, previewLoading, overrideReason, onOverrideReasonChange,
}: {
  form: FFFormState; onChange: (f: FFFormState) => void; onSubmit: () => void; submitting: boolean;
  preview: FfComputePreview | null; previewLoading: boolean;
  overrideReason: string; onOverrideReasonChange: (v: string) => void;
}) {
  const set = (key: keyof FFFormState) => (e: React.ChangeEvent<HTMLInputElement>) => onChange({ ...form, [key]: e.target.value });
  const calculatedNet = netFromForm(form);
  const netMismatch = Math.abs(calculatedNet - toNum(form.net_payable)) > DEVIATION_TOLERANCE;
  const computedFields = computedFieldsFromPreview(preview);
  const deviating = deviatingFields(form, preview);
  const needsOverrideReason = deviating.length > 0 && !overrideReason.trim();

  const fields: { key: keyof FFFormState; label: string; desc?: string; type?: string; deduction?: boolean }[] = [
    { key: "calculation_date", label: "Calculation Date", type: "date" },
    { key: "notice_period_days", label: "Notice Period Days", desc: "Total required notice" },
    { key: "notice_shortfall_days", label: "Notice Shortfall Days", desc: "Days short of full notice" },
    { key: "notice_recovery", label: "Notice Recovery", desc: "Recovery for notice shortfall", deduction: true },
    { key: "gratuity_amount", label: "Gratuity Amount", desc: "As per Gratuity Act" },
    { key: "salary_hold", label: "Salary Hold", desc: "Held salary amount", deduction: true },
    { key: "advances_recovery", label: "Advance / Loan Recovery", desc: "Recoverable advance/loan", deduction: true },
  ];

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-blue-100 bg-blue-50 p-4 text-sm text-blue-800">
        <b>Settlement formula:</b> Gratuity − notice recovery − salary hold − advances. Net payable is auto-derived for governance.
      </div>
      {previewLoading && (
        <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-500">
          <Loader className="h-4 w-4 animate-spin" /> Computing real figures from attendance and loan records…
        </div>
      )}
      {!previewLoading && preview && (
        <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4 text-sm text-emerald-900">
          <b>Computed by the system</b> — pre-filled below where available.
          <ul className="mt-2 space-y-1 text-xs">
            {(Object.entries(computedFields) as [keyof FFFormState, ComputedComponent][]).map(([key, c]) => (
              <li key={key}>
                {fields.find((f) => f.key === key)?.label ?? key}:{" "}
                {c.status === "computed"
                  ? INR(c.value)
                  : <span className="italic text-amber-700">not yet configured — {c.note}</span>
                }
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        {fields.map(({ key, label, desc, type, deduction }) => {
          const isDeviating = deviating.includes(key);
          return (
            <div key={key}>
              <label className="mb-1.5 block text-sm font-semibold text-slate-700">
                {label}{deduction && <span className="ml-1 text-xs text-rose-500">(deduction)</span>}
              </label>
              <input
                type={type === "date" ? "date" : "number"}
                min={type !== "date" ? "0" : undefined}
                value={form[key]}
                onChange={set(key)}
                className={`w-full rounded-2xl border px-4 py-3 text-sm font-mono outline-none transition-colors focus:border-blue-400 ${
                  isDeviating ? "border-amber-400 bg-amber-50" : deduction ? "border-rose-100" : ""
                }`}
              />
              {desc && <p className="mt-1 text-xs text-slate-400">{desc}</p>}
              {isDeviating && (
                <p className="mt-1 text-xs font-bold text-amber-700">
                  Differs from computed value ({INR(computedFields[key]!.value)}) — explain below.
                </p>
              )}
            </div>
          );
        })}
      </div>
      {deviating.length > 0 && (
        <div>
          <label className="mb-1.5 block text-sm font-black text-slate-700">
            Reason for deviation<span className="ml-1 text-xs text-rose-500">(required)</span>
          </label>
          <textarea
            value={overrideReason}
            onChange={(e) => onOverrideReasonChange(e.target.value)}
            rows={2}
            placeholder="Why do the typed figures differ from what the system computed?"
            className={`w-full rounded-2xl border px-4 py-3 text-sm outline-none transition-colors focus:border-blue-400 ${
              needsOverrideReason ? "border-amber-400 bg-amber-50" : ""
            }`}
          />
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border bg-slate-50 p-4">
          <p className="text-xs font-black uppercase tracking-wide text-slate-500">Calculated Net Payable</p>
          <p className="mt-2 text-2xl font-black text-slate-950">{INR(calculatedNet)}</p>
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-black text-slate-700">Net Payable Override</label>
          <input
            type="number"
            value={form.net_payable}
            onChange={set("net_payable")}
            className="w-full rounded-2xl border-2 border-slate-950 px-4 py-3 text-lg font-black font-mono outline-none transition-colors focus:border-blue-400"
          />
          {netMismatch && (
            <p className="mt-1 text-xs font-bold text-amber-700">Manual net payable differs from calculated value.</p>
          )}
        </div>
      </div>
      <button
        type="button"
        onClick={() => onChange({ ...form, net_payable: String(calculatedNet) })}
        className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm font-semibold text-blue-700 hover:bg-blue-100 cursor-pointer transition-colors"
      >
        Use Calculated Net
      </button>
      <button
        onClick={onSubmit}
        disabled={submitting || netMismatch || needsOverrideReason}
        className="flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-950 py-3.5 text-sm font-bold text-white transition-colors hover:bg-slate-800 disabled:opacity-50 cursor-pointer"
      >
        {submitting ? <Loader className="h-4 w-4 animate-spin" /> : <ClipboardList className="h-4 w-4" />}
        Create F&F Settlement
      </button>
      {netMismatch && (
        <p className="text-center text-xs font-bold text-amber-700">Resolve net payable mismatch before creating settlement.</p>
      )}
      {needsOverrideReason && (
        <p className="text-center text-xs font-bold text-amber-700">Provide a reason for the deviation before creating settlement.</p>
      )}
    </div>
  );
}

// ─── FFBreakdown ───────────────────────────────────────────────────────────────

function FFBreakdown({ ff }: { ff: FFCalculation }) {
  const deductions = ff.notice_recovery + ff.salary_hold + ff.advances_recovery;
  const credits = ff.gratuity_amount;
  const calculated = netFromFF(ff);
  const mismatch = Math.abs(calculated - ff.net_payable) > DEVIATION_TOLERANCE;
  const isProvisional = Number(ff.is_ff_provisional ?? 0) === 1;

  return (
    <div className="space-y-4">
      {isProvisional && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-bold text-amber-800 flex items-center gap-3">
          <AlertTriangle className="h-4 w-4 flex-shrink-0 text-amber-600" />
          Settlement is provisional — final disbursement requires authorized override.
        </div>
      )}
      {mismatch && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-bold text-amber-800">
          Net payable mismatch: calculated {INR(calculated)} but saved {INR(ff.net_payable)}.
        </div>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <h4 className="mb-2 text-xs font-black uppercase tracking-wide text-slate-500">Credits</h4>
          <table className="w-full text-sm">
            <tbody>
              {([["Gratuity Amount", ff.gratuity_amount]] as [string, number][]).map(([label, amount]) => (
                <tr key={label} className="border-b last:border-0">
                  <td className="py-2.5 text-slate-600">{label}</td>
                  <td className="py-2.5 text-right font-mono font-semibold text-emerald-700">{INR(amount)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-emerald-50">
                <td className="rounded-l-xl px-2 py-2.5 font-black text-emerald-800">Total Credits</td>
                <td className="rounded-r-xl px-2 py-2.5 text-right font-mono font-black text-emerald-800">{INR(credits)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        <div>
          <h4 className="mb-2 text-xs font-black uppercase tracking-wide text-slate-500">Deductions</h4>
          <table className="w-full text-sm">
            <tbody>
              {([["Notice Recovery", ff.notice_recovery], ["Salary Hold", ff.salary_hold], ["Advance Recovery", ff.advances_recovery]] as [string, number][]).map(([label, amount]) => (
                <tr key={label} className="border-b last:border-0">
                  <td className="py-2.5 text-slate-600">{label}</td>
                  <td className="py-2.5 text-right font-mono font-semibold text-rose-600">– {INR(amount)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-rose-50">
                <td className="rounded-l-xl px-2 py-2.5 font-black text-rose-800">Total Deductions</td>
                <td className="rounded-r-xl px-2 py-2.5 text-right font-mono font-black text-rose-800">– {INR(deductions)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
      <div className="grid gap-3 text-sm md:grid-cols-3">
        <div className="rounded-xl bg-slate-50 p-3">
          <p className="text-xs font-semibold text-slate-500">Notice Period</p>
          <p className="mt-1 font-bold text-slate-950">{ff.notice_period_days} days</p>
        </div>
        <div className="rounded-xl bg-slate-50 p-3">
          <p className="text-xs font-semibold text-slate-500">Shortfall</p>
          <p className="mt-1 font-bold text-slate-950">{ff.notice_shortfall_days} days</p>
        </div>
        <div className="rounded-xl bg-slate-50 p-3">
          <p className="text-xs font-semibold text-slate-500">Calc. Date</p>
          <p className="mt-1 font-mono font-bold text-slate-950">{fmtDate(ff.calculation_date)}</p>
        </div>
      </div>
    </div>
  );
}

// ─── Status Filter Tabs ────────────────────────────────────────────────────────

type StatusFilter = "all" | "notice" | "exited" | "provisional" | "paid";

const STATUS_TABS: { key: StatusFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "notice", label: "In Notice" },
  { key: "exited", label: "Exited" },
  { key: "provisional", label: "Provisional" },
  { key: "paid", label: "Paid" },
];

// ─── Main Component ────────────────────────────────────────────────────────────

export default function NativeFullFinal() {
  useWorkforceAccess();
  const [exitRequests, setExitRequests] = useState<ExitRequest[]>([]);
  const [selectedRequest, setSelectedRequest] = useState<ExitRequest | null>(null);
  const [ffCalc, setFfCalc] = useState<FFCalculation | null>(null);
  const [form, setForm] = useState<FFFormState>(EMPTY_FORM);
  const [preview, setPreview] = useState<FfComputePreview | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");
  const [loadingRequests, setLoadingRequests] = useState(false);
  const [loadingFF, setLoadingFF] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [approving, setApproving] = useState(false);
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState<"info" | "success" | "error">("info");

  // Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  // Drill-down drawer
  const [drawerOpen, setDrawerOpen] = useState(false);

  const loadRequests = async () => {
    setLoadingRequests(true); setMessage("");
    try {
      const all: ExitRequest[] = [];
      let page = 1;
      let total = Infinity;
      while (all.length < total && page <= 20) {
        const res = await hrmsApi.get<{ success: boolean; data: ExitRequest[]; total?: number }>(`/api/exit?limit=100&page=${page}`);
        const rows = res.data ?? [];
        all.push(...rows);
        total = typeof res.total === "number" ? res.total : all.length;
        if (rows.length < 100) break;
        page += 1;
      }
      const relevant = all.filter((r) =>
        ["approved", "notice_period", "notice_serving", "exit_confirmed", "exited", "accepted"].includes(normalizeExitStatus(r.status)) ||
        ["accepted", "notice_serving"].includes(r.status)
      );
      setExitRequests(relevant);
    } catch (err: unknown) { showMessage((err as Error).message || "Failed to load exit requests.", "error"); }
    finally { setLoadingRequests(false); }
  };

  const loadFF = async (exitId: string) => {
    setLoadingFF(true); setFfCalc(null); setForm(EMPTY_FORM);
    try {
      const res = await hrmsApi.get<{ success: boolean; data: FFCalculation }>(`/api/exit/ff/${exitId}`);
      if (res.data) setFfCalc(res.data);
    } catch (err: unknown) {
      const e = err as Error;
      if (!e.message?.includes("404") && !e.message?.toLowerCase().includes("not found"))
        showMessage(e.message || "Failed to load F&F calculation.", "error");
    } finally { setLoadingFF(false); }
  };

  const loadPreview = async (exitId: string) => {
    setLoadingPreview(true); setPreview(null);
    try {
      const res = await hrmsApi.get<{ success: boolean; data: FfComputePreview }>(`/api/exit/ff/${exitId}/compute`);
      if (res.data) setPreview(res.data);
    } catch (err: unknown) { console.warn("[F&F] compute preview unavailable:", (err as Error).message); }
    finally { setLoadingPreview(false); }
  };

  useEffect(() => { void loadRequests(); }, []);

  const selectRequest = (req: ExitRequest) => {
    setSelectedRequest(req); setFfCalc(null); setForm(EMPTY_FORM); setPreview(null); setOverrideReason("");
    void loadFF(req.id); void loadPreview(req.id);
  };

  useEffect(() => {
    if (loadingFF || loadingPreview || ffCalc || !preview) return;
    const computed = computedFieldsFromPreview(preview);
    setForm((prev) => {
      const next = { ...prev };
      (Object.keys(computed) as (keyof FFFormState)[]).forEach((key) => {
        const c = computed[key];
        if (c && c.status === "computed") next[key] = String(c.value);
      });
      next.net_payable = String(netFromForm(next));
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview, loadingFF, loadingPreview, ffCalc]);

  const createFF = async () => {
    if (!selectedRequest) return;
    const calculatedNet = netFromForm(form);
    if (Math.abs(calculatedNet - toNum(form.net_payable)) > DEVIATION_TOLERANCE)
      return showMessage("Net payable mismatch. Use calculated net or correct the override.", "error");
    const deviating = deviatingFields(form, preview);
    if (deviating.length > 0 && !overrideReason.trim())
      return showMessage("Provide a reason for the figures that differ from the computed values.", "error");
    setSubmitting(true); setMessage("");
    try {
      await hrmsApi.post(`/api/exit/ff/${selectedRequest.id}`, {
        calculation_date: form.calculation_date,
        notice_period_days: toNum(form.notice_period_days),
        notice_shortfall_days: toNum(form.notice_shortfall_days),
        notice_recovery: toNum(form.notice_recovery),
        earned_leave_encashment: 0,
        gratuity_amount: toNum(form.gratuity_amount),
        salary_hold: toNum(form.salary_hold),
        advances_recovery: toNum(form.advances_recovery),
        net_payable: toNum(form.net_payable),
        ...(deviating.length > 0 ? { overrideReason: overrideReason.trim() } : {}),
      });
      showMessage("F&F settlement created successfully. Verify statutory/provisional status before approval.", "success");
      setOverrideReason("");
      await loadFF(selectedRequest.id);
    } catch (err: unknown) { showMessage((err as Error).message || "Failed to create F&F.", "error"); }
    finally { setSubmitting(false); }
  };

  const approveFF = async () => {
    if (!ffCalc) return;
    if (hasOpenClearance(selectedRequest)) return showMessage("Cannot approve: clearance is incomplete.", "error");
    if (Number(ffCalc.is_ff_provisional ?? 0) === 1) return showMessage("Cannot approve: F&F is still provisional.", "error");
    setApproving(true); setMessage("");
    try {
      await hrmsApi.post(`/api/exit/ff/${ffCalc.id}/approve`, {});
      showMessage("F&F settlement approved.", "success");
      setFfCalc({ ...ffCalc, status: "approved", approved_at: new Date().toISOString() });
    } catch (err: unknown) { showMessage((err as Error).message || "Approval failed.", "error"); }
    finally { setApproving(false); }
  };

  function showMessage(msg: string, type: "info" | "success" | "error") { setMessage(msg); setMessageType(type); }

  // ── Derived state ──────────────────────────────────────────────────────────

  const filteredRequests = useMemo(() => {
    let list = exitRequests;

    // Text search
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (r) =>
          (r.employee_name ?? "").toLowerCase().includes(q) ||
          (r.employee_code ?? "").toLowerCase().includes(q)
      );
    }

    // Status filter
    if (statusFilter !== "all") {
      list = list.filter((r) => {
        const s = normalizeExitStatus(r.status);
        if (statusFilter === "notice") return ["notice_period", "notice_serving"].includes(r.status);
        if (statusFilter === "exited") return s === "exited";
        if (statusFilter === "provisional") return r.is_ff_provisional === 1 || r.is_ff_provisional === true;
        if (statusFilter === "paid") return r.status === "paid";
        return true;
      });
    }

    return list;
  }, [exitRequests, searchQuery, statusFilter]);

  // Aggregate KPI counts from full list
  const kpiStats = useMemo(() => ({
    total: exitRequests.length,
    inNotice: exitRequests.filter((r) => ["notice_period", "notice_serving"].includes(r.status)).length,
    exited: exitRequests.filter((r) => normalizeExitStatus(r.status) === "exited").length,
    provisional: exitRequests.filter((r) => r.is_ff_provisional === 1 || r.is_ff_provisional === true).length,
  }), [exitRequests]);

  const messageColors = {
    info: "border-blue-200 bg-blue-50 text-blue-800",
    success: "border-emerald-200 bg-emerald-50 text-emerald-800",
    error: "border-rose-200 bg-rose-50 text-rose-800",
  };
  const MessageIcon = messageType === "success" ? CheckCircle2 : AlertTriangle;
  const selectedClearancePct = clearancePct(selectedRequest);

  const approvalBlockedReasons = useMemo(() => {
    const reasons: string[] = [];
    if (hasOpenClearance(selectedRequest)) reasons.push("Clearance incomplete");
    if (ffCalc && Number(ffCalc.is_ff_provisional ?? 0) === 1) reasons.push("F&F provisional");
    if (ffCalc && ffCalc.status === "paid") reasons.push("Already paid");
    if (ffCalc && Math.abs(netFromFF(ffCalc) - ffCalc.net_payable) > DEVIATION_TOLERANCE) reasons.push("Net mismatch");
    return reasons;
  }, [selectedRequest, ffCalc]);

  const isCurrentProvisional = ffCalc ? Number(ffCalc.is_ff_provisional ?? 0) === 1 : false;

  return (
    <DashboardLayout>
      <div className="space-y-6">

        {/* ── Page header ── */}
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="rounded-2xl bg-gradient-to-br from-rose-600 via-pink-600 to-rose-700 text-white px-6 py-5 shadow-lg flex-1">
            <p className="text-rose-200 text-xs font-semibold uppercase tracking-widest mb-1">Payroll Governance</p>
            <h1 className="text-2xl font-bold tracking-tight">Full & Final Settlement</h1>
            <p className="text-rose-100 text-sm mt-0.5">Exit clearance, settlement computation and disbursement</p>
          </div>
          <button
            onClick={() => void loadRequests()}
            disabled={loadingRequests}
            className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:bg-slate-50 disabled:opacity-50 lg:self-start cursor-pointer"
          >
            <RefreshCcw className="h-4 w-4" />Refresh
          </button>
        </div>

        {/* ── Status message ── */}
        {message && (
          <div className={`flex items-center gap-3 rounded-2xl border p-4 text-sm font-bold ${messageColors[messageType]}`}>
            <MessageIcon className="h-4 w-4 flex-shrink-0" />{message}
          </div>
        )}

        {/* ── Aggregate KPI strip ── */}
        <div className="grid gap-4 md:grid-cols-4">
          <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-50 to-slate-100 p-4">
            <p className="text-xs font-black uppercase text-slate-500">Total Eligible Exits</p>
            <p className="mt-2 text-2xl font-black text-slate-700">{kpiStats.total}</p>
          </div>
          <div className="rounded-2xl border border-cyan-200 bg-gradient-to-br from-cyan-50 to-blue-100 p-4">
            <p className="text-xs font-black uppercase text-cyan-700">In Notice Period</p>
            <p className="mt-2 text-2xl font-black text-cyan-700">{kpiStats.inNotice}</p>
          </div>
          <div className="rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-green-100 p-4">
            <p className="text-xs font-black uppercase text-emerald-600">Exited / Completed</p>
            <p className="mt-2 text-2xl font-black text-emerald-700">{kpiStats.exited}</p>
          </div>
          <div className="rounded-2xl border border-red-200 bg-gradient-to-br from-red-50 to-rose-100 p-4">
            <p className="text-xs font-black uppercase text-red-600">Provisional (Blocked)</p>
            <p className="mt-2 text-2xl font-black text-red-700">{kpiStats.provisional}</p>
          </div>
        </div>

        {/* ── Two-panel layout ── */}
        <div className="flex items-start gap-6">

          {/* Left — Exit Request List with search + filter */}
          <div className="w-80 flex-shrink-0 overflow-hidden rounded-3xl border bg-white shadow-sm">
            {/* List header */}
            <div className="border-b p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="font-black text-slate-950">Exit Requests</h2>
                <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-bold text-slate-600">
                  {filteredRequests.length}
                </span>
              </div>
              {/* Search */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search name or code…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 py-2 pl-9 pr-3 text-sm outline-none focus:border-blue-400 transition-colors"
                />
              </div>
              {/* Status filter tabs */}
              <div className="flex gap-1 flex-wrap">
                {STATUS_TABS.map((tab) => (
                  <button
                    key={tab.key}
                    onClick={() => setStatusFilter(tab.key)}
                    className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors cursor-pointer ${
                      statusFilter === tab.key
                        ? "bg-rose-600 text-white"
                        : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            {/* List body */}
            {loadingRequests ? (
              <div className="flex items-center justify-center py-12">
                <Loader className="h-7 w-7 animate-spin text-slate-400" />
              </div>
            ) : filteredRequests.length === 0 ? (
              <div className="px-4 py-12 text-center text-slate-400">
                <UserMinus className="mx-auto mb-3 h-9 w-9 opacity-30" />
                <p className="text-sm font-semibold">
                  {searchQuery || statusFilter !== "all" ? "No results match your filter." : "No eligible exit requests found."}
                </p>
              </div>
            ) : (
              <div className="max-h-[580px] divide-y overflow-y-auto">
                {filteredRequests.map((req) => {
                  const status = normalizeExitStatus(req.status);
                  const isSelected = selectedRequest?.id === req.id;
                  const isProvisional = req.is_ff_provisional === 1 || req.is_ff_provisional === true;
                  return (
                    <button
                      key={req.id}
                      onClick={() => selectRequest(req)}
                      className={`w-full p-4 text-left transition-colors cursor-pointer ${rowBorderClass(req)} ${
                        isSelected ? "bg-slate-950 text-white" : "hover:bg-slate-50"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <p className={`truncate text-sm font-bold ${isSelected ? "text-white" : "text-slate-950"}`}>
                              {req.employee_name ?? req.employee_id}
                            </p>
                            {isProvisional && (
                              <span className="rounded-full px-2 py-0.5 text-xs font-bold bg-red-100 text-red-700 border border-red-200 flex-shrink-0">
                                Provisional
                              </span>
                            )}
                          </div>
                          {req.employee_code && (
                            <p className={`mt-0.5 font-mono text-xs ${isSelected ? "text-slate-300" : "text-slate-500"}`}>
                              {req.employee_code}
                            </p>
                          )}
                          <p className={`mt-1 text-xs capitalize ${isSelected ? "text-slate-300" : "text-slate-500"}`}>
                            {req.exit_type} — {human(req.exit_sub_type)}
                          </p>
                          <p className="mt-1 font-mono text-xs text-slate-400">
                            LWD: {req.last_working_day_confirmed ?? req.last_working_day_proposed ?? "TBD"}
                          </p>
                          <div className="mt-2 h-1.5 rounded-full bg-slate-200">
                            <div className="h-1.5 rounded-full bg-emerald-500" style={{ width: `${clearancePct(req)}%` }} />
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-1.5">
                          <Badge
                            label={status}
                            cls={isSelected ? "bg-white/20 text-white" : (EXIT_STATUS_COLORS[status] ?? "bg-slate-100 text-slate-600")}
                          />
                          {isSelected && <ArrowRight className="h-3.5 w-3.5 text-white/60" />}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Right — Detail Panel */}
          <div className="min-w-0 flex-1">
            {!selectedRequest ? (
              <div className="rounded-3xl border bg-white py-20 text-center text-slate-400 shadow-sm">
                <ClipboardList className="mx-auto mb-3 h-12 w-12 opacity-20" />
                <p className="font-semibold">Select an exit request to prepare F&F settlement.</p>
              </div>
            ) : loadingFF ? (
              <div className="flex items-center justify-center rounded-3xl border bg-white py-20 shadow-sm">
                <Loader className="h-8 w-8 animate-spin text-slate-400" />
              </div>
            ) : (
              <div className="space-y-5">

                {/* Employee summary card */}
                <div className="rounded-3xl border bg-white p-5 shadow-sm">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h3 className="text-lg font-black text-slate-950">
                        {selectedRequest.employee_name ?? selectedRequest.employee_id}
                      </h3>
                      {selectedRequest.employee_code && (
                        <p className="mt-0.5 font-mono text-sm text-slate-500">{selectedRequest.employee_code}</p>
                      )}
                      <div className="mt-2 flex flex-wrap items-center gap-3">
                        <Badge
                          label={normalizeExitStatus(selectedRequest.status)}
                          cls={EXIT_STATUS_COLORS[normalizeExitStatus(selectedRequest.status)] ?? "bg-slate-100 text-slate-600"}
                        />
                        <span className="text-xs capitalize text-slate-500">
                          {selectedRequest.exit_type} · {human(selectedRequest.exit_sub_type)}
                        </span>
                        <span className="font-mono text-xs text-slate-500">
                          LWD: {selectedRequest.last_working_day_confirmed ?? selectedRequest.last_working_day_proposed ?? "TBD"}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {ffCalc && (
                        <Badge label={`F&F: ${ffCalc.status}`} cls={FF_STATUS_COLORS[ffCalc.status] ?? "bg-slate-100 text-slate-600"} />
                      )}
                      {/* Drill-down: View full details */}
                      <button
                        onClick={() => setDrawerOpen(true)}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
                      >
                        <ChevronRight className="h-3.5 w-3.5" />View Details
                      </button>
                    </div>
                  </div>
                  {/* Clearance progress */}
                  <div className="mt-4 rounded-2xl border bg-slate-50 p-4">
                    <div className="flex items-center justify-between text-sm font-bold text-slate-700">
                      <span className="flex items-center gap-2">
                        <ShieldCheck className="h-4 w-4" /> Clearance readiness
                      </span>
                      <span>
                        {Number(selectedRequest.clearance_cleared ?? 0)}/{Number(selectedRequest.clearance_total ?? 0)} ({selectedClearancePct}%)
                      </span>
                    </div>
                    <div className="mt-2 h-2 rounded-full bg-white">
                      <div className="h-2 rounded-full bg-emerald-500" style={{ width: `${selectedClearancePct}%` }} />
                    </div>
                  </div>
                </div>

                {/* Prepare form (no existing ffCalc) */}
                {!ffCalc ? (
                  <div className="overflow-hidden rounded-3xl border bg-white shadow-sm">
                    <div className="bg-gradient-to-br from-rose-600 via-pink-600 to-rose-700 px-5 py-4">
                      <h2 className="font-black text-white">Prepare F&F Settlement</h2>
                      <p className="text-rose-100 text-sm mt-0.5">Enter settlement components below.</p>
                    </div>
                    <div className="p-6">
                      <PrepareFFForm
                        form={form}
                        onChange={setForm}
                        onSubmit={createFF}
                        submitting={submitting}
                        preview={preview}
                        previewLoading={loadingPreview}
                        overrideReason={overrideReason}
                        onOverrideReasonChange={setOverrideReason}
                      />
                    </div>
                  </div>
                ) : (
                  <>
                    {/* F&F Breakdown panel */}
                    <div className="overflow-hidden rounded-3xl border bg-white shadow-sm">
                      <div className="bg-gradient-to-br from-rose-600 via-pink-600 to-rose-700 px-5 py-4">
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <h2 className="font-black text-white">F&F Breakdown</h2>
                            <p className="text-rose-100 text-sm mt-0.5">
                              Prepared on {fmtDate(ffCalc.calculation_date)}
                            </p>
                          </div>
                          <span className={`rounded-full px-3 py-1 text-xs font-semibold capitalize ${
                            ffCalc.status === "paid" ? "bg-white/20 text-white" : "bg-white/90 text-rose-700"
                          }`}>
                            {human(ffCalc.status)}
                          </span>
                        </div>
                        {isCurrentProvisional && (
                          <div className="mt-3 flex items-center gap-2 rounded-xl bg-white/15 px-3 py-2">
                            <Lock className="h-3.5 w-3.5 text-white flex-shrink-0" />
                            <span className="text-xs font-bold text-white">
                              Provisional — final disbursement requires authorized override
                            </span>
                          </div>
                        )}
                      </div>
                      <div className="p-6">
                        <FFBreakdown ff={ffCalc} />
                      </div>
                    </div>

                    {/* Net payable dark tile */}
                    <div className="rounded-3xl bg-slate-950 p-6">
                      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                        <div>
                          <p className="text-sm font-semibold text-slate-400">Final Net Payable</p>
                          <p className="mt-1 text-4xl font-black text-white">{INR(ffCalc.net_payable)}</p>
                        </div>
                        <div className="text-right text-sm text-slate-300">
                          {approvalBlockedReasons.length > 0 ? (
                            <div className="rounded-2xl bg-rose-500/20 p-3 text-left font-bold text-rose-100">
                              Blocked: {approvalBlockedReasons.join(", ")}
                            </div>
                          ) : (
                            <div className="rounded-2xl bg-emerald-500/20 p-3 font-bold text-emerald-100">
                              Ready for approval
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    {ffCalc.status === "draft" && (
                      <button
                        onClick={approveFF}
                        disabled={approving || approvalBlockedReasons.length > 0}
                        title={isCurrentProvisional ? "Provisional — requires authorized override" : undefined}
                        className="flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 py-3.5 text-sm font-bold text-white transition-colors hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                      >
                        {approving
                          ? <Loader className="h-4 w-4 animate-spin" />
                          : isCurrentProvisional
                          ? <Lock className="h-4 w-4" />
                          : <CheckCircle2 className="h-4 w-4" />
                        }
                        {isCurrentProvisional ? "Approval Blocked (Provisional)" : "Approve F&F Settlement"}
                      </button>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </div>

      </div>

      {/* ── Drill-down drawer ── */}
      {drawerOpen && selectedRequest && (
        <ExitDetailDrawer
          req={selectedRequest}
          ffCalc={ffCalc}
          onClose={() => setDrawerOpen(false)}
        />
      )}
    </DashboardLayout>
  );
}
