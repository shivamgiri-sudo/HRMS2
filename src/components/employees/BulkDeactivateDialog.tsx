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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { AlertTriangle, UserMinus } from "lucide-react";
import { useEffect, useState } from "react";
import { Employee } from "./EmployeeTable";

interface BulkDeactivateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employees: Employee[];
  onConfirm: (params: {
    reason: string;
    attrition_date?: string;
    attrition_reason?: string;
    attrition_reason_notes?: string;
  }) => void;
  isSubmitting?: boolean;
}

const MIN_REASON_LENGTH = 10;

const ATTRITION_REASONS = [
  "Resigned - Better Opportunity",
  "Resigned - Personal Reasons",
  "Resigned - Higher Education",
  "Resigned - Relocation",
  "Resigned - Health Issues",
  "Resigned - Salary Dissatisfaction",
  "Resigned - Work Environment",
  "Absconding",
  "Terminated - Performance",
  "Terminated - Misconduct",
  "Terminated - Policy Violation",
  "Terminated - Attendance",
  "Contract End",
  "Retirement",
  "Death",
  "Other",
] as const;

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
  const [attritionDate, setAttritionDate] = useState("");
  const [attritionReason, setAttritionReason] = useState("");
  const [attritionNotes, setAttritionNotes] = useState("");

  const count = employees.length;
  const plural = count > 1 ? "s" : "";
  const reasonTooShort = reason.trim().length < MIN_REASON_LENGTH;

  // Clear between openings so state cannot be carried onto a different set.
  useEffect(() => {
    if (!open) {
      setReason("");
      setAttritionDate("");
      setAttritionReason("");
      setAttritionNotes("");
    }
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

        <ScrollArea className="max-h-[200px] rounded-md border">
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

        <div className="space-y-4">
          {/* Date of Leaving */}
          <div className="space-y-1.5">
            <Label htmlFor="attrition-date">
              Date of Leaving / Attrition Date
            </Label>
            <Input
              id="attrition-date"
              type="date"
              value={attritionDate}
              onChange={(e) => setAttritionDate(e.target.value)}
              disabled={isSubmitting}
              max={new Date().toISOString().slice(0, 10)}
            />
            <p className="text-xs text-muted-foreground">
              Last working day. Attendance after this date will show blank, not Absent.
            </p>
          </div>

          {/* Attrition Reason dropdown — closed set per CLAUDE.md Form Input Rule */}
          <div className="space-y-1.5">
            <Label htmlFor="attrition-reason">
              Attrition Reason
            </Label>
            <Select value={attritionReason} onValueChange={setAttritionReason} disabled={isSubmitting}>
              <SelectTrigger id="attrition-reason">
                <SelectValue placeholder="Select reason…" />
              </SelectTrigger>
              <SelectContent>
                {ATTRITION_REASONS.map((r) => (
                  <SelectItem key={r} value={r}>{r}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Notes — free text for Other or additional context */}
          {attritionReason === "Other" && (
            <div className="space-y-1.5">
              <Label htmlFor="attrition-notes">Attrition Reason Details</Label>
              <Textarea
                id="attrition-notes"
                value={attritionNotes}
                onChange={(e) => setAttritionNotes(e.target.value)}
                placeholder="Specify reason…"
                disabled={isSubmitting}
                rows={2}
                maxLength={500}
              />
            </div>
          )}

          {/* Mandatory audit reason */}
          <div className="space-y-1.5">
            <Label htmlFor="deactivation-reason">
              Deactivation Reason (Audit Log) <span className="text-destructive">*</span>
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
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={isSubmitting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              onConfirm({
                reason: reason.trim(),
                attrition_date: attritionDate || undefined,
                attrition_reason: attritionReason || undefined,
                attrition_reason_notes: attritionNotes.trim() || undefined,
              });
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
