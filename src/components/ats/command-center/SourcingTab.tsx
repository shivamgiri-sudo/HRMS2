import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

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

interface SourcingTabProps {
  sourceTable: AnyRow[];
  reusablePool: AnyRow[];
  /** Size of the whole pool. `reusablePool` is only the page of it that ships. */
  reusableTotal?: number;
  loading?: boolean;
}

const N = (v: unknown) => Number(v || 0);
const S = (v: unknown) => String(v ?? "");
const MIX_GROUPS = 6;
const BAR_GROUPS = 10;

export function SourcingTab({ sourceTable, reusablePool, reusableTotal, loading }: SourcingTabProps) {
  const model = useMemo(() => {
    const rows = sourceTable || [];
    const total = rows.reduce((sum, r) => sum + N(r.TotalArrival), 0);
    const selected = rows.reduce((sum, r) => sum + N(r.Selection), 0);

    const mixHead = rows.slice(0, MIX_GROUPS);
    const mixTail = rows.slice(MIX_GROUPS);
    const mixTailTotal = mixTail.reduce((sum, r) => sum + N(r.TotalArrival), 0);

    const barHead = rows.slice(0, BAR_GROUPS);
    const barTail = rows.slice(BAR_GROUPS);

    // Best converting channel among those with meaningful volume — a channel with
    // one arrival and one selection is 100% and tells nobody anything.
    //
    // "Unspecified" is excluded too: it is the absence of a channel, it holds 2,735 arrivals
    // with zero selections, and leaving it in the comparison means the ranking is partly a
    // ranking of a data gap.
    const meaningful = rows.filter((r) => N(r.TotalArrival) >= 5 && !r.IsUnattributed);
    const best = [...meaningful].sort(
      (a, b) => (ratio(N(b.Selection), N(b.TotalArrival)) ?? 0) - (ratio(N(a.Selection), N(a.TotalArrival)) ?? 0)
    )[0];

    return {
      rows,
      total,
      selected,
      best,
      mix: mixTailTotal > 0
        ? [...mixHead.map((r) => ({ name: S(r.Name) || "Unknown", value: N(r.TotalArrival) })),
           { name: `Other (${mixTail.length})`, value: mixTailTotal, isOther: true }]
        : mixHead.map((r) => ({ name: S(r.Name) || "Unknown", value: N(r.TotalArrival) })),
      mixHead,
      mixTail,
      mixTailTotal,
      bars: barHead.map((s) => ({
        name: S(s.Name).length > 14 ? `${S(s.Name).slice(0, 13)}…` : S(s.Name),
        fullName: S(s.Name),
        Arrivals: N(s.TotalArrival),
        Selected: N(s.Selection),
        Rejected: N(s.Rejection),
      })),
      barHead,
      barTail,
    };
  }, [sourceTable]);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="grid gap-4 xl:grid-cols-2">
          <ChartSkeleton height={220} />
          <ChartSkeleton height={220} />
        </div>
        <ChartSkeleton height={220} />
      </div>
    );
  }

  const { rows, total, selected, best, mix, mixHead, mixTail, mixTailTotal, bars, barHead, barTail } = model;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Total Arrivals" value={num(total)} denominator={`Across ${num(rows.length)} channels`} />
        <StatTile
          label="Selected"
          value={num(selected)}
          denominator={`${pct(ratio(selected, total) ?? 0)} overall selection rate`}
          intent="good"
        />
        <StatTile
          label="Best Converting"
          value={best ? S(best.Name) : "—"}
          denominator={
            best
              ? `${pct(ratio(N(best.Selection), N(best.TotalArrival)) ?? 0)} · ${num(N(best.TotalArrival))} arrivals`
              : "Needs 5+ arrivals to rank"
          }
          intent="good"
        />
        <StatTile
          label="Reusable Pool"
          // The pool size, not the slice length. This read the length of a 100-row page and
          // presented it as the measurement: "100 candidates worth re-approaching" when the
          // backend had simply capped the list at 100.
          value={num(reusableTotal ?? (reusablePool || []).length)}
          denominator="Prior candidates worth re-approaching"
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <ChartCard
          title="Source Mix"
          subtitle="Share of arrivals by channel."
          footer={
            <CoverageNote
              shownGroups={mixHead.length}
              distinctGroups={rows.length}
              shownRecords={mixHead.reduce((sum, r) => sum + N(r.TotalArrival), 0)}
              otherGroups={mixTail.length}
              otherRecords={mixTailTotal}
              unit="arrivals"
            />
          }
        >
          {mix.length === 0 ? (
            <EmptyState label="No source data for these filters" height={220} />
          ) : (
            <div className="grid gap-4 sm:grid-cols-[170px_minmax(0,1fr)] sm:items-center">
              <div className="relative mx-auto h-[170px] w-full max-w-[170px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={mix}
                      cx="50%"
                      cy="50%"
                      innerRadius={48}
                      outerRadius={78}
                      dataKey="value"
                      paddingAngle={2}
                      stroke="#fff"
                      strokeWidth={2}
                    >
                      {mix.map((slice: any, idx) => (
                        <Cell key={slice.name} fill={slice.isOther ? "#94a3b8" : SERIES[idx % SERIES.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={TOOLTIP_STYLE}
                      formatter={(value: number, name: string) => [
                        `${num(value)} · ${pct(ratio(value, total) ?? 0)}`,
                        name,
                      ]}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">Arrivals</span>
                  <span className="text-base font-bold tabular-nums text-slate-900">{num(total)}</span>
                </div>
              </div>

              <ul className="space-y-1.5">
                {mix.map((slice: any, idx) => (
                  <li key={slice.name} className="flex items-center gap-2 text-xs">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-sm"
                      style={{ backgroundColor: slice.isOther ? "#94a3b8" : SERIES[idx % SERIES.length] }}
                    />
                    <span className="min-w-0 flex-1 truncate text-slate-700">{slice.name}</span>
                    <span className="shrink-0 font-semibold tabular-nums text-slate-900">{num(slice.value)}</span>
                    <span className="w-12 shrink-0 text-right tabular-nums text-slate-500">
                      {pct(ratio(slice.value, total) ?? 0)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </ChartCard>

        <ChartCard
          title="Channel Outcomes"
          subtitle="Arrivals, selections and rejections per channel."
          footer={
            <CoverageNote
              shownGroups={barHead.length}
              distinctGroups={rows.length}
              shownRecords={barHead.reduce((sum, r) => sum + N(r.TotalArrival), 0)}
              otherGroups={barTail.length}
              otherRecords={barTail.reduce((sum, r) => sum + N(r.TotalArrival), 0)}
              unit="arrivals"
            />
          }
        >
          {bars.length === 0 ? (
            <EmptyState label="No source data" height={220} />
          ) : (
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={bars} margin={{ top: 8, right: 8, bottom: 28, left: 0 }}>
                <CartesianGrid {...GRID_PROPS} />
                <XAxis
                  dataKey="name"
                  tick={{ ...AXIS_TICK, fontSize: 10 }}
                  angle={-22}
                  textAnchor="end"
                  height={56}
                  interval={0}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis tick={AXIS_TICK} allowDecimals={false} axisLine={false} tickLine={false} width={44} />
                <Tooltip
                  cursor={{ fill: "#f1f5f9" }}
                  contentStyle={TOOLTIP_STYLE}
                  formatter={(value: number, name: string) => [num(value), name]}
                  labelFormatter={(label, payload) => {
                    const row: any = payload?.[0]?.payload;
                    if (!row) return label;
                    const rate = ratio(row.Selected, row.Arrivals);
                    return `${row.fullName}${rate !== null ? ` — ${pct(rate)} selection rate` : ""}`;
                  }}
                />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, paddingTop: 6 }} />
                <Bar dataKey="Arrivals" fill={SERIES[0]} radius={[3, 3, 0, 0]} barSize={14} />
                <Bar dataKey="Selected" fill={SERIES[5]} radius={[3, 3, 0, 0]} barSize={14} />
                <Bar dataKey="Rejected" fill={SERIES[1]} radius={[3, 3, 0, 0]} barSize={14} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>

      <ChartCard
        title="Channel Ledger"
        subtitle="Every channel in scope — uncapped, with shares against the total."
        action={
          <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-semibold text-slate-600">
            {num(rows.length)} channels
          </span>
        }
      >
        {rows.length === 0 ? (
          <EmptyState label="No source data" height={140} />
        ) : (
          <div className="max-h-[380px] overflow-auto rounded-lg border border-slate-200">
            <table className="w-full min-w-[620px] text-xs">
              <thead className="sticky top-0 z-10 bg-slate-50">
                <tr className="border-b border-slate-200 text-slate-600">
                  <th className="px-3 py-2 text-left font-semibold">Source</th>
                  <th className="px-3 py-2 text-right font-semibold">Arrival</th>
                  <th className="px-3 py-2 text-right font-semibold">Share</th>
                  <th className="px-3 py-2 text-right font-semibold">Selected</th>
                  <th className="px-3 py-2 text-right font-semibold">Rejected</th>
                  <th className="px-3 py-2 text-right font-semibold">Selection Rate</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={`${S(row.Name)}-${i}`} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/60">
                    <td className="px-3 py-2 font-medium text-slate-800">{S(row.Name) || "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-700">{num(N(row.TotalArrival))}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-500">
                      {pct(ratio(N(row.TotalArrival), total) ?? 0)}
                    </td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums text-emerald-700">
                      {num(N(row.Selection))}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-orange-700">{num(N(row.Rejection))}</td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums text-blue-700">
                      {pct(N(row.SelectionRate))}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-200 bg-slate-50 font-bold text-slate-900">
                  <td className="px-3 py-2">Total</td>
                  <td className="px-3 py-2 text-right tabular-nums">{num(total)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">100.0%</td>
                  <td className="px-3 py-2 text-right tabular-nums">{num(selected)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {num(rows.reduce((sum, r) => sum + N(r.Rejection), 0))}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{pct(ratio(selected, total) ?? 0)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </ChartCard>

      {(reusablePool || []).length > 0 && (
        <ChartCard
          title="Reusable Pool"
          subtitle="Candidates from earlier cycles worth re-approaching before fresh sourcing."
          action={
            <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-semibold text-slate-600">
              {`Showing ${num(Math.min(30, reusablePool.length))} of ${num(reusableTotal ?? reusablePool.length)}`}
            </span>
          }
        >
          <div className="max-h-[320px] overflow-auto rounded-lg border border-slate-200">
            <table className="w-full min-w-[620px] text-xs">
              <thead className="sticky top-0 z-10 bg-slate-50">
                <tr className="border-b border-slate-200 text-slate-600">
                  <th className="px-3 py-2 text-left font-semibold">ID</th>
                  <th className="px-3 py-2 text-left font-semibold">Candidate</th>
                  <th className="px-3 py-2 text-left font-semibold">Branch</th>
                  <th className="px-3 py-2 text-left font-semibold">Quality</th>
                  <th className="px-3 py-2 text-left font-semibold">Reason</th>
                </tr>
              </thead>
              <tbody>
                {reusablePool.slice(0, 30).map((row, i) => (
                  <tr key={`${S(row.CandidateID)}-${i}`} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/60">
                    <td className="px-3 py-2 font-mono text-slate-500">{S(row.CandidateID) || "—"}</td>
                    <td className="px-3 py-2 font-medium text-slate-800">{S(row.FullName) || "—"}</td>
                    <td className="px-3 py-2 text-slate-600">{S(row.Branch) || "—"}</td>
                    <td className="px-3 py-2 text-slate-600">{S(row._candidateQualityLabel) || "—"}</td>
                    <td className="px-3 py-2 text-blue-700">{S(row._reusableReason) || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {reusablePool.length > 30 && (
              <p className="border-t border-slate-100 bg-slate-50 px-3 py-1.5 text-[10px] text-slate-500">
                Showing the first 30 of {num(reusableTotal ?? reusablePool.length)} reusable candidates.
              </p>
            )}
          </div>
        </ChartCard>
      )}
    </div>
  );
}
