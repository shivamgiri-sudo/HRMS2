import { Loader2, Undo2 } from "lucide-react";
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

/** Confirm step before calling POST /api/exit/resignation/:id/withdraw. */
export function WithdrawDialog({
  open,
  busy,
  error,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  busy: boolean;
  error: string | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <AlertDialogContent className="w-[calc(100%-2rem)] rounded-2xl">
        <AlertDialogHeader className="text-left">
          <span className="mb-1 flex h-11 w-11 items-center justify-center rounded-full bg-emerald-100 text-emerald-800">
            <Undo2 className="h-5 w-5" aria-hidden />
          </span>
          <AlertDialogTitle className="text-xl text-slate-900">Withdraw your resignation?</AlertDialogTitle>
          <AlertDialogDescription className="text-base leading-relaxed text-slate-600">
            Your exit request will be cancelled and you will continue in your current role. Your manager and HR will be
            informed.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && (
          <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-base text-rose-800">
            {error}
          </p>
        )}
        <AlertDialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:gap-2">
          <AlertDialogCancel disabled={busy} className="mt-0 min-h-[48px] w-full cursor-pointer rounded-xl sm:w-auto">
            Keep my resignation
          </AlertDialogCancel>
          {/* A plain Button, not AlertDialogAction: Action closes the dialog before the request finishes. */}
          <Button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="w-full cursor-pointer bg-emerald-700 text-white transition-colors duration-200 ease-out hover:bg-emerald-800 sm:w-auto"
          >
            {busy && <Loader2 className="animate-spin" aria-hidden />}
            Yes, withdraw it
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
