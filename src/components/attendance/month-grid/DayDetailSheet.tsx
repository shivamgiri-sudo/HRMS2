import { useState } from "react";
import { Flag, ClipboardEdit, CalendarPlus, Loader2 } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { hrmsApi } from "@/lib/hrmsApi";
import { resolveCellState, themeFor, isSystemNote } from "@/lib/attendanceStatusTheme";
import type { TeamMonthDay, TeamMonthEmployee } from "@/hooks/useTeamAttendanceMonth";
import { RaiseCorrectionDialog } from "./RaiseCorrectionDialog";
import { RaiseLeaveOnBehalfDialog } from "./RaiseLeaveOnBehalfDialog";

const MINUTES = (m?: number) => !m ? "—" : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
const SOURCE_LABEL: Record<string, string> = { dialler: "APR / dialler", biometric: "Biometric punch" };

/**
 * What a cell click opens now, instead of silently toggling a selection with no visible
 * feedback beyond a faint ring. Everything the hover tooltip showed is here too, laid
 * out for reading rather than a 16rem-wide popover — plus the actions a manager
 * actually came here for.
 */
export function DayDetailSheet({
  open, onOpenChange, employee, day, onChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employee: TeamMonthEmployee | null;
  day: TeamMonthDay | null;
  onChanged?: () => void;
}) {
  const { toast } = useToast();
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [flagNote, setFlagNote] = useState("");
  const [flagging, setFlagging] = useState(false);
  const [showFlagBox, setShowFlagBox] = useState(false);

  if (!employee || !day) return null;

  const state = resolveCellState({
    status: day.status, hasRecord: day.hasRecord, regularized: day.regularized, needsAttention: day.needsAttention,
  });
  const theme = themeFor(state);
  const dateLabel = new Date(day.d + "T00:00:00").toLocaleDateString("en-IN", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });

  async function submitFlag() {
    if (!flagNote.trim()) return;
    setFlagging(true);
    try {
      const res = await hrmsApi.post<any>("/api/wfm/attendance/team-month/flag", {
        items: [{ employeeId: employee.employeeId, date: day.d }],
        note: flagNote.trim(),
      });
      toast({
        title: res?.flagged ? "Flagged to employee" : "Could not flag",
        description: res?.flagged
          ? "They've been notified in their inbox."
          : res?.skipped_no_account ? "They have no login account."
          : res?.skipped_out_of_scope ? "Outside your team."
          : "The notification could not be delivered — try again.",
        variant: res?.flagged ? undefined : "destructive",
      });
      setFlagNote(""); setShowFlagBox(false);
    } catch (e) {
      toast({ title: "Could not flag", description: e instanceof Error ? e.message : "The request failed.", variant: "destructive" });
    } finally {
      setFlagging(false);
    }
  }

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="w-full sm:max-w-md overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              {employee.employeeName}
              <span className="text-xs font-normal text-slate-400">{employee.employeeCode}</span>
            </SheetTitle>
            <SheetDescription>{dateLabel}</SheetDescription>
          </SheetHeader>

          <div className="mt-4 space-y-4">
            <Badge className={`${theme.cell} border-0 text-sm px-3 py-1`}>{theme.label}</Badge>

            {!day.hasRecord ? (
              <p className="rounded-lg border border-orange-200 bg-orange-50 p-3 text-sm text-orange-800">
                No attendance record exists for this day. Payroll will not run for the month until
                every employee has a record for every day.
              </p>
            ) : (
              <dl className="grid grid-cols-2 gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
                <div><dt className="text-xs text-slate-500">Clock in</dt><dd className="font-medium">{day.clockIn ?? "—"}</dd></div>
                <div><dt className="text-xs text-slate-500">Clock out</dt><dd className="font-medium">{day.clockOut ?? "—"}</dd></div>
                <div><dt className="text-xs text-slate-500">Worked</dt><dd className="font-medium">{MINUTES(day.minutes)}</dd></div>
                <div><dt className="text-xs text-slate-500">LWP</dt><dd className="font-medium">{Number(day.lwp ?? 0).toFixed(2)}</dd></div>
                <div className="col-span-2">
                  <dt className="text-xs text-slate-500">Source</dt>
                  <dd className="font-medium">
                    {SOURCE_LABEL[String(day.source)] ?? day.source ?? "—"}{day.sourceSystem ? ` (${day.sourceSystem})` : ""}
                  </dd>
                </div>
                {day.lateMark && (
                  <div className="col-span-2 text-amber-700">Late by {day.lateBy ?? 0} min</div>
                )}
                {day.regularized && <div className="col-span-2 text-indigo-700">Corrected by an approved regularization.</div>}
                {day.overridden && <div className="col-span-2 text-indigo-700">Manually overridden.</div>}
                {day.locked && <div className="col-span-2 text-slate-500">Locked for payroll.</div>}
                {day.sourceMismatch && (
                  <div className="col-span-2 text-sky-700">
                    APR and biometric disagreed — the status above is what payroll uses.
                  </div>
                )}
                {day.note && (
                  isSystemNote(day.note) ? (
                    // A reconciliation/audit string, not a person's words — shown as what
                    // it is (a system log line) rather than in quotes, which used to read
                    // as if someone had typed "COSEC historical review: punches=31; ..."
                    <div className="col-span-2">
                      <dt className="text-xs text-slate-500">System note</dt>
                      <dd className="break-all rounded bg-slate-100 px-2 py-1 font-mono text-[11px] text-slate-500">
                        {day.note}
                      </dd>
                    </div>
                  ) : (
                    <div className="col-span-2 text-slate-500 italic">"{day.note}"</div>
                  )
                )}
              </dl>
            )}

            {day.needsAttention && day.hasRecord && (
              <p className="rounded-lg border border-orange-200 bg-orange-50 p-3 text-sm text-orange-800">
                This day has no usable attendance decision yet and will block payroll.
              </p>
            )}
            {day.pendingRegularizationId && (
              <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                A regularization request is already awaiting approval for this day.
              </p>
            )}

            <div className="space-y-2 border-t border-slate-100 pt-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Actions</p>
              <Button
                variant="outline" className="w-full justify-start"
                onClick={() => setCorrectionOpen(true)}
                disabled={!!day.pendingRegularizationId}
              >
                <ClipboardEdit className="mr-2 h-4 w-4" />
                {day.pendingRegularizationId ? "Correction already pending" : "Raise a correction for this day"}
              </Button>
              <Button variant="outline" className="w-full justify-start" onClick={() => setLeaveOpen(true)}>
                <CalendarPlus className="mr-2 h-4 w-4" />
                Raise leave for {employee.employeeName.split(" ")[0]}
              </Button>
              {!showFlagBox ? (
                <Button variant="outline" className="w-full justify-start" onClick={() => setShowFlagBox(true)}>
                  <Flag className="mr-2 h-4 w-4" />
                  Flag this day to them
                </Button>
              ) : (
                <div className="space-y-2 rounded-lg border border-slate-200 p-3">
                  <Textarea
                    value={flagNote} onChange={(e) => setFlagNote(e.target.value)}
                    placeholder="What should they look at?" rows={2}
                  />
                  <div className="flex justify-end gap-2">
                    <Button size="sm" variant="ghost" onClick={() => setShowFlagBox(false)}>Cancel</Button>
                    <Button size="sm" onClick={submitFlag} disabled={flagging || !flagNote.trim()}>
                      {flagging ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                      Send
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <RaiseCorrectionDialog
        open={correctionOpen} onOpenChange={setCorrectionOpen}
        employeeId={employee.employeeId} employeeName={employee.employeeName}
        dates={[day.d]}
        onSubmitted={() => { onChanged?.(); onOpenChange(false); }}
      />
      <RaiseLeaveOnBehalfDialog
        open={leaveOpen} onOpenChange={setLeaveOpen}
        employeeId={employee.employeeId} employeeName={employee.employeeName}
      />
    </>
  );
}
