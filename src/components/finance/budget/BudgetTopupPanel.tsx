// src/components/finance/budget/BudgetTopupPanel.tsx
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, PlusCircle, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { hrmsApi } from "@/lib/hrmsApi";
import { toast } from "sonner";

type BudgetTopupRequest = {
  id: string;
  budget_line_id: string;
  status: "submitted" | "branch_head_approved" | "finance_head_approved" | "rejected" | "applied";
  requested_amount: number;
  requested_quantity: number;
  reason: string;
  head: string;
  sub_head: string | null;
  item_name: string;
  budget_number: string;
  branch_name: string | null;
  branch_head_reviewed_by: string | null;
  finance_head_reviewed_by: string | null;
  rejection_reason: string | null;
  created_at: string;
  requested_by: string | null;
};

/** A row from GET /pnl/budget-lines/available. The headroom column is `available_gross_amount`
 *  — that is the alias branchBudgetService.availableLines() gives it. Reading it as
 *  `available_amount` (the name vendor-expense-mapping.service.ts uses for its own, unrelated
 *  aggregate) is not a type error on an untyped JSON row: it just printed "available ₹0.00"
 *  against every line, so a fully funded budget looked like an empty one. */
type AvailableLine = {
  id: string;
  head: string;
  sub_head: string | null;
  item_name: string;
  unit_rate: number;
  available_quantity: number;
  available_gross_amount: number;
};

function money(value: unknown) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(Number(value ?? 0));
}

function statusLabel(status: string) {
  return status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * "Request a budget increase" queue + create dialog. A blocked GRN's error toast can deep-link
 * here with a pre-selected budgetLineId; the queue itself lists every request for the current
 * branch so branch_head/finance_head can act on it in the same place they already review budgets.
 */
export function BudgetTopupPanel({
  branchId,
  period,
  canCreate,
  canReviewBranchStage,
  canReviewFinanceStage,
  presetLineId,
  onConsumedPreset,
  currentUserId,
}: {
  branchId: string;
  period: string;
  canCreate: boolean;
  /** Review authority is per-stage, not one flag. The backend derives the reviewer role from
   *  the row's own status (resolveFinanceStageRole, workflow "grn"), so a single canReview
   *  boolean offered a finance_head an Approve button on a 'submitted' row that could only
   *  ever come back "The current grn stage requires the branch_head role". Same shape as
   *  canReview() for budgets in BranchBudgetManagementWorkspace. */
  canReviewBranchStage: boolean;
  canReviewFinanceStage: boolean;
  presetLineId?: string | null;
  onConsumedPreset?: () => void;
  /** Current user's ID — used to disable the Approve button when the viewer is the submitter
   *  (maker-checker enforcement mirrors the backend check in budget-topup.service.ts). */
  currentUserId?: string | null;
}) {
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(Boolean(presetLineId));
  const [selectedLineId, setSelectedLineId] = useState(presetLineId ?? "");
  const [requestedAmount, setRequestedAmount] = useState("");
  const [reason, setReason] = useState("");
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});

  const listQuery = useQuery({
    // period is part of the key AND the request. It was omitted from both, so the panel showed
    // every top-up request the branch had ever raised while the rest of the workspace was scoped
    // to one month — the tab silently disagreed with the period shown above it. The endpoint has
    // always accepted a period filter (process-pnl.routes.ts /pnl/budget-topups); only the client
    // failed to send it.
    queryKey: ["budget-topups", branchId, period],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (branchId) params.set("branchId", branchId);
      if (period) params.set("period", period);
      const response = await hrmsApi.get<{ success: boolean; data: BudgetTopupRequest[] }>(
        `/api/finance/pnl/budget-topups?${params}`
      );
      return response.data ?? [];
    },
    enabled: Boolean(branchId),
  });
  const requests = listQuery.data ?? [];

  const linesQuery = useQuery({
    queryKey: ["budget-lines-available-for-topup", branchId, period],
    queryFn: async () => {
      const response = await hrmsApi.get<{ success: boolean; data: AvailableLine[] }>(
        `/api/finance/pnl/budget-lines/available?branchId=${branchId}&period=${period}`
      );
      return response.data ?? [];
    },
    enabled: createOpen && Boolean(branchId),
  });
  const lines = linesQuery.data ?? [];

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!selectedLineId) throw new Error("Pick a budget line");
      const amount = Number(requestedAmount);
      if (!Number.isFinite(amount) || amount <= 0) throw new Error("Enter a valid amount");
      const line = lines.find((l) => l.id === selectedLineId);
      // A quantity of 0 is not a safe fallback. The applied top-up raises the line's rupee
      // ceiling but not its unit ceiling, and a GRN is blocked by whichever runs out first
      // (available_quantity as well as available_gross_amount) — so the request would be
      // approved and the GRN that prompted it would still be blocked, with nothing on screen
      // explaining why. This happens when the deep-linked preset line is not in `lines`, which
      // is exactly the case a blocked GRN produces: availableLines() filters on
      // available_quantity > 0, so the line that just ran out is excluded from the picker.
      if (!line) {
        throw new Error(
          "Select a budget line from the list. The line this request came from is no longer "
            + "offered because it has no headroom left at all — pick the line you need increased."
        );
      }
      if (!(line.unit_rate > 0)) {
        throw new Error("This budget line has no unit rate, so an increase cannot be sized in units.");
      }
      const requestedQuantity = amount / line.unit_rate;
      return hrmsApi.post("/api/finance/pnl/budget-topups", {
        budgetLineId: selectedLineId,
        requestedAmount: amount,
        requestedQuantity,
        reason,
      });
    },
    onSuccess: () => {
      toast.success("Top-up request submitted for branch_head review");
      setCreateOpen(false);
      setSelectedLineId("");
      setRequestedAmount("");
      setReason("");
      onConsumedPreset?.();
      queryClient.invalidateQueries({ queryKey: ["budget-topups"] });
    },
    onError: (error: Error) => toast.error(error.message || "Failed to submit top-up request"),
  });

  const reviewMutation = useMutation({
    mutationFn: async ({ id, decision }: { id: string; decision: "approve" | "reject" }) => {
      return hrmsApi.post(`/api/finance/pnl/budget-topups/${id}/review`, {
        decision,
        remarks: reviewNotes[id]?.trim() || undefined,
      });
    },
    onSuccess: (_data, variables) => {
      toast.success(variables.decision === "approve" ? "Top-up advanced" : "Top-up rejected");
      queryClient.invalidateQueries({ queryKey: ["budget-topups"] });
      // A finance_head approval does not just move a status: it runs
      // UPDATE finance_budget_line SET gross_amount = gross_amount + ?, quantity = quantity + ?
      // (budget-topup.service.ts). Every cached view of that line is now wrong — including the
      // GRN form's own headroom, which is what the raiser came here to unblock. Invalidating
      // only the queue and the budget detail left them still reading the pre-top-up ceiling
      // until a hard refresh, so the GRN stayed blocked by a number that had already changed.
      queryClient.invalidateQueries({ queryKey: ["branch-budget-detail"] });
      queryClient.invalidateQueries({ queryKey: ["branch-budgets"] });
      queryClient.invalidateQueries({ queryKey: ["budget-lines-available-for-topup"] });
      queryClient.invalidateQueries({ queryKey: ["available-budget-lines"] });
    },
    onError: (error: Error) => toast.error(error.message || "Review failed"),
  });

  const canReviewRow = (request: BudgetTopupRequest) =>
    (request.status === "submitted" && canReviewBranchStage) ||
    (request.status === "branch_head_approved" && canReviewFinanceStage);

  /** Maker-checker: budget-topup.service.ts review() refuses BOTH decisions when the actor is the
   *  submitter, and it does so before the decision is even inspected. Only Approve was disabled
   *  here, so Reject stayed live on a request it could never act on — and because that refusal
   *  used to throw without a statusCode, pressing it returned an anonymous "quote reference …"
   *  500 instead of the reason. Both buttons now reflect the one rule the backend enforces. */
  const isOwnRequest = (request: BudgetTopupRequest) =>
    Boolean(currentUserId && request.requested_by && currentUserId === request.requested_by);

  const MAKER_CHECKER_HINT = "You submitted this request — a different reviewer must approve or reject it";

  return (
    <Card className="rounded-3xl border-slate-200 shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Budget top-up requests</CardTitle>
        {canCreate && (
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <PlusCircle className="mr-1 h-3.5 w-3.5" />Request increase
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {!requests.length && (
          <p className="py-8 text-center text-sm text-slate-500">
            No top-up requests for this branch yet.
          </p>
        )}
        {requests.map((request) => (
          <div key={request.id} className="rounded-2xl border border-slate-200 p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <div className="flex items-center gap-2">
                  <p className="font-semibold">{request.head}{request.sub_head ? ` · ${request.sub_head}` : ""}</p>
                  <Badge variant="outline">{statusLabel(request.status)}</Badge>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  {request.item_name} · {request.budget_number} · requested {money(request.requested_amount)}
                </p>
                <p className="mt-1 text-xs text-slate-600">{request.reason}</p>
                {request.status === "rejected" && request.rejection_reason && (
                  <p className="mt-1 text-xs text-rose-600">Rejected: {request.rejection_reason}</p>
                )}
              </div>
              {canReviewRow(request) && (
                <div className="flex flex-col items-end gap-2">
                  <Input
                    placeholder="Remarks (required to reject)"
                    className="h-8 w-56 text-xs"
                    disabled={isOwnRequest(request)}
                    value={reviewNotes[request.id] ?? ""}
                    onChange={(event) => setReviewNotes((prev) => ({ ...prev, [request.id]: event.target.value }))}
                  />
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      // P0P1-4: prevent self-approval — mirror backend maker-checker.
                      disabled={reviewMutation.isPending || isOwnRequest(request)}
                      title={isOwnRequest(request) ? MAKER_CHECKER_HINT : undefined}
                      onClick={() => reviewMutation.mutate({ id: request.id, decision: "approve" })}
                    >
                      <CheckCircle2 className="mr-1 h-3.5 w-3.5" />Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={reviewMutation.isPending || isOwnRequest(request)}
                      title={isOwnRequest(request) ? MAKER_CHECKER_HINT : undefined}
                      onClick={() => reviewMutation.mutate({ id: request.id, decision: "reject" })}
                    >
                      <XCircle className="mr-1 h-3.5 w-3.5" />Reject
                    </Button>
                  </div>
                  {/* A disabled button explains itself only on hover, and not at all on touch.
                      Say who the request is actually waiting for, so the raiser chases the right
                      person instead of assuming the screen is broken. */}
                  {isOwnRequest(request) && (
                    <p className="max-w-[15rem] text-right text-xs text-amber-700">
                      You raised this request, so you cannot review it. It is waiting for{" "}
                      {request.status === "submitted" ? "another Branch Head" : "the Finance Head"}.
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
      </CardContent>

      <Dialog open={createOpen} onOpenChange={(open) => { setCreateOpen(open); if (!open) onConsumedPreset?.(); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Request a budget increase</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Budget line *</Label>
              <Select value={selectedLineId} onValueChange={setSelectedLineId} disabled={!linesQuery.isLoading && !lines.length}>
                <SelectTrigger className="mt-1 h-9"><SelectValue placeholder="Select a budget line" /></SelectTrigger>
                <SelectContent>
                  {lines.map((line) => (
                    <SelectItem key={line.id} value={line.id}>
                      {line.head}{line.sub_head ? ` · ${line.sub_head}` : ""} — {line.item_name} (available {money(line.available_gross_amount)})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {/* The old copy asserted one cause ("hasn't reached that stage yet") for what are
                  two quite different situations, and was simply wrong in the second: a fully
                  approved budget whose lines are all consumed to zero also returns nothing here,
                  because availableLines() filters on available_quantity > 0 AND
                  available_gross_amount > 0. Telling someone their budget is unapproved when it
                  is approved and exhausted sends them to the wrong person. */}
              {!linesQuery.isLoading && !lines.length && (
                <p className="mt-1.5 text-xs text-amber-700">
                  No budget line with remaining headroom for {period}. Either this branch's budget for
                  this period has not completed Branch Head, Finance Head and Accounts Head approval,
                  or it is approved and every line is already fully committed. The Approval &amp;
                  Utilization tab shows which of the two it is.
                </p>
              )}
            </div>
            <div>
              <Label className="text-xs">Additional amount needed *</Label>
              <Input
                type="number"
                inputMode="decimal"
                className="mt-1 h-9"
                value={requestedAmount}
                onChange={(event) => setRequestedAmount(event.target.value)}
              />
            </div>
            <div>
              <Label className="text-xs">Reason *</Label>
              <Textarea
                className="mt-1 min-h-[72px]"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Why this head/sub-head needs more than what was approved"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button disabled={createMutation.isPending} onClick={() => createMutation.mutate()}>
              Submit for branch_head review
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
