/**
 * Change one day's attendance status.
 *
 * Opened from the Attendance tab of the Attendance Lookup drawer, by Payroll Head or
 * Super Admin. The dialog's job is to make the consequence visible before the change is
 * made: what the day is now, what it becomes, and what that does to loss of pay — a
 * present→absent correction moves a full day of salary, and that should not be discovered
 * on a payslip.
 */

import { useEffect, useMemo, useState } from "react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { AlertTriangle, ArrowRight, Lock } from "lucide-react";
import {
  ATTENDANCE_STATUS_OPTIONS, MIN_CORRECTION_REASON, useChangeAttendanceStatus,
} from "@/hooks/useAttendanceCorrections";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employeeId: string;
  employeeLabel: string;
  /** YYYY-MM-DD */
  date: string;
  currentStatus: string | null;
  /** attendance_daily_record.is_locked — the day was already frozen by payroll or an override. */
  isLocked?: boolean;
  onChanged?: () => void;
}

const STATUS_LABEL: Record<string, string> = Object.fromEntries(
  ATTENDANCE_STATUS_OPTIONS.map((o) => [o.value, o.label]),
);

export function ChangeAttendanceStatusDialog({
  open, onOpenChange, employeeId, employeeLabel, date, currentStatus, isLocked, onChanged,
}: Props) {
  const { toast } = useToast();
  const [newStatus, setNewStatus] = useState("");
  const [reason, setReason] = useState("");
  const change = useChangeAttendanceStatus();

  useEffect(() => {
    if (open) { setNewStatus(""); setReason(""); }
  }, [open, date, employeeId]);

  const payrollMonth = date.slice(0, 7);
  const target = ATTENDANCE_STATUS_OPTIONS.find((o) => o.value === newStatus) ?? null;
  const current = ATTENDANCE_STATUS_OPTIONS.find((o) => o.value === (currentStatus ?? "")) ?? null;

  /**
   * The pay delta, in days of loss of pay. Only meaningful when both sides carry a known
   * LWP value — present/half_day/absent. For week_off or holiday the stored value is left
   * alone by the server, so claiming a number here would be inventing one.
   */
  const lwpDelta = useMemo(() => {
    if (!target || target.lwp === null || !current || current.lwp === null) return null;
    return Number((target.lwp - current.lwp).toFixed(2));
  }, [target, current]);

  const reasonOk = reason.trim().length >= MIN_CORRECTION_REASON;
  const canSubmit = Boolean(newStatus) && newStatus !== currentStatus && reasonOk && !change.isPending;

  async function handleSubmit() {
    if (!canSubmit) return;
    try {
      const result = await change.mutateAsync({
        employeeId,
        attendanceDate: date,
        newStatus,
        reason: reason.trim(),
        payrollMonth,
      });
      if (result.outcome === "applied") {
        toast({
          title: "Attendance updated",
          description: `${date} changed to ${STATUS_LABEL[newStatus] ?? newStatus}.`,
        });
      } else {
        toast({
          title: "Sent for Super Admin approval",
          description: `${payrollMonth} payroll is closed, so the change is recorded and waits for a Super Admin to approve it. The day is unchanged until then.`,
        });
      }
      onOpenChange(false);
      onChanged?.();
    } catch (err: any) {
      toast({
        title: "Could not change the status",
        description: err?.message ?? "Unknown error",
        variant: "destructive",
      });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Change attendance status</DialogTitle>
          <DialogDescription>
            {employeeLabel} — {date}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* From → to */}
          <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Currently</p>
              <p className="text-sm font-semibold text-slate-800">
                {currentStatus ? (STATUS_LABEL[currentStatus] ?? currentStatus) : "—"}
              </p>
            </div>
            <ArrowRight className="h-4 w-4 shrink-0 text-slate-400" />
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Becomes</p>
              <p className="text-sm font-semibold text-slate-800">{target ? target.label : "—"}</p>
            </div>
          </div>

          {isLocked && (
            <p className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              This day is already locked — it was set by payroll or by an earlier override. Changing
              it again rewrites a figure someone has already signed off.
            </p>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="new-status" className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              New status
            </Label>
            <Select value={newStatus} onValueChange={setNewStatus}>
              <SelectTrigger id="new-status"><SelectValue placeholder="Choose a status…" /></SelectTrigger>
              <SelectContent>
                {ATTENDANCE_STATUS_OPTIONS.filter((o) => o.value !== currentStatus).map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {target && <p className="text-[11px] text-slate-500">{target.hint}</p>}
          </div>

          {lwpDelta !== null && lwpDelta !== 0 && (
            <p className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-900">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {lwpDelta > 0
                ? `This adds ${lwpDelta} day of loss of pay — the employee is paid less for this day.`
                : `This removes ${Math.abs(lwpDelta)} day of loss of pay — the employee is paid more for this day.`}
            </p>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="change-reason" className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Reason <span className="font-normal normal-case text-slate-400">(recorded against the day, minimum {MIN_CORRECTION_REASON} characters)</span>
            </Label>
            <Textarea
              id="change-reason"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Biometric device was offline on this date; verified against the shift register."
            />
            {reason.length > 0 && !reasonOk && (
              <p className="text-[11px] text-rose-600">
                {MIN_CORRECTION_REASON - reason.trim().length} more character(s) needed.
              </p>
            )}
          </div>

          <p className="text-[11px] text-slate-500">
            The change is applied immediately for an open payroll month. If{" "}
            <Badge variant="outline" className="px-1 py-0 font-mono text-[10px]">{payrollMonth}</Badge>{" "}
            payroll is already closed, it is recorded and held for a Super Admin to approve.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={change.isPending}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            {change.isPending ? "Saving…" : "Change status"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
