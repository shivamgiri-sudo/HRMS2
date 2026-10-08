import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import type { LeaveRequest } from "@/hooks/useLeaves";
import { formatLeaveRange } from "./leaveData";

export type ReviewMode = "approve" | "reject";

interface Props {
  request: LeaveRequest | null;
  mode: ReviewMode | null;
  busy: boolean;
  onClose: () => void;
  onConfirm: (remarks: string) => void;
}

/**
 * Approve (remark optional) or reject (remark required — the employee has to be able to see why).
 * Approve is also one click from the list; this dialog is the path for adding a remark.
 */
export function ReviewDialog({ request, mode, busy, onClose, onConfirm }: Props) {
  const [remarks, setRemarks] = useState("");
  useEffect(() => { if (request) setRemarks(""); }, [request, mode]);

  const approving = mode === "approve";
  const canSubmit = !busy && (approving || remarks.trim().length > 0);

  return (
    <Dialog open={!!request && !!mode} onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
      <DialogContent className="rounded-2xl">
        <DialogHeader>
          <DialogTitle>{approving ? "Approve" : "Reject"} leave request</DialogTitle>
          <DialogDescription>
            {approving ? "Add a note for the employee if you like." : "Tell the employee why this request is being rejected."}
          </DialogDescription>
        </DialogHeader>
        {request && (
          <div className="space-y-1 rounded-2xl border border-border bg-muted/40 p-4">
            <p className="font-semibold text-foreground">{request.employee.name}</p>
            <p className="text-sm text-muted-foreground">{request.type} · {request.days} day{Number(request.days) === 1 ? "" : "s"}</p>
            <p className="text-sm text-muted-foreground">{formatLeaveRange(request.startDate, request.endDate)}</p>
            {request.reason && <p className="pt-1 text-sm text-muted-foreground"><span className="font-medium text-foreground">Reason:</span> {request.reason}</p>}
          </div>
        )}
        <div className="space-y-2">
          <label htmlFor="review-remarks" className="text-sm font-medium">
            Remarks {approving ? "(optional)" : <span className="text-red-600" aria-label="required">*</span>}
          </label>
          <Textarea
            id="review-remarks"
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            rows={3}
            maxLength={500}
            className="rounded-xl"
            placeholder={approving ? "Add a note for the employee (optional)." : "Remarks are required to reject."}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" className="rounded-xl" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button
            onClick={() => onConfirm(remarks)}
            disabled={!canSubmit}
            className={approving ? "rounded-xl bg-green-700 text-white hover:bg-green-800" : "rounded-xl bg-red-600 text-white hover:bg-red-700"}
          >
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
            {approving ? "Approve" : "Reject"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
