import { useState } from "react";
import {
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import {
  CheckCircle2,
  Clock,
  RefreshCw,
  ShieldCheck,
  BadgeCheck,
  AlertTriangle,
  XCircle,
  IndianRupee,
} from "lucide-react";
import { toast } from "sonner";

import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { useWorkforceAccess } from "@/hooks/useUserRole";
import { hrmsApi } from "@/lib/hrmsApi";

// ─── Types ────────────────────────────────────────────────────────────────────

interface PendingRun {
  id: string | number;
  run_month: string;
  status: string;
  finance_approved_by: string | null;
  finance_approved_at: string | null;
  finance_remarks: string | null;
  ceo_acknowledged_by: string | null;
  ceo_acknowledged_at: string | null;
  ceo_remarks: string | null;
}

interface SignOffStatus {
  run_id: string;
  run_month: string;
  status: string;
  total_net_salary: number;
  finance_approved_by: string | null;
  finance_approved_at: string | null;
  finance_remarks: string | null;
  ceo_acknowledged_by: string | null;
  ceo_acknowledged_at: string | null;
  ceo_remarks: string | null;
  ceo_required: boolean;
}

type ActionDialog = "finance-approve" | "ceo-acknowledge" | null;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Format amount as ₹X.XXL (lakhs with 2 dp) */
function fmtLakhs(amount: number): string {
  if (!Number.isFinite(amount)) return "₹—";
  const lakhs = amount / 100_000;
  return `₹${lakhs.toFixed(2)}L`;
}

/** Format a datetime string to a readable local string */
function fmtDt(dt: string | null): string {
  if (!dt) return "—";
  return new Date(dt).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ─── Stepper Step Card ────────────────────────────────────────────────────────

type StepState = "done" | "pending" | "skipped" | "waiting";

interface StepCardProps {
  stepNumber: number;
  title: string;
  state: StepState;
  children: React.ReactNode;
}

function StepCard({ stepNumber, title, state, children }: StepCardProps) {
  const iconMap: Record<StepState, React.ReactNode> = {
    done: <CheckCircle2 className="w-5 h-5 text-green-600" />,
    pending: <Clock className="w-5 h-5 text-amber-500" />,
    skipped: <BadgeCheck className="w-5 h-5 text-slate-400" />,
    waiting: <Clock className="w-5 h-5 text-slate-300" />,
  };
  const borderMap: Record<StepState, string> = {
    done: "border-green-200 bg-green-50",
    pending: "border-amber-200 bg-amber-50",
    skipped: "border-slate-200 bg-slate-50",
    waiting: "border-slate-100 bg-white",
  };

  return (
    <div className={`rounded-lg border ${borderMap[state]} p-4`}>
      <div className="flex items-center gap-3 mb-3">
        <div className="flex-shrink-0 w-7 h-7 rounded-full bg-white border border-slate-200 flex items-center justify-center text-xs font-bold text-slate-500">
          {stepNumber}
        </div>
        <span className="font-semibold text-slate-800">{title}</span>
        <div className="ml-auto">{iconMap[state]}</div>
      </div>
      {children}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function PayrollSignOff() {
  const { roleKeys } = useWorkforceAccess();
  const queryClient = useQueryClient();

  const isFinanceRole =
    roleKeys.includes("finance") ||
    roleKeys.includes("payroll_head") ||
    roleKeys.includes("super_admin");
  const isCeoRole =
    roleKeys.includes("ceo") || roleKeys.includes("super_admin");
  const canView =
    isFinanceRole || isCeoRole || roleKeys.includes("payroll") || roleKeys.includes("admin");

  const [selectedRunId, setSelectedRunId] = useState<string>("");
  const [dialog, setDialog] = useState<ActionDialog>(null);
  const [remarks, setRemarks] = useState<string>("");

  // ── Pending runs list ────────────────────────────────────────────────────────
  const {
    data: pendingRuns,
    isLoading: runsLoading,
    refetch: refetchRuns,
  } = useQuery<PendingRun[]>({
    queryKey: ["payroll-signoff-runs"],
    queryFn: async () => {
      const res = await hrmsApi.get<{ success: boolean; data: PendingRun[] }>(
        "/api/payroll/signoff/runs",
      );
      return (res as { success: boolean; data: PendingRun[] }).data ?? [];
    },
    retry: 1,
    staleTime: 30_000,
  });

  // ── Run sign-off status ──────────────────────────────────────────────────────
  const {
    data: status,
    isLoading: statusLoading,
    refetch: refetchStatus,
  } = useQuery<SignOffStatus>({
    queryKey: ["payroll-signoff-status", selectedRunId],
    queryFn: async () => {
      const res = await hrmsApi.get<{ success: boolean; data: SignOffStatus }>(
        `/api/payroll/signoff/runs/${selectedRunId}/status`,
      );
      return (res as { success: boolean; data: SignOffStatus }).data;
    },
    enabled: !!selectedRunId,
    retry: 1,
    staleTime: 20_000,
  });

  // ── Finance approve mutation ─────────────────────────────────────────────────
  const financeApproveMutation = useMutation({
    mutationFn: async (remarkText: string) => {
      const res = await hrmsApi.post<{ success: boolean; data: SignOffStatus }>(
        `/api/payroll/signoff/runs/${selectedRunId}/finance-approve`,
        { remarks: remarkText || undefined },
      );
      return (res as { success: boolean; data: SignOffStatus }).data;
    },
    onSuccess: () => {
      toast.success("Finance approval recorded successfully");
      setDialog(null);
      setRemarks("");
      void queryClient.invalidateQueries({ queryKey: ["payroll-signoff-status", selectedRunId] });
      void queryClient.invalidateQueries({ queryKey: ["payroll-signoff-runs"] });
    },
    onError: (err: Error) => {
      toast.error(err?.message ?? "Finance approval failed");
    },
  });

  // ── CEO acknowledge mutation ─────────────────────────────────────────────────
  const ceoAcknowledgeMutation = useMutation({
    mutationFn: async (remarkText: string) => {
      const res = await hrmsApi.post<{ success: boolean; data: SignOffStatus }>(
        `/api/payroll/signoff/runs/${selectedRunId}/ceo-acknowledge`,
        { remarks: remarkText || undefined },
      );
      return (res as { success: boolean; data: SignOffStatus }).data;
    },
    onSuccess: () => {
      toast.success("CEO acknowledgement recorded successfully");
      setDialog(null);
      setRemarks("");
      void queryClient.invalidateQueries({ queryKey: ["payroll-signoff-status", selectedRunId] });
      void queryClient.invalidateQueries({ queryKey: ["payroll-signoff-runs"] });
    },
    onError: (err: Error) => {
      toast.error(err?.message ?? "CEO acknowledgement failed");
    },
  });

  // ── Handle run selection ─────────────────────────────────────────────────────
  const handleRunChange = (runId: string) => {
    setSelectedRunId(runId);
  };

  // ── Refresh ──────────────────────────────────────────────────────────────────
  const handleRefresh = async () => {
    await refetchRuns();
    if (selectedRunId) await refetchStatus();
  };

  // ── Dialog submit ────────────────────────────────────────────────────────────
  const handleDialogConfirm = () => {
    if (dialog === "finance-approve") {
      financeApproveMutation.mutate(remarks);
    } else if (dialog === "ceo-acknowledge") {
      ceoAcknowledgeMutation.mutate(remarks);
    }
  };

  const dialogPending =
    financeApproveMutation.isPending || ceoAcknowledgeMutation.isPending;

  // ── Derived state ────────────────────────────────────────────────────────────
  const financeApproved = !!status?.finance_approved_at;
  const ceoAcknowledged = !!status?.ceo_acknowledged_at;
  const ceoRequired = status?.ceo_required ?? false;

  const readyForDisbursal =
    financeApproved && (!ceoRequired || ceoAcknowledged);

  // Step states
  const step1State: StepState =
    status?.status === "validated" || status?.status === "calculated"
      ? "done"
      : "waiting";
  const step2State: StepState = financeApproved
    ? "done"
    : !selectedRunId || statusLoading
    ? "waiting"
    : "pending";
  const step3State: StepState = !ceoRequired
    ? "skipped"
    : ceoAcknowledged
    ? "done"
    : "pending";
  const step4State: StepState = readyForDisbursal ? "done" : "waiting";

  if (!canView) {
    return (
      <DashboardLayout>
        <div className="p-8 text-center text-slate-500">
          Access restricted to Finance, Payroll Head or CEO roles.
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6 max-w-3xl mx-auto">
        {/* ── Header ──────────────────────────────────────────────────────────── */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900 flex items-center gap-2">
              <ShieldCheck className="w-6 h-6 text-indigo-600" />
              Payroll Sign-Off
            </h1>
            <p className="text-slate-500 text-sm mt-1">
              Finance and CEO governance approval before disbursement
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={runsLoading}
          >
            <RefreshCw
              className={`w-4 h-4 mr-1.5 ${runsLoading ? "animate-spin" : ""}`}
            />
            Refresh
          </Button>
        </div>

        {/* ── Run selector ────────────────────────────────────────────────────── */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-slate-700 uppercase tracking-wide">
              Select Payroll Run
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
              <Select
                value={selectedRunId}
                onValueChange={handleRunChange}
                disabled={runsLoading}
              >
                <SelectTrigger className="w-full sm:w-72">
                  <SelectValue
                    placeholder={
                      runsLoading ? "Loading runs…" : "Choose a pending run"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {(pendingRuns ?? []).map((run) => (
                    <SelectItem key={String(run.id)} value={String(run.id)}>
                      {run.run_month}{" "}
                      <span className="text-slate-400 text-xs ml-1">
                        ({run.status})
                      </span>
                    </SelectItem>
                  ))}
                  {!runsLoading && (pendingRuns ?? []).length === 0 && (
                    <SelectItem value="__none__" disabled>
                      No runs pending sign-off
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>

              {status && (
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="flex items-center gap-1 text-slate-700 font-semibold text-lg">
                    <IndianRupee className="w-4 h-4 text-slate-500" />
                    <span className="font-mono">
                      {fmtLakhs(status.total_net_salary)}
                    </span>
                    <span className="text-xs font-normal text-slate-400 ml-1">
                      total net
                    </span>
                  </div>
                  {ceoRequired ? (
                    <Badge className="bg-amber-100 text-amber-800 border-amber-200 text-xs">
                      <AlertTriangle className="w-3 h-3 mr-1" />
                      CEO sign-off required
                    </Badge>
                  ) : (
                    <Badge
                      variant="outline"
                      className="text-slate-500 text-xs"
                    >
                      CEO sign-off not required
                    </Badge>
                  )}
                </div>
              )}
            </div>
            <p className="text-xs text-slate-400 mt-2">
              CEO sign-off required for runs with total net salary &ge; ₹50L
            </p>
          </CardContent>
        </Card>

        {/* ── Workflow stepper ────────────────────────────────────────────────── */}
        {selectedRunId && (
          <div className="space-y-3">
            {statusLoading ? (
              <div className="flex items-center gap-2 text-slate-400 text-sm py-4">
                <RefreshCw className="w-4 h-4 animate-spin" />
                Loading sign-off status…
              </div>
            ) : status ? (
              <>
                {/* Step 1 — Payroll Validated */}
                <StepCard
                  stepNumber={1}
                  title="Payroll Validated"
                  state={step1State}
                >
                  <p className="text-sm text-slate-600">
                    Run{" "}
                    <span className="font-medium">{status.run_month}</span> is
                    in status{" "}
                    <span className="font-mono font-medium">
                      {status.status}
                    </span>
                    .
                  </p>
                </StepCard>

                {/* Step 2 — Finance Approval */}
                <StepCard
                  stepNumber={2}
                  title="Finance Approval"
                  state={step2State}
                >
                  {financeApproved ? (
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 text-sm text-green-700 font-medium">
                        <CheckCircle2 className="w-4 h-4" />
                        Approved by{" "}
                        <span className="font-mono text-xs">
                          {status.finance_approved_by}
                        </span>
                        <span className="text-slate-400 font-normal">
                          {fmtDt(status.finance_approved_at)}
                        </span>
                      </div>
                      {status.finance_remarks && (
                        <p className="text-xs text-slate-500 pl-6">
                          {status.finance_remarks}
                        </p>
                      )}
                    </div>
                  ) : (
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 text-sm text-amber-700">
                        <Clock className="w-4 h-4" />
                        Pending finance approval
                      </div>
                      {isFinanceRole && (
                        <Button
                          size="sm"
                          className="bg-indigo-700 hover:bg-indigo-800 text-white"
                          onClick={() => {
                            setRemarks("");
                            setDialog("finance-approve");
                          }}
                        >
                          <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
                          Approve
                        </Button>
                      )}
                    </div>
                  )}
                </StepCard>

                {/* Step 3 — CEO Acknowledgement */}
                <StepCard
                  stepNumber={3}
                  title="CEO Acknowledgement"
                  state={step3State}
                >
                  {!ceoRequired ? (
                    <div className="flex items-center gap-2 text-sm text-slate-500">
                      <XCircle className="w-4 h-4 text-slate-300" />
                      Not required — total net salary is below ₹50L threshold
                    </div>
                  ) : ceoAcknowledged ? (
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 text-sm text-green-700 font-medium">
                        <CheckCircle2 className="w-4 h-4" />
                        Acknowledged by{" "}
                        <span className="font-mono text-xs">
                          {status.ceo_acknowledged_by}
                        </span>
                        <span className="text-slate-400 font-normal">
                          {fmtDt(status.ceo_acknowledged_at)}
                        </span>
                      </div>
                      {status.ceo_remarks && (
                        <p className="text-xs text-slate-500 pl-6">
                          {status.ceo_remarks}
                        </p>
                      )}
                    </div>
                  ) : (
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 text-sm text-amber-700">
                        <Clock className="w-4 h-4" />
                        Pending CEO acknowledgement
                      </div>
                      {isCeoRole && (
                        <Button
                          size="sm"
                          className="bg-purple-700 hover:bg-purple-800 text-white"
                          disabled={!financeApproved}
                          title={
                            !financeApproved
                              ? "Finance must approve first"
                              : undefined
                          }
                          onClick={() => {
                            setRemarks("");
                            setDialog("ceo-acknowledge");
                          }}
                        >
                          <BadgeCheck className="w-3.5 h-3.5 mr-1" />
                          Acknowledge
                        </Button>
                      )}
                    </div>
                  )}
                </StepCard>

                {/* Step 4 — Ready for Disbursement */}
                <StepCard
                  stepNumber={4}
                  title="Ready for Disbursement"
                  state={step4State}
                >
                  {readyForDisbursal ? (
                    <div className="flex items-center gap-2 text-sm text-green-700 font-semibold">
                      <CheckCircle2 className="w-4 h-4" />
                      All required approvals complete — run is cleared for
                      disbursement
                    </div>
                  ) : (
                    <p className="text-sm text-slate-500">
                      Complete the steps above to unlock disbursement.
                    </p>
                  )}
                </StepCard>
              </>
            ) : (
              <div className="text-sm text-slate-400 py-4">
                Failed to load sign-off status.
              </div>
            )}
          </div>
        )}

        {!selectedRunId && !runsLoading && (
          <div className="py-12 text-center text-slate-400 text-sm">
            Select a payroll run above to view and action the sign-off workflow.
          </div>
        )}
      </div>

      {/* ── Action Dialog ──────────────────────────────────────────────────────── */}
      <Dialog
        open={dialog !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDialog(null);
            setRemarks("");
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {dialog === "finance-approve" ? (
                <>
                  <CheckCircle2 className="w-5 h-5 text-indigo-600" />
                  Finance Approval
                </>
              ) : (
                <>
                  <BadgeCheck className="w-5 h-5 text-purple-600" />
                  CEO Acknowledgement
                </>
              )}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {status && (
              <div className="bg-slate-50 rounded-md p-3 text-sm space-y-1">
                <div className="flex justify-between">
                  <span className="text-slate-500">Run month</span>
                  <span className="font-medium">{status.run_month}</span>
                </div>
                <Separator />
                <div className="flex justify-between">
                  <span className="text-slate-500">Total net salary</span>
                  <span className="font-mono font-semibold text-slate-800">
                    {fmtLakhs(status.total_net_salary)}
                  </span>
                </div>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Remarks{" "}
                <span className="text-slate-400 font-normal">(optional)</span>
              </label>
              <Textarea
                placeholder="Add any remarks for the audit record…"
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                rows={3}
                className="resize-none"
              />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setDialog(null);
                setRemarks("");
              }}
              disabled={dialogPending}
            >
              Cancel
            </Button>
            <Button
              onClick={handleDialogConfirm}
              disabled={dialogPending}
              className={
                dialog === "finance-approve"
                  ? "bg-indigo-700 hover:bg-indigo-800 text-white"
                  : "bg-purple-700 hover:bg-purple-800 text-white"
              }
            >
              {dialogPending ? (
                <RefreshCw className="w-4 h-4 animate-spin mr-1.5" />
              ) : dialog === "finance-approve" ? (
                <CheckCircle2 className="w-4 h-4 mr-1.5" />
              ) : (
                <BadgeCheck className="w-4 h-4 mr-1.5" />
              )}
              {dialog === "finance-approve" ? "Confirm Approval" : "Confirm Acknowledgement"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
