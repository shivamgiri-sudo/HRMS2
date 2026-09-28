import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import {
  type Column, type DetailPayload, type DetailSection, type DispoRow, type QualRow,
  QUALITY_PARAMS, dispoKpis, fmtDdMmYyyy, maskFreeText, maskPhone, nameFromLogin, pct, round2, sum,
} from "./clovia-lob.shared.js";

/**
 * Drill-down (slide-over) builders shared by every Clovia LOB dashboard, plus
 * the single-record view every record list opens.
 *
 * A record view shows every stored column of that one row EXCEPT: upload
 * bookkeeping (uploaded_by, upload_batch_id), the raw chat transcript (it is
 * free text that carries customer names, phone numbers and order details --
 * it stays in the source table) and -- for free-text remarks -- long digit runs
 * and e-mail addresses are masked. Phone-number columns are shown last-4 only.
 */

const HIDDEN_COLUMNS = new Set(["uploaded_by", "upload_batch_id", "chat_transcript"]);
const PHONE_COLUMNS = new Set(["phone_number"]);
const FREE_TEXT_COLUMNS = new Set(["comment", "aoi_if_any", "acpt_reason"]);

export type RecordTable = "cl_chat" | "cl_outbound" | "cl_dispo" | "cl_quality" | "cl_email_raw" | "cl_feedback" | "cl_rechurn_call" | "cl_apr";
const RECORD_TABLES = new Set<string>(["cl_chat", "cl_outbound", "cl_dispo", "cl_quality", "cl_email_raw", "cl_feedback", "cl_rechurn_call", "cl_apr"]);
export const RECORD_TYPE_TABLE: Record<string, RecordTable> = {
  chat: "cl_chat", call: "cl_outbound", ticket: "cl_dispo", audit: "cl_quality", emailrow: "cl_email_raw",
  feedback: "cl_feedback", rechurn: "cl_rechurn_call", apr: "cl_apr",
};

/** Every stored field of one row (see the masking rules above). */
export async function getRecord(recordType: string, id: number): Promise<DetailPayload | null> {
  const table = RECORD_TYPE_TABLE[recordType];
  if (!table || !RECORD_TABLES.has(table) || !Number.isFinite(id)) return null;
  const [rows] = await db.execute<RowDataPacket[]>(`SELECT * FROM db_masmis.\`${table}\` WHERE id = ? LIMIT 1`, [id]);
  const r = rows[0];
  if (!r) return null;
  const kv: NonNullable<DetailSection["kv"]> = [];
  for (const [col, raw] of Object.entries(r)) {
    if (HIDDEN_COLUMNS.has(col)) continue;
    let value: string | number | null = raw === null || raw === undefined || String(raw).trim() === "" ? null : String(raw);
    if (value !== null && PHONE_COLUMNS.has(col)) value = maskPhone(value);
    else if (value !== null && FREE_TEXT_COLUMNS.has(col)) value = maskFreeText(value);
    kv.push({ label: col.replace(/_/g, " "), value });
  }
  const sections: DetailSection[] = [{ title: "Record", type: "kv", kv }];
  if (table === "cl_chat") {
    sections.push({ title: "Transcript", type: "text", text: "The chat transcript is not exposed in the dashboard: it carries customer names, numbers and order details. It stays in db_masmis.cl_chat." });
  }
  const dateHint = String(r.report_date ?? r.audit_date ?? r.call_date ?? "");
  return {
    title: `${recordType.toUpperCase()} #${id}`,
    subtitle: dateHint ? `Source date ${dateHint}` : undefined,
    badge: { label: table, tone: "slate" },
    sections,
  };
}

/* ───────────────────────────── ticket (cl_dispo) drill-down ───────────────────────────── */

const RECORD_LIMIT = 200;

function dailyChart(rows: Array<{ date: string }>, key: string, title: string, color: string) {
  const m = new Map<string, number>();
  for (const r of rows) m.set(r.date, (m.get(r.date) ?? 0) + 1);
  return {
    key, title, tab: "", kind: "combo" as const, xKey: "date", xFmt: "date" as const,
    series: [{ key: "count", label: "Count", color, type: "bar" as const }],
    data: [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, count]) => ({ date, count })),
  };
}

const TICKET_COLS: Column[] = [
  { key: "date", label: "Date", align: "left" }, { key: "ticketNo", label: "Ticket", align: "left" }, { key: "agent", label: "Agent", align: "left" },
  { key: "reason", label: "Reason", align: "left" }, { key: "subReason", label: "Sub-reason", align: "left" }, { key: "qrc", label: "QRC", align: "left" },
  { key: "action", label: "Action", align: "left" }, { key: "ftr", label: "FTR", align: "left" },
];

export function dispoDetail(kind: string, key: string, all: DispoRow[]): DetailPayload | null {
  let rows: DispoRow[]; let title: string; let subtitle = "";
  switch (kind) {
    case "dispo_reason": rows = all.filter((r) => r.reason === key); title = `Tickets — ${key}`; break;
    case "dispo_skill": rows = all.filter((r) => r.skill === key); title = `Tickets — skill ${key}`; subtitle = "CRM ticket skill tag"; break;
    case "dispo_qrc": rows = all.filter((r) => r.qrc === key); title = `Tickets — ${key}`; subtitle = "Query / Request / Complaint"; break;
    case "dispo_action": rows = all.filter((r) => r.action === key); title = `Tickets — action: ${key}`; break;
    case "dispo_orderstatus": rows = all.filter((r) => r.orderStatus === key); title = `Tickets — order status: ${key}`; break;
    case "dispo_courier": rows = all.filter((r) => r.courier === key); title = `Tickets — courier: ${key}`; break;
    case "dispo_agent": rows = all.filter((r) => r.agentLogin === key); title = `Tickets — ${nameFromLogin(key)}`; break;
    case "dispo_sub": { const [a, b] = key.split("|"); rows = all.filter((r) => r.reason === a && r.subReason === b); title = `Tickets — ${a} › ${b}`; break; }
    default: return null;
  }
  const bySub = new Map<string, number>();
  const byAgent = new Map<string, number>();
  for (const r of rows) { bySub.set(`${r.reason} › ${r.subReason}`, (bySub.get(`${r.reason} › ${r.subReason}`) ?? 0) + 1); byAgent.set(r.agent, (byAgent.get(r.agent) ?? 0) + 1); }
  const chart = dailyChart(rows, "detail_day", "Tickets by day", "#6366f1");
  const sorted = [...rows].sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
  return {
    title, subtitle: subtitle || `${rows.length.toLocaleString("en-IN")} tickets in the selected range`,
    badge: { label: `${rows.length.toLocaleString("en-IN")} tickets`, tone: "blue" },
    sections: [
      { title: "Summary", type: "kpis", kpis: dispoKpis(rows, "") },
      { title: "Trend", type: "chart", chart },
      { title: "Sub-reasons", type: "table", table: { columns: [{ key: "label", label: "Reason › sub-reason", align: "left" }, { key: "count", label: "Tickets", fmt: "int" }], rows: [...bySub.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([label, count]) => ({ label, count })) }, empty: "No tickets." },
      { title: "Agents", type: "table", table: { columns: [{ key: "label", label: "Agent", align: "left" }, { key: "count", label: "Tickets", fmt: "int" }], rows: [...byAgent.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([label, count]) => ({ label, count })) }, empty: "No tickets." },
      {
        title: `Tickets (latest ${Math.min(rows.length, RECORD_LIMIT)} of ${rows.length})`, type: "table",
        table: { columns: TICKET_COLS, rows: sorted.slice(0, RECORD_LIMIT).map((r) => ({ id: r.id, date: fmtDdMmYyyy(r.date), ticketNo: r.ticketNo, agent: r.agent, reason: r.reason, subReason: r.subReason, qrc: r.qrc, action: r.action, ftr: r.ftr === "NA" ? "—" : r.ftr })), recordType: "ticket", keyField: "id" },
        empty: "No tickets.",
      },
    ],
  };
}

/* ───────────────────────────── quality (cl_quality) drill-down ───────────────────────────── */

const AUDIT_COLS: Column[] = [
  { key: "date", label: "Audited", align: "left" }, { key: "interaction", label: "Contact date", align: "left" }, { key: "agent", label: "Agent", align: "left" },
  { key: "query", label: "Query", align: "left" }, { key: "score", label: "Score", fmt: "pct" }, { key: "acpt", label: "Owner", align: "left" }, { key: "fatal", label: "Fatal", align: "left" },
];

export function qualityDetail(kind: string, key: string, all: QualRow[]): DetailPayload | null {
  let rows: QualRow[]; let title: string;
  const idx = QUALITY_PARAMS.findIndex((p) => p.key === key);
  switch (kind) {
    case "quality_param":
      if (idx < 0) return null;
      rows = all.filter((r) => r.params[idx] !== null); title = `Audits — ${QUALITY_PARAMS[idx].label}`; break;
    case "quality_acpt": rows = all.filter((r) => r.acpt === key); title = `Audits — root cause: ${key}`; break;
    case "quality_query": rows = all.filter((r) => r.cxQuery === key); title = `Audits — ${key}`; break;
    case "quality_aoi": rows = all.filter((r) => (r.aoi && !/^no error found\.?$/i.test(r.aoi) ? r.aoi : "No error found") === key); title = "Audits — area of improvement"; break;
    case "quality_agent": rows = all.filter((r) => (r.empId || r.empName) === key); title = `Audits — ${rows[0]?.empName ?? key}`; break;
    default: return null;
  }
  const scores = rows.map((r) => r.score);
  const sorted = [...rows].sort((a, b) => a.score - b.score || b.id - a.id);
  const failRows = idx >= 0 ? rows.filter((r) => r.params[idx] === 0) : [];
  const dayMap = new Map<string, number[]>();
  for (const r of rows) (dayMap.get(r.date) ?? dayMap.set(r.date, []).get(r.date)!).push(r.score);
  return {
    title, subtitle: kind === "quality_aoi" ? key : `${rows.length} audits · lowest scores first`,
    badge: { label: `${round2(scores.length ? sum(scores) / scores.length : 0)}% avg`, tone: scores.length && sum(scores) / scores.length >= 90 ? "green" : "amber" },
    sections: [
      { title: "Summary", type: "kv", kv: [
        { label: "Audits", value: rows.length, fmt: "int" },
        { label: "Average score", value: round2(scores.length ? sum(scores) / scores.length : 0), fmt: "pct" },
        { label: "Lowest score", value: scores.length ? Math.min(...scores) : null, fmt: "pct" },
        { label: "Fatal audits", value: rows.filter((r) => r.fatal).length, fmt: "int" },
        ...(idx >= 0 ? [{ label: "Zero-mark audits on this parameter", value: failRows.length, fmt: "int" as const }, { label: "Compliance", value: pct(rows.length - failRows.length, rows.length), fmt: "pct" as const }] : []),
      ] },
      { title: "Score by audit day", type: "chart", chart: {
        key: "q_day", title: "Average score by audit day", tab: "", kind: "combo", xKey: "date", xFmt: "date",
        series: [{ key: "avg", label: "Avg score", color: "#10b981", type: "line", fmt: "pct" }],
        data: [...dayMap.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, s]) => ({ date, avg: round2(sum(s) / s.length) })),
      } },
      {
        title: `Audits (${Math.min(rows.length, RECORD_LIMIT)} of ${rows.length})`, type: "table",
        table: { columns: AUDIT_COLS, rows: sorted.slice(0, RECORD_LIMIT).map((r) => ({ id: r.id, date: fmtDdMmYyyy(r.date), interaction: fmtDdMmYyyy(r.interactionDate), agent: r.empName, query: r.cxQuery, score: r.score, acpt: r.acpt, fatal: r.fatal ? "Yes" : "No" })), recordType: "audit", keyField: "id" },
        empty: "No audits.",
      },
    ],
  };
}
