import { startTransition, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { Coffee, Filter, LogIn, LogOut, RefreshCw, Search, ShieldCheck, TimerReset, UserRound } from "lucide-react";
import mcnLogo from "@/assets/brand/mcn-logo.png";
import { apiUrl } from "@/lib/apiBase";
import { cn } from "@/lib/utils";

type Option = { value: string; label: string };

type FiltersState = {
  search: string;
  branch_id: string;
  process_id: string;
  department_id: string;
  manager_id: string;
  shift: string;
  status: string;
};

type DeskSession = {
  id: string;
  break_start_time: string | null;
  break_end_time: string | null;
  duration_minutes: number | null;
  break_type: string | null;
  break_reason: string;
  status: string;
  exception_reason: string | null;
};

type DeskEmployee = {
  employee_id: string;
  employee_code: string;
  employee_name: string;
  avatar_url: string | null;
  branch_id?: string | null;
  process_id?: string | null;
  department_id?: string | null;
  manager_id?: string | null;
  branch_name: string | null;
  process_name: string | null;
  department_name: string | null;
  designation_name: string | null;
  manager_name: string | null;
  biometric_id: string;
  biometric_punch_in_time: string | null;
  biometric_punch_out_time: string | null;
  biometric_minutes: number;
  attendance_source_system: string | null;
  shift_name: string | null;
  shift_start_time: string | null;
  shift_end_time: string | null;
  shift_duration_minutes: number;
  roster_status: string | null;
  leave_name: string | null;
  total_break_minutes: number;
  total_break_minutes_overall?: number;
  mini_break_count: number;
  long_break_count: number;
  total_break_count: number;
  remaining_daily_break_minutes?: number;
  daily_break_limit_minutes?: number;
  per_break_limit_minutes?: number;
  last_break_reason: string | null;
  active_break_id: string | null;
  active_break_start_time: string | null;
  active_break_minutes: number;
  no_biometric_punch_flag: boolean;
  manager_approval_required: boolean;
  current_status: string;
  current_status_tone: string;
  exceeded_minutes: number;
  today_sessions: DeskSession[];
  safe_actions: {
    can_punch_in: boolean;
    can_punch_out: boolean;
    can_start_break: boolean;
    can_end_break: boolean;
    exception_start_allowed: boolean;
  };
};

type BreakDeskBootstrap = {
  kiosk: {
    kiosk_code: string;
    kiosk_name: string;
    branch_name: string | null;
    process_name: string | null;
  };
  shift_date: string;
  last_sync_time: string | null;
  counters: Record<string, number>;
  settings: {
    mini_break_max_minutes: number;
    long_break_min_minutes: number;
    active_break_alert_minutes: number;
    daily_total_allowed_minutes: number;
    allow_break_without_biometric: number;
    require_exception_reason: number;
  };
  filters: {
    branches: Option[];
    processes: Option[];
    departments: Option[];
    managers: Option[];
    shifts: Option[];
    statuses: Option[];
    breakReasons: Option[];
  };
};

type DeskEmployeesResponse = {
  shift_date: string;
  last_sync_time: string | null;
  counters: Record<string, number>;
  employees: DeskEmployee[];
};

type DeskActionResponse = {
  employee?: DeskEmployee | null;
};

const ACCESS_KEY = "hrms-break-desk-access";
const DEFAULT_FILTERS: FiltersState = {
  search: "",
  branch_id: "",
  process_id: "",
  department_id: "",
  manager_id: "",
  shift: "",
  status: "",
};

function formatStamp(value: string | null | undefined) {
  if (!value) return "-";
  const parsed = new Date(String(value).replace(" ", "T") + (String(value).includes("+") ? "" : "+05:30"));
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

function formatClock(date: Date) {
  return date.toLocaleTimeString("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function formatDate(date: Date) {
  return date.toLocaleDateString("en-IN", {
    timeZone: "Asia/Kolkata",
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatMinutes(totalMinutes: number) {
  if (!Number.isFinite(totalMinutes) || totalMinutes <= 0) return "0m";
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function liveMinutes(startAt: string | null, endAt?: string | null) {
  if (!startAt) return 0;
  const start = new Date(String(startAt).replace(" ", "T") + (String(startAt).includes("+") ? "" : "+05:30"));
  if (Number.isNaN(start.getTime())) return 0;
  const end = endAt
    ? new Date(String(endAt).replace(" ", "T") + (String(endAt).includes("+") ? "" : "+05:30"))
    : new Date();
  const endMs = Number.isNaN(end.getTime()) ? Date.now() : end.getTime();
  return Math.max(0, Math.floor((endMs - start.getTime()) / 60000));
}

function formatLiveDuration(startAt: string | null, endAt?: string | null, fallbackMinutes = 0) {
  return formatMinutes(startAt ? liveMinutes(startAt, endAt) : fallbackMinutes);
}

function statusTone(status: string) {
  switch (status) {
    case "On Duty":
      return "bg-emerald-500/12 text-emerald-700 ring-emerald-500/20";
    case "On Break":
      return "bg-amber-500/12 text-amber-700 ring-amber-500/20";
    case "Break Exceeded":
      return "bg-rose-500/12 text-rose-700 ring-rose-500/20";
    case "Shift Completed":
      return "bg-sky-500/12 text-sky-700 ring-sky-500/20";
    case "Leave":
      return "bg-fuchsia-500/12 text-fuchsia-700 ring-fuchsia-500/20";
    case "W/O":
      return "bg-slate-500/12 text-slate-700 ring-slate-500/20";
    default:
      return "bg-zinc-500/12 text-zinc-700 ring-zinc-500/20";
  }
}

function buildQuery(access: { kiosk: string; token: string }) {
  const params = new URLSearchParams({
    kiosk: access.kiosk,
    token: access.token,
    limit: "500",
  });
  return params.toString();
}

function filterDeskEmployees(employees: DeskEmployee[], filters: FiltersState, searchText: string) {
  const normalizedSearch = searchText.trim().toLocaleLowerCase();
  return employees.filter((employee) => {
    if (filters.branch_id && employee.branch_id !== filters.branch_id) {
      return false;
    }
    if (filters.process_id && employee.process_id !== filters.process_id) {
      return false;
    }
    if (filters.department_id && employee.department_id !== filters.department_id) {
      return false;
    }
    if (filters.manager_id && employee.manager_id !== filters.manager_id) {
      return false;
    }
    if (filters.shift && employee.shift_name !== filters.shift) {
      return false;
    }
    if (filters.status && employee.current_status !== filters.status) {
      return false;
    }
    if (!normalizedSearch) {
      return true;
    }

    const haystack = [
      employee.employee_name,
      employee.employee_code,
      employee.biometric_id,
      employee.process_name,
      employee.department_name,
      employee.branch_name,
      employee.manager_name,
      employee.designation_name,
    ]
      .filter(Boolean)
      .join(" ")
      .toLocaleLowerCase();

    return haystack.includes(normalizedSearch);
  });
}

function buildCounters(employees: DeskEmployee[]) {
  return {
    entered: employees.filter((row) => Boolean(row.biometric_punch_in_time)).length,
    onDuty: employees.filter((row) => row.current_status === "On Duty").length,
    onBreak: employees.filter((row) => row.current_status === "On Break").length,
    breakExceeded: employees.filter((row) => row.current_status === "Break Exceeded").length,
    miniBreaksToday: employees.reduce((sum, row) => sum + Number(row.mini_break_count ?? 0), 0),
    longBreaksToday: employees.reduce((sum, row) => sum + Number(row.long_break_count ?? 0), 0),
    totalBreaksToday: employees.reduce((sum, row) => sum + Number(row.total_break_count ?? 0), 0),
    totalBreakMinutesToday: employees.reduce((sum, row) => sum + totalBreakMinutesForDisplay(row), 0),
    totalShiftMinutesToday: employees.reduce((sum, row) => sum + Number(row.shift_duration_minutes ?? 0), 0),
    noPunchFound: employees.filter((row) => row.current_status === "No Punch Found").length,
    shiftCompleted: employees.filter((row) => row.current_status === "Shift Completed").length,
  };
}

function totalBreakMinutesForDisplay(employee: DeskEmployee) {
  if (typeof employee.total_break_minutes_overall === "number") return Number(employee.total_break_minutes_overall ?? 0);
  return Number(employee.total_break_minutes ?? 0) + (employee.active_break_id ? liveMinutes(employee.active_break_start_time) : 0);
}

function shiftLabelForDisplay(employee: DeskEmployee) {
  return employee.shift_name?.trim() || "Shift not mapped";
}

function mergeDeskEmployee(current: DeskEmployeesResponse | null, employee: DeskEmployee) {
  if (!current) return current;
  const nextEmployees = current.employees.map((row) => (row.employee_id === employee.employee_id ? employee : row));
  return {
    ...current,
    employees: nextEmployees,
    counters: buildCounters(nextEmployees),
  };
}

function Modal({
  open,
  title,
  subtitle,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-sm">
      <div className="w-full max-w-3xl rounded-[28px] border border-white/50 bg-white shadow-[0_32px_80px_rgba(15,23,42,0.22)]">
        <div className="flex items-start justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <h3 className="text-lg font-bold text-slate-900" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>{title}</h3>
            {subtitle ? <p className="mt-1 text-sm text-slate-500">{subtitle}</p> : null}
          </div>
          <button onClick={onClose} className="rounded-full border border-slate-200 px-3 py-1.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-50">
            Close
          </button>
        </div>
        <div className="max-h-[78vh] overflow-auto px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

export default function BreakDesk() {
  const [searchParams] = useSearchParams();
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const savedAccess = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem(ACCESS_KEY) ?? "null") as { kiosk?: string; token?: string } | null;
    } catch {
      return null;
    }
  }, []);

  const [access, setAccess] = useState<{ kiosk: string; token: string }>({
    kiosk: searchParams.get("kiosk") ?? savedAccess?.kiosk ?? "",
    token: searchParams.get("token") ?? savedAccess?.token ?? "",
  });
  const [accessDraft, setAccessDraft] = useState(access);
  const [bootstrap, setBootstrap] = useState<BreakDeskBootstrap | null>(null);
  const [deskData, setDeskData] = useState<DeskEmployeesResponse | null>(null);
  const [filters, setFilters] = useState<FiltersState>(DEFAULT_FILTERS);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [actingRowId, setActingRowId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [clock, setClock] = useState(new Date());
  const [selectedEmployee, setSelectedEmployee] = useState<DeskEmployee | null>(null);
  const requestSequenceRef = useRef(0);

  const deferredSearch = useDeferredValue(filters.search);

  const fetchBootstrap = useCallback(async (nextAccess: { kiosk: string; token: string }) => {
    if (!nextAccess.kiosk || !nextAccess.token) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(apiUrl(`/api/break-desk/bootstrap?kiosk=${encodeURIComponent(nextAccess.kiosk)}&token=${encodeURIComponent(nextAccess.token)}`));
      const payload = await response.json();
      if (!response.ok || !payload?.success) throw new Error(payload?.message || payload?.error || "Access validation failed");
      setBootstrap(payload.data);
      localStorage.setItem(ACCESS_KEY, JSON.stringify(nextAccess));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to open break desk";
      setBootstrap(null);
      setDeskData(null);
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchEmployees = useCallback(async (live = false) => {
    if (!access.kiosk || !access.token || !bootstrap) return;
    if (live) setRefreshing(true);
    else setLoading(true);
    const requestId = ++requestSequenceRef.current;
    try {
      const query = buildQuery(access);
      const endpoint = live ? "/api/break-desk/live-status" : "/api/break-desk/employees";
      const response = await fetch(apiUrl(`${endpoint}?${query}`));
      const payload = await response.json();
      if (!response.ok || !payload?.success) throw new Error(payload?.message || payload?.error || "Failed to load break desk");
      if (requestId !== requestSequenceRef.current) return;
      setDeskData(payload.data);
      setError(null);
    } catch (err) {
      if (requestId !== requestSequenceRef.current) return;
      const message = err instanceof Error ? err.message : "Failed to refresh break desk";
      setError(message);
      if (!live) toast.error(message);
    } finally {
      if (requestId === requestSequenceRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [access, bootstrap]);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (access.kiosk && access.token) void fetchBootstrap(access);
  }, [access, fetchBootstrap]);

  useEffect(() => {
    if (bootstrap) void fetchEmployees(false);
  }, [bootstrap, fetchEmployees]);

  useEffect(() => {
    if (!bootstrap) return;
    const timer = window.setInterval(() => void fetchEmployees(true), 15000);
    return () => window.clearInterval(timer);
  }, [bootstrap, fetchEmployees]);

  useEffect(() => {
    if (!bootstrap) return;
    window.setTimeout(() => searchInputRef.current?.focus(), 80);
  }, [bootstrap]);

  const allEmployees = deskData?.employees ?? [];
  const employees = useMemo(
    () => filterDeskEmployees(allEmployees, filters, deferredSearch),
    [allEmployees, deferredSearch, filters],
  );
  const counters = useMemo(
    () => (employees.length > 0 || filters.status || deferredSearch.trim() || filters.branch_id || filters.process_id || filters.department_id || filters.manager_id || filters.shift
      ? buildCounters(employees)
      : (deskData?.counters ?? bootstrap?.counters ?? {})),
    [bootstrap?.counters, deferredSearch, deskData?.counters, employees, filters],
  );
  const statusMetrics = [
    { label: "Entered", value: counters.entered ?? 0, icon: LogIn },
    { label: "On Duty", value: counters.onDuty ?? 0, icon: ShieldCheck },
    { label: "On Break", value: counters.onBreak ?? 0, icon: Coffee },
    { label: "Exceeded", value: counters.breakExceeded ?? 0, icon: TimerReset },
    { label: "No Punch", value: counters.noPunchFound ?? 0, icon: UserRound },
  ];
  const summaryMetrics = [
    { label: "Total Breaks", value: String(counters.totalBreaksToday ?? 0) },
    { label: "Mini", value: String(counters.miniBreaksToday ?? 0) },
    { label: "Long", value: String(counters.longBreaksToday ?? 0) },
    { label: "Break Min", value: formatMinutes(Number(counters.totalBreakMinutesToday ?? 0)) },
    { label: "Shift Time", value: formatMinutes(Number(counters.totalShiftMinutesToday ?? 0)) },
    { label: "Daily Max", value: formatMinutes(Number(bootstrap?.settings.daily_total_allowed_minutes ?? 60)) },
    { label: "Per Break", value: formatMinutes(Number(bootstrap?.settings.active_break_alert_minutes ?? 30)) },
  ];

  const activeDeskName = bootstrap?.kiosk.kiosk_name ?? "Break Management Desk";
  const scopeLabel = [bootstrap?.kiosk.branch_name, bootstrap?.kiosk.process_name].filter(Boolean).join(" | ");

  useEffect(() => {
    if (!selectedEmployee) return;
    const fresh = allEmployees.find((employee) => employee.employee_id === selectedEmployee.employee_id);
    if (fresh) {
      setSelectedEmployee(fresh);
      return;
    }
    setSelectedEmployee(null);
  }, [allEmployees, selectedEmployee]);

  const resetAccess = () => {
    localStorage.removeItem(ACCESS_KEY);
    setBootstrap(null);
    setDeskData(null);
    setAccess({ kiosk: "", token: "" });
    setAccessDraft({ kiosk: "", token: "" });
    setError(null);
  };

  const runAction = useCallback(async (employee: DeskEmployee, endpoint: string, successMessage: string, extraBody?: Record<string, unknown>) => {
    setActingRowId(employee.employee_id);
    try {
      const response = await fetch(apiUrl(endpoint), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kiosk: access.kiosk,
          token: access.token,
          employee_id: employee.employee_id,
          ...extraBody,
        }),
      });
      const payload = await response.json();
      if (!response.ok || !payload?.success) throw new Error(payload?.message || payload?.error || "Action failed");
      const nextEmployee = (payload?.data as DeskActionResponse | undefined)?.employee ?? null;
      requestSequenceRef.current += 1;
      if (nextEmployee) {
        setDeskData((current) => mergeDeskEmployee(current, nextEmployee));
      }
      setError(null);
      toast.success(successMessage);
      void fetchEmployees(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Action failed");
    } finally {
      setActingRowId(null);
    }
  }, [access.kiosk, access.token, fetchEmployees]);

  const kioskProcessLocked = Boolean(bootstrap?.kiosk.process_name);
  const kioskBranchLocked = Boolean(bootstrap?.kiosk.branch_name);
  const branchOptions = useMemo(
    () => bootstrap?.filters.branches.map((option) => ({ ...option, value: option.value, label: option.label })) ?? [],
    [bootstrap?.filters.branches],
  );
  const processOptions = useMemo(
    () => bootstrap?.filters.processes.map((option) => ({ ...option, value: option.value, label: option.label })) ?? [],
    [bootstrap?.filters.processes],
  );
  const departmentOptions = useMemo(
    () => bootstrap?.filters.departments.map((option) => ({ ...option, value: option.value, label: option.label })) ?? [],
    [bootstrap?.filters.departments],
  );
  const managerOptions = useMemo(
    () => bootstrap?.filters.managers.map((option) => ({ ...option, value: option.value, label: option.label })) ?? [],
    [bootstrap?.filters.managers],
  );
  const shiftOptions = useMemo(
    () => bootstrap?.filters.shifts.map((option) => ({ ...option, value: option.value, label: option.label })) ?? [],
    [bootstrap?.filters.shifts],
  );

  return (
    <>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@500;600&display=swap');`}</style>
      <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(20,93,160,0.18),transparent_28%),radial-gradient(circle_at_top_right,rgba(67,160,71,0.16),transparent_24%),radial-gradient(circle_at_bottom_right,rgba(231,81,73,0.14),transparent_32%),linear-gradient(160deg,#f7fbff_0%,#eef6fb_48%,#f9fbfd_100%)] text-slate-900" style={{ fontFamily: "'IBM Plex Sans', sans-serif" }}>
        {!bootstrap ? (
          <div className="mx-auto flex min-h-screen max-w-6xl items-center justify-center px-4 py-8">
            <div className="grid w-full max-w-5xl gap-5 lg:grid-cols-[1.1fr_0.9fr]">
              <div className="relative overflow-hidden rounded-[32px] border border-white/70 bg-[linear-gradient(150deg,#0a2c60_0%,#145da0_42%,#1b6ab5_100%)] p-6 text-white shadow-[0_30px_80px_rgba(20,93,160,0.25)]">
                <div className="absolute -right-16 top-0 h-52 w-52 rounded-full bg-emerald-400/20 blur-3xl" />
                <div className="absolute bottom-0 left-0 h-48 w-48 rounded-full bg-rose-400/20 blur-3xl" />
                <img src={mcnLogo} alt="MCN" className="relative mb-5 h-11 w-auto" />
                <p className="mb-2 text-xs font-semibold uppercase tracking-[0.28em] text-white/75">Security Desk / Biometric Floor Control</p>
                <h1 className="max-w-xl text-4xl font-bold leading-tight tracking-[-0.04em]" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>Punch and break operations in one fast desk view.</h1>
                <p className="mt-4 max-w-xl text-sm leading-6 text-white/82">Built for guards: simple toggle buttons, compact table layout, live punch state, live break state, and backend-driven break counts.</p>
              </div>

              <div className="rounded-[32px] border border-slate-200 bg-white/92 p-6 shadow-[0_18px_60px_rgba(15,23,42,0.08)] backdrop-blur">
                <div className="mb-4 flex items-center gap-3">
                  <div className="rounded-2xl bg-[#145da0]/10 p-3 text-[#145da0]"><ShieldCheck className="h-5 w-5" /></div>
                  <div>
                    <h2 className="text-2xl font-bold tracking-[-0.03em]" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>Open Break Desk</h2>
                    <p className="text-sm text-slate-500">Use the kiosk code and secure token.</p>
                  </div>
                </div>
                <div className="space-y-4">
                  <div>
                    <label className="mb-2 block text-[12px] font-semibold uppercase tracking-[0.18em] text-slate-500">Kiosk Code</label>
                    <input value={accessDraft.kiosk} onChange={(event) => setAccessDraft((current) => ({ ...current, kiosk: event.target.value }))} className="h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm outline-none transition focus:border-[#145da0] focus:bg-white" placeholder="NOIDA-FLOOR-1" />
                  </div>
                  <div>
                    <label className="mb-2 block text-[12px] font-semibold uppercase tracking-[0.18em] text-slate-500">Secure Token</label>
                    <input type="password" value={accessDraft.token} onChange={(event) => setAccessDraft((current) => ({ ...current, token: event.target.value }))} className="h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm outline-none transition focus:border-[#145da0] focus:bg-white" placeholder="SECURE_TOKEN" />
                  </div>
                  {error ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}
                  <button onClick={() => startTransition(() => setAccess(accessDraft))} disabled={!accessDraft.kiosk || !accessDraft.token || loading} className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[linear-gradient(120deg,#145da0,#1b6ab5)] text-sm font-semibold text-white shadow-[0_14px_36px_rgba(20,93,160,0.26)] transition hover:translate-y-[-1px] disabled:cursor-not-allowed disabled:opacity-60">
                    {loading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
                    Open Desk
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="mx-auto max-w-[1600px] px-3 py-3 sm:px-4">
            <div className="overflow-hidden rounded-[28px] border border-white/70 bg-white/88 shadow-[0_24px_70px_rgba(15,23,42,0.08)] backdrop-blur">
              <div className="relative border-b border-slate-200 bg-[linear-gradient(135deg,rgba(10,44,96,0.98),rgba(20,93,160,0.92))] px-4 py-4 text-white sm:px-5">
                <div className="absolute right-0 top-0 h-28 w-28 rounded-full bg-emerald-400/25 blur-3xl" />
                <div className="absolute bottom-0 left-14 h-24 w-24 rounded-full bg-rose-400/25 blur-3xl" />
                <div className="relative flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                  <div className="flex items-start gap-3">
                    <div className="rounded-[20px] border border-white/20 bg-white/10 p-2.5 backdrop-blur-sm"><img src={mcnLogo} alt="MCN" className="h-8 w-auto" /></div>
                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-[0.28em] text-white/72">MCN Security Operations</div>
                      <h1 className="mt-1 text-[30px] font-bold tracking-[-0.04em]" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>Break Management Desk</h1>
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-white/85">
                        <span className="rounded-full border border-white/15 bg-white/10 px-3 py-1 font-medium">{activeDeskName}</span>
                        {scopeLabel ? <span className="rounded-full border border-white/15 bg-white/10 px-3 py-1 font-medium">{scopeLabel}</span> : null}
                        <span className="rounded-full border border-white/15 bg-white/10 px-3 py-1 font-medium">Shift Date {deskData?.shift_date ?? bootstrap.shift_date}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2.5 xl:justify-end">
                    <div className="rounded-2xl border border-white/15 bg-white/10 px-3 py-2 backdrop-blur-sm">
                      <div className="text-[10px] uppercase tracking-[0.18em] text-white/62">Live Clock</div>
                      <div className="text-sm font-semibold">{formatClock(clock)}</div>
                      <div className="text-xs text-white/72">{formatDate(clock)}</div>
                    </div>
                    <div className="rounded-2xl border border-white/15 bg-white/10 px-3 py-2 backdrop-blur-sm">
                      <div className="text-[10px] uppercase tracking-[0.18em] text-white/62">Last Sync</div>
                      <div className="text-sm font-semibold">{formatStamp(deskData?.last_sync_time ?? bootstrap.last_sync_time)}</div>
                    </div>
                    <button onClick={() => void fetchEmployees(true)} className="flex h-11 items-center gap-2 rounded-2xl border border-white/15 bg-white/10 px-4 text-sm font-semibold text-white backdrop-blur-sm transition hover:bg-white/16">
                      <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
                      Refresh
                    </button>
                    <button onClick={resetAccess} className="flex h-11 items-center gap-2 rounded-2xl border border-white/15 bg-rose-500/18 px-4 text-sm font-semibold text-white transition hover:bg-rose-500/24">
                      <LogOut className="h-4 w-4" />
                      Exit Desk
                    </button>
                  </div>
                </div>
              </div>

              <div className="space-y-3 p-3 sm:p-4">
                <div className="rounded-[24px] border border-slate-200 bg-white px-3 py-3 shadow-[0_10px_24px_rgba(15,23,42,0.05)]">
                  <div className="flex flex-wrap gap-2">
                    {statusMetrics.map((metric) => {
                      const Icon = metric.icon;
                      return (
                        <div key={metric.label} className="inline-flex min-w-[132px] flex-1 items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2.5">
                          <div className="rounded-xl bg-white p-2 text-slate-600 shadow-sm"><Icon className="h-4 w-4" /></div>
                          <div className="min-w-0">
                            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">{metric.label}</div>
                            <div className="text-lg font-bold text-slate-900" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>{metric.value}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {summaryMetrics.map((metric) => (
                      <div key={metric.label} className="inline-flex min-w-[120px] flex-1 items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm">
                        <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">{metric.label}</span>
                        <span className="font-bold text-slate-900" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>{metric.value}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-[24px] border border-slate-200 bg-white px-3 py-3 shadow-[0_10px_24px_rgba(15,23,42,0.05)]">
                  <div className="grid gap-2 xl:grid-cols-[1.35fr_repeat(5,minmax(0,1fr))]">
                    <label className="flex h-11 items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3">
                      <Search className="h-4 w-4 text-slate-400" />
                      <input ref={searchInputRef} value={filters.search} onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))} placeholder="Search name, code, biometric ID" className="h-full w-full bg-transparent text-sm outline-none placeholder:text-slate-400" />
                    </label>
                    <SelectBox label="Branch" value={filters.branch_id} options={branchOptions} onChange={(value) => setFilters((current) => ({ ...current, branch_id: value }))} disabled={kioskBranchLocked} />
                    <SelectBox label="Process" value={filters.process_id} options={processOptions} onChange={(value) => setFilters((current) => ({ ...current, process_id: value }))} disabled={kioskProcessLocked} />
                    <SelectBox label="Department" value={filters.department_id} options={departmentOptions} onChange={(value) => setFilters((current) => ({ ...current, department_id: value }))} />
                    <SelectBox label="Manager" value={filters.manager_id} options={managerOptions} onChange={(value) => setFilters((current) => ({ ...current, manager_id: value }))} />
                    <SelectBox label="Shift" value={filters.shift} options={shiftOptions} onChange={(value) => setFilters((current) => ({ ...current, shift: value }))} />
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <div className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500"><Filter className="h-3.5 w-3.5" />Status</div>
                    {[{ label: "All", value: "" }, ...bootstrap.filters.statuses.map((item) => ({ label: item.label, value: item.value }))].map((item) => (
                      <button key={item.label} onClick={() => setFilters((current) => ({ ...current, status: item.value }))} className={cn("rounded-full border px-3 py-1.5 text-xs font-semibold transition", filters.status === item.value ? "border-[#145da0] bg-[#145da0] text-white shadow-[0_10px_18px_rgba(20,93,160,0.18)]" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50")}>
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>

                {error ? <div className="rounded-[22px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}

                <div className="overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-[0_10px_24px_rgba(15,23,42,0.05)]">
                  <div className="overflow-auto">
                    <table className="min-w-[1480px] w-full text-sm">
                      <thead className="sticky top-0 z-10 bg-slate-50">
                        <tr className="text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                          <th className="px-3 py-3">Employee</th>
                          <th className="px-3 py-3">Team</th>
                          <th className="px-3 py-3">Shift / Punch</th>
                          <th className="px-3 py-3">Break Status</th>
                          <th className="px-3 py-3 text-center">Total Breaks</th>
                          <th className="px-3 py-3 text-center">Mini</th>
                          <th className="px-3 py-3 text-center">Long</th>
                          <th className="px-3 py-3 text-center">Break Min</th>
                          <th className="px-3 py-3 text-center">Shift Time</th>
                          <th className="px-3 py-3">Punch Action</th>
                          <th className="px-3 py-3">Break Action</th>
                          <th className="px-3 py-3">Info</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {employees.map((employee) => {
                          const acting = actingRowId === employee.employee_id;
                          const punchLabel = employee.safe_actions.can_punch_in
                            ? "Punch In"
                            : employee.safe_actions.can_punch_out
                              ? "Punch Out"
                              : "Completed";
                          const breakLabel = employee.safe_actions.can_end_break ? "Break Out" : "Break In";
                          const canBreak = employee.safe_actions.can_start_break || employee.safe_actions.can_end_break;
                          return (
                            <tr key={employee.employee_id} className="align-top transition hover:bg-slate-50/70">
                              <td className="px-3 py-3">
                                <div className="flex items-start gap-3">
                                  <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-[16px] bg-[linear-gradient(145deg,rgba(20,93,160,0.12),rgba(67,160,71,0.14))] text-sm font-bold text-[#145da0]">
                                    {employee.avatar_url ? <img src={employee.avatar_url} alt={employee.employee_name} className="h-full w-full object-cover" /> : employee.employee_name.slice(0, 1).toUpperCase()}
                                  </div>
                                  <div className="min-w-0">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <div className="truncate text-[15px] font-bold tracking-[-0.03em] text-slate-900" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>{employee.employee_name}</div>
                                      <span className={cn("inline-flex rounded-full px-2.5 py-1 text-[10px] font-bold ring-1", statusTone(employee.current_status))}>{employee.current_status}</span>
                                    </div>
                                    <div className="mt-1 flex flex-wrap gap-1.5 text-xs text-slate-500">
                                      <span className="rounded-full bg-slate-100 px-2 py-1 font-semibold text-slate-700">{employee.employee_code}</span>
                                      {employee.designation_name ? <span>{employee.designation_name}</span> : null}
                                      <span>ID {employee.biometric_id}</span>
                                    </div>
                                  </div>
                                </div>
                              </td>
                              <td className="px-3 py-3">
                                <div className="space-y-1 text-xs text-slate-600">
                                  <div className="font-semibold text-slate-800">{employee.process_name ?? "-"}</div>
                                  <div>{employee.department_name ?? "-"}</div>
                                  <div>{employee.branch_name ?? "-"}</div>
                                  <div className="truncate text-slate-500">RM: {employee.manager_name ?? "Not mapped"}</div>
                                </div>
                              </td>
                              <td className="px-3 py-3">
                                <div className="space-y-1 text-xs text-slate-600">
                                  <div className="font-semibold text-slate-800">{shiftLabelForDisplay(employee)}</div>
                                  <div>In: {formatStamp(employee.biometric_punch_in_time)}</div>
                                  <div>Out: {formatStamp(employee.biometric_punch_out_time)}</div>
                                  <div className="text-slate-500">Source: {employee.attendance_source_system ?? "biometric / sync"}</div>
                                </div>
                              </td>
                              <td className="px-3 py-3">
                                <div className="space-y-1 text-xs text-slate-600">
                                  <div className="font-semibold text-slate-800">{employee.active_break_id ? `Active ${formatLiveDuration(employee.active_break_start_time, null, employee.active_break_minutes)}` : "No active break"}</div>
                                  <div>Last: {employee.last_break_reason ?? "-"}</div>
                                  <div>{employee.exceeded_minutes > 0 ? `Exceeded by ${employee.exceeded_minutes} min` : Number(employee.remaining_daily_break_minutes ?? 1) <= 0 ? "Daily break limit reached" : `Remaining today ${formatMinutes(Number(employee.remaining_daily_break_minutes ?? 0))}`}</div>
                                </div>
                              </td>
                              <td className="px-3 py-3 text-center font-semibold text-slate-800">{employee.total_break_count}</td>
                              <td className="px-3 py-3 text-center font-semibold text-sky-700">{employee.mini_break_count}</td>
                              <td className="px-3 py-3 text-center font-semibold text-violet-700">{employee.long_break_count}</td>
                              <td className="px-3 py-3 text-center font-semibold text-slate-800">{formatMinutes(totalBreakMinutesForDisplay(employee))}</td>
                              <td className="px-3 py-3 text-center font-semibold text-slate-800">{formatMinutes(employee.shift_duration_minutes)}</td>
                              <td className="px-3 py-3">
                                <button
                                  onClick={() => {
                                    if (employee.safe_actions.can_punch_in) {
                                      void runAction(employee, "/api/break-desk/punch-in", "Punch in captured");
                                      return;
                                    }
                                    if (employee.safe_actions.can_punch_out) {
                                      void runAction(employee, "/api/break-desk/punch-out", "Punch out captured");
                                    }
                                  }}
                                  disabled={acting || (!employee.safe_actions.can_punch_in && !employee.safe_actions.can_punch_out)}
                                  className={cn(
                                    "inline-flex h-10 min-w-[112px] items-center justify-center rounded-2xl px-4 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-55",
                                    employee.safe_actions.can_punch_in
                                      ? "bg-[linear-gradient(120deg,#145da0,#1b6ab5)] text-white shadow-[0_12px_24px_rgba(20,93,160,0.18)]"
                                      : employee.safe_actions.can_punch_out
                                        ? "bg-[linear-gradient(120deg,#e75149,#ef5350)] text-white shadow-[0_12px_24px_rgba(239,83,80,0.18)]"
                                        : "border border-slate-200 bg-slate-100 text-slate-400",
                                  )}
                                >
                                  {acting && (employee.safe_actions.can_punch_in || employee.safe_actions.can_punch_out) ? "Saving..." : punchLabel}
                                </button>
                              </td>
                              <td className="px-3 py-3">
                                <button
                                  onClick={() => {
                                    if (employee.safe_actions.can_end_break) {
                                      void runAction(employee, "/api/break-desk/end-break", "Break out captured", { break_session_id: employee.active_break_id });
                                      return;
                                    }
                                    if (employee.safe_actions.can_start_break) {
                                      void runAction(employee, "/api/break-desk/start-break", "Break in captured", { break_reason: "Security Desk Break" });
                                    }
                                  }}
                                  disabled={acting || !canBreak}
                                  className={cn(
                                    "inline-flex h-10 min-w-[112px] items-center justify-center rounded-2xl px-4 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-55",
                                    employee.safe_actions.can_end_break
                                      ? "bg-[linear-gradient(120deg,#ef8f2f,#f59e0b)] text-white shadow-[0_12px_24px_rgba(245,158,11,0.2)]"
                                      : employee.safe_actions.can_start_break
                                        ? "bg-[linear-gradient(120deg,#2a8f4d,#43a047)] text-white shadow-[0_12px_24px_rgba(67,160,71,0.2)]"
                                        : "border border-slate-200 bg-slate-100 text-slate-400",
                                  )}
                                >
                                  {acting && canBreak ? "Saving..." : breakLabel}
                                </button>
                              </td>
                              <td className="px-3 py-3">
                                <div className="flex flex-col gap-2">
                                  <button onClick={() => setSelectedEmployee(employee)} className="rounded-2xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50">
                                    Today Details
                                  </button>
                                  {employee.attendance_source_system === "manual_kiosk" ? <span className="rounded-full bg-amber-50 px-2.5 py-1 text-center text-[10px] font-bold uppercase tracking-[0.18em] text-amber-700">Manual Override</span> : null}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                {!loading && employees.length === 0 ? (
                  <div className="rounded-[24px] border border-dashed border-slate-300 bg-white/70 px-4 py-10 text-center">
                    <p className="text-[13px] font-semibold uppercase tracking-[0.2em] text-slate-400">No employees found</p>
                    <p className="mt-2 text-sm text-slate-500">Try a different search or clear one of the filters.</p>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        )}
      </div>

      <Modal
        open={Boolean(selectedEmployee)}
        title={selectedEmployee ? `${selectedEmployee.employee_name} | Today Details` : "Today Details"}
        subtitle={selectedEmployee ? `${selectedEmployee.employee_code} | ${selectedEmployee.current_status}` : undefined}
        onClose={() => setSelectedEmployee(null)}
      >
        {selectedEmployee ? (
          <div className="space-y-4">
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
              <MiniData label="Process" value={selectedEmployee.process_name ?? "-"} />
              <MiniData label="Shift" value={selectedEmployee.shift_name ?? "-"} />
              <MiniData label="Punch In" value={formatStamp(selectedEmployee.biometric_punch_in_time)} />
              <MiniData label="Punch Out" value={formatStamp(selectedEmployee.biometric_punch_out_time)} />
              <MiniData label="Shift Time" value={formatMinutes(selectedEmployee.shift_duration_minutes)} />
            </div>
            <div className="grid gap-2 sm:grid-cols-4">
              <MiniData label="Total Breaks" value={String(selectedEmployee.total_break_count)} />
              <MiniData label="Mini Break" value={String(selectedEmployee.mini_break_count)} />
              <MiniData label="Long Break" value={String(selectedEmployee.long_break_count)} />
              <MiniData label="Break Min" value={formatMinutes(totalBreakMinutesForDisplay(selectedEmployee))} />
            </div>
            <div className="rounded-[22px] border border-slate-200">
              <div className="border-b border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700">Today Break Timeline</div>
              <div className="divide-y divide-slate-100">
                {selectedEmployee.today_sessions.length === 0 ? (
                  <div className="px-4 py-6 text-sm text-slate-500">No break sessions captured for this shift yet.</div>
                ) : selectedEmployee.today_sessions.map((session) => (
                  <div key={session.id} className="grid gap-2 px-4 py-3 text-sm text-slate-600 sm:grid-cols-[1.2fr_1fr_0.8fr_0.8fr]">
                    <div>
                      <div className="font-semibold text-slate-800">{session.break_reason}</div>
                      <div className="mt-1 text-xs text-slate-500">{session.exception_reason ?? "Normal flow"}</div>
                    </div>
                    <div>
                      <div>{formatStamp(session.break_start_time)}</div>
                      <div className="mt-1 text-xs text-slate-500">{formatStamp(session.break_end_time)}</div>
                    </div>
                    <div>
                      <div className="font-semibold text-slate-800">{session.duration_minutes ? `${session.duration_minutes} min` : "Active"}</div>
                      <div className="mt-1 text-xs text-slate-500">{session.break_type ?? session.status}</div>
                    </div>
                    <div className="text-right">
                      <span className={cn("inline-flex rounded-full px-2.5 py-1 text-[11px] font-bold ring-1", statusTone(session.status === "ACTIVE" ? "On Break" : selectedEmployee.current_status))}>{session.status}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : null}
      </Modal>
    </>
  );
}

function SelectBox({
  label,
  value,
  options,
  onChange,
  disabled = false,
}: {
  label: string;
  value: string;
  options: Option[];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <label className={cn("rounded-2xl border border-slate-200 bg-slate-50 px-3 py-1.5", disabled && "opacity-70")}>
      <span className="block text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled} className="h-7 w-full bg-transparent text-sm font-medium text-slate-700 outline-none disabled:cursor-not-allowed">
        <option value="">All</option>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
}

function MiniData({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</div>
      <div className="mt-1 truncate text-sm font-semibold text-slate-800">{value}</div>
    </div>
  );
}
