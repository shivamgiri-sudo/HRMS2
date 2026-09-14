import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  CircleSlash,
  Clock,
  Search,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  findAttentionItems,
  formatKpiValue,
  splitMovements,
  type AttentionItem,
  type AttentionKind,
  type KpiLike,
  type MetricMovement,
} from "./kpiInsights";

/**
 * The "what happened, and what should I do about it" layer on the KPI dashboard.
 *
 * A grid of KPI cards tells you the numbers but not the story: it takes reading twelve cards and
 * remembering yesterday's values to work out that handle time slipped while quality improved. This
 * states it directly — what moved the right way, what moved the wrong way, and what needs somebody
 * to act — and then lets any KPI be opened to see the day-by-day trend against its target and,
 * where the KPI is calculated by a formula, exactly which inputs produced each day's number.
 *
 * That last part is the root-cause piece. Without it "no data" is indistinguishable from "mapped to
 * the wrong column" and from "genuinely took no calls".
 */

interface KpiInsightBoardProps {
  kpis: KpiLike[];
  /** Whose KPIs these are. Needed for the explanation lookup; omit for a self view. */
  employeeId?: string | null;
  /** Renders the drill-down. Injected so this component does not depend on the query layer. */
  renderExplanation?: (metricId: string, metricName: string) => React.ReactNode;
}

const ATTENTION_STYLE: Record<AttentionKind, { border: string; badge: string; label: string; icon: React.ReactNode }> = {
  breached: {
    border: "border-rose-200 bg-rose-50",
    badge: "bg-rose-600 text-white",
    label: "Past the limit",
    icon: <AlertTriangle className="h-3.5 w-3.5" />,
  },
  far_below: {
    border: "border-orange-200 bg-orange-50",
    badge: "bg-orange-500 text-white",
    label: "Well below target",
    icon: <TrendingDown className="h-3.5 w-3.5" />,
  },
  stale: {
    border: "border-amber-200 bg-amber-50",
    badge: "bg-amber-500 text-white",
    label: "Data has stopped",
    icon: <Clock className="h-3.5 w-3.5" />,
  },
  declining: {
    border: "border-yellow-200 bg-yellow-50",
    badge: "bg-yellow-500 text-white",
    label: "Sliding",
    icon: <TrendingDown className="h-3.5 w-3.5" />,
  },
  never: {
    border: "border-slate-200 bg-slate-50",
    badge: "bg-slate-400 text-white",
    label: "Nothing recorded",
    icon: <CircleSlash className="h-3.5 w-3.5" />,
  },
};

export function KpiInsightBoard({ kpis, renderExplanation }: KpiInsightBoardProps) {
  const [openMetric, setOpenMetric] = useState<{ id: string; name: string } | null>(null);

  const { improved, declined } = useMemo(() => splitMovements(kpis), [kpis]);
  const attention = useMemo(() => findAttentionItems(kpis), [kpis]);

  const selected = useMemo(() => kpis.find((kpi) => kpi.metric_id === openMetric?.id) ?? null, [kpis, openMetric]);

  return (
    <div className="space-y-5">
      <div className="grid gap-4 lg:grid-cols-3">
        <MovementCard
          tone="good"
          title="Moved the right way"
          empty="Nothing improved between the last two readings."
          movements={improved}
          onOpen={(movement) => setOpenMetric({ id: movement.metric_id, name: movement.metric_name })}
        />
        <MovementCard
          tone="bad"
          title="Moved the wrong way"
          empty="Nothing got worse between the last two readings."
          movements={declined}
          onOpen={(movement) => setOpenMetric({ id: movement.metric_id, name: movement.metric_name })}
        />
        <AttentionCard
          items={attention}
          onOpen={(item) => setOpenMetric({ id: item.metric_id, name: item.metric_name })}
        />
      </div>

      {/* ── Drill-down ── */}
      {selected && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold text-slate-900">{selected.metric_name}</h3>
              <p className="mt-0.5 text-sm text-slate-500">
                {formatKpiValue(selected.actual_value, selected.unit)} against a target of{" "}
                {formatKpiValue(selected.target_value, selected.unit)}
                {selected.min_threshold !== null && (
                  <>
                    {" "}
                    · {selected.direction === "lower_is_better" ? "limit" : "minimum"}{" "}
                    {formatKpiValue(selected.min_threshold, selected.unit)}
                  </>
                )}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setOpenMetric(null)}
              className="cursor-pointer text-sm text-slate-400 transition-colors hover:text-slate-700"
            >
              Close
            </button>
          </div>

          <KpiTrendChart kpi={selected} />

          {renderExplanation && (
            <div className="mt-5 border-t border-slate-200 pt-4">
              {renderExplanation(selected.metric_id, selected.metric_name)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MovementCard({
  tone,
  title,
  empty,
  movements,
  onOpen,
}: {
  tone: "good" | "bad";
  title: string;
  empty: string;
  movements: MetricMovement[];
  onOpen: (movement: MetricMovement) => void;
}) {
  const good = tone === "good";
  return (
    <section
      className={`rounded-2xl border p-4 ${good ? "border-emerald-200 bg-emerald-50/50" : "border-rose-200 bg-rose-50/50"}`}
    >
      <h3 className={`flex items-center gap-1.5 text-sm font-semibold ${good ? "text-emerald-800" : "text-rose-800"}`}>
        {good ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
        {title}
      </h3>

      {movements.length === 0 ? (
        <p className="mt-2 text-xs text-slate-500">{empty}</p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {movements.slice(0, 5).map((movement) => (
            <li key={movement.metric_id}>
              <button
                type="button"
                onClick={() => onOpen(movement)}
                className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg bg-white/80 px-2.5 py-1.5 text-left transition-colors hover:bg-white"
              >
                <span className="min-w-0">
                  <span className="block truncate text-xs font-medium text-slate-800">{movement.metric_name}</span>
                  {/* The dates are shown because the comparison is "the last two days with data",
                      not "yesterday and the day before" — an agent on week-off has no row for it,
                      and silently comparing across a gap would be misleading. */}
                  <span className="block text-[11px] text-slate-400">
                    {movement.previousDate} → {movement.latestDate}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span
                    className={`flex items-center gap-0.5 text-xs font-semibold ${
                      good ? "text-emerald-700" : "text-rose-700"
                    }`}
                  >
                    {movement.change > 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                    {movement.changePct === null
                      ? formatKpiValue(Math.abs(movement.change), movement.unit)
                      : `${Math.abs(Math.round(movement.changePct))}%`}
                  </span>
                  <span className="block text-[11px] text-slate-500">
                    {formatKpiValue(movement.latest, movement.unit)}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function AttentionCard({
  items,
  onOpen,
}: {
  items: AttentionItem[];
  onOpen: (item: AttentionItem) => void;
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
        <AlertTriangle className="h-4 w-4 text-amber-500" />
        Needs attention
      </h3>

      {items.length === 0 ? (
        <p className="mt-2 text-xs text-slate-500">
          Nothing is past a limit or well below target, and every KPI has recent data.
        </p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {items.slice(0, 6).map((item) => {
            const style = ATTENTION_STYLE[item.kind];
            return (
              <li key={`${item.metric_id}-${item.kind}`}>
                <button
                  type="button"
                  onClick={() => onOpen(item)}
                  className={`w-full cursor-pointer rounded-lg border px-2.5 py-1.5 text-left transition-opacity hover:opacity-80 ${style.border}`}
                >
                  <span className="flex items-center gap-1.5">
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${style.badge}`}
                    >
                      {style.icon}
                      {style.label}
                    </span>
                  </span>
                  <span className="mt-1 block text-[11px] leading-snug text-slate-700">{item.message}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/**
 * Trend against target.
 *
 * The target and the threshold are drawn as reference lines rather than described in a legend,
 * because "is this line above or below where it should be" is the question, and answering it from a
 * number in a caption means holding two things in your head at once.
 */
function KpiTrendChart({ kpi }: { kpi: KpiLike }) {
  const data = useMemo(
    () =>
      [...(kpi.trend_data ?? [])]
        .sort((left, right) => left.date.localeCompare(right.date))
        .map((point) => ({ date: point.date.slice(5), value: Number(point.value), source: point.source })),
    [kpi.trend_data],
  );

  if (data.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-slate-200 p-6 text-center text-sm text-slate-500">
        No daily values in this period, so there is no trend to draw.
      </p>
    );
  }

  if (data.length === 1) {
    // A single point is not a trend, and a chart with one dot invites reading a direction into it.
    return (
      <p className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
        Only one day of data so far ({data[0].date}: {formatKpiValue(data[0].value, kpi.unit)}). A trend
        needs at least two.
      </p>
    );
  }

  const lowerIsBetter = kpi.direction === "lower_is_better";

  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
          <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#64748b" }} stroke="#cbd5e1" />
          <YAxis tick={{ fontSize: 11, fill: "#64748b" }} stroke="#cbd5e1" width={48} />
          <RechartsTooltip
            formatter={(value: number) => [formatKpiValue(value, kpi.unit), kpi.metric_name]}
            contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }}
          />

          <ReferenceLine
            y={kpi.target_value}
            stroke="#0f766e"
            strokeDasharray="5 4"
            label={{ value: "target", position: "right", fontSize: 10, fill: "#0f766e" }}
          />
          {kpi.min_threshold !== null && (
            <ReferenceLine
              y={kpi.min_threshold}
              stroke="#e11d48"
              strokeDasharray="2 3"
              label={{
                value: lowerIsBetter ? "limit" : "minimum",
                position: "right",
                fontSize: 10,
                fill: "#e11d48",
              }}
            />
          )}

          <Line
            type="monotone"
            dataKey="value"
            stroke="#4f46e5"
            strokeWidth={2}
            dot={{ r: 2.5, fill: "#4f46e5" }}
            activeDot={{ r: 4 }}
            // Gaps are gaps. Joining across a day with no data would draw a line through a
            // measurement that was never taken.
            connectNulls={false}
          />
        </LineChart>
      </ResponsiveContainer>
      <p className="mt-1 text-center text-[11px] text-slate-400">
        {lowerIsBetter ? "Lower is better for this KPI." : "Higher is better for this KPI."}
      </p>
    </div>
  );
}

/**
 * Day-by-day root cause for a formula-calculated KPI.
 *
 * Separated from the board so the page can supply it with its own data hook. Shows the reason
 * summary first, because "9 of the last 14 days had no calls data" is the sentence somebody needs —
 * not fourteen rows to count for themselves.
 */
export function KpiExplanationPanel({
  loading,
  explanation,
  message,
}: {
  loading: boolean;
  explanation: {
    metric_code: string;
    metric_name: string;
    days: Array<{
      date: string;
      value: number | null;
      status: string;
      reason: string | null;
      formula: string | null;
      inputs: Record<string, number | null> | null;
    }>;
    reason_summary: Array<{ reason: string; days: number }>;
  } | null;
  message?: string;
}) {
  if (loading) {
    return (
      <p className="flex items-center gap-2 text-sm text-slate-500">
        <Search className="h-4 w-4 animate-pulse" /> Looking up how this was calculated…
      </p>
    );
  }

  if (!explanation) {
    return (
      <p className="text-sm text-slate-500">
        {message ??
          "This KPI is fed by an existing sync rather than a calculation built in the Studio, so there is no per-day working to show."}
      </p>
    );
  }

  const formula = explanation.days.find((day) => day.formula)?.formula ?? null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline gap-2">
        <h4 className="text-sm font-semibold text-slate-800">How this number was worked out</h4>
        {formula && <code className="font-mono text-[11px] text-slate-600">{formula}</code>}
      </div>

      {explanation.reason_summary.length > 0 && (
        <ul className="space-y-1">
          {explanation.reason_summary.map((entry) => (
            <li
              key={entry.reason}
              className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900"
            >
              <span className="mt-px shrink-0 rounded bg-amber-500 px-1.5 text-[10px] font-bold text-white">
                {entry.days}d
              </span>
              {entry.reason}
            </li>
          ))}
        </ul>
      )}

      <div className="max-h-72 overflow-y-auto rounded-lg border border-slate-200">
        <table className="min-w-full text-xs">
          <thead className="sticky top-0 border-b border-slate-200 bg-slate-50 text-left uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-2.5 py-1.5 font-semibold">Day</th>
              <th className="px-2.5 py-1.5 text-right font-semibold">Result</th>
              <th className="px-2.5 py-1.5 font-semibold">Values it read</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {explanation.days.map((day) => (
              <tr key={day.date} className="align-top">
                <td className="whitespace-nowrap px-2.5 py-1.5 text-slate-700">{day.date}</td>
                <td className="px-2.5 py-1.5 text-right">
                  {day.value === null ? (
                    <span className="text-amber-700">no value</span>
                  ) : (
                    <span className="font-mono font-medium text-slate-900">{day.value}</span>
                  )}
                </td>
                <td className="px-2.5 py-1.5">
                  {day.inputs && Object.keys(day.inputs).length > 0 ? (
                    <span className="flex flex-wrap gap-1">
                      {Object.entries(day.inputs).map(([field, value]) => (
                        <span
                          key={field}
                          className={`rounded border px-1.5 py-px font-mono text-[10px] ${
                            value === null
                              ? "border-amber-300 bg-amber-50 text-amber-800"
                              : "border-slate-200 bg-slate-50 text-slate-700"
                          }`}
                        >
                          {field}={value === null ? "—" : value}
                        </span>
                      ))}
                    </span>
                  ) : (
                    <span className="text-slate-400">—</span>
                  )}
                  {day.reason && <span className="mt-0.5 block text-[11px] text-slate-500">{day.reason}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
