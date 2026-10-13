/**
 * Shared pieces for the Reginald Abandoned Cart views: API types + fetch, the
 * common Campaign / Agent filter (one selection shared by every view), and the
 * small card / panel / table primitives styled like DiallerLivePanel.
 */
import { useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { getAuthToken } from "@/lib/hrmsApi";
import { fmtPctNA } from "./reginaldMetrics";

// ── API ──────────────────────────────────────────────────────────────────────
export interface CdrBlock {
  totalCdr: number; connected: number;
  uniqueDialed: number; uniqueContacted: number | null; uniqueConnected: number; uniqueQualified: number;
  connectPct: number; qualifiedPct: number; talkSec: number; avgTalkSec: number;
}
export interface AprBlock {
  talkSec: number; wrapSec: number; waitSec: number; pauseSec: number; deadSec: number;
  netLoginSec: number; utilization: number; agents: number; invalidDurationRows: number;
}
export interface Overview {
  cdr: CdrBlock; apr: AprBlock;
  sales: { orders: number; revenue: number };
  hourly: (CdrBlock & { hour: number })[];
  byCampaign: (CdrBlock & { campaign: string })[];
  agents: { code: string; name: string | null }[];
  campaigns: string[];
}
export interface DayRow extends CdrBlock, Omit<AprBlock, "talkSec"> {
  date: string; aprTalkSec: number; orders: number; revenue: number;
  eligibleDays: number; target: number; achievementPct: number | null; gap: number;
}
export interface AnalystDayRow {
  date: string; agent: string; agentName: string | null;
  attendanceStatus: string; eligibleDays: number; target: number;
  totalCdr: number; uniqueDialed: number; uniqueConnected: number; connectPct: number;
  connected: number; talkSec: number;
  aprTalkSec: number; wrapSec: number; waitSec: number; pauseSec: number; netLoginSec: number; utilization: number;
  orders: number; revenue: number; achievementPct: number | null; gap: number;
}
export interface Targets { dailyTarget: number; actualBasis: string; rows: AnalystDayRow[]; activityWithoutAttendance: number }
export interface MonthRow {
  month: string; monthLabel: string; hasData: boolean;
  cdr: CdrBlock; apr: AprBlock; orders: number; revenue: number;
  eligibleDays: number; target: number; achievementPct: number | null;
  byCampaign: (CdrBlock & { campaign: string })[];
  mom: { totalCdr: number | null; uniqueConnected: number | null; orders: number | null; revenue: number | null; connectPctPts: number | null };
}

export interface AgentRow extends CdrBlock { agent: string; agentName: string | null; apr: AprBlock }

export interface RegRange { from: string; to: string }

async function fetchReg<T>(path: string, params: Record<string, string>): Promise<T> {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString();
  const token = getAuthToken();
  const r = await fetch(`/api/process-live/reginald-cart/insights/${path}?${qs}`, {
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const d = await r.json() as { ok: boolean; data: T };
  if (!d.ok) throw new Error("API error");
  return d.data;
}

export function useInsight<T>(kind: "overview" | "daily" | "monthly" | "targets" | "agents", range: RegRange, enabled = true) {
  const flt = useReginaldFilters();
  const params = { from: range.from, to: range.to, campaign: flt.campaign, agent: flt.agent };
  return useQuery({
    queryKey: ["pld", "cart", "insights", kind, params],
    queryFn: () => fetchReg<T>(kind, params),
    staleTime: 2 * 60 * 1000,
    enabled,
  });
}

// ── Common filter (shared across the Reginald views) ─────────────────────────
type RegFilters = { campaign: string; agent: string };
let filters: RegFilters = { campaign: "", agent: "" };
const listeners = new Set<() => void>();
export function setReginaldFilters(patch: Partial<RegFilters>) {
  filters = { ...filters, ...patch };
  listeners.forEach(l => l());
}
export function useReginaldFilters(): RegFilters {
  return useSyncExternalStore(cb => { listeners.add(cb); return () => listeners.delete(cb); }, () => filters, () => filters);
}

const SELECT: CSSProperties = { height: 30, borderRadius: 8, border: "1px solid #cbd5e1", padding: "0 8px", fontSize: 12, fontWeight: 700, background: "#fff", color: "#102f4b" };

export function RegFilterBar({ range, note }: { range: RegRange; note?: string }) {
  const flt = useReginaldFilters();
  // Agent / campaign lists come from the overview, unfiltered by agent so the list never collapses to one.
  const listQ = useQuery({
    queryKey: ["pld", "cart", "insights", "overview", { from: range.from, to: range.to, campaign: "", agent: "" }],
    queryFn: () => fetchReg<Overview>("overview", { from: range.from, to: range.to }),
    staleTime: 2 * 60 * 1000,
  });
  const campaigns = listQ.data?.campaigns ?? ["ABANDON", "KANNADA", "KERALA", "TAMIL", "TELUGU"];
  const agents = listQ.data?.agents ?? [];
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
      <span style={{ fontSize: 11, fontWeight: 900, color: "#475569", textTransform: "uppercase", letterSpacing: ".4px" }}>Filters</span>
      <select aria-label="Campaign" style={SELECT} value={flt.campaign} onChange={e => setReginaldFilters({ campaign: e.target.value })}>
        <option value="">All campaigns</option>
        {campaigns.map(c => <option key={c} value={c}>{c}</option>)}
      </select>
      <select aria-label="Agent" style={SELECT} value={flt.agent} onChange={e => setReginaldFilters({ agent: e.target.value })}>
        <option value="">All agents</option>
        {agents.map(a => <option key={a.code} value={a.code}>{a.name ? `${a.name} (${a.code})` : a.code}</option>)}
      </select>
      {(flt.campaign || flt.agent) && (
        <button type="button" onClick={() => setReginaldFilters({ campaign: "", agent: "" })} style={{ ...SELECT, cursor: "pointer" }}>Clear</button>
      )}
      <span style={{ fontSize: 11, color: "#64748b", fontWeight: 600 }}>{range.from} to {range.to}{note ? ` · ${note}` : ""}</span>
    </div>
  );
}

// ── Palette (categorical, fixed order) ───────────────────────────────────────
export const SERIES = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"];
export const GRID = "#e2e8f0";
export const AXIS_TICK = { fontSize: 10, fill: "#52514e" };

// ── Primitives ───────────────────────────────────────────────────────────────
const CARD: CSSProperties = { background: "#fff", border: "1px solid #dce4ed", borderRadius: 17, boxShadow: "0 12px 30px rgba(16,35,57,.08)", padding: "14px 16px", position: "relative", overflow: "hidden" };
const KPI_BG = ["linear-gradient(135deg,#153f69,#1e6fa8)", "linear-gradient(135deg,#0369a1,#06b6d4)", "linear-gradient(135deg,#047857,#10b981)", "linear-gradient(135deg,#6d28d9,#8b5cf6)", "linear-gradient(135deg,#b45309,#f59e0b)", "linear-gradient(135deg,#334155,#64748b)"];

export function RegKpi({ label, value, sub, tone = 0, title, onClick }: { label: string; value: ReactNode; sub?: ReactNode; tone?: number; title?: string; onClick?: () => void }) {
  return (
    <div title={title} role={onClick ? "button" : undefined} tabIndex={onClick ? 0 : undefined} onClick={onClick}
      onKeyDown={onClick ? e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } } : undefined}
      style={{ position: "relative", minHeight: 88, padding: "12px 14px", borderRadius: 15, color: "#fff", overflow: "hidden", boxShadow: "0 10px 24px rgba(16,35,57,.10)", background: KPI_BG[tone % KPI_BG.length], cursor: onClick ? "pointer" : undefined }}>
      <div style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: ".45px", fontWeight: 900, opacity: 0.9 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 950, marginTop: 5, lineHeight: 1.1 }}>{value}</div>
      {sub && <div style={{ fontSize: 9, marginTop: 6, opacity: 0.9, fontWeight: 700 }}>{sub}</div>}
    </div>
  );
}

export function KpiGrid({ children, min = 150 }: { children: ReactNode; min?: number }) {
  return <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fill,minmax(${min}px,1fr))`, gap: 10, marginBottom: 14 }}>{children}</div>;
}

export function RegPanel({ title, sub, children, id }: { title: string; sub?: string; children: ReactNode; id?: string }) {
  return (
    <div id={id} style={{ ...CARD, marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, gap: 8, flexWrap: "wrap" }}>
        <h3 style={{ margin: 0, color: "#102f4b", fontSize: 14, fontWeight: 800 }}>{title}</h3>
        {sub && <span style={{ fontSize: 10, fontWeight: 800, color: "#0369a1", background: "#e7f6fb", border: "1px solid #c8edf5", borderRadius: 999, padding: "3px 8px" }}>{sub}</span>}
      </div>
      {children}
    </div>
  );
}

export function Grid2({ children }: { children: ReactNode }) {
  return <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(340px,1fr))", gap: 14 }}>{children}</div>;
}

export function Note({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "warn" }) {
  const warn = tone === "warn";
  return <div style={{ margin: "0 0 12px", padding: "8px 12px", borderRadius: 10, fontSize: 11.5, fontWeight: 600, background: warn ? "#fff8e7" : "#eef7ff", border: `1px solid ${warn ? "#f5d48a" : "#d6e9f8"}`, color: warn ? "#7a4b00" : "#36536f" }}>{children}</div>;
}

export function Loading() { return <div style={{ padding: 30, textAlign: "center", color: "#64748b", fontSize: 12 }}>Loading…</div>; }
export function Failed({ msg }: { msg: string }) {
  return <div style={{ margin: "10px 0", padding: "10px 14px", background: "#fff0f2", border: "1px solid #ffc2c2", borderRadius: 11, color: "#be123c", fontSize: 13 }}>{msg}</div>;
}

export function PctCell({ v }: { v: number | null }) {
  if (v === null) return <span style={{ color: "#64748b", fontWeight: 700 }}>N/A</span>;
  const ok = v >= 100, mid = v >= 80;
  return <span style={{ fontWeight: 900, color: ok ? "#15803d" : mid ? "#b45309" : "#b91c1c" }}>{fmtPctNA(v)}</span>;
}

export interface RegCol<T> { h: string; get: (r: T) => ReactNode; left?: boolean; title?: string }

export function RegTable<T>({ cols, rows, empty = "No data", foot }: { cols: RegCol<T>[]; rows: T[]; empty?: string; foot?: ReactNode[] }) {
  const cell = (left?: boolean): CSSProperties => ({ padding: "7px 8px", borderBottom: "1px solid #e8eef5", textAlign: left ? "left" : "right" });
  return (
    <div style={{ overflowX: "auto", maxHeight: 480, border: "1px solid #dce4ed", borderRadius: 11, background: "#fff" }}>
      <table style={{ borderCollapse: "separate", borderSpacing: 0, width: "100%", fontSize: 12, whiteSpace: "nowrap" }}>
        <thead><tr>{cols.map((c, i) => <th key={i} title={c.title} style={{ position: "sticky", top: 0, background: "linear-gradient(180deg,#15365e,#102550)", color: "#fff", padding: "9px 8px", fontWeight: 900, fontSize: 11, textAlign: c.left ? "left" : "right", zIndex: 1 }}>{c.h}</th>)}</tr></thead>
        <tbody>
          {rows.length === 0
            ? <tr><td colSpan={cols.length} style={{ padding: 30, textAlign: "center", color: "#697586" }}>{empty}</td></tr>
            : rows.map((r, i) => <tr key={i} style={{ background: i % 2 ? "#f8fafc" : "#fff" }}>{cols.map((c, j) => <td key={j} style={cell(c.left)}>{c.get(r)}</td>)}</tr>)}
        </tbody>
        {foot && rows.length > 0 && <tfoot><tr>{foot.map((f, i) => <td key={i} style={{ ...cell(cols[i]?.left), fontWeight: 900, background: "#eef3f9", position: "sticky", bottom: 0 }}>{f}</td>)}</tr></tfoot>}
      </table>
    </div>
  );
}

export const fmtN = (v: number) => Math.round(v).toLocaleString("en-IN");
export const fmtRs = (v: number) => `₹${Math.round(v).toLocaleString("en-IN")}`;
export function fmtDate(v: string): string {
  const d = new Date(`${v}T00:00:00`);
  return isNaN(d.getTime()) ? v : d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}
export function scrollToId(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}
