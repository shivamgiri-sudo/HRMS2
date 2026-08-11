import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronLeft,
  ChevronRight,
  Calendar as CalendarIcon,
  Fingerprint,
  LogIn,
  LogOut,
  Clock,
  CheckCircle2,
  XCircle,
  AlertCircle,
  MinusCircle,
  Moon,
  Loader2,
  FileText,
  CalendarOff,
  AlertOctagon,
  Lock,
} from "lucide-react";
import { format } from "date-fns";
import { hrmsApi } from "@/lib/hrmsApi";
import { formatClockTime, formatLastSynced } from "@/lib/utils";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { useSubmitRegularization, useSubmitLeaveRequest } from "@/hooks/useAttendance";

// ─── Types ───────────────────────────────────────────────────────────────────

type DayStatus =
  | "present" | "absent" | "leave" | "holiday" | "weekend" | "half_day"
  | "unreconciled"
  /**
   * A day the engine could not resolve to a punch pair. Distinct from `absent`:
   * `missing_punch` is the second most common status in `attendance_daily_record`
   * (2,903 rows in August 2026 alone), and collapsing it into `absent` painted
   * unresolved days as confirmed absences.
   */
  | "missing_punch"
  | "late";

export interface AttendanceDay {
  date: string;
  status: DayStatus;
  punchIn?: string;
  punchOut?: string;
  rawMinutes?: number;
  lwpValue?: number;
  isNightShift?: boolean;
  sourceSystem?: string;
  leaveType?: string;
}

interface RawPunch {
  punch_time: string;
  io_type: number;
  io_label: string;
  device_id: number | null;
  /**
   * True when the backend synthesised this entry from the day's first/last punch rather
   * than reading a real per-punch row. cosec_punch_sync — the per-punch mirror — stopped
   * being written on 2026-06-18, so for later dates only the day's bounds are available.
   * Two derived bounds must not be presented as a complete punch trail.
   */
  derived?: boolean;
}

interface DayDetail {
  date: string;
  attendance_record: {
    record_date: string;
    clock_in_time: string | null;
    clock_out_time: string | null;
    raw_minutes: number | null;
    biometric_minutes: number | null;
    attendance_status: string;
    lwp_value: number | null;
    late_mark: number | null;
    late_by_minutes: number | null;
    is_locked: number;
    source_system: string;
    attendance_source: string;
    dialler_minutes: number | null;
    processed_at: string | null;
  } | null;
  cosec_daily_agg: {
    user_id: string;
    shift_date: string;
    first_punch_in: string | null;
    last_punch_out: string | null;
    work_minutes: number | null;
    synced_at: string | null;
  } | null;
  raw_punches: RawPunch[];
  /**
   * APR / dialler record for the date. Login/logout are MySQL TIME values —
   * `login_time`/`logout_time` are raw "HH:MM:SS" (format with formatClockTime),
   * `login_at`/`logout_at` are IST-tagged datetimes safe for `new Date()`.
   */
  apr_record: {
    record_date: string;
    login_time: string | null;
    logout_time: string | null;
    login_at: string | null;
    logout_at: string | null;
    net_minutes: number;
    calls: number;
    break_bio: number;
    break_lunch: number;
    break_qa: number;
    break_training: number;
    campaigns: Array<Record<string, unknown>>;
  } | null;
}

type AttendanceSource = "dialler" | "biometric";

interface AttendanceCalendarProps {
  employeeId: string;
  /** Controlled month (0-11). When provided the parent owns month state. */
  month?: number;
  /** Controlled year. When provided the parent owns month state. */
  year?: number;
  onMonthChange?: (month: number, year: number) => void;
  /** Hide the internal navigator when the parent renders its own. */
  hideNavigator?: boolean;
  initialMonth?: number;
  initialYear?: number;
  /**
   * Pre-fetched days to render, in place of this component's own month fetch.
   *
   * When supplied, neither /attendance-source nor /ncosec-monthly//apr-monthly is
   * called: the grid renders exactly what the caller passes. This exists so a caller
   * that already shows the same month from `attendance_daily_record` (the store the
   * summary strip, the tabular view and payroll all read) can guarantee the two agree
   * instead of the calendar querying a different database and disagreeing.
   *
   * Omit it and the live COSEC/APR fetch behaviour is unchanged.
   */
  records?: AttendanceDay[];
  recordsLoading?: boolean;
  /** Badge text when `records` is supplied — the server's source verdict is not fetched then. */
  sourceLabel?: string;
}

// ─── Utilities ───────────────────────────────────────────────────────────────

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
/**
 * Today's date in IST as YYYY-MM-DD.
 * `new Date().toISOString().slice(0,10)` is UTC and resolves to the previous day
 * between 00:00 and 05:30 IST — which mis-highlighted "today" on the calendar.
 */
function istTodayString(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}
function fmtTime(val?: string | null): string {
  if (!val) return "--:--";
  try {
    // MySQL returns datetime without timezone offset (e.g. "2024-01-15 09:00:00").
    // Appending +05:30 ensures the value is parsed as IST, not UTC.
    const istStr = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(val)
      ? val.replace(" ", "T") + "+05:30"
      : val;
    return new Date(istStr).toLocaleTimeString("en-IN", {
      hour: "2-digit", minute: "2-digit", hour12: true,
      timeZone: "Asia/Kolkata",
    });
  } catch { return val.slice(11, 16) || "--:--"; }
}
/** date-fns format() throws on an invalid date — never let that blank a panel. */
function safeFormat(value: string | null | undefined, pattern: string): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  try { return format(d, pattern); } catch { return "—"; }
}
function fmtMinutes(mins?: number | null): string {
  if (mins == null || mins === 0) return "0h 0m";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}
export function normalizeDate(value?: string): string {
  if (!value) return "";
  // Already a date string
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  // ISO with T — slice directly, no timezone conversion needed
  if (/^\d{4}-\d{2}-\d{2}T/.test(value)) return value.slice(0, 10);
  // MySQL datetime "YYYY-MM-DD HH:MM:SS" — take date part directly (no UTC parse)
  if (/^\d{4}-\d{2}-\d{2} /.test(value)) return value.slice(0, 10);
  return value.slice(0, 10);
}
function normalizeStatus(status?: string): DayStatus {
  const s = String(status || "").toLowerCase();
  if (s === "half_day" || s === "half-day") return "half_day";
  if (s === "leave_approved" || s === "leave") return "leave";
  if (s === "week_off" || s === "weekend") return "weekend";
  if (s === "holiday") return "holiday";
  if (s === "missing_punch" || s === "missing-punch") return "missing_punch";
  if (s === "late") return "late";
  if (s === "absent" || s === "unreconciled") return "absent";
  if (s === "present") return "present";
  return "absent";
}

/**
 * Map `attendance_daily_record` rows (as returned by /api/wfm/attendance/daily)
 * onto the calendar's day shape.
 *
 * Exported so the caller that already holds those rows can feed the grid directly
 * instead of the calendar re-fetching a different store. The date is pushed through
 * normalizeDate() because the cell lookup keys on a strict YYYY-MM-DD, while the
 * endpoint's `record_date` is only a bare date string by virtue of the pool's
 * `dateStrings: true`.
 */
export function adrRecordsToAttendanceDays(rows: any[]): AttendanceDay[] {
  return (rows || []).map((r: any): AttendanceDay => ({
    date:         normalizeDate(r.date ?? r.record_date),
    status:       normalizeStatus(r.status ?? r.attendance_status),
    punchIn:      r.clock_in ?? r.clock_in_time ?? undefined,
    punchOut:     r.clock_out ?? r.clock_out_time ?? undefined,
    rawMinutes:   r.raw_minutes != null ? Number(r.raw_minutes) : undefined,
    lwpValue:     r.lwp_value   != null ? Number(r.lwp_value)   : undefined,
    sourceSystem: r.source_system ?? undefined,
    isNightShift: detectNightShift(r.clock_in ?? r.clock_in_time, r.clock_out ?? r.clock_out_time),
  }));
}

// Night shift: last OUT is next calendar day (after midnight, before 6 AM)
function detectNightShift(punchIn?: string | null, punchOut?: string | null): boolean {
  if (!punchIn || !punchOut) return false;
  try {
    // Treat naked datetime strings as IST to avoid UTC date boundary shift
    const toIST = (s: string) =>
      /^\d{4}-\d{2}-\d{2} /.test(s) ? s.replace(" ", "T") + "+05:30" : s;
    const inDate  = normalizeDate(punchIn);
    const outDate = normalizeDate(punchOut);
    const outHour = new Date(toIST(punchOut)).getHours();
    return inDate !== outDate && outHour < 6;
  } catch { return false; }
}

// ─── Day cell styling ─────────────────────────────────────────────────────────

function cellStyle(status: DayStatus, isToday: boolean) {
  const base = "min-h-[72px] rounded-xl border-2 p-1.5 text-left transition-all cursor-pointer select-none ";
  const today = isToday ? "ring-2 ring-offset-1 ring-[#1B6AB5] " : "";
  const map: Record<DayStatus, string> = {
    present:      "bg-emerald-50  border-emerald-200 hover:bg-emerald-100",
    absent:       "bg-red-50      border-red-200     hover:bg-red-100",
    half_day:     "bg-amber-50    border-amber-200   hover:bg-amber-100",
    leave:        "bg-blue-50     border-blue-200    hover:bg-blue-100",
    holiday:      "bg-purple-50   border-purple-200  hover:bg-purple-100",
    weekend:      "bg-slate-50    border-slate-200   hover:bg-slate-100",
    unreconciled: "bg-orange-50   border-orange-200  hover:bg-orange-100",
    missing_punch:"bg-orange-50   border-orange-300  hover:bg-orange-100",
    late:         "bg-yellow-50   border-yellow-200  hover:bg-yellow-100",
  };
  return base + today + (map[status] ?? map.absent);
}

function StatusIcon({ status }: { status: DayStatus }) {
  const props = "h-3.5 w-3.5";
  if (status === "present")      return <CheckCircle2  className={`${props} text-emerald-600`} />;
  if (status === "absent")       return <XCircle       className={`${props} text-red-500`} />;
  if (status === "half_day")     return <MinusCircle   className={`${props} text-amber-500`} />;
  if (status === "leave")        return <CalendarIcon  className={`${props} text-blue-500`} />;
  if (status === "holiday")      return <CalendarIcon  className={`${props} text-purple-500`} />;
  if (status === "unreconciled") return <AlertCircle   className={`${props} text-orange-500`} />;
  if (status === "missing_punch") return <AlertCircle  className={`${props} text-orange-600`} />;
  if (status === "late")         return <Clock         className={`${props} text-yellow-600`} />;
  return <MinusCircle className={`${props} text-slate-400`} />;
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
    missing_punch:"bg-orange-100  text-orange-900",
    late:         "bg-yellow-100  text-yellow-800",
  };
  const labels: Record<DayStatus, string> = {
    present: "Present", absent: "Absent", half_day: "Half Day",
    leave: "Leave", holiday: "Holiday", weekend: "Weekend", unreconciled: "Unreconciled",
    missing_punch: "Missing Punch", late: "Late",
  };
  return (
    <Badge className={`${map[status] ?? map.absent} hover:${map[status] ?? map.absent} capitalize`}>
      {labels[status] ?? status}
    </Badge>
  );
}

// ─── Day Detail Sheet ─────────────────────────────────────────────────────────

function DayDetailSheet({
  open, onClose, employeeId, date,
}: {
  open: boolean;
  onClose: () => void;
  employeeId: string;
  date: string | null;
}) {
  const { data, isLoading, error } = useQuery<DayDetail>({
    queryKey: ["day-detail", employeeId, date],
    queryFn: async () => {
      const res = await hrmsApi.get<{ success: boolean; data: DayDetail }>(
        `/api/wfm/attendance/day-detail/${employeeId}/${date}`
      );
      if (!res || !res.success) throw new Error("Failed to load day detail");
      return res.data;
    },
    enabled: open && !!date && !!employeeId,
    // Overrides the app-wide default (false) for this query only: a
    // regularization or the hourly APR sync can change this day's record
    // while the sheet is closed, so re-opening it (or returning to the tab
    // with it open) should re-check rather than show a stale drawer.
    refetchOnWindowFocus: true,
  });

  const adr = data?.attendance_record;
  const agg = data?.cosec_daily_agg;
  const apr = data?.apr_record ?? null;
  const punches = data?.raw_punches ?? [];
  // Every entry synthesised from the day's bounds means there is no per-punch detail for
  // this date, so the list must not be labelled as the full set of punch events.
  const punchesAreDerived = punches.length > 0 && punches.every((p) => p.derived === true);
  const isDialler = adr?.attendance_source === 'dialler' || !!apr;
  const isNight = detectNightShift(agg?.first_punch_in, agg?.last_punch_out);

  // When ADR row is absent but COSEC data exists, derive a best-effort status from COSEC work_minutes
  const statusFromCosec: DayStatus | null = (() => {
    if (!adr && agg?.work_minutes != null) {
      if (agg.work_minutes >= 480) return "present";
      if (agg.work_minutes >= 240) return "half_day";
      return "absent";
    }
    return null;
  })();
  const derivedStatus = normalizeStatus(adr?.attendance_status);
  const status: DayStatus = (derivedStatus !== "absent" || adr != null)
    ? derivedStatus
    : (statusFromCosec ?? derivedStatus);

  const hasAnyData = !!(adr || agg || punches.length > 0);

  // ── Action panel state ──────────────────────────────────────────────────────
  const [activeAction, setActiveAction] = useState<'regularize' | 'leave' | 'dispute' | null>(null);
  const [regReasonCode, setRegReasonCode] = useState('');
  const [regReason, setRegReason] = useState('');
  const [regStatus, setRegStatus] = useState<'present' | 'half_day'>('present');
  const [disputeType, setDisputeType] = useState('');
  const [disputeNewIn, setDisputeNewIn] = useState('');
  const [disputeNewOut, setDisputeNewOut] = useState('');
  const [disputeReason, setDisputeReason] = useState('');
  const [leaveTypeId, setLeaveTypeId] = useState('');
  const [leaveIsHalf, setLeaveIsHalf] = useState(false);
  const [leaveReason, setLeaveReason] = useState('');
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  const regMutation = useSubmitRegularization();
  const leaveMutation = useSubmitLeaveRequest();

  // Reset all form state when sheet closes or date changes
  useEffect(() => {
    setActiveAction(null);
    setActionSuccess(null);
    setRegReason(''); setRegReasonCode(''); setRegStatus('present');
    setDisputeType(''); setDisputeReason(''); setDisputeNewIn(''); setDisputeNewOut('');
    setLeaveTypeId(''); setLeaveReason(''); setLeaveIsHalf(false);
  }, [open, date]);

  // Reason codes for regularization — only fetch when sheet is open
  const { data: reasonCodes = [] } = useQuery<{ code: string; label: string }[]>({
    queryKey: ['reg-reasons'],
    queryFn: async () => {
      const res = await hrmsApi.get<{ success: boolean; data: { code: string; label: string }[] }>(
        '/api/wfm/regularizations/reasons'
      );
      return res.data ?? [];
    },
    enabled: open,
    staleTime: 5 * 60_000,
  });

  // Leave types — only fetch when sheet is open
  const { data: leaveTypes = [] } = useQuery<{ id: string; leave_name: string }[]>({
    queryKey: ['leave-types'],
    queryFn: async () => {
      const res = await hrmsApi.get<{ success: boolean; data: { id: string; leave_name: string }[] }>(
        '/api/leave/types'
      );
      return res.data ?? [];
    },
    enabled: open,
    staleTime: 10 * 60_000,
  });

  // Compare date strings directly — avoids locale-dependent toDateString()
  const isPastDate = !!date && date < format(new Date(), 'yyyy-MM-dd');
  const isLocked = adr?.is_locked === 1;

  const handleRegularizeSubmit = async () => {
    if (!date || !regReason.trim()) return;
    try {
      await regMutation.mutateAsync({
        sessionDate: date,
        reasonCode: regReasonCode || undefined,
        reason: regReason,
        requestedStatus: regStatus,
      });
      setActionSuccess('Regularization submitted successfully.');
      setActiveAction(null);
      setRegReason(''); setRegReasonCode(''); setRegStatus('present');
    } catch { /* error surfaced via regMutation.isError */ }
  };

  const handleDisputeSubmit = async () => {
    if (!date || !disputeType || !disputeReason.trim()) return;
    try {
      await regMutation.mutateAsync({
        sessionDate: date,
        reason: disputeReason,
        disputeType,
        newPunchIn: disputeNewIn || undefined,
        newPunchOut: disputeNewOut || undefined,
      });
      setActionSuccess('Dispute filed successfully.');
      setActiveAction(null);
      setDisputeType(''); setDisputeReason(''); setDisputeNewIn(''); setDisputeNewOut('');
    } catch { /* error surfaced via regMutation.isError */ }
  };

  const handleLeaveSubmit = async () => {
    if (!date || !leaveTypeId) return;
    try {
      await leaveMutation.mutateAsync({
        leaveTypeId,
        fromDate: date,
        toDate: date,
        totalDays: leaveIsHalf ? 0.5 : 1,
        reason: leaveReason || undefined,
      });
      setActionSuccess('Leave request submitted successfully.');
      setActiveAction(null);
      setLeaveTypeId(''); setLeaveReason(''); setLeaveIsHalf(false);
    } catch { /* error surfaced via leaveMutation.isError */ }
  };

  return (
    <Sheet open={open} onOpenChange={onClose}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader className="mb-4">
          <div className="flex items-center gap-2">
            <Fingerprint className={`h-5 w-5 ${isDialler ? 'text-amber-600' : 'text-[#1B6AB5]'}`} />
            <SheetTitle>{isDialler ? 'APR / Dialler Attendance' : 'Biometric Attendance'}</SheetTitle>
          </div>
          <SheetDescription>
            {date ? format(new Date(date + "T00:00:00"), "EEEE, MMMM d, yyyy") : ""}
          </SheetDescription>
        </SheetHeader>

        {isLoading && (
          <div className="space-y-3">
            {[1,2,3].map(i => <Skeleton key={i} className="h-16 rounded-xl" />)}
          </div>
        )}

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            Failed to load attendance detail.
          </div>
        )}

        {!isLoading && !error && data && !hasAnyData && (
          <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center space-y-2">
            <AlertOctagon className="h-7 w-7 text-slate-300 mx-auto" />
            <p className="text-sm font-medium text-slate-500">No attendance data found</p>
            <p className="text-xs text-slate-400">
              Biometric data is synced overnight. Please check back after the nightly sync completes.
            </p>
          </div>
        )}

        {!isLoading && !error && data && hasAnyData && (
          <div className="space-y-4">

            {/* Banner: ADR not yet processed but COSEC data exists */}
            {!adr && agg && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800 flex items-start gap-2">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>Attendance record not yet processed by the engine for this date. Showing live COSEC biometric data only.</span>
              </div>
            )}

            {/* Status row */}
            <div className="flex items-center justify-between">
              <StatusBadge status={status} />
              <div className="flex items-center gap-2">
                {isNight && (
                  <Badge className="bg-indigo-100 text-indigo-800 hover:bg-indigo-100">
                    <Moon className="mr-1 h-3 w-3" /> Night Shift
                  </Badge>
                )}
                {adr?.is_locked ? (
                  <Badge className="bg-slate-200 text-slate-700 hover:bg-slate-200">Locked</Badge>
                ) : null}
              </div>
            </div>

            {/* COSEC authoritative summary */}
            {/* Shown whenever COSEC data exists for the day, including when the row is
                tagged `dialler`. Gating this on the source verdict hid real biometric
                evidence on 1,502 August 2026 days across 451 employees — people
                classified as dialler agents by apr_eligibility_config who actually
                punch biometrically. The verdict decides which source drives payroll;
                it must not decide whether the user is allowed to see what happened. */}
            {agg && (
              <div className="rounded-xl border border-[#c4dcf5] bg-[#e8f2fc]/40 p-3 space-y-3">
                <p className="text-[10px] font-bold uppercase tracking-widest text-[#1B6AB5]">
                  COSEC Biometric Record
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-lg bg-white border border-slate-100 p-2.5">
                    <div className="flex items-center gap-1.5 text-xs text-slate-500 mb-1">
                      <LogIn className="h-3.5 w-3.5 text-emerald-600" />
                      First IN
                    </div>
                    <p className="text-base font-semibold text-slate-900">
                      {fmtTime(agg.first_punch_in)}
                    </p>
                    {agg.first_punch_in && (
                      <p className="text-[10px] text-slate-400 mt-0.5">
                        {normalizeDate(agg.first_punch_in)}
                      </p>
                    )}
                  </div>
                  <div className="rounded-lg bg-white border border-slate-100 p-2.5">
                    <div className="flex items-center gap-1.5 text-xs text-slate-500 mb-1">
                      <LogOut className="h-3.5 w-3.5 text-sky-600" />
                      Last OUT
                    </div>
                    <p className="text-base font-semibold text-slate-900">
                      {fmtTime(agg.last_punch_out)}
                    </p>
                    {agg.last_punch_out && (
                      <p className="text-[10px] text-slate-400 mt-0.5">
                        {normalizeDate(agg.last_punch_out)}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 rounded-lg bg-white border border-slate-100 px-3 py-2">
                  <Clock className="h-4 w-4 text-indigo-600" />
                  <span className="text-xs text-slate-600">Work duration</span>
                  <span className="ml-auto text-sm font-bold text-slate-900">
                    {fmtMinutes(agg.work_minutes)}
                  </span>
                  {agg.work_minutes != null && (
                    <span className="text-xs text-slate-400">({agg.work_minutes} min)</span>
                  )}
                </div>
              </div>
            )}

            {/* APR / Dialler record — real Login/Logout times from mas_hrms.apr.
                These are MySQL TIME values, so they are formatted with
                formatClockTime (never `new Date()`, which yields Invalid Date
                and was the cause of the blank login/logout columns). */}
            {apr && (
              <div className="rounded-xl border border-amber-200 bg-amber-50/40 p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-amber-700">
                    APR / Dialler Record
                  </p>
                  {apr.campaigns?.length > 1 && (
                    <span className="text-[10px] text-amber-700">
                      {apr.campaigns.length} campaigns
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-lg bg-white border border-amber-100 p-2.5">
                    <div className="flex items-center gap-1.5 text-xs text-slate-500 mb-1">
                      <LogIn className="h-3.5 w-3.5 text-emerald-600" />
                      Login Time
                    </div>
                    <p className="text-base font-semibold text-slate-900">
                      {formatClockTime(apr.login_time)}
                    </p>
                  </div>
                  <div className="rounded-lg bg-white border border-amber-100 p-2.5">
                    <div className="flex items-center gap-1.5 text-xs text-slate-500 mb-1">
                      <LogOut className="h-3.5 w-3.5 text-sky-600" />
                      Logout Time
                    </div>
                    <p className="text-base font-semibold text-slate-900">
                      {formatClockTime(apr.logout_time)}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 rounded-lg bg-white border border-amber-100 px-3 py-2">
                  <Clock className="h-4 w-4 text-indigo-600" />
                  <span className="text-xs text-slate-600">Net login</span>
                  <span className="ml-auto text-sm font-bold text-slate-900">
                    {fmtMinutes(apr.net_minutes)}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="flex justify-between rounded-lg bg-white border border-amber-100 px-2.5 py-1.5">
                    <span className="text-slate-500">Calls</span>
                    <span className="font-semibold text-slate-800">{apr.calls ?? 0}</span>
                  </div>
                  <div className="flex justify-between rounded-lg bg-white border border-amber-100 px-2.5 py-1.5">
                    <span className="text-slate-500">Lunch</span>
                    <span className="font-semibold text-slate-800">{fmtMinutes(apr.break_lunch)}</span>
                  </div>
                  <div className="flex justify-between rounded-lg bg-white border border-amber-100 px-2.5 py-1.5">
                    <span className="text-slate-500">Bio break</span>
                    <span className="font-semibold text-slate-800">{fmtMinutes(apr.break_bio)}</span>
                  </div>
                  <div className="flex justify-between rounded-lg bg-white border border-amber-100 px-2.5 py-1.5">
                    <span className="text-slate-500">Training</span>
                    <span className="font-semibold text-slate-800">{fmtMinutes(apr.break_training)}</span>
                  </div>
                </div>
              </div>
            )}

            {/* Dialler employee with no APR row for this date. */}
            {!apr && adr?.attendance_source === 'dialler' && (
              <div className="rounded-xl border border-amber-200 bg-amber-50/40 p-3 space-y-2">
                <p className="text-[10px] font-bold uppercase tracking-widest text-amber-700">
                  APR / Dialler Record
                </p>
                {adr.dialler_minutes != null ? (
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-500">Net Login</span>
                    <span className="font-semibold">{fmtMinutes(adr.dialler_minutes)}</span>
                  </div>
                ) : (
                  <p className="text-xs text-slate-500">
                    No APR record found for this date. APR syncs hourly from the dialler.
                  </p>
                )}
                {/* "No APR record" on its own reads as "no attendance", which is wrong
                    and is what made this look like missing data. If COSEC has the day,
                    say so and point at the panel that shows it. */}
                {!apr && adr.dialler_minutes == null && (agg || punches.length > 0) && (
                  <p className="text-xs text-slate-600">
                    Biometric punches <span className="font-semibold">do</span> exist for this
                    date — see the COSEC record below. This employee is configured as a
                    dialler agent, so APR drives the attendance status.
                  </p>
                )}
              </div>
            )}

            {!agg && adr?.clock_in_time && (
              <div className="rounded-xl border border-slate-200 p-3 space-y-3">
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                  HRMS Record
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-xs text-slate-500">Clock In</p>
                    <p className="font-semibold">{fmtTime(adr.clock_in_time)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">Clock Out</p>
                    <p className="font-semibold">{fmtTime(adr.clock_out_time)}</p>
                  </div>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">Duration</span>
                  <span className="font-semibold">{fmtMinutes(adr.raw_minutes)}</span>
                </div>
              </div>
            )}

            {/* LWP / late info */}
            {adr && (
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg border border-slate-100 bg-slate-50 py-2">
                  <p className="text-[10px] font-semibold uppercase text-slate-400">LWP</p>
                  <p className={`text-lg font-bold ${adr.lwp_value ? 'text-red-600' : 'text-emerald-600'}`}>
                    {adr.lwp_value ?? 0}
                  </p>
                </div>
                <div className="rounded-lg border border-slate-100 bg-slate-50 py-2">
                  <p className="text-[10px] font-semibold uppercase text-slate-400">Late Mark</p>
                  <p className={`text-lg font-bold ${adr.late_mark ? 'text-amber-600' : 'text-slate-400'}`}>
                    {adr.late_mark ? "Yes" : "No"}
                  </p>
                </div>
                <div className="rounded-lg border border-slate-100 bg-slate-50 py-2">
                  <p className="text-[10px] font-semibold uppercase text-slate-400">Late by</p>
                  <p className="text-lg font-bold text-slate-700">
                    {adr.late_by_minutes ? `${adr.late_by_minutes}m` : "--"}
                  </p>
                </div>
              </div>
            )}

            {/* Raw punch events timeline */}
            {/* Raw COSEC punch events timeline — biometric employees only. */}
            {/* Same reasoning as the COSEC panel above: a punch trail that exists is
                shown, whatever source the engine attributed the day to. */}
            {punches.length > 0 && (
              <>
                <Separator />
                <div>
                  <p className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-2">
                    {punchesAreDerived
                      ? "First / Last Punch"
                      : `All Punch Events (${punches.length})`}
                  </p>
                  {punchesAreDerived && (
                    <p className="text-[10px] text-slate-400 mb-2">
                      Derived from the day's first and last punch — per-punch detail is not
                      available for this date.
                    </p>
                  )}
                  <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
                    {punches.map((p, i) => (
                      <div
                        key={i}
                        className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm border ${
                          p.io_type === 1
                            ? 'bg-emerald-50 border-emerald-100'
                            : 'bg-sky-50 border-sky-100'
                        }`}
                      >
                        {p.io_type === 1
                          ? <LogIn  className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                          : <LogOut className="h-3.5 w-3.5 text-sky-600 shrink-0" />
                        }
                        <span className={`font-semibold text-xs ${p.io_type === 1 ? 'text-emerald-700' : 'text-sky-700'}`}>
                          {p.io_label}
                        </span>
                        <span className="font-mono text-slate-700">{fmtTime(p.punch_time)}</span>
                        <span className="text-[10px] text-slate-400 ml-auto">
                          {normalizeDate(p.punch_time)}
                        </span>
                        {p.device_id != null && (
                          <span className="text-[10px] text-slate-400">dev {p.device_id}</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}

            {punches.length === 0 && !agg && !adr && !apr && !isDialler && (
              <div className="rounded-xl border border-dashed border-slate-200 p-6 text-center text-sm text-slate-400">
                No biometric punch data found for this date.
              </div>
            )}

            {/* Source / sync info */}
            {adr && (
              <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5 text-[11px] text-slate-500 space-y-0.5">
                <div className="flex justify-between">
                  <span>Source</span>
                  <span className="font-medium text-slate-700">{adr.source_system ?? "—"} / {adr.attendance_source ?? "—"}</span>
                </div>
                {adr.processed_at && (
                  <div className="flex justify-between">
                    <span>Processed</span>
                    <span className="font-medium text-slate-700">
                      {/* Guarded: date-fns format() throws RangeError on an
                          invalid date, which blanked the entire sheet. */}
                      {safeFormat(adr.processed_at, "dd MMM yyyy HH:mm")}
                    </span>
                  </div>
                )}
              </div>
            )}

            <Separator />

            {/* Action Panel */}
            {isLocked ? (
              <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs text-slate-500">
                <Lock className="h-3.5 w-3.5" />
                Record is locked — cannot request changes
              </div>
            ) : !isPastDate ? (
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs text-slate-500">
                Actions available for past dates only
              </div>
            ) : (
              <div className="space-y-2">
                {actionSuccess && (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-xs text-emerald-700 font-semibold">
                    {actionSuccess}
                  </div>
                )}

                <div className="flex gap-2 flex-wrap">
                  <Button
                    variant={activeAction === 'regularize' ? 'default' : 'outline'}
                    size="sm"
                    className="text-xs h-8"
                    onClick={() => { setActiveAction(a => a === 'regularize' ? null : 'regularize'); setActionSuccess(null); regMutation.reset(); leaveMutation.reset(); }}
                  >
                    <FileText className="h-3.5 w-3.5 mr-1.5" />
                    Regularize
                  </Button>
                  <Button
                    variant={activeAction === 'leave' ? 'default' : 'outline'}
                    size="sm"
                    className="text-xs h-8"
                    onClick={() => { setActiveAction(a => a === 'leave' ? null : 'leave'); setActionSuccess(null); regMutation.reset(); leaveMutation.reset(); }}
                  >
                    <CalendarOff className="h-3.5 w-3.5 mr-1.5" />
                    Apply Leave
                  </Button>
                  <Button
                    variant={activeAction === 'dispute' ? 'default' : 'outline'}
                    size="sm"
                    className="text-xs h-8"
                    onClick={() => { setActiveAction(a => a === 'dispute' ? null : 'dispute'); setActionSuccess(null); regMutation.reset(); leaveMutation.reset(); }}
                  >
                    <AlertOctagon className="h-3.5 w-3.5 mr-1.5" />
                    Dispute
                  </Button>
                </div>

                {/* Regularization form */}
                {activeAction === 'regularize' && (
                  <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-3 mt-2">
                    <div className="space-y-1">
                      <Label className="text-xs">Reason Code</Label>
                      <Select value={regReasonCode} onValueChange={setRegReasonCode}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select reason code (optional)" /></SelectTrigger>
                        <SelectContent className="bg-white border border-slate-200 shadow-md z-[9999]">
                          {reasonCodes.map(r => <SelectItem key={r.code} value={r.code} className="text-xs text-slate-900 hover:bg-slate-100">{r.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Requested Status</Label>
                      <Select value={regStatus} onValueChange={(v) => setRegStatus(v as 'present' | 'half_day')}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent className="bg-white border border-slate-200 shadow-md z-[9999]">
                          <SelectItem value="present" className="text-xs text-slate-900">Present</SelectItem>
                          <SelectItem value="half_day" className="text-xs text-slate-900">Half Day</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Reason <span className="text-red-500">*</span></Label>
                      <Textarea
                        className="text-xs min-h-[60px]"
                        placeholder="Describe why this correction is needed..."
                        value={regReason}
                        onChange={e => setRegReason(e.target.value)}
                      />
                    </div>
                    <Button
                      size="sm" className="w-full text-xs h-8"
                      disabled={!regReason.trim() || regMutation.isPending}
                      onClick={handleRegularizeSubmit}
                    >
                      {regMutation.isPending ? 'Submitting...' : 'Submit Regularization'}
                    </Button>
                    {regMutation.isError && (
                      <p className="text-xs text-red-600">{(regMutation.error as Error)?.message}</p>
                    )}
                  </div>
                )}

                {/* Leave form */}
                {activeAction === 'leave' && (
                  <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-3 mt-2">
                    <div className="space-y-1">
                      <Label className="text-xs">Leave Type <span className="text-red-500">*</span></Label>
                      <Select value={leaveTypeId} onValueChange={setLeaveTypeId}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select leave type" /></SelectTrigger>
                        <SelectContent className="bg-white border border-slate-200 shadow-md z-[9999]">
                          {leaveTypes.map(lt => <SelectItem key={lt.id} value={lt.id} className="text-xs text-slate-900 hover:bg-slate-100">{lt.leave_name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        id="half-day-toggle"
                        checked={leaveIsHalf}
                        onChange={e => setLeaveIsHalf(e.target.checked)}
                        className="h-3.5 w-3.5"
                      />
                      <Label htmlFor="half-day-toggle" className="text-xs cursor-pointer">Half day</Label>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Reason (optional)</Label>
                      <Textarea
                        className="text-xs min-h-[60px]"
                        placeholder="Reason for leave..."
                        value={leaveReason}
                        onChange={e => setLeaveReason(e.target.value)}
                      />
                    </div>
                    <Button
                      size="sm" className="w-full text-xs h-8"
                      disabled={!leaveTypeId || leaveMutation.isPending}
                      onClick={handleLeaveSubmit}
                    >
                      {leaveMutation.isPending ? 'Submitting...' : 'Submit Leave Request'}
                    </Button>
                    {leaveMutation.isError && (
                      <p className="text-xs text-red-600">{(leaveMutation.error as Error)?.message}</p>
                    )}
                  </div>
                )}

                {/* Dispute form */}
                {activeAction === 'dispute' && (
                  <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-3 mt-2">
                    <div className="space-y-1">
                      <Label className="text-xs">Dispute Type <span className="text-red-500">*</span></Label>
                      <Select value={disputeType} onValueChange={setDisputeType}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select dispute type" /></SelectTrigger>
                        <SelectContent className="bg-white border border-slate-200 shadow-md z-[9999]">
                          <SelectItem value="missing_punch" className="text-xs text-slate-900">Missing Punch</SelectItem>
                          <SelectItem value="wrong_punch" className="text-xs text-slate-900">Wrong Punch</SelectItem>
                          <SelectItem value="late_mark_dispute" className="text-xs text-slate-900">Late Mark Dispute</SelectItem>
                          <SelectItem value="early_logout_dispute" className="text-xs text-slate-900">Early Logout Dispute</SelectItem>
                          <SelectItem value="half_day_dispute" className="text-xs text-slate-900">Half Day Dispute</SelectItem>
                          <SelectItem value="absent_wrongly_marked" className="text-xs text-slate-900">Absent Wrongly Marked</SelectItem>
                          <SelectItem value="week_off_worked" className="text-xs text-slate-900">Week Off Worked</SelectItem>
                          <SelectItem value="holiday_worked" className="text-xs text-slate-900">Holiday Worked</SelectItem>
                          <SelectItem value="shift_mismatch" className="text-xs text-slate-900">Shift Mismatch</SelectItem>
                          <SelectItem value="cosec_sync_issue" className="text-xs text-slate-900">COSEC Sync Issue</SelectItem>
                          <SelectItem value="manual_punch_correction" className="text-xs text-slate-900">Manual Punch Correction</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {(disputeType === 'missing_punch' || disputeType === 'wrong_punch') && (
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <Label className="text-xs">New Punch In</Label>
                          <Input type="time" className="h-8 text-xs" value={disputeNewIn} onChange={e => setDisputeNewIn(e.target.value)} />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">New Punch Out</Label>
                          <Input type="time" className="h-8 text-xs" value={disputeNewOut} onChange={e => setDisputeNewOut(e.target.value)} />
                        </div>
                      </div>
                    )}
                    <div className="space-y-1">
                      <Label className="text-xs">Reason <span className="text-red-500">*</span></Label>
                      <Textarea
                        className="text-xs min-h-[60px]"
                        placeholder="Describe the issue..."
                        value={disputeReason}
                        onChange={e => setDisputeReason(e.target.value)}
                      />
                    </div>
                    <Button
                      size="sm" className="w-full text-xs h-8"
                      disabled={!disputeType || !disputeReason.trim() || regMutation.isPending}
                      onClick={handleDisputeSubmit}
                    >
                      {regMutation.isPending ? 'Submitting...' : 'File Dispute'}
                    </Button>
                    {regMutation.isError && (
                      <p className="text-xs text-red-600">{(regMutation.error as Error)?.message}</p>
                    )}
                  </div>
                )}
              </div>
            )}

          </div>
        )}

        {!isLoading && !error && !data?.attendance_record && !data?.cosec_daily_agg && (
          <div className="rounded-xl border border-dashed border-slate-200 p-8 text-center">
            <CalendarIcon className="mx-auto h-8 w-8 text-slate-300 mb-2" />
            <p className="text-sm text-slate-500">No attendance record for this date.</p>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export function AttendanceCalendar({
  employeeId,
  month,
  year,
  onMonthChange,
  hideNavigator = false,
  initialMonth,
  initialYear,
  records,
  recordsLoading = false,
  sourceLabel,
}: AttendanceCalendarProps) {
  // Caller-fed mode: the grid renders `records` and issues no month queries of its own.
  const usesProvidedRecords = records != null;
  const today = new Date();
  // IST "today" — toISOString() is UTC and lands on the wrong day between
  // 00:00 and 05:30 IST, which used to put the "today" ring on the previous day.
  const todayIst = istTodayString();

  const [uncontrolledMonth, setUncontrolledMonth] = useState(initialMonth ?? today.getMonth());
  const [uncontrolledYear,  setUncontrolledYear]  = useState(initialYear  ?? today.getFullYear());

  // Controlled when the parent passes month/year, so the page's navigator and the
  // grid can never drift apart (previously props were init-only and desynced).
  const isControlled = month != null && year != null;
  const currentMonth = isControlled ? (month as number) : uncontrolledMonth;
  const currentYear  = isControlled ? (year as number)  : uncontrolledYear;

  const setMonthYear = (m: number, y: number) => {
    if (!isControlled) { setUncontrolledMonth(m); setUncontrolledYear(y); }
    onMonthChange?.(m, y);
  };

  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [sheetOpen,    setSheetOpen]    = useState(false);

  // Which system drives this employee's attendance — APR (dialler) or COSEC
  // (biometric). Previously the calendar always read biometric, so dialler
  // employees saw COSEC data that did not belong to them.
  const { data: sourceInfo, isError: sourceError } = useQuery<{
    attendance_source: AttendanceSource;
    source_label: string;
    sync_interval_note?: string;
  }>({
    queryKey: ["attendance-source", employeeId],
    queryFn: async () => {
      const res = await hrmsApi.get<{ success: boolean; data: any }>(
        `/api/wfm/attendance/attendance-source/${employeeId}`
      );
      return res.data;
    },
    enabled: !!employeeId && !usesProvidedRecords,
    staleTime: 10 * 60_000,
  });
  const source: AttendanceSource = sourceInfo?.attendance_source ?? "biometric";

  // Fetch monthly attendance data for calendar colouring
  const {
    data: fetchedData = [],
    isLoading: fetchLoading,
    isError: fetchError,
    refetch,
    dataUpdatedAt,
  } = useQuery<AttendanceDay[]>({
    queryKey: ["attendance-calendar", employeeId, currentYear, currentMonth, source],
    queryFn: async () => {
      const startDate = fmtDate(currentYear, currentMonth, 1);
      const endDate   = fmtDate(currentYear, currentMonth, getDaysInMonth(currentYear, currentMonth));
      const params = new URLSearchParams({ employeeId, fromDate: startDate, toDate: endDate });

      if (source === "dialler") {
        const aprRes = await hrmsApi.get<{ success: boolean; data: any[] }>(
          `/api/wfm/attendance/apr-monthly?${params}`
        );
        return (aprRes.data || []).map((r: any) => ({
          date:         normalizeDate(r.record_date),
          status:       normalizeStatus(r.attendance_status),
          // login_at/logout_at are IST-tagged datetimes, safe for fmtTime.
          punchIn:      r.login_at ?? undefined,
          punchOut:     r.logout_at ?? undefined,
          rawMinutes:   r.net_minutes != null ? Number(r.net_minutes) : undefined,
          lwpValue:     r.lwp_value   != null ? Number(r.lwp_value)   : undefined,
          sourceSystem: r.source_system ?? "apr",
          isNightShift: detectNightShift(r.login_at, r.logout_at),
        }));
      }

      params.set("limit", "100");
      const res = await hrmsApi.get<{ success: boolean; data: any[] }>(
        `/api/wfm/attendance/ncosec-monthly?${params}`
      );
      return (res.data || []).map((r: any) => ({
        date:        normalizeDate(r.date || r.record_date),
        status:      normalizeStatus(r.status || r.attendance_status),
        punchIn:     r.clock_in || r.clock_in_time || r.first_punch_in,
        punchOut:    r.clock_out || r.clock_out_time || r.last_punch_out,
        rawMinutes:  r.raw_minutes != null ? Number(r.raw_minutes) : undefined,
        lwpValue:    r.lwp_value   != null ? Number(r.lwp_value)   : undefined,
        sourceSystem: r.source_system,
        isNightShift: detectNightShift(r.clock_in_time || r.first_punch_in, r.clock_out_time || r.last_punch_out),
      }));
    },
    enabled: !!employeeId && !!sourceInfo && !usesProvidedRecords,
    // Overrides the app-wide default (false): coming back to this tab should
    // re-check against COSEC/APR rather than show whatever was last fetched,
    // since the underlying sync runs independently on its own schedule.
    refetchOnWindowFocus: true,
  });

  const attendanceData = usesProvidedRecords ? records! : fetchedData;
  // The grid query is gated on `sourceInfo`, so when /attendance-source fails the
  // query simply never runs: not loading, not errored, zero rows — a whole month
  // rendered as absences with nothing to indicate a failed request. Treat a failed
  // source lookup as an error of the grid itself.
  const isLoading = usesProvidedRecords
    ? recordsLoading
    // `!!employeeId` keeps a component mounted without one from spinning forever —
    // both queries are disabled in that case, so there is nothing to wait for.
    : (fetchLoading || (!!employeeId && !sourceInfo && !sourceError));
  const isError = usesProvidedRecords ? false : (fetchError || sourceError);

  const attendanceMap = new Map<string, AttendanceDay>(
    attendanceData.map(d => [d.date, d])
  );

  const daysInMonth    = getDaysInMonth(currentYear, currentMonth);
  const firstDayOffset = getFirstDayOfMonth(currentYear, currentMonth);
  const calendarDays: (number | null)[] = [
    ...Array(firstDayOffset).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  const prevMonth = () => {
    if (currentMonth === 0) setMonthYear(11, currentYear - 1);
    else setMonthYear(currentMonth - 1, currentYear);
  };
  const nextMonth = () => {
    if (currentMonth === 11) setMonthYear(0, currentYear + 1);
    else setMonthYear(currentMonth + 1, currentYear);
  };

  const handleDayClick = (day: number) => {
    setSelectedDate(fmtDate(currentYear, currentMonth, day));
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

  // A failed fetch must not look like a month of genuine absences.
  if (isError) {
    return (
      <Card>
        <CardContent className="py-10 text-center space-y-3">
          <p className="text-sm font-medium text-red-700">Could not load attendance for this month.</p>
          <p className="text-xs text-slate-500">
            {sourceError
              ? "Could not determine which attendance source drives this employee."
              : `The ${source === "dialler" ? "APR / dialler" : "biometric"} source did not respond.`}
          </p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>Retry</Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card className="overflow-hidden">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CardTitle className="text-base">{MONTHS[currentMonth]} {currentYear}</CardTitle>
              <Badge
                className={!usesProvidedRecords && source === "dialler"
                  ? "bg-amber-100 text-amber-800 hover:bg-amber-100"
                  : "bg-[#e8f2fc] text-[#1B6AB5] hover:bg-[#e8f2fc]"}
              >
                {/* In caller-fed mode the server's source verdict is never fetched, so
                    the badge must not claim "Direct COSEC" over data that did not
                    come from COSEC. */}
                {usesProvidedRecords
                  ? (sourceLabel ?? "HRMS Record")
                  : (sourceInfo?.source_label ?? (source === "dialler" ? "APR / Dialler" : "Direct COSEC"))}
              </Badge>
              {/* The underlying sync (5 min COSEC / hourly APR) lags real time
                  regardless of how fresh the browser's own fetch is — surface
                  both so "why does this look old" has a visible answer instead
                  of appearing to be a bug. */}
              {!usesProvidedRecords && (sourceInfo?.sync_interval_note || dataUpdatedAt) && (
                <span className="text-[11px] text-slate-400" title={sourceInfo?.sync_interval_note}>
                  {sourceInfo?.sync_interval_note}
                  {sourceInfo?.sync_interval_note && dataUpdatedAt ? " · " : ""}
                  {dataUpdatedAt ? formatLastSynced(dataUpdatedAt) : ""}
                </span>
              )}
            </div>
            {!hideNavigator && (
            <div className="flex gap-1.5">
              <Button variant="outline" size="sm" onClick={() => setMonthYear(today.getMonth(), today.getFullYear())}>
                <CalendarIcon className="mr-1.5 h-3.5 w-3.5" />Today
              </Button>
              <Button variant="outline" size="icon" className="h-8 w-8" onClick={prevMonth}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="icon" className="h-8 w-8" onClick={nextMonth}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
            )}
          </div>

          {/* Legend */}
          <div className="flex flex-wrap gap-3 pt-1 text-xs text-slate-600">
            {[
              { status: "present" as DayStatus,  label: "Present",   dot: "bg-emerald-500" },
              { status: "absent"  as DayStatus,  label: "Absent",    dot: "bg-red-500"     },
              { status: "half_day" as DayStatus, label: "Half Day",  dot: "bg-amber-500"   },
              { status: "missing_punch" as DayStatus, label: "Missing Punch", dot: "bg-orange-500" },
              { status: "leave"   as DayStatus,  label: "Leave",     dot: "bg-blue-500"    },
              { status: "holiday" as DayStatus,  label: "Holiday",   dot: "bg-purple-500"  },
              { status: "weekend" as DayStatus,  label: "Weekend",   dot: "bg-slate-400"   },
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
              const record    = attendanceMap.get(dateStr);
              const dayOfWeek = new Date(currentYear, currentMonth, day).getDay();
              const isWknd    = dayOfWeek === 0 || dayOfWeek === 6;
              const isToday   = dateStr === todayIst;
              const isFuture  = dateStr > todayIst;
              // A future date has no attendance yet — it must not paint as "Absent".
              //
              // In caller-fed mode the rows are the engine's own output, where a
              // missing row means "no record written for this day" — not a confirmed
              // absence. Painting it red is the same silent-failure that made an empty
              // month indistinguishable from a month of genuine absences, so an
              // unbacked day stays the neutral "unreconciled" state.
              const missingDayStatus: DayStatus = usesProvidedRecords ? "unreconciled" : "absent";
              const status    = record?.status ?? (isWknd ? "weekend" : isFuture ? "unreconciled" : missingDayStatus);

              if (isFuture && !record) {
                return (
                  <div
                    key={day}
                    className="min-h-[72px] rounded-xl border-2 border-dashed border-slate-100 bg-slate-50/40 p-1.5 text-left select-none"
                    title={`${dateStr} — upcoming`}
                  >
                    <span className="text-xs font-bold text-slate-300">{day}</span>
                  </div>
                );
              }

              return (
                <button
                  key={day}
                  onClick={() => handleDayClick(day)}
                  className={cellStyle(status, isToday)}
                  title={`${dateStr} — ${status}`}
                >
                  <div className="flex items-center justify-between mb-0.5">
                    <span className={`text-xs font-bold ${isToday ? 'text-[#1B6AB5]' : 'text-slate-700'}`}>{day}</span>
                    <StatusIcon status={status} />
                  </div>
                  {record?.punchIn && (
                    <div className="text-[10px] text-slate-500 leading-tight">
                      {fmtTime(record.punchIn).replace(" AM","a").replace(" PM","p")}
                    </div>
                  )}
                  {record?.rawMinutes != null && record.rawMinutes > 0 && (
                    <div className="text-[10px] font-semibold text-slate-600 leading-tight">
                      {fmtMinutes(record.rawMinutes)}
                    </div>
                  )}
                  {record?.isNightShift && (
                    <Moon className="h-2.5 w-2.5 text-indigo-400 mt-0.5" />
                  )}
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <DayDetailSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        employeeId={employeeId}
        date={selectedDate}
      />
    </>
  );
}
