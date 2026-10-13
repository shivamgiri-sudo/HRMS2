/**
 * GS1 India consolidated dashboard (GS1-01..05): one payload with the overall summary,
 * the Email / Data Card / Approval sections, the cross-LOB comparison, reconciliation,
 * data-quality exceptions and Last Refresh. All maths lives in gs1-aggregate.ts.
 *
 * Filters: from / to (date), analyst (exact name; Email + Data Card analyst, Approval
 * auditee) and lob (email | dataCard | approval). Team is not filterable: no GS1 upload
 * carries a team or a key that maps to one.
 */

import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { n, parseRange } from "./dialler-utils.js";
import { parseCountMap } from "./gs1-metrics.js";
import {
  aggregateApproval, aggregateDataCard, aggregateEmail, buildComparison, buildDataQuality,
  buildOverall, buildReconciliation, TAT_BUCKET_NOTE,
  type ApprovalRow, type DataCardRow, type EmailRow, type Gs1LobSet, type LobKey,
} from "./gs1-aggregate.js";

export interface Gs1DashboardFilters { from?: string; to?: string; analyst?: string; lob?: string }

const LOB_KEYS: LobKey[] = ["email", "dataCard", "approval"];
const UPLOAD_TYPE: Record<LobKey, string> = {
  email: "GS1_EMAIL_DAILY", dataCard: "GS1_DATAKART_DAILY", approval: "GS1_APPROVAL_AUDIT",
};

export function parseLob(raw: unknown): LobKey | null {
  const v = String(raw ?? "").trim().toLowerCase().replace(/[\s_-]/g, "");
  if (v === "email") return "email";
  if (v === "datacard" || v === "datakart") return "dataCard";
  if (v === "approval") return "approval";
  return null;
}

/** Max 200 chars, trimmed; empty means "all analysts". */
export function parseAnalyst(raw: unknown): string | null {
  const v = String(raw ?? "").trim().slice(0, 200);
  return v ? v : null;
}

const nullableNum = (v: unknown): number | null => (v === null || v === undefined || v === "" ? null : n(v));

async function readEmail(from: string, to: string, analyst: string | null): Promise<EmailRow[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT DATE_FORMAT(mail_date,'%Y-%m-%d') AS d, analyst_name, process_id,
            mail_received, gtin_processed, image_count, sla_within_15min,
            status_counts, sla_bucket_counts, query_type_counts, tat_minutes, duration_known_count
       FROM gs1_email_daily_actual
      WHERE mail_date BETWEEN ? AND ? ${analyst ? "AND analyst_name = ?" : ""}`,
    analyst ? [from, to, analyst] : [from, to],
  );
  return rows.map(r => ({
    date: String(r.d), analyst: r.analyst_name ?? null, received: n(r.mail_received), gtin: n(r.gtin_processed),
    images: n(r.image_count), slaPct: nullableNum(r.sla_within_15min),
    statusCounts: parseCountMap(r.status_counts), slaBuckets: parseCountMap(r.sla_bucket_counts),
    queryTypes: parseCountMap(r.query_type_counts), avgDurationMin: nullableNum(r.tat_minutes),
    durationKnown: nullableNum(r.duration_known_count), noProcess: !r.process_id,
  }));
}

async function readDataCard(from: string, to: string, analyst: string | null): Promise<DataCardRow[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT DATE_FORMAT(task_date,'%Y-%m-%d') AS d, analyst_name, process_id,
            task_count, gtin_count, within_tat, tat_known_count, completed_count,
            category_counts, tat_minutes, duration_known_count
       FROM gs1_datakart_daily_actual
      WHERE task_date BETWEEN ? AND ? ${analyst ? "AND analyst_name = ?" : ""}`,
    analyst ? [from, to, analyst] : [from, to],
  );
  return rows.map(r => ({
    date: String(r.d), analyst: r.analyst_name ?? null, tasks: n(r.task_count), gtin: n(r.gtin_count),
    withinTat: nullableNum(r.within_tat), tatKnown: nullableNum(r.tat_known_count),
    completed: nullableNum(r.completed_count), categories: parseCountMap(r.category_counts),
    avgDurationMin: nullableNum(r.tat_minutes), durationKnown: nullableNum(r.duration_known_count),
    noProcess: !r.process_id,
  }));
}

async function readApproval(from: string, to: string, analyst: string | null): Promise<ApprovalRow[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT DATE_FORMAT(audit_date,'%Y-%m-%d') AS d, auditee_name AS analyst,
            UPPER(TRIM(COALESCE(audit_result,''))) AS result,
            CASE WHEN COALESCE(error_flag,0) <> 0 THEN 1 ELSE 0 END AS ef,
            NULLIF(TRIM(COALESCE(error_category,'')),'') AS cat,
            CASE WHEN process_id IS NULL THEN 1 ELSE 0 END AS np,
            COUNT(*) AS items, COALESCE(SUM(sku_count),0) AS sku
       FROM gs1_approval_audit_raw
      WHERE audit_date BETWEEN ? AND ? ${analyst ? "AND auditee_name = ?" : ""}
      GROUP BY d, analyst, result, ef, cat, np`,
    analyst ? [from, to, analyst] : [from, to],
  );
  return rows.map(r => ({
    date: String(r.d), analyst: r.analyst ?? null, result: String(r.result ?? ""), errorFlag: n(r.ef),
    errorCategory: r.cat ?? null, items: n(r.items), sku: n(r.sku), noProcess: n(r.np) === 1,
  }));
}

/** Totals read straight from the tables, independent of the row-level aggregation. */
async function readIndependentTotals(from: string, to: string, analyst: string | null, lobs: LobKey[]) {
  const a = analyst ? " AND analyst_name = ?" : "";
  const params = analyst ? [from, to, analyst] : [from, to];
  const out: Partial<Record<LobKey, number>> = {};
  const q = async (sql: string) => {
    const [r] = await db.query<RowDataPacket[]>(sql, params);
    return n(r[0]?.t);
  };
  if (lobs.includes("email")) out.email = await q(`SELECT COALESCE(SUM(mail_received),0) AS t FROM gs1_email_daily_actual WHERE mail_date BETWEEN ? AND ?${a}`);
  if (lobs.includes("dataCard")) out.dataCard = await q(`SELECT COALESCE(SUM(task_count),0) AS t FROM gs1_datakart_daily_actual WHERE task_date BETWEEN ? AND ?${a}`);
  if (lobs.includes("approval")) out.approval = await q(`SELECT COUNT(*) AS t FROM gs1_approval_audit_raw WHERE audit_date BETWEEN ? AND ?${analyst ? " AND auditee_name = ?" : ""}`);
  return out;
}

async function readAnalystOptions(from: string, to: string, lobs: LobKey[]): Promise<string[]> {
  const parts: string[] = [];
  if (lobs.includes("email")) parts.push("SELECT DISTINCT analyst_name AS a FROM gs1_email_daily_actual WHERE mail_date BETWEEN ? AND ?");
  if (lobs.includes("dataCard")) parts.push("SELECT DISTINCT analyst_name AS a FROM gs1_datakart_daily_actual WHERE task_date BETWEEN ? AND ?");
  if (lobs.includes("approval")) parts.push("SELECT DISTINCT auditee_name AS a FROM gs1_approval_audit_raw WHERE audit_date BETWEEN ? AND ?");
  if (!parts.length) return [];
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT DISTINCT a FROM (${parts.join(" UNION ")}) x WHERE a IS NOT NULL AND TRIM(a) <> '' ORDER BY a LIMIT 500`,
    parts.flatMap(() => [from, to]),
  );
  return rows.map(r => String(r.a));
}

async function readBlankAuditor(from: string, to: string, analyst: string | null): Promise<number> {
  const [r] = await db.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS t FROM gs1_approval_audit_raw
      WHERE audit_date BETWEEN ? AND ? AND (auditor_name IS NULL OR TRIM(auditor_name) = '')
      ${analyst ? "AND auditee_name = ?" : ""}`,
    analyst ? [from, to, analyst] : [from, to],
  );
  return n(r[0]?.t);
}

/** Latest successful import per LOB (upload_batch), the dashboard's "Last Refresh". */
async function readLastRefresh(): Promise<Record<LobKey, string | null> & { latest: string | null }> {
  const out = { email: null, dataCard: null, approval: null, latest: null } as Record<LobKey, string | null> & { latest: string | null };
  try {
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT upload_type_code AS code, MAX(updated_at) AS at FROM upload_batch
        WHERE upload_type_code IN (?, ?, ?) AND batch_status IN ('imported','imported_with_errors')
        GROUP BY upload_type_code`,
      [UPLOAD_TYPE.email, UPLOAD_TYPE.dataCard, UPLOAD_TYPE.approval],
    );
    for (const r of rows) {
      const lob = LOB_KEYS.find(k => UPLOAD_TYPE[k] === r.code);
      if (!lob || !r.at) continue;
      const at = r.at instanceof Date ? r.at.toISOString() : String(r.at);
      out[lob] = at;
      if (!out.latest || at > out.latest) out.latest = at;
    }
  } catch {
    // upload_batch unreadable: Last Refresh shows as unknown rather than failing the dashboard.
  }
  return out;
}

export async function getGs1Dashboard(filters: Gs1DashboardFilters) {
  const { from, to } = parseRange(filters);
  const analyst = parseAnalyst(filters.analyst);
  const lobFilter = parseLob(filters.lob);
  const lobs = lobFilter ? [lobFilter] : LOB_KEYS;

  const [emailRows, dcRows, apRows, independent, analystOptions, blankAuditor, lastRefresh] = await Promise.all([
    lobs.includes("email") ? readEmail(from, to, analyst) : Promise.resolve(null),
    lobs.includes("dataCard") ? readDataCard(from, to, analyst) : Promise.resolve(null),
    lobs.includes("approval") ? readApproval(from, to, analyst) : Promise.resolve(null),
    readIndependentTotals(from, to, analyst, lobs),
    readAnalystOptions(from, to, lobs),
    lobs.includes("approval") ? readBlankAuditor(from, to, analyst) : Promise.resolve(undefined),
    readLastRefresh(),
  ]);

  const set: Gs1LobSet = {
    email: emailRows ? aggregateEmail(emailRows) : null,
    dataCard: dcRows ? aggregateDataCard(dcRows) : null,
    approval: apRows ? aggregateApproval(apRows) : null,
  };

  return {
    period: { from, to },
    filters: { analyst, lob: lobFilter },
    filterOptions: { analysts: analystOptions, lobs: LOB_KEYS },
    teamFilter: { available: false, reason: "GS1 uploads carry no team field or team mapping." },
    overall: buildOverall(set),
    lobs: set,
    comparison: buildComparison(set),
    reconciliation: buildReconciliation(set, independent),
    dataQuality: buildDataQuality({ email: emailRows, dataCard: dcRows, approval: apRows }, set, { approvalBlankAuditor: blankAuditor }),
    tatBucketNote: TAT_BUCKET_NOTE,
    lastRefresh,
    generatedAt: new Date().toISOString(),
  };
}

export type Gs1DashboardPayload = Awaited<ReturnType<typeof getGs1Dashboard>>;
