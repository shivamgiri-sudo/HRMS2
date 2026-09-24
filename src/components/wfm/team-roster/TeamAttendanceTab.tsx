import { useState } from "react";
import { Link } from "react-router-dom";
import { ExternalLink, Info, Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useDebounce } from "@/hooks/useDebounce";
import { useWorkforceAccess } from "@/hooks/useUserRole";
import { buildDayColumnLabel } from "@/lib/attendance-register-columns";
import { useTeamAttendance, type TeamAttendanceRow, type TeamRosterMe } from "@/hooks/useTeamRoster";
import { LobBadge } from "@/components/wfm/LobBadge";
import { LobSelect } from "@/components/wfm/LobSelect";
import TeamAttendanceDrawer from "./TeamAttendanceDrawer";
import {
  ATTENDANCE_TOTAL_COLUMNS, attendanceCellClass, monthLabel, monthOptions, unpackError, weekdayShort,
} from "./teamRosterFormat";

const PAGE_SIZES = [25, 50, 100] as const;

/** Roles the Attendance Register route itself admits (workforce/payroll routes file): page grant AND role, as the route enforces. */
export const REGISTER_ROLES = ["payroll_head", "admin", "super_admin", "payroll_hr", "hr", "hr_admin", "wfm", "branch_head", "process_manager"] as const;
export const REGISTER_PAGE_CODE = "ATTENDANCE_REGISTER_EXPORT";

/** A link to the full register, shown only to people who can already open it. */
export function RegisterLink() {
  const { canViewPage, hasAnyRole } = useWorkforceAccess();
  if (!canViewPage(REGISTER_PAGE_CODE) || !hasAnyRole(...REGISTER_ROLES)) return null;
  return (
    <Link to="/payroll/attendance-register" className="inline-flex items-center gap-1 text-sm font-medium text-blue-700 hover:underline">
      Open full Attendance Register <ExternalLink className="h-3.5 w-3.5" aria-hidden />
    </Link>
  );
}

interface Props { me: TeamRosterMe }

export default function TeamAttendanceTab({ me }: Props) {
  const months = monthOptions(me.today);
  const [month, setMonth] = useState(months[0].value);
  const [search, setSearch] = useState("");
  const [pageSize, setPageSize] = useState<number>(50);
  const [offset, setOffset] = useState(0);
  const [lobId, setLobId] = useState("");
  const [open, setOpen] = useState<{ employeeId: string } | null>(null);
  const debounced = useDebounce(search, 300);
  const q = useTeamAttendance({ month, search: debounced.trim(), offset, limit: pageSize, lobId }, true);
  const data = q.data;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor="ta-month">Month</Label>
          <select id="ta-month" className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm" value={month} onChange={(e) => { setMonth(e.target.value); setOffset(0); }}>
            {months.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </div>
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" aria-hidden />
          <Input aria-label="Search team attendance" placeholder="Search name or employee code" value={search} onChange={(e) => { setSearch(e.target.value); setOffset(0); }} className="h-9 pl-8" />
        </div>
        <div className="space-y-1">
          <Label>LOB</Label>
          <LobSelect processId="" value={lobId} onChange={(v) => { setLobId(v); setOffset(0); }} includeUnassigned className="h-9 w-44" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="ta-page-size">Rows</Label>
          <select id="ta-page-size" className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm" value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setOffset(0); }}>
            {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        <RegisterLink />
      </div>

      <div role="note" className="flex items-start gap-2 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-900">
        <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <div>
          <p className="font-semibold">Preview of the Attendance Register for {monthLabel(month)}. The register and payroll figures remain the source of truth.</p>
          <p>Week-off, missing-punch and leave-without-pay days appear as A, exactly as in the register. A day is blank before joining, after exit and in the future.</p>
        </div>
      </div>

      {q.isLoading && <div className="py-10 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-slate-400" aria-label="Loading" /></div>}
      {q.isError && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">Could not load attendance. {unpackError(q.error).message}</p>}
      {data && (
        <>
          <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-500" aria-label="Legend">
            {data.legend.map((l) => (
              <span key={l.code} className="flex items-center gap-1">
                <span className={`inline-flex h-4 w-6 items-center justify-center rounded text-[10px] ${attendanceCellClass(l.code)}`}>{l.code}</span>{l.label}
              </span>
            ))}
            <span className="flex items-center gap-1">
              <span className={`inline-flex h-4 w-6 items-center justify-center rounded text-[10px] ring-1 ring-inset ring-orange-500 ${attendanceCellClass("P")}`}>P</span>Regularized
            </span>
            <span className="ml-auto font-medium text-slate-700">{data.total} employee{data.total === 1 ? "" : "s"} - {monthLabel(month)}</span>
          </div>
          {data.rows.length === 0 ? (
            <p className="rounded-xl border border-dashed p-8 text-center text-sm text-slate-500">No team members match your search.</p>
          ) : (
            <AttendanceTable data={data} onOpen={(row) => row.employeeId && setOpen({ employeeId: row.employeeId })} />
          )}
          {data.total > data.limit && (
            <div className="flex items-center justify-between text-sm text-slate-500">
              <span>{data.offset + 1}-{Math.min(data.offset + data.limit, data.total)} of {data.total} people</span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={offset === 0} onClick={() => setOffset(Math.max(offset - pageSize, 0))}>Previous</Button>
                <Button variant="outline" size="sm" disabled={offset + pageSize >= data.total} onClick={() => setOffset(offset + pageSize)}>Next</Button>
              </div>
            </div>
          )}
        </>
      )}
      <TeamAttendanceDrawer employeeId={open?.employeeId ?? null} month={month} onClose={() => setOpen(null)} />
    </div>
  );
}

function AttendanceTable({ data, onOpen }: { data: NonNullable<ReturnType<typeof useTeamAttendance>["data"]>; onOpen: (r: TeamAttendanceRow) => void }) {
  const monthNo = Number(data.month.slice(5, 7));
  return (
    <div className="max-h-[68vh] overflow-auto rounded-xl border border-slate-200 bg-white">
      <table className="min-w-full border-separate border-spacing-0 text-xs">
        <thead>
          <tr>
            <th className="sticky left-0 top-0 z-30 min-w-[200px] border-b border-r bg-slate-800 px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-slate-200">Employee</th>
            {data.dates.map((d, i) => (
              <th key={d} title={d} className="sticky top-0 z-20 min-w-[34px] border-b border-l border-slate-600 bg-slate-700 px-0.5 py-1 text-center font-normal text-white">
                <div className="text-[10px] font-semibold">{buildDayColumnLabel(monthNo, i + 1)}</div>
                <div className="text-[9px] text-slate-300">{weekdayShort(d)}</div>
              </th>
            ))}
            {ATTENDANCE_TOTAL_COLUMNS.map((c) => (
              <th key={c.key} className="sticky top-0 z-20 min-w-[40px] border-b border-l border-teal-600 bg-teal-700 px-1 py-2 text-center text-[11px] font-semibold text-teal-50">{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.rows.map((row, ri) => (
            <tr
              key={row.employeeId ?? row.code ?? ri}
              tabIndex={0}
              role="button"
              aria-label={`Open attendance for ${row.name}`}
              className="cursor-pointer hover:bg-slate-50"
              onClick={() => onOpen(row)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(row); } }}
            >
              <th scope="row" className="sticky left-0 z-10 border-b border-r bg-white px-3 py-1.5 text-left font-normal">
                <div className="font-semibold text-slate-800">{row.name}</div>
                <div className="text-[11px] text-slate-500">{[row.code, row.designation, row.processName].filter(Boolean).join(" - ")}</div>
                <LobBadge name={row.lobName} />
              </th>
              {row.days.map((code, i) => (
                <td key={i} className="border-b border-l border-slate-100 p-0 text-center">
                  <span className={`block w-full py-1 text-[10px] ${attendanceCellClass(code)} ${row.regularizedDays.includes(i + 1) ? "ring-1 ring-inset ring-orange-500" : ""}`}>{code}</span>
                </td>
              ))}
              {ATTENDANCE_TOTAL_COLUMNS.map((c) => (
                <td key={c.key} className="border-b border-l border-teal-100 bg-teal-50 px-1 py-1 text-center font-semibold text-teal-800">{row.totals[c.key]}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
