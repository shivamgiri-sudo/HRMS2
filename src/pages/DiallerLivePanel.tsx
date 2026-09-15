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

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell,
  Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis
} from "recharts";
import { hrmsApi } from "@/lib/hrmsApi";
import { getAuthToken } from "@/lib/hrmsApi";

// ── Types ─────────────────────────────────────────────────────────────────────
type DiallerProcess = "inbound" | "reginald-cart" | "molecular-email" | "reginald-email" | null;
interface Filters { from: string; to: string }

// ── Process detection ─────────────────────────────────────────────────────────
export function detectDiallerProcess(processName: string): DiallerProcess {
  const n = processName.toLowerCase();
  // Inbound (BLA BLI BLU, B-3, Inbound Customer Services, etc.)
  if (n.includes("bla") || n.includes("bli") || n.includes("blu") || n.includes("b-3") || n.includes("b3 ") || n.includes("b3_")) return "inbound";
  // Inbound by exact keywords (not Reginald)
  if ((n.includes("inbound") || n.includes("cdr_in")) && !n.includes("reginald")) return "inbound";
  // Reginald Email specifically (if process explicitly named with "email")
  if (n.includes("reginald") && n.includes("email")) return "reginald-email";
  // Molecular Email
  if (n.includes("molecular")) return "molecular-email";
  // Reginald (alone or with cart/abandon/abc/men) → cart dashboard which now includes email APR
  if (n.includes("reginald")) return "reginald-cart";
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

function KpiCard({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color: string }) {
  return (
    <div style={{ position: "relative", minHeight: 96, padding: "12px 14px", borderRadius: 15, color: "#fff", overflow: "hidden", boxShadow: "0 10px 24px rgba(16,35,57,.10)", background: color }}>
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
function DataTable<T extends Record<string, unknown>>({ cols, rows }: { cols: Col<T>[]; rows: T[] }) {
  return (
    <div style={{ overflowX: "auto", maxHeight: 520, border: "1px solid #dce4ed", borderRadius: 11, background: "#fff" }}>
      <table style={{ borderCollapse: "separate", borderSpacing: 0, width: "100%", fontSize: 12, whiteSpace: "nowrap" }}>
        <thead>
          <tr>{cols.map((c, i) => <th key={i} style={{ position: "sticky", top: 0, background: "linear-gradient(180deg,#15365e,#102550)", color: "#fff", padding: "10px 8px", fontWeight: 900, fontSize: 11, textAlign: c.left ? "left" : "right", zIndex: 2 }}>{c.h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.length === 0 ? <tr><td colSpan={cols.length} style={{ padding: 40, textAlign: "center", color: "#697586" }}>No data</td></tr>
            : rows.map((row, i) => (
              <tr key={i}>{cols.map((c, j) => (
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

function InboundDashboard({ f }: { f: Filters }) {
  const [sub, setSub] = useState<IBSub>("overview");
  const [hDate, setHDate] = useState(todayStr());
  const fmtD = (v: unknown) => { const d = new Date(String(v ?? "")); return isNaN(d.getTime()) ? String(v ?? "") : d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" }); };

  const summQ = useQuery({ queryKey: ["pld", "ib", "summary", f], queryFn: () => fetchLive<IBSummary>("inbound/summary", { from: f.from, to: f.to }), staleTime: 2 * 60 * 1000 });
  const monthQ = useQuery({ queryKey: ["pld", "ib", "monthly", f], queryFn: () => fetchLive<IBMonthRow[]>("inbound/monthly", { from: f.from, to: f.to }), staleTime: 2 * 60 * 1000, enabled: sub === "monthly" });
  const dayQ = useQuery({ queryKey: ["pld", "ib", "daily", f], queryFn: () => fetchLive<IBDayRow[]>("inbound/daily", { from: f.from, to: f.to }), staleTime: 2 * 60 * 1000, enabled: sub === "daily" });
  const slotQ = useQuery({ queryKey: ["pld", "ib", "hourly", hDate], queryFn: () => fetchLive<IBSlotRow[]>("inbound/hourly", { date: hDate }), staleTime: 2 * 60 * 1000, enabled: sub === "hourly" });
  const agentQ = useQuery({ queryKey: ["pld", "ib", "agents", f], queryFn: () => fetchLive<IBAgentRow[]>("inbound/agents", { from: f.from, to: f.to }), staleTime: 2 * 60 * 1000, enabled: sub === "agents" });
  const aprQ = useQuery({ queryKey: ["pld", "ib", "apr", f], queryFn: () => fetchLive<{ user: string; aprCalls: number; netLoginTime: string; talk: string; wait: string; dispo: string; pause: string; lbTime: string; tbTime: string; wbTime: string; utilization: number }[]>("inbound/apr", { from: f.from, to: f.to }), staleTime: 2 * 60 * 1000, enabled: sub === "apr" });
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
                    color={i === 7 ? (d.sl >= 80 ? KPIG[1] : KPIG[2]) : i === 8 ? (d.al >= 80 ? KPIG[1] : KPIG[2]) : KPIG[i % KPIG.length]} />
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
                <Panel title="Time Breakdown (Handled calls, seconds)">
                  <ResponsiveContainer width="100%" height={200}><BarChart data={[{ name: "Talk", value: d.handledTalkSec ?? 0 }, { name: "Hold", value: d.holdSec ?? 0 }, { name: "ACW", value: d.handledAcwSec ?? 0 }]}><CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" /><XAxis dataKey="name" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} /><Tooltip /><Bar dataKey="value" fill="#2f6fed" radius={[5, 5, 0, 0]} /></BarChart></ResponsiveContainer>
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
              <ResponsiveContainer width="100%" height={200}><LineChart data={monthQ.data}><CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" /><XAxis dataKey="month" tick={{ fontSize: 10 }} /><YAxis domain={[0, 100]} tick={{ fontSize: 10 }} /><Tooltip formatter={(v: unknown) => `${Number(v).toFixed(1)}%`} /><Line type="monotone" dataKey="sl" stroke="#2f6fed" strokeWidth={2} name="SL%" dot={false} /><Line type="monotone" dataKey="al" stroke="#10b981" strokeWidth={2} name="AL%" dot={false} /></LineChart></ResponsiveContainer>
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
                <ResponsiveContainer width="100%" height={200}><LineChart data={dayQ.data}><CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" /><XAxis dataKey="date" tick={{ fontSize: 9 }} tickFormatter={fmtD} /><YAxis domain={[0, 100]} tick={{ fontSize: 10 }} /><Tooltip /><Line type="monotone" dataKey="sl" stroke="#2f6fed" strokeWidth={2} name="SL%" dot={false} /><Line type="monotone" dataKey="al" stroke="#10b981" strokeWidth={2} name="AL%" dot={false} /></LineChart></ResponsiveContainer>
              </Panel>
              <Panel title="Daily Call Volume">
                <ResponsiveContainer width="100%" height={200}><BarChart data={dayQ.data}><CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" /><XAxis dataKey="date" tick={{ fontSize: 9 }} tickFormatter={fmtD} /><YAxis tick={{ fontSize: 10 }} /><Tooltip /><Bar dataKey="offered" fill="#93c5fd" name="Offered" /><Bar dataKey="handled" fill="#2f6fed" name="Handled" /></BarChart></ResponsiveContainer>
              </Panel>
            </div>
            <Panel title="Day-wise Metric Matrix" sub={`${dayQ.data.length} days`}>
              <DataTable<IBDayRow> cols={[
                { h: "Date", k: "date", left: true, fmt: fmtD }, { h: "Offered", k: "offered" }, { h: "Answered", k: "handled" },
                { h: "SL%", k: "sl", fmt: v => <PctBadge v={Number(v)} /> }, { h: "AL%", k: "al", fmt: v => <PctBadge v={Number(v)} /> },
                { h: "AHT Sec", k: "ahtSec" }, { h: "Talk Time", k: "talkTime" }, { h: "Call Dur/Offered", k: "callDurationSec" },
              ]} rows={dayQ.data} />
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
                { h: "Talk Sec", k: "handledTalkSec" }, { h: "Hold Sec", k: "holdSec" },
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
                {sc.map(([k, color]) => <KpiCard key={k} label={k.charAt(0).toUpperCase() + k.slice(1)} value={((t as Record<string, number>)[k] ?? 0).toLocaleString()} sub={t.total > 0 ? `${(((t as Record<string, number>)[k] ?? 0) / t.total * 100).toFixed(1)}% of total` : ""} color={color} />)}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
                {sc.slice(0, 4).map(([k, color]) => (
                  <Panel key={k} title={`Day-wise ${k.charAt(0).toUpperCase() + k.slice(1)}`}>
                    <ResponsiveContainer width="100%" height={160}><BarChart data={dispoQ.data.daily}><CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" /><XAxis dataKey="date" tick={{ fontSize: 9 }} tickFormatter={fmtD} /><YAxis tick={{ fontSize: 9 }} /><Tooltip /><Bar dataKey={k} fill={color} radius={[3, 3, 0, 0]} /></BarChart></ResponsiveContainer>
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
                    {[{ label: "Total Handled", value: repeatQ.data.totals.total.toLocaleString(), color: KPIG[0] }, { label: "Unique Callers", value: repeatQ.data.totals.unique.toLocaleString(), color: KPIG[1] }, { label: "Repeat Calls", value: repeatQ.data.totals.repeat.toLocaleString(), color: KPIG[2] }, { label: "Repeat %", value: `${repeatQ.data.totals.repeatPct.toFixed(1)}%`, color: KPIG[6] }].map((k, i) => <KpiCard key={i} {...k} />)}
                  </div>
                  <Panel title="Daily Repeat Contribution">
                    <ResponsiveContainer width="100%" height={200}><AreaChart data={repeatQ.data.daily}><CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" /><XAxis dataKey="date" tick={{ fontSize: 9 }} tickFormatter={fmtD} /><YAxis tick={{ fontSize: 9 }} /><Tooltip /><Area type="monotone" dataKey="total" stroke="#93c5fd" fill="#dbeafe" name="Total" /><Area type="monotone" dataKey="repeat" stroke="#e5484d" fill="#fee2e2" name="Repeat" /></AreaChart></ResponsiveContainer>
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
type CartAnalystT = { analyst: string; loginDays: number; totalDialed: number; uniqueDialed: number; uniqueConnected: number; connectPct: number; lt30: number; ge30: number; avgTalk: string; aht: string; avgWrap: string; avgWait: string; netLoginTime: string; utilization: number };

type CartSub = "sales" | "overview" | "monthly" | "daily" | "analysts" | "apr" | "email-apr";

interface CartSalesT {
  from: string; to: string;
  orders: number; revenue: number; aov: number;
  prepaid: number; cod: number; prepaidPct: number; codPct: number;
  byAgent: { empId: string; agentName: string; orders: number; revenue: number; aov: number }[];
  daily: { date: string; orders: number; revenue: number; aov: number; prepaid: number; cod: number; prepaidPct: number; codPct: number }[];
}

function CartDashboard({ f }: { f: Filters }) {
  const [sub, setSub] = useState<CartSub>("sales");
  const fmtD = (v: unknown) => { const d = new Date(String(v ?? "")); return isNaN(d.getTime()) ? String(v ?? "") : d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" }); };
  const summQ = useQuery({ queryKey: ["pld", "cart", "summary", f], queryFn: () => fetchLive<CartSummaryT>("reginald-cart/summary", { from: f.from, to: f.to }), staleTime: 2 * 60 * 1000 });
  const dayQ = useQuery({ queryKey: ["pld", "cart", "daily", f], queryFn: () => fetchLive<CartDayT[]>("reginald-cart/daily", { from: f.from, to: f.to }), staleTime: 2 * 60 * 1000, enabled: sub === "daily" });
  const monthQ = useQuery({ queryKey: ["pld", "cart", "monthly", f], queryFn: () => fetchLive<{ month: string; monthLabel: string; totalDialed: number; uniqueDialed: number; uniqueConnected: number; connectPct: number; loginCount: number; avgTalk: string; aht: string; avgWrap: string }[]>("reginald-cart/monthly", { from: f.from, to: f.to }), staleTime: 2 * 60 * 1000, enabled: sub === "monthly" });
  const analystQ = useQuery({ queryKey: ["pld", "cart", "analysts", f], queryFn: () => fetchLive<CartAnalystT[]>("reginald-cart/analysts", { from: f.from, to: f.to }), staleTime: 2 * 60 * 1000, enabled: sub === "analysts" });
  const aprQ = useQuery({ queryKey: ["pld", "cart", "apr", f], queryFn: () => fetchLive<{ user: string; aprCalls: number; netLoginTime: string; talk: string; wait: string; dispo: string; pause: string; lbTime: string; tbTime: string; wbTime: string; utilization: number }[]>("reginald-cart/apr", { from: f.from, to: f.to }), staleTime: 2 * 60 * 1000, enabled: sub === "apr" });
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
              {kpis.map((k, i) => <KpiCard key={i} {...k} />)}
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
      {sub === "monthly" && (monthQ.isLoading ? <Spinner /> : monthQ.error || !monthQ.data ? <Err msg="Failed" /> : (
        <Panel title="Monthly Performance">
          <DataTable cols={[{ h: "Month", k: "monthLabel" as const, left: true }, { h: "Total CDR", k: "totalDialed" as const }, { h: "Unique Dialled", k: "uniqueDialed" as const }, { h: "Unique Connected", k: "uniqueConnected" as const }, { h: "Connect%", k: "connectPct" as const, fmt: (v: unknown) => <PctBadge v={Number(v)} /> }, { h: "Avg Daily Login", k: "loginCount" as const }, { h: "Avg Talk", k: "avgTalk" as const }, { h: "AHT", k: "aht" as const }, { h: "Avg Wrap", k: "avgWrap" as const }]} rows={monthQ.data} />
        </Panel>
      ))}
      {sub === "analysts" && (analystQ.isLoading ? <Spinner /> : analystQ.error || !analystQ.data ? <Err msg="Failed to load analysts" /> : (
        <Panel title="Analyst-wise Performance (CDR + APR)" sub={`${analystQ.data.length} analysts`}>
          <DataTable<CartAnalystT> cols={[{ h: "Analyst", k: "analyst", left: true }, { h: "Login Days", k: "loginDays" }, { h: "Total CDR", k: "totalDialed" }, { h: "Unique Dialled", k: "uniqueDialed" }, { h: "Unique Connected", k: "uniqueConnected" }, { h: "Connect%", k: "connectPct", fmt: v => <PctBadge v={Number(v)} /> }, { h: "<30s", k: "lt30" }, { h: "≥30s", k: "ge30" }, { h: "Avg Talk", k: "avgTalk" }, { h: "AHT", k: "aht" }, { h: "Avg Wrap", k: "avgWrap" }, { h: "Avg Wait", k: "avgWait" }, { h: "Net Login", k: "netLoginTime" }, { h: "Utilization", k: "utilization", fmt: v => <PctBadge v={Number(v)} /> }]} rows={analystQ.data} />
        </Panel>
      ))}
      {sub === "apr" && (aprQ.isLoading ? <Spinner /> : aprQ.error || !aprQ.data ? <Err msg="Failed to load APR" /> : (
        <Panel title="Agent Productivity Report (APR)" sub={`${aprQ.data.length} agents`}>
          <DataTable cols={[{ h: "Agent ID", k: "user" as const, left: true }, { h: "APR Calls", k: "aprCalls" as const }, { h: "Net Login", k: "netLoginTime" as const }, { h: "Talk", k: "talk" as const }, { h: "Wait", k: "wait" as const }, { h: "Dispo", k: "dispo" as const }, { h: "Pause", k: "pause" as const }, { h: "LB", k: "lbTime" as const }, { h: "TB", k: "tbTime" as const }, { h: "WB", k: "wbTime" as const }, { h: "Utilization", k: "utilization" as const, fmt: (v: unknown) => <PctBadge v={Number(v)} /> }]} rows={aprQ.data} />
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
              {salesKpis.map((k, i) => <KpiCard key={i} {...k} />)}
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
          <InfoBox html="<strong>Reginald Email APR</strong> — Analyst time from <code>vicidial_agent_log_10_25</code> campaign <code>EMAIL</code>. Email ticket counts (received, closed, pending, reopen) need to be uploaded via Bulk Upload Hub → <em>EMAIL_TICKET_DAILY</em>." />
          {emailAprSummQ.isLoading ? <Spinner /> : emailAprSummQ.error || !emailAprSummQ.data ? <Err msg="Failed to load email APR summary" /> : (() => {
            const d = emailAprSummQ.data;
            return (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(5,minmax(0,1fr))", gap: 10, marginBottom: 14 }}>
                {[
                  { label: "Agents Active", value: d.agentCount, color: KPIG[0] },
                  { label: "Total Login", value: d.totalLoginTime, color: KPIG[4] },
                  { label: "Total Talk", value: d.totalTalk, color: "linear-gradient(135deg,#047857,#10b981)" },
                  { label: "Total Pause", value: d.totalPause, sub: `LB: ${d.totalLbTime} · TB: ${d.totalTbTime}`, color: KPIG[5] },
                  { label: "Avg Utilization", value: `${d.avgUtilization.toFixed(1)}%`, color: d.avgUtilization >= 70 ? "linear-gradient(135deg,#047857,#10b981)" : KPIG[5] },
                ].map((k, i) => <KpiCard key={i} {...k} />)}
              </div>
            );
          })()}
          {emailAprAgentsQ.isLoading ? <Spinner /> : emailAprAgentsQ.error || !emailAprAgentsQ.data ? <Err msg="Failed to load email agents" /> : (
            <Panel title="Email Analyst APR" sub={`${emailAprAgentsQ.data.length} agents`}>
              <DataTable<EmailAprAgentRow> cols={[
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
type EmailAprAgentRow = { user: string; aprCalls: number; netLoginTime: string; talk: string; wait: string; dispo: string; pause: string; lbTime: string; tbTime: string; wbTime: string; totalBreak: string; acht: string; utilization: number };

function EmailAprDashboard({ proc, label, campaign, f }: { proc: "molecular-email" | "reginald-email"; label: string; campaign: string; f: Filters }) {
  const [sub, setSub] = useState<"overview" | "daily" | "agents">("overview");
  const summQ = useQuery({ queryKey: ["pld", proc, "summary", f], queryFn: () => fetchLive<{ totalLoginTime: string; totalTalk: string; totalPause: string; totalLbTime: string; totalTbTime: string; totalWbTime: string; avgUtilization: number; agentCount: number }>(`${proc}/summary`, { from: f.from, to: f.to }), staleTime: 2 * 60 * 1000 });
  const agentQ = useQuery({ queryKey: ["pld", proc, "agents", f], queryFn: () => fetchLive<EmailAprAgentRow[]>(`${proc}/agents`, { from: f.from, to: f.to }), staleTime: 2 * 60 * 1000, enabled: sub === "agents" });
  const dailyQ = useQuery({ queryKey: ["pld", proc, "daily", f], queryFn: () => fetchLive<{ date: string; loginTime: string; talk: string; wait: string; dispo: string; pause: string; utilization: number; agentCount: number }[]>(`${proc}/daily`, { from: f.from, to: f.to }), staleTime: 2 * 60 * 1000, enabled: sub === "daily" });

  return (
    <div>
      <InfoBox html={`<strong>${label}</strong> — APR from <code>vicidial_agent_log_10_25</code> campaign <code>${campaign}</code>. Email ticket metrics (received, closed, pending, closure%) require <code>molecular_db_email</code> on 122.184.128.89 — shown separately in the GAS dashboard.`} />
      <div style={{ display: "flex", gap: 4, marginBottom: 14 }}>
        {(["overview", "daily", "agents"] as const).map(t => <button key={t} onClick={() => setSub(t)} style={{ height: 30, border: "none", borderRadius: 8, padding: "0 12px", fontSize: 12, fontWeight: 800, cursor: "pointer", transition: ".15s", background: sub === t ? "linear-gradient(135deg,#153f69,#2673a0)" : "#edf3f9", color: sub === t ? "#fff" : "#334155" }}>{t.charAt(0).toUpperCase() + t.slice(1)}</button>)}
      </div>
      {sub === "overview" && (summQ.isLoading ? <Spinner /> : summQ.error || !summQ.data ? <Err msg="Failed to load summary" /> : (() => {
        const d = summQ.data;
        return <div style={{ display: "grid", gridTemplateColumns: "repeat(5,minmax(0,1fr))", gap: 10 }}>{[{ label: "Agents Active", value: d.agentCount, color: KPIG[0] }, { label: "Total Login", value: d.totalLoginTime, color: KPIG[4] }, { label: "Total Talk", value: d.totalTalk, color: "linear-gradient(135deg,#047857,#10b981)" }, { label: "Total Pause", value: d.totalPause, sub: `LB: ${d.totalLbTime} · TB: ${d.totalTbTime}`, color: KPIG[5] }, { label: "Avg Utilization", value: `${d.avgUtilization.toFixed(1)}%`, color: d.avgUtilization >= 70 ? "linear-gradient(135deg,#047857,#10b981)" : KPIG[5] }].map((k, i) => <KpiCard key={i} {...k} />)}</div>;
      })())}
      {sub === "daily" && (dailyQ.isLoading ? <Spinner /> : dailyQ.error || !dailyQ.data ? <Err msg="Failed" /> : (
        <Panel title="Daily APR" sub={`${dailyQ.data.length} days`}>
          <DataTable cols={[{ h: "Date", k: "date" as const, left: true, fmt: (v: unknown) => new Date(String(v)).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) }, { h: "Login Time", k: "loginTime" as const }, { h: "Talk", k: "talk" as const }, { h: "Wait", k: "wait" as const }, { h: "Dispo", k: "dispo" as const }, { h: "Pause", k: "pause" as const }, { h: "Agents", k: "agentCount" as const }, { h: "Utilization", k: "utilization" as const, fmt: (v: unknown) => <PctBadge v={Number(v)} /> }]} rows={dailyQ.data} />
        </Panel>
      ))}
      {sub === "agents" && (agentQ.isLoading ? <Spinner /> : agentQ.error || !agentQ.data ? <Err msg="Failed to load agents" /> : (
        <Panel title={`${label} — Analyst APR`} sub={`${agentQ.data.length} agents`}>
          <DataTable<EmailAprAgentRow> cols={[{ h: "Agent ID", k: "user", left: true }, { h: "Calls", k: "aprCalls" }, { h: "Net Login", k: "netLoginTime" }, { h: "Talk", k: "talk" }, { h: "Wait", k: "wait" }, { h: "Dispo", k: "dispo" }, { h: "Pause", k: "pause" }, { h: "LB", k: "lbTime" }, { h: "TB", k: "tbTime" }, { h: "WB", k: "wbTime" }, { h: "Total Break", k: "totalBreak" }, { h: "ACHT", k: "acht" }, { h: "Utilization", k: "utilization", fmt: v => <PctBadge v={Number(v)} /> }]} rows={agentQ.data} />
        </Panel>
      ))}
    </div>
  );
}

// ── Main Export ───────────────────────────────────────────────────────────────
export function DiallerLivePanel({ processName }: { processName: string }) {
  const [filters, setFilters] = useState<Filters>({ from: monthStart(), to: todayStr() });
  const proc = detectDiallerProcess(processName);

  if (!proc) {
    return (
      <div style={{ margin: "16px 0", padding: "16px 20px", background: "linear-gradient(135deg,#fff8e7,#fffaf0)", border: "1px solid #fde68a", borderRadius: 14, color: "#92400e", fontSize: 13, fontWeight: 700 }}>
        <strong>No live dialler data available</strong> for <em>{processName}</em>.
        <div style={{ marginTop: 6, fontWeight: 500, fontSize: 12 }}>Live dashboards are available for: BLA BLI BLU Inbound, Reginald Abandoned Cart, Molecular Email (APR), Reginald Email (APR).</div>
      </div>
    );
  }

  return (
    <div>
      <DateRangeFilter f={filters} onChange={setFilters} />
      {proc === "inbound" && <InboundDashboard f={filters} />}
      {proc === "reginald-cart" && <CartDashboard f={filters} />}
      {proc === "molecular-email" && <EmailAprDashboard proc="molecular-email" label="Molecular Email" campaign="MOEMAIL" f={filters} />}
      {proc === "reginald-email" && <EmailAprDashboard proc="reginald-email" label="Reginald Email" campaign="EMAIL" f={filters} />}
    </div>
  );
}
