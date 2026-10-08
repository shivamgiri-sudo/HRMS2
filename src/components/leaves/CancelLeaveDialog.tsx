import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useCancelLeave, type LeaveRequest } from "@/hooks/useLeaves";
import { formatLeaveRange } from "./leaveData";
import { normalizeLeaveStatus } from "./leaveStatus";

interface Props {
  request: LeaveRequest | null;
  onClose: () => void;
}

/** Confirm step for cancelling one's own leave. The server restores the balance. */
export function CancelLeaveDialog({ request, onClose }: Props) {
  const { toast } = useToast();
  const cancel = useCancelLeave();
  const [reason, setReason] = useState("");

  useEffect(() => { if (request) setReason(""); }, [request]);

  const wasApproved = request ? normalizeLeaveStatus(request.status) === "approved" : false;

  const confirm = () => {
    if (!request) return;
    cancel.mutate(
      { id: request.id, reason },
      {
        onSuccess: () => {
          toast({ title: "Leave cancelled", description: wasApproved ? "Your leave days have been returned to your balance." : "Your request has been withdrawn." });
          onClose();
        },
        onError: (err: unknown) =>
          toast({ title: "Could not cancel", description: err instanceof Error ? err.message : "Please try again.", variant: "destructive" }),
      },
    );
  };

  return (
    <Dialog open={!!request} onOpenChange={(open) => { if (!open && !cancel.isPending) onClose(); }}>
      <DialogContent className="rounded-2xl">
        <DialogHeader>
          <DialogTitle>Cancel this leave?</DialogTitle>
          <DialogDescription>
            {request ? `${request.type} · ${formatLeaveRange(request.startDate, request.endDate)} (${request.days} day${Number(request.days) === 1 ? "" : "s"})` : ""}
          </DialogDescription>
        </DialogHeader>
        {wasApproved && (
          <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            This leave is already approved. Cancelling returns the days to your balance and your manager is informed.
          </p>
        )}
        <div className="space-y-2">
          <label htmlFor="cancel-leave-reason" className="text-sm font-medium">Reason (optional)</label>
          <Textarea
            id="cancel-leave-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            maxLength={500}
            placeholder="Why are you cancelling?"
            className="rounded-xl"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" className="rounded-xl" onClick={onClose} disabled={cancel.isPending}>Keep leave</Button>
          <Button onClick={confirm} disabled={cancel.isPending} className="rounded-xl bg-red-600 text-white hover:bg-red-700">
            {cancel.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
            Cancel leave
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
