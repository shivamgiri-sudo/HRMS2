import { useMemo, useState } from "react";
import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Cell, ScatterChart, Scatter, ZAxis, ReferenceLine, LabelList,
} from "recharts";
import { AlertOctagon, AlertTriangle, CheckCircle2, Download, Info } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { TOOLTIP_PROPS, fmtDate } from "./lpCallShared";
import type { SbiCollections, SbiDimKey, SbiDimRow, SbiWorkItem } from "./sbiCardTypes";
import type { Insight, InsightLevel } from "./sbiCardInsights";
import { FOCUS, PAL, STAGE_META, inrC, reduceMotion, seq } from "./sbiViz";
import { Empty, SortTable, inr, nz, pctTxt, type Col } from "./SbiCardShared";

/** Analytical building blocks of the Collections Ops page. Every chart has a plain table beside or under it. */

const LEVEL: Record<InsightLevel, { label: string; icon: typeof Info; bar: string; chip: string }> = {
  critical: { label: "Critical", icon: AlertOctagon, bar: "bg-red-500", chip: "bg-red-50 text-red-700" },
  warning: { label: "Warning", icon: AlertTriangle, bar: "bg-amber-500", chip: "bg-amber-50 text-amber-800" },
  info: { label: "Insight", icon: Info, bar: "bg-blue-500", chip: "bg-blue-50 text-blue-700" },
  good: { label: "On track", icon: CheckCircle2, bar: "bg-emerald-500", chip: "bg-emerald-50 text-emerald-700" },
};

export function InsightGrid({ insights }: { insights: Insight[] }) {
  if (!insights.length) return null;
  return (
    <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label="Critical insights">
      {insights.map((i) => {
        const L = LEVEL[i.level]; const Icon = L.icon;
        return (
          <li key={i.id} className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition-shadow duration-200 hover:shadow-md">
            <span className={`absolute inset-y-0 left-0 w-1.5 ${L.bar}`} aria-hidden />
            <div className="flex items-start justify-between gap-2 pl-2">
              <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold ${L.chip}`}><Icon className="h-3 w-3" aria-hidden />{L.label}</span>
              <span className="text-lg font-bold tabular-nums text-slate-900">{i.metric}</span>
            </div>
            <p className="mt-2 pl-2 text-sm font-bold leading-snug text-slate-900">{i.title}</p>
            <p className="mt-1 pl-2 text-xs leading-relaxed text-slate-600">{i.detail}</p>
            <p className="mt-2 pl-2 text-xs font-semibold leading-relaxed text-slate-800"><span className="text-slate-500">Do first: </span>{i.action}</p>
          </li>
        );
      })}
    </ul>
  );
}

/** Where every rupee of amount due stands today -- one stacked bar, exact partition, with a legend that doubles as the table. */
export function PositionBar({ ops }: { ops: SbiCollections }) {
  const total = ops.headline.exposure || 1;
  return (
    <div>
      <div role="img" aria-label="Amount due by collection stage" className="flex h-9 w-full overflow-hidden rounded-xl bg-slate-100">
        {ops.position.filter((p) => p.exposure > 0).map((p) => (
          <div key={p.stage} title={`${STAGE_META[p.stage].label}: ${inr(p.exposure)} (${((p.exposure / total) * 100).toFixed(1)}%)`}
            style={{ width: `${(p.exposure / total) * 100}%`, background: STAGE_META[p.stage].color, borderRight: "2px solid #fff" }} className="transition-[filter] duration-200 hover:brightness-110" />
        ))}
      </div>
      <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-5">
        {ops.position.map((p) => (
          <li key={p.stage} className="text-xs">
            <span className="flex items-center gap-1.5 font-semibold text-slate-700"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: STAGE_META[p.stage].color }} aria-hidden />{STAGE_META[p.stage].label}</span>
            <span className="block text-base font-bold tabular-nums text-slate-900">{inrC(p.exposure)}</span>
            <span className="block text-slate-500">{nz(p.accounts)} accounts · {((p.exposure / total) * 100).toFixed(1)}%</span>
            <span className="block text-[11px] text-slate-400">{STAGE_META[p.stage].hint}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Loaded -> worked -> promised, with the conversion at each step and the money that leaks out. */
export function Funnel({ ops }: { ops: SbiCollections }) {
  const h = ops.headline;
  const steps = [
    { label: "Loaded", n: h.accounts, amt: h.exposure, note: "accounts on the file" },
    { label: "Worked", n: h.worked, amt: h.exposure - h.untouchedExposure, note: `${h.untouched} never dialled` },
    { label: "Promised", n: h.ptpAccounts, amt: h.ptpExposure, note: `${pctTxt(h.ptpPct)} of worked` },
    { label: "Still holding", n: h.ptpAccounts - h.overduePtp, amt: h.ptpExposure - h.overduePtpExposure, note: `${h.overduePtp} lapsed` },
  ];
  return (
    <ol className="space-y-2" aria-label="Collections funnel">
      {steps.map((s, i) => {
        const w = h.accounts > 0 ? Math.max(3, (s.n / h.accounts) * 100) : 0;
        const conv = i > 0 && steps[i - 1]!.n > 0 ? (s.n / steps[i - 1]!.n) * 100 : null;
        return (
          <li key={s.label} className="grid grid-cols-[84px_1fr] items-center gap-x-3 gap-y-0.5 text-xs sm:grid-cols-[100px_1fr_170px]">
            <span className="font-semibold text-slate-700">{s.label}</span>
            <div className="h-9 rounded-lg bg-slate-100">
              <div className="flex h-full items-center rounded-lg px-3 transition-[width] duration-500" style={{ width: `${w}%`, background: seq(1 - i * 0.25), minWidth: 118 }}>
                <span className="whitespace-nowrap font-bold tabular-nums text-slate-900">{nz(s.n)}</span>
                <span className="ml-2 whitespace-nowrap text-slate-800">{inrC(s.amt)}</span>
              </div>
            </div>
            <span className="col-span-2 col-start-1 text-[11px] leading-tight text-slate-500 sm:col-span-1 sm:col-start-auto">
              {conv !== null ? `${conv.toFixed(1)}% of previous · ` : ""}{s.note}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

const DIMS: Array<{ key: SbiDimKey; label: string }> = [
  { key: "cd", label: "CD stage" }, { key: "program", label: "Program" }, { key: "flow", label: "Flow" }, { key: "tier", label: "Balance tier" }, { key: "delq", label: "DELQ1" }, { key: "nrr", label: "NRR flag" },
  { key: "recencyBand", label: "Last payment" }, { key: "balanceBand", label: "Balance" }, { key: "region", label: "Region" }, { key: "callTable", label: "Call table" }, { key: "productClass", label: "Product" },
  { key: "accountClass", label: "Class" }, { key: "cibilBand", label: "CIBIL" }, { key: "vintageBand", label: "Vintage" }, { key: "billingCycle", label: "Cycle" },
  { key: "customerType", label: "Customer" },
];

interface Pt { key: string; x: number; y: number; z: number; row: SbiDimRow; priority: boolean }

/** Whether a split is real: a chi-square p-value turned into one plain sentence. */
export function SignalNote({ p, what }: { p: number | null | undefined; what: string }) {
  if (p === undefined) return null;
  const real = p !== null && p < 0.05;
  const cls = p === null ? "bg-slate-100 text-slate-600" : real ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-900";
  const text = p === null ? `Too few worked accounts to test whether ${what} really differs between these segments.`
    : real ? `${what} differs between these segments by more than chance (p = ${p < 0.001 ? "<0.001" : p.toFixed(3)}): worth acting on.`
    : `${what} differences between these segments are within normal random variation (p = ${p.toFixed(2)}): do not rank or re-route on them.`;
  return <p className={`mb-3 inline-block rounded-lg px-3 py-1.5 text-xs font-semibold ${cls}`}>{text}</p>;
}

/** Pick a dimension: heat-shaded scorecard on the left, opportunity map (coverage vs PTP yield, bubble = amount due) on the right. */
export function DimensionExplorer({ ops }: { ops: SbiCollections }) {
  const [dim, setDim] = useState<SbiDimKey>("cd");
  const rows = ops.dimensions[dim];
  const h = ops.headline;
  const maxExp = Math.max(1, ...rows.map((r) => r.exposure));
  const maxLapsed = Math.max(1, ...rows.map((r) => r.overduePtp));
  const pts: Pt[] = useMemo(() => rows.filter((r) => r.worked > 0).map((r) => ({
    key: r.key, x: r.coveragePct, y: r.ptpPct, z: r.exposure, row: r, priority: r.ptpPct < h.ptpPct && r.exposure / (h.exposure || 1) >= 0.05,
  })), [rows, h.ptpPct, h.exposure]);
  const cols: Array<Col<SbiDimRow>> = [
    { key: "k", label: DIMS.find((d) => d.key === dim)!.label, align: "left", value: (r) => r.key },
    { key: "a", label: "Accounts", value: (r) => r.accounts },
    { key: "e", label: "Amount due", value: (r) => r.exposure, render: (r) => (
      <span className="relative flex h-6 min-w-[120px] items-center justify-end overflow-hidden rounded bg-slate-50 px-2">
        <span className="absolute inset-y-0 left-0 rounded" style={{ width: `${(r.exposure / maxExp) * 100}%`, background: seq(0.6) }} aria-hidden />
        <span className="relative font-semibold text-slate-900">{inrC(r.exposure)}</span>
      </span>) },
    { key: "c", label: "Coverage", value: (r) => r.coveragePct, render: (r) => <span className="inline-block rounded px-2 py-0.5 font-semibold text-slate-900" style={{ background: seq(r.coveragePct / 100) }}>{pctTxt(r.coveragePct)}</span> },
    { key: "p", label: "PTP yield", value: (r) => r.ptpPct, render: (r) => (
      <span className="inline-flex items-center gap-1">
        <span className="inline-block rounded px-2 py-0.5 font-semibold text-slate-900" style={{ background: seq(Math.min(1, r.ptpPct / Math.max(1, h.ptpPct * 1.6))) }}>{pctTxt(r.ptpPct)}</span>
        <span className={`text-[11px] font-semibold ${r.ptpPct >= h.ptpPct ? "text-emerald-700" : "text-red-700"}`}>{r.ptpPct >= h.ptpPct ? "▲" : "▼"}{Math.abs(r.ptpPct - h.ptpPct).toFixed(1)}</span>
      </span>) },
    { key: "o", label: "Lapsed", value: (r) => r.overduePtp, render: (r) => <span className="inline-block rounded px-2 py-0.5 font-semibold text-slate-900" style={{ background: r.overduePtp ? `rgba(227,73,72,${(0.08 + 0.4 * (r.overduePtp / maxLapsed)).toFixed(2)})` : "transparent" }}>{nz(r.overduePtp)}</span> },
    { key: "x", label: "Exhausted", value: (r) => r.exhausted },
    { key: "u", label: "Untouched", value: (r) => r.untouched },
  ];
  return (
    <div>
      <div role="tablist" aria-label="Slice the book by" className="mb-3 flex flex-wrap gap-1.5">
        {DIMS.map((d) => (
          <button key={d.key} type="button" role="tab" aria-selected={d.key === dim} onClick={() => setDim(d.key)}
            className={`cursor-pointer rounded-full border px-3 py-1 text-xs font-semibold transition-colors duration-200 ${FOCUS} ${d.key === dim ? "border-blue-600 bg-blue-600 text-white" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`}>{d.label}</button>
        ))}
      </div>
      <SignalNote p={ops.dimensionSignal?.[dim]?.ptpP} what="PTP yield" />
      <div className="grid gap-4 xl:grid-cols-[1.15fr_1fr]">
        <SortTable rows={rows} cols={cols} caption={`Collections scorecard by ${DIMS.find((d) => d.key === dim)!.label}`} rowKey={(r) => r.key} />
        <div>
          <p className="mb-1 text-xs font-bold text-slate-700">Opportunity map</p>
          {pts.length < 2 ? <Empty>Needs at least two segments with worked accounts.</Empty> : (
            <div role="img" aria-label="Coverage against PTP yield, bubble size is amount due" className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart margin={{ top: 12, right: 24, left: 0, bottom: 18 }}>
                  <CartesianGrid stroke={PAL.grid} strokeDasharray="3 3" />
                  <XAxis type="number" dataKey="x" name="Coverage" unit="%" domain={["dataMin - 2", "dataMax + 2"]} tick={{ fontSize: 11 }} tickFormatter={(v: number) => v.toFixed(0)}
                    label={{ value: "Coverage % (worked / loaded)", position: "insideBottom", offset: -10, fontSize: 11, fill: PAL.inkSoft }} />
                  <YAxis type="number" dataKey="y" name="PTP yield" unit="%" domain={["dataMin - 2", "dataMax + 2"]} tick={{ fontSize: 11 }} tickFormatter={(v: number) => v.toFixed(0)}
                    label={{ value: "PTP yield %", angle: -90, position: "insideLeft", fontSize: 11, fill: PAL.inkSoft }} />
                  <ZAxis type="number" dataKey="z" range={[90, 900]} />
                  <ReferenceLine y={h.ptpPct} stroke={PAL.grayDark} strokeDasharray="4 3" label={{ value: `avg ${h.ptpPct.toFixed(1)}%`, position: "right", fontSize: 10, fill: PAL.inkSoft }} />
                  <ReferenceLine x={h.coveragePct} stroke={PAL.grayDark} strokeDasharray="4 3" />
                  <Tooltip {...TOOLTIP_PROPS} cursor={{ strokeDasharray: "3 3" }} content={({ payload }) => {
                    const p = payload?.[0]?.payload as Pt | undefined;
                    if (!p) return null;
                    return (
                      <div style={TOOLTIP_PROPS.contentStyle} className="text-slate-100">
                        <p className="font-semibold">{p.key}</p>
                        <p>{inr(p.z)} due · {nz(p.row.accounts)} accounts</p>
                        <p>Coverage {pctTxt(p.x)} · PTP yield {pctTxt(p.y)}</p>
                      </div>
                    );
                  }} />
                  <Scatter data={pts} isAnimationActive={!reduceMotion}>
                    {pts.map((p) => <Cell key={p.key} fill={p.priority ? PAL.orange : PAL.blue} fillOpacity={0.78} stroke="#fff" strokeWidth={2} />)}
                    <LabelList content={(props: { x?: number | string; y?: number | string; index?: number }) => {
                      const i = props.index ?? 0; const p = pts[i];
                      if (!p) return null;
                      return <text x={Number(props.x)} y={Number(props.y) - 12} textAnchor="middle" fontSize={10} fontWeight={600} fill={PAL.ink}>{p.key}</text>;
                    }} />
                  </Scatter>
                </ScatterChart>
              </ResponsiveContainer>
            </div>
          )}
          <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
            <span className="mr-1 inline-block h-2 w-2 rounded-full align-middle" style={{ background: PAL.orange }} aria-hidden />Orange = at least 5% of the amount due and converting below the {h.ptpPct.toFixed(1)}% average: fix these first. Dashed lines are the book averages.
          </p>
        </div>
      </div>
    </div>
  );
}

/** Volume on top, yield below, sharing one x axis (never two scales on one plot). The best-yield bar is the accent, the rest recede. */
function VolumeYield({ data, volumeLabel, caption, lineLabel = "PTP yield", unit = "%", fmt = (v: number) => `${v.toFixed(1)}%`, accentFrom, note, invert = false }: {
  data: Array<{ label: string; volume: number; yieldPct: number }>; volumeLabel: string; caption: string;
  lineLabel?: string; unit?: string; fmt?: (v: number) => string; accentFrom?: number; note?: string; invert?: boolean;
}) {
  const best = data.reduce((b, d) => ((invert ? d.yieldPct < b.yieldPct : d.yieldPct > b.yieldPct) && d.volume > 0 ? d : b), data[0]!);
  return (
    <div>
      <div role="img" aria-label={`${volumeLabel} and PTP yield. ${caption}`} className="space-y-1">
        <div className="h-32">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={PAL.grid} vertical={false} />
              <XAxis dataKey="label" hide />
              <YAxis tick={{ fontSize: 10 }} width={42} />
              <Tooltip {...TOOLTIP_PROPS} formatter={(v) => (typeof v === "number" ? v.toLocaleString("en-IN") : "—")} />
              <Bar dataKey="volume" name={volumeLabel} radius={[4, 4, 0, 0]} isAnimationActive={!reduceMotion}>
                {data.map((d, i) => <Cell key={d.label} fill={accentFrom !== undefined ? (i >= accentFrom ? PAL.orange : PAL.gray) : d.label === best.label ? PAL.blue : PAL.gray} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="h-32">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={PAL.grid} vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} width={42} unit={unit} />
              <Tooltip {...TOOLTIP_PROPS} formatter={(v) => (typeof v === "number" ? fmt(v) : "—")} />
              <Line type="monotone" dataKey="yieldPct" name={lineLabel} stroke={PAL.orange} strokeWidth={2} dot={{ r: 3, stroke: "#fff", strokeWidth: 2 }} isAnimationActive={!reduceMotion} />
              {accentFrom === undefined && <ReferenceLine x={best.label} stroke={PAL.orange} strokeDasharray="3 3" />}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
      <p className="mt-1 text-[11px] text-slate-500">{note ?? <>Top: {volumeLabel.toLowerCase()}. Bottom: {lineLabel}. Best at <b className="text-slate-800">{best.label}</b> ({fmt(best.yieldPct)}).</>}</p>
    </div>
  );
}

export function HourYield({ ops }: { ops: SbiCollections }) {
  if (!ops.byHour.length) return <Empty>No call times in the file.</Empty>;
  return <VolumeYield volumeLabel="Attempts" caption="By hour of the day" data={ops.byHour.map((x) => ({ label: `${String(x.hour).padStart(2, "0")}h`, volume: x.attempts, yieldPct: x.ptpPct }))} />;
}
export function DepthYield({ ops }: { ops: SbiCollections }) {
  // Accounts that reach a promise log more attempts, so PTP % always rises with depth; that slope says nothing about dialling harder.
  // The honest view is how many accounts and how much money sit at each depth; 4+ is the exhausted zone.
  const rows = ops.attemptDepth;
  const firstDeep = rows.findIndex((x) => x.attempts === "5+" || Number(x.attempts) >= 4);
  return (
    <VolumeYield volumeLabel="Accounts" caption="By number of attempts" lineLabel="Amount due (₹ L)" unit="L" fmt={(v) => `₹${v.toFixed(1)} L`}
      accentFrom={firstDeep >= 0 ? firstDeep : undefined}
      note="Top: accounts at each attempt depth (orange = 4+). Bottom: amount due at that depth. A promise adds attempts, so PTP % is not shown by depth."
      data={rows.map((x) => ({ label: x.attempts, volume: x.accounts, yieldPct: Math.round((x.exposure / 1e5) * 10) / 10 }))} />
  );
}

/** Contactability: who we could not reach, when the line is dead, how dialling tapers over the cycle, and how far agents differ. */
export function ContactabilityPanel({ ops }: { ops: SbiCollections }) {
  const k = ops.contactability;
  const tile = (label: string, n: number, exposure: number, hint: string) => (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-0.5 text-2xl font-bold tabular-nums text-slate-900">{nz(n)} <span className="text-sm font-semibold text-slate-600">{inrC(exposure)}</span></p>
      <p className="text-[11px] leading-snug text-slate-500">{hint}</p>
    </div>
  );
  const sp = k.agentSpread;
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Attempts that reached nobody</p>
          <p className="mt-0.5 text-2xl font-bold tabular-nums text-slate-900">{pctTxt(k.noConversationPct)}</p>
          <p className="text-[11px] leading-snug text-slate-500">{nz(k.noConversation)} of {nz(k.attempts)}: no contact, voicemail or wrong number</p>
        </div>
        {tile("Stuck accounts", k.stuck.accounts, k.stuck.exposure, "3+ attempts, never a conversation: change number or channel")}
        {tile("Wrong number", k.wrongNumber.accounts, k.wrongNumber.exposure, "Number did not belong to the customer: suppress, rotate, refresh")}
        {tile("Repeat voicemail", k.voicemailRepeat.accounts, k.voicemailRepeat.exposure, "Two or more voicemails left: the customer is screening calls")}
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <p className="mb-2 text-xs font-bold text-slate-700">Dead-line share by hour</p>
          <SignalNote p={k.evidence?.hourDeadP} what="Dead-line share" />
          {ops.byHour.length === 0 ? <Empty>No call times in the file.</Empty> : (
            <VolumeYield volumeLabel="Attempts" caption="By hour of day" lineLabel="No-conversation %" data={ops.byHour.map((x) => ({ label: `${String(x.hour).padStart(2, "0")}h`, volume: x.attempts, yieldPct: x.noConversationPct }))}
              note="Top: attempts. Bottom: share that reached nobody (lower is better). Dial the high-contact hours first; keep the dead hours for callbacks." invert />
          )}
        </div>
        <div>
          <p className="mb-2 text-xs font-bold text-slate-700">Dialling intensity across the cycle</p>
          {k.byDate.length < 2 ? <Empty>Needs at least two call days.</Empty> : (
            <VolumeYield volumeLabel="Attempts" caption="By day" lineLabel="No-conversation %" data={k.byDate.map((x) => ({ label: x.date.slice(5), volume: x.attempts, yieldPct: x.noConversationPct }))}
              note="Top: attempts per day. Bottom: share that reached nobody. A steep fall means capacity is leaving the cycle while promises are still due." invert />
          )}
        </div>
      </div>
      {sp && (
        <div>
          <p className="mb-2 text-xs font-bold text-slate-700">Agent PTP yield spread ({sp.agents} dialer agents with 30+ attempts)</p>
          <SignalNote p={k.evidence?.agentPtpP} what="Agent PTP yield" />
          <div className="relative h-8 rounded-lg bg-slate-100" role="img" aria-label={`Agent PTP yield from ${sp.worst?.ptpPct} to ${sp.best?.ptpPct} percent, middle half ${sp.p25} to ${sp.p75}`}>
            {(() => {
              const max = Math.max(1, sp.best?.ptpPct ?? 1); const at = (v: number) => `${(v / max) * 100}%`;
              return (<>
                <span className="absolute inset-y-2 rounded bg-blue-200" style={{ left: at(sp.p25), width: `${((sp.p75 - sp.p25) / max) * 100}%` }} />
                <span className="absolute inset-y-1 w-0.5 bg-blue-700" style={{ left: at(sp.median) }} />
                <span className="absolute inset-y-1 w-1 rounded bg-red-500" style={{ left: `calc(${at(sp.worst?.ptpPct ?? 0)} )` }} />
                <span className="absolute inset-y-1 w-1 rounded bg-emerald-600" style={{ left: `calc(${at(sp.best?.ptpPct ?? 0)} - 4px)` }} />
              </>);
            })()}
          </div>
          <p className="mt-1 text-[11px] text-slate-500">
            <span className="font-semibold text-red-700">Lowest {pctTxt(sp.worst?.ptpPct)}</span> · middle half {pctTxt(sp.p25)} to {pctTxt(sp.p75)} · median {pctTxt(sp.median)} · <span className="font-semibold text-emerald-700">best {pctTxt(sp.best?.ptpPct)}</span>.
            Same accounts mix, different outcome: that gap is coaching and routing, not data.
          </p>
        </div>
      )}
    </div>
  );
}

/** Sorted horizontal bars, the PTP outcome as the accent. */
export function DispositionBars({ ops }: { ops: SbiCollections }) {
  const rows = ops.dispositions.slice(0, 12).map((d) => ({ ...d, tag: d.listed ? d.code : `${d.code}*` }));
  if (!rows.length) return <Empty>No dispositions in the file.</Empty>;
  return (
    <div role="img" aria-label="Disposition mix of all call attempts" style={{ height: Math.max(180, rows.length * 26) }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 56, left: 0, bottom: 0 }}>
          <XAxis type="number" hide />
          <YAxis type="category" dataKey="tag" interval={0} width={52} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
          <Tooltip {...TOOLTIP_PROPS} labelFormatter={(_, p) => { const r = p?.[0]?.payload as { label?: string; code?: string; listed?: boolean } | undefined; return r ? `${r.code} · ${r.label}${r.listed ? "" : " (system)"}` : ""; }} formatter={(v) => (typeof v === "number" ? v.toLocaleString("en-IN") : "—")} />
          <Bar dataKey="attempts" name="Attempts" radius={[0, 4, 4, 0]} isAnimationActive={!reduceMotion}>
            {rows.map((r) => <Cell key={r.code} fill={r.code === "PTP" ? PAL.orange : PAL.blue} fillOpacity={r.code === "PTP" ? 1 : r.listed ? 0.55 : 0.25} />)}
            <LabelList dataKey="sharePct" position="right" formatter={(v: unknown) => `${Number(v).toFixed(1)}%`} style={{ fontSize: 11, fill: PAL.ink }} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

const workCols = (dueLabel: string | null): Array<Col<SbiWorkItem>> => [
  { key: "a", label: "Account", align: "left", value: (r) => r.accountNo },
  { key: "b", label: "Bucket", value: (r) => r.delq },
  { key: "r", label: "Region", align: "left", value: (r) => r.region },
  { key: "d", label: "Amount due", value: (r) => r.totalDue, render: (r) => inr(r.totalDue) },
  { key: "n", label: "Attempts", value: (r) => r.attempts },
  { key: "l", label: "Last action", align: "left", value: (r) => r.lastActionCode },
  ...(dueLabel ? [{ key: "w", label: dueLabel, value: (r: SbiWorkItem) => r.due, render: (r: SbiWorkItem) => (r.due ? fmtDate(r.due) : "—") }] : []),
];

/** Client rules and customer treatment: calling window, exclusions, welfare and dispute flags, and the high-intent customers worth a fast hand-off. */
export function CompliancePanel({ ops }: { ops: SbiCollections }) {
  const c = ops.compliance;
  const tile = (label: string, value: string, sub: string, bad: boolean) => (
    <div className={`rounded-xl border p-3 ${bad ? "border-red-200 bg-red-50" : "border-slate-200 bg-slate-50"}`}>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-0.5 text-2xl font-bold tabular-nums ${bad ? "text-red-700" : "text-slate-900"}`}>{value}</p>
      <p className="text-[11px] leading-snug text-slate-500">{sub}</p>
    </div>
  );
  const b = (x: { accounts: number; exposure: number }) => `${nz(x.accounts)} · ${inrC(x.exposure)}`;
  return (
    <div className="space-y-4">
      <div>
        <p className="mb-2 text-xs font-bold text-slate-700">Rules set by the client</p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {tile(`Calls outside ${c.windowLabel}`, `${nz(c.window.outside)}`, `${pctTxt(c.window.outsidePct)} of ${nz(c.window.attempts)} timed attempts · ${c.window.after} late, ${c.window.before} early`, c.window.outside > 0)}
          {tile("Dialled after exclusion", nz(c.redialedAfterExclusion.accounts), `${nz(c.redialedAfterExclusion.attempts)} later attempts on accounts that should have left the list`, c.redialedAfterExclusion.accounts > 0)}
          {tile("Welfare and disputes", b({ accounts: c.welfare.suicideThreat.accounts + c.welfare.deceased.accounts + c.welfare.dispute.accounts, exposure: c.welfare.suicideThreat.exposure + c.welfare.deceased.exposure + c.welfare.dispute.exposure }), `Suicide threat ${c.welfare.suicideThreat.accounts} · deceased ${c.welfare.deceased.accounts} · dispute ${c.welfare.dispute.accounts}`, c.welfare.suicideThreat.accounts > 0)}
          {tile("Not in SBI's disposition plan", pctTxt(c.unlisted.pct), c.unlisted.codes.slice(0, 5).map((x) => `${x.code} ${x.attempts}`).join(" · ") || "none", false)}
        </div>
        {c.redialedAfterExclusion.byCode.length > 0 && (
          <p className="mt-2 text-[11px] text-slate-500">Re-dialled after: {c.redialedAfterExclusion.byCode.slice(0, 6).map((x) => `${x.label} (${x.code}) ${x.accounts}`).join(" · ")}.</p>
        )}
      </div>
      <div>
        <p className="mb-2 text-xs font-bold text-slate-700">Customers to hand off, not re-dial</p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {tile("Want settlement", b(c.intent.settlement), "Highest intent: settlement desk", false)}
          {tile("Want hardship", b(c.intent.hardship), "Hardship programme, not collections pressure", false)}
          {tile("Language barrier", b(c.intent.languageBarrier), "Route to an agent who speaks their language", false)}
          {tile("Say already paid", b(c.intent.paidAlready), "Reconcile with the bank's payment file first", false)}
        </div>
      </div>
      <p className="text-[11px] text-slate-500">Rules from the client's mail of 24 Sep 2026: calls only {c.windowLabel}; accounts with a promise, dispute, deceased, suicide-threat, refusal, settlement, hardship, payment or other-positive disposition leave the dial list after the first pass. * = a code outside the client's 17-disposition plan.</p>
    </div>
  );
}

/** One ad-hoc list as an account-number-only CSV (server builds it; do-not-call, deceased, dispute and welfare accounts are never in it). */
async function downloadList(type: string, range: { from: string; to: string }): Promise<void> {
  const blob = await hrmsApi.getBlob(`/api/process-performance/sbi-card-dashboard/adhoc-list?type=${encodeURIComponent(type)}&from=${range.from}&to=${range.to}`);
  const url = URL.createObjectURL(blob); const a = document.createElement("a");
  a.href = url; a.download = `SBI_ADHOC_${type}_${range.to}.csv`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}
const MORE_LISTS: Array<{ type: string; label: string }> = [
  { type: "exhausted", label: "Exhausted (4+ attempts)" }, { type: "stuck", label: "Never reached a person" },
  { type: "settlement-hardship", label: "Settlement / hardship" }, { type: "language", label: "Language barrier" },
];

/** The three call lists, one tab each, largest amount first; every list can be downloaded for the dialer team. */
export function ActNow({ ops, range }: { ops: SbiCollections; range?: { from: string; to: string } }) {
  const tabs = [
    { key: "ptp", label: "Lapsed promises", n: ops.headline.overduePtp, rows: ops.worklists.overduePtp, due: "Promised on", type: "lapsed-promises" },
    { key: "unt", label: "Untouched", n: ops.headline.untouched, rows: ops.worklists.untouched, due: null, type: "untouched" },
    { key: "cb", label: "Missed callbacks", n: ops.headline.callbacksOverdue, rows: ops.worklists.overdueCallbacks, due: "Callback was", type: "missed-callbacks" },
  ];
  const [k, setK] = useState(tabs[0]!.key);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const cur = tabs.find((t) => t.key === k)!;
  const get = async (type: string) => { if (!range) return; setBusy(type); setErr(null); try { await downloadList(type, range); } catch { setErr("Could not download the list."); } finally { setBusy(null); } };
  const dl = `inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-wait disabled:opacity-60 ${FOCUS}`;
  return (
    <div>
      <div role="tablist" aria-label="Call lists" className="mb-3 flex flex-wrap items-center gap-1.5">
        {tabs.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={t.key === k} onClick={() => setK(t.key)}
            className={`cursor-pointer rounded-full border px-3 py-1 text-xs font-semibold transition-colors duration-200 ${FOCUS} ${t.key === k ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`}>
            {t.label} <span className="ml-1 tabular-nums opacity-80">{nz(t.n)}</span>
          </button>
        ))}
        {range && <button type="button" disabled={busy !== null} onClick={() => void get(cur.type)} className={`${dl} ml-auto`}><Download className="h-3.5 w-3.5" aria-hidden />{busy === cur.type ? "Preparing…" : "Download full list (CSV)"}</button>}
      </div>
      {err && <p role="alert" className="mb-2 text-xs text-red-600">{err}</p>}
      {cur.rows.length === 0 ? <Empty>Nothing in this list.</Empty> : (
        <>
          <SortTable rows={cur.rows} cols={workCols(cur.due)} caption={cur.label} rowKey={(r) => r.accountNo} />
          <p className="mt-1 text-[11px] text-slate-500">Top {cur.rows.length} by amount due{k === "unt" ? ", do-not-call accounts excluded" : ""}. The download has every account on the list, account numbers only, and leaves out do-not-call, deceased, dispute and welfare accounts, so it can hold fewer than the headline count.</p>
        </>
      )}
      {range && (
        <div className="mt-3 border-t border-slate-100 pt-3">
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">More ad-hoc lists for the dialer team</p>
          <div className="flex flex-wrap gap-2">{MORE_LISTS.map((l) => <button key={l.type} type="button" disabled={busy !== null} onClick={() => void get(l.type)} className={dl}><Download className="h-3.5 w-3.5" aria-hidden />{busy === l.type ? "Preparing…" : l.label}</button>)}</div>
        </div>
      )}
    </div>
  );
}
