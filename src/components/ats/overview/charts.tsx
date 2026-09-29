import { useMemo } from "react";
import { Area, CartesianGrid, Legend, Line, ComposedChart, Rectangle, Sankey, Tooltip, Treemap, XAxis, YAxis, ResponsiveContainer, Layer } from "recharts";
import type { AtsOverview } from "@/hooks/useAtsOverview";
import { Empty, V, fmt, tooltipStyle } from "./viz";

const noMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/* ───────────── Funnel: trapezoid bars, width ∝ volume, step conversion chips ───────────── */
export function FunnelViz({ data, onSelect }: { data: AtsOverview["funnel"]; onSelect?: (stage: string) => void }) {
  const top = Math.max(1, data[0]?.n || 1);
  return (
    <ol className="space-y-1.5">
      {data.map((f, i) => {
        const w = Math.max(6, (f.n / top) * 100);
        const nextW = data[i + 1] ? Math.max(6, (data[i + 1].n / top) * 100) : w * 0.85;
        const inset = ((w - nextW) / w) * 50; // taper the bottom edge toward the next stage
        const step = i && data[i - 1].n ? Math.round((f.n / data[i - 1].n) * 100) : null;
        return (
          <li key={f.stage} className={`grid grid-cols-[92px_1fr_auto] items-center gap-3 rounded-lg transition-colors duration-200 ${onSelect ? "cursor-pointer hover:bg-muted/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary" : ""}`}
            {...(onSelect ? { role: "button", tabIndex: 0, "aria-label": `Drill into ${f.stage}`, onClick: () => onSelect(f.stage), onKeyDown: (e: React.KeyboardEvent) => (e.key === "Enter" || e.key === " ") && onSelect(f.stage) } : {})}>
            <span className="text-xs font-medium">{f.stage}</span>
            <div className="flex justify-center">
              <div className="h-9 transition-[width] duration-500" style={{ width: `${w}%`, clipPath: `polygon(0 0,100% 0,${100 - inset}% 100%,${inset}% 100%)`, background: `linear-gradient(90deg,${V.blue},${V.aqua})`, opacity: 1 - i * 0.1 }} />
            </div>
            <span className="min-w-[84px] text-right text-xs tabular-nums"><b className="text-sm">{fmt(f.n)}</b>{step != null && <span className="ml-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{step}%</span>}</span>
          </li>
        );
      })}
    </ol>
  );
}

/* ───────────── Trend: areas + 7-day moving average on the SAME axis ───────────── */
export function TrendViz({ data }: { data: AtsOverview["trend"] }) {
  const rows = useMemo(() => data.map((r, i) => {
    const win = data.slice(Math.max(0, i - 6), i + 1);
    return { ...r, avg7: Math.round((win.reduce((a, x) => a + x.registered, 0) / win.length) * 10) / 10 };
  }), [data]);
  if (!rows.length) return <Empty />;
  return (
    <ResponsiveContainer width="100%" height={270}>
      <ComposedChart data={rows} margin={{ left: -18, right: 6, top: 6 }}>
        <defs>
          {[["reg", V.blue], ["sel", V.aqua], ["rej", V.orange]].map(([id, c]) => (
            <linearGradient key={id} id={`tr-${id}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={c} stopOpacity={0.4} /><stop offset="100%" stopColor={c} stopOpacity={0.02} /></linearGradient>
          ))}
        </defs>
        <CartesianGrid stroke={V.grid} strokeDasharray="3 4" vertical={false} />
        <XAxis dataKey="date" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickFormatter={(v) => String(v).slice(5, 10)} axisLine={false} tickLine={false} minTickGap={24} />
        <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} allowDecimals={false} axisLine={false} tickLine={false} />
        <Tooltip {...tooltipStyle} cursor={{ stroke: V.grid, strokeWidth: 1.5 }} />
        <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" />
        <Area type="monotone" dataKey="registered" name="Registered" stroke={V.blue} strokeWidth={2} fill="url(#tr-reg)" isAnimationActive={!noMotion()} />
        <Area type="monotone" dataKey="selected" name="Selected" stroke={V.aqua} strokeWidth={2} fill="url(#tr-sel)" isAnimationActive={!noMotion()} />
        <Area type="monotone" dataKey="rejected" name="Rejected" stroke={V.orange} strokeWidth={2} fill="url(#tr-rej)" isAnimationActive={!noMotion()} />
        <Line type="monotone" dataKey="avg7" name="7-day avg (registered)" stroke="hsl(var(--foreground))" strokeWidth={1.5} strokeDasharray="5 4" dot={false} isAnimationActive={false} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

/* ───────────── Sankey: where every registered candidate ended up ───────────── */
const SANKEY_COLORS: Record<string, string> = { Engaged: V.blue, "In progress": V.yellow, Selected: V.aqua, Rejected: V.orange, "No-show": V.red, Joined: V.violet, "Awaiting joining": V.aqua };

export function buildFlow(d: AtsOverview) {
  const { registered: reg, selected: sel, rejected: rej, noShow, joined } = d.outcomes;
  const inProgress = Math.max(0, reg - sel - rej - noShow);
  const awaiting = Math.max(0, sel - joined);
  const names = ["Engaged", "In progress", "Selected", "Rejected", "No-show", "Joined", "Awaiting joining"];
  const raw = [["Engaged", "Selected", sel], ["Engaged", "Rejected", rej], ["Engaged", "No-show", noShow], ["Engaged", "In progress", inProgress], ["Selected", "Joined", joined], ["Selected", "Awaiting joining", awaiting]] as const;
  const links = raw.filter(([, , v]) => v > 0).map(([s, t, v]) => ({ source: names.indexOf(s), target: names.indexOf(t), value: v }));
  const used = new Set(links.flatMap((l) => [l.source, l.target]));
  const remap = new Map([...used].sort((a, b) => a - b).map((old, i) => [old, i]));
  return {
    nodes: [...remap.keys()].map((old) => ({ name: names[old] })),
    links: links.map((l) => ({ ...l, source: remap.get(l.source)!, target: remap.get(l.target)! })),
    table: raw.filter(([, , v]) => v > 0).map(([s, t, v]) => ({ from: s, to: t, n: v })),
  };
}


interface NodeP { x: number; y: number; width: number; height: number; payload: { name: string; value: number }; onPick?: (name: string) => void }
interface LinkP { sourceX: number; targetX: number; sourceY: number; targetY: number; sourceControlX: number; targetControlX: number; linkWidth: number; payload: { target: { name: string } } }
// Treemap injects these at render time; all optional so the element form <TreeCell /> type-checks.
interface CellP { onPick?: (name: string) => void; x?: number; y?: number; width?: number; height?: number; name?: string; total?: number; convRate?: number; maxConv?: number }

function FlowNode(p: NodeP) {
  const { x, y, width, height, payload, onPick } = p;
  const c = SANKEY_COLORS[payload.name] || V.blue;
  const right = x < 200;
  return (
    <Layer className={onPick ? "cursor-pointer" : undefined} {...(onPick ? { onClick: () => onPick(payload.name) } : {})}>
      <Rectangle x={x} y={y} width={width} height={height} fill={c} rx={3} />
      <text x={right ? x + width + 8 : x - 8} y={y + height / 2 - 2} textAnchor={right ? "start" : "end"} fontSize={12} fontWeight={600} fill="hsl(var(--foreground))" stroke="hsl(var(--card))" strokeWidth={3} paintOrder="stroke">{payload.name}</text>
      <text x={right ? x + width + 8 : x - 8} y={y + height / 2 + 12} textAnchor={right ? "start" : "end"} fontSize={11} fill="hsl(var(--muted-foreground))" stroke="hsl(var(--card))" strokeWidth={3} paintOrder="stroke">{fmt(payload.value)}</text>
    </Layer>
  );
}

function FlowLink(p: LinkP) {
  const { sourceX, targetX, sourceY, targetY, sourceControlX, targetControlX, linkWidth, payload } = p;
  const c = SANKEY_COLORS[payload.target.name] || V.blue;
  return (
    <path d={`M${sourceX},${sourceY + linkWidth / 2} C${sourceControlX},${sourceY + linkWidth / 2} ${targetControlX},${targetY + linkWidth / 2} ${targetX},${targetY + linkWidth / 2}`}
      fill="none" stroke={c} strokeOpacity={0.35} strokeWidth={linkWidth} className="transition-[stroke-opacity] hover:[stroke-opacity:.6]" />
  );
}

export function FlowViz({ d, onSelect }: { d: AtsOverview; onSelect?: (node: string) => void }) {
  const flow = useMemo(() => buildFlow(d), [d]);
  if (!flow.links.length) return <Empty />;
  return (
    <>
      <ResponsiveContainer width="100%" height={280}>
        <Sankey data={{ nodes: flow.nodes, links: flow.links }} node={(p: unknown) => <FlowNode {...(p as NodeP)} onPick={onSelect} />} link={(p: unknown) => <FlowLink {...(p as LinkP)} />} nodePadding={28} nodeWidth={12} margin={{ left: 6, right: 110, top: 8, bottom: 8 }} iterations={32}>
          <Tooltip {...tooltipStyle} />
        </Sankey>
      </ResponsiveContainer>
      <details className="mt-1 text-xs text-muted-foreground">
        <summary className="cursor-pointer py-1 font-medium">View as table</summary>
        <table className="mt-1 w-full"><thead><tr className="text-left"><th>From</th><th>To</th><th className="text-right">Candidates</th></tr></thead>
          <tbody>{flow.table.map((r) => <tr key={r.from + r.to} className="border-t"><td>{r.from}</td><td>{r.to}</td><td className="text-right tabular-nums">{fmt(r.n)}</td></tr>)}</tbody></table>
      </details>
    </>
  );
}

/* ───────────── Source treemap: area = volume, opacity = selection conversion ───────────── */
function TreeCell(p: CellP) {
  const { x = 0, y = 0, width = 0, height = 0, name = "", total, convRate = 0, maxConv = 1, onPick } = p;
  if (width < 4 || height < 4 || total == null) return null;
  const o = 0.25 + 0.75 * (maxConv ? convRate / maxConv : 0);
  const ink = o > 0.55 ? "#fff" : "hsl(var(--foreground))";
  return (
    <g className={onPick ? "cursor-pointer" : undefined} {...(onPick ? { onClick: () => onPick(name), role: "button", "aria-label": `Drill into ${name}` } : {})}>
      <rect x={x + 1} y={y + 1} width={width - 2} height={height - 2} rx={8} fill={V.blue} fillOpacity={o} stroke="hsl(var(--card))" strokeWidth={2} />
      {width > 70 && height > 42 && (
        <>
          <text x={x + 10} y={y + 22} fontSize={12} fontWeight={600} fill={ink}>{String(name).slice(0, Math.floor(width / 7.5))}</text>
          <text x={x + 10} y={y + 38} fontSize={11} fill={ink} fillOpacity={0.9}>{fmt(total)} · {convRate}% sel</text>
        </>
      )}
    </g>
  );
}

export function SourceTreemap({ data, onSelect }: { data: AtsOverview["sources"]; onSelect?: (name: string) => void }) {
  if (!data.length) return <Empty />;
  const maxConv = Math.max(1, ...data.map((s) => s.convRate));
  const rows = data.map((s) => ({ ...s, size: Math.max(1, s.total), maxConv, onPick: onSelect }));
  return (
    <>
      <ResponsiveContainer width="100%" height={250}>
        <Treemap data={rows} dataKey="size" content={<TreeCell />} isAnimationActive={false}>
          <Tooltip {...tooltipStyle} formatter={(_v, _n, item) => { const r = item.payload as AtsOverview["sources"][number]; return [`${fmt(r.total)} candidates · ${r.convRate}% selected · ${fmt(r.joined)} joined`, r.name]; }} />
        </Treemap>
      </ResponsiveContainer>
      <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground"><span>Lower conversion</span><span className="h-2 w-24 rounded-full" style={{ background: `linear-gradient(90deg,color-mix(in srgb,${V.blue} 25%,transparent),${V.blue})` }} /><span>Higher</span></div>
    </>
  );
}

/* ───────────── Arrival heatmap with legend + peak callout ───────────── */
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export function Heatmap({ data, onSelect }: { data: AtsOverview["heatmap"]; onSelect?: (dow: number, hour: number) => void }) {
  const hours = Array.from({ length: 12 }, (_, i) => i + 8);
  const map = new Map(data.map((d) => [`${d.dow}-${d.hour}`, d.n]));
  const peak = data.reduce((a, b) => (b.n > a.n ? b : a), { dow: 0, hour: 0, n: 0 });
  const max = Math.max(1, peak.n);
  if (!data.length) return <Empty />;
  return (
    <div>
      <div className="overflow-x-auto"><div className="grid min-w-[380px] gap-[3px]" style={{ gridTemplateColumns: `34px repeat(${hours.length},1fr)` }}>
        <span />{hours.map((h) => <span key={h} className="text-center text-[10px] text-muted-foreground">{h > 12 ? h - 12 : h}{h >= 12 ? "p" : "a"}</span>)}
        {DAYS.map((d, i) => (
          <div key={d} className="contents">
            <span className="text-[11px] leading-6 text-muted-foreground">{d}</span>
            {hours.map((h) => {
              const n = map.get(`${i + 1}-${h}`) || 0;
              return <div key={h} tabIndex={n ? 0 : -1} role={onSelect && n ? "button" : undefined} onClick={onSelect && n ? () => onSelect(i + 1, h) : undefined} onKeyDown={onSelect && n ? (e) => (e.key === "Enter" || e.key === " ") && onSelect(i + 1, h) : undefined} title={`${d} ${h}:00 — ${n} arrivals`} aria-label={`${d} ${h}:00, ${n} arrivals`} className={`h-6 rounded-[5px] transition-transform hover:scale-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${onSelect && n ? "cursor-pointer" : ""}`} style={{ background: n ? V.blue : "var(--v-track)", opacity: n ? 0.2 + 0.8 * (n / max) : 1 }} />;
            })}
          </div>
        ))}
      </div></div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1.5">Fewer<span className="h-2 w-20 rounded-full" style={{ background: `linear-gradient(90deg,color-mix(in srgb,${V.blue} 20%,transparent),${V.blue})` }} />More</span>
        {peak.n > 0 && <span>Peak: <b className="text-foreground">{DAYS[peak.dow - 1]} {peak.hour > 12 ? peak.hour - 12 : peak.hour}{peak.hour >= 12 ? "pm" : "am"}</b> ({peak.n})</span>}
      </div>
    </div>
  );
}
