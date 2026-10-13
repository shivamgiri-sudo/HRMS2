// Small presentational pieces for the GS1 dashboard (inline styles, matching DiallerLivePanel).
import type React from "react";
import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import type { Gs1Labelled } from "./gs1Types";
import { STATUS_COLOR } from "./gs1Format";

const PALETTE = ["#2f6fed", "#0ea5b7", "#7c5ce5", "#f59e0b", "#10b981", "#f43f5e", "#64748b", "#db2777", "#0369a1", "#65a30d", "#b45309", "#475569", "#94a3b8"];

const CARD: React.CSSProperties = { background: "#fff", border: "1px solid #dce4ed", borderRadius: 14, boxShadow: "0 8px 22px rgba(16,35,57,.07)", padding: "12px 14px", minWidth: 0 };

export function Grid({ min = 160, gap = 10, children, style }: { min?: number; gap?: number; children: React.ReactNode; style?: React.CSSProperties }) {
  return <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fit,minmax(min(${min}px,100%),1fr))`, gap, ...style }}>{children}</div>;
}

export function Box({ title, sub, children, style }: { title: string; sub?: string; children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ ...CARD, ...style }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
        <h4 style={{ margin: 0, color: "#102f4b", fontSize: 13, fontWeight: 800 }}>{title}</h4>
        {sub && <span style={{ fontSize: 10, fontWeight: 700, color: "#52667a" }}>{sub}</span>}
      </div>
      {children}
    </div>
  );
}

export function Kpi({ label, value, sub, accent = "#2f6fed", tone }: { label: string; value: string; sub?: string; accent?: string; tone?: "good" | "bad" }) {
  const muted = value === "N/A" || value === "No Data";
  return (
    <div style={{ ...CARD, borderTop: `3px solid ${accent}`, padding: "10px 12px" }}>
      <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: ".4px", fontWeight: 800, color: "#52667a" }}>{label}</div>
      <div style={{ fontSize: muted ? 16 : 21, fontWeight: 900, marginTop: 4, color: muted ? "#94a3b8" : tone === "bad" ? "#be123c" : tone === "good" ? "#047857" : "#102f4b" }}>{value}</div>
      {sub && <div style={{ fontSize: 10, marginTop: 4, color: "#64748b", fontWeight: 600 }}>{sub}</div>}
    </div>
  );
}

export function Section({ title, color, children, right }: { title: string; color: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <section style={{ margin: "18px 0", padding: "12px 12px 14px", borderRadius: 16, background: "#f8fafc", border: "1px solid #e2e8f0", borderLeft: `5px solid ${color}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 900, color: "#102f4b" }}>{title}</h3>
        {right}
      </div>
      {children}
    </section>
  );
}

export function Note({ children, tone = "info" }: { children: React.ReactNode; tone?: "info" | "warn" }) {
  const c = tone === "warn" ? { bg: "#fffbeb", bd: "#fde68a", fg: "#92400e" } : { bg: "#eef7ff", bd: "#d6e9f8", fg: "#36536f" };
  return <div style={{ margin: "8px 0", padding: "8px 12px", background: c.bg, border: `1px solid ${c.bd}`, borderRadius: 10, color: c.fg, fontSize: 12, fontWeight: 600 }}>{children}</div>;
}

export function Empty({ text = "No Data for the selected filters." }: { text?: string }) {
  return <div style={{ height: 140, display: "flex", alignItems: "center", justifyContent: "center", color: "#94a3b8", fontSize: 12, fontWeight: 700, border: "1px dashed #cbd5e1", borderRadius: 10 }}>{text}</div>;
}

export function Donut({ data, height = 200 }: { data: Gs1Labelled[]; height?: number }) {
  if (!data.length || data.every(d => d.count === 0)) return <Empty />;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie data={data} dataKey="count" nameKey="label" innerRadius="52%" outerRadius="80%" paddingAngle={1}>
          {data.map((d, i) => <Cell key={d.label} fill={STATUS_COLOR[d.label] ?? PALETTE[i % PALETTE.length]} />)}
        </Pie>
        <Tooltip formatter={(v: number) => v.toLocaleString("en-IN")} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
      </PieChart>
    </ResponsiveContainer>
  );
}

export function HBars({ data, color = "#2f6fed", height, valueLabel = "Count" }: { data: Gs1Labelled[]; color?: string; height?: number; valueLabel?: string }) {
  if (!data.length) return <Empty />;
  const h = height ?? Math.max(140, data.length * 26 + 30);
  return (
    <ResponsiveContainer width="100%" height={h}>
      <BarChart data={data} layout="vertical" margin={{ left: 8, right: 16 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
        <XAxis type="number" tick={{ fontSize: 10 }} allowDecimals={false} />
        <YAxis type="category" dataKey="label" width={130} tick={{ fontSize: 10 }} />
        <Tooltip formatter={(v: number) => v.toLocaleString("en-IN")} />
        <Bar dataKey="count" name={valueLabel} fill={color} radius={4} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function SimpleTable<T extends object>({ cols, rows, max = 400 }: {
  cols: Array<{ h: string; get: (r: T) => React.ReactNode; left?: boolean }>; rows: T[]; max?: number;
}) {
  if (!rows.length) return <Empty />;
  return (
    <div style={{ maxHeight: max, overflow: "auto", border: "1px solid #e2e8f0", borderRadius: 10 }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead style={{ position: "sticky", top: 0, background: "#f1f5f9" }}>
          <tr>{cols.map(c => <th key={c.h} style={{ padding: "6px 8px", textAlign: c.left ? "left" : "right", color: "#334155", fontWeight: 800, whiteSpace: "nowrap" }}>{c.h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} style={{ borderTop: "1px solid #eef2f6" }}>
              {cols.map(c => <td key={c.h} style={{ padding: "5px 8px", textAlign: c.left ? "left" : "right", color: "#1e293b", whiteSpace: "nowrap" }}>{c.get(r)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
