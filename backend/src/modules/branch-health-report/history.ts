/**
 * Branch Health Report — daily red-signal history.
 *
 * One row per (branch, report date, signal key) for every signal that was red that day, plus a
 * '__run__' marker per (branch, date) proving the report ran. The marker is what makes a streak
 * trustworthy: a missing day with no marker means "unknown" and ends the streak, rather than being
 * mistaken for a clean day or silently bridged.
 *
 * The table creates itself on first write (same pattern as payroll_calendar), so it needs no
 * migration. Writes happen only on a real send; previews and redirected test sends never write.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import type { BranchHealthReport } from "./metrics.js";

const RUN_MARKER = "__run__";
const LOOKBACK_DAYS = 90;
/** An item red this many days in a row is chronic and is escalated to the next level. */
export const CHRONIC_DAYS = 3;

export async function ensureHistoryTable(): Promise<void> {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS branch_health_signal_daily (
      branch_name VARCHAR(120) NOT NULL,
      report_date DATE         NOT NULL,
      signal_key  VARCHAR(80)  NOT NULL,
      label       VARCHAR(300) NULL,
      created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (branch_name, report_date, signal_key),
      KEY idx_bhsd_date (report_date)
    )`);
}

/** Record today's red signals for a branch. Idempotent per (branch, date). */
export async function recordSnapshot(report: BranchHealthReport): Promise<void> {
  await ensureHistoryTable();
  const keys = new Map<string, string>([[RUN_MARKER, "report ran"]]);
  for (const e of report.escalations) keys.set(e.key, e.label);
  for (const k of report.trackedKeys) if (!keys.has(k)) keys.set(k, k);
  await db.execute(`DELETE FROM branch_health_signal_daily WHERE branch_name = ? AND report_date = ?`, [
    report.branch,
    report.reportDate,
  ]);
  for (const [key, label] of keys) {
    await db.execute(
      `INSERT INTO branch_health_signal_daily (branch_name, report_date, signal_key, label) VALUES (?, ?, ?, ?)`,
      [report.branch, report.reportDate, key, label.slice(0, 300)],
    );
  }
}

const dayBefore = (d: string): string => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() - 1);
  return x.toISOString().slice(0, 10);
};

/**
 * Consecutive days a key has been red, counting back from today (today counts, so a signal first
 * seen today has days = 1). Pure; takes the history rows as {date, key}.
 */
export function streakFor(
  key: string,
  today: string,
  rows: { date: string; key: string }[],
): { days: number; since: string } {
  const runDates = new Set(rows.filter((r) => r.key === RUN_MARKER).map((r) => r.date));
  const red = new Set(rows.filter((r) => r.key === key).map((r) => r.date));
  let days = 1;
  let since = today;
  for (let d = dayBefore(today); runDates.has(d) && red.has(d); d = dayBefore(d)) {
    days += 1;
    since = d;
  }
  return { days, since };
}

/**
 * Fill days / since on each escalation from stored history. Degrades silently to "first seen
 * today" when the table is missing or unreadable: no history is not the same as a streak.
 */
export async function attachStreaks(report: BranchHealthReport): Promise<void> {
  if (!report.escalations.length && !report.trackedKeys.length) return;
  let rows: { date: string; key: string }[] = [];
  try {
    const [r] = await db.execute<RowDataPacket[]>(
      `SELECT DATE_FORMAT(report_date,'%Y-%m-%d') AS d, signal_key AS k
         FROM branch_health_signal_daily
        WHERE branch_name = ? AND report_date < ? AND report_date >= DATE_SUB(?, INTERVAL ${LOOKBACK_DAYS} DAY)`,
      [report.branch, report.reportDate, report.reportDate],
    );
    rows = (r as RowDataPacket[]).map((x) => ({ date: String(x.d), key: String(x.k) }));
  } catch {
    rows = [];
  }
  for (const e of report.escalations) {
    const s = streakFor(e.key, report.reportDate, rows);
    e.days = s.days;
    e.since = s.since;
  }
}
