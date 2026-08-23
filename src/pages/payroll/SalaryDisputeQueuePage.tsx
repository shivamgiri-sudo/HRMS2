// src/pages/payroll/SalaryDisputeQueuePage.tsx
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2, XCircle, IndianRupee, Clock, ChevronRight,
  AlertCircle, BarChart2, Calendar, CreditCard, FileText, AlertTriangle
} from "lucide-react";
import { toast } from "sonner";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { useWorkforceAccess } from "@/hooks/useUserRole";
import { hrmsApi } from "@/lib/hrmsApi";

function unwrap<T>(r: unknown): T {
  return ((r as any)?.data?.data ?? (r as any)?.data ?? r) as T;
}

// Colored badge config per dispute type keyword
const DISPUTE_TYPE_BADGE: Record<string, { color: string; icon: React.ReactNode }> = {
  MISSING_OT:                  { color: "bg-amber-100 text-amber-800 border-amber-200", icon: <Clock className="w-3 h-3" /> },
  INCORRECT_ATTENDANCE:        { color: "bg-blue-100 text-blue-800 border-blue-200", icon: <Calendar className="w-3 h-3" /> },
  REGULARIZATION_NOT_APPLIED:  { color: "bg-emerald-100 text-emerald-800 border-emerald-200", icon: <CheckCircle2 className="w-3 h-3" /> },
  LEAVE_NOT_ASSIGNED:          { color: "bg-blue-100 text-blue-800 border-blue-200", icon: <Calendar className="w-3 h-3" /> },
  INCENTIVE_MISSING:           { color: "bg-emerald-100 text-emerald-800 border-emerald-200", icon: <IndianRupee className="w-3 h-3" /> },
  WRONG_DEDUCTION:             { color: "bg-red-100 text-red-800 border-red-200", icon: <CreditCard className="w-3 h-3" /> },
  DOUBLE_DEDUCTION:            { color: "bg-red-100 text-red-800 border-red-200", icon: <CreditCard className="w-3 h-3" /> },
  WRONG_LWP_COUNT:             { color: "bg-orange-100 text-orange-800 border-orange-200", icon: <AlertCircle className="w-3 h-3" /> },
  WRONG_COMPONENT_AMOUNT:      { color: "bg-purple-100 text-purple-800 border-purple-200", icon: <BarChart2 className="w-3 h-3" /> },
  SHIFT_ALLOWANCE_MISSING:     { color: "bg-indigo-100 text-indigo-800 border-indigo-200", icon: <Clock className="w-3 h-3" /> },
  OTHER:                       { color: "bg-slate-100 text-slate-600 border-slate-200", icon: <FileText className="w-3 h-3" /> },
};

const ATTENDANCE_TYPES = new Set([
  "MISSING_OT", "INCORRECT_ATTENDANCE", "REGULARIZATION_NOT_APPLIED",
  "LEAVE_NOT_ASSIGNED", "WRONG_LWP_COUNT",
]);

function ReviewDialog({
  dispute,
  role,
  onClose,
}: {
  dispute: any;
  role: "wfm" | "payroll_head";
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [action, setAction] = useState<"approve" | "reject" | null>(null);
  const [remarks, setRemarks] = useState("");
  const [differential, setDifferential] = useState<string>("");
  const [correctiveSummary, setCorrectiveSummary] = useState("");
  const [disputedDays, setDisputedDays] = useState<string>(
    dispute.affected_dates?.length?.toString() || "1"
  );

  // Fetch salary details for WFM review
  const { data: salaryRaw } = useQuery({
    queryKey: ["dispute-salary", dispute.id],
    queryFn: () => hrmsApi.get(`/api/salary-disputes/${dispute.id}/salary-details`),
    enabled: role === "wfm",
    staleTime: 60_000,
  });
  const salary = (salaryRaw as any)?.data?.data ?? (salaryRaw as any)?.data ?? null;

  // Fetch attachments
  const { data: attachRaw } = useQuery({
    queryKey: ["dispute-attachments", dispute.id],
    queryFn: () => hrmsApi.get(`/api/salary-disputes/${dispute.id}/attachments`),
    staleTime: 60_000,
  });
  const attachments = unwrap<any[]>(attachRaw) ?? [];

  // Fetch audit log (for appeals to show history)
  const { data: auditRaw } = useQuery({
    queryKey: ["dispute-audit", dispute.id],
    queryFn: () => hrmsApi.get(`/api/salary-disputes/${dispute.id}/audit-log`),
    enabled: !!dispute.original_dispute_id,
    staleTime: 60_000,
  });
  const auditLog = unwrap<any[]>(auditRaw) ?? [];

  const suggestedDifferential = salary?.perDayRate && disputedDays
    ? Math.round(salary.perDayRate * parseInt(disputedDays || "0"))
    : 0;

  const endpoint = role === "wfm"
    ? `/api/salary-disputes/${dispute.id}/wfm-review`
    : `/api/salary-disputes/${dispute.id}/payroll-head-review`;

  const mutation = useMutation({
    mutationFn: () =>
      hrmsApi.post(endpoint, {
        action,
        remarks,
        ...(role === "wfm" && action === "approve" ? {
          differentialAmount: parseFloat(differential),
          differentialBasis: correctiveSummary,
          correctiveJson: { summary: correctiveSummary },
        } : {}),
      }),
    onSuccess: () => {
      toast.success(action === "approve" ? "Dispute approved and forwarded." : "Dispute rejected.");
      qc.invalidateQueries({ queryKey: ["salary-dispute-queue"] });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const typeBadge = DISPUTE_TYPE_BADGE[dispute.dispute_type] ?? DISPUTE_TYPE_BADGE["OTHER"];
  const isAttendanceBased = ATTENDANCE_TYPES.has(dispute.dispute_type);

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-lg rounded-2xl shadow-2xl border border-white/60 bg-white/98 backdrop-blur-sm">
        <CardHeader className="bg-gradient-to-r from-blue-600 to-indigo-600 rounded-t-2xl p-4">
          <CardTitle className="text-white text-base">Review Salary Dispute</CardTitle>
        </CardHeader>
        <CardContent className="p-4 space-y-4 max-h-[75vh] overflow-y-auto">

          {/* ── Section: Employee Details ── */}
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2">Employee Details</p>
            <div className="rounded-xl bg-slate-50 border p-3 space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-500">Employee</span>
                <span className="font-medium">{dispute.employee_code} — {dispute.employee_name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Month</span>
                <span className="font-medium">{dispute.run_month}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-500">Type</span>
                <Badge className={`text-[10px] font-bold border flex items-center gap-1 ${typeBadge.color}`}>
                  {typeBadge.icon}
                  {dispute.dispute_type.replace(/_/g, " ")}
                </Badge>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Raised On</span>
                <span className="font-medium">{new Date(dispute.created_at).toLocaleDateString("en-IN")}</span>
              </div>
            </div>
          </div>

          {/* ── Section: Dispute Details ── */}
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2">Dispute Details</p>
            <p className="text-sm text-slate-700 bg-amber-50 rounded-xl p-3 border border-amber-100">{dispute.description}</p>
            {dispute.affected_dates?.length > 0 && (
              <p className="text-xs text-slate-500 mt-2">
                Affected dates: {dispute.affected_dates.map((d: string) => new Date(d).getDate()).join(", ")}
              </p>
            )}
          </div>

          {/* ── Section: Appeal Context ── */}
          {dispute.original_dispute_id && (
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-purple-500 mb-2">Appeal Information</p>
              <div className="rounded-xl bg-purple-50 border border-purple-200 p-3 space-y-2">
                <p className="text-sm text-purple-700 font-medium">This is an appeal of a rejected dispute.</p>
                {dispute.appeal_reason && (
                  <p className="text-sm text-slate-700">{dispute.appeal_reason}</p>
                )}
                {auditLog.length > 0 && (
                  <details className="mt-2">
                    <summary className="text-xs text-purple-600 cursor-pointer hover:underline">
                      View Audit History ({auditLog.length} events)
                    </summary>
                    <div className="mt-2 space-y-1 text-xs">
                      {auditLog.map((a: any) => (
                        <div key={a.id} className="flex gap-2 text-slate-600">
                          <span className="font-mono text-slate-400">
                            {new Date(a.created_at).toLocaleDateString("en-IN")}
                          </span>
                          <span className="font-medium">{a.action}</span>
                          {a.remarks && <span>— {a.remarks}</span>}
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            </div>
          )}

          {/* ── Section: Attachments ── */}
          {attachments.length > 0 && (
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2">
                Attachments ({attachments.length})
              </p>
              <div className="space-y-1">
                {attachments.map((a: any) => (
                  <a
                    key={a.id}
                    href={`/api/files/download/${a.file_path}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 text-sm text-blue-600 hover:underline bg-blue-50 rounded-lg p-2 border border-blue-100"
                  >
                    <FileText className="w-4 h-4" />
                    {a.file_name}
                    <span className="text-xs text-slate-400 ml-auto">
                      {a.file_size ? `${Math.round(a.file_size / 1024)}KB` : ""}
                    </span>
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* ── Section: Salary Details (WFM only) ── */}
          {role === "wfm" && salary && (
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2">Salary Details ({dispute.run_month})</p>
              <div className="rounded-xl bg-blue-50 border border-blue-100 p-3 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">Gross Salary</span>
                  <span className="font-bold">₹{salary.gross.toLocaleString("en-IN")}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">Working Days</span>
                  <span className="font-medium">{salary.workingDays}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">Per Day Rate</span>
                  <span className="font-bold text-blue-700">₹{salary.perDayRate.toLocaleString("en-IN")}</span>
                </div>
              </div>
            </div>
          )}

          {/* WFM: show previous remarks if payroll head reviewing */}
          {role === "payroll_head" && dispute.wfm_remarks && (
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2">WFM Remarks</p>
              <p className="text-sm text-slate-700 bg-slate-50 rounded-xl p-3 border">{dispute.wfm_remarks}</p>
              {dispute.differential_amount && (
                <p className="text-sm font-bold text-emerald-700 mt-1.5">
                  Validated Differential: +₹{Number(dispute.differential_amount).toLocaleString("en-IN")}
                </p>
              )}
            </div>
          )}

          {/* ── Section: Your Action ── */}
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2">Your Action</p>
            <div className="flex gap-2">
              <button
                onClick={() => setAction("approve")}
                className={`flex-1 rounded-xl border py-2.5 text-sm font-semibold transition-colors flex items-center justify-center gap-1.5
                  ${action === "approve" ? "bg-emerald-600 text-white border-emerald-600" : "border-emerald-300 text-emerald-700 hover:bg-emerald-50"}`}
              >
                <CheckCircle2 className="w-4 h-4" /> Approve
              </button>
              <button
                onClick={() => setAction("reject")}
                className={`flex-1 rounded-xl border py-2.5 text-sm font-semibold transition-colors flex items-center justify-center gap-1.5
                  ${action === "reject" ? "bg-red-600 text-white border-red-600" : "border-red-300 text-red-700 hover:bg-red-50"}`}
              >
                <XCircle className="w-4 h-4" /> Reject
              </button>
            </div>

            {/* WFM: differential entry on approve */}
            {role === "wfm" && action === "approve" && (
              <div className="space-y-3 mt-3">
                {isAttendanceBased && salary && (
                  <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-emerald-600 mb-2">Auto-Calculate</p>
                    <div className="flex items-center gap-2">
                      <div className="flex-1">
                        <label className="text-xs text-slate-600">Disputed Days</label>
                        <Input
                          type="number"
                          min="1"
                          max="31"
                          value={disputedDays}
                          onChange={e => setDisputedDays(e.target.value)}
                          className="mt-1"
                        />
                      </div>
                      <div className="text-center text-slate-400">×</div>
                      <div className="flex-1">
                        <label className="text-xs text-slate-600">Per Day Rate</label>
                        <p className="mt-1 py-2 px-3 bg-white rounded-md border text-sm font-bold">
                          ₹{salary.perDayRate.toLocaleString("en-IN")}
                        </p>
                      </div>
                      <div className="text-center text-slate-400">=</div>
                      <div className="flex-1">
                        <label className="text-xs text-slate-600">Suggested</label>
                        <Button
                          size="sm"
                          variant="outline"
                          className="mt-1 w-full border-emerald-300 text-emerald-700 hover:bg-emerald-100"
                          onClick={() => setDifferential(suggestedDifferential.toString())}
                        >
                          ₹{suggestedDifferential.toLocaleString("en-IN")}
                        </Button>
                      </div>
                    </div>
                  </div>
                )}
                <div>
                  <label className="text-xs font-semibold text-slate-600">Differential Amount (₹) *</label>
                  <Input
                    type="number"
                    min="1"
                    value={differential}
                    onChange={e => setDifferential(e.target.value)}
                    placeholder="Enter corrected amount difference"
                    className="mt-1"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-600">Corrective Summary *</label>
                  <Textarea
                    value={correctiveSummary}
                    onChange={e => setCorrectiveSummary(e.target.value)}
                    placeholder="What was wrong and what the correct value is..."
                    rows={2}
                    className="mt-1 resize-none"
                  />
                </div>
              </div>
            )}

            {/* Remarks */}
            {action && (
              <div className="mt-3">
                <label className="text-xs font-semibold text-slate-600">Remarks * (min 10 chars)</label>
                <Textarea
                  value={remarks}
                  onChange={e => setRemarks(e.target.value)}
                  placeholder={action === "approve" ? "Confirm what was validated..." : "Reason for rejection..."}
                  rows={3}
                  className="mt-1 resize-none"
                />
              </div>
            )}
          </div>

          <div className="flex gap-2 pt-1">
            <Button variant="outline" className="flex-1" onClick={onClose}>Cancel</Button>
            <Button
              className="flex-1"
              disabled={
                !action || remarks.trim().length < 10 || mutation.isPending ||
                (role === "wfm" && action === "approve" && (!differential || parseFloat(differential) <= 0))
              }
              onClick={() => mutation.mutate()}
            >
              {mutation.isPending ? "Submitting…" : "Submit"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function SalaryDisputeQueuePage() {
  const { roleKeys } = useWorkforceAccess();
  const isPayrollHead = roleKeys.includes("payroll_head") || roleKeys.includes("super_admin");
  const [reviewing, setReviewing] = useState<any | null>(null);

  const endpoint = isPayrollHead
    ? "/api/salary-disputes/queue/payroll-head"
    : "/api/salary-disputes/queue/wfm";

  const { data: raw, isLoading } = useQuery({
    queryKey: ["salary-dispute-queue", isPayrollHead ? "ph" : "wfm"],
    queryFn: () => hrmsApi.get(endpoint),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  const disputes = unwrap<any[]>(raw) ?? [];

  // Stats
  const now = new Date();
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const lastMonth = (() => {
    const d = new Date(now); d.setMonth(d.getMonth() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  })();
  const thisMonthCount = disputes.filter(d => d.run_month === thisMonth).length;
  const lastMonthCount = disputes.filter(d => d.run_month === lastMonth).length;

  return (
    <DashboardLayout>
      <div className="p-4 md:p-6 space-y-5">
        <div className="rounded-2xl bg-gradient-to-r from-blue-600 to-indigo-600 p-5 text-white">
          <h1 className="text-xl font-bold">Salary Dispute Queue</h1>
          <p className="text-blue-100 text-sm mt-0.5">
            {isPayrollHead ? "Final approval queue — Payroll Head" : "Validate and enter corrective data — WFM / Payroll HR"}
          </p>
        </div>

        {/* Stats bar */}
        {!isLoading && (
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-2xl border border-white/60 bg-white/95 backdrop-blur-sm shadow-sm p-3 flex flex-col items-center">
              <p className="text-2xl font-bold text-slate-800">{disputes.length}</p>
              <p className="text-[11px] text-slate-500 mt-0.5 font-medium">Total Pending</p>
            </div>
            <div className="rounded-2xl border border-white/60 bg-white/95 backdrop-blur-sm shadow-sm p-3 flex flex-col items-center">
              <p className="text-2xl font-bold text-blue-700">{thisMonthCount}</p>
              <p className="text-[11px] text-slate-500 mt-0.5 font-medium">This Month</p>
            </div>
            <div className="rounded-2xl border border-white/60 bg-white/95 backdrop-blur-sm shadow-sm p-3 flex flex-col items-center">
              <p className="text-2xl font-bold text-slate-500">{lastMonthCount}</p>
              <p className="text-[11px] text-slate-500 mt-0.5 font-medium">Last Month</p>
            </div>
          </div>
        )}

        {isLoading ? (
          <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="h-24 rounded-2xl bg-slate-100 animate-pulse" />)}</div>
        ) : disputes.length === 0 ? (
          <div className="flex flex-col items-center py-14 text-slate-400">
            <CheckCircle2 className="w-10 h-10 mb-3 opacity-40" />
            <p className="text-sm">No disputes pending your review.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {disputes.map((d: any) => {
              const typeBadge = DISPUTE_TYPE_BADGE[d.dispute_type] ?? DISPUTE_TYPE_BADGE["OTHER"];
              return (
                <Card key={d.id} className="rounded-2xl border border-white/60 bg-white/95 backdrop-blur-sm shadow-sm hover:shadow-md transition-shadow cursor-pointer" onClick={() => setReviewing(d)}>
                  <CardContent className="p-4 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold text-slate-800">{d.employee_code} — {d.employee_name}</p>
                        <Badge className={`text-[10px] font-bold border flex items-center gap-1 ${typeBadge.color}`}>
                          {typeBadge.icon}
                          {d.dispute_type.replace(/_/g, " ")}
                        </Badge>
                        {d.sla_breached === 1 && (
                          <Badge className="text-[10px] font-bold border flex items-center gap-1 bg-red-100 text-red-700 border-red-200">
                            <AlertTriangle className="w-3 h-3" /> SLA Breached
                          </Badge>
                        )}
                        {d.original_dispute_id && (
                          <Badge className="text-[10px] font-bold border flex items-center gap-1 bg-purple-100 text-purple-700 border-purple-200">
                            Appeal
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-slate-500 mt-0.5">Month: {d.run_month}</p>
                      <p className="text-xs text-slate-500 mt-0.5 line-clamp-1">{d.description}</p>
                      {isPayrollHead && d.differential_amount && (
                        <p className="text-xs font-bold text-emerald-700 mt-1">Differential: +₹{Number(d.differential_amount).toLocaleString("en-IN")}</p>
                      )}
                    </div>
                    <div className="flex-shrink-0 flex items-center gap-2">
                      <span className="text-xs text-slate-400">{new Date(d.created_at).toLocaleDateString("en-IN")}</span>
                      <ChevronRight className="w-4 h-4 text-slate-400" />
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
        {reviewing && (
          <ReviewDialog
            dispute={reviewing}
            role={isPayrollHead ? "payroll_head" : "wfm"}
            onClose={() => setReviewing(null)}
          />
        )}
      </div>
    </DashboardLayout>
  );
}
