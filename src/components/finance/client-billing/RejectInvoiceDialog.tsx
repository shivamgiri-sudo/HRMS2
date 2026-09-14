// src/components/finance/client-billing/RejectInvoiceDialog.tsx
import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { rejectInvoice } from "@/lib/clientBillingApi";

interface Props {
  invoiceId: string | null;
  label: string;
  onOpenChange: (open: boolean) => void;
  onRejected: () => void;
}

/** `rejectInvoice(id, reason)` requires a non-empty reason (client-billing.routes.ts's
 *  `POST /invoices/:id/reject` 400s without one) — this dialog is the reason capture UI. */
export function RejectInvoiceDialog({ invoiceId, label, onOpenChange, onRejected }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (!invoiceId) setReason("");
  }, [invoiceId]);

  const rejectMutation = useMutation({
    mutationFn: () => rejectInvoice(invoiceId as string, reason.trim()),
    onSuccess: () => {
      toast({ title: "Proforma rejected" });
      void queryClient.invalidateQueries({ queryKey: ["client-billing", "proformas"] });
      onRejected();
      onOpenChange(false);
    },
    onError: (error: Error) => {
      toast({ title: "Could not reject", description: error.message, variant: "destructive" });
    },
  });

  return (
    <Dialog open={Boolean(invoiceId)} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Reject {label}</DialogTitle>
          <DialogDescription>
            A reason is required and is recorded on the invoice&rsquo;s audit log.
          </DialogDescription>
        </DialogHeader>
        <div>
          <Label className="text-xs">Reason *</Label>
          <Textarea
            className="mt-1 min-h-[96px] text-sm"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why is this proforma being rejected?"
            autoFocus
          />
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant="destructive"
            disabled={!reason.trim() || rejectMutation.isPending}
            onClick={() => rejectMutation.mutate()}
          >
            {rejectMutation.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            Reject
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
