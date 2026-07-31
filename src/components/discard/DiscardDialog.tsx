import { useEffect, useState } from "react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  AlertTriangle, ArrowRight, Ban, Info, Lock, RotateCcw, Trash2,
} from "lucide-react";
import {
  useDiscardPreview, useDiscardRecord,
  type DiscardEntityType, type RestoreMode,
} from "@/hooks/useDiscard";

const MIN_REASON = 10;

const ENTITY_LABEL: Record<DiscardEntityType, string> = {
  leave: "leave",
  regularization: "regularization",
  dispute: "dispute",
};

/**
 * What each restore mode means, in the reviewer's language. The amber ones are
 * the honest cases: the original values were never recorded, so the day is
 * rebuilt rather than restored, and saying so is the point.
 */
const MODE_META: Record<RestoreMode, { label: string; tone: string; hint: string }> = {
  snapshot: {
    label: "Exact restore",
    tone: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
    hint: "The full attendance row from before the approval is restored.",
  },
  delete: {
    label: "Row removed",
    tone: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
    hint: "No attendance record existed before the approval, so the one it created is removed.",
  },
  partial: {
    label: "Partial",
    tone: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300",
    hint: "Only status and LWP were recorded before this approval. Those are restored first, then the attendance engine recomputes the day from source data — so the final status may differ from the value shown.",
  },
  rederive: {
    label: "Recomputed",
    tone: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300",
    hint: "No pre-approval state was recorded. The attendance engine recomputes this day from biometric/dialler data, so it may differ from the original.",
  },
  skip_locked: {
    label: "Skipped — locked",
    tone: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
    hint: "Another correction owns this row. It is left untouched.",
  },
  skip_owned: {
    label: "Skipped",
    tone: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
    hint: "This day has changed since the approval. It is left untouched.",
  },
};

interface DiscardDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entityType: DiscardEntityType;
  entityId: string | null;
  /** Called after a successful discard, for pages that refetch imperatively. */
  onDiscarded?: () => void;
}

export function DiscardDialog({
  open, onOpenChange, entityType, entityId, onDiscarded,
}: DiscardDialogProps) {
  const { toast } = useToast();
  const [reason, setReason] = useState("");
  const preview = useDiscardPreview(open ? entityType : null, open ? entityId : null);
  const discard = useDiscardRecord();

  useEffect(() => { if (open) setReason(""); }, [open, entityId]);

  const data = preview.data;
  const blocked = (data?.blockers?.length ?? 0) > 0;
  const reasonOk = reason.trim().length >= MIN_REASON;
  const canSubmit = Boolean(data) && !blocked && reasonOk && !discard.isPending;
  const label = ENTITY_LABEL[entityType];

  async function handleConfirm() {
    if (!entityId || !canSubmit) return;
    try {
      const result = await discard.mutateAsync({ entityType, id: entityId, reason: reason.trim() });
      toast({
        title: `Approved ${label} discarded`,
        description: result.daysRestored
          ? `${result.daysRestored} day(s) credited back. ${result.datesRestored + result.datesDeleted} attendance date(s) reverted.`
          : `${result.datesRestored + result.datesDeleted} attendance date(s) reverted.`,
      });
      if (result.warnings.length) {
        toast({
          title: "Completed with warnings",
          description: result.warnings.join(" "),
          variant: "destructive",
        });
      }
      onOpenChange(false);
      onDiscarded?.();
    } catch (err: any) {
      toast({
        title: "Discard failed",
        description: err?.message ?? "Unable to discard this record.",
        variant: "destructive",
      });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RotateCcw className="h-5 w-5 text-destructive" />
            Discard approved {label}
          </DialogTitle>
          <DialogDescription>
            This reverses an approval that has already taken effect. Review exactly what
            changes below — a discard cannot be undone.
          </DialogDescription>
        </DialogHeader>

        {preview.isLoading && (
          <div className="space-y-3">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        )}

        {preview.isError && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            Could not load the discard preview: {(preview.error as any)?.message ?? "unknown error"}
          </div>
        )}

        {data && (
          <div className="space-y-4">
            <div className="rounded-md border p-3 text-sm">
              <div className="font-medium">
                {data.employeeName ?? "Employee"}{" "}
                {data.employeeCode && (
                  <span className="text-muted-foreground">({data.employeeCode})</span>
                )}
              </div>
              <div className="text-muted-foreground">
                Current status: <span className="font-mono">{data.currentStatus}</span>
                <ArrowRight className="inline h-3 w-3 mx-1" />
                <span className="font-mono">{data.targetStatus}</span>
              </div>
            </div>

            {/* Blockers — the discard cannot proceed at all. */}
            {blocked && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 space-y-2">
                <div className="flex items-center gap-2 text-sm font-medium text-destructive">
                  <Ban className="h-4 w-4" /> This {label} cannot be discarded
                </div>
                <ul className="text-sm text-destructive space-y-1 list-disc pl-5">
                  {data.blockers.map((b) => <li key={b.code}>{b.message}</li>)}
                </ul>
              </div>
            )}

            {/* Leave balance */}
            {data.leave && (
              <div className="rounded-md border p-3">
                <div className="text-sm font-medium mb-2">Leave balance</div>
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-muted-foreground">
                    {data.leave.leaveTypeName ?? "Leave"} {data.leave.balanceYear}
                  </span>
                  <span className="font-mono">{data.leave.balanceBefore ?? "—"}</span>
                  <ArrowRight className="h-3 w-3" />
                  <span className="font-mono font-semibold text-emerald-600 dark:text-emerald-400">
                    {data.leave.balanceAfter ?? "—"}
                  </span>
                  <Badge variant="secondary">+{data.leave.daysToRestore} day(s)</Badge>
                </div>
                {!data.leave.ledgerRowExists && (
                  <div className="mt-2 text-xs text-amber-700 dark:text-amber-400">
                    No balance record exists for this leave type and year, so nothing can be credited back.
                  </div>
                )}
              </div>
            )}

            {/* Attendance, per date */}
            {data.attendance.length > 0 && (
              <div className="rounded-md border p-3">
                <div className="text-sm font-medium mb-2">
                  Attendance ({data.attendance.length} date{data.attendance.length === 1 ? "" : "s"})
                </div>
                <div className="space-y-1.5 max-h-56 overflow-y-auto">
                  {data.attendance.map((row) => {
                    const meta = MODE_META[row.mode];
                    return (
                      <div key={row.date} className="flex items-center gap-2 text-sm flex-wrap">
                        <span className="font-mono text-xs w-24 shrink-0">{row.date}</span>
                        <span className="font-mono text-xs text-muted-foreground">
                          {row.currentStatus ?? "—"}
                        </span>
                        <ArrowRight className="h-3 w-3 shrink-0" />
                        <span className="font-mono text-xs">
                          {row.mode === "delete"
                            ? "(row removed)"
                            : row.restoredStatus ?? "(recomputed)"}
                        </span>
                        <span
                          className={`text-[10px] px-1.5 py-0.5 rounded ${meta.tone}`}
                          title={meta.hint}
                        >
                          {meta.label}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Payroll */}
            {data.payroll.length > 0 && (
              <div className="rounded-md border p-3">
                <div className="text-sm font-medium mb-2 flex items-center gap-2">
                  <Lock className="h-3.5 w-3.5" /> Payroll
                </div>
                {data.payroll.map((p) => (
                  <div key={p.month} className="text-sm flex items-center gap-2">
                    <span className="font-mono text-xs">{p.month}</span>
                    <span className="text-muted-foreground text-xs">{p.runStatus ?? "no run"}</span>
                    {p.isClosed && (
                      <Badge variant="destructive" className="text-[10px]">closed</Badge>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* What cannot be recovered */}
            {data.unrecoverableFields.length > 0 && (
              <div className="rounded-md border border-amber-500/40 bg-amber-50 dark:bg-amber-950/30 p-3">
                <div className="flex items-center gap-2 text-sm font-medium text-amber-900 dark:text-amber-300">
                  <AlertTriangle className="h-4 w-4" /> Partial restore
                </div>
                <p className="text-xs text-amber-900/80 dark:text-amber-300/80 mt-1">
                  This approval predates pre-state snapshots, so these fields were never
                  recorded and will be rebuilt from source data rather than restored:{" "}
                  <span className="font-mono">{data.unrecoverableFields.join(", ")}</span>
                </p>
              </div>
            )}

            {data.warnings.length > 0 && (
              <div className="rounded-md border border-amber-500/40 bg-amber-50 dark:bg-amber-950/30 p-3">
                <div className="flex items-center gap-2 text-sm font-medium text-amber-900 dark:text-amber-300">
                  <Info className="h-4 w-4" /> Please note
                </div>
                <ul className="text-xs text-amber-900/80 dark:text-amber-300/80 mt-1 space-y-1 list-disc pl-5">
                  {data.warnings.map((w, i) => <li key={i}>{w}</li>)}
                </ul>
              </div>
            )}

            {/* Reason */}
            <div className="space-y-1.5">
              <Label htmlFor="discard-reason">
                Reason <span className="text-destructive">*</span>
              </Label>
              <Textarea
                id="discard-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Why is this approval being reversed? This is the permanent record."
                rows={3}
                disabled={blocked}
              />
              <p className="text-xs text-muted-foreground">
                {reason.trim().length < MIN_REASON
                  ? `At least ${MIN_REASON} characters (${reason.trim().length}/${MIN_REASON}).`
                  : "Recorded in the audit trail against your name."}
              </p>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={discard.isPending}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={handleConfirm} disabled={!canSubmit}>
            <Trash2 className="h-4 w-4 mr-1.5" />
            {discard.isPending ? "Discarding…" : `Discard ${label}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default DiscardDialog;
