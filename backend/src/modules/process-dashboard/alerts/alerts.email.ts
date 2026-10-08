/** Process Dashboard alerts -- e-mail / digest rendering (pure). Every interpolated value passes through escapeHtml; links are built from a trusted base + UUID only. */
import { COMPARATOR_LABEL, type Comparator } from "./alerts.evaluator.js";
import type { Severity } from "./alerts.types.js";

export const escapeHtml = (v: unknown): string => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const grp = (n: number, dp = 0): string => n.toLocaleString("en-IN", { minimumFractionDigits: dp, maximumFractionDigits: dp });
/** Same unit conventions as the dashboard tiles (seconds as m/s, hours, percent 1dp, currency with rupee sign). */
export function formatMetric(value: number | null | undefined, unit?: string): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  switch (unit) {
    case "percent": return `${grp(value, 1)}%`;
    case "seconds": { const s = Math.round(value); return s >= 60 ? `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s` : `${s}s`; }
    case "hours": return `${grp(value, 1)}h`;
    case "currency": return `₹${grp(value, 0)}`;
    case "ratio": return grp(value, 2);
    default: return Number.isInteger(value) ? grp(value) : grp(value, 1);
  }
}
export const dashboardLink = (baseUrl: string, processId: string, view?: "alerts"): string => `${baseUrl.replace(/\/+$/, "")}/performance/process-dashboard/${encodeURIComponent(processId)}${view ? `?view=${view}` : ""}`;

const SEV_COLOR: Record<Severity, string> = { info: "#2563eb", warn: "#b45309", critical: "#b91c1c" };
const SEV_LABEL: Record<Severity, string> = { info: "Info", warn: "Warning", critical: "Critical" };
const shell = (title: string, inner: string, footer: string): string =>
  `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:640px;margin:0 auto;color:#111827">` +
  `<div style="background:#0f172a;color:#fff;padding:16px 20px;border-radius:12px 12px 0 0"><div style="font-size:12px;letter-spacing:.04em;color:#94a3b8">MAS CALLNET • PROCESS DASHBOARD</div><div style="font-size:18px;font-weight:700;margin-top:4px">${escapeHtml(title)}</div></div>` +
  `<div style="border:1px solid #e5e7eb;border-top:0;padding:18px 20px;border-radius:0 0 12px 12px">${inner}<p style="margin:20px 0 0;font-size:12px;color:#6b7280">${footer}</p></div></div>`;
const btn = (href: string, label: string): string => `<p style="margin:18px 0 0"><a href="${escapeHtml(href)}" style="display:inline-block;background:#1d4ed8;color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:10px 18px;border-radius:8px">${escapeHtml(label)}</a></p>`;

export interface AlertMailInput { processLabel: string; ruleName: string; severity: Severity; message: string; metricLabel: string; metricValue: string; comparator?: Comparator; threshold?: string; dataDate: string; link: string; isTest?: boolean }
export function buildAlertEmail(i: AlertMailInput): { subject: string; html: string; text: string } {
  const subject = `${i.isTest ? "[TEST] " : ""}${SEV_LABEL[i.severity]} alert: ${i.ruleName} (${i.processLabel})`.slice(0, 200);
  const rows: Array<[string, string]> = [["Process", i.processLabel], ["Rule", i.ruleName], ["Metric", i.metricLabel], ["Value", i.metricValue]];
  if (i.comparator && i.threshold) rows.push(["Condition", `${COMPARATOR_LABEL[i.comparator]} ${i.threshold}`]);
  rows.push(["Data date", i.dataDate]);
  const table = rows.map(([k, v]) => `<tr><td style="padding:4px 14px 4px 0;font-size:13px;color:#6b7280">${escapeHtml(k)}</td><td style="padding:4px 0;font-size:13px;font-weight:600">${escapeHtml(v)}</td></tr>`).join("");
  const inner = `<p style="margin:0 0 12px"><span style="display:inline-block;background:${SEV_COLOR[i.severity]};color:#fff;font-size:12px;font-weight:700;padding:2px 10px;border-radius:999px">${escapeHtml(SEV_LABEL[i.severity])}</span>${i.isTest ? ' <span style="font-size:12px;color:#6b7280">test message, nothing has breached</span>' : ""}</p>` +
    `<p style="margin:0 0 12px;font-size:15px;line-height:1.5">${escapeHtml(i.message)}</p><table style="border-collapse:collapse">${table}</table>${btn(i.link, "Open alerts")}`;
  return { subject, html: shell(i.isTest ? "Test alert" : "Dashboard alert", inner, "You are receiving this because you are a recipient of this alert rule. Acknowledge it from the Alerts tab."),
    text: `${subject}\n\n${i.message}\n\n${rows.map(([k, v]) => `${k}: ${v}`).join("\n")}\n\nOpen: ${i.link}\n` };
}

export interface DigestData {
  processLabel: string; frequency: "daily" | "weekly"; range: { from: string; to: string }; link: string; openAlerts: number;
  kpis: Array<{ label: string; value: string; deltaPct: number | null; status: string; direction: "higher" | "lower" }>;
  anomalies: Array<{ severity: string; agent: string; detail: string }>;
  top: Array<{ agent: string; value: string }>; bottom: Array<{ agent: string; value: string }>; rankLabel: string; isTest?: boolean;
}
const deltaCell = (d: number | null, dir: "higher" | "lower"): string => {
  if (d === null || !Number.isFinite(d)) return '<span style="color:#6b7280">—</span>';
  const good = dir === "higher" ? d >= 0 : d <= 0; const arrow = d > 0 ? "▲" : d < 0 ? "▼" : "•";
  return `<span style="color:${d === 0 ? "#6b7280" : good ? "#047857" : "#b91c1c"};font-weight:600">${arrow} ${escapeHtml(`${d > 0 ? "+" : ""}${d.toFixed(1)}%`)}</span>`;
};
const list = (items: Array<{ agent: string; value: string }>): string => items.length
  ? `<table style="border-collapse:collapse;width:100%">${items.map((x) => `<tr><td style="padding:3px 0;font-size:13px">${escapeHtml(x.agent)}</td><td style="padding:3px 0;font-size:13px;text-align:right;font-weight:600">${escapeHtml(x.value)}</td></tr>`).join("")}</table>`
  : '<p style="margin:0;font-size:13px;color:#6b7280">Not enough data.</p>';
const h = (t: string): string => `<h3 style="margin:20px 0 8px;font-size:13px;letter-spacing:.03em;text-transform:uppercase;color:#374151">${escapeHtml(t)}</h3>`;

export function buildDigestEmail(d: DigestData): { subject: string; html: string; text: string } {
  const period = d.range.from === d.range.to ? d.range.to : `${d.range.from} to ${d.range.to}`;
  const subject = `${d.isTest ? "[TEST] " : ""}${d.frequency === "weekly" ? "Weekly" : "Daily"} digest: ${d.processLabel} (${period})`.slice(0, 200);
  const kpiRows = d.kpis.length ? d.kpis.map((k) => `<tr><td style="padding:5px 12px 5px 0;font-size:13px;border-bottom:1px solid #f3f4f6">${escapeHtml(k.label)}</td><td style="padding:5px 12px 5px 0;font-size:13px;font-weight:700;border-bottom:1px solid #f3f4f6">${escapeHtml(k.value)}</td><td style="padding:5px 0;font-size:13px;border-bottom:1px solid #f3f4f6">${deltaCell(k.deltaPct, k.direction)}</td></tr>`).join("")
    : '<tr><td style="font-size:13px;color:#6b7280">No KPI data for this period.</td></tr>';
  const an = d.anomalies.length ? `<ul style="margin:0;padding-left:18px">${d.anomalies.map((a) => `<li style="font-size:13px;margin:3px 0"><b style="color:${a.severity === "bad" ? "#b91c1c" : "#b45309"}">${escapeHtml(a.agent)}</b> — ${escapeHtml(a.detail)}</li>`).join("")}</ul>` : '<p style="margin:0;font-size:13px;color:#6b7280">No anomalies detected.</p>';
  const inner = `<p style="margin:0;font-size:13px;color:#6b7280">${escapeHtml(d.processLabel)} • ${escapeHtml(period)} • change is versus the previous equal period</p>` +
    (d.openAlerts > 0 ? `<p style="margin:12px 0 0;font-size:13px;background:#fef3c7;border-radius:8px;padding:8px 12px"><b>${escapeHtml(d.openAlerts)}</b> open alert${d.openAlerts === 1 ? "" : "s"} waiting to be acknowledged.</p>` : "") +
    `${h("Key metrics")}<table style="border-collapse:collapse;width:100%">${kpiRows}</table>${h("Anomalies")}${an}` +
    `${h(`Top performers (${d.rankLabel})`)}${list(d.top)}${h(`Needs attention (${d.rankLabel})`)}${list(d.bottom)}${btn(d.link, "Open dashboard")}`;
  const text = `${subject}\n\n${d.kpis.map((k) => `${k.label}: ${k.value}${k.deltaPct === null ? "" : ` (${k.deltaPct > 0 ? "+" : ""}${k.deltaPct.toFixed(1)}%)`}`).join("\n")}\n\nOpen alerts: ${d.openAlerts}\nAnomalies: ${d.anomalies.length}\n\nOpen: ${d.link}\n`;
  return { subject, html: shell(`${d.frequency === "weekly" ? "Weekly" : "Daily"} digest`, inner, "You are receiving this digest because you are a recipient for this process. Manage it from the Alerts tab."), text };
}
