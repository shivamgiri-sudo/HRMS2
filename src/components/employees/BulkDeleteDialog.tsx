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
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { AlertTriangle, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Employee } from "./EmployeeTable";

interface BulkDeleteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employees: Employee[];
  onConfirm: (reason: string) => void;
  isDeleting?: boolean;
}

const MIN_REASON_LENGTH = 10;

const statusStyles: Record<string, string> = {
  active: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
  inactive: "bg-muted text-muted-foreground border-border",
  onboarding: "bg-primary/10 text-primary border-primary/20",
  offboarded: "bg-destructive/10 text-destructive border-destructive/20",
};

export function BulkDeleteDialog({
  open,
  onOpenChange,
  employees,
  onConfirm,
  isDeleting = false,
}: BulkDeleteDialogProps) {
  const [reason, setReason] = useState("");
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
          <AlertDialogTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-5 w-5" />
            Remove {employees.length} Employee{employees.length > 1 ? 's' : ''} from active use?
          </AlertDialogTitle>
          <AlertDialogDescription>
            The following employees will be deactivated and signed out. Their records are
            retained — nothing is erased — but they lose access immediately and drop out of
            payroll runs:
          </AlertDialogDescription>
        </AlertDialogHeader>

        <ScrollArea className="max-h-[300px] rounded-md border">
          <div className="p-4 space-y-3">
            {employees.map((employee) => (
              <div
                key={employee.id}
                className="flex items-center gap-3 p-2 rounded-lg bg-muted/50"
              >
                <Avatar className="h-9 w-9">
                  <AvatarImage src={employee.avatar} />
                  <AvatarFallback className="text-xs">
                    {employee.name.split(" ").map((n) => n[0]).join("")}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">
                    {employee.name}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    {employee.email}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground hidden sm:inline">
                    {employee.department}
                  </span>
                  <Badge 
                    variant="outline" 
                    className={`text-xs ${statusStyles[employee.status] || ''}`}
                  >
                    {employee.status}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>

        <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-3">
          <p className="text-sm text-destructive flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>
              This does not run the exit process: no clearance tasks, no full &amp; final
              settlement and no exit date are recorded. For a resignation or termination,
              use the exit flow instead. Reversing this needs an approved reactivation
              request, not a profile edit.
            </span>
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="bulk-deactivation-reason">
            Reason <span className="text-destructive">*</span>
          </Label>
          <Textarea
            id="bulk-deactivation-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Absconded since 1 Aug, no response to notices"
            disabled={isDeleting}
            rows={2}
            maxLength={500}
          />
          <p className="text-xs text-muted-foreground">
            Recorded against each employee in the audit log. Minimum {MIN_REASON_LENGTH} characters.
          </p>
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              onConfirm(reason.trim());
            }}
            disabled={isDeleting || reasonTooShort}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            <Trash2 className="mr-2 h-4 w-4" />
            {isDeleting ? "Deactivating..." : `Deactivate ${employees.length} Employee${employees.length > 1 ? 's' : ''}`}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}