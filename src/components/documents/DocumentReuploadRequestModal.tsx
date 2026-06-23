import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (reason: string) => Promise<void>;
};

export function DocumentReuploadRequestModal({ open, onOpenChange, onSubmit }: Props) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      await onSubmit(reason);
      setReason("");
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Request re-upload</DialogTitle></DialogHeader>
        <Textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Reason for re-upload" />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="button" onClick={submit} disabled={busy || !reason.trim()}>Send request</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
