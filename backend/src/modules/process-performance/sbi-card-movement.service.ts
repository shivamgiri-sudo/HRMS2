import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { resolveRange } from "./sbi-card-dashboard.service.js";
import { movementOf, type MovementOut, type SnapRow } from "./sbi-card-movement.calc.js";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export interface MovementPayload { range: { from: string; to: string }; dates: string[]; movement: MovementOut | null }

/**
 * How the book moved between two account snapshots in the range: the first and the latest date by default, or any two the caller picks.
 * With fewer than two snapshot dates there is nothing to compare, and the payload says so (movement = null) instead of inventing a trend.
 */
export async function getSbiCardMovement(q: { month?: string; from?: string; to?: string; a?: string; b?: string }): Promise<MovementPayload> {
  const { from, to } = resolveRange(q.month, q.from, q.to);
  const [pr] = await db.execute<RowDataPacket[]>(`SELECT id FROM process_master WHERE process_code = 'SBI_CARD' AND active_status = 1 LIMIT 1`);
  const pid: string | null = pr[0]?.id ?? null;
  if (!pid) return { range: { from, to }, dates: [], movement: null };
  const [dr] = await db.execute<RowDataPacket[]>(
    `SELECT DISTINCT DATE_FORMAT(report_date, '%Y-%m-%d') AS d FROM sbi_card_account_file WHERE process_id = ? AND report_date BETWEEN ? AND ? ORDER BY d`, [pid, from, to]);
  const dates = dr.map((r) => String(r.d));
  if (dates.length < 2) return { range: { from, to }, dates, movement: null };
  const pick = (v: string | undefined, fallback: string): string => (v && DATE_RE.test(v) && dates.includes(v) ? v : fallback);
  let a = pick(q.a, dates[0]!); let b = pick(q.b, dates[dates.length - 1]!);
  if (a > b) [a, b] = [b, a];
  if (a === b) return { range: { from, to }, dates, movement: null };
  const load = async (date: string): Promise<SnapRow[]> => {
    const [rows] = await db.execute<RowDataPacket[]>(`SELECT account_no, cd, total_amount_due, flow FROM sbi_card_account_file WHERE process_id = ? AND report_date = ?`, [pid, date]);
    return rows.map((r) => ({ accountNo: String(r.account_no), cd: r.cd === null || r.cd === undefined ? null : Number(r.cd), due: Number(r.total_amount_due ?? 0), flow: r.flow ?? null }));
  };
  const [sa, sb] = await Promise.all([load(a), load(b)]);
  return { range: { from, to }, dates, movement: movementOf(a, sa, b, sb) };
}
