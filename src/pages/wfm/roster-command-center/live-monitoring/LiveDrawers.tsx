/** Drill-down drawers for Live Monitoring: employee (from an alert) and manager (from the team table). */
import { Suspense, lazy } from "react";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { hrmsApi } from "@/lib/hrmsApi";
import { DetailDrawer, DrawerSection, FieldGrid } from "@/components/wfm/console/DetailDrawer";
import { StatusPill } from "@/components/wfm/console/StatusPill";
import { Button } from "@/components/ui/button";
import { effectivenessScore, fmtDateTime, scoreTone, type ManagerDigest } from "./liveMonitoringCalc";

const TrendChart = lazy(() => import("./LiveCharts").then((m) => ({ default: m.ShrinkageTrendChart })));
const BASE = "/api/roster-intelligence/live-detail";

interface EmpDetail {
  employee: { id: string; code: string; name: string; email: string | null; branchName: string | null; processName: string | null; managerId: string | null; managerName: string | null; employmentStatus: string | null; dateOfJoining: string | null };
  date: string;
  today: DayRow | null;
  history: DayRow[];
  summary: { plannedDays: number; presentDays: number; absentDays: number };
  regularizations: Array<{ id: string; date: string; reason: string; status: string; reviewer: string | null; remarks: string | null; reviewedAt: string | null; createdAt: string }>;
}
interface DayRow { date: string; rosterType: string; shiftTime: string | null; clockIn: string | null; clockOut: string | null; workedHours: number | null; status: string | null }
interface MgrDetail { digest: ManagerDigest; trend: Array<{ date: string; planned: number; present: number; shrinkagePct: number }> }

const chartFallback = <div className="h-full animate-pulse rounded-md bg-slate-100" role="status" aria-label="Loading chart" />;
const dd = (iso: string) => fmtDateTime(iso);
const empty = <p className="text-sm text-slate-500">None</p>;

function DrawerSkeleton() {
  return <div className="space-y-3" role="status" aria-label="Loading details">{[0, 1, 2, 3].map((i) => <div key={i} className="h-16 animate-pulse rounded-md bg-slate-100" />)}</div>;
}
function DrawerError({ err, retry }: { err: unknown; retry: () => void }) {
  return (
    <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
      {(err as Error)?.message || "Could not load details."}{" "}
      <button type="button" className="cursor-pointer font-medium underline" onClick={retry}>Retry</button>
    </div>
  );
}
const dayTone = (d: DayRow) => (d.rosterType !== "SHIFT" ? "neutral" : d.clockIn ? "green" : "red") as "neutral" | "green" | "red";
const dayLabel = (d: DayRow) => (d.rosterType !== "SHIFT" ? d.rosterType.replace("_", " ") : d.clockIn ? "Present" : "Absent");

export function EmployeeDrawer({ employeeId, onClose }: { employeeId: string | null; onClose: () => void }) {
  const navigate = useNavigate();
  const q = useQuery({
    queryKey: ["live-monitoring", "employee", employeeId],
    queryFn: () => hrmsApi.get<EmpDetail>(`${BASE}/employee/${employeeId}`),
    enabled: !!employeeId,
    staleTime: 30_000,
  });
  const d = q.data;
  return (
    <DetailDrawer
      open={!!employeeId}
      onOpenChange={(o) => !o && onClose()}
      title={d?.employee.name ?? "Employee"}
      subtitle={d ? `${d.employee.code} · ${dd(d.date)}` : "Loading…"}
      badge={d?.today ? <StatusPill tone={dayTone(d.today)}>{dayLabel(d.today)}</StatusPill> : undefined}
    >
      {q.isLoading ? <DrawerSkeleton /> : q.isError ? <DrawerError err={q.error} retry={() => q.refetch()} /> : d && (
        <>
          <DrawerSection label="Employee">
            <FieldGrid fields={[
              ["Code", d.employee.code], ["Name", d.employee.name], ["Branch", d.employee.branchName], ["Process", d.employee.processName],
              ["Manager", d.employee.managerName], ["Status", d.employee.employmentStatus], ["Email", d.employee.email], ["Joined", dd(d.employee.dateOfJoining ?? "")],
            ]} />
            <Button variant="outline" size="sm" className="mt-1 cursor-pointer" onClick={() => navigate(`/wfm/employee-roster/${d.employee.id}`)}>
              <ExternalLink className="mr-1 h-3.5 w-3.5" aria-hidden /> Open employee roster
            </Button>
          </DrawerSection>
          <DrawerSection label="Today">
            {d.today ? (
              <FieldGrid fields={[["Roster", d.today.rosterType.replace("_", " ")], ["Shift", d.today.shiftTime], ["Clock in", dd(d.today.clockIn ?? "")], ["Clock out", dd(d.today.clockOut ?? "")], ["Worked (h)", d.today.workedHours]]} />
            ) : empty}
          </DrawerSection>
          <DrawerSection label="Last 14 days">
            <p className="text-xs text-slate-600">
              {d.summary.presentDays} present · {d.summary.absentDays} absent of {d.summary.plannedDays} planned shift days (excluding today)
            </p>
            {d.history.length === 0 ? empty : (
              <div className="max-h-64 overflow-auto rounded-md border border-border">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-muted text-left"><tr><th className="p-2">Date</th><th className="p-2">Shift</th><th className="p-2">In</th><th className="p-2">Out</th><th className="p-2 text-right">Hrs</th><th className="p-2">Status</th></tr></thead>
                  <tbody>{d.history.map((h) => (
                    <tr key={h.date} className="border-t border-border">
                      <td className="p-2 tabular-nums">{dd(h.date)}</td><td className="p-2 tabular-nums">{h.shiftTime ?? "—"}</td>
                      <td className="p-2 tabular-nums">{h.clockIn ? dd(h.clockIn).slice(11) : "—"}</td><td className="p-2 tabular-nums">{h.clockOut ? dd(h.clockOut).slice(11) : "—"}</td>
                      <td className="p-2 text-right tabular-nums">{h.workedHours ?? "—"}</td><td className="p-2"><StatusPill tone={dayTone(h)}>{dayLabel(h)}</StatusPill></td>
                    </tr>))}</tbody>
                </table>
              </div>
            )}
          </DrawerSection>
          <DrawerSection label="Regularization requests (timeline)">
            {d.regularizations.length === 0 ? empty : (
              <ol className="space-y-2">{d.regularizations.map((r) => (
                <li key={r.id} className="rounded-md border border-border p-2 text-xs">
                  <div className="flex items-center justify-between gap-2"><span className="font-medium">For {dd(r.date)}</span><StatusPill tone={r.status === "approved" ? "green" : r.status === "pending" ? "amber" : "neutral"}>{r.status}</StatusPill></div>
                  <p className="mt-1 text-slate-700">{r.reason}</p>
                  <p className="mt-1 text-slate-500">Raised {dd(r.createdAt)}{r.reviewer ? ` · ${r.reviewer} ${dd(r.reviewedAt ?? "")}` : ""}{r.remarks ? ` · "${r.remarks}"` : ""}</p>
                </li>))}</ol>
            )}
          </DrawerSection>
          <DrawerSection label="Audit trail">{empty}</DrawerSection>
        </>
      )}
    </DetailDrawer>
  );
}

export function ManagerDrawer({ managerId, onClose }: { managerId: string | null; onClose: () => void }) {
  const q = useQuery({
    queryKey: ["live-monitoring", "manager", managerId],
    queryFn: () => hrmsApi.get<MgrDetail>(`${BASE}/manager/${managerId}`),
    enabled: !!managerId,
    staleTime: 30_000,
  });
  const dg = q.data?.digest;
  const score = dg ? effectivenessScore(dg) : null;
  const list = (rows: Array<{ employeeId: string; employeeName: string; employeeCode: string }>, extra?: (r: any) => string) =>
    rows.length === 0 ? empty : (
      <ul className="divide-y divide-border rounded-md border border-border text-sm">
        {rows.map((r) => (
          <li key={r.employeeId} className="flex items-center justify-between gap-2 px-3 py-2">
            <span className="min-w-0 truncate"><span className="font-medium">{r.employeeName}</span> <span className="text-xs text-slate-500">{r.employeeCode}</span></span>
            {extra && <span className="shrink-0 text-xs tabular-nums text-slate-700">{extra(r)}</span>}
          </li>))}
      </ul>);
  return (
    <DetailDrawer
      open={!!managerId}
      onOpenChange={(o) => !o && onClose()}
      title={dg ? `${dg.managerName}'s team` : "Team"}
      subtitle={dg ? `${dg.branchName ?? "No branch"} · ${dd(dg.date)}` : "Loading…"}
      badge={dg ? <StatusPill tone={scoreTone(score)}>{score === null ? "No score yet" : `Score ${score}`}</StatusPill> : undefined}
    >
      {q.isLoading ? <DrawerSkeleton /> : q.isError ? <DrawerError err={q.error} retry={() => q.refetch()} /> : dg && (
        <>
          <DrawerSection label="Summary">
            <FieldGrid fields={[
              ["Manager", dg.managerName], ["Email", dg.managerEmail], ["Team size", dg.teamSize], ["Planned (due)", dg.planned],
              ["Present", dg.present], ["Shrinkage", `${dg.shrinkagePct}%`], ["On time", dg.onTime.length], ["Pending regularizations", dg.aprPending],
            ]} />
          </DrawerSection>
          <DrawerSection label="Shrinkage trend (14 days)">
            <div style={{ height: 200 }}>
              {q.data!.trend.length < 2 ? <p className="text-sm text-slate-500">None</p> : (
                <Suspense fallback={chartFallback}><TrendChart data={q.data!.trend} target={8} /></Suspense>)}
            </div>
          </DrawerSection>
          <DrawerSection label={`Unplanned absences (${dg.unplannedAbsences.length})`}>{list(dg.unplannedAbsences, (r) => r.shiftTime ?? "")}</DrawerSection>
          <DrawerSection label={`Late arrivals (${dg.lateArrivals.length})`}>{list(dg.lateArrivals, (r) => (r.lateMinutes != null ? `${r.lateMinutes}m late` : ""))}</DrawerSection>
          <DrawerSection label={`Incomplete shifts (${dg.incompleteShifts.length})`}>{list(dg.incompleteShifts, (r) => (r.workedPct != null ? `${r.workedPct}% worked` : ""))}</DrawerSection>
          <DrawerSection label={`On time (${dg.onTime.length})`}>{list(dg.onTime)}</DrawerSection>
          <DrawerSection label="Audit trail">{empty}</DrawerSection>
        </>
      )}
    </DetailDrawer>
  );
}
