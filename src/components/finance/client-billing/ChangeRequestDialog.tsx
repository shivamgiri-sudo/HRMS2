// src/components/finance/client-billing/ChangeRequestDialog.tsx
import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  createChangeRequest,
  type ChangeRequestType,
} from "@/lib/clientBillingApi";
import { BILLING_CATEGORY_OPTIONS } from "./billingFieldOptions";
import { DIALOG_60VW_CLASS } from "./shared";

export interface ChangeRequestTarget {
  id: string;
  label: string;
  category: string;
  requestType: ChangeRequestType;
}

interface Props {
  target: ChangeRequestTarget | null;
  onOpenChange: (open: boolean) => void;
}

const REQUEST_TYPE_OPTIONS = [
  { value: "void", label: "Void / delete this invoice" },
  { value: "status_change", label: "Change invoice type (category)" },
];

/**
 * Raises a maker-checker change request on an invoice: void (cancel it and give PO/provision
 * balances back) or an invoice-type change. Nothing changes until a DIFFERENT user approves
 * the request from the Requests tab.
 */
export function ChangeRequestDialog({ target, onOpenChange }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [requestType, setRequestType] = useState<ChangeRequestType>("void");
  const [requestedValue, setRequestedValue] = useState("");
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (target) {
      setRequestType(target.requestType);
      setRequestedValue("");
      setReason("");
    }
  }, [target]);

  const mutation = useMutation({
    mutationFn: () =>
      createChangeRequest(target!.id, {
        requestType,
        reason: reason.trim(),
        requestedValue:
          requestType === "status_change" ? requestedValue : undefined,
      }),
    onSuccess: () => {
      toast({
        title: "Request raised",
        description: "Waiting for a second person to approve it.",
      });
      void queryClient.invalidateQueries({ queryKey: ["client-billing"] });
      onOpenChange(false);
    },
    onError: (error: Error) => {
      toast({
        title: "Could not raise the request",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const typeOptions = BILLING_CATEGORY_OPTIONS.filter(
    (c) => c !== target?.category,
  ).map((c) => ({ value: c, label: c }));
  const canSubmit =
    reason.trim().length >= 5 &&
    (requestType === "void" || Boolean(requestedValue));

  return (
    <Dialog open={Boolean(target)} onOpenChange={onOpenChange}>
      <DialogContent className={DIALOG_60VW_CLASS}>
        <DialogHeader>
          <DialogTitle>Request a change — {target?.label}</DialogTitle>
          <DialogDescription>
            An approved invoice is locked. Raise a request; a different approver
            must accept it. Both steps are written to the invoice&rsquo;s audit
            log.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label className="text-xs">Request *</Label>
            <SearchableSelect
              className="mt-1"
              options={REQUEST_TYPE_OPTIONS}
              value={requestType}
              onChange={(v) => setRequestType(v as ChangeRequestType)}
              aria-label="Request type"
            />
          </div>

          {requestType === "status_change" && (
            <div>
              <Label className="text-xs">New invoice type *</Label>
              <SearchableSelect
                className="mt-1"
                options={typeOptions}
                value={requestedValue}
                onChange={setRequestedValue}
                placeholder="Select the correct type"
                searchPlaceholder="Search type…"
                aria-label="New invoice type"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Currently: {target?.category}
              </p>
            </div>
          )}

          {requestType === "void" && (
            <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              On approval the invoice is cancelled and any PO / provision
              balance it used is returned. It cannot be voided while an approved
              credit note or a receipt allocation exists.
            </p>
          )}

          <div>
            <Label className="text-xs">Reason *</Label>
            <Textarea
              className="mt-1 min-h-[96px] text-sm"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why is this change needed? (at least 5 characters)"
            />
          </div>
        </div>

        <DialogFooter className="mt-auto">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={!canSubmit || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending && (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            )}
            Raise request
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
