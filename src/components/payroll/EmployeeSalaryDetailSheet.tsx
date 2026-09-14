import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { SalaryFlagDialog } from "@/components/payroll/SalaryFlagDialog";
import { hrmsApi } from "@/lib/hrmsApi";
import {
  AlertTriangle,
  CheckCircle2,
  Flag,
  X,
} from "lucide-react";

// Backend snake_case response shape from GET /employee/:id
interface SalaryComponent {
  code: string;
  name: string;
  amount: number;
  source?: string;
  type?: string;
}

interface FlagItem {
  id: string;
  category: string;
  description: string;
  expected_value?: number | null;
  raised_at: string;
  status: string;
}

interface SalaryDetailResponse {
  success: boolean;
  employee: {
    id: string;
    code: string;
    name: string;
    designation?: string;
    branch_name?: string;
    process_name?: string;
  };
  attendance: {
    working_days?: number;
    present_days?: number;
    leave_days?: number;
    lwp_days?: number;
    late_marks?: number;
    ot_hours?: number;
  };
  earnings: SalaryComponent[];
  deductions: SalaryComponent[];
  /** Employer PF, employer ESI, admin charges — paid by the company, not
   *  deducted. The backend previously fetched these (component_type=
   *  'employer_cost') and dropped them before responding; both sides fixed
   *  together. */
  employer_costs?: SalaryComponent[];
  gross_salary: number;
  total_deductions: number;
  net_salary: number;
  is_estimate: boolean;
  flags: FlagItem[];
  verification_status: "pending" | "verified" | "flagged";
}

interface Props {
  employeeId: string | null;
  month: string;
  runId?: string;
  open: boolean;
  onClose: () => void;
  roleKeys: string[];
  processId?: string;
  branchId?: string;
}

const SOURCE_COLORS: Record<string, string> = {
  structure: "bg-blue-100 text-blue-700",
  incentive_upload: "bg-violet-100 text-violet-700",
  manual: "bg-amber-100 text-amber-700",
  holiday_ot: "bg-emerald-100 text-emerald-700",
};

function sourceLabel(src: string): string {
  const map: Record<string, string> = {
    structure: "Structure",
    incentive_upload: "Uploaded",
    manual: "Manual",
    holiday_ot: "Holiday OT",
    incentive: "Incentive",
  };
  return map[src] ?? src;
}

function fmt(n: number) {
  return new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

export function EmployeeSalaryDetailSheet({
  employeeId,
  month,
  runId,
  open,
  onClose,
  roleKeys,
  processId,
  branchId,
}: Props) {
  const qc = useQueryClient();
  const [flagDialogOpen, setFlagDialogOpen] = useState(false);

  const canVerify = roleKeys.some((r) =>
    ["wfm", "process_manager", "branch_head", "super_admin", "admin"].includes(r)
  );

  const { data, isLoading } = useQuery<SalaryDetailResponse>({
    queryKey: ["salary-verify-employee", employeeId, month, runId],
    queryFn: () =>
      hrmsApi.get<SalaryDetailResponse>(
        `/api/payroll/salary-verification/employee/${employeeId}?month=${month}${runId ? `&runId=${runId}` : ""}`
      ),
    enabled: open && !!employeeId,
  });

  const verifyMutation = useMutation({
    mutationFn: () =>
      hrmsApi.post("/api/payroll/salary-verification/verify-employee", {
        runMonth: month,
        runId,
        employeeId,
        processId,
        branchId,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["salary-verify-employee", employeeId, month] });
      qc.invalidateQueries({ queryKey: ["salary-verify-register", month] });
      qc.invalidateQueries({ queryKey: ["salary-verify-summary", month] });
    },
  });

  const openFlags = data?.flags.filter((f) => f.status === "open") ?? [];
  const isVerified = data?.verification_status === "verified";

  return (
    <>
      <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
        <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto p-0">
          {/* Header */}
          <div className="bg-gradient-to-br from-blue-700 to-indigo-800 text-white px-6 pt-6 pb-4">
            <SheetHeader>
              <div className="flex items-start justify-between">
                <div>
                  <SheetTitle className="text-white text-xl font-bold">
                    {isLoading ? (
                      <Skeleton className="h-6 w-48 bg-white/20" />
                    ) : (
                      data?.employee.name ?? "Employee Detail"
                    )}
                  </SheetTitle>
                  {data && (
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-sm text-blue-200">
                      <span>{data.employee.code}</span>
                      {data.employee.designation && <span>{data.employee.designation}</span>}
                      {data.employee.branch_name && <span>{data.employee.branch_name}</span>}
                      {data.employee.process_name && <span>{data.employee.process_name}</span>}
                    </div>
                  )}
                </div>
                <button
                  onClick={onClose}
                  className="text-white/70 hover:text-white transition-colors"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <Badge className="bg-white/20 text-white border-white/30 text-xs">
                  {month}
                </Badge>
                {data?.is_estimate && (
                  <Badge className="bg-amber-400/30 text-amber-100 border-amber-300/40 text-xs">
                    Pre-Run Estimate
                  </Badge>
                )}
                {isVerified && (
                  <Badge className="bg-emerald-400/30 text-emerald-100 border-emerald-300/40 text-xs flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3" /> Verified
                  </Badge>
                )}
              </div>
            </SheetHeader>
          </div>

          <div className="px-6 py-4 space-y-5">
            {isLoading && (
              <div className="space-y-3">
                {[...Array(6)].map((_, i) => (
                  <Skeleton key={i} className="h-8 w-full" />
                ))}
              </div>
            )}

            {data && (
              <>
                {/* Attendance Grid */}
                <section>
                  <h3 className="text-sm font-semibold text-slate-700 mb-2">Attendance</h3>
                  <div className="grid grid-cols-6 gap-2 text-center">
                    {[
                      { label: "Working", val: data.attendance.working_days ?? 0 },
                      { label: "Present",  val: data.attendance.present_days  ?? 0 },
                      { label: "Leave",    val: data.attendance.leave_days    ?? 0 },
                      { label: "LWP",      val: data.attendance.lwp_days      ?? 0 },
                      { label: "Late",     val: data.attendance.late_marks    ?? 0 },
                      { label: "OT Hrs",   val: data.attendance.ot_hours      ?? 0 },
                    ].map(({ label, val }) => (
                      <div key={label} className="rounded-lg border bg-slate-50 py-2">
                        <div className="text-lg font-bold text-slate-800">{val}</div>
                        <div className="text-[10px] text-slate-500 uppercase tracking-wide mt-0.5">
                          {label}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>

                {/* Earnings */}
                {data.earnings.length > 0 && (
                  <section>
                    <h3 className="text-sm font-semibold text-slate-700 mb-2">Earnings</h3>
                    <div className="rounded-lg border overflow-hidden">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-slate-50 border-b">
                            <th className="text-left px-3 py-1.5 font-medium text-slate-600">Component</th>
                            <th className="text-left px-2 py-1.5 font-medium text-slate-600">Source</th>
                            <th className="text-right px-3 py-1.5 font-medium text-slate-600">Amount</th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.earnings.map((row) => (
                            <tr key={row.code} className="border-b last:border-0 hover:bg-slate-50/60">
                              <td className="px-3 py-1.5 text-slate-700">{row.name}</td>
                              <td className="px-2 py-1.5">
                                {row.source && (
                                  <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${SOURCE_COLORS[row.source] ?? "bg-slate-100 text-slate-600"}`}>
                                    {sourceLabel(row.source)}
                                  </span>
                                )}
                              </td>
                              <td className="px-3 py-1.5 text-right font-mono text-slate-800">
                                ₹{fmt(row.amount)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr className="bg-slate-50 border-t">
                            <td colSpan={2} className="px-3 py-1.5 font-semibold text-slate-700">
                              Gross Earnings
                            </td>
                            <td className="px-3 py-1.5 text-right font-bold font-mono text-slate-900">
                              ₹{fmt(data.gross_salary)}
                            </td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </section>
                )}

                {/* Deductions */}
                {data.deductions.length > 0 && (
                  <section>
                    <h3 className="text-sm font-semibold text-slate-700 mb-2">Deductions</h3>
                    <div className="rounded-lg border overflow-hidden">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-slate-50 border-b">
                            <th className="text-left px-3 py-1.5 font-medium text-slate-600">Component</th>
                            <th className="text-right px-3 py-1.5 font-medium text-slate-600">Amount</th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.deductions.map((row) => (
                            <tr key={row.code} className="border-b last:border-0 hover:bg-slate-50/60">
                              <td className="px-3 py-1.5 text-slate-700">{row.name}</td>
                              <td className="px-3 py-1.5 text-right font-mono text-red-700">
                                ₹{fmt(row.amount)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr className="bg-slate-50 border-t">
                            <td className="px-3 py-1.5 font-semibold text-slate-700">
                              Total Deductions
                            </td>
                            <td className="px-3 py-1.5 text-right font-bold font-mono text-red-800">
                              ₹{fmt(data.total_deductions)}
                            </td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </section>
                )}

                {/* Employer Contributions — paid by the company, not deducted from the
                    employee. Shown separately from Deductions so this drill-down never
                    reads as if the employee's own pay carried them. */}
                {(data.employer_costs ?? []).length > 0 && (
                  <section>
                    <h3 className="text-sm font-semibold text-violet-700 mb-2">
                      Employer Contributions
                      <span className="ml-2 text-xs font-normal text-slate-400">not deducted from pay</span>
                    </h3>
                    <div className="rounded-lg border border-violet-200 overflow-hidden">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-violet-50 border-b border-violet-200">
                            <th className="text-left px-3 py-1.5 font-medium text-slate-600">Component</th>
                            <th className="text-right px-3 py-1.5 font-medium text-slate-600">Amount</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(data.employer_costs ?? []).map((row) => (
                            <tr key={row.code} className="border-b border-violet-100 last:border-0 hover:bg-violet-50/60">
                              <td className="px-3 py-1.5 text-slate-700">{row.name}</td>
                              <td className="px-3 py-1.5 text-right font-mono text-violet-700">
                                ₹{fmt(row.amount)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                )}

                {/* Net Pay */}
                {(() => {
                  const incentiveAmt = (data.earnings ?? [])
                    .filter(e => e.code === "INCENTIVE")
                    .reduce((s, e) => s + Number(e.amount ?? 0), 0);
                  const hasIncentive = incentiveAmt > 0;
                  return (
                    <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-5 py-4 flex items-center justify-between">
                      <div>
                        <div className="text-sm font-medium text-emerald-700">Net Pay</div>
                        <div className="text-xs text-emerald-600 mt-0.5">
                          {hasIncentive
                            ? `Gross ₹${fmt(data.gross_salary)} + Incentive ₹${fmt(incentiveAmt)} − Deductions ₹${fmt(data.total_deductions)}`
                            : `Gross ₹${fmt(data.gross_salary)} − Deductions ₹${fmt(data.total_deductions)}`}
                        </div>
                      </div>
                      <div className="text-2xl font-bold font-mono text-emerald-800">
                        ₹{fmt(data.net_salary)}
                      </div>
                    </div>
                  );
                })()}

                {/* Open Flags */}
                {openFlags.length > 0 && (
                  <section>
                    <h3 className="text-sm font-semibold text-red-600 mb-2 flex items-center gap-1">
                      <AlertTriangle className="h-4 w-4" />
                      Open Flags ({openFlags.length})
                    </h3>
                    <div className="space-y-2">
                      {openFlags.map((flag) => (
                        <div
                          key={flag.id}
                          className="rounded-lg border border-red-200 bg-red-50/60 px-4 py-3"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <Badge className="bg-red-100 text-red-700 text-xs capitalize mb-1">
                                {flag.category}
                              </Badge>
                              <p className="text-sm text-slate-700">{flag.description}</p>
                              {flag.expected_value != null && (
                                <p className="text-xs text-slate-500 mt-0.5">
                                  Expected: ₹{fmt(Number(flag.expected_value))}
                                </p>
                              )}
                            </div>
                            <Badge className="shrink-0 text-xs capitalize bg-amber-100 text-amber-700">
                              {flag.status}
                            </Badge>
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                {/* Actions */}
                {canVerify && (
                  <div className="flex gap-3 pt-1 pb-2">
                    <Button
                      variant="outline"
                      className="flex-1 border-amber-300 text-amber-700 hover:bg-amber-50"
                      onClick={() => setFlagDialogOpen(true)}
                    >
                      <Flag className="h-4 w-4 mr-1.5" />
                      Flag Discrepancy
                    </Button>
                    {!isVerified ? (
                      <Button
                        className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white"
                        disabled={openFlags.length > 0 || verifyMutation.isPending}
                        onClick={() => verifyMutation.mutate()}
                        title={openFlags.length > 0 ? "Resolve open flags first" : ""}
                      >
                        <CheckCircle2 className="h-4 w-4 mr-1.5" />
                        {verifyMutation.isPending ? "Saving…" : "Mark OK / Verified"}
                      </Button>
                    ) : (
                      <div className="flex-1 flex items-center justify-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 text-emerald-700 text-sm font-medium">
                        <CheckCircle2 className="h-4 w-4" />
                        Verified
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {data && (
        <SalaryFlagDialog
          open={flagDialogOpen}
          onClose={() => setFlagDialogOpen(false)}
          employeeId={data.employee.id}
          employeeCode={data.employee.code}
          month={month}
          runId={runId}
          processId={processId}
          branchId={branchId}
          onSuccess={() => {
            qc.invalidateQueries({ queryKey: ["salary-verify-employee", employeeId, month] });
          }}
        />
      )}
    </>
  );
}
