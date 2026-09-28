import { useMemo, useState, type ReactElement } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  Grid2x2,
  Layers,
  LineChart as LineIcon,
  Minus,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  bucketAxisLabel,
  formatMatrixValue,
  type Granularity,
  type Matrix,
  type MatrixFormat,
} from "./onfidoReportShared";
import {
  autoShowLabels,
  availableViews,
  chartHeight,
  dashFor,
  defaultView,
  hiddenForTopN,
  isShareOfWhole,
  seriesDelta,
  toggleSeries,
  type MatrixView,
} from "./matrixChartState";

/**
 * The Overview's trend chart. It keeps every series and every data point of the old
 * MatrixLineChart but lets the reader choose how to look at them: Lines (clickable legend,
 * hover-to-highlight, point labels that switch off when they would smudge), Bars, Stacked
 * (counts and shares only) and Small multiples -- one mini chart per series with its own scale,
 * the latest value and the change against the previous period, which removes overlap entirely.
 * Charts with five or more series open as small multiples; a click on any tile focuses that
 * series in the line view.
 */

const PALETTE = [
  "#1b6ab5",
  "#f59e0b",
  "#0ea5b7",
  "#8b5cf6",
  "#e8231a",
  "#16a34a",
  "#ec4899",
  "#64748b",
  "#ca8a04",
  "#0891b2",
];
const colorOf = (i: number): string => PALETTE[i % PALETTE.length];

const VIEW_META: Record<MatrixView, { label: string; icon: typeof LineIcon }> =
  {
    lines: { label: "Lines", icon: LineIcon },
    bars: { label: "Bars", icon: BarChart3 },
    stacked: { label: "Stacked", icon: Layers },
    multiples: { label: "Small multiples", icon: Grid2x2 },
  };

interface Props {
  matrix: Matrix;
  granularity: Granularity;
  format: MatrixFormat;
  secondAxisFrom?: number;
  formats?: MatrixFormat[];
  height?: number;
}

export function MatrixChart({
  matrix,
  granularity,
  format,
  secondAxisFrom,
  formats,
  height = 300,
}: Props) {
  const dual = secondAxisFrom !== undefined;
  const ctx = { rows: matrix.rows.length, dual, unit: format.unit, partsOfWhole: isShareOfWhole(matrix) };
  const views = availableViews(ctx);
  const [pickedView, setView] = useState<MatrixView | null>(null);
  const view: MatrixView =
    pickedView && views.includes(pickedView) ? pickedView : defaultView(ctx);
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const [hover, setHover] = useState<string | null>(null);
  const [labelsOverride, setLabelsOverride] = useState<boolean | null>(null);

  const fmtFor = (idx: number): MatrixFormat => formats?.[idx] ?? format;
  const data = useMemo(
    () =>
      matrix.buckets.map((b, i) => {
        const row: Record<string, string | number | null> = {
          bucket: bucketAxisLabel(b, granularity),
        };
        matrix.rows.forEach((r) => {
          row[r.label] = r.values[i];
        });
        return row;
      }),
    [matrix, granularity],
  );

  const visible = matrix.rows.filter((r) => !hidden.has(r.label));
  const showLabels = labelsOverride ?? autoShowLabels(visible.length);
  const ariaLabel = `${matrix.rows.length} series over ${matrix.buckets.length} periods`;

  const focusOn = (label: string) => {
    setHidden(
      new Set(matrix.rows.filter((r) => r.label !== label).map((r) => r.label)),
    );
    setLabelsOverride(null);
    setView("lines");
  };

  const axisTick = { fontSize: 11, fill: "var(--muted)" };
  const yAxis = (
    id: string,
    orientation: "left" | "right",
    fmt: MatrixFormat,
  ) => (
    <YAxis
      yAxisId={id}
      orientation={orientation}
      tickLine={false}
      axisLine={false}
      width={56}
      tick={axisTick}
      tickFormatter={(v: number) => formatMatrixValue(v, fmt)}
    />
  );
  const tooltip = (
    <RTooltip
      itemSorter={(item: { value?: unknown }) =>
        -(typeof item.value === "number"
          ? item.value
          : Number.NEGATIVE_INFINITY)
      }
      formatter={(v: number | null, name: string) => {
        const idx = matrix.rows.findIndex((r) => r.label === name);
        return [formatMatrixValue(v, fmtFor(idx)), name];
      }}
    />
  );

  const chartH = chartHeight(height, visible.length);

  return (
    <div>
      <div
        className="flex flex-wrap items-center justify-between gap-2"
        style={{ margin: "10px 0 8px" }}
      >
        <div className="oc-pillbar" role="group" aria-label="Chart type">
          {views.map((v) => {
            const Icon = VIEW_META[v].icon;
            return (
              <button
                key={v}
                type="button"
                className={v === view ? "oc-pill-btn active" : "oc-pill-btn"}
                aria-pressed={v === view}
                onClick={() => setView(v)}
                style={{ display: "inline-flex", alignItems: "center", gap: 5 }}
              >
                <Icon size={12} aria-hidden="true" /> {VIEW_META[v].label}
              </button>
            );
          })}
        </div>
        {view !== "multiples" && (
          <div className="flex flex-wrap items-center gap-1">
            <button
              type="button"
              className="oc-btn-ghost"
              onClick={() => setHidden(new Set())}
            >
              All
            </button>
            {matrix.rows.length > 4 && (
              <button
                type="button"
                className="oc-btn-ghost"
                onClick={() => setHidden(hiddenForTopN(matrix, 3))}
              >
                Top 3
              </button>
            )}
            <button
              type="button"
              className="oc-btn-ghost"
              aria-pressed={showLabels}
              onClick={() => setLabelsOverride(!showLabels)}
            >
              Labels: {showLabels ? "on" : "off"}
            </button>
          </div>
        )}
      </div>

      {view !== "multiples" && (
        <div className="flex flex-wrap gap-1.5" style={{ marginBottom: 6 }}>
          {matrix.rows.map((r, i) => {
            const off = hidden.has(r.label);
            return (
              <button
                key={r.label}
                type="button"
                aria-pressed={!off}
                title={off ? `Show ${r.label}` : `Hide ${r.label}`}
                onClick={() => setHidden((h) => toggleSeries(h, r.label))}
                onMouseEnter={() => setHover(r.label)}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(r.label)}
                onBlur={() => setHover(null)}
                className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold transition-opacity"
                style={{
                  borderColor: off ? "var(--border)" : colorOf(i),
                  color: off ? "var(--muted)" : "var(--text)",
                  opacity: off ? 0.55 : 1,
                  textDecoration: off ? "line-through" : "none",
                  background: "var(--card)",
                }}
              >
                <span
                  style={{
                    width: 9,
                    height: 9,
                    borderRadius: 99,
                    background: colorOf(i),
                    display: "inline-block",
                  }}
                />
                {r.label}
              </button>
            );
          })}
        </div>
      )}

      {view === "lines" && (
        <div role="img" aria-label={ariaLabel}>
          <ResponsiveContainer width="100%" height={chartH}>
            <LineChart
              data={data}
              margin={{ top: 24, right: 24, left: 4, bottom: 8 }}
            >
              <CartesianGrid stroke="rgba(148,163,184,0.18)" vertical={false} />
              <XAxis
                dataKey="bucket"
                tickLine={false}
                axisLine={false}
                tick={axisTick}
              />
              {yAxis("left", "left", fmtFor(0))}
              {dual && yAxis("right", "right", fmtFor(secondAxisFrom!))}
              {tooltip}
              {matrix.rows.map((r, i) => {
                if (hidden.has(r.label)) return null;
                const dimmed = hover !== null && hover !== r.label;
                const color = colorOf(i);
                return (
                  <Line
                    key={r.label}
                    yAxisId={dual && i >= secondAxisFrom! ? "right" : "left"}
                    type="monotone"
                    dataKey={r.label}
                    name={r.label}
                    stroke={color}
                    strokeWidth={hover === r.label ? 3 : 2}
                    strokeOpacity={dimmed ? 0.15 : 1}
                    strokeDasharray={dashFor(i)}
                    dot={{
                      r: 3,
                      strokeOpacity: dimmed ? 0.15 : 1,
                      fillOpacity: dimmed ? 0.15 : 1,
                    }}
                    connectNulls={false}
                    isAnimationActive={false}
                  >
                    {showLabels && !dimmed && (
                      <LabelList
                        dataKey={r.label}
                        position={i % 2 === 0 ? "top" : "bottom"}
                        offset={8}
                        fontSize={9}
                        fontWeight={700}
                        fill={color}
                        formatter={(v: number | null) =>
                          v === null || v === undefined
                            ? ""
                            : formatMatrixValue(v, fmtFor(i))
                        }
                      />
                    )}
                  </Line>
                );
              })}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {(view === "bars" || view === "stacked") && (
        <div role="img" aria-label={ariaLabel}>
          <ResponsiveContainer width="100%" height={chartH}>
            <BarChart
              data={data}
              margin={{ top: 24, right: 24, left: 4, bottom: 8 }}
            >
              <CartesianGrid stroke="rgba(148,163,184,0.18)" vertical={false} />
              <XAxis
                dataKey="bucket"
                tickLine={false}
                axisLine={false}
                tick={axisTick}
              />
              {yAxis("left", "left", fmtFor(0))}
              {tooltip}
              {matrix.rows.map((r, i) => {
                if (hidden.has(r.label)) return null;
                const dimmed = hover !== null && hover !== r.label;
                return (
                  <Bar
                    key={r.label}
                    yAxisId="left"
                    dataKey={r.label}
                    name={r.label}
                    stackId={view === "stacked" ? "s" : undefined}
                    fill={colorOf(i)}
                    fillOpacity={dimmed ? 0.2 : 1}
                    radius={view === "stacked" ? 0 : [3, 3, 0, 0]}
                    isAnimationActive={false}
                  >
                    {showLabels && !dimmed && (
                      <LabelList
                        dataKey={r.label}
                        position={view === "stacked" ? "center" : "top"}
                        fontSize={9}
                        fontWeight={700}
                        fill={view === "stacked" ? "#fff" : colorOf(i)}
                        formatter={(v: number | null) =>
                          v === null || v === undefined || v === 0
                            ? ""
                            : formatMatrixValue(v, fmtFor(i))
                        }
                      />
                    )}
                  </Bar>
                );
              })}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {view === "multiples" && (
        <div>
          <div className="oc-card-sub" style={{ margin: "0 0 8px" }}>
            One chart per series, each on its own scale. Click a chart to focus
            it in the line view.
          </div>
          <div
            className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3"
            role="group"
            aria-label={ariaLabel}
          >
            {matrix.rows.map((r, i) => {
              const color = colorOf(i);
              const fmt = fmtFor(i);
              const delta = seriesDelta(r.values);
              const lastIdx = (() => {
                for (let k = r.values.length - 1; k >= 0; k--)
                  if (r.values[k] !== null) return k;
                return -1;
              })();
              const Arrow =
                delta?.change === null ||
                delta?.change === undefined ||
                delta.change === 0
                  ? Minus
                  : delta.change > 0
                    ? ArrowUpRight
                    : ArrowDownRight;
              const changeText =
                delta && delta.change !== null
                  ? `${delta.change > 0 ? "+" : ""}${fmt.unit === "percent" ? `${delta.change.toFixed(fmt.digits ?? 1)} pts` : formatMatrixValue(delta.change, fmt)}${delta.pct !== null && fmt.unit !== "percent" ? ` (${delta.pct > 0 ? "+" : ""}${delta.pct.toFixed(0)}%)` : ""}`
                  : "no previous period";
              return (
                <button
                  key={r.label}
                  type="button"
                  onClick={() => focusOn(r.label)}
                  title={`Focus ${r.label} in the line view`}
                  className="rounded-2xl border bg-white p-3 text-left transition-shadow hover:shadow-md"
                  style={{ borderColor: "var(--border)" }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p
                        className="truncate text-[11px] font-bold uppercase tracking-wide"
                        style={{ color: "var(--muted-strong)" }}
                      >
                        <span
                          style={{
                            display: "inline-block",
                            width: 8,
                            height: 8,
                            borderRadius: 99,
                            background: color,
                            marginRight: 6,
                          }}
                        />
                        {r.label}
                      </p>
                      <p
                        className="text-xl font-extrabold leading-tight"
                        style={{ color: "var(--text)" }}
                      >
                        {delta ? formatMatrixValue(delta.latest, fmt) : "-"}
                      </p>
                    </div>
                    <span
                      className="inline-flex items-center gap-1 text-[11px] font-semibold"
                      style={{ color: "var(--muted-strong)" }}
                    >
                      <Arrow size={13} aria-hidden="true" /> {changeText}
                    </span>
                  </div>
                  <div style={{ height: 78, marginTop: 6 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart
                        data={data}
                        margin={{ top: 6, right: 8, left: 8, bottom: 0 }}
                      >
                        <XAxis dataKey="bucket" hide />
                        <YAxis hide domain={["auto", "auto"]} />
                        <RTooltip
                          formatter={(v: number | null) => [
                            formatMatrixValue(v, fmt),
                            r.label,
                          ]}
                        />
                        <Area
                          type="monotone"
                          dataKey={r.label}
                          stroke={color}
                          strokeWidth={2}
                          fill={color}
                          fillOpacity={0.12}
                          connectNulls={false}
                          isAnimationActive={false}
                          dot={(p: {
                            cx?: number;
                            cy?: number;
                            index?: number;
                          }): ReactElement =>
                            p.index === lastIdx &&
                            p.cx !== undefined &&
                            p.cy !== undefined ? (
                              <circle
                                key="last"
                                cx={p.cx}
                                cy={p.cy}
                                r={4}
                                fill={color}
                                stroke="#fff"
                                strokeWidth={1.5}
                              />
                            ) : (
                              <g key={`d-${p.index}`} />
                            )
                          }
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                  <div
                    className="flex justify-between text-[10px]"
                    style={{ color: "var(--muted)" }}
                  >
                    <span>{data[0]?.bucket as string}</span>
                    <span>{data[data.length - 1]?.bucket as string}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export default MatrixChart;
