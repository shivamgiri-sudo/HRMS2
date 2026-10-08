import { useState, useEffect, useCallback } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Loader2,
  Search,
  IndianRupee,
  CheckCircle2,
  AlertTriangle,
  History,
  Calculator,
  TrendingUp,
  ArrowRight,
} from "lucide-react";
import { PackageBuilderDialog } from "@/components/payroll/PackageBuilderDialog";
import { inr, fmtDate } from "./PayrollHeadSalaryReviewQueue";
import { pfYesNo, esicYesNo } from "@/lib/salaryEligibility";
import { useDateLockMin } from "@/hooks/useDateLockMin";
import {
  earningRows,
  otherDeductionRows,
  employerCostRows,
} from "@/lib/salaryComponentRows";

/**
 * Salary Change Center — Payroll Head searches any active employee, sees their full current
 * salary, and changes it via PackageBuilderDialog. Submitting writes a new active
 * salary_component_assignments row and supersedes the old one, plus a full audit trail.
 */

import { EmployeePicker, employeeDisplayName as displayName, type EmployeeSearchResult } from "@/components/payroll/EmployeePicker";
import { IncrementRequestsPanel } from "@/components/payroll/IncrementRequestsPanel";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useWorkforceAccess } from "@/hooks/useUserRole";

interface SuccessData {
  employeeName: string;
  employeeCode: string;
  oldCtc: number;
  newCtc: number;
  effectiveDate: string;
  requestedBy: string;
}

// ── Success popup ────────────────────────────────────────────────────────────

function SalaryChangedDialog({
  data,
  onClose,
}: {
  data: SuccessData | null;
  onClose: () => void;
}) {
  if (!data) return null;
  const delta = data.newCtc - data.oldCtc;
  const pct =
    data.oldCtc > 0 ? Math.round((delta / data.oldCtc) * 1000) / 10 : 0;
  return (
    <Dialog
      open={!!data}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-emerald-700">
            <CheckCircle2 className="h-5 w-5" /> Salary Updated Successfully
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-1">
          {/* Employee */}
          <div className="rounded-xl bg-slate-50 px-4 py-3">
            <p className="text-xs text-slate-500 uppercase font-semibold tracking-wide mb-0.5">
              Employee
            </p>
            <p className="text-sm font-semibold text-slate-800">
              {data.employeeName}
            </p>
            <p className="text-xs text-slate-400">{data.employeeCode}</p>
          </div>

          {/* Old → New */}
          <div className="rounded-xl border border-emerald-100 bg-emerald-50/60 px-4 py-4">
            <div className="flex items-center justify-between gap-4">
              <div className="text-center">
                <p className="text-[10px] text-slate-500 uppercase font-semibold tracking-wide mb-1">
                  Previous CTC
                </p>
                <p className="text-xl font-bold text-slate-600">
                  {inr(data.oldCtc)}
                </p>
                <p className="text-[10px] text-slate-400">per month</p>
              </div>
              <div className="flex flex-col items-center gap-1">
                <ArrowRight className="h-6 w-6 text-emerald-500" />
                <span className="text-xs font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">
                  {delta >= 0 ? "+" : ""}
                  {inr(delta)} ({pct > 0 ? "+" : ""}
                  {pct}%)
                </span>
              </div>
              <div className="text-center">
                <p className="text-[10px] text-slate-500 uppercase font-semibold tracking-wide mb-1">
                  New CTC
                </p>
                <p className="text-xl font-bold text-emerald-700">
                  {inr(data.newCtc)}
                </p>
                <p className="text-[10px] text-slate-400">per month</p>
              </div>
            </div>
          </div>

          {/* Meta */}
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-lg bg-slate-50 px-3 py-2">
              <p className="text-slate-400 uppercase font-semibold tracking-wide text-[10px] mb-0.5">
                Effective From
              </p>
              <p className="font-semibold text-slate-700">
                {fmtDate(data.effectiveDate)}
              </p>
            </div>
            <div className="rounded-lg bg-slate-50 px-3 py-2">
              <p className="text-slate-400 uppercase font-semibold tracking-wide text-[10px] mb-0.5">
                Requested By
              </p>
              <p className="font-semibold text-slate-700 truncate">
                {data.requestedBy}
              </p>
            </div>
          </div>

          <Button
            className="w-full bg-emerald-600 hover:bg-emerald-700 rounded-xl cursor-pointer"
            onClick={onClose}
          >
            Done
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

function SalaryChangePanel() {
  const [targetEmployee, setTargetEmployee] =
    useState<EmployeeSearchResult | null>(null);
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [pkgBuilderOpen, setPkgBuilderOpen] = useState(false);
  const dateMin = useDateLockMin();
  const [effectiveDate, setEffectiveDate] = useState("");
  const [reason, setReason] = useState("");
  const [requestor, setRequestor] = useState<EmployeeSearchResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [successData, setSuccessData] = useState<SuccessData | null>(null);

  const loadProfile = useCallback(async (employeeId: string) => {
    setLoading(true);
    setError(null);
    setProfile(null);
    try {
      const r = await hrmsApi.get<{ data: any }>(
        `/api/salary-change/employee/${employeeId}`,
      );
      setProfile((r as any)?.data ?? null);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load employee.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (targetEmployee) void loadProfile(targetEmployee.id);
    else setProfile(null);
  }, [targetEmployee, loadProfile]);

  const sc = profile?.salary_components;
  const employee = profile?.employee;

  const submitChange = async (packageId: string) => {
    if (!targetEmployee) return;
    if (!effectiveDate) {
      setError("Set an effective date first.");
      return;
    }
    if (!reason.trim()) {
      setError("A reason is required.");
      return;
    }
    if (!requestor) {
      setError("Select who requested this change.");
      return;
    }

    const oldCtc = Number(sc?.ctc ?? 0);
    setSubmitting(true);
    setError(null);
    try {
      const result: any = await hrmsApi.post(
        `/api/salary-change/${targetEmployee.id}`,
        {
          package_id: packageId,
          effective_date: effectiveDate,
          reason: reason.trim(),
          requested_by_user_id: requestor.id,
          requested_by_name: displayName(requestor),
        },
        90000, // 90s — server writes inside a transaction then returns; allow for a loaded DB
      );
      // Backend now returns { new_ctc, old_ctc, ... } directly — no nested salary_components.
      const newCtc = Number(
        result?.data?.new_ctc ?? result?.data?.salary_components?.ctc ?? 0,
      );
      setSuccessData({
        employeeName: displayName(targetEmployee),
        employeeCode: targetEmployee.employee_code,
        oldCtc,
        newCtc,
        effectiveDate,
        requestedBy: displayName(requestor),
      });
      setReason("");
      setRequestor(null);
      setEffectiveDate("");
      await loadProfile(targetEmployee.id);
    } catch (e: any) {
      setError(e?.message ?? "Failed to change salary.");
    } finally {
      setSubmitting(false);
    }
  };

  const canSubmit =
    !submitting && !!effectiveDate && !!reason.trim() && !!requestor;

  return (
    <>
      <div className="space-y-4">
        {/* Employee Search */}
        <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
          <Label className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2 block">
            Step 1 — Select Employee
          </Label>
          <EmployeePicker
            placeholder="Search by name or employee code…"
            value={targetEmployee}
            onSelect={setTargetEmployee}
          />
        </div>

        {/* Error */}
        {error && (
          <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
            {error}
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-indigo-400" />
          </div>
        )}

        {profile && employee && (
          <>
            {/* Employee Profile */}
            <div className="rounded-2xl border border-slate-100 bg-white overflow-hidden shadow-sm">
              <div className="bg-slate-50 px-4 py-2.5 border-b border-slate-100">
                <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
                  Employee Profile
                </p>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-slate-100">
                {(
                  [
                    ["Name", employee.full_name],
                    ["Code", employee.employee_code],
                    ["Branch", employee.branch_name ?? "—"],
                    ["Process", employee.process_name ?? "—"],
                    ["Designation", employee.designation_name ?? "—"],
                    ["Cost Centre", employee.cost_centre_name ?? "—"],
                    [
                      "Emp Type",
                      employee.employment_type ?? employee.emp_type ?? "—",
                    ],
                    ["DOJ", fmtDate(employee.date_of_joining)],
                  ] as [string, string][]
                ).map(([label, value]) => (
                  <div key={label} className="bg-white px-3 py-2.5">
                    <p className="text-[10px] text-slate-400 uppercase font-semibold tracking-wide">
                      {label}
                    </p>
                    <p className="text-sm font-medium text-slate-800 mt-0.5 truncate">
                      {value}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            {/* Current Salary */}
            <div className="rounded-2xl border border-slate-100 bg-white overflow-hidden shadow-sm">
              <div className="bg-gradient-to-r from-purple-600 to-violet-600 px-4 py-2.5 flex items-center gap-2">
                <IndianRupee className="h-3.5 w-3.5 text-white" />
                <p className="text-xs font-semibold text-white">
                  Current Active Salary
                </p>
                {sc?.effective_date && (
                  <span className="ml-auto text-[10px] text-purple-200">
                    Effective {fmtDate(sc.effective_date)}
                  </span>
                )}
              </div>
              <div className="p-4">
                {sc ? (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                    {(
                      [
                        ...earningRows(sc).map((r) => [r.label, inr(r.value)]),
                        ["Gross", inr(sc.gross)],
                        ...otherDeductionRows(sc).map((r) => [
                          r.label,
                          `− ${inr(r.value)}`,
                        ]),
                        ...employerCostRows(sc).map((r) => [
                          r.label,
                          inr(r.value),
                        ]),
                        ["CTC / Month", inr(sc.ctc)],
                        ["Net in Hand", inr(sc.net_in_hand)],
                        ["PF", pfYesNo(sc)],
                        ["ESIC", esicYesNo(sc)],
                      ] as [string, string][]
                    ).map(([l, v]) => (
                      <div
                        key={l}
                        className="rounded-lg bg-slate-50 px-3 py-2.5"
                      >
                        <p className="text-[10px] text-slate-400 uppercase font-semibold tracking-wide">
                          {l}
                        </p>
                        <p className="font-semibold text-slate-800 mt-0.5">
                          {v}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-slate-400 flex items-center gap-1.5">
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                    No active salary package on file.
                  </p>
                )}
              </div>
            </div>

            {/* Change Salary Form */}
            <div className="rounded-2xl border border-indigo-100 bg-white shadow-sm overflow-hidden">
              <div className="bg-gradient-to-r from-indigo-600 to-violet-600 px-4 py-2.5 flex items-center gap-2">
                <TrendingUp className="h-3.5 w-3.5 text-white" />
                <p className="text-xs font-semibold text-white">
                  Step 2 — Change Salary
                </p>
              </div>
              <div className="p-4 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <Label className="text-xs font-semibold text-slate-600 mb-1.5 block">
                      Effective Date <span className="text-red-500">*</span>
                    </Label>
                    <Input
                      type="date"
                      value={effectiveDate}
                      min={dateMin}
                      onChange={(e) => setEffectiveDate(e.target.value)}
                      className="h-10 text-sm rounded-xl"
                    />
                  </div>
                  <div>
                    <Label className="text-xs font-semibold text-slate-600 mb-1.5 block">
                      Requested By <span className="text-red-500">*</span>
                    </Label>
                    <EmployeePicker
                      placeholder="Who asked for this change…"
                      value={requestor}
                      onSelect={setRequestor}
                    />
                  </div>
                </div>

                <div>
                  <Label className="text-xs font-semibold text-slate-600 mb-1.5 block">
                    Reason for Change <span className="text-red-500">*</span>
                  </Label>
                  <Textarea
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    rows={2}
                    placeholder="e.g. Annual increment, role change, salary revision…"
                    className="text-sm rounded-xl resize-none"
                  />
                </div>

                <div className="flex items-center gap-3 pt-1">
                  <Button
                    disabled={!canSubmit}
                    onClick={() => setPkgBuilderOpen(true)}
                    className="cursor-pointer bg-indigo-600 hover:bg-indigo-700 rounded-xl gap-2 h-10"
                  >
                    {submitting ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Applying…
                      </>
                    ) : (
                      <>
                        <Calculator className="h-4 w-4" />
                        Select / Build Package
                      </>
                    )}
                  </Button>
                  {!canSubmit && !submitting && (
                    <p className="text-xs text-slate-400">
                      Fill effective date, requested by, and reason to continue
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* Change History */}
            {profile.change_history?.length > 0 && (
              <div className="rounded-2xl border border-slate-100 bg-white overflow-hidden shadow-sm">
                <div className="bg-slate-700 px-4 py-2.5 flex items-center gap-2">
                  <History className="h-3.5 w-3.5 text-white" />
                  <p className="text-xs font-semibold text-white">
                    Change History
                  </p>
                  <span className="ml-auto text-[10px] text-slate-400 bg-slate-600 px-2 py-0.5 rounded-full">
                    {profile.change_history.length} record
                    {profile.change_history.length !== 1 ? "s" : ""}
                  </span>
                </div>
                <div className="divide-y divide-slate-50">
                  {profile.change_history.map((h: any) => (
                    <div key={h.id} className="px-4 py-3">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-slate-700">
                            {inr(h.old_ctc)}
                          </span>
                          <ArrowRight className="h-3.5 w-3.5 text-slate-400" />
                          <span className="text-sm font-semibold text-emerald-700">
                            {inr(h.new_ctc)}
                          </span>
                          {h.old_ctc > 0 && (
                            <span className="text-[10px] font-semibold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded-full">
                              {h.new_ctc >= h.old_ctc ? "+" : ""}
                              {Math.round(
                                ((h.new_ctc - h.old_ctc) / h.old_ctc) * 1000,
                              ) / 10}
                              %
                            </span>
                          )}
                        </div>
                        <span className="text-xs text-slate-400">
                          {fmtDate(h.created_at)}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 mt-1">{h.reason}</p>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        Requested by {h.requested_by_name ?? "—"} · effective{" "}
                        {fmtDate(h.effective_date)}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <PackageBuilderDialog
        open={pkgBuilderOpen}
        onOpenChange={setPkgBuilderOpen}
        defaultBranch={employee?.branch_name ?? ""}
        currentComponents={sc}
        enablePickExisting
        submitLabel="Save & Apply Salary Change"
        onPackageCreated={(pkgId) => void submitChange(pkgId)}
      />

      <SalaryChangedDialog
        data={successData}
        onClose={() => setSuccessData(null)}
      />
    </>
  );
}

type HubTab = "change" | "increment";

/**
 * Salary Change Center: one place for every change to an employee's salary.
 *  - "Change salary": the Payroll Head picks the package and it applies at once (the Payroll Head is the final approver).
 *  - "Increment requests": raised by HR or the Payroll Head, approved by the Payroll Head, who applies it in the same click.
 * Both use the same typed employee search. The tabs a user sees follow the role; the server enforces it too.
 */
export function SalaryChangeHub({ initialTab = "change" }: { initialTab?: HubTab }) {
  const { hasAnyRole } = useWorkforceAccess();
  const canChange = hasAnyRole("payroll_head", "admin", "super_admin", "payroll_hr");
  const [tab, setTab] = useState<HubTab>(initialTab);
  const active: HubTab = canChange ? tab : "increment";
  return (
    <div className="p-4 sm:p-6 space-y-4 max-w-4xl mx-auto">
      <div className="rounded-2xl bg-gradient-to-br from-purple-600 via-violet-600 to-indigo-700 text-white px-6 py-5 shadow-lg">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center flex-shrink-0">
            <IndianRupee className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight">Salary Change &amp; Increment</h1>
            <p className="text-indigo-200 text-sm mt-0.5">
              Search an employee, change or raise their salary — the Payroll Head is the final approval, fully audited
            </p>
          </div>
        </div>
      </div>
      {canChange && (
        <Tabs value={active} onValueChange={(v) => setTab(v as HubTab)}>
          <TabsList>
            <TabsTrigger value="change">Change salary</TabsTrigger>
            <TabsTrigger value="increment">Increment requests</TabsTrigger>
          </TabsList>
        </Tabs>
      )}
      {active === "change" ? <SalaryChangePanel /> : <IncrementRequestsPanel />}
    </div>
  );
}

export default function SalaryChangeCenter() {
  return (
    <DashboardLayout>
      <SalaryChangeHub initialTab="change" />
    </DashboardLayout>
  );
}
