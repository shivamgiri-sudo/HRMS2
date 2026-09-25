import type { RowDataPacket } from "mysql2";
import { getOnfidoPool } from "../../db/onfidoDb.js";

interface FreshnessSource {
  key: string;
  label: string;
  table: string;
  dateColumn: string;
}

/** Every source table a dashboard tab reads, with the date column its own filters use. */
export const FRESHNESS_SOURCES: readonly FreshnessSource[] = [
  { key: "doc", label: "DOC tasks", table: "onfido_doc_raw", dateColumn: "report_date" },
  { key: "poa", label: "POA tasks", table: "onfido_poa_raw", dateColumn: "report_completed_date" },
  { key: "doc_audit", label: "DOC audits", table: "onfido_doc_external_audit_raw", dateColumn: "report_date" },
  { key: "doc_quality", label: "DOC internal quality", table: "onfido_doc_quality_raw", dateColumn: "task_complete_date" },
  { key: "poa_quality", label: "POA quality", table: "onfido_poa_quality_raw", dateColumn: "report_completed_date" },
  { key: "cre", label: "CRE", table: "onfido_doc_escalation_cre_raw", dateColumn: "qc_updated_date" },
  { key: "etm", label: "ETM", table: "onfido_doc_etm_raw", dateColumn: "report_date" },
  { key: "task_skip", label: "Task skip", table: "onfido_task_skip_raw", dateColumn: "skip_date" },
  { key: "agent_daily", label: "Attrition / shrinkage", table: "onfido_agent_daily_raw", dateColumn: "work_date" },
];

export interface FreshnessRow {
  key: string;
  label: string;
  latestDate: string | null;
  /** Months (YYYY-MM) with no data at all between the first and last month seen in the last 12 - an upload that never happened. */
  gapMonths: string[];
}

/** Months missing between the earliest and latest of the given YYYY-MM values. Pure - unit tested. */
export function findGapMonths(months: string[]): string[] {
  if (months.length < 2) return [];
  const present = new Set(months);
  const sorted = [...present].sort();
  const [firstYear, firstMonth] = sorted[0].split("-").map(Number);
  const [lastYear, lastMonth] = sorted[sorted.length - 1].split("-").map(Number);
  const gaps: string[] = [];
  for (let y = firstYear, m = firstMonth; y < lastYear || (y === lastYear && m <= lastMonth); m += 1) {
    if (m === 13) {
      y += 1;
      m = 1;
    }
    const key = `${y}-${String(m).padStart(2, "0")}`;
    if (!present.has(key) && (y < lastYear || m <= lastMonth)) gaps.push(key);
  }
  return gaps;
}

/** Latest data day per source. MAX() on an indexed date column, so this is cheap even on the big tables. */
export async function getDataFreshness(): Promise<FreshnessRow[]> {
  const pool = await getOnfidoPool();
  return Promise.all(
    FRESHNESS_SOURCES.map(async (source): Promise<FreshnessRow> => {
      try {
        const [rows] = await pool.query<RowDataPacket[]>(
          `SELECT DATE_FORMAT(MAX(${source.dateColumn}), '%Y-%m-%d') AS d FROM ${source.table}`,
        );
        const [monthRows] = await pool.query<RowDataPacket[]>(
          `SELECT DISTINCT DATE_FORMAT(${source.dateColumn}, '%Y-%m') AS m FROM ${source.table}
            WHERE ${source.dateColumn} >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)`,
        );
        return {
          key: source.key,
          label: source.label,
          latestDate: (rows[0]?.d as string | null) ?? null,
          gapMonths: findGapMonths(monthRows.map((r) => String(r.m))),
        };
      } catch (err: unknown) {
        console.error(`[onfido] freshness failed for ${source.table}:`, err);
        return { key: source.key, label: source.label, latestDate: null, gapMonths: [] };
      }
    }),
  );
}
