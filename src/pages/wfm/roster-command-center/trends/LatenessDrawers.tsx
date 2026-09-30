import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { DetailDrawer, DrawerSection, FieldGrid } from "@/components/wfm/console/DetailDrawer";
import { StatusPill } from "@/components/wfm/console/StatusPill";
import { DataTable, type Column } from "./DataTable";
import { Caveat, NoneNote, QueryBody, TICK, TIP, chartColor } from "./shared";
import { useTrends, withParam } from "./useTrendsQuery";
import { fmtDate, fmtDayMonth, fmtNum } from "./trendsCalc";

/* ── Employee ──────────────────────────────────────────────────────────────── */

interface LateEvent { date: string; scheduledStart: string | null; punchIn: string | null; lateMinutes: number; netLateMinutes: number; exception: boolean }
interface EmpDetail {
  employee: { employeeCode: string; employeeName: string; branchName: string | null; processName: string | null; managerName: string | null };
  count: number; exceptions: number; avgNetMinutes: number; weekly: Array<{ week: string; count: number }>; events: LateEvent[];
}

const eventCols: Column<LateEvent>[] = [
  { key: "d", header: "Date", sortValue: (r) => r.date, render: (r) => fmtDate(r.date) },
  { key: "s", header: "Shift start", render: (r) => r.scheduledStart ?? "—" },
  { key: "p", header: "Punch in", render: (r) => r.punchIn ?? "—" },
  { key: "l", header: "Late by", align: "right", sortValue: (r) => r.lateMinutes, render: (r) => `${r.lateMinutes} min` },
  { key: "n", header: "Beyond grace", align: "right", sortValue: (r) => r.netLateMinutes, render: (r) => `${r.netLateMinutes} min` },
  { key: "x", header: "Exception", render: (r) => (r.exception ? <StatusPill tone="blue">Regularised</StatusPill> : "No") },
];

export function LateEmployeeDrawer({ employeeId, qs, onClose }: { employeeId: string | null; qs: string; onClose: () => void }) {
  const q = useTrends<EmpDetail>("late-emp", "lateness/employee", withParam(qs, "employeeId", employeeId ?? ""), !!employeeId);
  return (
    <DetailDrawer open={!!employeeId} onOpenChange={(o) => !o && onClose()} title={q.data?.employee.employeeName ?? "Employee"} subtitle={q.data ? `${q.data.employee.employeeCode} · late arrivals beyond grace` : "Late arrivals"}>
      {employeeId && (
        <QueryBody query={q}>
          {(d) => (
            <>
              <DrawerSection label="Full record">
                <FieldGrid fields={[["Employee code", d.employee.employeeCode], ["Branch", d.employee.branchName], ["Process", d.employee.processName], ["Reporting manager", d.employee.managerName],
                  ["Late arrivals in range", fmtNum(d.count)], ["Average beyond grace", `${d.avgNetMinutes} min`], ["Regularised as exception", fmtNum(d.exceptions)]]} />
              </DrawerSection>
              <DrawerSection label="Trend by week">
                {d.weekly.length ? (
                  <div style={{ height: 150 }} role="img" aria-label="Late arrivals per week">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={d.weekly} margin={{ top: 6, right: 8, left: -16, bottom: 0 }}>
                        <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" vertical={false} />
                        <XAxis dataKey="week" tick={TICK} tickLine={false} axisLine={false} tickFormatter={fmtDayMonth} />
                        <YAxis tick={TICK} tickLine={false} axisLine={false} allowDecimals={false} width={32} />
                        <Tooltip contentStyle={TIP} labelFormatter={(v) => `Week of ${fmtDate(String(v))}`} />
                        <Bar dataKey="count" name="Late arrivals" fill={chartColor(4)} radius={[3, 3, 0, 0]} isAnimationActive={false} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                ) : undefined}
              </DrawerSection>
              <DrawerSection label="Timeline">
                {d.events.length ? <DataTable rows={d.events} columns={eventCols} rowKey={(r) => r.date} ariaLabel="Late arrival events" maxHeight={380} defaultSort={{ key: "d", dir: "desc" }} /> : undefined}
              </DrawerSection>
              <DrawerSection label="Audit trail"><NoneNote>None at this level. Regularisation decisions are audited under the Attendance module.</NoneNote></DrawerSection>
            </>
          )}
        </QueryBody>
      )}
    </DetailDrawer>
  );
}

/* ── Day ───────────────────────────────────────────────────────────────────── */

interface DayEvt extends LateEvent { employeeId: string; employeeCode: string; employeeName: string; processName: string | null }
interface LateDay { date: string; count: number; truncated: boolean; events: DayEvt[] }

export function LateDayDrawer({ date, qs, onClose, onOpenEmployee }: { date: string | null; qs: string; onClose: () => void; onOpenEmployee: (id: string) => void }) {
  const q = useTrends<LateDay>("late-day", "lateness/day", withParam(qs, "date", date ?? ""), !!date);
  const cols: Column<DayEvt>[] = [
    { key: "e", header: "Employee", sortValue: (r) => r.employeeName, render: (r) => <span className="font-medium">{r.employeeName} <span className="font-normal text-slate-500">({r.employeeCode})</span></span> },
    { key: "p", header: "Process", render: (r) => r.processName ?? "—" },
    { key: "s", header: "Shift start", render: (r) => r.scheduledStart ?? "—" },
    { key: "i", header: "Punch in", render: (r) => r.punchIn ?? "—" },
    { key: "l", header: "Late by", align: "right", sortValue: (r) => r.lateMinutes, render: (r) => `${r.lateMinutes} min` },
    { key: "x", header: "Exception", render: (r) => (r.exception ? <StatusPill tone="blue">Regularised</StatusPill> : "No") },
  ];
  return (
    <DetailDrawer open={!!date} onOpenChange={(o) => !o && onClose()} title={`Late arrivals on ${fmtDate(date)}`} subtitle="Arrivals later than the grace window">
      {date && (
        <QueryBody query={q}>
          {(d) => (
            <>
              <DrawerSection label="Full record"><FieldGrid fields={[["Date", fmtDate(d.date)], ["Late arrivals", fmtNum(d.count)]]} /></DrawerSection>
              <DrawerSection label="Events — open a row for the employee">
                {d.events.length ? (
                  <>
                    <DataTable rows={d.events} columns={cols} rowKey={(r) => r.employeeId} rowLabel={(r) => r.employeeName} onRowClick={(r) => onOpenEmployee(r.employeeId)} ariaLabel="Late arrivals on day" maxHeight={420} defaultSort={{ key: "l", dir: "desc" }} />
                    {d.truncated && <Caveat>Showing the 100 latest of {fmtNum(d.count)}. Narrow the filters for the rest.</Caveat>}
                  </>
                ) : undefined}
              </DrawerSection>
              <DrawerSection label="Audit trail"><NoneNote>None at day level.</NoneNote></DrawerSection>
            </>
          )}
        </QueryBody>
      )}
    </DetailDrawer>
  );
}

/* ── Attrition bucket ──────────────────────────────────────────────────────── */

interface BucketDetail {
  bucket: string; from: string; to: string; count: number; avgTenureDays: number; truncated: boolean;
  monthly: Array<{ month: string; count: number }>; byProcess: Array<{ name: string; count: number }>;
  exits: Array<{ employeeId: string; employeeCode: string; employeeName: string; branchName: string | null; processName: string | null; joined: string | null; exited: string; tenureDays: number }>;
}

export function AttritionBucketDrawer({ bucket, qs, onClose }: { bucket: string | null; qs: string; onClose: () => void }) {
  const q = useTrends<BucketDetail>("attr-bucket", "attrition/bucket", withParam(qs, "bucket", bucket ?? ""), !!bucket);
  type X = BucketDetail["exits"][number];
  const cols: Column<X>[] = [
    { key: "e", header: "Employee", sortValue: (r) => r.employeeName, render: (r) => <span className="font-medium">{r.employeeName} <span className="font-normal text-slate-500">({r.employeeCode})</span></span> },
    { key: "b", header: "Branch", render: (r) => r.branchName ?? "—" },
    { key: "p", header: "Process", render: (r) => r.processName ?? "—" },
    { key: "j", header: "Joined", sortValue: (r) => r.joined ?? "", render: (r) => fmtDate(r.joined) },
    { key: "x", header: "Exited", sortValue: (r) => r.exited, render: (r) => fmtDate(r.exited) },
    { key: "t", header: "Tenure", align: "right", sortValue: (r) => r.tenureDays, render: (r) => `${r.tenureDays} d` },
  ];
  return (
    <DetailDrawer open={!!bucket} onOpenChange={(o) => !o && onClose()} title={`Exits at ${bucket} days on network`} subtitle="Dated exits with possible tenure (exit on/after joining)">
      {bucket && (
        <QueryBody query={q}>
          {(d) => (
            <>
              <DrawerSection label="Full record"><FieldGrid fields={[["Window", `${fmtDate(d.from)} to ${fmtDate(d.to)}`], ["Exits", fmtNum(d.count)], ["Average tenure at exit", `${d.avgTenureDays} days`]]} /></DrawerSection>
              <DrawerSection label="Trend by month">
                {d.monthly.length ? (
                  <div style={{ height: 150 }} role="img" aria-label="Exits per month">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={d.monthly} margin={{ top: 6, right: 8, left: -16, bottom: 0 }}>
                        <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" vertical={false} />
                        <XAxis dataKey="month" tick={TICK} tickLine={false} axisLine={false} />
                        <YAxis tick={TICK} tickLine={false} axisLine={false} allowDecimals={false} width={32} />
                        <Tooltip contentStyle={TIP} />
                        <Bar dataKey="count" name="Exits" fill={chartColor(8)} radius={[3, 3, 0, 0]} isAnimationActive={false} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                ) : undefined}
              </DrawerSection>
              <DrawerSection label="By process">
                {d.byProcess.length ? <DataTable rows={d.byProcess} rowKey={(r) => r.name} ariaLabel="Exits by process" maxHeight={220} columns={[{ key: "n", header: "Process", render: (r) => r.name }, { key: "c", header: "Exits", align: "right", sortValue: (r) => r.count, render: (r) => fmtNum(r.count) }]} defaultSort={{ key: "c", dir: "desc" }} /> : undefined}
                <Caveat>Process is recorded on only a minority of exit records, so most exits appear as Unassigned.</Caveat>
              </DrawerSection>
              <DrawerSection label="Exited employees (timeline)">
                {d.exits.length ? (
                  <>
                    <DataTable rows={d.exits} columns={cols} rowKey={(r) => r.employeeId} ariaLabel="Exited employees" maxHeight={380} defaultSort={{ key: "x", dir: "desc" }} />
                    {d.truncated && <Caveat>Showing the 100 most recent of {fmtNum(d.count)} exits.</Caveat>}
                  </>
                ) : undefined}
              </DrawerSection>
              <DrawerSection label="Audit trail"><NoneNote>None at bucket level. Individual exit approvals are audited in the Exit module.</NoneNote></DrawerSection>
            </>
          )}
        </QueryBody>
      )}
    </DetailDrawer>
  );
}
