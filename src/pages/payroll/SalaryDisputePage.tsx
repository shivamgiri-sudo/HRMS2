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
  const [description, setDescription] = useState("");

  const mutation = useMutation({
    mutationFn: () =>
      hrmsApi.post("/api/salary-disputes", {
        runMonth, disputeType, affectedDates: [], description,
      }),
    onSuccess: () => {
      toast.success("Dispute raised successfully. WFM has been notified.");
      qc.invalidateQueries({ queryKey: ["my-salary-disputes"] });
      onSuccess();
    },
    onError: (e: Error) => toast.error(e.message),
  });

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
        {DISPUTE_TYPES.map(dt => (
          <button key={dt.value}
            onClick={() => setDisputeType(dt.value)}
            className={`flex items-start gap-2.5 rounded-xl border p-3 text-left transition-colors
              ${disputeType === dt.value
                ? "border-blue-500 bg-blue-50"
                : "border-slate-200 hover:border-slate-300 hover:bg-slate-50"}`}
          >
            <span className={`mt-0.5 ${disputeType === dt.value ? "text-blue-600" : "text-slate-500"}`}>{dt.icon}</span>
            <div>
              <p className="text-xs font-semibold text-slate-800">{dt.label}</p>
              <p className="text-[10px] text-slate-500 mt-0.5">{dt.description}</p>
            </div>
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <Button variant="outline" onClick={() => setStep(1)}>Back</Button>
        <Button className="flex-1" disabled={!disputeType} onClick={() => setStep(3)}>
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
        <Button variant="outline" onClick={() => setStep(2)}>Back</Button>
        <Button
          className="flex-1 bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-700 hover:to-rose-700"
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

  const { data: raw, isLoading } = useQuery({
    queryKey: ["my-salary-disputes"],
    queryFn: () => hrmsApi.get("/api/salary-disputes/my"),
    staleTime: 30_000,
  });
  const disputes = unwrap<any[]>(raw) ?? [];

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
          <Card className="rounded-2xl border-red-200 bg-red-50/30">
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
              return (
                <Card key={d.id} className="rounded-2xl hover:shadow-md transition-shadow">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-800">
                          {DISPUTE_TYPES.find(t => t.value === d.dispute_type)?.label ?? d.dispute_type}
                        </p>
                        <p className="text-xs text-slate-500 mt-0.5">Month: {d.run_month}</p>
                        <p className="text-xs text-slate-500 mt-0.5 line-clamp-1">{d.description}</p>
                      </div>
                      <div className="flex-shrink-0 flex flex-col items-end gap-1.5">
                        <Badge className={`text-[10px] font-bold border ${cfg.color} flex items-center gap-1`}>
                          {cfg.icon}{cfg.label}
                        </Badge>
                        {d.differential_amount && d.status === "approved" && (
                          <span className="text-xs font-bold text-emerald-600">+₹{Number(d.differential_amount).toLocaleString("en-IN")}</span>
                        )}
                      </div>
                    </div>
                    {/* Mini timeline */}
                    <div className="flex items-center gap-1.5 mt-3">
                      {(["pending_wfm","pending_payroll_head","approved"] as DisputeStatus[]).map((s, i) => {
                        const statusOrder = ["pending_wfm","pending_payroll_head","approved","rejected"];
                        const currentIdx = statusOrder.indexOf(d.status);
                        const isComplete = i < currentIdx;
                        const isCurrent = d.status === s;
                        return (
                          <div key={s} className="flex items-center gap-1">
                            <div className={`w-2 h-2 rounded-full ${
                              d.status === "rejected" && i <= currentIdx ? "bg-red-400"
                              : isComplete || isCurrent ? "bg-blue-500"
                              : "bg-slate-200"
                            }`} />
                            {i < 2 && <div className={`h-px w-6 ${isComplete ? "bg-blue-300" : "bg-slate-200"}`} />}
                          </div>
                        );
                      })}
                      <span className="text-[10px] text-slate-400 ml-1">{new Date(d.created_at).toLocaleDateString("en-IN")}</span>
                    </div>
                    {d.arrear_run_month && (
                      <p className="text-[10px] text-emerald-600 font-medium mt-1.5">
                        Arrear will be paid in {d.arrear_run_month} salary
                      </p>
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
