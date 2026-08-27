import { useMemo } from "react";
import { AlertTriangle, Clock, PauseCircle, Target, TimerReset, UserRound, Users, XCircle } from "lucide-react";
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  AXIS_TICK,
  ChartCard,
  ChartSkeleton,
  CoverageNote,
  EmptyState,
  GRID_PROPS,
  SERIES,
  StatTile,
  TOOLTIP_STYLE,
  num,
  pct,
  ratio,
} from "@/components/analytics/analytics-kit";

type AnyRow = Record<string, unknown>;

interface CoverTabProps {
  summary: AnyRow;
  queueRows: AnyRow[];
  branchTable: AnyRow[];
  processTable: AnyRow[];
  recruiterTable: AnyRow[];
  sourceTable: AnyRow[];
  dashboardRows: AnyRow[];
  loading?: boolean;
}

const N = (v: unknown) => Number(v || 0);

/**
 * Minutes as something a person can read. The Cover tiles printed raw minutes while the
 * Dashboard tab printed "33h 46m" for the same family of metric — the same number in two units
 * on two tabs of one page.
 */
function durationLabel(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return "0m";
  const d = Math.floor(minutes / 1440);
  const h = Math.floor((minutes % 1440) / 60);
  const m = Math.round(minutes % 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return `${m}m`;
}
const S = (v: unknown) => String(v ?? "");

/** Groups charted individually before the tail folds into an explicit "Other". */
const CHART_GROUPS = 6;

export function CoverTab({
  summary,
  queueRows,
  branchTable,
  processTable,
  recruiterTable,
  sourceTable,
  dashboardRows,
  loading,
}: CoverTabProps) {
  const slaBreachQueue = useMemo(
    () =>
      [...(queueRows || [])]
        .filter((r) => r.SLAFlag)
        .sort((a, b) => N(b.WaitingMinutes) - N(a.WaitingMinutes)),
    [queueRows]
  );

  const topBranches = useMemo(
    () =>
      (branchTable || []).slice(0, 8).map((b) => ({
        name: S(b.Name),
        arrival: N(b.TotalArrival),
        selected: N(b.Selection),
        selectionRate: ratio(N(b.Selection), N(b.TotalArrival)) ?? 0,
      })),
    [branchTable]
  );

  /**
   * Source mix with an explicit "Other" slice.
   *
   * Slicing to the top six and labelling the ring "Total" made the shares add up
   * to less than the real total, so every visible slice was overstated.
   */
  const sourceMix = useMemo(() => {
    const rows = (sourceTable || []).map((s) => ({ name: S(s.Name) || "Unknown", value: N(s.TotalArrival) }));
    const head = rows.slice(0, CHART_GROUPS);
    const tail = rows.slice(CHART_GROUPS);
    const tailTotal = tail.reduce((sum, r) => sum + r.value, 0);
    const slices = tailTotal > 0 ? [...head, { name: `Other (${tail.length})`, value: tailTotal, isOther: true }] : head;
    return {
      slices,
      total: rows.reduce((sum, r) => sum + r.value, 0),
      shownGroups: head.length,
      distinctGroups: rows.length,
      shownRecords: head.reduce((sum, r) => sum + r.value, 0),
      otherGroups: tail.length,
      otherRecords: tailTotal,
    };
  }, [sourceTable]);

  const trendData = useMemo(
    () =>
      (dashboardRows || []).map((d) => ({
        period: S(d.Date),
        arrivals: N(d["Total Arrival"]),
        selected: N(d.Selection),
        rejected: N(d.Rejection),
      })),
    [dashboardRows]
  );

  const totalArrival = N(summary.totalArrival);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="grid gap-3 grid-cols-2 lg:grid-cols-4 2xl:grid-cols-7">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-xl border border-slate-200 bg-slate-100" />
          ))}
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <ChartSkeleton height={240} />
          <ChartSkeleton height={240} />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ── Headline stats. Each names its denominator. ─────────────────── */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4 2xl:grid-cols-7">
        <StatTile
          label="Arrivals"
          value={num(totalArrival)}
          denominator="Base for every share below"
          icon={<Users className="h-4 w-4" />}
        />
        <StatTile
          label="Selected"
          value={num(N(summary.totalSelection))}
          denominator={`${pct(ratio(N(summary.totalSelection), totalArrival) ?? 0)} of arrivals`}
          intent="good"
          icon={<Target className="h-4 w-4" />}
        />
        <StatTile
          label="Rejected"
          value={num(N(summary.totalRejection))}
          denominator={`${pct(ratio(N(summary.totalRejection), totalArrival) ?? 0)} of arrivals`}
          intent="critical"
          icon={<XCircle className="h-4 w-4" />}
        />
        {/*
          "Pending" is waiting + client-round-pending. Client-round-pending was hardcoded to 0
          by a bug in the row classifier, so Pending was arithmetically identical to Waiting and
          the two tiles beside each other always showed the same number under different names.
          With that fixed they differ again, and the sub-label says what the difference is.
        */}
        <StatTile
          label="Pending"
          value={num(N(summary.pending))}
          denominator={`${num(N(summary.waiting))} waiting + ${num(N(summary.clientRoundPending))} client round`}
          intent="warning"
          icon={<Clock className="h-4 w-4" />}
        />
        <StatTile
          label="No Show"
          value={num(N(summary.noShow))}
          denominator={`${pct(ratio(N(summary.noShow), totalArrival) ?? 0)} of arrivals`}
          intent={N(summary.noShow) > 0 ? "warning" : "good"}
          icon={<UserRound className="h-4 w-4" />}
        />
        <StatTile
          label="SLA Breach"
          value={num(N(summary.slaBreach))}
          denominator={`${pct(N(summary.slaBreachRate))} breach rate`}
          intent={N(summary.slaBreach) > 0 ? "critical" : "good"}
          icon={<AlertTriangle className="h-4 w-4" />}
        />
        {/*
          Median, with the mean beside it — and both in readable units.
          This tile printed raw minutes ("32763m"), which is 22.8 days, because the mean was
          taken over every row ever loaded including closed and dormant ones whose elapsed time
          is measured against now() and grows daily. It is now the median over open rows, which
          is what "how long is someone waiting" actually means, and the mean is shown alongside
          so a long tail is visible rather than hidden.
        */}
        <StatTile
          label="Median Wait"
          value={durationLabel(N(summary.medianWaitMinutes))}
          denominator={`mean ${durationLabel(N(summary.avgWaitMinutes))} · ${num(N(summary.onHold))} on hold`}
          icon={<TimerReset className="h-4 w-4" />}
        />
      </div>

      {/* ── SLA breach alert ────────────────────────────────────────────── */}
      {slaBreachQueue.length > 0 && (
        <div role="alert" className="rounded-xl border-2 border-rose-200 bg-rose-50 px-4 py-3">
          <h3 className="flex items-center gap-2 text-xs font-bold text-rose-900">
            <AlertTriangle className="h-4 w-4" />
            {/* "Currently open" distinguishes this from the SLA Breach tile above, which counts
                every breach ever recorded including candidates long since closed. Two different
                true numbers under one word was the confusing part, not either number. */}
            SLA breached — {num(slaBreachQueue.length)} currently-open candidate{slaBreachQueue.length === 1 ? "" : "s"} past target
            {slaBreachQueue.length > 5 && (
              <span className="font-semibold text-rose-700">· longest 5 shown</span>
            )}
          </h3>
          <div className="mt-2.5 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            {slaBreachQueue.slice(0, 5).map((row, i) => (
              <div
                key={`${S(row.QToken)}-${i}`}
                className="flex items-center gap-2 rounded-lg border border-rose-200 bg-white px-2.5 py-1.5 text-[11px]"
              >
                <span className="font-mono font-semibold text-rose-700">{S(row.QToken) || "—"}</span>
                <span className="min-w-0 flex-1 truncate text-slate-700">{S(row.FullName)}</span>
                <span className="shrink-0 font-bold tabular-nums text-rose-700">
                  {durationLabel(N(row.WaitingMinutes))}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Branch performance + source mix ─────────────────────────────── */}
      <div className="grid gap-4 xl:grid-cols-2">
        <ChartCard
          title="Branch Performance"
          subtitle="Arrivals against selections per branch, highest volume first."
          footer={
            <CoverageNote
              shownGroups={topBranches.length}
              distinctGroups={(branchTable || []).length}
              shownRecords={topBranches.reduce((sum, b) => sum + b.arrival, 0)}
              otherGroups={Math.max(0, (branchTable || []).length - topBranches.length)}
              otherRecords={Math.max(
                0,
                (branchTable || []).reduce((sum, b) => sum + N(b.TotalArrival), 0) -
                  topBranches.reduce((sum, b) => sum + b.arrival, 0)
              )}
              unit="arrivals"
            />
          }
        >
          {topBranches.length === 0 ? (
            <EmptyState label="No branch data for these filters" height={240} />
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(220, topBranches.length * 34)}>
              <BarChart data={topBranches} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 4 }}>
                <CartesianGrid {...GRID_PROPS} vertical horizontal={false} />
                <XAxis type="number" tick={AXIS_TICK} allowDecimals={false} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="name" width={110} tick={AXIS_TICK} axisLine={false} tickLine={false} />
                <Tooltip
                  cursor={{ fill: "#f1f5f9" }}
                  contentStyle={TOOLTIP_STYLE}
                  formatter={(value: number, name: string) => [num(value), name]}
                  labelFormatter={(label, payload) => {
                    const row: any = payload?.[0]?.payload;
                    return row ? `${label} — ${pct(row.selectionRate)} selection rate` : label;
                  }}
                />
                {/* Two series demand a legend — the original chart had none. */}
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, paddingTop: 6 }} />
                <Bar dataKey="arrival" name="Arrivals" fill={SERIES[0]} radius={[0, 3, 3, 0]} barSize={11} />
                <Bar dataKey="selected" name="Selected" fill={SERIES[5]} radius={[0, 3, 3, 0]} barSize={11} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard
          title="Source Mix"
          subtitle="Share of arrivals by sourcing channel."
          footer={
            <CoverageNote
              shownGroups={sourceMix.shownGroups}
              distinctGroups={sourceMix.distinctGroups}
              shownRecords={sourceMix.shownRecords}
              otherGroups={sourceMix.otherGroups}
              otherRecords={sourceMix.otherRecords}
              unit="arrivals"
            />
          }
        >
          {sourceMix.slices.length === 0 ? (
            <EmptyState label="No source data for these filters" height={240} />
          ) : (
            <div className="grid gap-4 sm:grid-cols-[180px_minmax(0,1fr)] sm:items-center">
              <div className="relative mx-auto h-[180px] w-full max-w-[180px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={sourceMix.slices}
                      cx="50%"
                      cy="50%"
                      innerRadius={52}
                      outerRadius={82}
                      dataKey="value"
                      paddingAngle={2}
                      stroke="#fff"
                      strokeWidth={2}
                    >
                      {sourceMix.slices.map((slice: any, idx) => (
                        <Cell key={slice.name} fill={slice.isOther ? "#94a3b8" : SERIES[idx % SERIES.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={TOOLTIP_STYLE}
                      formatter={(value: number, name: string) => [
                        `${num(value)} · ${pct(ratio(value, sourceMix.total) ?? 0)}`,
                        name,
                      ]}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">Arrivals</span>
                  <span className="text-lg font-bold tabular-nums text-slate-900">{num(sourceMix.total)}</span>
                </div>
              </div>

              {/* Direct labels — the relief required for the low-contrast slots. */}
              <ul className="space-y-1.5">
                {sourceMix.slices.map((slice: any, idx) => (
                  <li key={slice.name} className="flex items-center gap-2 text-xs">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-sm"
                      style={{ backgroundColor: slice.isOther ? "#94a3b8" : SERIES[idx % SERIES.length] }}
                    />
                    <span className="min-w-0 flex-1 truncate text-slate-700">{slice.name}</span>
                    <span className="shrink-0 font-semibold tabular-nums text-slate-900">{num(slice.value)}</span>
                    <span className="w-12 shrink-0 text-right tabular-nums text-slate-500">
                      {pct(ratio(slice.value, sourceMix.total) ?? 0)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </ChartCard>
      </div>

      {/* ── Period comparison ───────────────────────────────────────────── */}
      {trendData.length > 0 && (
        <ChartCard
          title="Period Comparison"
          subtitle="Arrivals, selections and rejections across the reporting periods."
        >
          <ResponsiveContainer width="100%" height={230}>
            <ComposedChart data={trendData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="coverArrivalFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={SERIES[0]} stopOpacity={0.2} />
                  <stop offset="100%" stopColor={SERIES[0]} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid {...GRID_PROPS} />
              <XAxis dataKey="period" tick={AXIS_TICK} axisLine={false} tickLine={false} />
              <YAxis tick={AXIS_TICK} allowDecimals={false} axisLine={false} tickLine={false} width={44} />
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                formatter={(value: number, name: string) => [num(value), name]}
              />
              <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, paddingTop: 6 }} />
              <Area
                type="monotone"
                dataKey="arrivals"
                name="Arrivals"
                stroke={SERIES[0]}
                strokeWidth={2}
                fill="url(#coverArrivalFill)"
                dot={{ r: 3, strokeWidth: 0, fill: SERIES[0] }}
              />
              <Line
                type="monotone"
                dataKey="selected"
                name="Selected"
                stroke={SERIES[5]}
                strokeWidth={2}
                dot={{ r: 3, strokeWidth: 0, fill: SERIES[5] }}
              />
              <Line
                type="monotone"
                dataKey="rejected"
                name="Rejected"
                stroke={SERIES[1]}
                strokeWidth={2}
                dot={{ r: 3, strokeWidth: 0, fill: SERIES[1] }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </ChartCard>
      )}

      {/* ── Process + recruiter ledgers ─────────────────────────────────── */}
      <div className="grid gap-4 xl:grid-cols-2">
        <ChartCard
          title="Top Processes"
          subtitle="Highest-volume processes and their selection rate."
          action={
            <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-semibold text-slate-600">
              {num((processTable || []).length)} total
            </span>
          }
        >
          {(processTable || []).length === 0 ? (
            <EmptyState label="No process data" height={160} />
          ) : (
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full min-w-[420px] text-xs">
                <thead className="bg-slate-50">
                  <tr className="border-b border-slate-200 text-slate-600">
                    <th className="px-3 py-2 text-left font-semibold">Process</th>
                    <th className="px-3 py-2 text-right font-semibold">Arrival</th>
                    <th className="px-3 py-2 text-right font-semibold">Selected</th>
                    <th className="px-3 py-2 text-right font-semibold">Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {(processTable || []).slice(0, 10).map((p, i) => (
                    <tr key={`${S(p.Name)}-${i}`} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/60">
                      <td className="max-w-[160px] truncate px-3 py-2 font-medium text-slate-800" title={S(p.Name)}>
                        {S(p.Name) || "—"}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-600">{num(N(p.TotalArrival))}</td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums text-emerald-700">
                        {num(N(p.Selection))}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-600">{pct(N(p.SelectionRate))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {(processTable || []).length > 10 && (
                <p className="border-t border-slate-100 bg-slate-50 px-3 py-1.5 text-[10px] text-slate-500">
                  Showing 10 of {num((processTable || []).length)} — ranked by arrivals.
                </p>
              )}
            </div>
          )}
        </ChartCard>

        <ChartCard
          title="Recruiter Productivity"
          subtitle="Sourcing volume with selection and SLA compliance."
          action={
            <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-semibold text-slate-600">
              {num((recruiterTable || []).length)} total
            </span>
          }
        >
          {(recruiterTable || []).length === 0 ? (
            <EmptyState label="No recruiter data" height={160} />
          ) : (
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full min-w-[420px] text-xs">
                <thead className="bg-slate-50">
                  <tr className="border-b border-slate-200 text-slate-600">
                    <th className="px-3 py-2 text-left font-semibold">Recruiter</th>
                    <th className="px-3 py-2 text-right font-semibold">Sourced</th>
                    <th className="px-3 py-2 text-right font-semibold">Sel %</th>
                    <th className="px-3 py-2 text-right font-semibold">SLA %</th>
                  </tr>
                </thead>
                <tbody>
                  {(recruiterTable || []).slice(0, 10).map((r, i) => (
                    <tr key={`${S(r.Recruiter)}-${i}`} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/60">
                      <td className="max-w-[160px] truncate px-3 py-2 font-medium text-slate-800" title={S(r.Recruiter)}>
                        {S(r.Recruiter) || "—"}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-600">{num(N(r.SourcedCount))}</td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums text-emerald-700">
                        {pct(N(r.SelectionRate))}
                      </td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums text-blue-700">
                        {pct(N(r.SlaCompliancePercent))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {(recruiterTable || []).length > 10 && (
                <p className="border-t border-slate-100 bg-slate-50 px-3 py-1.5 text-[10px] text-slate-500">
                  Showing 10 of {num((recruiterTable || []).length)} — full list on the Recruiters tab.
                </p>
              )}
            </div>
          )}
        </ChartCard>
      </div>
    </div>
  );
}
