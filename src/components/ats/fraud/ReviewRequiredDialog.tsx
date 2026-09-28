import { CheckCircle2, ShieldAlert } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface ChecklistProps {
  /** The reviewer has opened the Fraud & Identity Review section for this candidate. */
  panelOpened: boolean;
  /** Critical or high alerts still waiting for a decision. */
  blockingCount: number;
  /** The "I have reviewed all fraud flags" box is ticked. */
  acknowledged: boolean;
}

function Step({ done, children }: { done: boolean; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      {done
        ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-label="Done" />
        : <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-red-600" aria-label="Still to do" />}
      <span>{children}</span>
    </li>
  );
}

/** What is still open before a flagged profile can be approved. */
export function ReviewChecklist({ panelOpened, blockingCount, acknowledged }: ChecklistProps) {
  return (
    <ul className="space-y-2 text-sm text-slate-800">
      <Step done={panelOpened}>Look at the photos and documents in the Fraud &amp; Identity Review section.</Step>
      <Step done={blockingCount === 0}>
        Record a decision on each serious alert{blockingCount > 0 ? ` (${blockingCount} still waiting).` : "."}
      </Step>
      <Step done={acknowledged}>Tick &ldquo;I have reviewed all fraud flags&rdquo; at the bottom of that section.</Step>
    </ul>
  );
}

interface Props extends ChecklistProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Open the review section and scroll to it. */
  onGoToReview: () => void;
}

/** Shown instead of approving when the system flagged the profile and the review is not finished. */
export function ReviewRequiredDialog({ open, onOpenChange, onGoToReview, ...checklist }: Props) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Review the documents and fraud section first</AlertDialogTitle>
          <AlertDialogDescription>
            The system flagged this profile, so it cannot be approved until you have reviewed it. Here is what is still open:
          </AlertDialogDescription>
        </AlertDialogHeader>
        <ReviewChecklist {...checklist} />
        <AlertDialogFooter>
          <AlertDialogCancel>Close</AlertDialogCancel>
          <AlertDialogAction onClick={onGoToReview}>Go to the review section</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
