import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2, Gavel, Loader2, XCircle } from "lucide-react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { hrmsApi } from "@/lib/hrmsApi";
import { cn } from "@/lib/utils";
import { decide, type DecisionState } from "./rejoinDecisionRules";
import {
  REACTIVATION_QUERY_KEY,
  buildBranchActionBody,
  followUpWarning,
  interpretApiError,
  rejoinDossierKey,
  type BranchAction,
} from "./rejoinActions";
import { fmtDate } from "./rejoinReviewFormat";
import type { Dossier } from "./rejoinTypes";

export interface DecisionBarViewProps {
  state: DecisionState;
  remarks: string;
  acknowledged: boolean;
  pendingAction: BranchAction | null;
  error: string | null;
  onRemarksChange: (value: string) => void;
  onAcknowledgedChange: (value: boolean) => void;
  onApprove: () => void;
  onReject: () => void;
}

/**
 * Presentational half of the decision bar, so its states are testable with static markup.
 * Below `md` it sticks to the bottom of the viewport and is kept compact (it covers content while
 * sticky); from `md` it is an ordinary card. `bottom-0` is enough: the scroll container
 * (#main-content-area, CompactDashboardLayout) already pads its bottom by the fixed mobile nav's
 * height, and a sticky box stops at the scrollport minus that padding, so it lands just above the nav.
 */
export function RejoinDecisionBarView({
  state,
  remarks,
  acknowledged,
  pendingAction,
  error,
  onRemarksChange,
  onAcknowledgedChange,
  onApprove,
  onReject,
}: DecisionBarViewProps) {
  const busy = pendingAction !== null;
  const len = remarks.trim().length;
  const reasons = Array.from(new Set([state.approveReason, state.rejectReason].filter((r): r is string => !!r)));

  return (
    <Card
      role="region"
      aria-labelledby="rejoin-decision-title"
      className={cn(
        "max-md:sticky max-md:bottom-0 max-md:z-20 max-md:-mx-4 max-md:rounded-none max-md:border-x-0 max-md:shadow-[0_-4px_12px_rgba(0,0,0,0.12)]",
      )}
    >
      <CardContent className="space-y-2 p-3 sm:p-5 md:space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h2 id="rejoin-decision-title" className="flex items-center gap-2 text-sm font-semibold">
            <Gavel className="h-4 w-4 text-muted-foreground" aria-hidden />
            Your decision
          </h2>
          <p className="hidden text-[11px] text-muted-foreground md:block">Approval is final and makes the employee active again.</p>
        </div>

        <div className="space-y-1">
          <div className="flex items-baseline justify-between gap-2">
            <Label htmlFor="rejoin-remarks" className="text-xs">
              Remarks <span aria-hidden className="text-red-600">*</span>
            </Label>
            <p id="rejoin-remarks-count" className="text-[11px] tabular-nums text-muted-foreground" aria-live="polite">
              {len}/{state.approveMinRemarks} min{state.needsAck ? " to approve" : ""}
            </p>
          </div>
          <Textarea
            id="rejoin-remarks"
            value={remarks}
            onChange={(e) => onRemarksChange(e.target.value)}
            rows={2}
            disabled={busy}
            aria-describedby="rejoin-remarks-count"
            placeholder="Why approve or reject? This goes on the employee's file."
            className="min-h-[56px] text-sm md:min-h-[80px]"
          />
        </div>

        {state.needsAck && (
          <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs md:px-3 md:py-2 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
            <Checkbox
              id="absconding-ack"
              checked={acknowledged}
              onCheckedChange={(v) => onAcknowledgedChange(v === true)}
              disabled={busy}
              className="mt-0.5"
            />
            <Label htmlFor="absconding-ack" className="text-xs font-normal leading-snug">
              I know this employee absconded and still want them back; my remarks explain why (20+ characters).
            </Label>
          </div>
        )}

        {error && (
          <p role="alert" className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
            <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <span className="min-w-0 break-words">{error}</span>
          </p>
        )}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 text-[11px] text-muted-foreground" aria-live="polite">
            {reasons.map((r) => (
              <p key={r}>{r}</p>
            ))}
          </div>
          <div className="flex shrink-0 gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="flex-1 border-red-300 text-red-700 hover:bg-red-50 hover:text-red-800 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950/40 sm:flex-none"
              disabled={busy || !state.canReject}
              onClick={onReject}
            >
              {pendingAction === "rejected" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <XCircle className="h-4 w-4" aria-hidden />}
              {pendingAction === "rejected" ? "Rejecting…" : "Reject"}
            </Button>
            <Button
              type="button"
              size="sm"
              className="flex-1 bg-emerald-700 text-white hover:bg-emerald-800 sm:flex-none"
              disabled={busy || !state.canApprove}
              onClick={onApprove}
            >
              {pendingAction === "approved" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <CheckCircle2 className="h-4 w-4" aria-hidden />}
              {pendingAction === "approved" ? "Approving…" : "Approve"}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

interface BranchActionResponse {
  success?: boolean;
  message?: string;
  followUps?: unknown;
}

/**
 * The branch head's Approve / Reject. Render it only for users holding `branch_head`
 * (POST /branch-action is requireRole("branch_head")). The removed HR step (/hr-action) is never called.
 */
export function RejoinDecisionBar({ dossier, onRefetch }: { dossier: Dossier; onRefetch: () => void }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [remarks, setRemarks] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requestId = dossier.request.id;
  const state = decide({ requestStatus: dossier.request.status, eligibility: dossier.eligibility, remarks, abscondingAcknowledged: acknowledged });
  const name = dossier.sections.header.status === "ok" && dossier.sections.header.data ? dossier.sections.header.data.name : "this employee";

  const mutation = useMutation({
    mutationFn: (action: BranchAction) =>
      hrmsApi.post<BranchActionResponse>(
        `/api/employees/reactivation/${encodeURIComponent(requestId)}/branch-action`,
        buildBranchActionBody(action, remarks, { needsAck: state.needsAck, acknowledged }),
      ),
    onSuccess: (res, action) => {
      setError(null);
      toast.success(res?.message ?? (action === "approved" ? "Rejoin approved; employee is active again" : "Rejoin request rejected"));
      const warning = action === "approved" ? followUpWarning(res?.followUps) : null;
      if (warning) toast.warning(warning, { duration: 20000 });
      void queryClient.invalidateQueries({ queryKey: rejoinDossierKey(requestId) });
      void queryClient.invalidateQueries({ queryKey: REACTIVATION_QUERY_KEY });
      navigate("/employees/reactivation");
    },
    onError: (err) => {
      const view = interpretApiError(err);
      setError(view.message);
      toast.error(view.message);
      if (view.refetchDossier) onRefetch();
    },
  });

  const pendingAction = mutation.isPending ? (mutation.variables ?? null) : null;

  return (
    <>
      <RejoinDecisionBarView
        state={state}
        remarks={remarks}
        acknowledged={acknowledged}
        pendingAction={pendingAction}
        error={error}
        onRemarksChange={(v) => {
          setRemarks(v);
          if (error) setError(null);
        }}
        onAcknowledgedChange={setAcknowledged}
        onApprove={() => setConfirmOpen(true)}
        onReject={() => mutation.mutate("rejected")}
      />
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Approve the rejoin of {name}?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>
                  This is final: {name} becomes active again from {fmtDate(dossier.request.proposedJoiningDate)}. There is no
                  further HR step.
                </p>
                {state.needsAck && <p>You are confirming that you know this employee absconded.</p>}
                <p>The server re-checks eligibility now; if anything changed, it will refuse and tell you why.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button
              type="button"
              className="bg-emerald-700 text-white hover:bg-emerald-800"
              disabled={mutation.isPending || !state.canApprove}
              onClick={() => {
                setConfirmOpen(false);
                mutation.mutate("approved");
              }}
            >
              Approve rejoin
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
