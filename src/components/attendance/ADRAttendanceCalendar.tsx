import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronLeft,
  ChevronRight,
  Calendar as CalendarIcon,
  CheckCircle2,
  XCircle,
  AlertCircle,
  MinusCircle,
  Lock,
  AlertTriangle,
  Cpu,
  Fingerprint,
  FileText,
  Clock,
} from "lucide-react";
import { format } from "date-fns";
import { hrmsApi } from "@/lib/hrmsApi";
import { normalizeDate } from "@/components/attendance/AttendanceCalendar";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";

// ─── Types ────────────────────────────────────────────────────────────────────

type DayStatus = "present" | "absent" | "leave" | "holiday" | "weekend" | "half_day" | "unreconciled" | "unprocessed" | "awaiting";

interface ADRDay {
  date: string;
  status: DayStatus;
  attendanceSource: string | null;
  diallerMinutes: number | null;
  biometricMinutes: number | null;
  rawMinutes: number | null;
  lwpValue: number | null;
  lateMark: number | null;
  lateByMinutes: number | null;
  mismatchFlag: number;
  isLocked: number;
  sourceSystem: string | null;
  processedAt: string | null;
  biometricStatus: string | null;
  aprStatus: string | null;
}

interface ADRAttendanceCalendarProps {
  employeeId: string;
  initialMonth?: number;
  initialYear?: number;
}

// ─── Utilities ────────────────────────────────────────────────────────────────

const DAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}
function getFirstDayOfMonth(year: number, month: number) {
  return new Date(year, month, 1).getDay();
}
function fmtDate(year: number, month: number, day: number) {
  return `${year}-${String(month + 1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
}
function fmtMinutes(mins?: number | null): string {
  if (mins == null || mins === 0) return "0h 0m";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}
function normalizeStatus(status?: string | null): DayStatus {
  const s = String(status || "").toLowerCase();
  if (s === "half_day" || s === "half-day") return "half_day";
  if (s === "leave_approved" || s === "leave") return "leave";
  if (s === "week_off" || s === "weekend") return "weekend";
  if (s === "holiday") return "holiday";
  if (s === "absent" || s === "unreconciled") return "absent";
  if (s === "present") return "present";
  if (s === "week_off_worked") return "present";
  if (s === "missing_punch") return "absent";
  return "absent";
}

// ─── Cell styling ─────────────────────────────────────────────────────────────

function cellStyle(status: DayStatus, isToday: boolean) {
  const base = "min-h-[72px] rounded-xl border-2 p-1.5 text-left transition-all cursor-pointer select-none ";
  const today = isToday ? "ring-2 ring-offset-1 ring-emerald-600 " : "";
  const map: Record<DayStatus, string> = {
    present:      "bg-emerald-50  border-emerald-200 hover:bg-emerald-100",
    absent:       "bg-red-50      border-red-200     hover:bg-red-100",
    half_day:     "bg-amber-50    border-amber-200   hover:bg-amber-100",
    leave:        "bg-blue-50     border-blue-200    hover:bg-blue-100",
    holiday:      "bg-purple-50   border-purple-200  hover:bg-purple-100",
    weekend:      "bg-slate-50    border-slate-200   hover:bg-slate-100",
    unreconciled: "bg-orange-50   border-orange-200  hover:bg-orange-100",
    unprocessed:  "bg-slate-50    border-dashed border-slate-200 hover:bg-slate-100",
    awaiting:     "bg-sky-50/60   border-dashed border-sky-200   hover:bg-sky-100/60",
  };
  return base + today + (map[status] ?? map.absent);
}

function StatusIcon({ status }: { status: DayStatus }) {
  const cls = "h-3.5 w-3.5";
  if (status === "present")      return <CheckCircle2  className={`${cls} text-emerald-600`} />;
  if (status === "absent")       return <XCircle       className={`${cls} text-red-500`} />;
  if (status === "half_day")     return <MinusCircle   className={`${cls} text-amber-500`} />;
  if (status === "leave")        return <CalendarIcon  className={`${cls} text-blue-500`} />;
  if (status === "holiday")      return <CalendarIcon  className={`${cls} text-purple-500`} />;
  if (status === "unreconciled") return <AlertCircle   className={`${cls} text-orange-500`} />;
  if (status === "unprocessed")  return <MinusCircle   className={`${cls} text-slate-300`} />;
  if (status === "awaiting")     return <Clock         className={`${cls} text-sky-400`} />;
  return <MinusCircle className={`${cls} text-slate-400`} />;
}

function StatusBadge({ status }: { status: DayStatus }) {
  const map: Record<DayStatus, string> = {
    present:      "bg-emerald-100 text-emerald-800",
    absent:       "bg-red-100     text-red-800",
    half_day:     "bg-amber-100   text-amber-800",
    leave:        "bg-blue-100    text-blue-800",
    holiday:      "bg-purple-100  text-purple-800",
    weekend:      "bg-slate-100   text-slate-700",
    unreconciled: "bg-orange-100  text-orange-800",
    unprocessed:  "bg-slate-100   text-slate-400",
    awaiting:     "bg-sky-100     text-sky-700",
  };
  const labels: Record<DayStatus, string> = {
    present: "Present", absent: "Absent", half_day: "Half Day",
    leave: "Leave", holiday: "Holiday", weekend: "Weekend",
    unreconciled: "Unreconciled", unprocessed: "Not Processed",
    awaiting: "Awaiting Nightly Run",
  };
  return (
    <Badge className={`${map[status] ?? map.absent} hover:${map[status] ?? map.absent} capitalize`}>
      {labels[status] ?? status}
    </Badge>
  );
}

// ─── ADR Day Detail Sheet ──────────────────────────────────────────────────────

function ADRDayDetailSheet({
  open, onClose, day,
}: {
  open: boolean;
  onClose: () => void;
  day: ADRDay | null;
}) {
  if (!day) return null;

  const isUnprocessed = day.status === "unprocessed" || day.status === "awaiting";
  const isAwaiting = day.status === "awaiting";

  return (
    <Sheet open={open} onOpenChange={onClose}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader className="mb-4">
          <div className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-emerald-600" />
            <SheetTitle>ADR / Payroll Record</SheetTitle>
          </div>
          <SheetDescription>
            {day.date ? format(new Date(day.date + "T00:00:00"), "EEEE, MMMM d, yyyy") : ""}
          </SheetDescription>
        </SheetHeader>

        {isUnprocessed ? (
          isAwaiting ? (
            <div className="rounded-xl border border-dashed border-sky-200 bg-sky-50/60 p-6 text-center space-y-2">
              <Clock className="h-8 w-8 text-sky-300 mx-auto" />
              <p className="text-sm font-medium text-sky-700">Awaiting tonight's run</p>
              <p className="text-xs text-sky-600/80">
                The attendance engine processes each day after 23:00 the following night,
                so this date is not due yet. Nothing to report — check back tomorrow.
              </p>
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center space-y-2">
              <AlertCircle className="h-8 w-8 text-slate-300 mx-auto" />
              <p className="text-sm font-medium text-slate-500">No record for this date</p>
              <p className="text-xs text-slate-400">
                The nightly run has already covered this date and produced no attendance
                record. If you worked that day, raise a regularisation with your manager.
              </p>
            </div>
          )
        ) : (
          <div className="space-y-4">

            {/* Status + lock */}
            <div className="flex items-center justify-between">
              <StatusBadge status={day.status} />
              <div className="flex items-center gap-2">
                {day.isLocked === 1 && (
                  <Badge className="bg-slate-200 text-slate-700 hover:bg-slate-200">
                    <Lock className="mr-1 h-3 w-3" />Locked for payroll
                  </Badge>
                )}
              </div>
            </div>

            {/* Mismatch banner */}
            {day.mismatchFlag === 1 && (
              <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 space-y-2">
                <div className="flex items-center gap-2 text-amber-800 text-xs font-semibold">
                  <AlertTriangle className="h-4 w-4" />
                  Biometric vs APR Mismatch
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-lg bg-white border border-amber-100 p-2">
                    <p className="text-slate-400 text-[10px] uppercase font-semibold mb-0.5 flex items-center gap-1">
                      <Fingerprint className="h-3 w-3" />Biometric
                    </p>
                    <p className="font-semibold text-slate-700">{day.biometricStatus ?? "—"}</p>
                    <p className="text-slate-400">{fmtMinutes(day.biometricMinutes)}</p>
                  </div>
                  <div className="rounded-lg bg-white border border-amber-100 p-2">
                    <p className="text-slate-400 text-[10px] uppercase font-semibold mb-0.5 flex items-center gap-1">
                      <Cpu className="h-3 w-3" />APR
                    </p>
                    <p className="font-semibold text-slate-700">{day.aprStatus ?? "—"}</p>
                    <p className="text-slate-400">{fmtMinutes(day.diallerMinutes)}</p>
                  </div>
                </div>
              </div>
            )}

            {/* Source card */}
            <div className="rounded-xl border border-emerald-100 bg-emerald-50/40 p-3 space-y-2">
              <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-700">
                {day.attendanceSource === "dialler" ? "APR / Dialler Source" : "Biometric Source"}
              </p>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-lg bg-white border border-slate-100 p-2.5">
                  <p className="text-[10px] text-slate-500 mb-1">Net Minutes</p>
                  <p className="text-base font-semibold text-slate-900">{fmtMinutes(day.rawMinutes)}</p>
                  <p className="text-[10px] text-slate-400">{day.rawMinutes ?? 0} min</p>
                </div>
                <div className="rounded-lg bg-white border border-slate-100 p-2.5">
                  <p className="text-[10px] text-slate-500 mb-1">Source</p>
                  <p className="text-sm font-semibold text-slate-900 capitalize">
                    {day.attendanceSource === "dialler" ? "APR / Dialler" : "Biometric"}
                  </p>
                  {day.sourceSystem && (
                    <p className="text-[10px] text-slate-400">{day.sourceSystem}</p>
                  )}
                </div>
              </div>
              {day.attendanceSource === "dialler" && day.biometricMinutes != null && (
                <div className="flex justify-between text-xs text-slate-500 pt-1 border-t border-emerald-100">
                  <span>Biometric minutes (reference)</span>
                  <span className="font-semibold">{fmtMinutes(day.biometricMinutes)}</span>
                </div>
              )}
            </div>

            {/* LWP / late info */}
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-lg border border-slate-100 bg-slate-50 py-2">
                <p className="text-[10px] font-semibold uppercase text-slate-400">LWP</p>
                <p className={`text-lg font-bold ${day.lwpValue ? 'text-red-600' : 'text-emerald-600'}`}>
                  {day.lwpValue ?? 0}
                </p>
              </div>
              <div className="rounded-lg border border-slate-100 bg-slate-50 py-2">
                <p className="text-[10px] font-semibold uppercase text-slate-400">Late Mark</p>
                <p className={`text-lg font-bold ${day.lateMark ? 'text-amber-600' : 'text-slate-400'}`}>
                  {day.lateMark ? "Yes" : "No"}
                </p>
              </div>
              <div className="rounded-lg border border-slate-100 bg-slate-50 py-2">
                <p className="text-[10px] font-semibold uppercase text-slate-400">Late by</p>
                <p className="text-lg font-bold text-slate-700">
                  {day.lateByMinutes ? `${day.lateByMinutes}m` : "--"}
                </p>
              </div>
            </div>

            <Separator />

            {/* Payroll note */}
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-xs text-emerald-800">
              <span className="font-semibold">Payroll record:</span> Your salary, LWP deductions and late marks
              are calculated from this ADR data — not from live biometric punches.
            </div>

            {/* Meta */}
            {day.processedAt && (
              <div className="text-[11px] text-slate-400 px-1">
                Last processed: {format(new Date(day.processedAt), "dd MMM yyyy, hh:mm a")}
              </div>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

/** Today's date in IST as YYYY-MM-DD (toISOString() is UTC and drifts a day). */
function istTodayString(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

/** Whole days between `dateStr` (YYYY-MM-DD) and today in IST. Negative = future. */
function daysBeforeTodayIST(dateStr: string): number {
  const toUTC = (s: string) => {
    const [y, m, d] = s.split("-").map(Number);
    return Date.UTC(y!, (m ?? 1) - 1, d ?? 1);
  };
  return Math.round((toUTC(istTodayString()) - toUTC(dateStr)) / 86_400_000);
}

/**
 * A missing ADR row means two very different things, and the calendar used to render
 * both as "Not Processed".
 *
 * The attendance engine sweeps at 23:00 and processes the PREVIOUS day, so a row for
 * date D does not exist until 23:00 on D+1. Today and yesterday are therefore simply
 * not due yet — normal, nothing to chase. A blank from two or more days ago is a real
 * gap: the sweep has been round and produced nothing.
 *
 * Showing "Not Processed" for yesterday made a healthy pending day look like a fault,
 * which is exactly what prompted this. Future dates keep the neutral state.
 */
function missingDayStatus(dateStr: string): DayStatus {
  const age = daysBeforeTodayIST(dateStr);
  return age >= 0 && age <= 1 ? "awaiting" : "unprocessed";
}

export function ADRAttendanceCalendar({ employeeId, initialMonth, initialYear }: ADRAttendanceCalendarProps) {
  const today = new Date();
  const [currentMonth, setCurrentMonth] = useState(initialMonth ?? today.getMonth());
  const [currentYear,  setCurrentYear]  = useState(initialYear  ?? today.getFullYear());
  const [selectedDay,  setSelectedDay]  = useState<ADRDay | null>(null);
  const [sheetOpen,    setSheetOpen]    = useState(false);

  const { data: adrData = [], isLoading } = useQuery<ADRDay[]>({
    queryKey: ["adr-calendar", employeeId, currentYear, currentMonth],
    queryFn: async () => {
      const fromDate = fmtDate(currentYear, currentMonth, 1);
      const toDate   = fmtDate(currentYear, currentMonth, getDaysInMonth(currentYear, currentMonth));
      const res = await hrmsApi.get<{ success: boolean; data: any[] }>(
        `/api/wfm/attendance/daily?${new URLSearchParams({ employeeId, fromDate, toDate, limit: "100" })}`
      );
      return (res.data || []).map((r: any): ADRDay => ({
        // Keyed on a strict YYYY-MM-DD below, so normalize here rather than trusting
        // the endpoint's raw shape — `record_date` is only a bare date string by
        // virtue of the pool's `dateStrings: true`, and any serializer in between
        // would turn it into an ISO datetime and miss every lookup for the month.
        date:             normalizeDate(r.record_date ?? r.date ?? ""),
        status:           normalizeStatus(r.attendance_status ?? r.status),
        attendanceSource: r.attendance_source ?? null,
        diallerMinutes:   r.dialler_minutes != null ? Number(r.dialler_minutes) : null,
        biometricMinutes: r.biometric_minutes != null ? Number(r.biometric_minutes) : null,
        rawMinutes:       r.raw_minutes != null ? Number(r.raw_minutes) : null,
        lwpValue:         r.lwp_value != null ? Number(r.lwp_value) : null,
        lateMark:         r.late_mark != null ? Number(r.late_mark) : null,
        lateByMinutes:    r.late_by_minutes != null ? Number(r.late_by_minutes) : null,
        mismatchFlag:     Number(r.mismatch_flag ?? 0),
        isLocked:         Number(r.is_locked ?? 0),
        sourceSystem:     r.source_system ?? null,
        processedAt:      r.processed_at ?? null,
        biometricStatus:  r.biometric_status ?? null,
        aprStatus:        r.apr_status ?? null,
      }));
    },
    enabled: !!employeeId,
    // Overrides the app-wide default (false): the underlying COSEC/APR sync
    // runs on its own schedule independent of anything the employee does here,
    // so returning to this tab should re-check rather than show a stale month.
    refetchOnWindowFocus: true,
  });

  const adrMap = new Map<string, ADRDay>(adrData.map(d => [d.date, d]));

  const daysInMonth    = getDaysInMonth(currentYear, currentMonth);
  const firstDayOffset = getFirstDayOfMonth(currentYear, currentMonth);
  const calendarDays: (number | null)[] = [
    ...Array(firstDayOffset).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  const prevMonth = () => {
    if (currentMonth === 0) { setCurrentMonth(11); setCurrentYear(y => y - 1); }
    else setCurrentMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (currentMonth === 11) { setCurrentMonth(0); setCurrentYear(y => y + 1); }
    else setCurrentMonth(m => m + 1);
  };

  const handleDayClick = (day: number) => {
    const dateStr = fmtDate(currentYear, currentMonth, day);
    const record  = adrMap.get(dateStr);
    const dayOfWeek = new Date(currentYear, currentMonth, day).getDay();
    const isWknd  = dayOfWeek === 0 || dayOfWeek === 6;
    if (record) {
      setSelectedDay(record);
    } else {
      // Unprocessed day — create a placeholder entry
      setSelectedDay({
        date: dateStr,
        status: isWknd ? "weekend" : missingDayStatus(dateStr),
        attendanceSource: null,
        diallerMinutes: null, biometricMinutes: null, rawMinutes: null,
        lwpValue: null, lateMark: null, lateByMinutes: null,
        mismatchFlag: 0, isLocked: 0,
        sourceSystem: null, processedAt: null,
        biometricStatus: null, aprStatus: null,
      });
    }
    setSheetOpen(true);
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader><Skeleton className="h-8 w-48" /></CardHeader>
        <CardContent>
          <div className="grid grid-cols-7 gap-1.5">
            {Array.from({ length: 35 }).map((_, i) => <Skeleton key={i} className="h-[72px] rounded-xl" />)}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card className="overflow-hidden">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">{MONTHS[currentMonth]} {currentYear}</CardTitle>
            <div className="flex gap-1.5">
              <Button variant="outline" size="sm" onClick={() => { setCurrentMonth(today.getMonth()); setCurrentYear(today.getFullYear()); }}>
                <CalendarIcon className="mr-1.5 h-3.5 w-3.5" />Today
              </Button>
              <Button variant="outline" size="icon" className="h-8 w-8" onClick={prevMonth}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="icon" className="h-8 w-8" onClick={nextMonth}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Legend */}
          <div className="flex flex-wrap gap-3 pt-1 text-xs text-slate-600">
            {[
              { status: "present"     as DayStatus, label: "Present",       dot: "bg-emerald-500" },
              { status: "absent"      as DayStatus, label: "Absent",        dot: "bg-red-500"     },
              { status: "half_day"    as DayStatus, label: "Half Day",      dot: "bg-amber-500"   },
              { status: "leave"       as DayStatus, label: "Leave",         dot: "bg-blue-500"    },
              { status: "holiday"     as DayStatus, label: "Holiday",       dot: "bg-purple-500"  },
              { status: "weekend"     as DayStatus, label: "Weekend",       dot: "bg-slate-400"   },
              { status: "awaiting"    as DayStatus, label: "Awaiting Run",  dot: "bg-sky-300"     },
              { status: "unprocessed" as DayStatus, label: "No Record",     dot: "bg-slate-300"   },
            ].map(({ label, dot }) => (
              <span key={label} className="flex items-center gap-1">
                <span className={`h-2.5 w-2.5 rounded-full ${dot}`} />
                {label}
              </span>
            ))}
          </div>
        </CardHeader>

        <CardContent className="pt-0">
          <div className="grid grid-cols-7 gap-1.5">
            {DAYS_SHORT.map(d => (
              <div key={d} className="pb-1 text-center text-[11px] font-bold uppercase text-slate-500">{d}</div>
            ))}
            {calendarDays.map((day, idx) => {
              if (day === null) return <div key={`e-${idx}`} />;
              const dateStr   = fmtDate(currentYear, currentMonth, day);
              const record    = adrMap.get(dateStr);
              const dayOfWeek = new Date(currentYear, currentMonth, day).getDay();
              const isWknd    = dayOfWeek === 0 || dayOfWeek === 6;
              // IST date — toISOString() is UTC and puts the "today" ring on the
              // previous day between 00:00 and 05:30 IST.
              const isToday   = dateStr === istTodayString();
              const status: DayStatus = record?.status ?? (isWknd ? "weekend" : missingDayStatus(dateStr));

              return (
                <button
                  key={day}
                  onClick={() => handleDayClick(day)}
                  className={cellStyle(status, isToday)}
                  title={`${dateStr} — ${status}`}
                >
                  <div className="flex items-center justify-between mb-0.5">
                    <span className={`text-xs font-bold ${isToday ? 'text-emerald-700' : 'text-slate-700'}`}>{day}</span>
                    <StatusIcon status={status} />
                  </div>

                  {record && (
                    <>
                      {/* Source badge */}
                      {record.attendanceSource === "dialler" ? (
                        <span className="inline-block text-[9px] font-bold rounded px-0.5 bg-amber-100 text-amber-700 leading-tight">APR</span>
                      ) : record.attendanceSource === "biometric" ? (
                        <span className="inline-block text-[9px] font-bold rounded px-0.5 bg-sky-100 text-sky-700 leading-tight">BIO</span>
                      ) : null}

                      {/* Minutes */}
                      {record.rawMinutes != null && record.rawMinutes > 0 && (
                        <div className="text-[10px] font-semibold text-slate-600 leading-tight">
                          {fmtMinutes(record.rawMinutes)}
                        </div>
                      )}

                      {/* Mismatch indicator */}
                      {record.mismatchFlag === 1 && (
                        <AlertTriangle className="h-2.5 w-2.5 text-amber-500 mt-0.5" />
                      )}

                      {/* Lock indicator */}
                      {record.isLocked === 1 && (
                        <Lock className="h-2.5 w-2.5 text-slate-400 mt-0.5" />
                      )}
                    </>
                  )}

                  {!record && status === "unprocessed" && (
                    <div className="text-[9px] text-slate-300 leading-tight mt-0.5">—</div>
                  )}
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Payroll note */}
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs text-emerald-800">
        <span className="font-semibold">ADR (Attendance Daily Record)</span> is the payroll-ready source.
        Your salary, LWP deductions and late marks are calculated from this data — not from live biometric punches.
        Days showing "Not Processed" are pending the nightly attendance engine run.
      </div>

      <ADRDayDetailSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        day={selectedDay}
      />
    </>
  );
}
