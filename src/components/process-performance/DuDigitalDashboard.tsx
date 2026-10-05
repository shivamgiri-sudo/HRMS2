import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ComposedChart, Bar, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { hrmsApi } from "@/lib/hrmsApi";
import * as XLSX from "xlsx";
import { GncDetailDrawer, type DrawerSeries } from "./GncAbandonCartDetailDrawer";

/**
 * DU Digital Thailand / Korea performance dashboard.
 *
 * Design direction ("dispatch room"): a daily ops control view. The hero states the one thing a
 * manager needs first -- today's service level against target -- in a bold numeral, and the
 * 24-cell slot strip is the signature: each hour is colored by its SL% for the chosen date, and
 * clicking a cell drives the slot-wise table. Palette is slate-dispatch with a per-country accent;
 * Inter throughout, with tabular figures so numeric columns line up.
 *
 * Tagging Count / Deficit stay honest zeros until a tagging source is connected -- no drill-down,
 * since there is no trend to show.
 */

type Country = "KOREA" | "THAILAND";

interface KpiBlock {
  offered: number; answered: number; answeredWithin20: number; abandoned: number; abandonedWithin20: number;
  slPct: number; alPct: number; abandonPct: number; ahtSec: number; aht: string;
  agentCount: number; taggingCount: number; deficit: number; taggingPct: number;
}
interface DayRow { date: string; offered: number; answered: number; answeredWithin20: number; abandoned: number; abandonedWithin20: number; slPct: number; alPct: number; abandonPct: number; ahtSec: number; agentCount: number }
interface LanguageRow { userGroup: string; offered: number; answered: number; abandoned: number; slPct: number; alPct: number }
interface HourRow { hour: number; offered: number; answered: number; answeredWithin20: number; abandoned: number }
interface AgentRow { agent: string; offered: number; answered: number; abandoned: number; alPct: number; calls: number; loginSec: number; talkSec: number; login: string; talk: string }
interface AgentDayRow { agent: string; date: string; offered: number; answered: number; abandoned: number; calls: number; loginSec: number; talkSec: number }
interface SlotRow { date: string; hour: number; offered: number; answered: number; answeredWithin20: number; abandoned: number; slPct: number; alPct: number; ahtSec: number }
interface DashboardData {
  from: string; to: string;
  kpis: KpiBlock;
  snapshot: { today: KpiBlock & { date: string }; wtd: KpiBlock; mtd: KpiBlock };
  intraday: HourRow[]; intradayDate: string;
  language: LanguageRow[];
  daily: DayRow[];
  agents: AgentRow[];
  agentDaily: AgentDayRow[];
  slots: SlotRow[];
  dataAvailable: boolean;
}

const SL_TARGET = 80;

const PALETTE = {
  canvas: "#EEF2F6", card: "#FFFFFF", ink: "#0F1B2D", muted: "#64748B", line: "#E2E8F0",
  answered: "#0E9F8E", abandoned: "#E4572E", sl: "#E8A33D", offered: "#7C8DB5", aht: "#475569",
};
const ACCENT: Record<Country, { accent: string; soft: string; label: string }> = {
  THAILAND: { accent: "#2847C9", soft: "#E3E9FB", label: "Thailand" },
  KOREA: { accent: "#0F766E", soft: "#DDF3EF", label: "Korea" },
};

const CSS = `
@import url("https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap");
.du-root{--canvas:${PALETTE.canvas};--ink:${PALETTE.ink};--muted:${PALETTE.muted};--line:${PALETTE.line};--answered:${PALETTE.answered};--abandoned:${PALETTE.abandoned};--sl:${PALETTE.sl};
  font-family:"Inter",ui-sans-serif,system-ui,sans-serif;color:var(--ink);background:var(--canvas);border-radius:18px;padding:12px;position:relative;overflow:hidden}
.du-root *{box-sizing:border-box}
.du-serif{font-family:"Inter",ui-sans-serif,system-ui,sans-serif;font-weight:700;letter-spacing:-.02em}
.du-mono{font-family:"Inter",ui-sans-serif,system-ui,sans-serif;font-variant-numeric:tabular-nums}
.du-eyebrow{font-size:10px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:var(--muted)}
.du-card{background:${PALETTE.card};border:1px solid var(--line);border-radius:12px;padding:10px;box-shadow:0 1px 0 rgba(15,27,45,.03),0 8px 24px -16px rgba(15,27,45,.18)}
.du-hero{display:grid;gap:12px;grid-template-columns:1.4fr 1fr;align-items:end;padding:14px 16px;border-radius:14px;color:#fff;background:radial-gradient(120% 140% at 0% 0%,var(--accent-hi) 0%,var(--accent) 55%,#0B1530 100%)}
.du-hero-num{font-size:60px;line-height:.9;letter-spacing:-.03em;font-weight:700}
.du-pill{display:inline-flex;align-items:center;gap:6px;border-radius:999px;padding:4px 10px;font-size:11px;font-weight:600}
.du-tiles{display:grid;gap:10px;grid-template-columns:repeat(auto-fit,minmax(118px,1fr))}
.du-tile{all:unset;cursor:pointer;background:${PALETTE.card};border:1px solid var(--line);border-radius:12px;padding:8px 10px;display:flex;flex-direction:column;gap:4px;transition:transform .18s ease,box-shadow .18s ease,border-color .18s ease}
.du-tile:hover{transform:translateY(-2px);box-shadow:0 14px 28px -18px rgba(15,27,45,.45);border-color:#cbd5e1}
.du-tile:focus-visible,.du-slot:focus-visible,.du-row:focus-visible,.du-btn:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.du-tile-static{background:${PALETTE.card};border:1px dashed #cbd5e1;border-radius:16px;padding:12px 14px;display:flex;flex-direction:column;gap:6px;opacity:.9}
.du-val{font-family:"Inter",ui-sans-serif,system-ui,sans-serif;font-variant-numeric:tabular-nums;font-size:16px;font-weight:600;letter-spacing:-.02em}
.du-slots{display:grid;grid-template-columns:repeat(24,minmax(0,1fr));gap:4px}
.du-slot{all:unset;cursor:pointer;height:36px;border-radius:6px;display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:"Inter",ui-sans-serif,system-ui,sans-serif;font-variant-numeric:tabular-nums;font-size:10px;color:#fff;transition:transform .15s ease}
.du-slot:hover{transform:translateY(-2px)}
.du-slot-empty{background:#E2E8F0;color:#94A3B8}
.du-slot-sel{box-shadow:0 0 0 2px var(--ink) inset}
.du-table{width:100%;border-collapse:separate;border-spacing:0;font-size:11px}
.du-table th{font-size:10px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);text-align:right;padding:5px 8px;border-bottom:1px solid var(--line);background:#F8FAFC;position:sticky;top:0}
.du-table th:first-child,.du-table td:first-child{text-align:left}
.du-table td{padding:5px 8px;text-align:right;border-bottom:1px solid #F1F5F9;font-family:"Inter",ui-sans-serif,system-ui,sans-serif;font-variant-numeric:tabular-nums;color:#334155}
.du-table td:first-child{font-family:"Inter",ui-sans-serif,system-ui,sans-serif;font-weight:600;color:var(--ink)}
.du-row{cursor:pointer;transition:background .15s ease}
.du-row:hover{background:#F8FAFC}
.du-bar{height:6px;border-radius:999px;background:#E2E8F0;overflow:hidden}
.du-bar>span{display:block;height:100%;border-radius:999px;background:var(--answered)}
.du-enter{animation:du-rise .55s cubic-bezier(.2,.7,.2,1) both}
@keyframes du-rise{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
.du-enter-2{animation-delay:.06s}.du-enter-3{animation-delay:.12s}.du-enter-4{animation-delay:.18s}
@media (prefers-reduced-motion: reduce){.du-enter,.du-enter-2,.du-enter-3,.du-enter-4{animation:none}.du-tile,.du-slot,.du-row{transition:none}.du-tile:hover,.du-slot:hover{transform:none}}
@media (max-width: 860px){.du-hero{grid-template-columns:1fr}.du-hero-num{font-size:64px}.du-slots{grid-template-columns:repeat(12,minmax(0,1fr))}}
`;

function downloadCsv(fileBase: string, rows: Array<Record<string, string | number>>): void {
  if (rows.length === 0) return;
  const cols = Object.keys(rows[0]);
  const esc = (v: string | number) => {
    const s = String(v ?? "");
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const body = [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
  const url = URL.createObjectURL(new Blob([body], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${fileBase}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function localDateStr(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function currentMonthRange(): { from: string; to: string } {
  const now = new Date();
  return { from: localDateStr(new Date(now.getFullYear(), now.getMonth(), 1)), to: localDateStr(now) };
}
const int = (n: number) => Math.round(n).toLocaleString("en-IN");
const fmtHms = (sec: number) => {
  const s = Math.max(0, Math.round(sec));
  return `${String(Math.floor(s / 3600)).padStart(2, "0")}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};
const hourLabel = (h: number) => `${String(h).padStart(2, "0")}:00`;
const dayLabel = (iso: string) => {
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
};

/** Heat color for an SL% value: amber-to-teal ramp, coral for a real miss. */
function slColor(sl: number, hasVolume: boolean): string {
  if (!hasVolume) return "";
  if (sl >= SL_TARGET) return "#0E9F8E";
  if (sl >= SL_TARGET - 15) return "#E8A33D";
  return "#E4572E";
}

function weeklyRollup(rows: Array<Record<string, string | number>>): Array<Record<string, string | number>> {
  const map = new Map<string, { label: string; offered: number; answered: number; answeredWithin20: number; abandoned: number; abandonedWithin20: number; ahtWeighted: number }>();
  for (const r of rows) {
    const iso = String(r.date);
    const n = Math.ceil(Number(iso.slice(8, 10)) / 7);
    const key = `${iso.slice(0, 7)}-W${n}`;
    const cur = map.get(key) ?? { label: `Week-${n}`, offered: 0, answered: 0, answeredWithin20: 0, abandoned: 0, abandonedWithin20: 0, ahtWeighted: 0 };
    cur.offered += Number(r.offered ?? 0); cur.answered += Number(r.answered ?? 0);
    cur.answeredWithin20 += Number(r.answeredWithin20 ?? 0); cur.abandoned += Number(r.abandoned ?? 0);
    cur.abandonedWithin20 += Number(r.abandonedWithin20 ?? 0);
    cur.ahtWeighted += Number(r.ahtSec ?? 0) * Number(r.answered ?? 0);
    map.set(key, cur);
  }
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, v]) => ({
    label: v.label, offered: v.offered, answered: v.answered, answeredWithin20: v.answeredWithin20, abandoned: v.abandoned, abandonedWithin20: v.abandonedWithin20,
    slPct: v.offered > 0 ? Math.round((v.answeredWithin20 / v.offered) * 1000) / 10 : 0,
    alPct: v.offered > 0 ? Math.round((v.answered / v.offered) * 1000) / 10 : 0,
    abandonPct: v.offered > 0 ? Math.round((v.abandoned / v.offered) * 1000) / 10 : 0,
    ahtSec: v.answered > 0 ? Math.round(v.ahtWeighted / v.answered) : 0,
  }));
}

/** Inline sparkline of one daily series, drawn as SVG so 13 tiles stay cheap to render. */
function Spark({ values, color }: { values: number[]; color: string }) {
  if (values.length < 2) return <div style={{ height: 22 }} />;
  const max = Math.max(...values, 1), min = Math.min(...values, 0);
  const span = max - min || 1;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 100},${22 - ((v - min) / span) * 20 - 1}`).join(" ");
  return (
    <svg viewBox="0 0 100 22" preserveAspectRatio="none" style={{ width: "100%", height: 22 }} aria-hidden>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.6" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function Ring({ value, color, label }: { value: number; color: string; label: string }) {
  const r = 34, c = 2 * Math.PI * r, v = Math.max(0, Math.min(100, value));
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
      <svg width="92" height="92" viewBox="0 0 92 92" aria-label={`${label} ${value}%`} role="img">
        <circle cx="46" cy="46" r={r} fill="none" stroke="#E2E8F0" strokeWidth="9" />
        <circle cx="46" cy="46" r={r} fill="none" stroke={color} strokeWidth="9" strokeLinecap="round"
          strokeDasharray={`${(v / 100) * c} ${c}`} transform="rotate(-90 46 46)" />
        <text x="46" y="51" textAnchor="middle" className="du-mono" style={{ fontSize: 17, fontWeight: 600, fill: PALETTE.ink }}>{value}%</text>
      </svg>
      <span className="du-eyebrow">{label}</span>
    </div>
  );
}

export function DuDigitalDashboard({ country }: { country: Country }) {
  const meta = ACCENT[country];
  const defaultRange = currentMonthRange();
  const [from, setFrom] = useState(defaultRange.from);
  const [to, setTo] = useState(defaultRange.to);
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [drawer, setDrawer] = useState<{ title: string; series: DrawerSeries[]; daily: Array<Record<string, string | number>>; weekly: Array<Record<string, string | number>> } | null>(null);
  const [showAllAgents, setShowAllAgents] = useState(false);
  const [slotDate, setSlotDate] = useState<string>("");
  const [slotHour, setSlotHour] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const res = await hrmsApi.get<{ success: boolean; data: DashboardData }>(
        `/api/process-performance/du-digital/${country.toLowerCase()}/dashboard?from=${from}&to=${to}`,
      );
      setData(res.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load this dashboard. Check the date range and try again.");
    } finally { setLoading(false); }
  }, [country, from, to]);
  useEffect(() => { void load(); }, [load]);

  const slotDates = useMemo(() => [...new Set((data?.slots ?? []).map((s) => s.date))].sort(), [data]);
  const activeSlotDate = slotDates.includes(slotDate) ? slotDate : (slotDates[slotDates.length - 1] ?? "");
  const slotsForDate = useMemo(() => (data?.slots ?? []).filter((s) => s.date === activeSlotDate), [data, activeSlotDate]);
  const slotByHour = useMemo(() => new Map(slotsForDate.map((s) => [s.hour, s])), [slotsForDate]);
  const selectedSlot = slotHour !== null ? slotByHour.get(slotHour) ?? null : null;

  if (loading && !data) return <div className="du-root" style={{ ["--accent" as string]: meta.accent, ["--accent-hi" as string]: meta.accent }}><style>{CSS}</style><p className="du-eyebrow">Loading {meta.label} dashboard…</p></div>;
  if (error && !data) return <div className="du-card" style={{ color: "#B42318" }}>{error}</div>;
  if (!data) return null;

  const accentVars = { ["--accent" as string]: meta.accent, ["--accent-hi" as string]: meta.accent } as React.CSSProperties;
  const k = data.kpis;
  const dailyRows = data.daily as unknown as Array<Record<string, string | number>>;
  const dailyAsc = [...data.daily].reverse();
  const series = (f: (d: DayRow) => number) => dailyAsc.map(f);
  const openKpi = (title: string, s: DrawerSeries[]) => setDrawer({ title, series: s, daily: dailyRows, weekly: weeklyRollup(dailyRows) });

  // One workbook with the same breakdowns as the page: headline, week-wise, date-wise, agent-wise, slot-wise.
  const exportExcel = () => {
    const wb = XLSX.utils.book_new();
    const headline = [
      ["Metric", "Value"], ["Offered", k.offered], ["Answered", k.answered], ["Answered ≤ 20 s", k.answeredWithin20],
      ["Abandoned", k.abandoned], ["Abandoned ≤ 20 s", k.abandonedWithin20], ["SL %", k.slPct], ["AL %", k.alPct],
      ["Abandon %", k.abandonPct], ["AHT", k.aht], ["Agents", k.agentCount],
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(headline), "Dashboard");
    const weekly = weeklyRollup(dailyRows);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ["Week", "Offered", "Answered", "Answered ≤ 20 s", "Abandoned", "SL %", "AL %", "Abandon %", "AHT (sec)"],
      ...weekly.map((w) => [String(w.label), Number(w.offered), Number(w.answered), Number(w.answeredWithin20), Number(w.abandoned), Number(w.slPct), Number(w.alPct), Number(w.abandonPct), Number(w.ahtSec)]),
    ]), "Week-wise");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ["Date", "Offered", "Answered", "Answered ≤ 20 s", "Abandoned", "SL %", "AL %", "AHT (sec)", "Agents"],
      ...data.daily.map((d) => [d.date, d.offered, d.answered, d.answeredWithin20, d.abandoned, d.slPct, d.alPct, d.ahtSec, d.agentCount]),
    ]), "Date-wise");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ["Agent", "Offered", "Answered", "Abandoned", "AL %", "Calls", "Login", "Talk"],
      ...data.agents.map((a) => [a.agent, a.offered, a.answered, a.abandoned, a.alPct, a.calls, a.login, a.talk]),
    ]), "Agent-wise");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ["Date", "Hour", "Offered", "Answered", "Answered ≤ 20 s", "Abandoned", "SL %", "AL %", "AHT (sec)"],
      ...data.slots.map((s) => [s.date, s.hour, s.offered, s.answered, s.answeredWithin20, s.abandoned, s.slPct, s.alPct, s.ahtSec]),
    ]), "Slot-wise");
    XLSX.writeFile(wb, `du_digital_${country.toLowerCase()}_${from}_${to}.xlsx`);
  };
  const openAgent = (agent: string) => {
    const rows = data.agentDaily.filter((r) => r.agent === agent) as unknown as Array<Record<string, string | number>>;
    setDrawer({
      title: `${agent} · Daily performance`,
      series: [
        { key: "offered", label: "Call Offered", fmt: "int", color: PALETTE.offered },
        { key: "answered", label: "Call Answered", fmt: "int", color: PALETTE.answered },
        { key: "abandoned", label: "Abandoned", fmt: "int", color: PALETTE.abandoned },
        { key: "calls", label: "APR Calls", fmt: "int", color: "#F59E0B" },
        { key: "loginSec", label: "Login Time", fmt: "hms", color: "#6366F1" },
        { key: "talkSec", label: "Talk Time", fmt: "hms", color: PALETTE.answered },
      ],
      daily: rows, weekly: [],
    });
  };

  const verdictOk = k.slPct >= SL_TARGET;
  const intradayChart = data.intraday.map((h) => ({ ...h, x: hourLabel(h.hour) }));
  const trendAbove = (sl: number) => (sl >= SL_TARGET ? "On target" : `${(SL_TARGET - sl).toFixed(1)} pts below`);

  return (
    <div className="du-root" style={accentVars}>
      <style>{CSS}</style>

      {/* Hero: one thesis, the service level, against target */}
      <section className="du-hero du-enter">
        <div>
          <p className="du-eyebrow" style={{ color: "rgba(255,255,255,.75)" }}>DU Digital · {meta.label} · Voice operations</p>
          <h2 className="du-serif" style={{ margin: "2px 0 0", fontSize: 24, fontWeight: 700, letterSpacing: "-.01em" }}>
            Service level, {from === to ? dayLabel(to) : `${dayLabel(from)} – ${dayLabel(to)}`}
          </h2>
          <div style={{ marginTop: 14, display: "flex", alignItems: "flex-end", gap: 14 }}>
            <span className="du-hero-num du-serif">{k.slPct}<span style={{ fontSize: 28, opacity: .8 }}>%</span></span>
            <div style={{ paddingBottom: 10 }}>
              <span className="du-pill" style={{ background: verdictOk ? "rgba(14,159,142,.22)" : "rgba(228,87,46,.25)", color: "#fff" }}>
                {verdictOk ? "✓ On target" : "▼ Below target"} · target {SL_TARGET}%
              </span>
              <p style={{ margin: "8px 0 0", fontSize: 12, color: "rgba(255,255,255,.8)" }}>
                {int(k.answeredWithin20)} of {int(k.offered)} calls answered within 20 s
              </p>
            </div>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 10 }}>
          {[
            { label: "Answer level", value: `${k.alPct}%` },
            { label: "Abandon rate", value: `${k.abandonPct}%` },
            { label: "Avg handle time", value: k.aht },
            { label: "Agents active", value: int(k.agentCount) },
          ].map((m) => (
            <div key={m.label} style={{ background: "rgba(255,255,255,.12)", border: "1px solid rgba(255,255,255,.18)", borderRadius: 14, padding: "10px 12px" }}>
              <div className="du-mono" style={{ fontSize: 16, fontWeight: 600 }}>{m.value}</div>
              <div style={{ fontSize: 11, opacity: .8 }}>{m.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Date controls */}
      <div className="du-enter du-enter-2" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 10, margin: "16px 0" }}>
        <div className="du-eyebrow">{data.dataAvailable ? `${int(k.offered)} calls · ${data.daily.length} day${data.daily.length === 1 ? "" : "s"} in range` : "No calls in this range"}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input aria-label="From date" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="du-mono" style={{ border: "1px solid var(--line)", borderRadius: 10, padding: "6px 10px", fontSize: 12, background: "#fff" }} />
          <span className="du-eyebrow">to</span>
          <input aria-label="To date" type="date" value={to} min={from} max={localDateStr(new Date())} onChange={(e) => setTo(e.target.value)} className="du-mono" style={{ border: "1px solid var(--line)", borderRadius: 10, padding: "6px 10px", fontSize: 12, background: "#fff" }} />
          <button type="button" className="du-btn" onClick={() => { const r = currentMonthRange(); setFrom(r.from); setTo(r.to); }}
            style={{ border: "1px solid var(--line)", background: "#fff", borderRadius: 10, padding: "6px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>This month</button>
        </div>
      </div>
      {error && <div className="du-card" style={{ color: "#B42318", marginBottom: 12 }}>{error}</div>}

      {/* KPI ledger: every real metric opens its own trend drawer */}
      <section className="du-enter du-enter-2" style={{ marginBottom: 16 }}>
        <div className="du-tiles">
          {[
            { label: "Call offered", value: int(k.offered), sp: series((d) => d.offered), color: PALETTE.offered, onClick: () => openKpi("Call offered", [S.offered, S.answered, S.abandoned]) },
            { label: "Call answered", value: int(k.answered), sp: series((d) => d.answered), color: PALETTE.answered, onClick: () => openKpi("Call answered", [S.answered, S.alPct]) },
            { label: "Answered ≤ 20 s", value: int(k.answeredWithin20), sp: series((d) => d.answeredWithin20), color: PALETTE.answered, onClick: () => openKpi("Answered within 20 s", [S.answeredWithin20, S.answered, S.slPct]) },
            { label: "Total abandoned", value: int(k.abandoned), sp: series((d) => d.abandoned), color: PALETTE.abandoned, onClick: () => openKpi("Total abandoned", [S.abandoned, S.abandonPct]) },
            { label: "Abandoned ≤ 20 s", value: int(k.abandonedWithin20), sp: series((d) => d.abandonedWithin20), color: PALETTE.abandoned, onClick: () => openKpi("Abandoned within 20 s", [S.abandonedWithin20, S.abandoned]) },
            { label: "Service level", value: `${k.slPct}%`, sp: series((d) => d.slPct), color: PALETTE.sl, onClick: () => openKpi("Service level %", [S.slPct, S.answeredWithin20, S.offered]) },
            { label: "Answer level", value: `${k.alPct}%`, sp: series((d) => d.alPct), color: PALETTE.answered, onClick: () => openKpi("Answer level %", [S.alPct, S.answered, S.offered]) },
            { label: "Abandon rate", value: `${k.abandonPct}%`, sp: series((d) => d.abandonPct), color: PALETTE.abandoned, onClick: () => openKpi("Abandon %", [S.abandonPct, S.abandoned, S.offered]) },
            { label: "Avg handle time", value: k.aht, sp: series((d) => d.ahtSec), color: PALETTE.aht, onClick: () => openKpi("Average handle time", [S.ahtSec]) },
            { label: "Agents active", value: int(k.agentCount), sp: series((d) => d.agentCount), color: "#6366F1", onClick: () => openKpi("Agent count", [S.agentCount]) },
          ].map((t) => (
            <button key={t.label} type="button" className="du-tile" onClick={t.onClick} aria-label={`${t.label}: ${t.value}. Open trend`}>
              <span className="du-eyebrow">{t.label}</span>
              <span className="du-val">{t.value}</span>
              <Spark values={t.sp} color={t.color} />
            </button>
          ))}
        </div>
        <div className="du-tiles" style={{ marginTop: 10, gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))" }}>
          <div className="du-tile-static"><span className="du-eyebrow">Tagging count</span><span className="du-val">{int(k.taggingCount)}</span><span style={{ fontSize: 11, color: PALETTE.muted }}>No tagging source connected</span></div>
          <div className="du-tile-static"><span className="du-eyebrow">Deficit</span><span className="du-val">{int(k.deficit)}</span><span style={{ fontSize: 11, color: PALETTE.muted }}>Answered minus tagged</span></div>
          <div className="du-tile-static"><span className="du-eyebrow">Tagging rate</span><span className="du-val">{k.taggingPct}%</span><span style={{ fontSize: 11, color: PALETTE.muted }}>Awaiting tagging data</span></div>
        </div>
      </section>

      {/* Signature: 24-hour slot strip, colored by SL% for the chosen date */}
      <section className="du-card du-enter du-enter-3" style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 12 }}>
          <div>
            <p className="du-eyebrow">Slot heat strip</p>
            <p style={{ margin: "2px 0 0", fontSize: 14, fontWeight: 600 }}>Service level by hour, {slotDates.length ? dayLabel(activeSlotDate) : "no date"}</p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className="du-eyebrow">Date</span>
            <select aria-label="Slot-wise date" value={activeSlotDate} onChange={(e) => { setSlotDate(e.target.value); setSlotHour(null); }}
              className="du-mono" style={{ border: "1px solid var(--line)", borderRadius: 10, padding: "6px 10px", fontSize: 12, background: "#fff" }}>
              {slotDates.map((d) => <option key={d} value={d}>{dayLabel(d)}</option>)}
            </select>
          </div>
        </div>
        <div className="du-slots">
          {Array.from({ length: 24 }, (_, h) => {
            const s = slotByHour.get(h);
            const has = !!s && s.offered > 0;
            const color = has ? slColor(s!.slPct, true) : "";
            return (
              <button key={h} type="button" className={`du-slot ${has ? "" : "du-slot-empty"} ${slotHour === h ? "du-slot-sel" : ""}`}
                style={has ? { background: color } : undefined}
                onClick={() => setSlotHour(slotHour === h ? null : h)}
                aria-label={`${hourLabel(h)}: ${has ? `${s!.offered} calls, SL ${s!.slPct}%` : "no calls"}`}
                title={has ? `${hourLabel(h)} · ${s!.offered} calls · SL ${s!.slPct}%` : `${hourLabel(h)} · no calls`}>
                <span style={{ fontWeight: 600 }}>{String(h).padStart(2, "0")}</span>
                <span style={{ opacity: .9 }}>{has ? `${s!.slPct}` : "–"}</span>
              </button>
            );
          })}
        </div>
        <div style={{ display: "flex", gap: 14, marginTop: 10, fontSize: 11, color: PALETTE.muted }}>
          <span><b style={{ color: PALETTE.answered }}>■</b> at or above {SL_TARGET}%</span>
          <span><b style={{ color: PALETTE.sl }}>■</b> within 15 pts</span>
          <span><b style={{ color: PALETTE.abandoned }}>■</b> further below</span>
        </div>

        <div style={{ overflowX: "auto", marginTop: 14, maxHeight: 340, overflowY: "auto" }}>
          <table className="du-table">
            <thead>
              <tr>
                <th>Slot</th><th>Offered</th><th>Answered</th><th>≤ 20 s</th><th>Abandoned</th><th>SL %</th><th>AL %</th><th>AHT</th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 24 }, (_, h) => h).filter((h) => slotByHour.has(h)).map((h) => {
                const s = slotByHour.get(h)!;
                return (
                  <tr key={h} className="du-row" tabIndex={0} onClick={() => setSlotHour(slotHour === h ? null : h)}
                    onKeyDown={(e) => { if (e.key === "Enter") setSlotHour(slotHour === h ? null : h); }}
                    style={slotHour === h ? { background: "#F1F5FF" } : undefined}>
                    <td>{hourLabel(h)}–{hourLabel((h + 1) % 24)}</td>
                    <td>{int(s.offered)}</td><td>{int(s.answered)}</td><td>{int(s.answeredWithin20)}</td><td style={{ color: PALETTE.abandoned }}>{int(s.abandoned)}</td>
                    <td style={{ color: slColor(s.slPct, true), fontWeight: 600 }}>{s.slPct}%</td><td>{s.alPct}%</td><td>{fmtHms(s.ahtSec)}</td>
                  </tr>
                );
              })}
              {slotsForDate.length === 0 && <tr><td colSpan={8} style={{ textAlign: "center", color: PALETTE.muted, fontFamily: "Inter" }}>No calls on this date.</td></tr>}
            </tbody>
            {slotsForDate.length > 0 && (
              <tfoot>
                <tr>
                  <td style={{ fontWeight: 700 }}>Day total</td>
                  <td>{int(slotsForDate.reduce((a, s) => a + s.offered, 0))}</td>
                  <td>{int(slotsForDate.reduce((a, s) => a + s.answered, 0))}</td>
                  <td>{int(slotsForDate.reduce((a, s) => a + s.answeredWithin20, 0))}</td>
                  <td>{int(slotsForDate.reduce((a, s) => a + s.abandoned, 0))}</td>
                  <td>{pct(slotsForDate.reduce((a, s) => a + s.answeredWithin20, 0), slotsForDate.reduce((a, s) => a + s.offered, 0))}%</td>
                  <td>{pct(slotsForDate.reduce((a, s) => a + s.answered, 0), slotsForDate.reduce((a, s) => a + s.offered, 0))}%</td>
                  <td>—</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
        {selectedSlot && (
          <p style={{ margin: "10px 0 0", fontSize: 12, color: PALETTE.muted }}>
            {hourLabel(selectedSlot.hour)} slot: {trendAbove(selectedSlot.slPct)} target, {int(selectedSlot.offered)} calls, {int(selectedSlot.abandoned)} abandoned.
          </p>
        )}
      </section>

      {/* Intraday + service-level rings */}
      <div className="du-enter du-enter-3" style={{ display: "grid", gap: 10, gridTemplateColumns: "minmax(0,2fr) minmax(0,1fr)", marginBottom: 10 }}>
        <section className="du-card">
          <p className="du-eyebrow">Intraday call flow</p>
          <p style={{ margin: "2px 0 8px", fontSize: 14, fontWeight: 600 }}>Offered and answered by hour, {data.intradayDate}</p>
          {data.intraday.length === 0 ? <p style={{ color: PALETTE.muted, fontSize: 12, padding: "40px 0", textAlign: "center" }}>No calls for this date yet.</p> : (
            <ResponsiveContainer width="100%" height={230}>
              <ComposedChart data={intradayChart} margin={{ top: 6, right: 8, left: -18, bottom: 0 }}>
                <defs>
                  <linearGradient id="du-off" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={PALETTE.offered} stopOpacity={0.35} /><stop offset="100%" stopColor={PALETTE.offered} stopOpacity={0} /></linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="2 4" stroke="#E2E8F0" vertical={false} />
                <XAxis dataKey="x" tick={{ fontSize: 10, fill: PALETTE.muted, fontFamily: "Inter" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: PALETTE.muted, fontFamily: "Inter" }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 12, border: "1px solid #E2E8F0", fontFamily: "Inter" }} />
                <Area type="monotone" dataKey="offered" name="Offered" stroke={PALETTE.offered} strokeWidth={2} fill="url(#du-off)" />
                <Bar dataKey="answered" name="Answered" fill={PALETTE.answered} radius={[4, 4, 0, 0]} maxBarSize={14} />
                <Bar dataKey="abandoned" name="Abandoned" fill={PALETTE.abandoned} radius={[4, 4, 0, 0]} maxBarSize={14} />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </section>
        <section className="du-card" style={{ display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
          <p className="du-eyebrow">Against target</p>
          <div style={{ display: "flex", justifyContent: "space-around", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
            <Ring value={k.slPct} color={PALETTE.sl} label="Service level" />
            <Ring value={k.alPct} color={PALETTE.answered} label="Answer level" />
            <Ring value={k.abandonPct} color={PALETTE.abandoned} label="Abandon" />
          </div>
        </section>
      </div>

      {/* Agent wise + language */}
      <div className="du-enter du-enter-4" style={{ display: "grid", gap: 10, gridTemplateColumns: "minmax(0,2fr) minmax(0,1fr)", marginBottom: 10 }}>
        <section className="du-card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <div>
              <p className="du-eyebrow">Agent wise performance</p>
              <p style={{ margin: "2px 0 0", fontSize: 14, fontWeight: 600 }}>{data.agents.length} agent{data.agents.length === 1 ? "" : "s"} · click a row for daily detail</p>
            </div>
            {data.agents.length > 8 && (
              <button type="button" className="du-btn" onClick={() => setShowAllAgents((v) => !v)} style={{ border: "1px solid var(--line)", background: "#fff", borderRadius: 10, padding: "5px 10px", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
                {showAllAgents ? "Show top 8" : `Show all ${data.agents.length}`}
              </button>
            )}
          </div>
          <div style={{ overflowX: "auto" }}>
            <table className="du-table">
              <thead><tr><th>Agent</th><th>Offered</th><th>Answered</th><th>Abandoned</th><th style={{ minWidth: 110 }}>AL %</th><th>APR calls</th><th>Login</th><th>Talk</th></tr></thead>
              <tbody>
                {(showAllAgents ? data.agents : data.agents.slice(0, 8)).map((a) => (
                  <tr key={a.agent} className="du-row" tabIndex={0} onClick={() => openAgent(a.agent)} onKeyDown={(e) => { if (e.key === "Enter") openAgent(a.agent); }}>
                    <td style={{ color: meta.accent }}>{a.agent}</td>
                    <td>{int(a.offered)}</td><td>{int(a.answered)}</td><td style={{ color: PALETTE.abandoned }}>{int(a.abandoned)}</td>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "flex-end" }}>
                        <div className="du-bar" style={{ width: 56 }}><span style={{ width: `${Math.min(100, a.alPct)}%` }} /></div>
                        <span>{a.alPct}%</span>
                      </div>
                    </td>
                    <td>{int(a.calls)}</td><td>{a.login}</td><td>{a.talk}</td>
                  </tr>
                ))}
                {data.agents.length === 0 && <tr><td colSpan={8} style={{ textAlign: "center", color: PALETTE.muted, fontFamily: "Inter" }}>No agent activity in this range.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
        <section className="du-card">
          <p className="du-eyebrow">Language / queue</p>
          <p style={{ margin: "2px 0 10px", fontSize: 14, fontWeight: 600 }}>Share of offered calls</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {data.language.map((l) => {
              const share = pct(l.offered, k.offered);
              return (
                <div key={l.userGroup}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
                    <span style={{ fontWeight: 600 }}>{l.userGroup}</span>
                    <span className="du-mono" style={{ color: PALETTE.muted }}>{int(l.offered)} · SL {l.slPct}%</span>
                  </div>
                  <div className="du-bar"><span style={{ width: `${share}%`, background: meta.accent }} /></div>
                </div>
              );
            })}
            {data.language.length === 0 && <p style={{ color: PALETTE.muted, fontSize: 12 }}>No queues in this range.</p>}
          </div>
        </section>
      </div>

      {/* Snapshots */}
      <section className="du-enter du-enter-4" style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", marginBottom: 10 }}>
        {[
          { title: "Today", sub: data.snapshot.today.date, kk: data.snapshot.today },
          { title: "Week to date", sub: `through ${to}`, kk: data.snapshot.wtd },
          { title: "Month to date", sub: `${to.slice(0, 7)}-01 → ${to}`, kk: data.snapshot.mtd },
        ].map((s) => (
          <div key={s.title} className="du-card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <p style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>{s.title}</p>
              <span style={{ fontSize: 10, color: PALETTE.muted }} className="du-mono">{s.sub}</span>
            </div>
            <p className="du-serif" style={{ margin: "6px 0 2px", fontSize: 30, fontWeight: 700, letterSpacing: "-.02em", color: slColor(s.kk.slPct, s.kk.offered > 0) || PALETTE.ink }}>
              {s.kk.slPct}<span style={{ fontSize: 20 }}>%</span>
            </p>
            <p style={{ margin: 0, fontSize: 11, color: PALETTE.muted }}>service level</p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 12px", marginTop: 12, fontSize: 12 }}>
              <span style={{ color: PALETTE.muted }}>Offered</span><span className="du-mono" style={{ textAlign: "right" }}>{int(s.kk.offered)}</span>
              <span style={{ color: PALETTE.muted }}>Answered</span><span className="du-mono" style={{ textAlign: "right" }}>{int(s.kk.answered)}</span>
              <span style={{ color: PALETTE.muted }}>Abandoned</span><span className="du-mono" style={{ textAlign: "right", color: PALETTE.abandoned }}>{int(s.kk.abandoned)}</span>
              <span style={{ color: PALETTE.muted }}>AHT</span><span className="du-mono" style={{ textAlign: "right" }}>{s.kk.aht}</span>
            </div>
          </div>
        ))}
      </section>

      {/* Week-wise: same 7-day blocks as the MIS (W-1 = days 1-7, ...) */}
      <section className="du-card du-enter du-enter-4" style={{ marginBottom: 10 }}>
        <p className="du-eyebrow">Week-wise</p>
        <p style={{ margin: "2px 0 8px", fontSize: 14, fontWeight: 600 }}>Week 1 = days 1–7, Week 2 = days 8–14, and so on</p>
        <div style={{ overflowX: "auto" }}>
          <table className="du-table">
            <thead><tr><th>Week</th><th>Offered</th><th>Answered</th><th>≤ 20 s</th><th>Abandoned</th><th>SL %</th><th>AL %</th><th>Abandon %</th><th>AHT</th></tr></thead>
            <tbody>
              {weeklyRollup(dailyRows).map((w) => (
                <tr key={String(w.label)}>
                  <td>{String(w.label)}</td><td>{int(Number(w.offered))}</td><td>{int(Number(w.answered))}</td><td>{int(Number(w.answeredWithin20))}</td>
                  <td style={{ color: PALETTE.abandoned }}>{int(Number(w.abandoned))}</td>
                  <td style={{ color: slColor(Number(w.slPct), Number(w.offered) > 0), fontWeight: 600 }}>{Number(w.slPct)}%</td>
                  <td>{Number(w.alPct)}%</td><td>{Number(w.abandonPct)}%</td><td>{fmtHms(Number(w.ahtSec))}</td>
                </tr>
              ))}
              {data.daily.length === 0 && <tr><td colSpan={9} style={{ textAlign: "center", color: PALETTE.muted, fontFamily: "Inter" }}>No data for this range.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {/* Daily detail: date-wise */}
      <section className="du-card du-enter du-enter-4">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <p className="du-eyebrow" style={{ margin: 0 }}>Daily detail</p>
          <button type="button" className="du-btn" onClick={exportExcel}
            style={{ border: "1px solid var(--line)", background: "#fff", borderRadius: 8, padding: "4px 10px", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
            Export Excel
          </button>
        </div>
        <p style={{ margin: "2px 0 8px", fontSize: 14, fontWeight: 600 }}>Each day in range</p>
        <div style={{ overflowX: "auto", maxHeight: 360, overflowY: "auto" }}>
          <table className="du-table">
            <thead><tr><th>Date</th><th>Offered</th><th>Answered</th><th>≤ 20 s</th><th>Abandoned</th><th>SL %</th><th>AL %</th><th>AHT</th><th>Agents</th></tr></thead>
            <tbody>
              {data.daily.map((d) => (
                <tr key={d.date}>
                  <td>{dayLabel(d.date)}</td><td>{int(d.offered)}</td><td>{int(d.answered)}</td><td>{int(d.answeredWithin20)}</td>
                  <td style={{ color: PALETTE.abandoned }}>{int(d.abandoned)}</td>
                  <td style={{ color: slColor(d.slPct, d.offered > 0), fontWeight: 600 }}>{d.slPct}%</td>
                  <td>{d.alPct}%</td><td>{fmtHms(d.ahtSec)}</td><td>{int(d.agentCount)}</td>
                </tr>
              ))}
              {data.daily.length === 0 && <tr><td colSpan={9} style={{ textAlign: "center", color: PALETTE.muted, fontFamily: "Inter" }}>No data for this range.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {drawer && (
        <GncDetailDrawer
          title={drawer.title} eyebrow={`DU Digital ${meta.label} · Week-wise & date-wise`} gradient="from-slate-800 via-slate-700 to-slate-900"
          series={drawer.series} dailyRows={drawer.daily} weeklyRows={drawer.weekly} onClose={() => setDrawer(null)}
          onExport={() => downloadCsv(`du_${meta.label.toLowerCase()}_${drawer.title.replace(/[^a-z0-9]+/gi, "_").toLowerCase()}_${from}_${to}`, drawer.daily)}
        />
      )}
    </div>
  );
}

function pct(n: number, d: number): number {
  return d > 0 ? Math.round((n / d) * 1000) / 10 : 0;
}

const S = {
  offered: { key: "offered", label: "Call offered", fmt: "int", color: PALETTE.offered } as DrawerSeries,
  answered: { key: "answered", label: "Call answered", fmt: "int", color: PALETTE.answered } as DrawerSeries,
  answeredWithin20: { key: "answeredWithin20", label: "Answered ≤ 20 s", fmt: "int", color: PALETTE.answered } as DrawerSeries,
  abandoned: { key: "abandoned", label: "Total abandoned", fmt: "int", color: PALETTE.abandoned } as DrawerSeries,
  abandonedWithin20: { key: "abandonedWithin20", label: "Abandoned ≤ 20 s", fmt: "int", color: "#F97316" } as DrawerSeries,
  slPct: { key: "slPct", label: "Service level %", fmt: "pct", color: PALETTE.sl } as DrawerSeries,
  alPct: { key: "alPct", label: "Answer level %", fmt: "pct", color: PALETTE.answered } as DrawerSeries,
  abandonPct: { key: "abandonPct", label: "Abandon %", fmt: "pct", color: PALETTE.abandoned } as DrawerSeries,
  ahtSec: { key: "ahtSec", label: "AHT", fmt: "hms", color: PALETTE.aht } as DrawerSeries,
  agentCount: { key: "agentCount", label: "Agents", fmt: "int", color: "#6366F1" } as DrawerSeries,
};
