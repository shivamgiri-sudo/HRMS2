// src/pages/payroll/SalaryDisputePage.tsx
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle, CheckCircle2, Clock, XCircle, ChevronRight,
  Calendar, CreditCard, IndianRupee, FileText, Plus
} from "lucide-react";
import { toast } from "sonner";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from "@/components/ui/select";
import { hrmsApi } from "@/lib/hrmsApi";

type DisputeStatus = "pending_wfm"|"pending_payroll_head"|"approved"|"rejected"|"closed";
type DisputeType = "MISSING_OT"|"INCORRECT_ATTENDANCE"|"REGULARIZATION_NOT_APPLIED"|
  "LEAVE_NOT_ASSIGNED"|"INCENTIVE_MISSING"|"WRONG_DEDUCTION"|
  "WRONG_COMPONENT_AMOUNT"|"SHIFT_ALLOWANCE_MISSING"|"DOUBLE_DEDUCTION"|"WRONG_LWP_COUNT"|"OTHER";

// Icon container color per dispute type
const DISPUTE_TYPE_COLOR: Record<string, string> = {
  MISSING_OT:                  "bg-amber-500/15 text-amber-600",
  INCORRECT_ATTENDANCE:        "bg-blue-500/15 text-blue-600",
  REGULARIZATION_NOT_APPLIED: "bg-emerald-500/15 text-emerald-600",
  LEAVE_NOT_ASSIGNED:          "bg-blue-500/15 text-blue-600",
  INCENTIVE_MISSING:           "bg-emerald-500/15 text-emerald-600",
  WRONG_DEDUCTION:             "bg-red-500/15 text-red-600",
  DOUBLE_DEDUCTION:            "bg-red-500/15 text-red-600",
  WRONG_LWP_COUNT:             "bg-orange-500/15 text-orange-600",
  WRONG_COMPONENT_AMOUNT:      "bg-purple-500/15 text-purple-600",
  SHIFT_ALLOWANCE_MISSING:     "bg-indigo-500/15 text-indigo-600",
  OTHER:                       "bg-slate-500/15 text-slate-600",
};

const DISPUTE_TYPES: { value: DisputeType; label: string; icon: React.ReactNode; description: string }[] = [
  { value: "MISSING_OT", label: "Missing Overtime", icon: <Clock className="w-4 h-4" />, description: "Overtime worked but not paid" },
  { value: "INCORRECT_ATTENDANCE", label: "Incorrect Attendance", icon: <Calendar className="w-4 h-4" />, description: "Wrong P/A/HD status on a day" },
  { value: "REGULARIZATION_NOT_APPLIED", label: "Regularization Not Applied", icon: <CheckCircle2 className="w-4 h-4" />, description: "Approved regularization not reflected in salary" },
  { value: "LEAVE_NOT_ASSIGNED", label: "Leave Not Assigned", icon: <Calendar className="w-4 h-4" />, description: "Leave marked as LWP instead of approved leave" },
  { value: "INCENTIVE_MISSING", label: "Incentive Missing", icon: <IndianRupee className="w-4 h-4" />, description: "Incentive amount not credited" },
  { value: "WRONG_DEDUCTION", label: "Wrong Deduction", icon: <CreditCard className="w-4 h-4" />, description: "Incorrect amount deducted" },
  { value: "DOUBLE_DEDUCTION", label: "Double Deduction", icon: <CreditCard className="w-4 h-4" />, description: "Same deduction taken twice" },
  { value: "WRONG_LWP_COUNT", label: "Incorrect LWP Days", icon: <AlertCircle className="w-4 h-4" />, description: "More LWP days deducted than actual" },
  { value: "OTHER", label: "Other", icon: <FileText className="w-4 h-4" />, description: "Any other salary discrepancy" },
];

const STATUS_CONFIG: Record<DisputeStatus, { label: string; color: string; icon: React.ReactNode }> = {
  pending_wfm:          { label: "WFM Review", color: "bg-amber-100 text-amber-800 border-amber-200", icon: <Clock className="w-3 h-3" /> },
  pending_payroll_head: { label: "Payroll Head", color: "bg-blue-100 text-blue-800 border-blue-200", icon: <Clock className="w-3 h-3" /> },
  approved:             { label: "Approved", color: "bg-emerald-100 text-emerald-800 border-emerald-200", icon: <CheckCircle2 className="w-3 h-3" /> },
  rejected:             { label: "Rejected", color: "bg-red-100 text-red-800 border-red-200", icon: <XCircle className="w-3 h-3" /> },
  closed:               { label: "Closed", color: "bg-slate-100 text-slate-600 border-slate-200", icon: <CheckCircle2 className="w-3 h-3" /> },
};

const TIMELINE_STAGES: { key: DisputeStatus; label: string; reviewer: string }[] = [
  { key: "pending_wfm",          label: "Raised",       reviewer: "Employee" },
  { key: "pending_payroll_head", label: "WFM Review",   reviewer: "WFM Team" },
  { key: "approved",             label: "Payroll Head", reviewer: "Payroll Head" },
];

const STATUS_ORDER: DisputeStatus[] = ["pending_wfm", "pending_payroll_head", "approved", "rejected", "closed"];

function ApprovalTimeline({ dispute }: { dispute: any }) {
  const currentIdx = STATUS_ORDER.indexOf(dispute.status as DisputeStatus);
  const isRejected = dispute.status === "rejected";

  return (
    <div className="mt-3 flex items-start gap-0">
      {TIMELINE_STAGES.map((stage, i) => {
        const stageOrderIdx = STATUS_ORDER.indexOf(stage.key);
        const isComplete = !isRejected && currentIdx > stageOrderIdx;
        const isCurrent = dispute.status === stage.key ||
          (i === 0 && dispute.status === "pending_wfm");
        const isRejectedStage = isRejected && currentIdx >= stageOrderIdx;

        let nodeClass = "w-6 h-6 rounded-full border-2 flex items-center justify-center text-[10px] font-bold flex-shrink-0 ";
        let nodeContent: React.ReactNode = <span>{i + 1}</span>;

        if (isRejectedStage && i === 1 && isRejected) {
          nodeClass += "border-red-500 bg-red-500 text-white";
          nodeContent = <XCircle className="w-3.5 h-3.5" />;
        } else if (isComplete) {
          nodeClass += "border-emerald-500 bg-emerald-500 text-white";
          nodeContent = <CheckCircle2 className="w-3.5 h-3.5" />;
        } else if (isCurrent) {
          nodeClass += "border-blue-500 bg-blue-500 text-white ring-2 ring-blue-300 ring-offset-1";
        } else {
          nodeClass += "border-slate-300 bg-white text-slate-400";
        }

        return (
          <div key={stage.key} className="flex items-start">
            <div className="flex flex-col items-center">
              <div className={nodeClass}>{nodeContent}</div>
              <div className="mt-1 text-center" style={{ width: 64 }}>
                <p className={`text-[10px] font-semibold leading-tight ${isComplete ? "text-emerald-700" : isCurrent ? "text-blue-700" : "text-slate-400"}`}>
                  {stage.label}
                </p>
                <p className="text-[9px] text-slate-400 leading-tight">{stage.reviewer}</p>
              </div>
            </div>
            {i < TIMELINE_STAGES.length - 1 && (
              <div className={`h-px w-8 mt-3 mx-1 flex-shrink-0 ${isComplete ? "bg-emerald-400" : "bg-slate-200"}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// Rolling 24 months for month picker
const MONTH_OPTIONS = Array.from({ length: 24 }, (_, i) => {
  const d = new Date(); d.setMonth(d.getMonth() - i - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
});

function unwrap<T>(r: unknown): T {
  return ((r as any)?.data?.data ?? (r as any)?.data ?? r) as T;
}

function RaiseDisputeForm({ onSuccess }: { onSuccess: () => void }) {
  const qc = useQueryClient();
  const [step, setStep] = useState(1);
  const [runMonth, setRunMonth] = useState("");
  const [disputeType, setDisputeType] = useState<DisputeType | "">("");
  const [affectedDates, setAffectedDates] = useState<string[]>([]);
  const [description, setDescription] = useState("");

  const mutation = useMutation({
    mutationFn: () =>
      hrmsApi.post("/api/salary-disputes", {
        runMonth, disputeType, affectedDates, description,
      }),
    onSuccess: () => {
      toast.success("Dispute raised successfully. WFM has been notified.");
      qc.invalidateQueries({ queryKey: ["my-salary-disputes"] });
      onSuccess();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const datesInMonth = runMonth ? Array.from({ length: 31 }, (_, i) => {
    const d = new Date(`${runMonth}-01`);
    d.setDate(i + 1);
    if (d.getMonth() + 1 !== parseInt(runMonth.split("-")[1])) return null;
    return d.toISOString().split("T")[0];
  }).filter(Boolean) as string[] : [];

  const toggleDate = (date: string) => {
    setAffectedDates(prev =>
      prev.includes(date) ? prev.filter(d => d !== date) : [...prev, date]
    );
  };

  if (step === 1) return (
    <div className="space-y-4">
      <div>
        <p className="text-sm font-medium text-slate-700 mb-2">Which month's salary is incorrect?</p>
        <Select value={runMonth} onValueChange={setRunMonth}>
          <SelectTrigger><SelectValue placeholder="Select month" /></SelectTrigger>
          <SelectContent>
            {MONTH_OPTIONS.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <Button className="w-full" disabled={!runMonth} onClick={() => setStep(2)}>
        Next <ChevronRight className="ml-1 h-4 w-4" />
      </Button>
    </div>
  );

  if (step === 2) return (
    <div className="space-y-3">
      <p className="text-sm font-medium text-slate-700">What is the issue?</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {DISPUTE_TYPES.map(dt => {
          const colorClass = DISPUTE_TYPE_COLOR[dt.value] ?? "bg-slate-500/15 text-slate-600";
          return (
            <button key={dt.value}
              onClick={() => setDisputeType(dt.value)}
              className={`flex items-start gap-2.5 rounded-xl border p-3 text-left transition-colors
                ${disputeType === dt.value
                  ? "border-blue-500 bg-blue-50"
                  : "border-slate-200 hover:border-slate-300 hover:bg-slate-50"}`}
            >
              <span className={`mt-0.5 w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${colorClass}`}>
                {dt.icon}
              </span>
              <div>
                <p className="text-xs font-semibold text-slate-800">{dt.label}</p>
                <p className="text-[10px] text-slate-500 mt-0.5">{dt.description}</p>
              </div>
            </button>
          );
        })}
      </div>
      <div className="flex gap-2">
        <Button variant="outline" onClick={() => setStep(1)}>Back</Button>
        <Button className="flex-1" disabled={!disputeType} onClick={() => setStep(3)}>
          Next <ChevronRight className="ml-1 h-4 w-4" />
        </Button>
      </div>
    </div>
  );

  if (step === 3) return (
    <div className="space-y-3">
      <p className="text-sm font-medium text-slate-700">Select affected dates <span className="text-slate-400 font-normal">(optional)</span></p>
      <div className="grid grid-cols-7 gap-1">
        {datesInMonth.map(date => {
          const day = new Date(date).getDate();
          const isSelected = affectedDates.includes(date);
          return (
            <button
              key={date}
              onClick={() => toggleDate(date)}
              className={`p-2 text-xs rounded-lg border transition-colors ${
                isSelected
                  ? "bg-red-500 text-white border-red-500"
                  : "border-slate-200 hover:border-slate-300 hover:bg-slate-50"
              }`}
            >
              {day}
            </button>
          );
        })}
      </div>
      {affectedDates.length > 0 && (
        <p className="text-xs text-slate-500">{affectedDates.length} date(s) selected</p>
      )}
      <div className="flex gap-2">
        <Button variant="outline" onClick={() => setStep(2)}>Back</Button>
        <Button className="flex-1" onClick={() => setStep(4)}>
          Next <ChevronRight className="ml-1 h-4 w-4" />
        </Button>
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm font-medium text-slate-700 mb-1">
          Describe the issue <span className="text-slate-400 font-normal">(minimum 20 characters)</span>
        </p>
        <Textarea
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder="Explain what was wrong in your salary and what it should have been..."
          rows={4}
          className="resize-none"
        />
        <p className="text-xs text-slate-400 mt-1 text-right">{description.length} / 20 min</p>
      </div>
      <div className="flex gap-2">
        <Button variant="outline" onClick={() => setStep(3)}>Back</Button>
        <Button
          className="flex-1 bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-700 hover:to-rose-700 shadow-lg shadow-red-500/30"
          disabled={description.trim().length < 20 || mutation.isPending}
          onClick={() => mutation.mutate()}
        >
          {mutation.isPending ? "Submitting…" : "Submit Dispute"}
        </Button>
      </div>
    </div>
  );
}

export default function SalaryDisputePage() {
  const [showRaise, setShowRaise] = useState(false);
  const qc = useQueryClient();

  const { data: raw, isLoading } = useQuery({
    queryKey: ["my-salary-disputes"],
    queryFn: () => hrmsApi.get("/api/salary-disputes/my"),
    staleTime: 30_000,
  });
  const disputes = unwrap<any[]>(raw) ?? [];

  const withdrawMutation = useMutation({
    mutationFn: (id: string) => hrmsApi.post(`/api/salary-disputes/${id}/withdraw`),
    onSuccess: () => {
      toast.success("Dispute withdrawn.");
      qc.invalidateQueries({ queryKey: ["my-salary-disputes"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <DashboardLayout>
      <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-5">
        {/* Header */}
        <div className="rounded-2xl bg-gradient-to-r from-red-600 to-rose-600 p-5 text-white flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">Salary Disputes</h1>
            <p className="text-red-100 text-sm mt-0.5">Raise a dispute if your salary is incorrect</p>
          </div>
          <Button
            size="sm"
            variant="secondary"
            className="bg-white/20 hover:bg-white/30 text-white border-white/30"
            onClick={() => setShowRaise(v => !v)}
          >
            <Plus className="w-4 h-4 mr-1.5" />
            Raise Dispute
          </Button>
        </div>

        {/* Raise form */}
        {showRaise && (
          <Card className="rounded-2xl border border-white/60 bg-white/95 backdrop-blur-sm shadow-sm border-red-200">
            <CardHeader className="pb-2">
              <CardTitle className="text-base text-red-800">New Salary Dispute</CardTitle>
            </CardHeader>
            <CardContent>
              <RaiseDisputeForm onSuccess={() => setShowRaise(false)} />
            </CardContent>
          </Card>
        )}

        {/* My disputes list */}
        {isLoading ? (
          <div className="space-y-3">
            {[1,2,3].map(i => <div key={i} className="h-20 rounded-2xl bg-slate-100 animate-pulse" />)}
          </div>
        ) : disputes.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-14 text-slate-400">
            <FileText className="w-10 h-10 mb-3 opacity-40" />
            <p className="text-sm">No salary disputes raised yet.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {disputes.map((d: any) => {
              const cfg = STATUS_CONFIG[d.status as DisputeStatus];
              const typeColorClass = DISPUTE_TYPE_COLOR[d.dispute_type] ?? "bg-slate-500/15 text-slate-600";
              const disputeTypeDef = DISPUTE_TYPES.find(t => t.value === d.dispute_type);
              return (
                <Card key={d.id} className="rounded-2xl border border-white/60 bg-white/95 backdrop-blur-sm shadow-sm hover:shadow-md transition-shadow">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3 min-w-0">
                        {disputeTypeDef && (
                          <span className={`mt-0.5 w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${typeColorClass}`}>
                            {disputeTypeDef.icon}
                          </span>
                        )}
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-slate-800">
                            {disputeTypeDef?.label ?? d.dispute_type}
                          </p>
                          <p className="text-xs text-slate-500 mt-0.5">Month: {d.run_month}</p>
                          <p className="text-xs text-slate-500 mt-0.5 line-clamp-1">{d.description}</p>
                        </div>
                      </div>
                      <div className="flex-shrink-0 flex flex-col items-end gap-1.5">
                        <Badge className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full border ${cfg.color} flex items-center gap-1`}>
                          {cfg.icon}{cfg.label}
                        </Badge>
                        {d.differential_amount && d.status === "approved" && (
                          <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-700 bg-emerald-100 border border-emerald-200 rounded-full px-2 py-0.5">
                            <IndianRupee className="w-3 h-3" />
                            +{Number(d.differential_amount).toLocaleString("en-IN")}
                          </span>
                        )}
                      </div>
                    </div>
                    {/* 3-stage approval timeline */}
                    <ApprovalTimeline dispute={d} />
                    {d.arrear_run_month && (
                      <p className="text-[10px] text-emerald-600 font-medium mt-2">
                        Arrear will be paid in {d.arrear_run_month} salary
                      </p>
                    )}
                    {d.status === "pending_wfm" && (
                      <div className="mt-3 pt-3 border-t flex justify-end">
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-xs text-red-600 border-red-200 hover:bg-red-50"
                          disabled={withdrawMutation.isPending}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (confirm("Withdraw this dispute? This cannot be undone.")) {
                              withdrawMutation.mutate(d.id);
                            }
                          }}
                        >
                          Withdraw
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
