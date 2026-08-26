import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

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

/**
 * Rejection reasons are now grouped on the server.
 *
 * This tab used to receive every candidate row on the dashboard — 8,229 of them, 206 fields
 * each — and group them in the browser to draw one chart and list 50 records. The grouping
 * moved to commandCenterData(); the normalisation rule (hard reject reason, then VOC, then
 * "Unspecified", case- and whitespace-insensitive) moved with it unchanged.
 */
interface RejectionsTabProps {
  rejections: {
    total: number;
    distinctReasons: number;
    reasons: { label: string; count: number }[];
    rows: AnyRow[];
  } | null;
  loading?: boolean;
}

const S = (v: unknown) => String(v ?? "");
const CHART_GROUPS = 8;

export function RejectionsTab({ rejections: source, loading }: RejectionsTabProps) {
  const model = useMemo(() => {
    const rejections = source?.rows ?? [];
    const all = source?.reasons ?? [];
    const head = all.slice(0, CHART_GROUPS);
    const tail = all.slice(CHART_GROUPS);
    const tailCount = tail.reduce((sum, r) => sum + r.count, 0);

    return {
      rejections,
      total: source?.total ?? 0,
      distinctReasons: source?.distinctReasons ?? 0,
      /**
       * Explicit "Other" bar. Slicing to the top eight while showing each share
       * against the full rejection total made the visible bars add to less than
       * 100% with nothing accounting for the gap.
       */
      bars: tailCount > 0
        ? [...head, { label: `Other (${tail.length} reasons)`, count: tailCount, isOther: true }]
        : head,
      head,
      tail,
      tailCount,
    };
  }, [source]);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-xl border border-slate-200 bg-slate-100" />
          ))}
        </div>
        <ChartSkeleton height={260} />
      </div>
    );
  }

  const { rejections, total, distinctReasons, bars, head, tail, tailCount } = model;
  const topReason = head[0];

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile
          label="Total Rejections"
          value={num(total)}
          denominator="In the current filter scope"
          intent="critical"
        />
        <StatTile
          label="Distinct Reasons"
          value={num(distinctReasons)}
          denominator="After case and spacing normalisation"
        />
        <StatTile
          label="Top Reason"
          value={topReason ? topReason.label : "—"}
          denominator={
            topReason ? `${num(topReason.count)} candidates · ${pct(ratio(topReason.count, total) ?? 0)} of rejections` : "No rejections"
          }
          intent="warning"
        />
      </div>

      <ChartCard
        title="Rejection Reasons"
        subtitle="Ranked by volume. Bars sum to the total rejection count above."
        footer={
          <CoverageNote
            shownGroups={head.length}
            distinctGroups={distinctReasons}
            shownRecords={head.reduce((sum, r) => sum + r.count, 0)}
            otherGroups={tail.length}
            otherRecords={tailCount}
            unit="rejections"
          />
        }
      >
        {bars.length === 0 ? (
          <EmptyState label="No rejections in this period" hint="That is a real zero, not a missing feed." height={220} />
        ) : (
          <ResponsiveContainer width="100%" height={Math.max(220, bars.length * 36)}>
            <BarChart data={bars} layout="vertical" margin={{ top: 4, right: 88, bottom: 4, left: 4 }}>
              <CartesianGrid {...GRID_PROPS} vertical horizontal={false} />
              <XAxis type="number" tick={AXIS_TICK} allowDecimals={false} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="label" width={190} tick={AXIS_TICK} axisLine={false} tickLine={false} />
              <Tooltip
                cursor={{ fill: "#f1f5f9" }}
                contentStyle={TOOLTIP_STYLE}
                formatter={(value: number) => [
                  `${num(value)} · ${pct(ratio(value, total) ?? 0)} of rejections`,
                  "Candidates",
                ]}
              />
              {/*
                A ranked bar chart, not a pie. Eight rejection reasons in a pie
                cannot be compared by eye, and the previous red-only ramp meant
                the smallest slices were also the palest.
              */}
              <Bar dataKey="count" radius={[0, 4, 4, 0]} barSize={18}>
                <LabelList
                  dataKey="count"
                  position="right"
                  formatter={(v: number) => `${num(v)} (${pct(ratio(v, total) ?? 0)})`}
                  style={{ fontSize: 11, fill: "#475569", fontWeight: 600 }}
                />
                {bars.map((row: any, index) => (
                  <Cell key={row.label} fill={row.isOther ? "#94a3b8" : SERIES[index % SERIES.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      <ChartCard
        title="Rejected Candidates"
        subtitle="Individual records behind the counts above."
        action={
          <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-semibold text-slate-600">
            {total > rejections.length ? `First ${num(rejections.length)} of ${num(total)}` : `${num(total)} records`}
          </span>
        }
      >
        {rejections.length === 0 ? (
          <EmptyState label="No rejections in this period" height={140} />
        ) : (
          <div className="max-h-[440px] overflow-auto rounded-lg border border-slate-200">
            <table className="w-full min-w-[760px] text-xs">
              <thead className="sticky top-0 z-10 bg-slate-50">
                <tr className="border-b border-slate-200 text-slate-600">
                  <th className="px-3 py-2 text-left font-semibold">ID</th>
                  <th className="px-3 py-2 text-left font-semibold">Candidate</th>
                  <th className="px-3 py-2 text-left font-semibold">Branch</th>
                  <th className="px-3 py-2 text-left font-semibold">Stage</th>
                  <th className="px-3 py-2 text-left font-semibold">Reason</th>
                  <th className="px-3 py-2 text-left font-semibold">VOC</th>
                </tr>
              </thead>
              <tbody>
                {rejections.slice(0, 50).map((row, i) => (
                  <tr key={`${S(row.CandidateID)}-${i}`} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/60">
                    <td className="px-3 py-2 font-mono text-slate-500">{S(row.CandidateID) || "—"}</td>
                    <td className="px-3 py-2 font-medium text-slate-800">{S(row.FullName) || "—"}</td>
                    <td className="px-3 py-2 text-slate-600">{S(row.Branch) || "—"}</td>
                    <td className="px-3 py-2 text-slate-600">{S(row._endStage) || "—"}</td>
                    <td className="px-3 py-2 font-medium text-orange-700">{S(row._hardRejectReason) || "—"}</td>
                    <td className="max-w-[200px] truncate px-3 py-2 text-slate-600" title={S(row.rejection_voc)}>
                      {S(row.rejection_voc) || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {total > rejections.length && (
              <p className="border-t border-slate-100 bg-slate-50 px-3 py-1.5 text-[10px] text-slate-500">
                Showing the first {num(rejections.length)} of {num(total)} rejected candidates. Narrow the filters to see the rest.
              </p>
            )}
          </div>
        )}
      </ChartCard>
    </div>
  );
}
