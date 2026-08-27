import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Award } from "lucide-react";

import {
  AXIS_TICK,
  ChartCard,
  ChartSkeleton,
  CoverageNote,
  EmptyState,
  GRID_PROPS,
  SERIES,
  TOOLTIP_STYLE,
  num,
  pct,
  ratio,
} from "@/components/analytics/analytics-kit";

type AnyRow = Record<string, unknown>;

interface RecruitersTabProps {
  recruiterTable: AnyRow[];
  loading?: boolean;
}

const N = (v: unknown) => Number(v || 0);
const S = (v: unknown) => String(v ?? "");
const CHART_GROUPS = 10;

function mins(v: unknown) {
  const m = Math.round(N(v));
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
}

export function RecruitersTab({ recruiterTable, loading }: RecruitersTabProps) {
  if (loading) {
    return (
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-28 animate-pulse rounded-xl border border-slate-200 bg-slate-100" />
          ))}
        </div>
        <ChartSkeleton height={260} />
      </div>
    );
  }

  const allRows = recruiterTable || [];
  /**
   * "Unassigned" is not a recruiter and must not be ranked as one.
   *
   * It carried 2,745 candidates — 33.3% of all volume — so it took first place on the podium,
   * first row of the table and the tallest bar on the chart, with a 0% selection rate and a
   * 95.6% SLA score attached to a bucket that represents nobody. Positions two and three then
   * showed the two halves of a single split identity, so the "top three recruiters" were a null
   * bucket and one person listed twice.
   *
   * It is separated out and reported above the ranking as the attribution gap it actually is.
   */
  const unattributed = allRows.filter((r) => r.IsUnattributed);
  const rows = allRows.filter((r) => !r.IsUnattributed);
  const head = rows.slice(0, CHART_GROUPS);
  const tail = rows.slice(CHART_GROUPS);
  const totalSourced = allRows.reduce((sum, r) => sum + N(r.SourcedCount), 0);
  const unassignedCount = unattributed.reduce((sum, r) => sum + N(r.SourcedCount), 0);

  const chartData = head.map((r) => ({
    name: S(r.Recruiter).length > 14 ? `${S(r.Recruiter).slice(0, 13)}…` : S(r.Recruiter),
    fullName: S(r.Recruiter),
    Sourced: N(r.SourcedCount),
    Attended: N(r.AttendedCount),
    selectionRate: N(r.SelectionRate),
  }));

  return (
    <div className="space-y-4">
      {/* ── Unassigned volume, stated rather than ranked ─────────────────── */}
      {unassignedCount > 0 && (
        <div role="note" className="rounded-xl border-2 border-amber-200 bg-amber-50 px-4 py-3">
          <h3 className="text-xs font-bold text-amber-900">
            {num(unassignedCount)} candidate{unassignedCount === 1 ? "" : "s"} have no recruiter recorded
            {totalSourced > 0 && ` — ${((unassignedCount / totalSourced) * 100).toFixed(1)}% of all sourcing`}
          </h3>
          <p className="mt-1 text-[11px] text-amber-800">
            Excluded from the ranking below, which covers the {num(rows.length)} named recruiters. These
            candidates cannot be credited to anyone and are not counted in any recruiter&apos;s rates.
          </p>
        </div>
      )}

      {/* ── Podium ──────────────────────────────────────────────────────── */}
      {rows.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-3">
          {rows.slice(0, 3).map((r, i) => (
            <div
              key={`${S(r.Recruiter)}-${i}`}
              className={`relative overflow-hidden rounded-xl border p-3.5 shadow-sm transition-shadow duration-200 hover:shadow-md ${
                i === 0 ? "border-amber-300 bg-amber-50/60" : "border-slate-200 bg-white"
              }`}
            >
              <div className="flex items-center gap-2.5">
                <span
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-sm font-bold ${
                    i === 0 ? "bg-amber-400 text-amber-950" : "bg-slate-100 text-slate-500"
                  }`}
                >
                  {i === 0 ? <Award className="h-4 w-4" /> : i + 1}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-slate-900">{S(r.Recruiter) || "—"}</p>
                  <p className="truncate text-[11px] text-slate-500">{S(r.Branch) || "No branch"}</p>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Sourced</p>
                  <p className="text-sm font-bold tabular-nums text-slate-900">{num(N(r.SourcedCount))}</p>
                  <p className="text-[10px] tabular-nums text-slate-400">
                    {pct(ratio(N(r.SourcedCount), totalSourced) ?? 0)} of all
                  </p>
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Sel %</p>
                  <p className="text-sm font-bold tabular-nums text-emerald-700">{pct(N(r.SelectionRate))}</p>
                  <p className="text-[10px] text-slate-400">of attended</p>
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">SLA %</p>
                  <p className="text-sm font-bold tabular-nums text-blue-700">{pct(N(r.SlaCompliancePercent))}</p>
                  <p className="text-[10px] text-slate-400">within target</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Volume chart ────────────────────────────────────────────────── */}
      <ChartCard
        title="Recruiter Volume"
        subtitle="Candidates sourced against candidates actually attended, highest volume first."
        footer={
          <CoverageNote
            shownGroups={head.length}
            distinctGroups={rows.length}
            shownRecords={head.reduce((sum, r) => sum + N(r.SourcedCount), 0)}
            otherGroups={tail.length}
            otherRecords={tail.reduce((sum, r) => sum + N(r.SourcedCount), 0)}
            unit="sourced"
          />
        }
      >
        {chartData.length === 0 ? (
          <EmptyState label="No recruiter data for these filters" height={240} />
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 28, left: 0 }}>
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
                  return row ? `${row.fullName} — ${pct(row.selectionRate)} selection rate` : label;
                }}
              />
              {/*
                Sourced and Attended only. "Sel%" was previously mapped into the
                same dataset as the two counts — a percentage and a headcount on
                one value axis, where a 40% rate renders shorter than 50 people
                and means nothing next to it. The rate now lives in the tooltip
                and the table, on its own terms.
              */}
              <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, paddingTop: 6 }} />
              <Bar dataKey="Sourced" fill={SERIES[0]} radius={[3, 3, 0, 0]} barSize={18} />
              <Bar dataKey="Attended" fill={SERIES[2]} radius={[3, 3, 0, 0]} barSize={18} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      {/* ── Full ledger ─────────────────────────────────────────────────── */}
      <ChartCard
        title="All Recruiters"
        subtitle="Every recruiter in scope — uncapped."
        action={
          <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-semibold text-slate-600">
            {num(rows.length)} recruiters · {num(totalSourced)} sourced
          </span>
        }
      >
        {rows.length === 0 ? (
          <EmptyState label="No recruiter data" height={140} />
        ) : (
          <div className="max-h-[460px] overflow-auto rounded-lg border border-slate-200">
            <table className="w-full min-w-[760px] text-xs">
              <thead className="sticky top-0 z-10 bg-slate-50">
                <tr className="border-b border-slate-200 text-slate-600">
                  <th className="px-3 py-2 text-left font-semibold">Recruiter</th>
                  <th className="px-3 py-2 text-left font-semibold">Branch</th>
                  <th className="px-3 py-2 text-right font-semibold">Sourced</th>
                  <th className="px-3 py-2 text-right font-semibold">Share</th>
                  <th className="px-3 py-2 text-right font-semibold">Attended</th>
                  <th className="px-3 py-2 text-right font-semibold">Sel %</th>
                  <th className="px-3 py-2 text-right font-semibold">SLA %</th>
                  <th className="px-3 py-2 text-right font-semibold">Avg Wait</th>
                  <th className="px-3 py-2 text-left font-semibold">Flag</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={`${S(r.Recruiter)}-${i}`} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/60">
                    <td className="px-3 py-2 font-medium text-slate-800">{S(r.Recruiter) || "—"}</td>
                    <td className="px-3 py-2 text-slate-600">{S(r.Branch) || "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-700">{num(N(r.SourcedCount))}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-500">
                      {pct(ratio(N(r.SourcedCount), totalSourced) ?? 0)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-700">{num(N(r.AttendedCount))}</td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums text-emerald-700">
                      {pct(N(r.SelectionRate))}
                    </td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums text-blue-700">
                      {pct(N(r.SlaCompliancePercent))}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-600">{mins(r.AvgWaitMinutes)}</td>
                    <td className="px-3 py-2">
                      {r.AttentionFlag ? (
                        <span className="inline-flex rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">
                          {S(r.AttentionFlag)}
                        </span>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-200 bg-slate-50 font-bold text-slate-900">
                  <td className="px-3 py-2" colSpan={2}>
                    Total
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{num(totalSourced)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">100.0%</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {num(rows.reduce((sum, r) => sum + N(r.AttendedCount), 0))}
                  </td>
                  <td className="px-3 py-2" colSpan={4} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </ChartCard>
    </div>
  );
}
