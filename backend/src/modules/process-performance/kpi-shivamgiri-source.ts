import { getShivamgiriPool } from "../../db/shivamgiriDb.js";
import type { RowDataPacket } from "mysql2";

/**
 * A second real quality-audit source, alongside kpi_daily_actual's
 * QUALITY_SCORE: Shivamgiri.finnable_call_inbound_kpi /
 * finnable_call_outbound_kpi, a call-level QA audit feed (quality_score,
 * quality_band, is_critical_call per call) run by a separate "CI platform"
 * living inside the Shivamgiri database. Despite the table name, it holds
 * MULTIPLE clients' audits, keyed by `client_id` -- a numeric code confirmed
 * live 2026-09-07 against Shivamgiri.process_mapping_master /
 * ci_process_master, NOT the same id space as mas_hrms.process_master.id.
 *
 * Only the 2 processes below are mapped here: their OWN governance table
 * (Shivamgiri.ci_readiness_classification) confirms real ingested rows for
 * both. FINNABLE's own client_id (497, per ci_process_master's description
 * field) is deliberately NOT mapped -- its readiness row shows
 * quality_data_exists=0, so claiming a quality figure for it here would be
 * exactly the kind of false-positive this session has repeatedly hunted
 * down elsewhere (Client Portal RAG, hc-formula's zero-fallbacks). GS1 has
 * no presence in this CI platform at all -- it isn't a call-centre client.
 *
 * This feed is a closed historical pilot, not a live one: both tables stop
 * in 2026 (verified live -- BBB inbound through 2026-06-26, BBB outbound
 * through 2026-03-17, Reginald outbound through 2026-06-26), so a rolling
 * "last 30 days" window would wrongly show no_data. The score is therefore
 * computed over the full available range and returned alongside the date it
 * is actually as-of, so nothing here is presented as current.
 */
export const SHIVAMGIRI_CLIENT_ID: Record<string, string> = {
  BLA_BLI_BLU: "487",
  REGINALD: "481",
};

export interface ShivamgiriQualityResult {
  value: number | null;
  count: number;
  asOfDate: string | null;
}

export async function fetchShivamgiriQualityScore(clientId: string): Promise<ShivamgiriQualityResult> {
  const pool = getShivamgiriPool();
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT AVG(quality_score) AS value, COUNT(quality_score) AS n, MAX(call_date) AS max_d FROM (
       SELECT quality_score, call_date FROM finnable_call_inbound_kpi  WHERE client_id = ?
       UNION ALL
       SELECT quality_score, call_date FROM finnable_call_outbound_kpi WHERE client_id = ?
     ) audited_calls`,
    [clientId, clientId],
  );
  // COUNT(quality_score), not COUNT(*): a process can have real call rows here
  // with every quality_score left NULL -- confirmed live for REGINALD_MEN,
  // whose own governance table (Shivamgiri.ci_readiness_classification) shows
  // 35,916 real outbound rows but an unconfigured audit framework, so nothing
  // was ever scored. COUNT(*) would have reported those rows as "ok" with a
  // null value -- the same false-positive class this session kept finding.
  const r = rows[0];
  const n = Number(r?.n ?? 0);
  return {
    value: n > 0 && r?.value != null ? Number(r.value) : null,
    count: n,
    asOfDate: n > 0 && r?.max_d ? new Date(r.max_d).toISOString().slice(0, 10) : null,
  };
}
