/** Model-quality and risk-driver cards for the Prediction tab. */
import { useMemo } from "react";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, LabelList, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { Info } from "lucide-react";
import {
  AXIS_TICK, ChartCard, ChartSkeleton, EmptyState, GRID_PROPS, SERIES, STATUS, TOOLTIP_STYLE, num, pct,
} from "@/components/analytics/analytics-kit";
import { useHubModel } from "./api";
import { ChartKeyNav, DRILL_FOCUS, ErrorCard, GROUP_COLOR, GROUP_LABEL, MiniBar, TIER_COLOR, TIER_LABEL, drillable } from "./charts";
import { useDrill } from "./DrillContext";
import { ModelTrend } from "./ModelTrend";
import { FACTOR_GROUPS, type FactorGroup, type HubModel, type HubRisk, type Tier } from "./types";

/** Linear interpolation of the gain curve at x (0-100). */
export function gainAt(gain: HubModel["gain"], x: number): number | null {
  const pts = [{ popPct: 0, leaverPct: 0 }, ...gain].sort((a, b) => a.popPct - b.popPct);
  if (pts.length < 2) return null;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    if (x <= b.popPct) {
      const span = b.popPct - a.popPct;
      return span <= 0 ? b.leaverPct : a.leaverPct + ((b.leaverPct - a.leaverPct) * (x - a.popPct)) / span;
    }
  }
  return pts[pts.length - 1].leaverPct;
}

const MIN_N = 30;

function GainCard({ m }: { m: HubModel }) {
  const drill = useDrill();
  const data = useMemo(() => {
    const pts = [{ popPct: 0, leaverPct: 0 }, ...m.gain.filter(g => g.popPct > 0)];
    return pts.map(p => ({ ...p, baseline: p.popPct }));
  }, [m.gain]);
  const at20 = gainAt(m.gain, 20);
  const auc = m.auc;
  return (
    <ChartCard
      title="How well does the score find leavers?"
      subtitle="Cumulative gain: rank everyone riskiest-first (x) and see what share of people who actually left was inside that group (y). Tested on past dates."
      action={
        <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-bold tabular-nums text-slate-700" title="Area under the ROC curve: 0.5 = coin flip, 1 = perfect">
          AUC {auc === null ? "n/a" : auc.toFixed(2)}
        </span>
      }
      footer={<p className="text-[11px] text-slate-500">Tested on {num(m.population)} person-periods, {num(m.leavers)} left within 30 days (base rate {pct(m.baseRatePct)}).</p>}
    >
      {data.length < 3 ? <EmptyState label="Not enough history to draw a gain curve" height={220} /> : (
        <>
          <p className="mb-2 text-sm font-semibold text-slate-800">
            {at20 === null ? "—" : <>Flagging the top 20% of people catches <span className="text-base text-[#2a78d6] tabular-nums">{Math.round(at20)}%</span> of leavers</>}
            <span className="ml-1 text-[11px] font-normal text-slate-500">(random picking would catch 20%)</span>
          </p>
          <div className="cursor-pointer" role="img" aria-label={`Gain curve. Flagging the top 20 percent of people catches ${at20 === null ? "unknown" : Math.round(at20)} percent of leavers. AUC ${auc?.toFixed(2) ?? "not available"}.`}>
            <ResponsiveContainer width="100%" height={230}>
              <AreaChart data={data} margin={{ top: 6, right: 12, bottom: 18, left: 0 }}
                onClick={(st: { activePayload?: { payload?: { popPct: number } }[] } | undefined) => {
                  const x = st?.activePayload?.[0]?.payload?.popPct;
                  if (x !== undefined) drill({ population: "active", sort: "score", title: `Riskiest ${Math.round(x)}% of people - the group the score would flag` });
                }}>
                <defs>
                  <linearGradient id="gainFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={SERIES[0]} stopOpacity={0.35} />
                    <stop offset="100%" stopColor={SERIES[0]} stopOpacity={0.03} />
                  </linearGradient>
                </defs>
                <CartesianGrid {...GRID_PROPS} />
                <XAxis type="number" dataKey="popPct" domain={[0, 100]} ticks={[0, 20, 40, 60, 80, 100]} tick={AXIS_TICK} tickLine={false} axisLine={false} unit="%"
                  label={{ value: "% of people flagged (highest risk first)", position: "insideBottom", offset: -10, fontSize: 11, fill: "#64748b" }} />
                <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tick={AXIS_TICK} tickLine={false} axisLine={false} unit="%" width={42} />
                <Tooltip contentStyle={TOOLTIP_STYLE} labelFormatter={v => `Top ${Number(v).toFixed(0)}% flagged`}
                  formatter={(v: number | string, k: string) => [pct(Number(v), 0), k === "leaverPct" ? "Leavers caught" : "Random baseline"]} />
                <Area type="monotone" dataKey="leaverPct" stroke={SERIES[0]} strokeWidth={2.5} fill="url(#gainFill)" dot={false} isAnimationActive={false} />
                <Line type="linear" dataKey="baseline" stroke="#94a3b8" strokeDasharray="5 4" dot={false} strokeWidth={1.5} isAnimationActive={false} legendType="none" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-1 text-[11px] text-slate-400">Click the curve to see the people ranked riskiest first.</p>
          <ChartKeyNav label="Gain curve drill" items={[{ label: "Open riskiest-first list", onOpen: () => drill({ population: "active", sort: "score", title: "People ranked riskiest first" }) }]} />
        </>
      )}
    </ChartCard>
  );
}

function CalibrationCard({ m }: { m: HubModel }) {
  const drill = useDrill();
  const openTier = (t: Tier, n?: number) => drill({ population: "active", tier: t, sort: "score", title: `${TIER_LABEL[t]} risk${n !== undefined ? ` - ${num(n)} people` : ""}` });
  const data = useMemo(
    () => m.calibration.map(c => {
      const low = c.observedRatePct === null || c.n < MIN_N;
      return { ...c, low, v: c.observedRatePct ?? 0, name: TIER_LABEL[c.tier] };
    }),
    [m.calibration],
  );
  const tickNode = (p: { x: number; y: number; payload: { value: string; index: number } }) => {
    const d = data[p.payload.index];
    return (
      <g transform={`translate(${p.x},${p.y})`}>
        <text textAnchor="middle" y={12} fontSize={11} fill="#334155" fontWeight={600}>{p.payload.value}</text>
        <text textAnchor="middle" y={26} fontSize={10} fill="#64748b">{d ? `n=${num(d.n)}` : ""}</text>
      </g>
    );
  };
  return (
    <ChartCard
      title="Do the tiers match reality?"
      subtitle="Calibration: share of people in each tier who actually left within 30 days, on past dates. Higher tiers should leave more."
      footer={<p className="text-[11px] text-slate-500">Hatched bars have fewer than {MIN_N} people: too few to trust, shown as low sample.</p>}
    >
      {data.length === 0 ? <EmptyState label="No calibration data" height={220} /> : (
        <div role="img" aria-label={`Observed 30-day exit rate by tier: ${data.map(d => `${d.name} ${d.low ? "low sample" : pct(d.v)} (n=${d.n})`).join(", ")}`}>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={data} margin={{ top: 20, right: 8, bottom: 12, left: 0 }}>
              <defs>
                {data.map(d => (
                  <pattern key={d.tier} id={`hatch-${d.tier}`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                    <rect width="6" height="6" fill="#fff" />
                    <rect width="3" height="6" fill={TIER_COLOR[d.tier]} opacity={0.55} />
                  </pattern>
                ))}
              </defs>
              <CartesianGrid {...GRID_PROPS} />
              <XAxis dataKey="name" interval={0} height={36} tick={tickNode as never} tickLine={false} axisLine={false} />
              <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} unit="%" width={40} />
              <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: "#f1f5f9" }}
                formatter={(_v: number | string, _k: string, p: { payload?: { low: boolean; v: number; leavers: number; n: number } }) =>
                  [p.payload?.low ? `low sample (${p.payload.leavers} of ${p.payload.n})` : `${pct(p.payload?.v ?? 0)} (${p.payload?.leavers} of ${p.payload?.n})`, "30-day exit rate"]} />
              <Bar dataKey="v" radius={[8, 8, 0, 0]} maxBarSize={56} isAnimationActive={false} cursor="pointer" onClick={(d: { tier?: Tier; payload?: { tier: Tier } }) => { const t = d.tier ?? d.payload?.tier; if (t) openTier(t); }}>
                {data.map(d => <Cell key={d.tier} fill={d.low ? `url(#hatch-${d.tier})` : TIER_COLOR[d.tier]} stroke={d.low ? TIER_COLOR[d.tier] : undefined} />)}
                <LabelList dataKey="v" position="top" fontSize={11} fill="#334155"
                  content={((p: { x: number; y: number; width: number; index: number }) => {
                    const d = data[p.index];
                    return <text x={p.x + p.width / 2} y={p.y - 6} textAnchor="middle" fontSize={11} fontWeight={600} fill="#334155">{d.low ? "low sample" : pct(d.v)}</text>;
                  }) as never} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <ChartKeyNav label="Tier drill" items={data.map(d => ({ label: `Open ${d.name} tier`, onOpen: () => openTier(d.tier) }))} />
        </div>
      )}
    </ChartCard>
  );
}

export function ModelSection() {
  const q = useHubModel();
  if (q.isLoading) return <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-2"><ChartSkeleton /><ChartSkeleton /></div>;
  if (q.error || !q.data) return <ErrorCard what="the model quality charts" error={q.error} onRetry={() => q.refetch()} />;
  const m = q.data;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-2">
        <GainCard m={m} />
        <CalibrationCard m={m} />
      </div>
      <ModelTrend history={m.history ?? []} />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-2">
        <DriversCard drivers={null} model={m} />
        {m.limits.length > 0 && (
          <div className="self-start rounded-xl border border-slate-200 bg-slate-50/70 p-4">
            <h3 className="flex items-center gap-1.5 text-xs font-bold text-slate-700"><Info className="h-3.5 w-3.5" aria-hidden /> Know the limits</h3>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-[11px] leading-relaxed text-slate-500">
              {m.limits.map((l, i) => <li key={i}>{l}</li>)}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

/** Leavers vs stayers (model) as grouped bars. A grouped bar beats a radar here: six axes of unequal max make radar shapes misleading. */
export function DriversCard({ drivers, model }: { drivers: HubRisk["drivers"] | null; model: HubModel | null }) {
  const drill = useDrill();
  const openGroup = (g: FactorGroup) => drill({ population: "active", group: g, sort: "score", title: `${GROUP_LABEL[g]} signals - people with points here` });
  if (model) {
    const data = FACTOR_GROUPS.map(g => {
      const d = model.drivers.find(x => x.group === g.key);
      return { key: g.key, name: g.label, leavers: d?.avgPointsLeavers ?? 0, stayers: d?.avgPointsStayers ?? 0 };
    });
    return (
      <ChartCard title="What set leavers apart?" subtitle="Average score points per group, for people who left within 30 days vs people who stayed (past dates).">
        <div role="img" aria-label={`Average points leavers versus stayers: ${data.map(d => `${d.name} ${d.leavers.toFixed(1)} versus ${d.stayers.toFixed(1)}`).join("; ")}`}>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={data} layout="vertical" margin={{ top: 4, right: 24, bottom: 4, left: 0 }} barGap={2}>
              <CartesianGrid {...GRID_PROPS} horizontal={false} vertical />
              <XAxis type="number" tick={AXIS_TICK} tickLine={false} axisLine={false} />
              <YAxis type="category" dataKey="name" width={118} tick={AXIS_TICK} tickLine={false} axisLine={false} />
              <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: "#f1f5f9" }} formatter={(v: number | string, k: string) => [`${Number(v).toFixed(1)} pts`, k === "leavers" ? "Leavers" : "Stayers"]} />
              <Legend verticalAlign="top" height={24} iconType="circle" formatter={(v: string) => <span className="text-[11px] text-slate-600">{v === "leavers" ? "Leavers" : "Stayers"}</span>} />
              <Bar dataKey="leavers" fill={STATUS.critical} radius={[0, 5, 5, 0]} barSize={9} isAnimationActive={false} cursor="pointer" onClick={(d: { payload?: { key: FactorGroup } }) => d.payload && openGroup(d.payload.key)} />
              <Bar dataKey="stayers" fill="#94a3b8" radius={[0, 5, 5, 0]} barSize={9} isAnimationActive={false} cursor="pointer" onClick={(d: { payload?: { key: FactorGroup } }) => d.payload && openGroup(d.payload.key)} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <ChartKeyNav label="Signal group drill" items={data.map(d => ({ label: `Open ${d.name}`, onOpen: () => openGroup(d.key) }))} />
      </ChartCard>
    );
  }
  const list = drivers ?? [];
  const max = Math.max(1, ...list.map(d => d.avgPoints));
  return (
    <ChartCard title="What drives risk right now?" subtitle="Among High and Critical people: average points from each signal group, and each group's share of the total score.">
      {list.length === 0 ? <EmptyState label="No High or Critical people in this view" height={200} /> : (
        <ul className="space-y-3">
          {[...list].sort((a, b) => b.avgPoints - a.avgPoints).map(d => (
            <li key={d.group} {...drillable(() => openGroup(d.group), `Open people with ${GROUP_LABEL[d.group]} signals`)} className={`-mx-2 rounded-lg px-2 py-1 hover:bg-slate-50 ${DRILL_FOCUS}`}>
              <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
                <span className="flex items-center gap-1.5 font-semibold text-slate-700">
                  <span aria-hidden className="h-2.5 w-2.5 rounded-sm" style={{ background: GROUP_COLOR[d.group] }} />{GROUP_LABEL[d.group]}
                </span>
                <span className="tabular-nums text-slate-500"><strong className="text-slate-900">{d.avgPoints.toFixed(1)}</strong> pts · {pct(d.sharePct, 0)} of score</span>
              </div>
              <MiniBar value={d.avgPoints} max={max} color={GROUP_COLOR[d.group]} height={8} label={`${GROUP_LABEL[d.group]}: ${d.avgPoints.toFixed(1)} points, ${d.sharePct.toFixed(0)} percent of score`} />
            </li>
          ))}
        </ul>
      )}
    </ChartCard>
  );
}
