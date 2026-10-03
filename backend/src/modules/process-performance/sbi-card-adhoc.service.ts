import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { resolveRange } from "./sbi-card-dashboard.service.js";
import { loadAccountOpsRows } from "./sbi-card-account-rows.js";
import { ADHOC_TYPES, adhocCsv, adhocList, type AdhocType } from "./sbi-card-adhoc.calc.js";

export const isAdhocType = (v: unknown): v is AdhocType => typeof v === "string" && (ADHOC_TYPES as readonly string[]).includes(v);

/** The CSV of one ad-hoc call list from the latest account snapshot in the range. Account numbers only; see sbi-card-adhoc.calc.ts. */
export async function getSbiCardAdhocCsv(type: AdhocType, q: { month?: string; from?: string; to?: string }): Promise<{ csv: string; filename: string; count: number; reportDate: string | null }> {
  const { from, to } = resolveRange(q.month, q.from, q.to);
  const [pr] = await db.execute<RowDataPacket[]>(`SELECT id FROM process_master WHERE process_code = 'SBI_CARD' AND active_status = 1 LIMIT 1`);
  const pid: string | null = pr[0]?.id ?? null;
  let date: string | null = null;
  if (pid) {
    const [d] = await db.execute<RowDataPacket[]>(`SELECT DATE_FORMAT(MAX(report_date), '%Y-%m-%d') AS d FROM sbi_card_account_file WHERE process_id = ? AND report_date BETWEEN ? AND ?`, [pid, from, to]);
    date = d[0]?.d ?? null;
  }
  const rows = pid && date ? adhocList(await loadAccountOpsRows(pid, date), date, type) : [];
  return { csv: adhocCsv(rows, date ?? ""), filename: `SBI_ADHOC_${type}_${date ?? "no-data"}.csv`, count: rows.length, reportDate: date };
}
