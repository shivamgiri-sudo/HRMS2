import { useQuery } from "@tanstack/react-query";
import {
  Activity, AlertTriangle, BadgeCheck, CalendarDays, ClipboardList,
  Headphones, ShieldAlert, Star, TrendingDown, TrendingUp,
} from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { hrmsApi } from "@/lib/hrmsApi";

/**
 * One team member, every angle the platform actually has data for.
 *
 * The drill-down the My Team page never had. Follows the drawer contract in CLAUDE.md — a
 * right-side slide-over, full height, fetched from its own endpoint rather than reusing the
 * list payload, with every section rendered even when empty.
 *
 * "Empty" is deliberately three different things here, because collapsing them is what made
 * the old Quality tab read as "nobody has been audited" when the truth was a broken filter:
 *
 *   available: true                    → real numbers
 *   available: false, no_data          → this person genuinely has none (a non-dialler has
 *                                        no APR rows, and that is correct, not a fault)
 *   available: false, unavailable      → the query failed; say so, never draw a zero
 */

interface Props {
  employeeId: string | null;
  employeeName?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface SectionState { available: boolean; reason?: "no_data" | "unavailable" }

interface KpiRow {
  metric_code: string;
  metric_name: string;
  unit: string | null;
  higher_is_better: boolean;
  decimals: number;
  last_7: number | null;
  last_30: number | null;
  last_90: number | null;
  team_avg_90: number | null;
  trend_pct: number | null;
  vs_team_pct: number | null;
  days_measured: number;
}

interface DeepDive {
  employee: Record<string, any>;
  attendance: { strip: { date: string; status: string; late: boolean; lwp: number }[]; last_30: any; last_90: any };
  regularisations: { total: number; pending: number; approved: number; rejected: number } | null;
  kpi: KpiRow[];
  quality: {
    audits: number; avg_score: number | null; best: number | null; worst: number | null;
    poor_calls: number; last_audit: string | null;
    series: { date: string; score: number; calls: number }[];
    coaching_flags: Record<string, number>;
  } | null;
  ops: Record<string, number | string | null> | null;
  hygiene: { fields: { key: string; label: string; critical: boolean; present: boolean }[]; missing_count: number; complete_pct: number } | null;
  open_items: { pending_leave: any[]; pending_regularisations: any[] };
  section_status: Record<string, SectionState>;
  window_days: number;
}

// ── Presentation helpers ──────────────────────────────────────────────────────

/** Attendance strip colours. missing_punch is its own colour: it is a data fault, not absence. */
const STATUS_COLOR: Record<string, string> = {
  present:        "bg-emerald-500",
  half_day:       "bg-amber-400",
  absent:         "bg-rose-500",
  missing_punch:  "bg-slate-400",
  leave_approved: "bg-sky-400",
  week_off:       "bg-slate-200",
  holiday:        "bg-slate-200",
};

const STATUS_LABEL: Record<string, string> = {
  present: "Present", half_day: "Half day", absent: "Absent",
  missing_punch: "Missing punch", leave_approved: "Leave", week_off: "Week off", holiday: "Holiday",
};

const fmtDate = (v: string | null | undefined) => {
  if (!v) return "—";
  const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return "—";
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).toLocaleDateString("en-IN", {
    day: "2-digit", month: "short", year: "numeric", timeZone: "UTC",
  });
};

const fmtNum = (v: number | null | undefined, decimals = 1) =>
  v == null ? "—" : Number(v).toLocaleString("en-IN", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

/** Seconds → "1h 22m" / "4m 30s". APR stores every duration in seconds. */
const fmtDuration = (secs: number | null | undefined) => {
  if (secs == null) return "—";
  const s = Math.round(Number(secs));
  if (s >= 3600) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  if (s >= 60) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${s}s`;
};

const HYGIENE_HINT: Record<string, string> = {
  nominee: "No payee on record for a death benefit",
  emergency_contact: "Nobody to call in a floor incident",
  uan_number: "Blocks PF filing",
  pan_number: "Blocks TDS",
  bank_detail: "Cannot be paid by transfer",
};

function Section({
  title, icon: Icon, state, children, emptyLabel,
}: {
  title: string;
  icon: React.ElementType;
  state?: SectionState;
  children: React.ReactNode;
  emptyLabel?: string;
}) {
  const unavailable = state && !state.available;
  return (
    <section className="border-t border-slate-100 pt-5">
      <div className="mb-3 flex items-center gap-2">
        <Icon className="h-3.5 w-3.5 text-slate-400" />
        <h3 className="text-xs font-bold uppercase tracking-wide text-slate-400">{title}</h3>
      </div>
      {unavailable ? (
        <p className={`text-sm ${state!.reason === "unavailable" ? "text-amber-700" : "text-slate-400"}`}>
          {state!.reason === "unavailable"
            ? "Could not be loaded — this is a system fault, not a zero."
            : emptyLabel ?? "None recorded."}
        </p>
      ) : children}
    </section>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{label}</p>
      <p className="mt-0.5 truncate text-sm font-medium text-slate-800">{value || "—"}</p>
    </div>
  );
}

function Stat({ label, value, tone = "slate" }: { label: string; value: React.ReactNode; tone?: "slate" | "good" | "warn" | "bad" }) {
  const toneClass = {
    slate: "text-slate-900", good: "text-emerald-700", warn: "text-amber-700", bad: "text-rose-700",
  }[tone];
  return (
    <div className="rounded-xl bg-slate-50 px-3 py-2.5">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{label}</p>
      <p className={`mt-0.5 text-lg font-bold tabular-nums ${toneClass}`}>{value}</p>
    </div>
  );
}

/** Signed delta where positive ALWAYS means "better", whichever way the metric runs. */
function Delta({ pct }: { pct: number | null }) {
  if (pct == null) return <span className="text-xs text-slate-300">—</span>;
  const better = pct >= 0;
  const Icon = better ? TrendingUp : TrendingDown;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-semibold tabular-nums ${better ? "text-emerald-600" : "text-rose-600"}`}>
      <Icon className="h-3 w-3" />{better ? "+" : ""}{pct}%
    </span>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function TeamMemberDrawer({ employeeId, employeeName, open, onOpenChange }: Props) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["team-member-deep-dive", employeeId],
    queryFn: async () => {
      const res = await hrmsApi.get<{ success: boolean; data: DeepDive }>(
        `/api/management/team-member/${employeeId}`,
      );
      return res.data;
    },
    enabled: open && !!employeeId,
    staleTime: 60_000,
  });

  const emp = data?.employee;
  const st = data?.section_status ?? {};

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto p-0">
        <SheetHeader className="sticky top-0 z-10 border-b border-slate-200 bg-white px-6 py-4">
          <SheetTitle className="text-left text-base font-bold text-slate-900">
            {emp?.full_name ?? employeeName ?? "Team member"}
          </SheetTitle>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
            {emp?.employee_code && <span className="font-mono">{emp.employee_code}</span>}
            {emp?.designation_name && <span>{emp.designation_name}</span>}
            {emp?.employment_status && (
              <span className="rounded-full bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-700">
                {emp.employment_status}
              </span>
            )}
            {data && <span className="ml-auto">Last {data.window_days} days</span>}
          </div>
        </SheetHeader>

        <div className="space-y-5 px-6 py-5">
          {isLoading && (
            <div className="space-y-4">
              {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
            </div>
          )}

          {error && !isLoading && (
            <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error instanceof Error ? error.message : "Could not load this member."}</span>
            </div>
          )}

          {data && (
            <>
              {/* ── Who ──────────────────────────────────────────────────── */}
              <section>
                <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
                  <Field label="Department" value={emp?.dept_name} />
                  <Field label="Process" value={emp?.process_name} />
                  <Field label="Branch" value={emp?.branch_name} />
                  <Field label="Reports to" value={emp?.reporting_manager_name} />
                  <Field label="Joined" value={fmtDate(emp?.date_of_joining)} />
                  <Field
                    label="Tenure"
                    value={emp?.days_served != null ? `${Math.floor(Number(emp.days_served) / 365)}y ${Math.floor((Number(emp.days_served) % 365) / 30)}m` : "—"}
                  />
                </div>
              </section>

              {/* ── Attendance ───────────────────────────────────────────── */}
              <Section title="Attendance" icon={CalendarDays} state={st.attendance}>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Stat
                    label="Rate · 30d"
                    value={data.attendance.last_30?.attendance_pct != null ? `${data.attendance.last_30.attendance_pct}%` : "—"}
                    tone={
                      data.attendance.last_30?.attendance_pct == null ? "slate"
                        : data.attendance.last_30.attendance_pct >= 90 ? "good"
                        : data.attendance.last_30.attendance_pct >= 75 ? "warn" : "bad"
                    }
                  />
                  <Stat label="Absent · 30d" value={data.attendance.last_30?.absent ?? "—"} tone={Number(data.attendance.last_30?.absent) > 2 ? "warn" : "slate"} />
                  <Stat label="LWP days" value={fmtNum(data.attendance.last_30?.lwp_days, 1)} tone={Number(data.attendance.last_30?.lwp_days) > 0 ? "warn" : "slate"} />
                  <Stat label="Late marks" value={data.attendance.last_30?.late_marks ?? "—"} />
                </div>

                {/* Day strip — one cell per recorded day, oldest first */}
                {data.attendance.strip.length > 0 && (
                  <div className="mt-3">
                    <div className="flex flex-wrap gap-[3px]">
                      {data.attendance.strip.map((d) => (
                        <span
                          key={d.date}
                          title={`${fmtDate(d.date)} — ${STATUS_LABEL[d.status] ?? d.status}${d.late ? " (late)" : ""}`}
                          className={`h-3.5 w-3.5 rounded-[3px] ${STATUS_COLOR[d.status] ?? "bg-slate-200"}`}
                        />
                      ))}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-slate-400">
                      {["present", "half_day", "absent", "missing_punch"].map((s) => (
                        <span key={s} className="inline-flex items-center gap-1">
                          <span className={`h-2 w-2 rounded-[2px] ${STATUS_COLOR[s]}`} />{STATUS_LABEL[s]}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {data.regularisations && data.regularisations.total > 0 && (
                  <p className="mt-3 text-xs text-slate-500">
                    {data.regularisations.total} regularisation{data.regularisations.total === 1 ? "" : "s"} raised
                    {data.regularisations.pending > 0 && (
                      <span className="font-semibold text-amber-700"> · {data.regularisations.pending} still pending</span>
                    )}
                  </p>
                )}
              </Section>

              {/* ── KPI ──────────────────────────────────────────────────── */}
              <Section title="KPI" icon={Activity} state={st.kpi} emptyLabel="No KPI actuals recorded in this window.">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[460px] text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 text-[10px] uppercase tracking-wider text-slate-400">
                        <th className="pb-2 pr-3 text-left font-semibold">Metric</th>
                        <th className="pb-2 px-2 text-right font-semibold">90d</th>
                        <th className="pb-2 px-2 text-right font-semibold">Team</th>
                        <th className="pb-2 px-2 text-right font-semibold">vs team</th>
                        <th className="pb-2 pl-2 text-right font-semibold">Trend</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.kpi.map((k) => (
                        <tr key={k.metric_code} className="border-b border-slate-50">
                          <td className="py-2 pr-3">
                            <span className="font-medium text-slate-800">{k.metric_name}</span>
                            {/* Which way is good is a property of the metric, never assumed */}
                            <span className="ml-1.5 text-[10px] text-slate-400">
                              {k.higher_is_better ? "↑ better" : "↓ better"}
                            </span>
                          </td>
                          <td className="px-2 py-2 text-right font-semibold tabular-nums text-slate-900">{fmtNum(k.last_90, k.decimals)}</td>
                          <td className="px-2 py-2 text-right tabular-nums text-slate-400">{fmtNum(k.team_avg_90, k.decimals)}</td>
                          <td className="px-2 py-2 text-right"><Delta pct={k.vs_team_pct} /></td>
                          <td className="py-2 pl-2 text-right"><Delta pct={k.trend_pct} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="mt-2 text-[11px] text-slate-400">
                  Trend compares the last 7 days against this person's own 90-day baseline. A positive
                  figure always means improvement, including on metrics where lower is better.
                </p>
              </Section>

              {/* ── Quality ──────────────────────────────────────────────── */}
              <Section
                title="Quality"
                icon={Star}
                state={st.quality}
                emptyLabel="Not audited in this window — only dialler-facing roles are sampled."
              >
                {data.quality && (
                  <>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      <Stat
                        label="Avg score"
                        value={data.quality.avg_score != null ? `${data.quality.avg_score}%` : "—"}
                        tone={
                          data.quality.avg_score == null ? "slate"
                            : data.quality.avg_score >= 80 ? "good"
                            : data.quality.avg_score >= 60 ? "warn" : "bad"
                        }
                      />
                      <Stat label="Calls audited" value={data.quality.audits} />
                      <Stat label="Below 60%" value={data.quality.poor_calls} tone={data.quality.poor_calls > 0 ? "warn" : "slate"} />
                      <Stat label="Last audit" value={<span className="text-sm">{fmtDate(data.quality.last_audit)}</span>} />
                    </div>

                    {/* What to coach — a percentage says something is wrong, never what */}
                    {Object.values(data.quality.coaching_flags).some((v) => Number(v) > 0) && (
                      <div className="mt-3">
                        <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                          Coaching signals · last 30 days
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {Object.entries(data.quality.coaching_flags)
                            .filter(([, v]) => Number(v) > 0)
                            .sort((a, b) => Number(b[1]) - Number(a[1]))
                            .map(([k, v]) => (
                              <span key={k} className="rounded-lg bg-amber-50 px-2 py-1 text-xs text-amber-800">
                                {k.replace(/_/g, " ")} <strong className="tabular-nums">{v}</strong>
                              </span>
                            ))}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </Section>

              {/* ── Ops ──────────────────────────────────────────────────── */}
              <Section
                title="Operations"
                icon={Headphones}
                state={st.ops}
                emptyLabel="No dialler activity — this role is not on the APR feed."
              >
                {data.ops && (
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {/* AHT is per CALL; talk and pause are daily TOTALS in the APR feed.
                        Labelling both "avg" put a 3-minute figure beside a 2h 43m one and
                        invited the reader to compare them. */}
                    <Stat label="Calls / day" value={fmtNum(data.ops.avg_calls as number, 0)} />
                    <Stat label="AHT / call" value={fmtDuration(data.ops.avg_aht as number)} />
                    <Stat label="Talk / day" value={fmtDuration(data.ops.avg_talk as number)} />
                    <Stat label="Pause / day" value={fmtDuration(data.ops.avg_pause as number)} />
                  </div>
                )}
              </Section>

              {/* ── Hygiene ──────────────────────────────────────────────── */}
              <Section title="Record hygiene" icon={BadgeCheck} state={st.hygiene}>
                {data.hygiene && (
                  <>
                    <div className="mb-3 flex items-center gap-3">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                        <div
                          className={`h-full rounded-full ${data.hygiene.complete_pct === 100 ? "bg-emerald-500" : data.hygiene.complete_pct >= 70 ? "bg-amber-400" : "bg-rose-500"}`}
                          style={{ width: `${data.hygiene.complete_pct}%` }}
                        />
                      </div>
                      <span className="text-sm font-bold tabular-nums text-slate-700">{data.hygiene.complete_pct}%</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {data.hygiene.fields.map((f) => (
                        <span
                          key={f.key}
                          title={!f.present ? HYGIENE_HINT[f.key] ?? "Missing" : "On record"}
                          className={`rounded-lg px-2 py-1 text-xs ${
                            f.present
                              ? "bg-slate-50 text-slate-400"
                              : f.critical
                              ? "bg-rose-50 font-semibold text-rose-700"
                              : "bg-amber-50 font-medium text-amber-700"
                          }`}
                        >
                          {f.present ? "✓ " : "✕ "}{f.label}
                        </span>
                      ))}
                    </div>
                  </>
                )}
              </Section>

              {/* ── Open items ───────────────────────────────────────────── */}
              <Section
                title="Waiting on you"
                icon={ClipboardList}
                state={
                  data.open_items.pending_leave.length + data.open_items.pending_regularisations.length > 0
                    ? { available: true }
                    : { available: false, reason: "no_data" }
                }
                emptyLabel="Nothing pending for this member."
              >
                <div className="space-y-1.5">
                  {data.open_items.pending_leave.map((l: any) => (
                    <div key={l.id} className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-600" />
                      <span className="font-medium text-amber-900">{l.leave_type ?? "Leave"}</span>
                      <span className="text-xs text-amber-700">
                        {fmtDate(l.from_date)} → {fmtDate(l.to_date)} · {l.total_days}d
                      </span>
                    </div>
                  ))}
                  {data.open_items.pending_regularisations.map((r: any) => (
                    <div key={r.id} className="flex items-center gap-2 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-sm">
                      <Activity className="h-3.5 w-3.5 shrink-0 text-sky-600" />
                      <span className="font-medium text-sky-900">Regularisation</span>
                      <span className="text-xs text-sky-700">{fmtDate(r.session_date)} · {String(r.status).replace(/_/g, " ")}</span>
                    </div>
                  ))}
                </div>
              </Section>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
