/**
 * Attendance changes that were recorded but not applied.
 *
 * A status change is a create-then-approve pair, and the day only moves on approve. Two
 * things leave a request sitting in between, and until this panel existed neither was
 * visible or resolvable from anywhere in the product:
 *
 *   1. A CLOSED payroll month — the server deliberately refuses the approve for anyone but
 *      Super Admin, which is the governance rule, not a fault.
 *   2. A failed approve. On 2026-09-03 the approve threw for every status outside
 *      present/half_day/absent (it wrote NULL into a NOT NULL column), so the first real
 *      use of this feature left a pending row behind and the retry was then refused with
 *      "a pending manual override already exists for this employee on this date" — a dead
 *      end with no way out of it.
 *
 * So the pending request is shown where the day is, with the two actions that clear it.
 */

import { useState } from "react";
import { AlertTriangle, ArrowRight, Check, Lock, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  ATTENDANCE_STATUS_OPTIONS, MIN_CORRECTION_REASON, useApproveOverride,
  useEmployeeOverrides, useIsSuperAdmin, useRejectOverride, type ManualOverrideRow,
} from "@/hooks/useAttendanceCorrections";

const STATUS_LABEL: Record<string, string> = Object.fromEntries(
  ATTENDANCE_STATUS_OPTIONS.map((o) => [o.value, o.label]),
);

const label = (status: string | null) =>
  status ? (STATUS_LABEL[status] ?? status.replace(/_/g, " ")) : "—";

/** MySQL DATE comes back as an ISO datetime; the day is the first 10 characters. */
const dayOf = (value: string) => String(value ?? "").slice(0, 10);

interface Props {
  employeeId: string;
  /** Only Payroll Head and Super Admin see this at all — the caller gates it. */
  enabled: boolean;
}

export function PendingOverridesPanel({ employeeId, enabled }: Props) {
  const { toast } = useToast();
  const isSuperAdmin = useIsSuperAdmin();
  const { data: overrides = [] } = useEmployeeOverrides(employeeId, enabled);
  const approve = useApproveOverride();
  const reject = useRejectOverride();
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  const pending = overrides.filter((o: ManualOverrideRow) => o.approval_status === "pending");
  if (!enabled || pending.length === 0) return null;

  async function handleApprove(row: ManualOverrideRow) {
    try {
      await approve.mutateAsync(row.id);
      toast({
        title: "Attendance updated",
        description: `${dayOf(row.attendance_date)} is now ${label(row.new_status)}.`,
      });
    } catch (err: any) {
      toast({ title: "Could not apply the change", description: err?.message ?? "Unknown error", variant: "destructive" });
    }
  }

  async function handleReject(row: ManualOverrideRow) {
    if (reason.trim().length < MIN_CORRECTION_REASON) return;
    try {
      await reject.mutateAsync({ overrideId: row.id, reason: reason.trim() });
      toast({ title: "Change discarded", description: `${dayOf(row.attendance_date)} is unchanged.` });
      setRejecting(null);
      setReason("");
    } catch (err: any) {
      toast({ title: "Could not discard the change", description: err?.message ?? "Unknown error", variant: "destructive" });
    }
  }

  return (
    <div className="space-y-2 rounded-2xl border border-amber-200 bg-amber-50/70 p-3">
      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-amber-900">
        <AlertTriangle className="h-3.5 w-3.5" />
        {pending.length} change{pending.length === 1 ? "" : "s"} recorded but not applied
      </p>

      {pending.map((row: ManualOverrideRow) => {
        const needsSuperAdmin = Boolean(row.higher_approval_required || row.is_payroll_month_locked);
        const blocked = needsSuperAdmin && !isSuperAdmin;
        return (
          <div key={row.id} className="rounded-xl border border-amber-200 bg-white p-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs font-semibold text-slate-700">{dayOf(row.attendance_date)}</span>
              <span className="flex items-center gap-1 text-xs text-slate-600">
                {label(row.old_status)}
                <ArrowRight className="h-3 w-3 text-slate-400" />
                <span className="font-semibold text-slate-800">{label(row.new_status)}</span>
              </span>
              {needsSuperAdmin && (
                <Badge variant="outline" className="gap-1 border-amber-300 bg-amber-50 text-[10px] text-amber-900">
                  <Lock className="h-3 w-3" />
                  {row.payroll_month} payroll closed — Super Admin only
                </Badge>
              )}
              <span className="ml-auto flex gap-1.5">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 gap-1 px-2 text-[11px]"
                  disabled={blocked || approve.isPending}
                  title={blocked ? "Only a Super Admin can apply a change to a closed payroll month" : "Apply this change to the day"}
                  onClick={() => handleApprove(row)}
                >
                  <Check className="h-3 w-3" />
                  Apply
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 gap-1 px-2 text-[11px] text-rose-700 hover:bg-rose-50"
                  disabled={reject.isPending}
                  onClick={() => { setRejecting(rejecting === row.id ? null : row.id); setReason(""); }}
                >
                  <X className="h-3 w-3" />
                  Discard
                </Button>
              </span>
            </div>

            <p className="mt-1 text-[11px] text-slate-500">
              Reason given: {row.reason}
            </p>

            {rejecting === row.id && (
              <div className="mt-2 space-y-1.5">
                <Textarea
                  rows={2}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder={`Why is this change being discarded? (minimum ${MIN_CORRECTION_REASON} characters)`}
                  className="text-xs"
                />
                <div className="flex justify-end gap-1.5">
                  <Button size="sm" variant="ghost" className="h-7 text-[11px]" onClick={() => { setRejecting(null); setReason(""); }}>
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    className="h-7 text-[11px]"
                    disabled={reason.trim().length < MIN_CORRECTION_REASON || reject.isPending}
                    onClick={() => handleReject(row)}
                  >
                    {reject.isPending ? "Discarding…" : "Confirm discard"}
                  </Button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
