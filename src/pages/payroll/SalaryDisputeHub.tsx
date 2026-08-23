/**
 * Salary Dispute Hub — /payroll/salary-disputes
 *
 * Merged hub replacing three separate dispute pages:
 *   My Disputes    (employee)           — was /payroll/salary-disputes
 *   Dispute Queue  (wfm / payroll_head) — was /payroll/salary-disputes/queue
 *   Team Disputes  (manager read-only)  — was /payroll/salary-disputes/team
 *
 * Tab visibility is role-driven. Navigate via ?tab=mine|queue|team.
 * Direct links to the old routes redirect here via payroll.routes.tsx.
 */
import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle, CheckCircle2, Clock, XCircle, ChevronRight,
  Calendar, CreditCard, IndianRupee, FileText, Plus, Users, AlertTriangle, BarChart2,
} from "lucide-react";
import { toast } from "sonner";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { hrmsApi } from "@/lib/hrmsApi";
import { useWorkforceAccess } from "@/hooks/useUserRole";

// ─── Shared types & constants ─────────────────────────────────────────────────

type DisputeStatus = "pending_wfm"|"pending_payroll_head"|"approved"|"rejected"|"closed";
type DisputeType = "MISSING_OT"|"INCORRECT_ATTENDANCE"|"REGULARIZATION_NOT_APPLIED"|
  "LEAVE_NOT_ASSIGNED"|"INCENTIVE_MISSING"|"WRONG_DEDUCTION"|
  "WRONG_COMPONENT_AMOUNT"|"SHIFT_ALLOWANCE_MISSING"|"DOUBLE_DEDUCTION"|"WRONG_LWP_COUNT"|"OTHER";

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

const DISPUTE_TYPES: { value: DisputeType; label: string; icon: React.ReactNode; description: string }[] = [
  { value: "MISSING_OT",                   label: "Missing Overtime",            icon: <Clock className="w-4 h-4" />, description: "Overtime worked but not paid" },
  { value: "INCORRECT_ATTENDANCE",         label: "Incorrect Attendance",        icon: <Calendar className="w-4 h-4" />, description: "Wrong P/A/HD status on a day" },
  { value: "REGULARIZATION_NOT_APPLIED",   label: "Regularization Not Applied",  icon: <CheckCircle2 className="w-4 h-4" />, description: "Approved regularization not reflected" },
  { value: "LEAVE_NOT_ASSIGNED",           label: "Leave Not Assigned",          icon: <Calendar className="w-4 h-4" />, description: "Leave marked as LWP instead of approved leave" },
  { value: "INCENTIVE_MISSING",            label: "Incentive Missing",           icon: <IndianRupee className="w-4 h-4" />, description: "Incentive amount not credited" },
  { value: "WRONG_DEDUCTION",              label: "Wrong Deduction",             icon: <CreditCard className="w-4 h-4" />, description: "Incorrect amount deducted" },
  { value: "DOUBLE_DEDUCTION",             label: "Double Deduction",            icon: <CreditCard className="w-4 h-4" />, description: "Same deduction taken twice" },
  { value: "WRONG_LWP_COUNT",              label: "Incorrect LWP Days",          icon: <AlertCircle className="w-4 h-4" />, description: "More LWP days deducted than actual" },
  { value: "OTHER",                        label: "Other",                       icon: <FileText className="w-4 h-4" />, description: "Any other salary discrepancy" },
];

const STATUS_CONFIG: Record<DisputeStatus, { label: string; color: string; icon: React.ReactNode }> = {
  pending_wfm:          { label: "WFM Review",    color: "bg-amber-100 text-amber-800 border-amber-200",   icon: <Clock className="w-3 h-3" /> },
  pending_payroll_head: { label: "Payroll Head",  color: "bg-blue-100 text-blue-800 border-blue-200",     icon: <Clock className="w-3 h-3" /> },
  approved:             { label: "Approved",      color: "bg-emerald-100 text-emerald-800 border-emerald-200", icon: <CheckCircle2 className="w-3 h-3" /> },
  rejected:             { label: "Rejected",      color: "bg-red-100 text-red-800 border-red-200",         icon: <XCircle className="w-3 h-3" /> },
  closed:               { label: "Closed",        color: "bg-slate-100 text-slate-600 border-slate-200",   icon: <CheckCircle2 className="w-3 h-3" /> },
};

const STATUS_ORDER: DisputeStatus[] = ["pending_wfm","pending_payroll_head","approved","rejected","closed"];
const TIMELINE_STAGES: { key: DisputeStatus; label: string; reviewer: string }[] = [
  { key: "pending_wfm",          label: "Raised",       reviewer: "Employee" },
  { key: "pending_payroll_head", label: "WFM Review",   reviewer: "WFM Team" },
  { key: "approved",             label: "Payroll Head", reviewer: "Payroll Head" },
];

const MONTH_OPTIONS = Array.from({ length: 24 }, (_, i) => {
  const d = new Date(); d.setMonth(d.getMonth() - i - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
});

function unwrap<T>(r: unknown): T {
  return ((r as any)?.data?.data ?? (r as any)?.data ?? r) as T;
}

// ─── Approval Timeline ────────────────────────────────────────────────────────

function ApprovalTimeline({ dispute }: { dispute: any }) {
  const currentIdx = STATUS_ORDER.indexOf(dispute.status as DisputeStatus);
  const isRejected = dispute.status === "rejected";
  return (
    <div className="mt-3 flex items-start gap-0">
      {TIMELINE_STAGES.map((stage, i) => {
        const stageOrderIdx = STATUS_ORDER.indexOf(stage.key);
        const isComplete = !isRejected && currentIdx > stageOrderIdx;
        const isCurrent = dispute.status === stage.key || (i === 0 && dispute.status === "pending_wfm");
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
                <p className={`text-[10px] font-semibold leading-tight ${isComplete ? "text-emerald-700" : isCurrent ? "text-blue-700" : "text-slate-400"}`}>{stage.label}</p>
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

// ─── Raise Dispute Form ───────────────────────────────────────────────────────

function RaiseDisputeForm({ onSuccess }: { onSuccess: () => void }) {
  const qc = useQueryClient();
  const [step, setStep] = useState(1);
  const [runMonth, setRunMonth] = useState("");
  const [disputeType, setDisputeType] = useState<DisputeType | "">("");
  const [affectedDates, setAffectedDates] = useState<string[]>([]);
  const [description, setDescription] = useState("");

  const mutation = useMutation({
    mutationFn: () => hrmsApi.post("/api/salary-disputes", { runMonth, disputeType, affectedDates, description }),
    onSuccess: () => {
      toast.success("Dispute raised. WFM has been notified.");
      qc.invalidateQueries({ queryKey: ["my-salary-disputes"] });
      onSuccess();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const datesInMonth = runMonth ? Array.from({ length: 31 }, (_, i) => {
    const d = new Date(`${runMonth}-01`); d.setDate(i + 1);
    if (d.getMonth() + 1 !== parseInt(runMonth.split("-")[1])) return null;
    return d.toISOString().split("T")[0];
  }).filter(Boolean) as string[] : [];

  const toggleDate = (date: string) =>
    setAffectedDates(prev => prev.includes(date) ? prev.filter(d => d !== date) : [...prev, date]);

  if (step === 1) return (
    <div className="space-y-4">
      <div>
        <p className="text-sm font-medium text-slate-700 mb-2">Which month's salary is incorrect?</p>
        <Select value={runMonth} onValueChange={setRunMonth}>
          <SelectTrigger><SelectValue placeholder="Select month" /></SelectTrigger>
          <SelectContent>{MONTH_OPTIONS.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <Button className="w-full" disabled={!runMonth} onClick={() => setStep(2)}>Next <ChevronRight className="ml-1 h-4 w-4" /></Button>
    </div>
  );

  if (step === 2) return (
    <div className="space-y-3">
      <p className="text-sm font-medium text-slate-700">What is the issue?</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {DISPUTE_TYPES.map(dt => (
          <button key={dt.value} onClick={() => setDisputeType(dt.value)}
            className={`flex items-start gap-2.5 rounded-xl border p-3 text-left transition-colors ${disputeType === dt.value ? "border-blue-500 bg-blue-50" : "border-slate-200 hover:border-slate-300 hover:bg-slate-50"}`}
          >
            <span className={`mt-0.5 w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${DISPUTE_TYPE_COLOR[dt.value] ?? "bg-slate-500/15 text-slate-600"}`}>{dt.icon}</span>
            <div>
              <p className="text-xs font-semibold text-slate-800">{dt.label}</p>
              <p className="text-[10px] text-slate-500 mt-0.5">{dt.description}</p>
            </div>
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <Button variant="outline" onClick={() => setStep(1)}>Back</Button>
        <Button className="flex-1" disabled={!disputeType} onClick={() => setStep(3)}>Next <ChevronRight className="ml-1 h-4 w-4" /></Button>
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
            <button key={date} onClick={() => toggleDate(date)}
              className={`p-2 text-xs rounded-lg border transition-colors ${isSelected ? "bg-red-500 text-white border-red-500" : "border-slate-200 hover:border-slate-300 hover:bg-slate-50"}`}
            >{day}</button>
          );
        })}
      </div>
      {affectedDates.length > 0 && <p className="text-xs text-slate-500">{affectedDates.length} date(s) selected</p>}
      <div className="flex gap-2">
        <Button variant="outline" onClick={() => setStep(2)}>Back</Button>
        <Button className="flex-1" onClick={() => setStep(4)}>Next <ChevronRight className="ml-1 h-4 w-4" /></Button>
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm font-medium text-slate-700 mb-1">Describe the issue <span className="text-slate-400 font-normal">(minimum 20 characters)</span></p>
        <Textarea value={description} onChange={e => setDescription(e.target.value)}
          placeholder="Explain what was wrong and what it should have been..." rows={4} className="resize-none" />
        <p className="text-xs text-slate-400 mt-1 text-right">{description.length} / 20 min</p>
      </div>
      <div className="flex gap-2">
        <Button variant="outline" onClick={() => setStep(3)}>Back</Button>
        <Button className="flex-1 bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-700 hover:to-rose-700 shadow-lg shadow-red-500/30"
          disabled={description.trim().length < 20 || mutation.isPending} onClick={() => mutation.mutate()}>
          {mutation.isPending ? "Submitting…" : "Submit Dispute"}
        </Button>
      </div>
    </div>
  );
}

// ─── My Disputes Tab (Employee) ───────────────────────────────────────────────

function MyDisputesTab() {
  const [showRaise, setShowRaise] = useState(false);
  const qc = useQueryClient();
  const [appealId, setAppealId] = useState<string | null>(null);
  const [appealReason, setAppealReason] = useState("");

  const { data: raw, isLoading } = useQuery({
    queryKey: ["my-salary-disputes"],
    queryFn: () => hrmsApi.get("/api/salary-disputes/my"),
    staleTime: 30_000,
  });
  const disputes = unwrap<any[]>(raw) ?? [];

  const withdrawMutation = useMutation({
    mutationFn: (id: string) => hrmsApi.post(`/api/salary-disputes/${id}/withdraw`),
    onSuccess: () => { toast.success("Dispute withdrawn."); qc.invalidateQueries({ queryKey: ["my-salary-disputes"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const appealMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      hrmsApi.post(`/api/salary-disputes/${id}/appeal`, { appealReason: reason }),
    onSuccess: () => {
      toast.success("Appeal submitted. WFM will re-review your dispute.");
      qc.invalidateQueries({ queryKey: ["my-salary-disputes"] });
      setAppealId(null); setAppealReason("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-slate-500">{disputes.length} dispute{disputes.length !== 1 ? "s" : ""} raised</p>
        <Button size="sm"
          className="bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-700 hover:to-rose-700 shadow-sm shadow-red-500/20"
          onClick={() => setShowRaise(v => !v)}>
          <Plus className="w-4 h-4 mr-1.5" />
          Raise Dispute
        </Button>
      </div>

      {showRaise && (
        <Card className="rounded-2xl border-red-200 shadow-sm">
          <CardHeader className="pb-2"><CardTitle className="text-base text-red-800">New Salary Dispute</CardTitle></CardHeader>
          <CardContent><RaiseDisputeForm onSuccess={() => setShowRaise(false)} /></CardContent>
        </Card>
      )}

      {isLoading ? (
        <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="h-20 rounded-2xl bg-slate-100 animate-pulse" />)}</div>
      ) : disputes.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-14 text-slate-400">
          <FileText className="w-10 h-10 mb-3 opacity-40" />
          <p className="text-sm">No salary disputes raised yet.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {disputes.map((d: any) => {
            const cfg = STATUS_CONFIG[d.status as DisputeStatus];
            const disputeTypeDef = DISPUTE_TYPES.find(t => t.value === d.dispute_type);
            return (
              <Card key={d.id} className="rounded-2xl border border-white/60 bg-white/95 shadow-sm hover:shadow-md transition-shadow">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 min-w-0">
                      {disputeTypeDef && (
                        <span className={`mt-0.5 w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${DISPUTE_TYPE_COLOR[d.dispute_type] ?? "bg-slate-500/15 text-slate-600"}`}>
                          {disputeTypeDef.icon}
                        </span>
                      )}
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-800">{disputeTypeDef?.label ?? d.dispute_type}</p>
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
                          <IndianRupee className="w-3 h-3" />+{Number(d.differential_amount).toLocaleString("en-IN")}
                        </span>
                      )}
                    </div>
                  </div>
                  <ApprovalTimeline dispute={d} />
                  {d.arrear_run_month && (
                    <p className="text-[10px] text-emerald-600 font-medium mt-2">Arrear will be paid in {d.arrear_run_month} salary</p>
                  )}
                  {d.status === "pending_wfm" && (
                    <div className="mt-3 pt-3 border-t flex justify-end">
                      <Button size="sm" variant="outline" className="text-xs text-red-600 border-red-200 hover:bg-red-50"
                        disabled={withdrawMutation.isPending}
                        onClick={() => { if (confirm("Withdraw this dispute?")) withdrawMutation.mutate(d.id); }}>
                        Withdraw
                      </Button>
                    </div>
                  )}
                  {d.status === "rejected" && d.appeal_count === 0 && (
                    <div className="mt-3 pt-3 border-t flex justify-end">
                      <Button size="sm" variant="outline" className="text-xs text-blue-600 border-blue-200 hover:bg-blue-50"
                        onClick={() => setAppealId(d.id)}>
                        Appeal Decision
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Appeal modal */}
      {appealId && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <Card className="w-full max-w-md rounded-2xl shadow-2xl">
            <CardHeader className="bg-gradient-to-r from-blue-600 to-indigo-600 rounded-t-2xl p-4">
              <CardTitle className="text-white text-base">Appeal Rejected Dispute</CardTitle>
            </CardHeader>
            <CardContent className="p-4 space-y-4">
              <p className="text-sm text-slate-600">Submit one appeal with additional information.</p>
              <div>
                <label className="text-xs font-semibold text-slate-700">Why should this be reconsidered? (min 20 chars)</label>
                <Textarea value={appealReason} onChange={e => setAppealReason(e.target.value)}
                  placeholder="Explain why the rejection was incorrect and provide new evidence..." rows={4} className="mt-1 resize-none" />
                <p className="text-xs text-slate-400 mt-1 text-right">{appealReason.length} / 20 min</p>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => { setAppealId(null); setAppealReason(""); }}>Cancel</Button>
                <Button className="flex-1" disabled={appealReason.trim().length < 20 || appealMutation.isPending}
                  onClick={() => appealMutation.mutate({ id: appealId, reason: appealReason })}>
                  {appealMutation.isPending ? "Submitting…" : "Submit Appeal"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

// ─── Review Dialog (WFM / Payroll Head) ──────────────────────────────────────

function ReviewDialog({ dispute, role, onClose }: { dispute: any; role: "wfm" | "payroll_head"; onClose: () => void }) {
  const qc = useQueryClient();
  const [action, setAction] = useState<"approve" | "reject" | null>(null);
  const [remarks, setRemarks] = useState("");
  const [differential, setDifferential] = useState<string>("");
  const [correctiveSummary, setCorrectiveSummary] = useState("");
  const [disputedDays, setDisputedDays] = useState<string>(dispute.affected_dates?.length?.toString() || "1");

  const { data: salaryRaw } = useQuery({
    queryKey: ["dispute-salary", dispute.id],
    queryFn: () => hrmsApi.get(`/api/salary-disputes/${dispute.id}/salary-details`),
    enabled: role === "wfm", staleTime: 60_000,
  });
  const salary = (salaryRaw as any)?.data?.data ?? (salaryRaw as any)?.data ?? null;

  const { data: attachRaw } = useQuery({
    queryKey: ["dispute-attachments", dispute.id],
    queryFn: () => hrmsApi.get(`/api/salary-disputes/${dispute.id}/attachments`),
    staleTime: 60_000,
  });
  const attachments = unwrap<any[]>(attachRaw) ?? [];

  const { data: auditRaw } = useQuery({
    queryKey: ["dispute-audit", dispute.id],
    queryFn: () => hrmsApi.get(`/api/salary-disputes/${dispute.id}/audit-log`),
    enabled: !!dispute.original_dispute_id, staleTime: 60_000,
  });
  const auditLog = unwrap<any[]>(auditRaw) ?? [];

  const suggestedDifferential = salary?.perDayRate && disputedDays
    ? Math.round(salary.perDayRate * parseInt(disputedDays || "0")) : 0;

  const endpoint = role === "wfm"
    ? `/api/salary-disputes/${dispute.id}/wfm-review`
    : `/api/salary-disputes/${dispute.id}/payroll-head-review`;

  const mutation = useMutation({
    mutationFn: () => hrmsApi.post(endpoint, {
      action, remarks,
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
          <div className="flex items-center justify-between">
            <CardTitle className="text-white text-base">Review Salary Dispute</CardTitle>
            <button onClick={onClose} className="text-white/70 hover:text-white">✕</button>
          </div>
        </CardHeader>
        <CardContent className="p-4 space-y-4 max-h-[75vh] overflow-y-auto">
          {/* Employee details */}
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2">Employee Details</p>
            <div className="rounded-xl bg-slate-50 border p-3 space-y-1 text-sm">
              <div className="flex justify-between"><span className="text-slate-500">Employee</span><span className="font-medium">{dispute.employee_code} — {dispute.employee_name}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Month</span><span className="font-medium">{dispute.run_month}</span></div>
              <div className="flex justify-between items-center"><span className="text-slate-500">Type</span>
                <Badge className={`text-[10px] font-bold border flex items-center gap-1 ${typeBadge.color}`}>{typeBadge.icon}{dispute.dispute_type.replace(/_/g, " ")}</Badge>
              </div>
              <div className="flex justify-between"><span className="text-slate-500">Raised On</span><span className="font-medium">{new Date(dispute.created_at).toLocaleDateString("en-IN")}</span></div>
            </div>
          </div>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2">Dispute Details</p>
            <p className="text-sm text-slate-700 bg-amber-50 rounded-xl p-3 border border-amber-100">{dispute.description}</p>
            {dispute.affected_dates?.length > 0 && <p className="text-xs text-slate-500 mt-2">Affected: {dispute.affected_dates.map((d: string) => new Date(d).getDate()).join(", ")}</p>}
          </div>
          {dispute.original_dispute_id && (
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-purple-500 mb-2">Appeal Information</p>
              <div className="rounded-xl bg-purple-50 border border-purple-200 p-3 space-y-2">
                <p className="text-sm text-purple-700 font-medium">This is an appeal of a rejected dispute.</p>
                {dispute.appeal_reason && <p className="text-sm text-slate-700">{dispute.appeal_reason}</p>}
                {auditLog.length > 0 && (
                  <details className="mt-2">
                    <summary className="text-xs text-purple-600 cursor-pointer hover:underline">View Audit History ({auditLog.length} events)</summary>
                    <div className="mt-2 space-y-1 text-xs">
                      {auditLog.map((a: any) => (
                        <div key={a.id} className="flex gap-2 text-slate-600">
                          <span className="font-mono text-slate-400">{new Date(a.created_at).toLocaleDateString("en-IN")}</span>
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
          {attachments.length > 0 && (
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2">Attachments ({attachments.length})</p>
              <div className="space-y-1">
                {attachments.map((a: any) => (
                  <a key={a.id} href={`/api/files/download/${a.file_path}`} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-2 text-sm text-blue-600 hover:underline bg-blue-50 rounded-lg p-2 border border-blue-100">
                    <FileText className="w-4 h-4" />{a.file_name}
                    <span className="text-xs text-slate-400 ml-auto">{a.file_size ? `${Math.round(a.file_size / 1024)}KB` : ""}</span>
                  </a>
                ))}
              </div>
            </div>
          )}
          {role === "wfm" && salary && (
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2">Salary Details ({dispute.run_month})</p>
              <div className="rounded-xl bg-blue-50 border border-blue-100 p-3 space-y-2">
                <div className="flex justify-between text-sm"><span className="text-slate-500">Gross Salary</span><span className="font-bold">₹{salary.gross.toLocaleString("en-IN")}</span></div>
                <div className="flex justify-between text-sm"><span className="text-slate-500">Working Days</span><span className="font-medium">{salary.workingDays}</span></div>
                <div className="flex justify-between text-sm"><span className="text-slate-500">Per Day Rate</span><span className="font-bold text-blue-700">₹{salary.perDayRate.toLocaleString("en-IN")}</span></div>
              </div>
            </div>
          )}
          {role === "payroll_head" && dispute.wfm_remarks && (
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2">WFM Remarks</p>
              <p className="text-sm text-slate-700 bg-slate-50 rounded-xl p-3 border">{dispute.wfm_remarks}</p>
              {dispute.differential_amount && <p className="text-sm font-bold text-emerald-700 mt-1.5">Validated Differential: +₹{Number(dispute.differential_amount).toLocaleString("en-IN")}</p>}
            </div>
          )}
          {/* Action section */}
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2">Your Action</p>
            <div className="flex gap-2">
              <button onClick={() => setAction("approve")}
                className={`flex-1 rounded-xl border py-2.5 text-sm font-semibold transition-colors flex items-center justify-center gap-1.5 ${action === "approve" ? "bg-emerald-600 text-white border-emerald-600" : "border-emerald-300 text-emerald-700 hover:bg-emerald-50"}`}>
                <CheckCircle2 className="w-4 h-4" /> Approve
              </button>
              <button onClick={() => setAction("reject")}
                className={`flex-1 rounded-xl border py-2.5 text-sm font-semibold transition-colors flex items-center justify-center gap-1.5 ${action === "reject" ? "bg-red-600 text-white border-red-600" : "border-red-300 text-red-700 hover:bg-red-50"}`}>
                <XCircle className="w-4 h-4" /> Reject
              </button>
            </div>
            {role === "wfm" && action === "approve" && (
              <div className="space-y-3 mt-3">
                {isAttendanceBased && salary && (
                  <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-emerald-600 mb-2">Auto-Calculate</p>
                    <div className="flex items-center gap-2">
                      <div className="flex-1"><label className="text-xs text-slate-600">Disputed Days</label><Input type="number" min="1" max="31" value={disputedDays} onChange={e => setDisputedDays(e.target.value)} className="mt-1" /></div>
                      <div className="text-center text-slate-400">×</div>
                      <div className="flex-1"><label className="text-xs text-slate-600">Per Day Rate</label><p className="mt-1 py-2 px-3 bg-white rounded-md border text-sm font-bold">₹{salary.perDayRate.toLocaleString("en-IN")}</p></div>
                      <div className="text-center text-slate-400">=</div>
                      <div className="flex-1"><label className="text-xs text-slate-600">Suggested</label>
                        <Button size="sm" variant="outline" className="mt-1 w-full border-emerald-300 text-emerald-700 hover:bg-emerald-100" onClick={() => setDifferential(suggestedDifferential.toString())}>
                          ₹{suggestedDifferential.toLocaleString("en-IN")}
                        </Button>
                      </div>
                    </div>
                  </div>
                )}
                <div><label className="text-xs font-semibold text-slate-600">Differential Amount (₹) *</label><Input type="number" min="1" value={differential} onChange={e => setDifferential(e.target.value)} placeholder="Enter corrected amount difference" className="mt-1" /></div>
                <div><label className="text-xs font-semibold text-slate-600">Corrective Summary *</label><Textarea value={correctiveSummary} onChange={e => setCorrectiveSummary(e.target.value)} placeholder="What was wrong and what the correct value is..." rows={2} className="mt-1 resize-none" /></div>
              </div>
            )}
            {action && (
              <div className="mt-3">
                <label className="text-xs font-semibold text-slate-600">Remarks * (min 10 chars)</label>
                <Textarea value={remarks} onChange={e => setRemarks(e.target.value)}
                  placeholder={action === "approve" ? "Confirm what was validated..." : "Reason for rejection..."} rows={3} className="mt-1 resize-none" />
              </div>
            )}
          </div>
          <div className="flex gap-2 pt-1">
            <Button variant="outline" className="flex-1" onClick={onClose}>Cancel</Button>
            <Button className="flex-1"
              disabled={!action || remarks.trim().length < 10 || mutation.isPending || (role === "wfm" && action === "approve" && (!differential || parseFloat(differential) <= 0))}
              onClick={() => mutation.mutate()}>
              {mutation.isPending ? "Submitting…" : "Submit"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Review Queue Tab (WFM / Payroll Head) ────────────────────────────────────

function ReviewQueueTab() {
  const { roleKeys } = useWorkforceAccess();
  const isPayrollHead = roleKeys.includes("payroll_head") || roleKeys.includes("super_admin") || roleKeys.includes("admin");
  const [reviewing, setReviewing] = useState<any | null>(null);

  const endpoint = isPayrollHead ? "/api/salary-disputes/queue/payroll-head" : "/api/salary-disputes/queue/wfm";
  const { data: raw, isLoading } = useQuery({
    queryKey: ["salary-dispute-queue", isPayrollHead ? "ph" : "wfm"],
    queryFn: () => hrmsApi.get(endpoint),
    staleTime: 30_000, refetchInterval: 60_000,
  });
  const disputes = unwrap<any[]>(raw) ?? [];

  const now = new Date();
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const lastMonth = (() => { const d = new Date(now); d.setMonth(d.getMonth() - 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; })();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">
          {isPayrollHead ? "Final approval — Payroll Head" : "Validate & enter corrective data — WFM"}
        </p>
        <Badge variant="outline" className="text-xs">{disputes.length} pending</Badge>
      </div>
      {!isLoading && (
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-2xl border bg-white/95 shadow-sm p-3 flex flex-col items-center">
            <p className="text-2xl font-bold text-slate-800">{disputes.length}</p>
            <p className="text-[11px] text-slate-500 mt-0.5 font-medium">Total Pending</p>
          </div>
          <div className="rounded-2xl border bg-white/95 shadow-sm p-3 flex flex-col items-center">
            <p className="text-2xl font-bold text-blue-700">{disputes.filter(d => d.run_month === thisMonth).length}</p>
            <p className="text-[11px] text-slate-500 mt-0.5 font-medium">This Month</p>
          </div>
          <div className="rounded-2xl border bg-white/95 shadow-sm p-3 flex flex-col items-center">
            <p className="text-2xl font-bold text-slate-500">{disputes.filter(d => d.run_month === lastMonth).length}</p>
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
              <Card key={d.id} className="rounded-2xl border border-white/60 bg-white/95 shadow-sm hover:shadow-md transition-shadow cursor-pointer" onClick={() => setReviewing(d)}>
                <CardContent className="p-4 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-semibold text-slate-800">{d.employee_code} — {d.employee_name}</p>
                      <Badge className={`text-[10px] font-bold border flex items-center gap-1 ${typeBadge.color}`}>{typeBadge.icon}{d.dispute_type.replace(/_/g, " ")}</Badge>
                      {d.sla_breached === 1 && <Badge className="text-[10px] font-bold border bg-red-100 text-red-700 border-red-200 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> SLA Breached</Badge>}
                      {d.original_dispute_id && <Badge className="text-[10px] font-bold border bg-purple-100 text-purple-700 border-purple-200">Appeal</Badge>}
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5">Month: {d.run_month}</p>
                    <p className="text-xs text-slate-500 mt-0.5 line-clamp-1">{d.description}</p>
                    {isPayrollHead && d.differential_amount && <p className="text-xs font-bold text-emerald-700 mt-1">Differential: +₹{Number(d.differential_amount).toLocaleString("en-IN")}</p>}
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
      {reviewing && <ReviewDialog dispute={reviewing} role={isPayrollHead ? "payroll_head" : "wfm"} onClose={() => setReviewing(null)} />}
    </div>
  );
}

// ─── Team Disputes Tab (Manager read-only) ────────────────────────────────────

function TeamDisputesTab() {
  const { data: raw, isLoading, dataUpdatedAt } = useQuery({
    queryKey: ["manager-salary-disputes"],
    queryFn: () => hrmsApi.get("/api/salary-disputes/queue/manager"),
    staleTime: 60_000,
  });
  const disputes = unwrap<any[]>(raw) ?? [];
  const lastUpdated = dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">Read-only — for your awareness</p>
        {lastUpdated && <p className="text-xs text-slate-400">Updated {lastUpdated}</p>}
      </div>
      {/* Stats */}
      {!isLoading && (
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Open", value: disputes.filter(d => !["approved","rejected","closed"].includes(d.status)).length, color: "text-amber-700" },
            { label: "Approved", value: disputes.filter(d => d.status === "approved").length, color: "text-emerald-700" },
            { label: "Rejected", value: disputes.filter(d => d.status === "rejected").length, color: "text-red-600" },
          ].map(s => (
            <div key={s.label} className="rounded-2xl border bg-white/95 shadow-sm p-3 flex flex-col items-center">
              <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
              <p className="text-[11px] text-slate-500 mt-0.5 font-medium">{s.label}</p>
            </div>
          ))}
        </div>
      )}
      {isLoading ? (
        <div className="space-y-3">{[1,2].map(i => <div key={i} className="h-20 rounded-2xl bg-slate-100 animate-pulse" />)}</div>
      ) : disputes.length === 0 ? (
        <div className="flex flex-col items-center py-14 text-slate-400">
          <Users className="w-10 h-10 mb-3 opacity-40" />
          <p className="text-sm">No disputes from your team yet.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {disputes.map((d: any) => {
            const cfg = STATUS_CONFIG[d.status as DisputeStatus];
            return (
              <Card key={d.id} className="rounded-2xl border border-white/60 bg-white/95 shadow-sm">
                <CardContent className="p-4 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-800">{d.employee_name} <span className="text-slate-400 font-normal text-xs">({d.employee_code})</span></p>
                    <p className="text-xs text-slate-500 mt-0.5">{d.dispute_type.replace(/_/g, " ")} · {d.run_month}</p>
                    <p className="text-xs text-slate-500 mt-0.5 line-clamp-1">{d.description}</p>
                  </div>
                  <Badge className={`text-[10px] font-bold px-2 py-0.5 rounded-full border shrink-0 flex items-center gap-1 ${cfg.color}`}>
                    {cfg.icon}{cfg.label}
                  </Badge>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Main Hub ─────────────────────────────────────────────────────────────────

export default function SalaryDisputeHub() {
  const { roleKeys } = useWorkforceAccess();
  const [searchParams, setSearchParams] = useSearchParams();

  const isEmployee = roleKeys.includes("employee") || roleKeys.includes("hr") || roleKeys.includes("hr_admin") || roleKeys.includes("admin") || roleKeys.includes("super_admin");
  const isReviewer = roleKeys.some(r => ["wfm","payroll_hr","payroll","payroll_head","super_admin","admin"].includes(r));
  const isManager  = roleKeys.some(r => ["manager","branch_head","process_manager","super_admin","admin"].includes(r));

  const availableTabs = [
    ...(isEmployee ? ["mine"] : []),
    ...(isReviewer ? ["queue"] : []),
    ...(isManager  ? ["team"]  : []),
  ];

  const tabFromUrl = searchParams.get("tab");
  const activeTab = (tabFromUrl && availableTabs.includes(tabFromUrl)) ? tabFromUrl : (availableTabs[0] ?? "mine");

  const handleTabChange = (val: string) => {
    setSearchParams(prev => { const n = new URLSearchParams(prev); n.set("tab", val); return n; }, { replace: true });
  };

  return (
    <DashboardLayout>
      <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-5">
        {/* Header */}
        <div className="rounded-2xl bg-gradient-to-r from-red-600 via-rose-600 to-pink-600 p-5 text-white">
          <h1 className="text-xl font-bold flex items-center gap-2">
            <AlertCircle className="w-5 h-5" />
            Salary Disputes
          </h1>
          <p className="text-red-100 text-sm mt-0.5">Raise, review, and resolve salary discrepancies</p>
        </div>

        <Tabs value={activeTab} onValueChange={handleTabChange}>
          <TabsList className="rounded-xl">
            {isEmployee && (
              <TabsTrigger value="mine" className="gap-1.5 text-xs sm:text-sm">
                <FileText className="w-3.5 h-3.5" />My Disputes
              </TabsTrigger>
            )}
            {isReviewer && (
              <TabsTrigger value="queue" className="gap-1.5 text-xs sm:text-sm">
                <Clock className="w-3.5 h-3.5" />Review Queue
              </TabsTrigger>
            )}
            {isManager && (
              <TabsTrigger value="team" className="gap-1.5 text-xs sm:text-sm">
                <Users className="w-3.5 h-3.5" />Team Disputes
              </TabsTrigger>
            )}
          </TabsList>

          {isEmployee && <TabsContent value="mine" className="mt-4"><MyDisputesTab /></TabsContent>}
          {isReviewer && <TabsContent value="queue" className="mt-4"><ReviewQueueTab /></TabsContent>}
          {isManager  && <TabsContent value="team"  className="mt-4"><TeamDisputesTab /></TabsContent>}
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
