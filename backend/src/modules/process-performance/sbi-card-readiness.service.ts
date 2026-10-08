import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { resolveRange } from "./sbi-card-dashboard.service.js";
import { buildReadiness, type ReadinessOut, type SourceKey } from "./sbi-card-readiness.calc.js";

/** Which daily feeds arrived for each day, and which fresh call tables were in the NEW-flow export. Read-only. */
export async function getSbiCardReadiness(q: { month?: string; from?: string; to?: string; asOf?: string }): Promise<ReadinessOut & { range: { from: string; to: string } }> {
  const { from, to } = resolveRange(q.month, q.from, q.to);
  const [pr] = await db.execute<RowDataPacket[]>(`SELECT id FROM process_master WHERE process_code = 'SBI_CARD' AND active_status = 1 LIMIT 1`);
  const pid: string | null = pr[0]?.id ?? null;
  const counts: Record<string, Partial<Record<SourceKey, number>>> = {};
  const tablesByDay: Record<string, string[]> = {};
  const put = (date: string, key: SourceKey, n: number) => { (counts[date] ??= {})[key] = (counts[date]![key] ?? 0) + n; };
  if (pid) {
    const range = [pid, from, to];
    const simple: Array<[SourceKey, string]> = [
      ["apr", "SELECT DATE_FORMAT(report_date,'%Y-%m-%d') d, COUNT(*) n FROM sbi_card_agent_time WHERE process_id=? AND report_date BETWEEN ? AND ? GROUP BY report_date"],
      ["dialerMis", "SELECT DATE_FORMAT(report_date,'%Y-%m-%d') d, COUNT(*) n FROM sbi_card_dialer_mis WHERE process_id=? AND is_rollup=0 AND report_date BETWEEN ? AND ? GROUP BY report_date"],
      ["agentMis", "SELECT DATE_FORMAT(report_date,'%Y-%m-%d') d, COUNT(*) n FROM sbi_card_agent_mis WHERE process_id=? AND report_date BETWEEN ? AND ? GROUP BY report_date"],
      ["penEstimation", "SELECT DATE_FORMAT(report_date,'%Y-%m-%d') d, COUNT(*) n FROM sbi_card_pen_estimation WHERE process_id=? AND report_date BETWEEN ? AND ? GROUP BY report_date"],
      ["outcome", "SELECT DATE_FORMAT(report_date,'%Y-%m-%d') d, COUNT(*) n FROM sbi_card_outcome WHERE process_id=? AND report_date BETWEEN ? AND ? GROUP BY report_date"],
      ["downtime", "SELECT DATE_FORMAT(report_date,'%Y-%m-%d') d, COUNT(*) n FROM sbi_card_downtime WHERE process_id=? AND report_date BETWEEN ? AND ? GROUP BY report_date"],
    ];
    const [flows, tables, ...rest] = await Promise.all([
      db.execute<RowDataPacket[]>("SELECT DATE_FORMAT(report_date,'%Y-%m-%d') d, flow, COUNT(*) n FROM sbi_card_account_file WHERE process_id=? AND report_date BETWEEN ? AND ? GROUP BY report_date, flow", range),
      db.execute<RowDataPacket[]>("SELECT DATE_FORMAT(report_date,'%Y-%m-%d') d, call_table_name t FROM sbi_card_account_file WHERE process_id=? AND flow='NEW' AND report_date BETWEEN ? AND ? GROUP BY report_date, call_table_name", range),
      ...simple.map(([, sql]) => db.execute<RowDataPacket[]>(sql, range)),
    ]);
    for (const r of flows[0]) put(String(r.d), String(r.flow).toUpperCase() === "MANUAL" ? "accountManual" : "accountNew", Number(r.n));
    for (const r of tables[0]) if (r.t) (tablesByDay[String(r.d)] ??= []).push(String(r.t));
    rest.forEach((res, i) => { for (const r of res[0]) put(String(r.d), simple[i]![0], Number(r.n)); });
  }
  return { ...buildReadiness({ from, to, counts, tablesByDay, asOf: q.asOf ?? (to < new Date().toISOString().slice(0, 10) ? to : new Date().toISOString().slice(0, 10)) }), range: { from, to } };
}
