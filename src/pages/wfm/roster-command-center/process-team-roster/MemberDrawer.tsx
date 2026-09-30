import { useQuery } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import { DetailDrawer, DrawerSection, FieldGrid } from "@/components/wfm/console/DetailDrawer";
import { StatusPill } from "@/components/wfm/console/StatusPill";
import { fmtDate, fmtDateTime, fmtPct, hhmm, STATUS_LABEL, STATUS_TONE, type Status } from "./rosterModel";

interface Detail {
  date: string;
  status: Status | null;
  minutesLate: number | null;
  employee: { id: string; employeeCode: string; fullName: string; designation: string; processName: string | null; lobName: string | null; branchName: string | null; managerName: string | null; employmentStatus: string | null; employmentType: string | null; dateOfJoining: string | null; aonDays: number | null };
  rosterAssignment: null | Record<string, string | number | null>;
  attendance: null | { status: string | null; source: string | null; lateMark: number; lateByMinutes: number; rawMinutes: number; locked: boolean; overrideReason: string | null; clockIn: string | null; clockOut: string | null; processedAt: string | null };
  biometric: null | { firstIn: string | null; lastOut: string | null; totalPunches: number | null; rawMinutes: number | null };
  leaves: Array<{ id: string; leaveType: string | null; fromDate: string | null; toDate: string | null; totalDays: number | null; status: string | null; reason: string | null; appliedAt: string | null; approvedAt: string | null; approvedBy: string | null }>;
  timeline: Array<{ date: string; type: string | null; isWeekOff: boolean; attStatus: string | null; lateMark: number; lateByMinutes: number; firstIn: string | null }>;
  month: { month: string; throughDate?: string; planned: number; present: number; onTime: number; late: number; absent: number; leave: number; weekOff: number; adherencePct: number | null };
  rosterChanges: Array<{ changeType: string | null; reason: string | null; from: string | null; to: string | null; changeDate: string | null; at: string | null; by: string | null }>;
  audit: Array<{ action: string | null; module: string | null; at: string | null; actor: string | null }>;
}

/** One cell of the 14-day strip: letter + colour + title, so colour is never the only signal. */
function dayCell(t: Detail["timeline"][number]): { letter: string; label: string; cls: string } {
  const a = t.attStatus ?? "";
  const ty = (t.type ?? "").toUpperCase();
  if (t.isWeekOff || ty === "WEEK_OFF" || ty === "HOLIDAY" || a === "week_off" || a === "holiday") return { letter: "W", label: "Week off / holiday", cls: "bg-slate-100 text-slate-700" };
  if (ty === "LEAVE" || a === "leave_approved") return { letter: "L", label: "Leave", cls: "bg-blue-50 text-blue-800" };
  if (a === "present" || a === "half_day") return t.lateMark > 0 ? { letter: "T", label: "Late", cls: "bg-amber-50 text-amber-800" } : { letter: "P", label: "On time", cls: "bg-emerald-50 text-emerald-800" };
  return { letter: "A", label: "Absent / no record", cls: "bg-red-50 text-red-800" };
}

const kv = (v: unknown) => (v == null || v === "" ? null : String(v));

export function MemberDrawer({ employeeId, date, onClose }: { employeeId: string | null; date: string; onClose: () => void }) {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["process-team-roster", "member", employeeId, date],
    queryFn: () => hrmsApi.get<Detail>(`/api/roster-analytics/process-roster/member/${employeeId}?date=${date}`),
    enabled: !!employeeId,
    staleTime: 60_000,
  });
  const ra = data?.rosterAssignment;

  return (
    <DetailDrawer
      open={!!employeeId}
      onOpenChange={(o) => !o && onClose()}
      title={data?.employee.fullName ?? "Team member"}
      subtitle={data ? `${data.employee.employeeCode} · ${fmtDate(data.date)}` : undefined}
      badge={data?.status ? <StatusPill tone={STATUS_TONE[data.status]}>{STATUS_LABEL[data.status]}{data.status === "LATE" && data.minutesLate ? ` +${data.minutesLate}m` : ""}</StatusPill> : undefined}
    >
      {isLoading ? (
        <div className="animate-pulse space-y-3" role="status" aria-label="Loading member detail">
          {[0, 1, 2, 3].map((i) => <div key={i} className="h-20 rounded-md bg-slate-100" />)}
        </div>
      ) : isError || !data ? (
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          Could not load member detail.{" "}
          <button type="button" className="cursor-pointer font-semibold underline" onClick={() => refetch()}>Retry</button>
        </div>
      ) : (
        <>
          <DrawerSection label="Employee">
            <FieldGrid fields={[
              ["Designation", data.employee.designation], ["Process", data.employee.processName], ["LOB", data.employee.lobName], ["Branch", data.employee.branchName],
              ["Manager", data.employee.managerName], ["Employment", [data.employee.employmentStatus, data.employee.employmentType].filter(Boolean).join(" · ")],
              ["Date of joining", fmtDate(data.employee.dateOfJoining)], ["Tenure", data.employee.aonDays == null ? null : `${data.employee.aonDays} days`],
            ]} />
          </DrawerSection>

          <DrawerSection label={`Roster for ${fmtDate(data.date)}`}>
            {ra ? (
              <FieldGrid fields={[
                ["Shift", kv(ra.shiftName)], ["Shift time", ra.shiftStart ? `${hhmm(String(ra.shiftStart))} - ${hhmm(String(ra.shiftEnd))}` : null],
                ["Assignment type", kv(ra.assignmentType)], ["Roster status", kv(ra.rosterStatus)], ["Publish", kv(ra.publishStatus)], ["Lifecycle", kv(ra.lifecycleState)],
                ["Scheduled", ra.scheduledMinutes == null ? null : `${ra.scheduledMinutes} min`], ["Grace", ra.graceMinutes == null ? null : `${ra.graceMinutes} min`],
                ["Employee ack", kv(ra.ackStatus)], ["Acknowledged", ra.ackAt ? fmtDateTime(String(ra.ackAt)) : null],
                ["Manager action", kv(ra.managerActionStatus)], ["Manager action at", ra.managerActionAt ? fmtDateTime(String(ra.managerActionAt)) : null],
                ["Manager reason", kv(ra.managerActionReason)], ["System reason", kv(ra.systemDecisionReason)],
              ]} />
            ) : null}
          </DrawerSection>

          <DrawerSection label="Attendance and punches">
            {data.attendance || data.biometric ? (
              <FieldGrid fields={[
                ["Engine status", kv(data.attendance?.status)], ["Source", kv(data.attendance?.source)],
                ["Clock in", fmtDateTime(data.attendance?.clockIn ?? data.biometric?.firstIn)], ["Clock out", fmtDateTime(data.attendance?.clockOut ?? data.biometric?.lastOut)],
                ["Late mark", data.attendance ? (data.attendance.lateMark > 0 ? `Yes (${data.attendance.lateByMinutes} min)` : "No") : null],
                ["Worked minutes", data.attendance?.rawMinutes ?? data.biometric?.rawMinutes ?? null], ["Punches", data.biometric?.totalPunches ?? null],
                ["Locked", data.attendance ? (data.attendance.locked ? "Yes" : "No") : null], ["Override reason", kv(data.attendance?.overrideReason)],
              ]} />
            ) : null}
          </DrawerSection>

          <DrawerSection label="Leave covering this date">
            {data.leaves.length ? (
              <ul className="space-y-2">
                {data.leaves.map((l) => (
                  <li key={l.id} className="rounded-md border border-border p-2 text-sm">
                    <div className="font-medium text-slate-900">{l.leaveType ?? "Leave"} · {fmtDate(l.fromDate)} - {fmtDate(l.toDate)}{l.totalDays != null ? ` (${l.totalDays}d)` : ""}</div>
                    <div className="text-xs text-slate-600">Status: {l.status ?? "—"}{l.approvedBy ? ` · by ${l.approvedBy}` : ""}{l.approvedAt ? ` · ${fmtDateTime(l.approvedAt)}` : ""}</div>
                    {l.reason ? <div className="text-xs text-slate-600">Remarks: {l.reason}</div> : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </DrawerSection>

          <DrawerSection label="Last 14 days">
            {data.timeline.length ? (
              <>
                <ul className="grid grid-cols-7 gap-1.5" aria-label="Last 14 days attendance">
                  {data.timeline.map((t) => {
                    const c = dayCell(t);
                    return (
                      <li key={t.date} title={`${fmtDate(t.date)}: ${c.label}${t.firstIn ? ` (in ${t.firstIn})` : ""}`} aria-label={`${fmtDate(t.date)} ${c.label}`}
                        className={`rounded-md px-1 py-1.5 text-center text-[11px] font-semibold tabular-nums ${c.cls}`}>
                        <div>{t.date.slice(8, 10)}/{t.date.slice(5, 7)}</div>
                        <div className="text-sm">{c.letter}</div>
                      </li>
                    );
                  })}
                </ul>
                <p className="text-[11px] text-slate-600">P on time · T late · A absent / no record · L leave · W week off / holiday</p>
              </>
            ) : null}
          </DrawerSection>

          <DrawerSection label={`Month to date (${data.month.month.slice(5)}/${data.month.month.slice(0, 4)})`}>
            <FieldGrid fields={[
              ["Adherence", fmtPct(data.month.adherencePct)], ["Working days completed", data.month.planned],
              ["Present", data.month.present], ["On time", data.month.onTime], ["Late", data.month.late], ["Absent", data.month.absent],
              ["Leave", data.month.leave], ["Week off / holiday", data.month.weekOff],
            ]} />
            <p className="text-[11px] text-slate-600">Adherence = present / working days completed. Leave, week-off and holidays are not counted as planned.</p>
          </DrawerSection>

          <DrawerSection label="Roster change history">
            {data.rosterChanges.length ? (
              <ul className="space-y-1.5 text-sm">
                {data.rosterChanges.map((c, i) => (
                  <li key={i} className="rounded-md border border-border p-2">
                    <div className="font-medium text-slate-900">{c.changeType ?? "Change"}{c.from || c.to ? `: ${c.from ?? "—"} → ${c.to ?? "—"}` : ""}</div>
                    <div className="text-xs text-slate-600">{fmtDateTime(c.at)}{c.by ? ` · ${c.by}` : ""}{c.reason ? ` · ${c.reason}` : ""}</div>
                  </li>
                ))}
              </ul>
            ) : null}
          </DrawerSection>

          <DrawerSection label="Audit trail">
            {data.audit.length ? (
              <ul className="space-y-1 text-sm">
                {data.audit.map((a, i) => (
                  <li key={i} className="flex justify-between gap-2 border-b border-border py-1 last:border-0">
                    <span className="text-slate-900">{a.action}<span className="text-slate-600"> · {a.module}{a.actor ? ` · ${a.actor}` : ""}</span></span>
                    <span className="shrink-0 text-xs tabular-nums text-slate-600">{fmtDateTime(a.at)}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </DrawerSection>
        </>
      )}
    </DetailDrawer>
  );
}

export default MemberDrawer;
