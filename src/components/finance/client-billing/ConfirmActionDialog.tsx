// src/components/finance/client-billing/ConfirmActionDialog.tsx
/**
 * Confirmation step for irreversible billing actions (bill number generation, Approve PO,
 * approving a void, approving a provision). Keeps itself open while the action runs and shows a
 * failure inline (role="alert") so the message is read inside the dialog, not behind it.
 */
import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { InlineError } from "./shared";

export function ConfirmActionDialog({
  open, title, description, confirmLabel, pending = false, error, destructive = false, onConfirm, onCancel,
}: {
  open: boolean;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  pending?: boolean;
  error?: string | null;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={(o) => { if (!o && !pending) onCancel(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription asChild><div className="text-sm text-muted-foreground">{description}</div></AlertDialogDescription>
        </AlertDialogHeader>
        {error && <InlineError message={error} />}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending} className="cursor-pointer">Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={pending}
            className={`cursor-pointer ${destructive ? "bg-rose-600 hover:bg-rose-700" : ""}`}
            onClick={(e) => { e.preventDefault(); onConfirm(); }}
          >
            {pending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
