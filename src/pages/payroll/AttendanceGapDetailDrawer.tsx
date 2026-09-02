import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, AlertTriangle, Briefcase, Building2, Calendar, CheckCircle2, Clock, FileText, Loader2, UserCheck, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { hrmsApi } from "@/lib/hrmsApi";

interface GapDetail {
  key: string;
  employeeId: string;
  issueDate: string;
  window: { from: string; to: string };
  employee: Record<string, unknown> | null;
  attendanceRecords: Record<string, unknown>[];
  biometricDaily: Record<string, unknown>[];
  biometricPunches: Record<string, unknown>[];
  aprRecords: Record<string, unknown>[];
  regularizations: Record<string, unknown>[];
  leaveRequests: Record<string, unknown>[];
  rosterAssignments: Record<string, unknown>[];
  reviewHistory: Record<string, unknown>[];
  auditTrail: Record<string, unknown>[];
}

function fmtDateTime(value: unknown) {
  if (value === null || value === undefined || value === "") return "—";
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return String(value);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function fmtDate(value: unknown) {
  if (!value) return "—";
  const s = String(value);
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : s;
}

function fmtTime(value: unknown) {
  if (!value) return "—";
  const s = String(value);
  // Extract HH:MM from datetime or time string
  const m = s.match(/(\d{2}:\d{2})/);
  return m ? m[1] : s.slice(0, 5);
}

function pretty(s: unknown) {
  return String(s ?? "—").replace(/_/g, " ");
}

function SectionHeader({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-slate-100 text-slate-500">{icon}</div>
      <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{title}</p>
    </div>
  );
}

function InfoGrid({ items }: { items: [string, unknown][] }) {
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-3">
      {items.map(([k, v]) => (
        <div key={k}>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{k}</p>
          <p className="mt-0.5 text-sm font-semibold text-slate-800">{v ? String(v) : "—"}</p>
        </div>
      ))}
    </div>
  );
}

function EvidenceCard({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent: "blue" | "emerald" | "amber" | "red" | "slate" }) {
  const styles = {
    blue:    "bg-blue-50 border-blue-200 text-blue-700",
    emerald: "bg-emerald-50 border-emerald-200 text-emerald-700",
    amber:   "bg-amber-50 border-amber-200 text-amber-700",
    red:     "bg-red-50 border-red-200 text-red-700",
    slate:   "bg-slate-50 border-slate-200 text-slate-600",
  };
  return (
    <div className={`rounded-xl border px-3 py-2.5 ${styles[accent]}`}>
      <p className="text-[10px] font-bold uppercase tracking-wider opacity-70">{label}</p>
      <p className="mt-0.5 text-lg font-extrabold tabular-nums leading-none">{value}</p>
      {sub && <p className="mt-0.5 text-[11px] opacity-70">{sub}</p>}
    </div>
  );
}

const REVIEW_STATUS_STYLE: Record<string, string> = {
  open: "bg-amber-100 text-amber-800 border-amber-200",
  notified: "bg-blue-100 text-blue-800 border-blue-200",
  regularization_required: "bg-violet-100 text-violet-800 border-violet-200",
  reviewed: "bg-emerald-100 text-emerald-800 border-emerald-200",
  no_issue: "bg-slate-100 text-slate-700 border-slate-200",
};

export function AttendanceGapDetailDrawer({
  gapKey,
  onClose,
  runMonth,
}: {
  gapKey: string | null;
  onClose: () => void;
  runMonth?: string;
}) {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["attendance-gap-detail", gapKey],
    enabled: Boolean(gapKey),
    queryFn: async () => {
      const res = await hrmsApi.get<{ success: boolean; data: GapDetail }>(
        `/api/payroll/attendance-control-tower/gap/${encodeURIComponent(gapKey as string)}`,
      );
      return res.data;
    },
  });

  const reviewMutation = useMutation({
    mutationFn: async (status: "reviewed" | "no_issue" | "regularization_required") => {
      const res = await hrmsApi.post("/api/payroll/attendance-control-tower/review-status", {
        runMonth,
        conflictKeys: [gapKey],
        status,
      });
      return res.data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["attendance-gap-detail", gapKey] });
      void qc.invalidateQueries({ queryKey: ["payroll-attendance-control-tower"] });
    },
  });

  const emp = data?.employee as Record<string, unknown> | null | undefined;

  // Key evidence for the "headline" card
  const adr = data?.attendanceRecords?.[0] as any;
  const ibd = data?.biometricDaily?.[0] as any;
  const rawPunch = data?.biometricPunches?.[0] as any;
  const apr = data?.aprRecords;
  const latestReview = data?.reviewHistory?.[0] as any;

  const adrStatus = String(adr?.attendance_status ?? "—");
  const bioMinutes = Number(ibd?.biometric_minutes ?? rawPunch?.raw_minutes ?? 0);
  const aprMinutes = apr?.reduce((sum: number, r: any) => {
    if (!r.Net_Login) return sum;
    const parts = String(r.Net_Login).split(":").map(Number);
    return sum + (parts[0] || 0) * 60 + (parts[1] || 0);
  }, 0) ?? 0;

  const adrAccent = adrStatus === "present" ? "emerald" : adrStatus === "half_day" ? "amber" : adrStatus === "absent" ? "red" : "slate";
  const isNightShift = data?.rosterAssignments?.some((r: any) => {
    if (!r.shift_start_time || !r.shift_end_time) return false;
    return r.shift_end_time < r.shift_start_time;
  });

  return (
    <Sheet open={Boolean(gapKey)} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="flex h-full w-full max-w-2xl flex-col overflow-y-auto sm:max-w-2xl p-0">

        {/* Header */}
        <div className="sticky top-0 z-10 border-b border-slate-200 bg-white px-5 pt-5 pb-4">
          <SheetHeader>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <SheetTitle className="text-lg font-bold text-slate-900 leading-tight">
                  {String(emp?.employee_name ?? emp?.employee_code ?? "Attendance gap")}
                </SheetTitle>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <Badge variant="outline" className="text-[11px] font-mono">{String(emp?.employee_code ?? "—")}</Badge>
                  <Badge variant="outline" className="text-[11px]">{fmtDate(data?.issueDate)}</Badge>
                  {emp && (
                    <Badge variant="outline" className={`text-[11px] ${Number(emp.active_status) === 1 ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-100 text-slate-500"}`}>
                      {Number(emp.active_status) === 1 ? "Active" : "Inactive"}
                    </Badge>
                  )}
                  {isNightShift && <Badge variant="outline" className="text-[11px] border-indigo-200 bg-indigo-50 text-indigo-700">Night shift</Badge>}
                  {latestReview && (
                    <Badge variant="outline" className={`text-[11px] capitalize ${REVIEW_STATUS_STYLE[String(latestReview.status ?? "open")] ?? ""}`}>
                      {pretty(latestReview.status)}
                    </Badge>
                  )}
                </div>
              </div>
            </div>
          </SheetHeader>

          {/* Quick actions */}
          {!isLoading && data && (
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" variant="outline" className="h-7 text-xs rounded-lg"
                onClick={() => reviewMutation.mutate("reviewed")} disabled={reviewMutation.isPending}>
                <CheckCircle2 className="mr-1 h-3.5 w-3.5 text-emerald-600" /> Mark Reviewed
              </Button>
              <Button size="sm" variant="outline" className="h-7 text-xs rounded-lg"
                onClick={() => reviewMutation.mutate("regularization_required")} disabled={reviewMutation.isPending}>
                <UserCheck className="mr-1 h-3.5 w-3.5 text-violet-600" /> Needs Regularization
              </Button>
              <Button size="sm" variant="outline" className="h-7 text-xs rounded-lg"
                onClick={() => reviewMutation.mutate("no_issue")} disabled={reviewMutation.isPending}>
                <XCircle className="mr-1 h-3.5 w-3.5 text-slate-500" /> No Issue
              </Button>
              {reviewMutation.isSuccess && <span className="self-center text-xs text-emerald-600 font-medium">✓ Updated</span>}
            </div>
          )}
        </div>

        {isLoading && (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-500">
            <Loader2 className="h-5 w-5 animate-spin text-blue-500" /> Loading evidence…
          </div>
        )}
        {error && (
          <div className="m-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            Could not load gap detail.
          </div>
        )}

        {data && !isLoading && (
          <div className="space-y-5 px-5 py-5 pb-16">

            {/* Evidence snapshot */}
            <div>
              <SectionHeader icon={<Activity className="h-3.5 w-3.5" />} title="Evidence snapshot" />
              <div className="grid grid-cols-3 gap-2">
                <EvidenceCard label="Payroll ADR" value={pretty(adrStatus)}
                  sub={adr ? `LWP ${adr.lwp_value ?? 0} · ${adr.biometric_minutes ?? adr.raw_minutes ?? 0}m bio` : "No ADR record"}
                  accent={adrAccent as any} />
                <EvidenceCard label="COSEC Biometric" value={bioMinutes > 0 ? `${bioMinutes}m` : "—"}
                  sub={ibd ? `${fmtTime(ibd.first_punch)}–${fmtTime(ibd.last_punch)} · ${ibd.total_punches} punches` : rawPunch ? `${rawPunch.total_punches ?? 0} punches` : "No data"}
                  accent={bioMinutes >= 480 ? "emerald" : bioMinutes >= 240 ? "amber" : bioMinutes > 0 ? "red" : "slate"} />
                <EvidenceCard label="APR Dialler" value={aprMinutes > 0 ? `${aprMinutes}m` : "—"}
                  sub={apr?.length ? `${apr.length} session${apr.length !== 1 ? "s" : ""}` : "No data"}
                  accent={aprMinutes >= 480 ? "emerald" : aprMinutes >= 240 ? "amber" : aprMinutes > 0 ? "red" : "slate"} />
              </div>
            </div>

            {/* Employee */}
            <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4">
              <SectionHeader icon={<Briefcase className="h-3.5 w-3.5" />} title="Employee" />
              <InfoGrid items={[
                ["Branch", emp?.branch_name],
                ["Process", emp?.process_name],
                ["Department", emp?.dept_name],
                ["Designation", emp?.designation_name],
                ["Biometric code", emp?.biometric_code],
                ["Joined", fmtDate(emp?.date_of_joining)],
                ...(emp?.date_of_leaving ? [["Left", fmtDate(emp.date_of_leaving)] as [string, unknown]] : []),
              ]} />
            </div>

            {/* Roster */}
            {data.rosterAssignments?.length > 0 && (
              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <SectionHeader icon={<Calendar className="h-3.5 w-3.5" />} title="Roster assignment" />
                <div className="space-y-2">
                  {data.rosterAssignments.map((r: any, i) => (
                    <div key={i} className={`flex flex-wrap items-center gap-3 rounded-xl border px-3 py-2.5 text-sm ${r.is_week_off ? "border-slate-200 bg-slate-50" : isNightShift ? "border-indigo-200 bg-indigo-50" : "border-blue-200 bg-blue-50"}`}>
                      <span className="font-semibold text-slate-800">{fmtDate(r.roster_date)}</span>
                      {r.is_week_off
                        ? <Badge variant="outline" className="text-[11px] border-slate-300 text-slate-500">Week Off</Badge>
                        : <span className="text-slate-600">{fmtTime(r.shift_start_time)} – {fmtTime(r.shift_end_time)}</span>}
                      {r.is_week_off !== 1 && r.shift_end_time && r.shift_start_time && r.shift_end_time < r.shift_start_time && (
                        <Badge variant="outline" className="text-[11px] border-indigo-200 bg-indigo-50 text-indigo-700">Night shift</Badge>
                      )}
                      {r.roster_status && <span className="text-[11px] capitalize text-slate-500">{pretty(r.roster_status)}</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Biometric punches */}
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <SectionHeader icon={<Clock className="h-3.5 w-3.5" />} title="Raw biometric punches" />
              {data.biometricPunches?.length ? (
                <div className="space-y-2">
                  {data.biometricPunches.map((p: any, i) => (
                    <div key={i} className="grid grid-cols-4 gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs">
                      <div><p className="text-[10px] font-bold uppercase text-slate-400">Date</p><p className="font-semibold text-slate-800">{fmtDate(p.punch_date)}</p></div>
                      <div><p className="text-[10px] font-bold uppercase text-slate-400">First In</p><p className="font-semibold text-slate-800">{fmtTime(p.first_punch_in)}</p></div>
                      <div><p className="text-[10px] font-bold uppercase text-slate-400">Last Out</p><p className="font-semibold text-slate-800">{fmtTime(p.last_punch_out)}</p></div>
                      <div><p className="text-[10px] font-bold uppercase text-slate-400">Minutes</p><p className="font-bold text-blue-700">{p.raw_minutes ?? p.total_punches ?? "—"}m</p></div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-slate-400 py-2">No raw punch data found for this date.</p>
              )}
            </div>

            {/* APR sessions */}
            {data.aprRecords?.length > 0 && (
              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <SectionHeader icon={<Activity className="h-3.5 w-3.5" />} title="APR dialler sessions" />
                <div className="space-y-2">
                  {data.aprRecords.map((a: any, i) => (
                    <div key={i} className="grid grid-cols-4 gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs">
                      <div><p className="text-[10px] font-bold uppercase text-slate-400">Date</p><p className="font-semibold text-slate-800">{fmtDate(a.report_date)}</p></div>
                      <div><p className="text-[10px] font-bold uppercase text-slate-400">Login</p><p className="font-semibold text-slate-800">{fmtTime(a.Login_Time)}</p></div>
                      <div><p className="text-[10px] font-bold uppercase text-slate-400">Logout</p><p className="font-semibold text-slate-800">{fmtTime(a.Logout_Time)}</p></div>
                      <div><p className="text-[10px] font-bold uppercase text-slate-400">Net Login</p><p className="font-bold text-sky-700">{a.Net_Login ?? "—"}</p></div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Attendance record */}
            {data.attendanceRecords?.length > 0 && (
              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <SectionHeader icon={<FileText className="h-3.5 w-3.5" />} title="Payroll attendance record (ADR)" />
                <div className="space-y-2">
                  {data.attendanceRecords.map((r: any, i) => (
                    <div key={i} className={`rounded-xl border px-3 py-2.5 text-xs ${r.is_locked ? "border-emerald-200 bg-emerald-50" : "border-slate-200 bg-slate-50"}`}>
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <span className="font-bold text-slate-800 capitalize">{pretty(r.attendance_status)}</span>
                        <div className="flex gap-1.5">
                          {r.is_locked ? <Badge variant="outline" className="text-[10px] border-emerald-300 text-emerald-700">Locked</Badge> : null}
                          {r.regularization_id ? <Badge variant="outline" className="text-[10px] border-violet-300 text-violet-700">Regularized</Badge> : null}
                          {r.override_by ? <Badge variant="outline" className="text-[10px] border-amber-300 text-amber-700">Overridden</Badge> : null}
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-[11px]">
                        <div><span className="text-slate-400">LWP: </span><span className="font-semibold text-slate-700">{r.lwp_value ?? 0}</span></div>
                        <div><span className="text-slate-400">Bio min: </span><span className="font-semibold text-slate-700">{r.biometric_minutes ?? 0}</span></div>
                        <div><span className="text-slate-400">Dialler min: </span><span className="font-semibold text-slate-700">{r.dialler_minutes ?? 0}</span></div>
                        <div className="col-span-2"><span className="text-slate-400">Source: </span><span className="font-semibold text-slate-700 capitalize">{pretty(r.attendance_source)} / {pretty(r.source_system)}</span></div>
                        <div><span className="text-slate-400">Late: </span><span className="font-semibold text-slate-700">{r.late_mark ? `Yes (${r.late_by_minutes}m)` : "No"}</span></div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Leave */}
            {data.leaveRequests?.length > 0 && (
              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <SectionHeader icon={<Building2 className="h-3.5 w-3.5" />} title="Leave covering this day" />
                <div className="space-y-2">
                  {data.leaveRequests.map((l: any, i) => (
                    <div key={i} className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs">
                      <div>
                        <span className="font-semibold text-slate-800">{l.leave_type_code}</span>
                        <span className="ml-2 text-slate-500">{fmtDate(l.from_date)} – {fmtDate(l.to_date)} ({l.total_days} day{l.total_days !== 1 ? "s" : ""})</span>
                      </div>
                      <Badge variant="outline" className={`text-[10px] capitalize ${l.status === "approved" ? "border-emerald-300 text-emerald-700" : "border-amber-300 text-amber-700"}`}>{l.status}</Badge>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Regularizations */}
            {data.regularizations?.length > 0 && (
              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <SectionHeader icon={<UserCheck className="h-3.5 w-3.5" />} title="Regularizations" />
                <div className="space-y-2">
                  {data.regularizations.map((r: any, i) => (
                    <div key={i} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-slate-800 capitalize">{pretty(r.requested_status)}</span>
                        <Badge variant="outline" className={`text-[10px] capitalize ${r.status === "approved" ? "border-emerald-300 text-emerald-700" : r.status === "rejected" ? "border-red-300 text-red-700" : "border-amber-300 text-amber-700"}`}>{r.status}</Badge>
                      </div>
                      <p className="mt-1 text-slate-500">{r.reason ?? "—"}</p>
                      <p className="mt-0.5 text-slate-400">Reviewed: {fmtDateTime(r.reviewed_at)}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Review timeline */}
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <SectionHeader icon={<CheckCircle2 className="h-3.5 w-3.5" />} title="Review timeline" />
              {data.reviewHistory?.length ? (
                <ol className="relative ml-3 space-y-3 border-l border-slate-200 pl-5">
                  {data.reviewHistory.map((r: any, i) => (
                    <li key={i} className="relative">
                      <div className="absolute -left-[23px] flex h-4 w-4 items-center justify-center rounded-full border border-slate-300 bg-white">
                        <span className="h-2 w-2 rounded-full bg-blue-500" />
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
                        <div className="flex items-center justify-between gap-2">
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold capitalize ${REVIEW_STATUS_STYLE[String(r.status ?? "open")] ?? ""}`}>{pretty(r.status)}</span>
                          <span className="text-slate-400">{fmtDateTime(r.updated_at ?? r.created_at)}</span>
                        </div>
                        {r.review_note && <p className="mt-1 text-slate-600">{String(r.review_note)}</p>}
                      </div>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-sm text-slate-400">No review activity yet.</p>
              )}
            </div>

            {/* Audit */}
            {data.auditTrail?.length > 0 && (
              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <SectionHeader icon={<AlertTriangle className="h-3.5 w-3.5" />} title="Audit trail" />
                <ol className="space-y-2">
                  {data.auditTrail.map((a: any, i) => (
                    <li key={i} className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
                      <span className="font-semibold capitalize text-slate-700">{pretty(a.action_type)}</span>
                      <span className="text-slate-400">{fmtDateTime(a.created_at)}</span>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

export default AttendanceGapDetailDrawer;
