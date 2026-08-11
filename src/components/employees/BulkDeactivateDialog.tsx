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
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { AlertTriangle, UserMinus } from "lucide-react";
import { useEffect, useState } from "react";
import { Employee } from "./EmployeeTable";

interface BulkDeactivateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employees: Employee[];
  onConfirm: (reason: string) => void;
  isSubmitting?: boolean;
}

const MIN_REASON_LENGTH = 10;

/**
 * Deactivating now genuinely ends access — it clears active_status and revokes
 * live sessions — so it is no longer something that should fire straight off a
 * menu click with no confirmation, least of all across a whole selection.
 */
export function BulkDeactivateDialog({
  open,
  onOpenChange,
  employees,
  onConfirm,
  isSubmitting = false,
}: BulkDeactivateDialogProps) {
  const [reason, setReason] = useState("");
  const count = employees.length;
  const plural = count > 1 ? "s" : "";
  const reasonTooShort = reason.trim().length < MIN_REASON_LENGTH;

  // Clear between openings so a reason cannot be carried onto a different set of
  // people than the one it was written for.
  useEffect(() => {
    if (!open) setReason("");
  }, [open]);

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <UserMinus className="h-5 w-5" />
            Deactivate {count} employee{plural}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            They will be marked inactive, removed from payroll runs, and signed out
            immediately. Anyone still signed in loses access on their next action.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <ScrollArea className="max-h-[300px] rounded-md border">
          <div className="p-4 space-y-2">
            {employees.map((employee) => (
              <div
                key={employee.id}
                className="flex items-center gap-3 p-2 rounded-lg bg-muted/50"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{employee.name}</p>
                  <p className="text-xs text-muted-foreground truncate">{employee.email}</p>
                </div>
                <Badge variant="outline" className="text-xs">
                  {employee.status}
                </Badge>
              </div>
            ))}
          </div>
        </ScrollArea>

        <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
          <p className="text-sm text-amber-700 dark:text-amber-500 flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>
              Reversing this is not a profile edit — it needs a reactivation request with
              a reason, branch head approval and HR confirmation. For a resignation or
              termination, use the exit process instead so clearance and full &amp; final
              settlement are raised.
            </span>
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="deactivation-reason">
            Reason <span className="text-destructive">*</span>
          </Label>
          <Textarea
            id="deactivation-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Resigned, last working day 15 Aug — exit formalities pending"
            disabled={isSubmitting}
            rows={2}
            maxLength={500}
          />
          <p className="text-xs text-muted-foreground">
            Recorded against each employee in the audit log. Minimum {MIN_REASON_LENGTH} characters.
          </p>
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={isSubmitting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              onConfirm(reason.trim());
            }}
            disabled={isSubmitting || reasonTooShort}
          >
            <UserMinus className="mr-2 h-4 w-4" />
            {isSubmitting ? "Deactivating..." : `Deactivate ${count} employee${plural}`}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
