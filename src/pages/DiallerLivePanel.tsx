/**
 * DiallerLivePanel — embedded inside ProcessOperationsPage.
 *
 * Detects which dialler process the selected process maps to and renders
 * the full GAS-equivalent live dashboard (same data points, same layout).
 *
 * Process mapping (by name substring, case-insensitive):
 *   "bla" | "bli" | "blu" | "inbound" | "b-3"  → B-3 IB (inbound)
 *   "reginald" + ("cart" | "abandon")           → Reginald Abandoned Cart
 *   "molecular"                                 → Molecular Email (APR)
 *   "reginald" + "email"                        → Reginald Email (APR)
 *
 * Everything renders inside the caller's layout — no DashboardLayout wrapper.
 */

import { createContext, useContext, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, LabelList, Legend,
  Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis
} from "recharts";
import { hrmsApi } from "@/lib/hrmsApi";
import { getAuthToken } from "@/lib/hrmsApi";

// ── Types ─────────────────────────────────────────────────────────────────────
type DiallerProcess =
  | "inbound" | "reginald-cart" | "molecular-email" | "reginald-email"
  | "billing" | "gs1" | "finnable"
  | "gnc" | "bella-vita" | "clovia" | "neemans" | "viega" | "exicom" | "du-digital"
  | null;
interface Filters { from: string; to: string }

// ── Drill-down context ────────────────────────────────────────────────────────
/**
 * A KPI card drills into the daily trend behind it. The trend is described as a
 * fetch descriptor rather than pre-loaded rows because most day-wise queries in
 * this file are lazy (`enabled: sub === "daily"`) — a card clicked from the
 * Overview tab would otherwise always find an empty array. Query keys mirror the
 * dashboards' own keys so an already-visited tab resolves from cache instantly.
 */
interface DrillTrend {
  title: string;
  queryKey: unknown[];
  path: string;
  params: Record<string, string>;
  cols: Col<Record<string, unknown>>[];
  /** Extracts the row array when the endpoint returns an object wrapper. */
  pick?: (raw: unknown) => Record<string, unknown>[];
  emptyHint?: string;
}

type LiveDrillContext =
  | { type: "kpi"; label: string; value: string | number; sub?: string; dashboard?: DiallerProcess; trend?: DrillTrend }
  | { type: "hourly"; date: string }
  | { type: "record"; title: string; fields: { label: string; value: React.ReactNode }[] };

type DrillFn = (ctx: LiveDrillContext) => void;
const DrillDispatch = createContext<DrillFn | null>(null);
const useDrill = () => useContext(DrillDispatch);

// ── Process detection ─────────────────────────────────────────────────────────
export function detectDiallerProcess(processName: string): DiallerProcess {
  const n = processName.toLowerCase();
  // Bla Bli Blu's inbound (B-3 IB) only. "bla bli", not a bare "bla"/"bli"/"blu":
  // that matched "Bluevine Technologies". And no generic "inbound" rule: it matched
  // "INBOUND CUSTOMER SERVICES" (NOIDA, a separate process), while the agents on
  // this dashboard's INBOUND campaign are all Bla Bli Blu (NOIDA-2) employees —
  // both showed another process Bla Bli Blu's calls. The backend's
  // detectLiveDashboard (live-dashboard-keys.ts) must agree —
  // src/tests/live-dashboard-scope-parity.test.ts checks.
  if (n.includes("bla bli") || n.includes("bla_bli") || n.includes("blabli") || n.includes("b-3") || n.includes("b3 ") || n.includes("b3_")) return "inbound";
  // Reginald Email specifically (if process explicitly named with "email")
  if (n.includes("reginald") && n.includes("email")) return "reginald-email";
  // Molecular Email
  if (n.includes("molecular")) return "molecular-email";
  // Reginald (alone or with cart/abandon/abc/men) → cart dashboard which now includes email APR
  // Reginald is part of BTM Ventures: BTM Ventures-scoped users open this dashboard.
  if (n.includes("reginald") || n.includes("btm ventures"))
    return "reginald-cart";
  // Finnable — APR dashboard (vicidial_agent_log_10_25, campaign FINNABLE)
  if (n.includes("finnable")) return "finnable";
  // Domestic Billing
  if (n.includes("billing")) return "billing";
  // GS1 India
  if (n.includes("gs1")) return "gs1";
  // Inbound CDR staging processes (pre-synced from dialer_db into inbound_cdr_daily_actual)
  if (n.includes("gnc")) return "gnc";
  if (n.includes("bella") || n.includes("bevzilla") || n.includes("embark")) return "bella-vita";
  if (n.includes("clovia")) return "clovia";
  if (n.includes("neeman")) return "neemans";
  if (n.includes("viega")) return "viega";
  if (n.includes("exicom")) return "exicom";
  if (n.includes("du digital") || n.includes("du_digital")) return "du-digital";
  return null;
}

// ── Shared helpers ────────────────────────────────────────────────────────────
async function fetchLive<T>(path: string, params: Record<string, string>): Promise<T> {
  const qs = new URLSearchParams(params).toString();
  // Use relative URL so requests go through Vite's proxy in dev (avoiding the
  // hrmsApi hardcoded localhost:5055 that doesn't have these new endpoints yet).
  // In production both share the same origin so this resolves correctly either way.
  const token = getAuthToken();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const r = await fetch(`/api/process-live/${path}?${qs}`, { headers });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const d = await r.json() as { ok: boolean; data: T };
  if (!d.ok) throw new Error("API error");
  return d.data;
}

function monthStart(): string { const d = new Date(); d.setDate(1); return d.toISOString().slice(0, 10); }
function todayStr(): string { return new Date().toISOString().slice(0, 10); }
// Data labels for SL%/AL% trend charts. Labels are drawn above the SL line and
// below the AL line so they cannot collide even when the two values are equal.
const PCT_LABEL = (v: unknown) => `${Number(v).toFixed(1)}%`;
const LABEL_STYLE_BLUE: React.CSSProperties = { fontSize: 9, fontWeight: 800, fill: "#1d4ed8" };
const LABEL_STYLE_ORANGE: React.CSSProperties = { fontSize: 9, fontWeight: 800, fill: "#c2410c" };

function fmtDay(v: unknown): string { const d = new Date(String(v ?? "")); return isNaN(d.getTime()) ? String(v ?? "") : d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" }); }
function fmtSecAxis(s: number): string { if (s <= 0) return "0"; const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); if (h > 0) return `${h}h`; return `${m}m`; }
/** A monthly view spans at least the last three calendar months — with the
 *  day filter's default (1st of this month to today) it showed a single row.
 *  An earlier "from" chosen in the filter still wins. */
function monthlyFrom(f: { from: string; to: string }): string {
  const [y, m] = f.to.slice(0, 7).split("-").map(Number);
  const d = new Date(y, m - 3, 1);
  const start = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
  return start < f.from ? start : f.from;
}
function fmtSecShort(s: number): string { if (s <= 0) return "0s"; const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const sec = Math.round(s % 60); if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`; if (m > 0) return sec > 0 ? `${m}m ${sec}s` : `${m}m`; return `${sec}s`; }
/**
 * Normalises a row's date cell to the YYYY-MM-DD the API expects.
 *
 * The dialler pool (backend/src/db/dialerDb.ts) does not set `dateStrings`, so
 * `DATE(...)` columns arrive as JS Dates and the services stringify them into
 * the long "Mon Sep 15 2026 00:00:00 GMT+0530" form. Slicing that gives
 * "Mon Sep 15", which the hourly endpoint's YYYY-MM-DD guard rejects — and it
 * then silently falls back to *today*, showing the wrong day's data under the
 * clicked day's heading. Rebuilding the date from local components (never
 * toISOString, which shifts the calendar day on a negative-offset host) keeps
 * both that form and a plain ISO string correct.
 */
function dateParam(v: unknown): string {
  const s = String(v ?? "");
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  if (isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// ── Mini UI ───────────────────────────────────────────────────────────────────
const CARD: React.CSSProperties = { background: "#fff", border: "1px solid #dce4ed", borderRadius: 17, boxShadow: "0 12px 30px rgba(16,35,57,.08)", padding: "14px 16px", position: "relative", overflow: "hidden" };

function Spinner() {
  return <div style={{ display: "flex", justifyContent: "center", padding: "40px 0" }}><div style={{ width: 34, height: 34, borderRadius: "50%", border: "4px solid #e2e8f0", borderTopColor: "#2f6fed", animation: "spin 0.9s linear infinite" }} /></div>;
}
function Err({ msg }: { msg: string }) {
  return <div style={{ margin: "10px 0", padding: "10px 14px", background: "#fff0f2", border: "1px solid #ffc2c2", borderRadius: 11, color: "#be123c", fontSize: 13 }}>{msg}</div>;
}
function InfoBox({ html }: { html: string }) {
  return <div style={{ margin: "0 0 14px", padding: "10px 14px", background: "linear-gradient(135deg,#eef7ff,#f4fbff)", border: "1px solid #d6e9f8", borderRadius: 12, color: "#36536f", fontSize: 12, fontWeight: 700 }} dangerouslySetInnerHTML={{ __html: html }} />;
}

interface KpiSpec { label: string; value: string | number; sub?: string; color: string }

function KpiCard({ label, value, sub, color, onClick }: KpiSpec & { onClick?: () => void }) {
  return (
    <div
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      aria-label={onClick ? `${label}: ${value} — open detail` : undefined}
      onClick={onClick}
      onKeyDown={onClick ? e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } } : undefined}
      className={onClick ? "dlp-kpi-clickable" : undefined}
      style={{ position: "relative", minHeight: 96, padding: "12px 14px", borderRadius: 15, color: "#fff", overflow: "hidden", boxShadow: "0 10px 24px rgba(16,35,57,.10)", background: color, cursor: onClick ? "pointer" : undefined, userSelect: onClick ? "none" : undefined }}>
      <div style={{ position: "absolute", width: 74, height: 74, borderRadius: "50%", right: -20, top: -26, background: "rgba(255,255,255,.14)" }} />
      <div style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: ".45px", fontWeight: 900, opacity: 0.9 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 950, marginTop: 5, lineHeight: 1.1 }}>{value}</div>
      {sub && <div style={{ fontSize: 9, marginTop: 6, opacity: 0.88, fontWeight: 700 }}>{sub}</div>}
    </div>
  );
}

function Panel({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <div style={{ ...CARD }}>
      <div style={{ position: "absolute", left: 0, top: 0, width: 4, height: 55, background: "linear-gradient(180deg,#2f6fed,#10b8d4)", borderRadius: "0 0 7px 0" }} />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, paddingLeft: 7 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 9, height: 9, borderRadius: "50%", background: "linear-gradient(135deg,#2f6fed,#10b8d4)", boxShadow: "0 0 0 4px rgba(47,111,237,.08)" }} />
          <h3 style={{ margin: 0, color: "#102f4b", fontSize: 14, fontWeight: 800 }}>{title}</h3>
        </div>
        {sub && <span style={{ fontSize: 10, fontWeight: 800, color: "#0369a1", background: "#e7f6fb", border: "1px solid #c8edf5", borderRadius: 999, padding: "3px 8px" }}>{sub}</span>}
      </div>
      {children}
    </div>
  );
}

function PctBadge({ v }: { v: number }) {
  const ok = v >= 80, mid = v >= 55;
  return <span style={{ fontWeight: 900, color: ok ? "#16a34a" : mid ? "#d97706" : "#dc2626", background: ok ? "#eaf8ef" : mid ? "#fff8e7" : "#fff0f2", borderRadius: 6, padding: "2px 7px" }}>{v.toFixed(1)}%</span>;
}

interface Col<T> { h: string; k: keyof T | string; left?: boolean; fmt?: (v: unknown, r: T) => React.ReactNode }

/** "netLoginTime" → "Net Login Time", for row fields the table has no column for. */
function humaniseKey(k: string): string {
  return k.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").replace(/^./, c => c.toUpperCase());
}

/**
 * Builds the drawer field list for a row: first every column the table renders,
 * then every remaining field the record carries. The API returns far more per
 * row than a table can show (an inbound day carries ~19 fields against 8
 * columns), and the drill-down mandate is the whole record, not a restatement
 * of what is already on screen.
 */
function rowToFields<T extends Record<string, unknown>>(cols: Col<T>[], row: T) {
  const shown = new Set(cols.map(c => String(c.k)));
  const fields: { label: string; value: React.ReactNode }[] = cols.map(c => {
    const raw = row[c.k as keyof T];
    return { label: c.h, value: c.fmt ? c.fmt(raw, row) : String(raw ?? "") };
  });
  for (const [k, v] of Object.entries(row)) {
    if (shown.has(k) || v === null || typeof v === "object") continue;
    fields.push({ label: humaniseKey(k), value: String(v) });
  }
  return fields;
}

/** Agent-name column for tables keyed by employee code. Names come from HRMS;
 *  a code with no HRMS record says so rather than showing a blank cell. */
function nameCol<T>(k: string): Col<T> {
  return {
    h: "Agent Name", k, left: true,
    fmt: (v: unknown) => v ? String(v) : <span style={{ color: "#94a3b8", fontStyle: "italic" }}>Not in HRMS</span>,
  };
}

function DataTable<T extends Record<string, unknown>>({ cols, rows, onRowClick, drillTitle }: {
  cols: Col<T>[]; rows: T[];
  /** Overrides the default record drill-down for this table. */
  onRowClick?: (row: T) => void;
  /** Overrides the drawer heading of the default record drill-down. */
  drillTitle?: (row: T) => string;
}) {
  const drill = useContext(DrillDispatch);
  const labelCol = cols.find(c => c.left) ?? cols[0];
  const handleRow = onRowClick ?? (drill
    ? (row: T) => drill({
      type: "record",
      title: drillTitle ? drillTitle(row) : labelCol ? `${labelCol.h}: ${String(row[labelCol.k as keyof T] ?? "—")}` : "Record detail",
      fields: rowToFields(cols, row),
    })
    : undefined);
  return (
    <div style={{ overflowX: "auto", maxHeight: 520, border: "1px solid #dce4ed", borderRadius: 11, background: "#fff" }}>
      <table style={{ borderCollapse: "separate", borderSpacing: 0, width: "100%", fontSize: 12, whiteSpace: "nowrap" }}>
        <thead>
          <tr>{cols.map((c, i) => <th key={i} style={{ position: "sticky", top: 0, background: "linear-gradient(180deg,#15365e,#102550)", color: "#fff", padding: "10px 8px", fontWeight: 900, fontSize: 11, textAlign: c.left ? "left" : "right", zIndex: 2 }}>{c.h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.length === 0 ? <tr><td colSpan={cols.length} style={{ padding: 40, textAlign: "center", color: "#697586" }}>No data</td></tr>
            : rows.map((row, i) => (
              <tr
                key={i}
                className={handleRow ? "dlp-clickable-row" : undefined}
                tabIndex={handleRow ? 0 : undefined}
                onClick={handleRow ? () => handleRow(row) : undefined}
                onKeyDown={handleRow ? e => { if (e.key === "Enter") { e.preventDefault(); handleRow(row); } } : undefined}
              >{cols.map((c, j) => (
                <td key={j} style={{ padding: "8px 8px", borderBottom: "1px solid #e8eef5", textAlign: c.left ? "left" : "right", background: i % 2 === 1 ? "#f8fafc" : "#fff" }}>
                  {c.fmt ? c.fmt(row[c.k as keyof T], row) : String(row[c.k as keyof T] ?? "")}
                </td>
              ))}</tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}

function SectionTitle({ title }: { title: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "18px 0 12px" }}>
      <div style={{ width: 9, height: 9, borderRadius: "50%", background: "linear-gradient(135deg,#2f6fed,#10b8d4)", boxShadow: "0 0 0 4px rgba(47,111,237,.10)", flexShrink: 0 }} />
      <h3 style={{ margin: 0, color: "#102f4b", fontSize: 14, fontWeight: 800 }}>{title}</h3>
      <span style={{ height: 1, flex: 1, background: "linear-gradient(90deg,#d6e0ea,transparent)" }} />
    </div>
  );
}

// ── Drill-down drawer ─────────────────────────────────────────────────────────
function RecordDetail({ title, fields }: { title: string; fields: { label: string; value: React.ReactNode }[] }) {
  return (
    <div>
      <p style={{ fontSize: 11, fontWeight: 900, textTransform: "uppercase", letterSpacing: ".4px", color: "#8390a0", margin: "0 0 10px" }}>{title}</p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: "8px 12px" }}>
        {fields.map((f, i) => (
          <div key={i} style={{ background: "#f8fafd", border: "1px solid #e8eef5", borderRadius: 10, padding: "9px 12px", minWidth: 0 }}>
            <div style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: ".4px", fontWeight: 900, color: "#8390a0", marginBottom: 3 }}>{f.label}</div>
            <div style={{ fontSize: 13, fontWeight: 800, color: "#102f4b", overflowWrap: "anywhere" }}>
              {f.value === "" || f.value === null || f.value === undefined ? "—" : f.value}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Fetches and renders the daily trend behind a KPI card. */
function DrillTrendPanel({ trend }: { trend: DrillTrend }) {
  const q = useQuery({
    queryKey: trend.queryKey,
    queryFn: () => fetchLive<unknown>(trend.path, trend.params),
    staleTime: 2 * 60 * 1000,
  });
  if (q.isLoading) return <Spinner />;
  if (q.error || q.data === undefined) return <Err msg="Could not load the trend behind this metric" />;
  const rows = trend.pick ? trend.pick(q.data) : (q.data as Record<string, unknown>[]);
  if (!Array.isArray(rows) || rows.length === 0) {
    return <InfoBox html={trend.emptyHint ?? "No day-wise data for the selected range."} />;
  }
  return <DataTable cols={trend.cols} rows={rows} />;
}

const HOURLY_DRILL_COLS: Col<Record<string, unknown>>[] = [
  { h: "Interval", k: "slot", left: true },
  { h: "Offered", k: "offered" },
  { h: "Answered", k: "handled" },
  { h: "Abandoned", k: "abandoned" },
  { h: "Ans ≤20s", k: "calls20" },
  { h: "SL%", k: "sl", fmt: v => <PctBadge v={Number(v)} /> },
  { h: "AL%", k: "al", fmt: v => <PctBadge v={Number(v)} /> },
  { h: "AHT Sec", k: "ahtSec" },
  { h: "Login HC", k: "loginCount" },
];

/** Hourly breakdown for one day — the drill-down of an Inbound day-wise row. */
function HourlyFetchPanel({ date }: { date: string }) {
  const q = useQuery({
    queryKey: ["pld", "ib", "hourly", date],
    queryFn: () => fetchLive<IBSlotRow[]>("inbound/hourly", { date }),
    staleTime: 2 * 60 * 1000,
    // An unparseable row date must not fall through to the endpoint, which
    // would silently answer for today instead.
    enabled: date !== "",
  });
  if (date === "") return <Err msg="This row has no readable date, so its hourly slots cannot be looked up" />;
  if (q.isLoading) return <Spinner />;
  if (q.error || !q.data) return <Err msg="Could not load the hourly breakdown" />;
  if (q.data.length === 0) return <InfoBox html="No slot activity recorded for this date." />;
  return <DataTable cols={HOURLY_DRILL_COLS} rows={q.data as unknown as Record<string, unknown>[]} />;
}

function LiveDetailContent({ ctx }: { ctx: LiveDrillContext }) {
  if (ctx.type === "hourly") {
    return (
      <div>
        <SectionTitle title="Hourly slot breakdown" />
        <HourlyFetchPanel date={ctx.date} />
      </div>
    );
  }
  if (ctx.type === "record") {
    return <RecordDetail title={ctx.title} fields={ctx.fields} />;
  }
  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 28, fontWeight: 950, color: "#1a3a5c" }}>{ctx.value}</span>
        <span style={{ fontSize: 11, fontWeight: 700, color: "#697586" }}>{ctx.label}</span>
      </div>
      {ctx.sub && <div style={{ fontSize: 11, color: "#8390a0", fontWeight: 700, marginTop: 4 }}>{ctx.sub}</div>}
      {ctx.trend
        ? <><SectionTitle title={ctx.trend.title} /><DrillTrendPanel trend={ctx.trend} /></>
        : <InfoBox html="No day-wise breakdown is available for this metric." />}
    </div>
  );
}

function LiveDetailDrawer({ ctx, processName, onClose }: { ctx: LiveDrillContext | null; processName: string; onClose: () => void }) {
  useEffect(() => {
    if (!ctx) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ctx, onClose]);

  if (!ctx) return null;
  const drawerTitle = ctx.type === "kpi" ? ctx.label : ctx.type === "hourly" ? `Hourly — ${fmtDay(ctx.date)}` : ctx.title;

  return (
    <>
      <div className="dlp-backdrop" onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(10,20,40,.38)", zIndex: 1200 }} />
      <div
        className="dlp-drawer"
        role="dialog" aria-modal="true" aria-label={drawerTitle}
        style={{
          position: "fixed", top: 0, right: 0, bottom: 0, width: "min(640px, 96vw)", background: "#fff",
          boxShadow: "-8px 0 48px rgba(10,20,40,.20)", zIndex: 1201, display: "flex", flexDirection: "column",
        }}
      >
        <div style={{ background: "linear-gradient(135deg,#15365e 0%,#1e4f82 100%)", padding: "16px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexShrink: 0 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: ".45px", color: "rgba(255,255,255,.65)", fontWeight: 900 }}>{processName}</div>
            <div style={{ fontSize: 16, fontWeight: 900, color: "#fff", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{drawerTitle}</div>
          </div>
          <button
            type="button" onClick={onClose} title="Close" aria-label="Close detail"
            style={{ flexShrink: 0, width: 34, height: 34, borderRadius: "50%", border: "1px solid rgba(255,255,255,.28)", background: "rgba(255,255,255,.14)", color: "#fff", cursor: "pointer", fontSize: 18, lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center", transition: ".15s" }}
          >×</button>
        </div>
        {/* Tables inside the drawer are not themselves drillable: replacing the
            drawer's own contents leaves no way back to what was clicked. */}
        <div style={{ flex: 1, overflowY: "auto", padding: "18px 20px" }}>
          <DrillDispatch.Provider value={null}>
            <LiveDetailContent ctx={ctx} />
          </DrillDispatch.Provider>
        </div>
      </div>
    </>
  );
}

const DRILL_STYLES = `
.dlp-clickable-row { cursor: pointer; }
.dlp-clickable-row:hover td { background: #eef4fc !important; }
.dlp-clickable-row:focus-visible td { background: #e3edfb !important; outline: 2px solid #2f6fed; outline-offset: -2px; }
.dlp-kpi-clickable { transition: transform .15s ease, box-shadow .15s ease; }
.dlp-kpi-clickable:hover { transform: translateY(-2px); box-shadow: 0 14px 32px rgba(16,35,57,.18); }
.dlp-kpi-clickable:focus-visible { outline: 3px solid #1a3a5c; outline-offset: 2px; }
.dlp-backdrop { animation: dlp-fade-in .2s ease; }
.dlp-drawer { animation: dlp-slide-right .25s cubic-bezier(.22,.68,0,1.2); }
@keyframes dlp-slide-right { from { transform: translateX(100%); } to { transform: translateX(0); } }
@keyframes dlp-fade-in { from { opacity: 0; } to { opacity: 1; } }
@media (prefers-reduced-motion: reduce) {
  .dlp-kpi-clickable { transition: none; }
  .dlp-kpi-clickable:hover { transform: none; }
  .dlp-backdrop, .dlp-drawer { animation: none; }
}
`;

// ── Date range filter ─────────────────────────────────────────────────────────
function DateRangeFilter({ f, onChange }: { f: Filters; onChange: (f: Filters) => void }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16, padding: "10px 14px", background: "#fff", border: "1px solid #dce4ed", borderRadius: 12 }}>
      <span style={{ fontSize: 11, fontWeight: 800, color: "#697586" }}>Live Dashboard Date Range:</span>
      {(["from", "to"] as const).map(k => (
        <div key={k} style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <label style={{ fontSize: 11, fontWeight: 800, color: "#697586" }}>{k === "from" ? "From" : "To"}</label>
          <input type="date" value={f[k]} onChange={e => onChange({ ...f, [k]: e.target.value })}
            style={{ height: 32, border: "1px solid #dce4ed", borderRadius: 8, padding: "0 8px", fontSize: 12, fontWeight: 700, background: "#f9fbfd", outline: "none" }} />
        </div>
      ))}
    </div>
  );
}

// ── INBOUND DASHBOARD ─────────────────────────────────────────────────────────
type IBSummary = {
  offered: number; handled: number; abandoned: number; abndWithin: number; abndAfter: number;
  calls20: number; sl: number; al: number; ahtSec: number; aht: string;
  handledTalkSec: number; handledAcwSec: number; holdSec: number; holdCount: number;
  talkTime: string; acwTime: string; callDurationSec: number;
  abandonRate: number; within20Rate: number; dailyAverage: number;
  healthScore: number; healthStatus: string; from: string; to: string; generatedAt: string;
};
type IBDayRow = { date: string; offered: number; handled: number; sl: number; al: number; ahtSec: number; talkTime: string; callDurationSec: number };
type IBSlotRow = { slot: string; offered: number; handled: number; abandoned: number; calls20: number; sl: number; al: number; ahtSec: number; avgWrapSec: number; loginCount: number; cpa: number; abndWithin: number; abndAfter: number; handledTalkSec: number; holdSec: number; repeatCalls: number; repeatPct: number };
type IBAgentRow = { agentName: string; offered: number; handled: number; calls20: number; talk: string; sl: number; al: number; aht: string; aprCalls: number; netLoginTime: string; utilization: number; waitTime: string; aprTalkTime: string; pauseTime: string; lbTime: string; tbTime: string; wbTime: string };
type IBDispoData = { totals: { complaint: number; query: number; request: number; sales: number; other: number; total: number }; daily: Record<string, unknown>[]; subDisposition: { scenario: string; subDisposition: string; count: number }[]; rowCount: number };
type IBRepeatData = { daily: { date: string; total: number; unique: number; repeat: number; repeatPct: number }[]; agents: { agentName: string; total: number; unique: number; repeat: number; repeatPct: number }[]; totals: { total: number; unique: number; repeat: number; repeatPct: number } };
type IBMonthRow = { month: string; offered: number; handled: number; sl: number; al: number; ahtSec: number; talkTime: string; callDurationSec: number };

type IBSub = "overview" | "monthly" | "daily" | "hourly" | "agents" | "apr" | "disposition";

const KPIG = ["linear-gradient(135deg,#334155,#475569)","linear-gradient(135deg,#047857,#10b981)","linear-gradient(135deg,#be123c,#f43f5e)","linear-gradient(135deg,#6d28d9,#8b5cf6)","linear-gradient(135deg,#0369a1,#06b6d4)","linear-gradient(135deg,#b45309,#f59e0b)","linear-gradient(135deg,#065f46,#059669)","linear-gradient(135deg,#831843,#db2777)","linear-gradient(135deg,#1e3a5f,#2f6fed)","linear-gradient(135deg,#4c1d95,#7c5ce5)","linear-gradient(135deg,#1e293b,#334155)","linear-gradient(135deg,#0f766e,#0f9f8f)"];

function HealthRing({ score, status }: { score: number; status: string }) {
  const color = score >= 90 ? "#45d49a" : score >= 75 ? "#f2b54b" : "#f06b70";
  const r = 40, circ = 2 * Math.PI * r, dash = (score / 100) * circ;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 5 }}>
      <svg width={96} height={96} viewBox="0 0 96 96">
        <circle cx={48} cy={48} r={r} fill="none" stroke="rgba(255,255,255,.15)" strokeWidth={10} />
        <circle cx={48} cy={48} r={r} fill="none" stroke={color} strokeWidth={10} strokeDasharray={`${dash} ${circ}`} strokeLinecap="round" transform="rotate(-90 48 48)" />
        <text x={48} y={50} textAnchor="middle" dominantBaseline="middle" fontSize={17} fontWeight={900} fill="#fff">{score}%</text>
      </svg>
      <div style={{ fontSize: 10, fontWeight: 900, color, background: "rgba(255,255,255,.12)", borderRadius: 20, padding: "2px 9px" }}>{status}</div>
    </div>
  );
}

/** Day-wise trend behind every Inbound overview KPI card. */
const ibDailyTrend = (f: Filters): DrillTrend => ({
  title: "Day-wise trend",
  queryKey: ["pld", "ib", "daily", f],
  path: "inbound/daily",
  params: { from: f.from, to: f.to },
  emptyHint: "No inbound call activity in the selected range.",
  cols: [
    { h: "Date", k: "date", left: true, fmt: fmtDay },
    { h: "Offered", k: "offered" },
    { h: "Answered", k: "handled" },
    { h: "SL%", k: "sl", fmt: v => <PctBadge v={Number(v)} /> },
    { h: "AL%", k: "al", fmt: v => <PctBadge v={Number(v)} /> },
    { h: "AHT Sec", k: "ahtSec" },
    { h: "Talk Time", k: "talkTime" },
  ],
});

/** Day-wise disposition split behind the Inbound disposition KPI cards. */
const ibDispositionTrend = (f: Filters): DrillTrend => ({
  title: "Day-wise disposition split",
  queryKey: ["pld", "ib", "dispo", f],
  path: "inbound/disposition",
  params: { from: f.from, to: f.to },
  pick: raw => (raw as IBDispoData).daily,
  emptyHint: "No dispositions logged in the selected range.",
  cols: [
    { h: "Date", k: "date", left: true, fmt: fmtDay },
    { h: "Complaint", k: "complaint" }, { h: "Query", k: "query" },
    { h: "Request", k: "request" }, { h: "Sales", k: "sales" }, { h: "Other", k: "other" },
  ],
});

/** Day-wise repeat-caller contribution behind the Inbound repeat KPI cards. */
const ibRepeatTrend = (f: Filters): DrillTrend => ({
  title: "Day-wise repeat contribution",
  queryKey: ["pld", "ib", "repeat", f],
  path: "inbound/repeat",
  params: { from: f.from, to: f.to },
  pick: raw => (raw as IBRepeatData).daily as unknown as Record<string, unknown>[],
  emptyHint: "No repeat-caller activity in the selected range.",
  cols: [
    { h: "Date", k: "date", left: true, fmt: fmtDay },
    { h: "Total", k: "total" }, { h: "Unique", k: "unique" }, { h: "Repeat", k: "repeat" },
    { h: "Repeat %", k: "repeatPct", fmt: v => <PctBadge v={Number(v)} /> },
  ],
});

function InboundDashboard({ f }: { f: Filters }) {
  const [sub, setSub] = useState<IBSub>("overview");
  const [hDate, setHDate] = useState(todayStr());
  const drill = useDrill();
  const fmtD = fmtDay;

  const summQ = useQuery({ queryKey: ["pld", "ib", "summary", f], queryFn: () => fetchLive<IBSummary>("inbound/summary", { from: f.from, to: f.to }), staleTime: 2 * 60 * 1000 });
  const monthQ = useQuery({ queryKey: ["pld", "ib", "monthly", f], queryFn: () => fetchLive<IBMonthRow[]>("inbound/monthly", { from: f.from, to: f.to }), staleTime: 2 * 60 * 1000, enabled: sub === "monthly" });
  const dayQ = useQuery({ queryKey: ["pld", "ib", "daily", f], queryFn: () => fetchLive<IBDayRow[]>("inbound/daily", { from: f.from, to: f.to }), staleTime: 2 * 60 * 1000, enabled: sub === "daily" });
  const slotQ = useQuery({ queryKey: ["pld", "ib", "hourly", hDate], queryFn: () => fetchLive<IBSlotRow[]>("inbound/hourly", { date: hDate }), staleTime: 2 * 60 * 1000, enabled: sub === "hourly" });
  const agentQ = useQuery({ queryKey: ["pld", "ib", "agents", f], queryFn: () => fetchLive<IBAgentRow[]>("inbound/agents", { from: f.from, to: f.to }), staleTime: 2 * 60 * 1000, enabled: sub === "agents" });
  const aprQ = useQuery({ queryKey: ["pld", "ib", "apr", f], queryFn: () => fetchLive<{ user: string; agentName: string | null; aprCalls: number; netLoginTime: string; talk: string; wait: string; dispo: string; pause: string; lbTime: string; tbTime: string; wbTime: string; utilization: number }[]>("inbound/apr", { from: f.from, to: f.to }), staleTime: 2 * 60 * 1000, enabled: sub === "apr" });
  const dispoQ = useQuery({ queryKey: ["pld", "ib", "dispo", f], queryFn: () => fetchLive<IBDispoData>("inbound/disposition", { from: f.from, to: f.to }), staleTime: 2 * 60 * 1000, enabled: sub === "disposition" });
  const repeatQ = useQuery({ queryKey: ["pld", "ib", "repeat", f], queryFn: () => fetchLive<IBRepeatData>("inbound/repeat", { from: f.from, to: f.to }), staleTime: 2 * 60 * 1000, enabled: sub === "disposition" });

  const subs: { key: IBSub; label: string }[] = [
    { key: "overview", label: "Overview" }, { key: "monthly", label: "Monthly" }, { key: "daily", label: "Day-wise" },
    { key: "hourly", label: "Hourly Slots" }, { key: "agents", label: "Agents (CDR+APR)" }, { key: "apr", label: "APR" }, { key: "disposition", label: "Disposition" },
  ];

  return (
    <div>
      <div style={{ display: "flex", gap: 4, marginBottom: 14, flexWrap: "wrap" }}>
        {subs.map(s => (
          <button key={s.key} onClick={() => setSub(s.key)} style={{ height: 30, border: "none", borderRadius: 8, padding: "0 12px", fontSize: 12, fontWeight: 800, cursor: "pointer", transition: ".15s", background: sub === s.key ? "linear-gradient(135deg,#153f69,#2673a0)" : "#edf3f9", color: sub === s.key ? "#fff" : "#334155" }}>{s.label}</button>
        ))}
      </div>

      {/* OVERVIEW */}
      {sub === "overview" && (
        summQ.isLoading ? <Spinner /> : summQ.error || !summQ.data ? <Err msg="Failed to load summary" /> : (() => {
          const d = summQ.data;
          const kpis = [
            ["Call Offered", d.offered.toLocaleString(), `Daily avg: ${d.dailyAverage}`],
            ["Call Answered", d.handled.toLocaleString(), `AL: ${d.al.toFixed(1)}%`],
            ["Ans Within 20 Sec", d.calls20.toLocaleString(), "Speed of answer"],
            ["Total Abandoned", d.abandoned.toLocaleString(), `${d.abandonRate.toFixed(1)}% abandon rate`],
            ["Abandon Within 20s", d.abndWithin.toLocaleString(), "Early disconnects"],
            ["Abandon After Threshold", d.abndAfter.toLocaleString(), "Long-wait risk"],
            ["Talk Time", d.talkTime, "Total connected time"],
            [`SL% (20 Sec)`, `${d.sl.toFixed(1)}%`, "Target ≥ 80%"],
            [`AL%`, `${d.al.toFixed(1)}%`, "Target ≥ 80%"],
            ["AHT (Sec)", d.ahtSec.toFixed(0), "Average handle time"],
            ["Call Duration / Offered", d.callDurationSec.toFixed(2), "Avg talk sec per call"],
            ["ACW Duration", d.acwTime, "After-call work"],
          ];
          return (
            <div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(6,minmax(0,1fr))", gap: 10, marginBottom: 16 }}>
                {kpis.map(([label, value, sub], i) => (
                  <KpiCard key={i} label={label} value={value} sub={sub}
                    color={i === 7 ? (d.sl >= 80 ? KPIG[1] : KPIG[2]) : i === 8 ? (d.al >= 80 ? KPIG[1] : KPIG[2]) : KPIG[i % KPIG.length]}
                    onClick={drill ? () => drill({ type: "kpi", label, value, sub, trend: ibDailyTrend(f) }) : undefined} />
                ))}
              </div>
              {/* Executive brief */}
              <div style={{ background: "radial-gradient(circle at 92% 18%,rgba(40,202,193,.20),transparent 28%),linear-gradient(132deg,#0a2848 0%,#124c72 61%,#176f81 100%)", borderRadius: 18, padding: "16px 20px", marginBottom: 14, color: "#fff", display: "grid", gridTemplateColumns: "auto 1fr", gap: 20, alignItems: "start" }}>
                <HealthRing score={d.healthScore} status={d.healthStatus} />
                <div>
                  <div style={{ fontSize: 15, fontWeight: 900, marginBottom: 8 }}>Executive Brief — {f.from} to {f.to}</div>
                  <div style={{ fontSize: 12, color: "#d8e9ff", lineHeight: 1.6, marginBottom: 10 }}>
                    {d.offered > 0 ? `${d.handled.toLocaleString()} of ${d.offered.toLocaleString()} offered calls answered. SL: ${d.sl.toFixed(1)}%, AL: ${d.al.toFixed(1)}%, Abandonment: ${d.abandonRate.toFixed(1)}%.` : "No call volume for the selected range."}
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 8 }}>
                    {[{ name: "Answer Rate", value: `${d.al.toFixed(1)}%`, note: "Answered / offered" }, { name: "Within 20 Sec", value: `${d.within20Rate.toFixed(1)}%`, note: "Of answered calls" }, { name: "Abandon Rate", value: `${d.abandonRate.toFixed(1)}%`, note: "Target ≤ 5%" }, { name: "Daily Average", value: Math.round(d.dailyAverage).toLocaleString(), note: "Calls per active day" }].map((s, i) => (
                      <div key={i} style={{ background: "rgba(255,255,255,.09)", borderRadius: 10, padding: "9px 11px" }}>
                        <div style={{ fontSize: 9, color: "#a8c8e8", fontWeight: 800 }}>{s.name}</div>
                        <div style={{ fontSize: 17, fontWeight: 900, marginTop: 3 }}>{s.value}</div>
                        <div style={{ fontSize: 9, color: "#a8c8e8", marginTop: 2 }}>{s.note}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                <Panel title="Call Volume Breakdown">
                  <ResponsiveContainer width="100%" height={200}><BarChart data={[{ name: "Handled", value: d.handled }, { name: "Abnd>20s", value: d.abndAfter }, { name: "Abnd≤20s", value: d.abndWithin }]}><CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" /><XAxis dataKey="name" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} /><Tooltip /><Bar dataKey="value" radius={[5, 5, 0, 0]}><Cell fill="#10b981" /><Cell fill="#f59e0b" /><Cell fill="#ef4444" /></Bar></BarChart></ResponsiveContainer>
                </Panel>
                <Panel title="Time Breakdown (Handled calls, duration)">
                  <ResponsiveContainer width="100%" height={200}><BarChart data={[{ name: "Talk", value: d.handledTalkSec ?? 0 }, { name: "Hold", value: d.holdSec ?? 0 }, { name: "ACW", value: d.handledAcwSec ?? 0 }]}><CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" /><XAxis dataKey="name" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} tickFormatter={fmtSecAxis} /><Tooltip formatter={(v: number) => [fmtSecShort(v), "Duration"]} /><Bar dataKey="value" fill="#2f6fed" radius={[5, 5, 0, 0]} /></BarChart></ResponsiveContainer>
                </Panel>
              </div>
            </div>
          );
        })()
      )}

      {/* MONTHLY */}
      {sub === "monthly" && (
        monthQ.isLoading ? <Spinner /> : monthQ.error || !monthQ.data ? <Err msg="Failed to load monthly data" /> : (
          <div>
            <Panel title="SL% & AL% Monthly Trend">
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={monthQ.data} margin={{ top: 22, right: 18, left: 0, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} />
                  <Tooltip formatter={(v: unknown, name: unknown) => [`${Number(v).toFixed(1)}%`, String(name)]} />
                  <Legend verticalAlign="top" height={24} iconType="plainline" wrapperStyle={{ fontSize: 11, fontWeight: 800 }} />
                  {/* SL% and AL% sit within a point or two of each other, so a
                      second colour alone reads as one line — AL% is dashed with
                      hollow dots to stay separable where they overlap. */}
                  <Line type="monotone" dataKey="sl" stroke="#2f6fed" strokeWidth={2.5} name="SL%" dot={{ r: 3, fill: "#2f6fed" }}>
                    <LabelList dataKey="sl" position="top" offset={8} formatter={PCT_LABEL} style={LABEL_STYLE_BLUE} />
                  </Line>
                  <Line type="monotone" dataKey="al" stroke="#e07b1a" strokeWidth={2.5} strokeDasharray="6 4" name="AL%" dot={{ r: 3, fill: "#fff", stroke: "#e07b1a", strokeWidth: 2 }}>
                    <LabelList dataKey="al" position="bottom" offset={8} formatter={PCT_LABEL} style={LABEL_STYLE_ORANGE} />
                  </Line>
                </LineChart>
              </ResponsiveContainer>
            </Panel>
            <div style={{ marginTop: 14 }}>
              <Panel title="Monthly Metric Matrix">
                <DataTable<IBMonthRow> cols={[
                  { h: "Month", k: "month", left: true }, { h: "Offered", k: "offered" }, { h: "Answered", k: "handled" },
                  { h: "SL%", k: "sl", fmt: v => <PctBadge v={Number(v)} /> }, { h: "AL%", k: "al", fmt: v => <PctBadge v={Number(v)} /> },
                  { h: "AHT Sec", k: "ahtSec" }, { h: "Talk Time", k: "talkTime" }, { h: "Call Dur/Offered", k: "callDurationSec" },
                ]} rows={monthQ.data} />
              </Panel>
            </div>
          </div>
        )
      )}

      {/* DAY-WISE */}
      {sub === "daily" && (
        dayQ.isLoading ? <Spinner /> : dayQ.error || !dayQ.data ? <Err msg="Failed to load daily data" /> : (
          <div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
              <Panel title="Daily SL% & AL% Trend">
                <ResponsiveContainer width="100%" height={240}>
                  <LineChart data={dayQ.data} margin={{ top: 22, right: 14, left: 0, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="date" tick={{ fontSize: 9 }} tickFormatter={fmtD} />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} />
                    <Tooltip labelFormatter={fmtD} formatter={(v: unknown, name: unknown) => [`${Number(v).toFixed(1)}%`, String(name)]} />
                    <Legend verticalAlign="top" height={24} iconType="plainline" wrapperStyle={{ fontSize: 11, fontWeight: 800 }} />
                    <Line type="monotone" dataKey="sl" stroke="#2f6fed" strokeWidth={2.5} name="SL%" dot={{ r: 2.5, fill: "#2f6fed" }}>
                      <LabelList dataKey="sl" position="top" offset={7} formatter={PCT_LABEL} style={LABEL_STYLE_BLUE} />
                    </Line>
                    <Line type="monotone" dataKey="al" stroke="#e07b1a" strokeWidth={2.5} strokeDasharray="6 4" name="AL%" dot={{ r: 2.5, fill: "#fff", stroke: "#e07b1a", strokeWidth: 2 }}>
                      <LabelList dataKey="al" position="bottom" offset={7} formatter={PCT_LABEL} style={LABEL_STYLE_ORANGE} />
                    </Line>
                  </LineChart>
                </ResponsiveContainer>
              </Panel>
              <Panel title="Daily Call Volume">
                <ResponsiveContainer width="100%" height={200}><BarChart data={dayQ.data}><CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" /><XAxis dataKey="date" tick={{ fontSize: 9 }} tickFormatter={fmtD} /><YAxis tick={{ fontSize: 10 }} /><Tooltip labelFormatter={fmtD} /><Bar dataKey="offered" fill="#93c5fd" name="Offered"><LabelList dataKey="offered" position="top" style={{ fontSize: 8, fill: "#64748b" }} /></Bar><Bar dataKey="handled" fill="#2f6fed" name="Handled"><LabelList dataKey="handled" position="top" style={{ fontSize: 8, fill: "#1e40af" }} /></Bar></BarChart></ResponsiveContainer>
              </Panel>
            </div>
            <Panel title="Day-wise Metric Matrix" sub={`${dayQ.data.length} days — click a day for its hourly slots`}>
              <DataTable<IBDayRow> cols={[
                { h: "Date", k: "date", left: true, fmt: fmtD }, { h: "Offered", k: "offered" }, { h: "Answered", k: "handled" },
                { h: "SL%", k: "sl", fmt: v => <PctBadge v={Number(v)} /> }, { h: "AL%", k: "al", fmt: v => <PctBadge v={Number(v)} /> },
                { h: "AHT Sec", k: "ahtSec" }, { h: "Talk Time", k: "talkTime" }, { h: "Call Dur/Offered", k: "callDurationSec" },
              ]} rows={dayQ.data}
                onRowClick={drill ? row => drill({ type: "hourly", date: dateParam(row.date) }) : undefined} />
            </Panel>
          </div>
        )
      )}

      {/* HOURLY */}
      {sub === "hourly" && (
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
            <label style={{ fontSize: 12, fontWeight: 800, color: "#172235" }}>Date:</label>
            <input type="date" value={hDate} onChange={e => setHDate(e.target.value)} style={{ height: 34, border: "1px solid #dce4ed", borderRadius: 8, padding: "0 10px", fontSize: 12, fontWeight: 700, background: "#f9fbfd", outline: "none" }} />
          </div>
          {slotQ.isLoading ? <Spinner /> : slotQ.error || !slotQ.data ? <Err msg="Failed to load slot data" /> : (
            <Panel title="Slot Performance Table (all 18 GAS columns)" sub={`${slotQ.data.length} slots`}>
              <DataTable<IBSlotRow> cols={[
                { h: "Interval", k: "slot", left: true }, { h: "Offered", k: "offered" }, { h: "Answered", k: "handled" }, { h: "Abandoned", k: "abandoned" },
                { h: "Ans ≤20s", k: "calls20" }, { h: "SL%", k: "sl", fmt: v => <PctBadge v={Number(v)} /> }, { h: "AL%", k: "al", fmt: v => <PctBadge v={Number(v)} /> },
                { h: "AHT Sec", k: "ahtSec" }, { h: "WT Sec", k: "avgWrapSec" }, { h: "Login HC", k: "loginCount" }, { h: "CPA", k: "cpa" },
                { h: "Abnd ≤20s", k: "abndWithin" }, { h: "Abnd >20s", k: "abndAfter" },
                { h: "Talk Time", k: "handledTalkSec", fmt: v => fmtSecShort(Number(v)) }, { h: "Hold Time", k: "holdSec", fmt: v => fmtSecShort(Number(v)) },
                { h: "Repeat", k: "repeatCalls" }, { h: "Repeat %", k: "repeatPct", fmt: v => `${Number(v).toFixed(1)}%` },
              ]} rows={slotQ.data} />
            </Panel>
          )}
        </div>
      )}

      {/* AGENTS */}
      {sub === "agents" && (
        agentQ.isLoading ? <Spinner /> : agentQ.error || !agentQ.data ? <Err msg="Failed to load agent data" /> : (
          <Panel title="Agent-wise Performance — CDR + APR Merged (17 columns)" sub={`${agentQ.data.length} agents`}>
            <DataTable<IBAgentRow> cols={[
              { h: "Agent Name", k: "agentName", left: true }, { h: "Call Offered", k: "offered" }, { h: "Handled", k: "handled" }, { h: "Calls Ans ≤20s", k: "calls20" },
              { h: "CDR Talk", k: "talk" }, { h: "SL%", k: "sl", fmt: v => <PctBadge v={Number(v)} /> }, { h: "AL%", k: "al", fmt: v => <PctBadge v={Number(v)} /> }, { h: "AHT", k: "aht" },
              { h: "APR Calls", k: "aprCalls" }, { h: "Net Login", k: "netLoginTime" }, { h: "Utilization", k: "utilization", fmt: v => <PctBadge v={Number(v)} /> },
              { h: "Wait", k: "waitTime" }, { h: "APR Talk", k: "aprTalkTime" }, { h: "Pause", k: "pauseTime" }, { h: "LB", k: "lbTime" }, { h: "TB", k: "tbTime" }, { h: "WB", k: "wbTime" },
            ]} rows={agentQ.data} />
          </Panel>
        )
      )}

      {/* APR */}
      {sub === "apr" && (
        aprQ.isLoading ? <Spinner /> : aprQ.error || !aprQ.data ? <Err msg="Failed to load APR" /> : (
          <Panel title="Agent Productivity Report (APR)" sub={`${aprQ.data.length} agents`}>
            <DataTable cols={[
              nameCol("agentName"),
              { h: "Agent ID", k: "user" as const, left: true }, { h: "APR Calls", k: "aprCalls" as const }, { h: "Net Login", k: "netLoginTime" as const },
              { h: "Talk", k: "talk" as const }, { h: "Wait", k: "wait" as const }, { h: "Dispo", k: "dispo" as const }, { h: "Pause", k: "pause" as const },
              { h: "LB", k: "lbTime" as const }, { h: "TB", k: "tbTime" as const }, { h: "WB", k: "wbTime" as const },
              { h: "Utilization", k: "utilization" as const, fmt: (v: unknown) => <PctBadge v={Number(v)} /> },
            ]} rows={aprQ.data} />
          </Panel>
        )
      )}

      {/* DISPOSITION */}
      {sub === "disposition" && (
        dispoQ.isLoading ? <Spinner /> : dispoQ.error || !dispoQ.data ? <Err msg="Failed to load disposition" /> : (() => {
          const t = dispoQ.data.totals;
          const sc = [["complaint", "#e5484d"], ["query", "#2f6fed"], ["request", "#18a866"], ["sales", "#e89b19"], ["other", "#7c5ce5"]] as const;
          return (
            <div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(5,minmax(0,1fr))", gap: 10, marginBottom: 14 }}>
                {sc.map(([k, color]) => {
                  const label = k.charAt(0).toUpperCase() + k.slice(1);
                  const value = ((t as Record<string, number>)[k] ?? 0).toLocaleString();
                  const subText = t.total > 0 ? `${(((t as Record<string, number>)[k] ?? 0) / t.total * 100).toFixed(1)}% of total` : "";
                  return <KpiCard key={k} label={label} value={value} sub={subText} color={color}
                    onClick={drill ? () => drill({ type: "kpi", label, value, sub: subText, trend: ibDispositionTrend(f) }) : undefined} />;
                })}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
                {sc.slice(0, 4).map(([k, color]) => (
                  <Panel key={k} title={`Day-wise ${k.charAt(0).toUpperCase() + k.slice(1)}`}>
                    <ResponsiveContainer width="100%" height={180}>
                      <BarChart data={dispoQ.data.daily} margin={{ top: 16, right: 6, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                        <XAxis dataKey="date" tick={{ fontSize: 9 }} tickFormatter={fmtD} />
                        <YAxis tick={{ fontSize: 9 }} />
                        <Tooltip labelFormatter={fmtD} />
                        <Bar dataKey={k} fill={color} radius={[3, 3, 0, 0]}>
                          <LabelList dataKey={k} position="top" style={{ fontSize: 9, fontWeight: 800, fill: "#334155" }} />
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </Panel>
                ))}
              </div>
              <SectionTitle title="Sub-Disposition Breakdown (Category2)" />
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 14, marginBottom: 14 }}>
                {["complaint", "query", "request", "sales"].map(k => {
                  const rows = dispoQ.data.subDisposition.filter(r => r.scenario === k);
                  return (
                    <Panel key={k} title={k.charAt(0).toUpperCase() + k.slice(1)} sub={`${rows.length} sub-types`}>
                      <DataTable cols={[{ h: "Sub Disposition", k: "subDisposition" as const, left: true }, { h: "Count", k: "count" as const }]} rows={rows} />
                    </Panel>
                  );
                })}
              </div>
              {repeatQ.data && (
                <>
                  <SectionTitle title="Repeat Analysis (Phone-based)" />
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 10, marginBottom: 14 }}>
                    {([{ label: "Total Handled", value: repeatQ.data.totals.total.toLocaleString(), color: KPIG[0] }, { label: "Unique Callers", value: repeatQ.data.totals.unique.toLocaleString(), color: KPIG[1] }, { label: "Repeat Calls", value: repeatQ.data.totals.repeat.toLocaleString(), color: KPIG[2] }, { label: "Repeat %", value: `${repeatQ.data.totals.repeatPct.toFixed(1)}%`, color: KPIG[6] }] as KpiSpec[]).map((k, i) => <KpiCard key={i} {...k} onClick={drill ? () => drill({ type: "kpi", label: k.label, value: k.value, trend: ibRepeatTrend(f) }) : undefined} />)}
                  </div>
                  <Panel title="Daily Repeat Contribution">
                    <ResponsiveContainer width="100%" height={200}><AreaChart data={repeatQ.data.daily}><CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" /><XAxis dataKey="date" tick={{ fontSize: 9 }} tickFormatter={fmtD} /><YAxis tick={{ fontSize: 9 }} /><Tooltip labelFormatter={fmtD} /><Area type="monotone" dataKey="total" stroke="#93c5fd" fill="#dbeafe" name="Total" /><Area type="monotone" dataKey="repeat" stroke="#e5484d" fill="#fee2e2" name="Repeat" /></AreaChart></ResponsiveContainer>
                  </Panel>
                </>
              )}
            </div>
          );
        })()
      )}
    </div>
  );
}

// ── REGINALD CART DASHBOARD ───────────────────────────────────────────────────
type CartSummaryT = { offered: number; connected: number; abandoned: number; uniqueDialed: number; uniqueConnected: number; connectPct: number; talk: string; avgTalk: string; aht: string; avgWrap: string; loginCount: number; lt30: number; ge30: number; generatedAt: string; byCampaign: { campaign: string; offered: number; connected: number; uniqueDialed: number; uniqueConnected: number; connectPct: number; avgTalk: string }[] };
type CartDayT = { date: string; totalDialed: number; uniqueDialed: number; uniqueConnected: number; connectPct: number; loginCount: number; avgTalk: string; aht: string; avgWrap: string; avgIdle: string };
type CartAnalystT = { analyst: string; analystName: string | null; loginDays: number; totalDialed: number; uniqueDialed: number; uniqueConnected: number; connectPct: number; lt30: number; ge30: number; avgTalk: string; aht: string; avgWrap: string; avgWait: string; netLoginTime: string; utilization: number };

type CartSub = "sales" | "overview" | "monthly" | "daily" | "analysts" | "apr" | "email-apr";

interface CartSalesT {
  from: string; to: string;
  orders: number; revenue: number; aov: number;
  prepaid: number; cod: number; prepaidPct: number; codPct: number;
  byAgent: { empId: string; agentName: string; orders: number; revenue: number; aov: number }[];
  daily: { date: string; orders: number; revenue: number; aov: number; prepaid: number; cod: number; prepaidPct: number; codPct: number }[];
}

/** Day-wise CDR trend behind the Reginald Cart overview KPI cards. */
const cartDailyTrend = (f: Filters): DrillTrend => ({
  title: "Day-wise trend",
  queryKey: ["pld", "cart", "daily", f],
  path: "reginald-cart/daily",
  params: { from: f.from, to: f.to },
  emptyHint: "No dialler activity in the selected range.",
  cols: [
    { h: "Date", k: "date", left: true, fmt: fmtDay },
    { h: "Total CDR", k: "totalDialed" },
    { h: "Unique Dialled", k: "uniqueDialed" },
    { h: "Unique Connected", k: "uniqueConnected" },
    { h: "Connect%", k: "connectPct", fmt: v => <PctBadge v={Number(v)} /> },
    { h: "Avg Talk", k: "avgTalk" },
    { h: "AHT", k: "aht" },
  ],
});

/** Day-wise sales trend behind the Reginald Cart sales KPI cards. */
const cartSalesTrend = (f: Filters, fmtRs: (v: number) => string): DrillTrend => ({
  title: "Day-wise sales",
  queryKey: ["pld", "cart", "sales", f],
  path: "reginald-cart/sales",
  params: { from: f.from, to: f.to },
  pick: raw => (raw as CartSalesT).daily as unknown as Record<string, unknown>[],
  emptyHint: "No orders recorded in the selected range.",
  cols: [
    { h: "Date", k: "date", left: true, fmt: fmtDay },
    { h: "Orders", k: "orders" },
    { h: "Revenue", k: "revenue", fmt: v => fmtRs(Number(v)) },
    { h: "AOV", k: "aov", fmt: v => fmtRs(Number(v)) },
    { h: "Prepaid", k: "prepaid" },
    { h: "COD", k: "cod" },
  ],
});

/** Day-wise APR trend behind the email-APR KPI cards (Molecular + Reginald Email). */
const emailDailyTrend = (proc: "molecular-email" | "reginald-email" | "finnable", f: Filters): DrillTrend => ({
  title: "Day-wise APR",
  queryKey: ["pld", proc, "daily", f],
  path: `${proc}/daily`,
  params: { from: f.from, to: f.to },
  emptyHint: "No agent activity logged in the selected range.",
  cols: [
    { h: "Date", k: "date", left: true, fmt: fmtDay },
    { h: "Login Time", k: "loginTime" },
    { h: "Talk", k: "talk" },
    { h: "Wait", k: "wait" },
    { h: "Pause", k: "pause" },
    { h: "Agents", k: "agentCount" },
    { h: "Utilization", k: "utilization", fmt: v => <PctBadge v={Number(v)} /> },
  ],
});

// ── Reginald All Dashboard — Cart + Molecular Email + Reginald Email in one place ──
type ReginaldTab = "cart" | "molecular" | "email";
function ReginaldAllDashboard({ f }: { f: Filters }) {
  const [tab, setTab] = useState<ReginaldTab>("cart");
  const TABS: { key: ReginaldTab; label: string; badge?: string }[] = [
    { key: "cart",     label: "Abandoned Cart" },
    { key: "molecular", label: "Molecular Email", badge: "APR" },
    { key: "email",    label: "Reginald Email",   badge: "APR" },
  ];
  return (
    <div>
      <div style={{ display: "flex", gap: 4, marginBottom: 12, background: "rgba(255,255,255,.06)", borderRadius: 10, padding: 4, width: "fit-content" }}>
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} style={{
            cursor: "pointer", borderRadius: 8, padding: "6px 14px", fontSize: 11, fontWeight: 900, border: 0,
            transition: "background .15s,color .15s",
            background: tab === t.key ? "#fff" : "transparent",
            color: tab === t.key ? "#1a3a5c" : "#9cb8d4",
            boxShadow: tab === t.key ? "0 3px 8px rgba(0,0,0,.15)" : "none",
          }}>
            {t.label}
            {t.badge && <span style={{ marginLeft: 5, fontSize: 9, fontWeight: 800, background: tab === t.key ? "#e0edff" : "rgba(255,255,255,.12)", color: tab === t.key ? "#2f6fed" : "#9cb8d4", borderRadius: 4, padding: "1px 5px" }}>{t.badge}</span>}
          </button>
        ))}
      </div>
      {tab === "cart"      && <CartDashboard f={f} />}
      {tab === "molecular" && <EmailAprDashboard proc="molecular-email" label="Molecular Email" campaign="MOEMAIL" f={f} />}
      {tab === "email"     && <EmailAprDashboard proc="reginald-email"  label="Reginald Email"  campaign="EMAIL"   f={f} />}
    </div>
  );
}

function CartDashboard({ f }: { f: Filters }) {
  const [sub, setSub] = useState<CartSub>("sales");
  const drill = useDrill();
  const fmtD = fmtDay;
  const summQ = useQuery({ queryKey: ["pld", "cart", "summary", f], queryFn: () => fetchLive<CartSummaryT>("reginald-cart/summary", { from: f.from, to: f.to }), staleTime: 2 * 60 * 1000 });
  const dayQ = useQuery({ queryKey: ["pld", "cart", "daily", f], queryFn: () => fetchLive<CartDayT[]>("reginald-cart/daily", { from: f.from, to: f.to }), staleTime: 2 * 60 * 1000, enabled: sub === "daily" });
  const monthFrom = monthlyFrom(f);
  const monthQ = useQuery({ queryKey: ["pld", "cart", "monthly", monthFrom, f.to], queryFn: () => fetchLive<{ month: string; monthLabel: string; totalDialed: number; uniqueDialed: number; uniqueConnected: number; connectPct: number; loginCount: number; avgTalk: string; aht: string; avgWrap: string }[]>("reginald-cart/monthly", { from: monthFrom, to: f.to }), staleTime: 2 * 60 * 1000, enabled: sub === "monthly" });
  const analystQ = useQuery({ queryKey: ["pld", "cart", "analysts", f], queryFn: () => fetchLive<CartAnalystT[]>("reginald-cart/analysts", { from: f.from, to: f.to }), staleTime: 2 * 60 * 1000, enabled: sub === "analysts" });
  const aprQ = useQuery({ queryKey: ["pld", "cart", "apr", f], queryFn: () => fetchLive<{ user: string; agentName: string | null; aprCalls: number; netLoginTime: string; talk: string; wait: string; dispo: string; pause: string; lbTime: string; tbTime: string; wbTime: string; mbTime: string; qbTime: string; utilization: number }[]>("reginald-cart/apr", { from: f.from, to: f.to }), staleTime: 2 * 60 * 1000, enabled: sub === "apr" });
  const salesQ = useQuery({ queryKey: ["pld", "cart", "sales", f], queryFn: () => fetchLive<CartSalesT>("reginald-cart/sales", { from: f.from, to: f.to }), staleTime: 2 * 60 * 1000, enabled: sub === "sales" });
  const emailAprSummQ = useQuery({ queryKey: ["pld", "reginald-email", "summary", f], queryFn: () => fetchLive<{ totalLoginTime: string; totalTalk: string; totalPause: string; totalLbTime: string; totalTbTime: string; avgUtilization: number; agentCount: number }>("reginald-email/summary", { from: f.from, to: f.to }), staleTime: 2 * 60 * 1000, enabled: sub === "email-apr" });
  const emailAprAgentsQ = useQuery({ queryKey: ["pld", "reginald-email", "agents", f], queryFn: () => fetchLive<EmailAprAgentRow[]>("reginald-email/agents", { from: f.from, to: f.to }), staleTime: 2 * 60 * 1000, enabled: sub === "email-apr" });

  const subs: { key: CartSub; label: string }[] = [{ key: "sales", label: "Sales" }, { key: "overview", label: "CDR Overview" }, { key: "monthly", label: "Monthly" }, { key: "daily", label: "Day-wise" }, { key: "analysts", label: "Analysts" }, { key: "apr", label: "Cart APR" }, { key: "email-apr", label: "Email APR" }];

  return (
    <div>
      <div style={{ display: "flex", gap: 4, marginBottom: 14, flexWrap: "wrap" }}>
        {subs.map(s => <button key={s.key} onClick={() => setSub(s.key)} style={{ height: 30, border: "none", borderRadius: 8, padding: "0 12px", fontSize: 12, fontWeight: 800, cursor: "pointer", transition: ".15s", background: sub === s.key ? "linear-gradient(135deg,#153f69,#2673a0)" : "#edf3f9", color: sub === s.key ? "#fff" : "#334155" }}>{s.label}</button>)}
      </div>
      {sub === "overview" && (summQ.isLoading ? <Spinner /> : summQ.error || !summQ.data ? <Err msg="Failed to load summary" /> : (() => {
        const d = summQ.data;
        const kpis = [{ label: "Total Dialled", value: d.offered.toLocaleString(), sub: `${f.from} – ${f.to}`, color: KPIG[0] }, { label: "Connected", value: d.connected.toLocaleString(), sub: `Connect: ${d.connectPct.toFixed(1)}%`, color: "linear-gradient(135deg,#047857,#10b981)" }, { label: "Not Connected", value: d.abandoned.toLocaleString(), sub: `${(100 - d.connectPct).toFixed(1)}% drop`, color: "linear-gradient(135deg,#be123c,#f43f5e)" }, { label: "Unique Dialled", value: d.uniqueDialed.toLocaleString(), sub: "Distinct phones", color: KPIG[4] }, { label: "Unique Connected", value: d.uniqueConnected.toLocaleString(), sub: "Distinct answered", color: "linear-gradient(135deg,#065f46,#059669)" }, { label: "Avg Talk", value: d.avgTalk, sub: "Per connected call", color: KPIG[3] }, { label: "AHT", value: d.aht, sub: "Talk+Wrap+Dead÷connected", color: KPIG[9] }, { label: "< 30 Sec", value: d.lt30.toLocaleString(), sub: "Short connections", color: KPIG[5] }, { label: "≥ 30 Sec", value: d.ge30.toLocaleString(), sub: "Quality connections", color: KPIG[4] }];
        return (
          <div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 10, marginBottom: 14 }}>
              {kpis.map((k, i) => <KpiCard key={i} {...k} onClick={drill ? () => drill({ type: "kpi", label: k.label, value: k.value, sub: k.sub, trend: cartDailyTrend(f) }) : undefined} />)}
            </div>
            <Panel title="By Campaign">
              <DataTable cols={[{ h: "Campaign", k: "campaign" as const, left: true }, { h: "Offered", k: "offered" as const }, { h: "Connected", k: "connected" as const }, { h: "Unique Dialled", k: "uniqueDialed" as const }, { h: "Unique Connected", k: "uniqueConnected" as const }, { h: "Connect%", k: "connectPct" as const, fmt: (v: unknown) => <PctBadge v={Number(v)} /> }, { h: "Avg Talk", k: "avgTalk" as const }]} rows={d.byCampaign} />
            </Panel>
          </div>
        );
      })())}
      {sub === "daily" && (dayQ.isLoading ? <Spinner /> : dayQ.error || !dayQ.data ? <Err msg="Failed to load daily" /> : (
        <div>
          <Panel title="Day-wise Performance" sub={`${dayQ.data.length} days`}>
            <DataTable<CartDayT> cols={[{ h: "Date", k: "date", left: true, fmt: fmtD }, { h: "Total CDR", k: "totalDialed" }, { h: "Unique Dialled", k: "uniqueDialed" }, { h: "Unique Connected", k: "uniqueConnected" }, { h: "Connect%", k: "connectPct", fmt: v => <PctBadge v={Number(v)} /> }, { h: "Login Count", k: "loginCount" }, { h: "Avg Talk", k: "avgTalk" }, { h: "AHT", k: "aht" }, { h: "Avg Wrap", k: "avgWrap" }, { h: "Avg Idle", k: "avgIdle" }]} rows={dayQ.data} />
          </Panel>
        </div>
      ))}
      {sub === "monthly" && (monthQ.isLoading ? (
        <div>
          <Spinner />
          <div style={{ textAlign: "center", fontSize: 12, color: "#697586", marginTop: -20 }}>
            Totalling {monthFrom.slice(0, 7)} to {f.to.slice(0, 7)} from the dialler's full call log. A month not viewed recently can take a minute or two; after that it opens instantly.
          </div>
        </div>
      ) : monthQ.error || !monthQ.data ? <Err msg="Could not load monthly data" /> : (
        <Panel title="Monthly Performance">
          <DataTable cols={[{ h: "Month", k: "monthLabel" as const, left: true }, { h: "Total CDR", k: "totalDialed" as const }, { h: "Unique Dialled", k: "uniqueDialed" as const }, { h: "Unique Connected", k: "uniqueConnected" as const }, { h: "Connect%", k: "connectPct" as const, fmt: (v: unknown) => <PctBadge v={Number(v)} /> }, { h: "Avg Daily Login", k: "loginCount" as const }, { h: "Avg Talk", k: "avgTalk" as const }, { h: "AHT", k: "aht" as const }, { h: "Avg Wrap", k: "avgWrap" as const }]} rows={monthQ.data} />
        </Panel>
      ))}
      {sub === "analysts" && (analystQ.isLoading ? <Spinner /> : analystQ.error || !analystQ.data ? <Err msg="Failed to load analysts" /> : (
        <Panel title="Analyst-wise Performance (CDR + APR)" sub={`${analystQ.data.length} analysts`}>
          <DataTable<CartAnalystT> cols={[nameCol("analystName"), { h: "Analyst ID", k: "analyst", left: true }, { h: "Login Days", k: "loginDays" }, { h: "Total CDR", k: "totalDialed" }, { h: "Unique Dialled", k: "uniqueDialed" }, { h: "Unique Connected", k: "uniqueConnected" }, { h: "Connect%", k: "connectPct", fmt: v => <PctBadge v={Number(v)} /> }, { h: "<30s", k: "lt30" }, { h: "≥30s", k: "ge30" }, { h: "Avg Talk", k: "avgTalk" }, { h: "AHT", k: "aht" }, { h: "Avg Wrap", k: "avgWrap" }, { h: "Avg Wait", k: "avgWait" }, { h: "Net Login", k: "netLoginTime" }, { h: "Utilization", k: "utilization", fmt: v => <PctBadge v={Number(v)} /> }]} rows={analystQ.data} />
        </Panel>
      ))}
      {sub === "apr" && (aprQ.isLoading ? <Spinner /> : aprQ.error || !aprQ.data ? <Err msg="Failed to load APR" /> : (
        <Panel title="Agent Productivity Report (APR)" sub={`${aprQ.data.length} agents`}>
          <DataTable cols={[nameCol("agentName"), { h: "Agent ID", k: "user" as const, left: true }, { h: "APR Calls", k: "aprCalls" as const }, { h: "Net Login", k: "netLoginTime" as const }, { h: "Talk", k: "talk" as const }, { h: "Wait", k: "wait" as const }, { h: "Dispo", k: "dispo" as const }, { h: "Pause", k: "pause" as const }, { h: "LB", k: "lbTime" as const }, { h: "TB", k: "tbTime" as const }, { h: "WB", k: "wbTime" as const }, { h: "MB", k: "mbTime" as const }, { h: "QB", k: "qbTime" as const }, { h: "Utilization", k: "utilization" as const, fmt: (v: unknown) => <PctBadge v={Number(v)} /> }]} rows={aprQ.data} />
          <div style={{ marginTop: 8, fontSize: 11, color: "#697586" }}>
            LB lunch · TB tea · WB washroom · MB meeting · QB quality break. All times are hours:minutes:seconds.
          </div>
        </Panel>
      ))}
      {sub === "sales" && (salesQ.isLoading ? <Spinner /> : salesQ.error || !salesQ.data ? <Err msg="Failed to load sales data" /> : (() => {
        const s = salesQ.data;
        const fmtRs = (v: number) => `₹${v.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
        const salesKpis = [
          { label: "Total Orders", value: s.orders.toLocaleString(), sub: `${f.from} – ${f.to}`, color: "linear-gradient(135deg,#153f69,#1e6fa8)" },
          { label: "Total Revenue", value: fmtRs(s.revenue), sub: `AOV ${fmtRs(s.aov)}`, color: "linear-gradient(135deg,#047857,#10b981)" },
          { label: "Prepaid Orders", value: s.prepaid.toLocaleString(), sub: `${s.prepaidPct.toFixed(1)}% of orders`, color: "linear-gradient(135deg,#6d28d9,#8b5cf6)" },
          { label: "COD Orders", value: s.cod.toLocaleString(), sub: `${s.codPct.toFixed(1)}% of orders`, color: "linear-gradient(135deg,#b45309,#f59e0b)" },
          { label: "AOV", value: fmtRs(s.aov), sub: "Revenue ÷ Orders", color: "linear-gradient(135deg,#0369a1,#06b6d4)" },
        ];
        return (
          <div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(5,minmax(0,1fr))", gap: 10, marginBottom: 16 }}>
              {salesKpis.map((k, i) => <KpiCard key={i} {...k} onClick={drill ? () => drill({ type: "kpi", label: k.label, value: k.value, sub: k.sub, trend: cartSalesTrend(f, fmtRs) }) : undefined} />)}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
              <Panel title="Daily Orders & Revenue" sub={`${s.daily.length} days`}>
                <DataTable cols={[
                  { h: "Date", k: "date" as const, left: true, fmt: fmtD },
                  { h: "Orders", k: "orders" as const },
                  { h: "Revenue", k: "revenue" as const, fmt: (v: unknown) => fmtRs(Number(v)) },
                  { h: "AOV", k: "aov" as const, fmt: (v: unknown) => fmtRs(Number(v)) },
                  { h: "Prepaid", k: "prepaid" as const },
                  { h: "COD", k: "cod" as const },
                  { h: "Prepaid %", k: "prepaidPct" as const, fmt: (v: unknown) => `${Number(v).toFixed(1)}%` },
                ]} rows={s.daily} />
              </Panel>
              <Panel title="Agent-wise Sales" sub={`${s.byAgent.length} agents`}>
                <DataTable cols={[
                  { h: "Agent", k: "agentName" as const, left: true },
                  { h: "Orders", k: "orders" as const },
                  { h: "Revenue", k: "revenue" as const, fmt: (v: unknown) => fmtRs(Number(v)) },
                  { h: "AOV", k: "aov" as const, fmt: (v: unknown) => fmtRs(Number(v)) },
                ]} rows={s.byAgent} />
              </Panel>
            </div>
          </div>
        );
      })())}
      {sub === "email-apr" && (
        <div>
          <InfoBox html="<strong>Reginald Email APR</strong> — Analyst time from <code>vicidial_agent_log_10_25</code> campaign <code>EMAIL</code>. Email ticket counts available in the <strong>Tickets</strong> tab. Upload via <strong>Bulk Upload Hub → EMAIL_TICKET_DAILY</strong>." />
          {emailAprSummQ.isLoading ? <Spinner /> : emailAprSummQ.error || !emailAprSummQ.data ? <Err msg="Failed to load email APR summary" /> : (() => {
            const d = emailAprSummQ.data;
            return (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(5,minmax(0,1fr))", gap: 10, marginBottom: 14 }}>
                {([
                  { label: "Agents Active", value: d.agentCount, color: KPIG[0] },
                  { label: "Total Login", value: d.totalLoginTime, color: KPIG[4] },
                  { label: "Total Talk", value: d.totalTalk, color: "linear-gradient(135deg,#047857,#10b981)" },
                  { label: "Total Pause", value: d.totalPause, sub: `LB: ${d.totalLbTime} · TB: ${d.totalTbTime}`, color: KPIG[5] },
                  { label: "Avg Utilization", value: `${d.avgUtilization.toFixed(1)}%`, color: d.avgUtilization >= 70 ? "linear-gradient(135deg,#047857,#10b981)" : KPIG[5] },
                ] as KpiSpec[]).map((k, i) => <KpiCard key={i} {...k} onClick={drill ? () => drill({ type: "kpi", label: k.label, value: k.value, sub: k.sub, trend: emailDailyTrend("reginald-email", f) }) : undefined} />)}
              </div>
            );
          })()}
          {emailAprAgentsQ.isLoading ? <Spinner /> : emailAprAgentsQ.error || !emailAprAgentsQ.data ? <Err msg="Failed to load email agents" /> : (
            <Panel title="Email Analyst APR" sub={`${emailAprAgentsQ.data.length} agents`}>
              <DataTable<EmailAprAgentRow> cols={[
                nameCol("agentName"),
                { h: "Agent ID", k: "user", left: true }, { h: "Calls", k: "aprCalls" }, { h: "Net Login", k: "netLoginTime" },
                { h: "Talk", k: "talk" }, { h: "Wait", k: "wait" }, { h: "Dispo", k: "dispo" }, { h: "Pause", k: "pause" },
                { h: "LB", k: "lbTime" }, { h: "TB", k: "tbTime" }, { h: "WB", k: "wbTime" },
                { h: "Total Break", k: "totalBreak" }, { h: "ACHT", k: "acht" },
                { h: "Utilization", k: "utilization", fmt: v => <PctBadge v={Number(v)} /> },
              ]} rows={emailAprAgentsQ.data} />
            </Panel>
          )}
        </div>
      )}
    </div>
  );
}

// ── EMAIL APR DASHBOARD ───────────────────────────────────────────────────────
type EmailAprAgentRow = { user: string; agentName: string | null; aprCalls: number; netLoginTime: string; talk: string; wait: string; dispo: string; pause: string; lbTime: string; tbTime: string; wbTime: string; totalBreak: string; acht: string; utilization: number };
type EmailTicketAnalystRow = { analyst: string; ticketsReceived: number; ticketsClosed: number; ticketsReopened: number; ticketsOpenPending: number };
type EmailTicketData = {
  dashboard: string; from: string; to: string;
  totalTickets: number; emailClosed: number; openPending: number; emailReopen: number;
  avgClosurePct: number;
  daily: { date: string; totalTickets: number; emailClosed: number; openPending: number; emailReopen: number; openingPending: number; closurePct: number }[];
  byAnalyst: EmailTicketAnalystRow[];
  hasData: boolean;
};

// ── CDR Staging Dashboard (GNC / Bella-Vita / Neemans / Viega / Exicom / DU Digital) ──

type CdrSummary = {
  clientCode: string; from: string; to: string;
  totalOffered: number; totalAnswered: number;
  alPct: number; slPct: number; achtSec: number; aht: string;
  repeatPct: number; fcrPct: number; avgLoginCount: number; dayCount: number;
};
type CdrDayRow = { date: string; offered: number; answered: number; alPct: number; slPct: number; achtSec: number; aht: string; repeatPct: number; fcrPct: number; loginCount: number };
type CdrMonthRow = { month: string; offered: number; answered: number; alPct: number; slPct: number; achtSec: number; aht: string };

// ── CDR health scoring helpers ────────────────────────────────────────────────

type CdrHealth = { score: number; status: string; color: string; bg: string; ringColor: string };
function cdrHealthScore(d: CdrSummary): CdrHealth {
  const slScore  = Math.min(30, (d.slPct  / 80) * 30);
  const alScore  = Math.min(25, (d.alPct  / 80) * 25);
  const repScore = d.repeatPct > 0 ? Math.min(25, (15 / Math.max(d.repeatPct, 1)) * 25) : 25;
  const fcrScore = d.fcrPct  > 0 ? Math.min(20, (d.fcrPct  / 80) * 20) : 10;
  const score = Math.round(Math.min(100, slScore + alScore + repScore + fcrScore));
  if (score >= 90) return { score, status: "Excellent",       color: "#16a34a", bg: "linear-gradient(135deg,#064e3b,#065f46)", ringColor: "#4ade80" };
  if (score >= 75) return { score, status: "Healthy",         color: "#0284c7", bg: "linear-gradient(135deg,#0c4a6e,#075985)", ringColor: "#38bdf8" };
  if (score >= 50) return { score, status: "Needs Attention", color: "#d97706", bg: "linear-gradient(135deg,#78350f,#92400e)", ringColor: "#fbbf24" };
  return              { score, status: "Critical",        color: "#dc2626", bg: "linear-gradient(135deg,#7f1d1d,#991b1b)", ringColor: "#f87171" };
}

type CdrInsight = { type: "good" | "warn" | "bad"; kpi: string; msg: string };
function cdrInsights(d: CdrSummary): CdrInsight[] {
  const out: CdrInsight[] = [];
  // SL%
  if (d.slPct >= 85)       out.push({ type: "good", kpi: "SL%",     msg: `Service Level strong at ${d.slPct.toFixed(1)}% — ${(d.slPct - 80).toFixed(1)}pp above 80% target.` });
  else if (d.slPct >= 70)  out.push({ type: "warn", kpi: "SL%",     msg: `Service Level at ${d.slPct.toFixed(1)}% — ${(80 - d.slPct).toFixed(1)}pp below target. Monitor queue volumes.` });
  else if (d.slPct > 0)    out.push({ type: "bad",  kpi: "SL%",     msg: `Service Level critical at ${d.slPct.toFixed(1)}% — ${(80 - d.slPct).toFixed(1)}pp gap. Immediate staffing review needed.` });
  // AL%
  if (d.alPct >= 85)       out.push({ type: "good", kpi: "AL%",     msg: `Answer Level excellent at ${d.alPct.toFixed(1)}% — callers are being reached promptly.` });
  else if (d.alPct >= 70)  out.push({ type: "warn", kpi: "AL%",     msg: `Answer Level at ${d.alPct.toFixed(1)}% — some calls going unanswered. Review staffing schedule.` });
  else if (d.alPct > 0)    out.push({ type: "bad",  kpi: "AL%",     msg: `Answer Level low at ${d.alPct.toFixed(1)}% — significant abandonment. Check IVR routing and staffing gaps.` });
  // Repeat%
  if (d.repeatPct > 0) {
    if (d.repeatPct <= 10)  out.push({ type: "good", kpi: "Repeat%", msg: `Repeat rate healthy at ${d.repeatPct.toFixed(1)}% — most issues being resolved first contact.` });
    else if (d.repeatPct <= 18) out.push({ type: "warn", kpi: "Repeat%", msg: `Repeat callers at ${d.repeatPct.toFixed(1)}% — 1 in ${Math.round(100 / d.repeatPct)} customers calling back. Review FCR.` });
    else                    out.push({ type: "bad",  kpi: "Repeat%", msg: `High repeat calling at ${d.repeatPct.toFixed(1)}%. Customers not getting resolution — urgent coaching needed.` });
  }
  // FCR%
  if (d.fcrPct > 0) {
    if (d.fcrPct >= 80)     out.push({ type: "good", kpi: "FCR%",    msg: `FCR strong at ${d.fcrPct.toFixed(1)}% — majority of issues resolved at first contact.` });
    else if (d.fcrPct >= 65) out.push({ type: "warn", kpi: "FCR%",   msg: `FCR at ${d.fcrPct.toFixed(1)}% — ${(80 - d.fcrPct).toFixed(1)}pp gap. Focus on knowledge base and agent training.` });
    else                    out.push({ type: "bad",  kpi: "FCR%",    msg: `FCR below par at ${d.fcrPct.toFixed(1)}%. Significant unresolved interactions — training intervention required.` });
  }
  // ACHT
  if (d.achtSec > 420)      out.push({ type: "warn", kpi: "ACHT",    msg: `AHT elevated at ${d.aht} — review agent efficiency, call routing, and wrap-up procedures.` });
  else if (d.achtSec > 0 && d.achtSec < 90) out.push({ type: "warn", kpi: "ACHT", msg: `AHT very low at ${d.aht} — verify call quality and that wrap-up is being completed.` });
  return out.slice(0, 5);
}

// ── CdrKpiCard — status-aware card ───────────────────────────────────────────

type CdrKpiStatus = "good" | "warn" | "bad" | "neutral";
const CDR_STATUS: Record<CdrKpiStatus, { border: string; bg: string; badge: string; badgeBg: string; value: string }> = {
  good:    { border: "#86efac", bg: "#f0fdf4", badge: "On Track",     badgeBg: "#dcfce7", value: "#15803d" },
  warn:    { border: "#fde68a", bg: "#fffbeb", badge: "Watch",        badgeBg: "#fef9c3", value: "#b45309" },
  bad:     { border: "#fca5a5", bg: "#fff0f2", badge: "Action Needed", badgeBg: "#fee2e2", value: "#b91c1c" },
  neutral: { border: "#dce4ed", bg: "#f8fafd", badge: "",             badgeBg: "#eef2f7", value: "#1a3a5c" },
};

function CdrKpiCard({ label, value, status, target, onClick }: { label: string; value: string; status: CdrKpiStatus; target?: string; onClick?: () => void }) {
  const s = CDR_STATUS[status];
  return (
    <div
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={onClick ? e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } } : undefined}
      className={onClick ? "dlp-kpi-clickable" : undefined}
      style={{ background: s.bg, border: `1.5px solid ${s.border}`, borderRadius: 14, padding: "13px 15px", cursor: onClick ? "pointer" : undefined, userSelect: onClick ? "none" : undefined, position: "relative", overflow: "hidden" }}
    >
      {status !== "neutral" && <div style={{ position: "absolute", top: 9, right: 9, fontSize: 9, fontWeight: 900, color: s.value, background: s.badgeBg, border: `1px solid ${s.border}`, borderRadius: 20, padding: "2px 7px", letterSpacing: ".3px" }}>{CDR_STATUS[status].badge}</div>}
      <div style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: ".45px", fontWeight: 900, color: "#6b7a90", marginBottom: 5 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 950, color: s.value, lineHeight: 1.1, marginBottom: 4 }}>{value}</div>
      {target && <div style={{ fontSize: 9, fontWeight: 700, color: "#8390a0" }}>{target}</div>}
    </div>
  );
}

// ── CdrStatChip — tiny summary chip for the hero band ────────────────────────

function CdrStatChip({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: "rgba(255,255,255,.15)", border: "1px solid rgba(255,255,255,.22)", borderRadius: 8, padding: "4px 10px", display: "flex", gap: 6, alignItems: "center" }}>
      <span style={{ fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,.7)", textTransform: "uppercase", letterSpacing: ".3px" }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 900, color: "#fff" }}>{value}</span>
    </div>
  );
}

// ── InboundCdrDashboard ───────────────────────────────────────────────────────

function InboundCdrDashboard({ proc, label, f }: { proc: string; label: string; f: Filters }) {
  const [sub, setSub] = useState<"overview" | "daily" | "monthly">("overview");
  const drill = useDrill();
  const summQ = useQuery({ queryKey: ["pld", proc, "summary", f], queryFn: () => fetchLive<CdrSummary>(`${proc}/summary`, { from: f.from, to: f.to }), staleTime: 2 * 60 * 1000 });
  const dayQ  = useQuery({ queryKey: ["pld", proc, "daily", f],   queryFn: () => fetchLive<CdrDayRow[]>(`${proc}/daily`, { from: f.from, to: f.to }),   staleTime: 2 * 60 * 1000, enabled: sub === "daily" });
  const monQ  = useQuery({ queryKey: ["pld", proc, "monthly", f], queryFn: () => fetchLive<CdrMonthRow[]>(`${proc}/monthly`, { from: f.from, to: f.to }), staleTime: 2 * 60 * 1000, enabled: sub === "monthly" });

  const cdrTrend: DrillTrend = {
    title: "Day-wise Trend",
    queryKey: ["pld", proc, "daily", f],
    path: `${proc}/daily`,
    params: { from: f.from, to: f.to },
    emptyHint: "No CDR data synced for this range.",
    cols: [
      { h: "Date", k: "date", left: true, fmt: fmtDay },
      { h: "Offered", k: "offered" },
      { h: "Answered", k: "answered" },
      { h: "AL%", k: "alPct", fmt: v => <PctBadge v={Number(v)} /> },
      { h: "SL%", k: "slPct", fmt: v => <PctBadge v={Number(v)} /> },
      { h: "ACHT", k: "aht" },
      { h: "Repeat%", k: "repeatPct", fmt: v => <PctBadge v={Number(v)} /> },
      { h: "FCR%", k: "fcrPct", fmt: v => <PctBadge v={Number(v)} /> },
    ],
  };

  return (
    <div>
      {/* ── Tab strip ── */}
      <div style={{ display: "flex", gap: 4, marginBottom: 14 }}>
        {(["overview", "daily", "monthly"] as const).map(s => (
          <button key={s} type="button" onClick={() => setSub(s)}
            style={{ padding: "5px 18px", borderRadius: 20, border: "none", cursor: "pointer", fontSize: 12, fontWeight: 800,
              background: sub === s ? "linear-gradient(135deg,#153f69,#2673a0)" : "#edf3f9",
              color: sub === s ? "#fff" : "#334155", transition: ".15s", boxShadow: sub === s ? "0 3px 10px rgba(21,63,105,.25)" : "none" }}>
            {s === "overview" ? "Overview" : s === "daily" ? "Day-wise" : "Monthly"}
          </button>
        ))}
      </div>

      {/* ── OVERVIEW ── */}
      {sub === "overview" && (
        summQ.isLoading ? <Spinner /> : summQ.error ? <Err msg="Could not load summary" /> : summQ.data ? (() => {
          const d = summQ.data;
          const health = cdrHealthScore(d);
          const insights = cdrInsights(d);

          return (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

              {/* ── Hero band ── */}
              <div style={{ background: health.bg, borderRadius: 18, padding: "18px 22px", display: "flex", alignItems: "center", gap: 20, boxShadow: "0 10px 32px rgba(10,20,40,.20)", flexWrap: "wrap" }}>
                {/* Health ring */}
                <HealthRing score={health.score} status={health.status} />
                {/* Text + chips */}
                <div style={{ flex: 1, minWidth: 160 }}>
                  <div style={{ fontSize: 20, fontWeight: 900, color: "#fff", marginBottom: 3 }}>{label}</div>
                  <div style={{ fontSize: 11, color: "rgba(255,255,255,.65)", fontWeight: 700, marginBottom: 10 }}>
                    {d.dayCount} day period · {d.from} → {d.to} · Synced from dialler DB
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <CdrStatChip label="Calls Offered" value={d.totalOffered.toLocaleString()} />
                    <CdrStatChip label="Calls Answered" value={d.totalAnswered.toLocaleString()} />
                    <CdrStatChip label="Avg Agents" value={d.avgLoginCount.toFixed(1)} />
                  </div>
                </div>
              </div>

              {/* ── KPI grid — quality KPIs ── */}
              <div>
                <div style={{ fontSize: 10, fontWeight: 900, color: "#6b7a90", textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 8 }}>Quality KPIs — click any card for day-wise trend</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 10 }}>
                  <CdrKpiCard label="Service Level (SL%)" value={`${d.slPct.toFixed(1)}%`}
                    status={d.slPct >= 80 ? "good" : d.slPct >= 65 ? "warn" : "bad"}
                    target="Target ≥ 80%"
                    onClick={() => drill?.({ type: "kpi", label: "Service Level %", value: `${d.slPct.toFixed(1)}%`, dashboard: proc as DiallerProcess, trend: cdrTrend })} />
                  <CdrKpiCard label="Answer Level (AL%)" value={`${d.alPct.toFixed(1)}%`}
                    status={d.alPct >= 80 ? "good" : d.alPct >= 65 ? "warn" : "bad"}
                    target="Target ≥ 80%"
                    onClick={() => drill?.({ type: "kpi", label: "Answer Level %", value: `${d.alPct.toFixed(1)}%`, dashboard: proc as DiallerProcess, trend: cdrTrend })} />
                  <CdrKpiCard label="Avg Handle Time" value={d.aht}
                    status={d.achtSec > 420 ? "warn" : d.achtSec > 600 ? "bad" : d.achtSec > 0 ? "good" : "neutral"}
                    target="ACHT (talk + wrap)"
                    onClick={() => drill?.({ type: "kpi", label: "Avg Call Handle Time", value: d.aht, dashboard: proc as DiallerProcess, trend: cdrTrend })} />
                  <CdrKpiCard label="Repeat Call %" value={`${d.repeatPct.toFixed(1)}%`}
                    status={d.repeatPct <= 10 ? "good" : d.repeatPct <= 18 ? "warn" : "bad"}
                    target="Target ≤ 15%"
                    onClick={() => drill?.({ type: "kpi", label: "Repeat Call %", value: `${d.repeatPct.toFixed(1)}%`, dashboard: proc as DiallerProcess, trend: cdrTrend })} />
                  <CdrKpiCard label="First Contact Res." value={`${d.fcrPct.toFixed(1)}%`}
                    status={d.fcrPct >= 80 ? "good" : d.fcrPct >= 65 ? "warn" : d.fcrPct > 0 ? "bad" : "neutral"}
                    target="Target ≥ 80%"
                    onClick={() => drill?.({ type: "kpi", label: "First Contact Resolution %", value: `${d.fcrPct.toFixed(1)}%`, dashboard: proc as DiallerProcess, trend: cdrTrend })} />
                </div>
              </div>

              {/* ── KPI grid — volume KPIs ── */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10 }}>
                <CdrKpiCard label="Total Calls Offered" value={d.totalOffered.toLocaleString()} status="neutral" target={`${d.dayCount}-day cumulative`}
                  onClick={() => drill?.({ type: "kpi", label: "Total Calls Offered", value: d.totalOffered.toLocaleString(), dashboard: proc as DiallerProcess, trend: cdrTrend })} />
                <CdrKpiCard label="Total Calls Answered" value={d.totalAnswered.toLocaleString()} status="neutral" target={`${d.dayCount}-day cumulative`}
                  onClick={() => drill?.({ type: "kpi", label: "Total Calls Answered", value: d.totalAnswered.toLocaleString(), dashboard: proc as DiallerProcess, trend: cdrTrend })} />
                <CdrKpiCard label="Avg Agents / Day" value={d.avgLoginCount.toFixed(1)} status="neutral" target="Daily login headcount avg"
                  onClick={() => drill?.({ type: "kpi", label: "Avg Agents Per Day", value: d.avgLoginCount.toFixed(1), dashboard: proc as DiallerProcess, trend: cdrTrend })} />
              </div>

              {/* ── Actionable Insights ── */}
              {insights.length > 0 && (
                <div style={{ background: "#fff", border: "1px solid #dce4ed", borderRadius: 14, padding: "15px 18px", boxShadow: "0 2px 12px rgba(16,35,57,.06)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                    <div style={{ width: 22, height: 22, borderRadius: 7, background: "linear-gradient(135deg,#f59e0b,#ef4444)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <span style={{ fontSize: 11, color: "#fff", fontWeight: 900 }}>!</span>
                    </div>
                    <span style={{ fontSize: 12, fontWeight: 900, color: "#102f4b", textTransform: "uppercase", letterSpacing: ".5px" }}>Actionable Insights</span>
                    <span style={{ fontSize: 10, fontWeight: 700, color: "#8390a0", background: "#f0f4f9", borderRadius: 12, padding: "2px 8px" }}>Auto-generated from data</span>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {insights.map((ins, i) => {
                      const ic = ins.type === "good" ? { bg: "#f0fdf4", border: "#86efac", dot: "#16a34a", text: "#065f46", icon: "✓" }
                               : ins.type === "warn" ? { bg: "#fffbeb", border: "#fde68a", dot: "#d97706", text: "#78350f", icon: "!" }
                               :                       { bg: "#fff0f2", border: "#fca5a5", dot: "#dc2626", text: "#7f1d1d", icon: "✕" };
                      return (
                        <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 13px", borderRadius: 10, background: ic.bg, border: `1px solid ${ic.border}` }}>
                          <div style={{ flexShrink: 0, width: 20, height: 20, borderRadius: "50%", background: ic.dot, display: "flex", alignItems: "center", justifyContent: "center", marginTop: 1 }}>
                            <span style={{ fontSize: 10, color: "#fff", fontWeight: 900 }}>{ic.icon}</span>
                          </div>
                          <div style={{ flex: 1 }}>
                            <span style={{ fontSize: 9, fontWeight: 900, color: ic.dot, textTransform: "uppercase", letterSpacing: ".3px", marginRight: 6 }}>{ins.kpi}</span>
                            <span style={{ fontSize: 12, fontWeight: 700, color: ic.text, lineHeight: 1.5 }}>{ins.msg}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })() : null
      )}

      {/* ── DAY-WISE ── */}
      {sub === "daily" && (
        dayQ.isLoading ? <Spinner /> : dayQ.error ? <Err msg="Could not load daily data" /> : (() => {
          const rows = dayQ.data ?? [];
          return (
            <Panel title={`${label} — Day-wise CDR`} sub={`${rows.length} days`}>
              <DataTable<CdrDayRow>
                cols={[
                  { h: "Date", k: "date", left: true, fmt: fmtDay },
                  { h: "Offered", k: "offered" },
                  { h: "Answered", k: "answered" },
                  { h: "AL%", k: "alPct", fmt: v => <PctBadge v={Number(v)} /> },
                  { h: "SL%", k: "slPct", fmt: v => <PctBadge v={Number(v)} /> },
                  { h: "ACHT", k: "aht" },
                  { h: "Repeat%", k: "repeatPct", fmt: v => <PctBadge v={Number(v)} /> },
                  { h: "FCR%", k: "fcrPct", fmt: v => <PctBadge v={Number(v)} /> },
                  { h: "Agents", k: "loginCount" },
                ]}
                rows={rows}
                onRowClick={row => {
                  const dayHealth = cdrHealthScore({ ...row, totalOffered: row.offered, totalAnswered: row.answered, avgLoginCount: row.loginCount, dayCount: 1, clientCode: proc, from: row.date, to: row.date, aht: row.aht });
                  drill?.({ type: "record", title: `${label} — ${fmtDay(row.date)}`, fields: [
                    { label: "Date", value: fmtDay(row.date) },
                    { label: "Day Status", value: <span style={{ fontWeight: 900, color: dayHealth.color }}>{dayHealth.status} ({dayHealth.score}/100)</span> },
                    { label: "Calls Offered", value: String(row.offered) },
                    { label: "Calls Answered", value: String(row.answered) },
                    { label: "Answer Level %", value: <PctBadge v={row.alPct} /> },
                    { label: "Service Level %", value: <PctBadge v={row.slPct} /> },
                    { label: "Avg Handle Time", value: row.aht },
                    { label: "Repeat Call %", value: <PctBadge v={row.repeatPct} /> },
                    { label: "FCR %", value: <PctBadge v={row.fcrPct} /> },
                    { label: "Agents Logged In", value: String(row.loginCount) },
                    { label: "SL vs Target", value: <span style={{ fontWeight: 700, color: row.slPct >= 80 ? "#16a34a" : "#dc2626" }}>{row.slPct >= 80 ? `+${(row.slPct - 80).toFixed(1)}pp above target` : `${(80 - row.slPct).toFixed(1)}pp below target`}</span> },
                    { label: "AL vs Target", value: <span style={{ fontWeight: 700, color: row.alPct >= 80 ? "#16a34a" : "#dc2626" }}>{row.alPct >= 80 ? `+${(row.alPct - 80).toFixed(1)}pp above target` : `${(80 - row.alPct).toFixed(1)}pp below target`}</span> },
                  ]});
                }}
              />
            </Panel>
          );
        })()
      )}

      {/* ── MONTHLY ── */}
      {sub === "monthly" && (
        monQ.isLoading ? <Spinner /> : monQ.error ? <Err msg="Could not load monthly data" /> : (() => {
          const rows = monQ.data ?? [];
          return (
            <Panel title={`${label} — Monthly Summary`} sub={`${rows.length} months`}>
              <DataTable<CdrMonthRow>
                cols={[
                  { h: "Month", k: "month", left: true },
                  { h: "Offered", k: "offered" },
                  { h: "Answered", k: "answered" },
                  { h: "AL%", k: "alPct", fmt: v => <PctBadge v={Number(v)} /> },
                  { h: "SL%", k: "slPct", fmt: v => <PctBadge v={Number(v)} /> },
                  { h: "ACHT", k: "aht" },
                ]}
                rows={rows}
                onRowClick={row => {
                  drill?.({ type: "record", title: `${label} — ${row.month}`, fields: [
                    { label: "Month", value: String(row.month) },
                    { label: "Calls Offered", value: String(row.offered) },
                    { label: "Calls Answered", value: String(row.answered) },
                    { label: "Answer Level %", value: <PctBadge v={row.alPct} /> },
                    { label: "Service Level %", value: <PctBadge v={row.slPct} /> },
                    { label: "Avg Handle Time", value: row.aht },
                    { label: "SL vs Target", value: <span style={{ fontWeight: 700, color: row.slPct >= 80 ? "#16a34a" : "#dc2626" }}>{row.slPct >= 80 ? `+${(row.slPct - 80).toFixed(1)}pp above` : `${(80 - row.slPct).toFixed(1)}pp below target`}</span> },
                    { label: "AL vs Target", value: <span style={{ fontWeight: 700, color: row.alPct >= 80 ? "#16a34a" : "#dc2626" }}>{row.alPct >= 80 ? `+${(row.alPct - 80).toFixed(1)}pp above` : `${(80 - row.alPct).toFixed(1)}pp below target`}</span> },
                  ]});
                }}
              />
            </Panel>
          );
        })()
      )}
    </div>
  );
}

// ── Email APR Dashboard (Molecular / Reginald Email / Finnable) ───────────────

function EmailAprDashboard({ proc, label, campaign, f }: { proc: "molecular-email" | "reginald-email" | "finnable"; label: string; campaign: string; f: Filters }) {
  const [sub, setSub] = useState<"overview" | "daily" | "agents" | "tickets">("overview");
  const drill = useDrill();
  const summQ = useQuery({ queryKey: ["pld", proc, "summary", f], queryFn: () => fetchLive<{ totalLoginTime: string; totalTalk: string; totalPause: string; totalLbTime: string; totalTbTime: string; totalWbTime: string; avgUtilization: number; agentCount: number }>(`${proc}/summary`, { from: f.from, to: f.to }), staleTime: 2 * 60 * 1000 });
  const agentQ = useQuery({ queryKey: ["pld", proc, "agents", f], queryFn: () => fetchLive<EmailAprAgentRow[]>(`${proc}/agents`, { from: f.from, to: f.to }), staleTime: 2 * 60 * 1000, enabled: sub === "agents" });
  const dailyQ = useQuery({ queryKey: ["pld", proc, "daily", f], queryFn: () => fetchLive<{ date: string; loginTime: string; talk: string; wait: string; dispo: string; pause: string; utilization: number; agentCount: number }[]>(`${proc}/daily`, { from: f.from, to: f.to }), staleTime: 2 * 60 * 1000, enabled: sub === "daily" });
  const ticketsQ = useQuery({ queryKey: ["pld", proc, "tickets", f], queryFn: () => fetchLive<EmailTicketData>(`${proc}/tickets`, { from: f.from, to: f.to }), staleTime: 2 * 60 * 1000, enabled: sub === "tickets" });

  const TICKETS_UPLOAD_INFO = "Email ticket counts available in the <strong>Tickets</strong> tab. Upload via <strong>Bulk Upload Hub → EMAIL_TICKET_DAILY</strong>.";

  return (
    <div>
      <InfoBox html={`<strong>${label}</strong> — APR from <code>vicidial_agent_log_10_25</code> campaign <code>${campaign}</code>. ${TICKETS_UPLOAD_INFO}`} />
      <div style={{ display: "flex", gap: 4, marginBottom: 14 }}>
        {([["overview", "Overview"], ["daily", "Daily"], ["agents", "Agents"], ["tickets", "Tickets"]] as const).map(([t, lbl]) => (
          <button key={t} onClick={() => setSub(t)} style={{ height: 30, border: "none", borderRadius: 8, padding: "0 12px", fontSize: 12, fontWeight: 800, cursor: "pointer", transition: ".15s", background: sub === t ? "linear-gradient(135deg,#153f69,#2673a0)" : "#edf3f9", color: sub === t ? "#fff" : "#334155" }}>{lbl}</button>
        ))}
      </div>
      {sub === "overview" && (summQ.isLoading ? <Spinner /> : summQ.error || !summQ.data ? <Err msg="Failed to load summary" /> : (() => {
        const d = summQ.data;
        return <div style={{ display: "grid", gridTemplateColumns: "repeat(5,minmax(0,1fr))", gap: 10 }}>{([{ label: "Agents Active", value: d.agentCount, color: KPIG[0] }, { label: "Total Login", value: d.totalLoginTime, color: KPIG[4] }, { label: "Total Talk", value: d.totalTalk, color: "linear-gradient(135deg,#047857,#10b981)" }, { label: "Total Pause", value: d.totalPause, sub: `LB: ${d.totalLbTime} · TB: ${d.totalTbTime}`, color: KPIG[5] }, { label: "Avg Utilization", value: `${d.avgUtilization.toFixed(1)}%`, color: d.avgUtilization >= 70 ? "linear-gradient(135deg,#047857,#10b981)" : KPIG[5] }] as KpiSpec[]).map((k, i) => <KpiCard key={i} {...k} onClick={drill ? () => drill({ type: "kpi", label: k.label, value: k.value, sub: k.sub, trend: emailDailyTrend(proc, f) }) : undefined} />)}</div>;
      })())}
      {sub === "daily" && (dailyQ.isLoading ? <Spinner /> : dailyQ.error || !dailyQ.data ? <Err msg="Failed" /> : (
        <Panel title="Daily APR" sub={`${dailyQ.data.length} days`}>
          <DataTable cols={[{ h: "Date", k: "date" as const, left: true, fmt: (v: unknown) => new Date(String(v)).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) }, { h: "Login Time", k: "loginTime" as const }, { h: "Talk", k: "talk" as const }, { h: "Wait", k: "wait" as const }, { h: "Dispo", k: "dispo" as const }, { h: "Pause", k: "pause" as const }, { h: "Agents", k: "agentCount" as const }, { h: "Utilization", k: "utilization" as const, fmt: (v: unknown) => <PctBadge v={Number(v)} /> }]} rows={dailyQ.data} />
        </Panel>
      ))}
      {sub === "agents" && (agentQ.isLoading ? <Spinner /> : agentQ.error || !agentQ.data ? <Err msg="Failed to load agents" /> : (
        <Panel title={`${label} — Analyst APR`} sub={`${agentQ.data.length} agents`}>
          <DataTable<EmailAprAgentRow> cols={[nameCol("agentName"), { h: "Agent ID", k: "user", left: true }, { h: "Calls", k: "aprCalls" }, { h: "Net Login", k: "netLoginTime" }, { h: "Talk", k: "talk" }, { h: "Wait", k: "wait" }, { h: "Dispo", k: "dispo" }, { h: "Pause", k: "pause" }, { h: "LB", k: "lbTime" }, { h: "TB", k: "tbTime" }, { h: "WB", k: "wbTime" }, { h: "Total Break", k: "totalBreak" }, { h: "ACHT", k: "acht" }, { h: "Utilization", k: "utilization", fmt: v => <PctBadge v={Number(v)} /> }]} rows={agentQ.data} />
        </Panel>
      ))}
      {sub === "tickets" && (
        ticketsQ.isLoading ? <Spinner /> : ticketsQ.error || !ticketsQ.data ? <Err msg="Failed to load ticket data" /> : (() => {
          const td = ticketsQ.data;
          if (!td.hasData) {
            return <InfoBox html="No ticket data uploaded for this date range. Upload via <strong>Bulk Upload Hub → EMAIL_TICKET_DAILY</strong>." />;
          }
          const closurePctColor = (v: number) => v >= 80 ? "#16a34a" : v >= 60 ? "#d97706" : "#dc2626";
          const closurePctBg = (v: number) => v >= 80 ? "#eaf8ef" : v >= 60 ? "#fff8e7" : "#fff0f2";
          const ticketTrend: DrillTrend = {
            title: "Day-wise tickets",
            queryKey: ["pld", proc, "tickets", f],
            path: `${proc}/tickets`,
            params: { from: f.from, to: f.to },
            pick: raw => (raw as EmailTicketData).daily as unknown as Record<string, unknown>[],
            emptyHint: "No ticket data uploaded for this range.",
            cols: [
              { h: "Date", k: "date", left: true, fmt: fmtDay },
              { h: "Total", k: "totalTickets" },
              { h: "Closed", k: "emailClosed" },
              { h: "Open/Pending", k: "openPending" },
              { h: "Reopen", k: "emailReopen" },
              { h: "Closure %", k: "closurePct", fmt: v => <PctBadge v={Number(v)} /> },
            ],
          };
          const ticketDrill = (label: string, value: string) => drill ? () => drill({ type: "kpi", label, value, trend: ticketTrend }) : undefined;
          return (
            <div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 10, marginBottom: 16 }}>
                <KpiCard label="Total Tickets" value={td.totalTickets.toLocaleString()} color={KPIG[0]} onClick={ticketDrill("Total Tickets", td.totalTickets.toLocaleString())} />
                <KpiCard label="Email Closed" value={td.emailClosed.toLocaleString()} color="linear-gradient(135deg,#047857,#10b981)" onClick={ticketDrill("Email Closed", td.emailClosed.toLocaleString())} />
                <KpiCard label="Open / Pending" value={td.openPending.toLocaleString()} color="linear-gradient(135deg,#be123c,#f43f5e)" onClick={ticketDrill("Open / Pending", td.openPending.toLocaleString())} />
                <KpiCard label="Avg Closure %" value={`${td.avgClosurePct.toFixed(1)}%`} color={td.avgClosurePct >= 80 ? "linear-gradient(135deg,#047857,#10b981)" : td.avgClosurePct >= 60 ? "linear-gradient(135deg,#b45309,#f59e0b)" : "linear-gradient(135deg,#be123c,#f43f5e)"} onClick={ticketDrill("Avg Closure %", `${td.avgClosurePct.toFixed(1)}%`)} />
              </div>
              <Panel title="Daily Ticket Breakdown" sub={`${td.daily.length} days`}>
                <DataTable cols={[
                  { h: "Date", k: "date" as const, left: true, fmt: (v: unknown) => new Date(String(v)).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) },
                  { h: "Total", k: "totalTickets" as const },
                  { h: "Closed", k: "emailClosed" as const },
                  { h: "Open/Pending", k: "openPending" as const },
                  { h: "Reopen", k: "emailReopen" as const },
                  { h: "Opening Pending", k: "openingPending" as const },
                  { h: "Closure %", k: "closurePct" as const, fmt: (v: unknown) => <span style={{ fontWeight: 900, color: closurePctColor(Number(v)), background: closurePctBg(Number(v)), borderRadius: 6, padding: "2px 7px" }}>{Number(v).toFixed(1)}%</span> },
                ]} rows={td.daily} />
              </Panel>
              <div style={{ marginTop: 14 }}>
                {td.byAnalyst.length === 0 ? (
                  <InfoBox html="No per-analyst ticket data for this date range yet — it syncs live from the ticketing system (last 2 days on every sync cycle)." />
                ) : (
                  <Panel title="Analyst-wise Ticket Breakdown" sub={`${td.byAnalyst.length} analysts`}>
                    <DataTable<EmailTicketAnalystRow> cols={[
                      { h: "Analyst", k: "analyst", left: true },
                      { h: "Email Received", k: "ticketsReceived" },
                      { h: "Closed", k: "ticketsClosed" },
                      { h: "Pending", k: "ticketsOpenPending" },
                      { h: "Reopen", k: "ticketsReopened" },
                    ]} rows={td.byAnalyst} />
                  </Panel>
                )}
              </div>
            </div>
          );
        })()
      )}
    </div>
  );
}

// ── BILLING DASHBOARD ─────────────────────────────────────────────────────────
interface BillingRow extends Record<string, unknown> {
  process: string; lob: string;
  approvedHC: number; targetHrs: number; deliveredHrs: number; deliveredFTE: number;
  billingHrs: number; billingAmount: number; variance: number; utilization: number;
  needHcPerDay: number; planningDays: number; agentCount: number;
}

function BillingDashboard({ f }: { f: Filters }) {
  const [month, setMonth] = useState(f.from.slice(0, 7));
  const drill = useDrill();

  const dashQ = useQuery({
    queryKey: ["pld", "billing", "dashboard", month],
    queryFn: () => fetchLive<{ month: string; dataTillDate: string; rows: BillingRow[]; generatedAt: string }>("billing/dashboard", { month }),
    staleTime: 5 * 60 * 1000,
  });

  const fmtRs = (v: number) => `₹${v.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

  const rows = dashQ.data?.rows ?? [];
  const totalApprovedHC = rows.reduce((s, r) => s + r.approvedHC, 0);
  const totalDeliveredFTE = rows.reduce((s, r) => s + r.deliveredFTE, 0);
  const totalBillingAmount = rows.reduce((s, r) => s + r.billingAmount, 0);
  const totalBillingHrs = rows.reduce((s, r) => s + r.billingHrs, 0);
  const overallUtilization = totalApprovedHC > 0 ? (totalDeliveredFTE / totalApprovedHC) * 100 : 0;

  const billingTrend: DrillTrend = {
    title: "LOB breakdown",
    queryKey: ["pld", "billing", "dashboard", month],
    path: "billing/dashboard",
    params: { month },
    pick: raw => (raw as { rows: BillingRow[] }).rows as unknown as Record<string, unknown>[],
    emptyHint: "No approved headcount configured for this month.",
    cols: [
      { h: "Process", k: "process", left: true },
      { h: "LOB", k: "lob", left: true },
      { h: "Approved HC", k: "approvedHC" },
      { h: "Delivered FTE", k: "deliveredFTE", fmt: v => Number(v).toFixed(2) },
      { h: "Billing Hrs", k: "billingHrs", fmt: v => Number(v).toFixed(1) },
      { h: "Billing Amount", k: "billingAmount", fmt: v => fmtRs(Number(v)) },
      { h: "Utilization %", k: "utilization", fmt: v => <PctBadge v={Number(v)} /> },
    ],
  };
  const billingDrill = (label: string, value: string, sub: string) => drill ? () => drill({ type: "kpi", label, value, sub, trend: billingTrend }) : undefined;

  const varianceColor = (v: number) => v >= 0 ? "#16a34a" : "#dc2626";
  const varianceBg = (v: number) => v >= 0 ? "#eaf8ef" : "#fff0f2";
  const utilColor = (v: number) => v >= 80 ? "#16a34a" : v >= 60 ? "#d97706" : "#dc2626";
  const utilBg = (v: number) => v >= 80 ? "#eaf8ef" : v >= 60 ? "#fff8e7" : "#fff0f2";

  return (
    <div>
      {/* Month picker */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16, padding: "10px 14px", background: "#fff", border: "1px solid #dce4ed", borderRadius: 12, flexWrap: "wrap" }}>
        <span style={{ fontSize: 11, fontWeight: 800, color: "#697586" }}>Billing Month:</span>
        <input
          type="month"
          value={month}
          onChange={e => setMonth(e.target.value)}
          style={{ height: 32, border: "1px solid #dce4ed", borderRadius: 8, padding: "0 8px", fontSize: 12, fontWeight: 700, background: "#f9fbfd", outline: "none" }}
        />
        {dashQ.data?.dataTillDate && (
          <span style={{ fontSize: 11, fontWeight: 700, color: "#0369a1", background: "#e7f6fb", border: "1px solid #c8edf5", borderRadius: 999, padding: "3px 9px" }}>
            Data till: {dashQ.data.dataTillDate}
          </span>
        )}
        {dashQ.data?.generatedAt && (
          <span style={{ fontSize: 10, color: "#697586", marginLeft: "auto" }}>Generated: {dashQ.data.generatedAt}</span>
        )}
      </div>

      <InfoBox html="<strong>Domestic Billing Dashboard</strong> — Approved headcount configuration from <strong>Bulk Upload Hub → DOMESTIC_BILLING_APPROVED_HC</strong>. Billing amounts and FTE delivery are derived from approved HC, target hours, and delivered hours per LOB." />

      {dashQ.isLoading ? <Spinner /> : dashQ.error || !dashQ.data ? <Err msg="Failed to load billing dashboard" /> : (
        <div>
          {/* Summary KPI cards */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 10, marginBottom: 16 }}>
            <KpiCard
              label="Total Approved HC"
              value={totalApprovedHC.toLocaleString()}
              sub="Sum across all LOBs"
              color={KPIG[0]}
              onClick={billingDrill("Total Approved HC", totalApprovedHC.toLocaleString(), "Sum across all LOBs")}
            />
            <KpiCard
              label="Total Delivered FTE"
              value={totalDeliveredFTE.toFixed(2)}
              sub="FTE across all LOBs"
              color="linear-gradient(135deg,#047857,#10b981)"
              onClick={billingDrill("Total Delivered FTE", totalDeliveredFTE.toFixed(2), "FTE across all LOBs")}
            />
            <KpiCard
              label="Total Billing Amount"
              value={fmtRs(totalBillingAmount)}
              sub={`Billing Hrs: ${totalBillingHrs.toFixed(1)}`}
              color="linear-gradient(135deg,#6d28d9,#8b5cf6)"
              onClick={billingDrill("Total Billing Amount", fmtRs(totalBillingAmount), `Billing Hrs: ${totalBillingHrs.toFixed(1)}`)}
            />
            <KpiCard
              label="Overall Utilization"
              value={`${overallUtilization.toFixed(1)}%`}
              sub="Delivered FTE / Approved HC"
              color={overallUtilization >= 80 ? "linear-gradient(135deg,#047857,#10b981)" : overallUtilization >= 60 ? "linear-gradient(135deg,#b45309,#f59e0b)" : "linear-gradient(135deg,#be123c,#f43f5e)"}
              onClick={billingDrill("Overall Utilization", `${overallUtilization.toFixed(1)}%`, "Delivered FTE / Approved HC")}
            />
          </div>

          {/* Main LOB table */}
          <Panel title="LOB-wise Billing Matrix" sub={`${rows.length} LOB${rows.length !== 1 ? "s" : ""}`}>
            <DataTable<BillingRow> cols={[
              { h: "Process", k: "process", left: true },
              { h: "LOB", k: "lob", left: true },
              { h: "Approved HC", k: "approvedHC" },
              { h: "Target Hrs", k: "targetHrs", fmt: (v: unknown) => Number(v).toFixed(1) },
              { h: "Delivered Hrs", k: "deliveredHrs", fmt: (v: unknown) => Number(v).toFixed(1) },
              { h: "Delivered FTE", k: "deliveredFTE", fmt: (v: unknown) => Number(v).toFixed(2) },
              {
                h: "Variance", k: "variance", fmt: (v: unknown) => {
                  const val = Number(v);
                  return <span style={{ fontWeight: 900, color: varianceColor(val), background: varianceBg(val), borderRadius: 6, padding: "2px 7px" }}>{val >= 0 ? "+" : ""}{val.toFixed(2)}</span>;
                }
              },
              {
                h: "Utilization %", k: "utilization", fmt: (v: unknown) => {
                  const val = Number(v);
                  return <span style={{ fontWeight: 900, color: utilColor(val), background: utilBg(val), borderRadius: 6, padding: "2px 7px" }}>{val.toFixed(1)}%</span>;
                }
              },
              { h: "Billing Hrs", k: "billingHrs", fmt: (v: unknown) => Number(v).toFixed(1) },
              { h: "Billing Amount", k: "billingAmount", fmt: (v: unknown) => fmtRs(Number(v)) },
              { h: "Need HC/Day", k: "needHcPerDay", fmt: (v: unknown) => Number(v).toFixed(1) },
            ]} rows={rows} />
          </Panel>
        </div>
      )}
    </div>
  );
}

// ── GS1 INDIA LIVE DASHBOARD ──────────────────────────────────────────────────
type GS1OverviewT = {
  emailTasks: number; emailGtin: number;
  dataKartTasks: number; dataKartGtin: number;
  approvalSku: number; auditErrors: number;
  daily: { date: string; emailTasks: number; dataKartTasks: number }[];
};
// Field names below are the ones gs1.service.ts actually returns. They were
// previously invented (tasksAssigned/dataReceived/errorRatePct/slaPct/…), which
// made three of the four GS1 sub-tabs throw on first render.
type GS1EmailT = {
  tasks: number; gtin: number; images: number; sla15Pct: number;
  byAnalyst: { analyst: string; tasks: number; gtin: number; images: number; sla15Pct: number }[];
  daily: { date: string; tasks: number; gtin: number; images: number }[];
};
type GS1DataKartT = {
  tasks: number; gtin: number; withinTatPct: number; avgGtinPerTask: number;
  byAnalyst: { analyst: string; tasks: number; gtin: number; withinTatPct: number; avgGtin: number }[];
  daily: { date: string; tasks: number; gtin: number; withinTatPct: number }[];
};
type GS1ApprovalT = {
  totalSku: number; auditCount: number; auditErrors: number; errorRate: number; uniqueGcp: number;
  byCompany: { company: string; sku: number; audits: number; errors: number; errorPct: number }[];
  byAnalyst: { analyst: string; audits: number; errors: number; errorPct: number }[];
};

type GS1Sub = "overview" | "email" | "datakart" | "approval";

/** Each GS1 sub-tab drills into the day-wise (or company-wise) breakdown behind its KPIs. */
const gs1Trends = (f: Filters): Record<GS1Sub, DrillTrend> => {
  const params = { from: f.from, to: f.to };
  const dateCol: Col<Record<string, unknown>> = { h: "Date", k: "date", left: true, fmt: fmtDay };
  return {
    overview: {
      title: "Day-wise trend", queryKey: ["pld", "gs1", "overview", f], path: "gs1/overview", params,
      pick: raw => (raw as GS1OverviewT).daily as unknown as Record<string, unknown>[],
      emptyHint: "No daily data. Upload via Bulk Upload Hub → <em>GS1_EMAIL_DAILY / GS1_DATAKART_DAILY</em>.",
      cols: [dateCol, { h: "Email Tasks", k: "emailTasks" }, { h: "Data Kart Tasks", k: "dataKartTasks" }],
    },
    email: {
      title: "Day-wise email", queryKey: ["pld", "gs1", "email", f], path: "gs1/email", params,
      pick: raw => (raw as GS1EmailT).daily as unknown as Record<string, unknown>[],
      emptyHint: "No daily data. Upload via Bulk Upload Hub → <em>GS1_EMAIL_DAILY</em>.",
      cols: [dateCol, { h: "Tasks", k: "tasks" }, { h: "GTIN", k: "gtin" }, { h: "Images", k: "images" }],
    },
    datakart: {
      title: "Day-wise data kart", queryKey: ["pld", "gs1", "datakart", f], path: "gs1/datakart", params,
      pick: raw => (raw as GS1DataKartT).daily as unknown as Record<string, unknown>[],
      emptyHint: "No daily data. Upload via Bulk Upload Hub → <em>GS1_DATAKART_DAILY</em>.",
      cols: [dateCol, { h: "Tasks", k: "tasks" }, { h: "GTIN", k: "gtin" }],
    },
    approval: {
      title: "Company-wise approval", queryKey: ["pld", "gs1", "approval", f], path: "gs1/approval", params,
      pick: raw => (raw as GS1ApprovalT).byCompany as unknown as Record<string, unknown>[],
      emptyHint: "No company data. Upload via Bulk Upload Hub → <em>GS1_APPROVAL_AUDIT</em>.",
      cols: [
        { h: "Company", k: "company", left: true }, { h: "SKU", k: "sku" },
        { h: "Audits", k: "audits" }, { h: "Errors", k: "errors" },
        { h: "Error %", k: "errorPct", fmt: v => <PctBadge v={Number(v)} /> },
      ],
    },
  };
};

function GS1Dashboard({ f }: { f: Filters }) {
  const [sub, setSub] = useState<GS1Sub>("overview");
  const drill = useDrill();
  const trends = gs1Trends(f);
  const kpiDrill = (tab: GS1Sub) => (k: KpiSpec) => drill ? () => drill({ type: "kpi", label: k.label, value: k.value, sub: k.sub, trend: trends[tab] }) : undefined;
  const fmtD = fmtDay;

  const overviewQ = useQuery({ queryKey: ["pld", "gs1", "overview", f], queryFn: () => fetchLive<GS1OverviewT>("gs1/overview", { from: f.from, to: f.to }), staleTime: 2 * 60 * 1000 });
  const emailQ = useQuery({ queryKey: ["pld", "gs1", "email", f], queryFn: () => fetchLive<GS1EmailT>("gs1/email", { from: f.from, to: f.to }), staleTime: 2 * 60 * 1000, enabled: sub === "email" });
  const dataKartQ = useQuery({ queryKey: ["pld", "gs1", "datakart", f], queryFn: () => fetchLive<GS1DataKartT>("gs1/datakart", { from: f.from, to: f.to }), staleTime: 2 * 60 * 1000, enabled: sub === "datakart" });
  const approvalQ = useQuery({ queryKey: ["pld", "gs1", "approval", f], queryFn: () => fetchLive<GS1ApprovalT>("gs1/approval", { from: f.from, to: f.to }), staleTime: 2 * 60 * 1000, enabled: sub === "approval" });

  const subs: { key: GS1Sub; label: string }[] = [
    { key: "overview", label: "Overview" },
    { key: "email", label: "Email" },
    { key: "datakart", label: "Data Kart" },
    { key: "approval", label: "Approval" },
  ];

  return (
    <div>
      <div style={{ display: "flex", gap: 4, marginBottom: 14, flexWrap: "wrap" }}>
        {subs.map(s => (
          <button key={s.key} onClick={() => setSub(s.key)} style={{ height: 30, border: "none", borderRadius: 8, padding: "0 12px", fontSize: 12, fontWeight: 800, cursor: "pointer", transition: ".15s", background: sub === s.key ? "linear-gradient(135deg,#153f69,#2673a0)" : "#edf3f9", color: sub === s.key ? "#fff" : "#334155" }}>{s.label}</button>
        ))}
      </div>

      {/* OVERVIEW */}
      {sub === "overview" && (
        overviewQ.isLoading ? <Spinner /> : overviewQ.error || !overviewQ.data ? <Err msg="Failed to load GS1 overview" /> : (() => {
          const d = overviewQ.data;
          const kpis = [
            { label: "Email Tasks", value: d.emailTasks.toLocaleString(), sub: `${f.from} – ${f.to}`, color: KPIG[4] },
            { label: "Email GTIN", value: d.emailGtin.toLocaleString(), sub: "Total GTIN via email", color: KPIG[0] },
            { label: "Data Kart Tasks", value: d.dataKartTasks.toLocaleString(), sub: `${f.from} – ${f.to}`, color: KPIG[9] },
            { label: "Data Kart GTIN", value: d.dataKartGtin.toLocaleString(), sub: "Total GTIN via data kart", color: KPIG[3] },
            { label: "Approval SKU", value: d.approvalSku.toLocaleString(), sub: "SKU sent for approval", color: KPIG[1] },
            { label: "Audit Errors", value: d.auditErrors.toLocaleString(), sub: "Errors in audit", color: d.auditErrors > 0 ? KPIG[2] : KPIG[1] },
          ];
          return (
            <div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(6,minmax(0,1fr))", gap: 10, marginBottom: 16 }}>
                {kpis.map((k, i) => <KpiCard key={i} {...k} onClick={kpiDrill("overview")(k)} />)}
              </div>
              {d.daily && d.daily.length > 0 ? (
                <Panel title="Daily Email + Data Kart Trend (Tasks Stacked)">
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={d.daily}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis dataKey="date" tick={{ fontSize: 9 }} tickFormatter={fmtD} />
                      <YAxis tick={{ fontSize: 10 }} />
                      <Tooltip labelFormatter={fmtD} />
                      <Bar dataKey="emailTasks" fill="#2f6fed" name="Email Tasks" stackId="a" />
                      <Bar dataKey="dataKartTasks" fill="#10b8d4" name="Data Kart Tasks" stackId="a" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </Panel>
              ) : (
                <InfoBox html="<strong>No daily trend data.</strong> Upload GS1 data via Bulk Upload Hub → <em>GS1_EMAIL_DAILY / GS1_DATAKART_DAILY / GS1_APPROVAL_AUDIT</em>." />
              )}
            </div>
          );
        })()
      )}

      {/* EMAIL */}
      {sub === "email" && (
        emailQ.isLoading ? <Spinner /> : emailQ.error || !emailQ.data ? <Err msg="Failed to load GS1 email data" /> : (() => {
          const d = emailQ.data;
          const kpis = [
            { label: "Tasks Assigned", value: d.tasks.toLocaleString(), sub: `${f.from} – ${f.to}`, color: KPIG[4] },
            { label: "GTIN Processed", value: d.gtin.toLocaleString(), sub: "Total GTIN done", color: KPIG[0] },
            { label: "Images Uploaded", value: d.images.toLocaleString(), sub: "Product images", color: KPIG[9] },
            { label: "SLA ≤15min %", value: `${d.sla15Pct.toFixed(1)}%`, sub: "Target ≥ 80%", color: d.sla15Pct >= 80 ? KPIG[1] : KPIG[2] },
          ];
          return (
            <div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 10, marginBottom: 16 }}>
                {kpis.map((k, i) => <KpiCard key={i} {...k} onClick={kpiDrill("email")(k)} />)}
              </div>
              <SectionTitle title="By Analyst" />
              {d.byAnalyst.length === 0 ? (
                <InfoBox html="No analyst data. Upload GS1 data via Bulk Upload Hub → <em>GS1_EMAIL_DAILY</em>." />
              ) : (
                <Panel title="Analyst-wise Email Performance" sub={`${d.byAnalyst.length} analysts`}>
                  <DataTable cols={[
                    { h: "Analyst", k: "analyst" as const, left: true },
                    { h: "Tasks", k: "tasks" as const },
                    { h: "GTIN", k: "gtin" as const },
                    { h: "Images", k: "images" as const },
                    { h: "SLA %", k: "sla15Pct" as const, fmt: (v: unknown) => <PctBadge v={Number(v)} /> },
                  ]} rows={d.byAnalyst} />
                </Panel>
              )}
              <SectionTitle title="Day-wise" />
              {d.daily.length === 0 ? (
                <InfoBox html="No daily data. Upload GS1 data via Bulk Upload Hub → <em>GS1_EMAIL_DAILY</em>." />
              ) : (
                <Panel title="Daily Email Metrics" sub={`${d.daily.length} days`}>
                  <DataTable cols={[
                    { h: "Date", k: "date" as const, left: true, fmt: fmtD },
                    { h: "Tasks", k: "tasks" as const },
                    { h: "GTIN", k: "gtin" as const },
                    { h: "Images", k: "images" as const },
                  ]} rows={d.daily} />
                </Panel>
              )}
            </div>
          );
        })()
      )}

      {/* DATA KART */}
      {sub === "datakart" && (
        dataKartQ.isLoading ? <Spinner /> : dataKartQ.error || !dataKartQ.data ? <Err msg="Failed to load GS1 Data Kart data" /> : (() => {
          const d = dataKartQ.data;
          const kpis = [
            { label: "Data Received", value: d.tasks.toLocaleString(), sub: `${f.from} – ${f.to}`, color: KPIG[4] },
            { label: "GTIN Count", value: d.gtin.toLocaleString(), sub: "Total GTIN processed", color: KPIG[0] },
            { label: "Within TAT %", value: `${d.withinTatPct.toFixed(1)}%`, sub: "Target ≥ 80%", color: d.withinTatPct >= 80 ? KPIG[1] : KPIG[2] },
            { label: "Avg GTIN/Task", value: d.avgGtinPerTask.toFixed(1), sub: "GTIN per task", color: KPIG[9] },
          ];
          return (
            <div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 10, marginBottom: 16 }}>
                {kpis.map((k, i) => <KpiCard key={i} {...k} onClick={kpiDrill("datakart")(k)} />)}
              </div>
              <SectionTitle title="By Analyst" />
              {d.byAnalyst.length === 0 ? (
                <InfoBox html="No analyst data. Upload GS1 data via Bulk Upload Hub → <em>GS1_DATAKART_DAILY</em>." />
              ) : (
                <Panel title="Analyst-wise Data Kart Performance" sub={`${d.byAnalyst.length} analysts`}>
                  <DataTable cols={[
                    { h: "Analyst", k: "analyst" as const, left: true },
                    { h: "Tasks", k: "tasks" as const },
                    { h: "GTIN", k: "gtin" as const },
                    { h: "Within TAT %", k: "withinTatPct" as const, fmt: (v: unknown) => <PctBadge v={Number(v)} /> },
                    { h: "Avg GTIN/Task", k: "avgGtin" as const, fmt: (v: unknown) => Number(v).toFixed(1) },
                  ]} rows={d.byAnalyst} />
                </Panel>
              )}
              <SectionTitle title="Day-wise" />
              {d.daily.length === 0 ? (
                <InfoBox html="No daily data. Upload GS1 data via Bulk Upload Hub → <em>GS1_DATAKART_DAILY</em>." />
              ) : (
                <Panel title="Daily Data Kart Metrics" sub={`${d.daily.length} days`}>
                  <DataTable cols={[
                    { h: "Date", k: "date" as const, left: true, fmt: fmtD },
                    { h: "Tasks", k: "tasks" as const },
                    { h: "GTIN", k: "gtin" as const },
                  ]} rows={d.daily} />
                </Panel>
              )}
            </div>
          );
        })()
      )}

      {/* APPROVAL */}
      {sub === "approval" && (
        approvalQ.isLoading ? <Spinner /> : approvalQ.error || !approvalQ.data ? <Err msg="Failed to load GS1 Approval data" /> : (() => {
          const d = approvalQ.data;
          const kpis = [
            { label: "Total SKU", value: d.totalSku.toLocaleString(), sub: `${f.from} – ${f.to}`, color: KPIG[4] },
            { label: "Audit Count", value: d.auditCount.toLocaleString(), sub: "Total audits done", color: KPIG[0] },
            { label: "Audit Errors", value: d.auditErrors.toLocaleString(), sub: "Errors found", color: d.auditErrors > 0 ? KPIG[2] : KPIG[1] },
            { label: "Error Rate %", value: `${d.errorRate.toFixed(1)}%`, sub: "Target < 5%", color: d.errorRate < 5 ? KPIG[1] : KPIG[2] },
            { label: "Unique GCP", value: d.uniqueGcp.toLocaleString(), sub: "Distinct companies", color: KPIG[9] },
          ];
          return (
            <div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(5,minmax(0,1fr))", gap: 10, marginBottom: 16 }}>
                {kpis.map((k, i) => <KpiCard key={i} {...k} onClick={kpiDrill("approval")(k)} />)}
              </div>
              <SectionTitle title="By Company" />
              {d.byCompany.length === 0 ? (
                <InfoBox html="No company data. Upload GS1 data via Bulk Upload Hub → <em>GS1_APPROVAL_AUDIT</em>." />
              ) : (
                <Panel title="Company-wise Approval" sub={`${d.byCompany.length} companies`}>
                  <DataTable cols={[
                    { h: "Company", k: "company" as const, left: true },
                    { h: "SKU", k: "sku" as const },
                    { h: "Audits", k: "audits" as const },
                    { h: "Errors", k: "errors" as const },
                    { h: "Error %", k: "errorPct" as const, fmt: (v: unknown) => <PctBadge v={Number(v)} /> },
                  ]} rows={d.byCompany} />
                </Panel>
              )}
              <SectionTitle title="By Analyst" />
              {d.byAnalyst.length === 0 ? (
                <InfoBox html="No analyst data. Upload GS1 data via Bulk Upload Hub → <em>GS1_APPROVAL_AUDIT</em>." />
              ) : (
                <Panel title="Analyst-wise Audit" sub={`${d.byAnalyst.length} analysts`}>
                  <DataTable cols={[
                    { h: "Analyst", k: "analyst" as const, left: true },
                    { h: "Audits", k: "audits" as const },
                    { h: "Errors", k: "errors" as const },
                    { h: "Error %", k: "errorPct" as const, fmt: (v: unknown) => <PctBadge v={Number(v)} /> },
                  ]} rows={d.byAnalyst} />
                </Panel>
              )}
            </div>
          );
        })()
      )}
    </div>
  );
}

// ── Main Export ───────────────────────────────────────────────────────────────
export function DiallerLivePanel({ processName }: { processName: string }) {
  const [filters, setFilters] = useState<Filters>({ from: monthStart(), to: todayStr() });
  const [drillCtx, setDrillCtx] = useState<LiveDrillContext | null>(null);
  const proc = detectDiallerProcess(processName);

  if (!proc) {
    return (
      <div style={{ margin: "16px 0", padding: "16px 20px", background: "linear-gradient(135deg,#fff8e7,#fffaf0)", border: "1px solid #fde68a", borderRadius: 14, color: "#92400e", fontSize: 13, fontWeight: 700 }}>
        <strong>No live dialler data available</strong> for <em>{processName}</em>.
        <div style={{ marginTop: 6, fontWeight: 500, fontSize: 12 }}>Live dashboards are available for: BLA BLI BLU Inbound, Reginald Abandoned Cart, Molecular Email, Reginald Email, Finnable, Domestic Billing, GS1 India, GNC, Bella-Vita Organic, Clovia, Neemans, Viega, Exicom, DU Digital.</div>
      </div>
    );
  }

  return (
    <DrillDispatch.Provider value={setDrillCtx}>
      <div>
        <style>{DRILL_STYLES}</style>
        <DateRangeFilter f={filters} onChange={setFilters} />
        {proc === "inbound" && <InboundDashboard f={filters} />}
        {proc === "reginald-cart" && <ReginaldAllDashboard f={filters} />}
        {proc === "molecular-email" && <EmailAprDashboard proc="molecular-email" label="Molecular Email" campaign="MOEMAIL" f={filters} />}
        {proc === "reginald-email" && <EmailAprDashboard proc="reginald-email" label="Reginald Email" campaign="EMAIL" f={filters} />}
        {proc === "billing" && <BillingDashboard f={filters} />}
        {proc === "gs1" && <GS1Dashboard f={filters} />}
        {proc === "finnable"   && <EmailAprDashboard proc="finnable"        label="Finnable"              campaign="FINNABLE" f={filters} />}
        {proc === "gnc"        && <InboundCdrDashboard proc="gnc"           label="GNC"                   f={filters} />}
        {proc === "bella-vita" && <InboundCdrDashboard proc="bella-vita"    label="Bella-Vita Organic"    f={filters} />}
        {proc === "clovia"     && <InboundCdrDashboard proc="clovia"        label="Clovia"                f={filters} />}
        {proc === "neemans"    && <InboundCdrDashboard proc="neemans"       label="Neemans Private Limited" f={filters} />}
        {proc === "viega"      && <InboundCdrDashboard proc="viega"         label="Viega"                 f={filters} />}
        {proc === "exicom"     && <InboundCdrDashboard proc="exicom"        label="Exicom"                f={filters} />}
        {proc === "du-digital" && <InboundCdrDashboard proc="du-digital"    label="DU Digital"            f={filters} />}
        <LiveDetailDrawer ctx={drillCtx} processName={processName} onClose={() => setDrillCtx(null)} />
      </div>
    </DrillDispatch.Provider>
  );
}
