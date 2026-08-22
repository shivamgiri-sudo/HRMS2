// src/pages/payroll/SalaryDisputeQueuePage.tsx
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2, XCircle, IndianRupee, Clock, ChevronRight
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

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-lg rounded-2xl shadow-2xl">
        <CardHeader className="bg-gradient-to-r from-blue-600 to-indigo-600 rounded-t-2xl p-4">
          <CardTitle className="text-white text-base">Review Salary Dispute</CardTitle>
        </CardHeader>
        <CardContent className="p-4 space-y-3 max-h-[75vh] overflow-y-auto">
          {/* Dispute summary */}
          <div className="rounded-xl bg-slate-50 border p-3 space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-500">Employee</span>
              <span className="font-medium">{dispute.employee_code} — {dispute.employee_name}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Month</span>
              <span className="font-medium">{dispute.run_month}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Type</span>
              <span className="font-medium">{dispute.dispute_type.replace(/_/g, " ")}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Raised On</span>
              <span className="font-medium">{new Date(dispute.created_at).toLocaleDateString("en-IN")}</span>
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-600 mb-1">Employee's Description</p>
            <p className="text-sm text-slate-700 bg-amber-50 rounded-xl p-3 border border-amber-100">{dispute.description}</p>
          </div>
          {/* WFM: show previous remarks if payroll head reviewing */}
          {role === "payroll_head" && dispute.wfm_remarks && (
            <div>
              <p className="text-xs font-semibold text-slate-600 mb-1">WFM Remarks</p>
              <p className="text-sm text-slate-700 bg-slate-50 rounded-xl p-3 border">{dispute.wfm_remarks}</p>
              {dispute.differential_amount && (
                <p className="text-sm font-bold text-emerald-700 mt-1.5">
                  Validated Differential: +₹{Number(dispute.differential_amount).toLocaleString("en-IN")}
                </p>
              )}
            </div>
          )}
          {/* Action selector */}
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
            <div className="space-y-2">
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
            <div>
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

  return (
    <DashboardLayout>
      <div className="p-4 md:p-6 space-y-5">
        <div className="rounded-2xl bg-gradient-to-r from-blue-600 to-indigo-600 p-5 text-white">
          <h1 className="text-xl font-bold">Salary Dispute Queue</h1>
          <p className="text-blue-100 text-sm mt-0.5">
            {isPayrollHead ? "Final approval queue — Payroll Head" : "Validate and enter corrective data — WFM / Payroll HR"}
          </p>
        </div>
        {isLoading ? (
          <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="h-24 rounded-2xl bg-slate-100 animate-pulse" />)}</div>
        ) : disputes.length === 0 ? (
          <div className="flex flex-col items-center py-14 text-slate-400">
            <CheckCircle2 className="w-10 h-10 mb-3 opacity-40" />
            <p className="text-sm">No disputes pending your review.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {disputes.map((d: any) => (
              <Card key={d.id} className="rounded-2xl hover:shadow-md transition-shadow cursor-pointer" onClick={() => setReviewing(d)}>
                <CardContent className="p-4 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-slate-800">{d.employee_code} — {d.employee_name}</p>
                      <Badge className="text-[10px] bg-amber-100 text-amber-800 border-amber-200">
                        {d.dispute_type.replace(/_/g, " ")}
                      </Badge>
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
            ))}
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
