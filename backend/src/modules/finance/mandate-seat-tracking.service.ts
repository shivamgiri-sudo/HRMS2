import { randomUUID } from "crypto";
import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { db } from "../../db/mysql.js";
import { billQuery } from "../../db/billDb.js";

export interface MandateSeatRecord {
  cost_center: string;
  client_name: string;
  process_name: string;
  branch_name: string;
  period_month: string;
  finance_year: string;
  mandate_seats: number;
  actual_billed_seats: number;
  seat_rate: number;
  monthly_revenue: number;
  seat_change: number;
  seat_change_pct: number | null;
  source: string;
}

export interface SeatTrendPoint {
  period_month: string;
  mandate_seats: number;
  actual_billed_seats: number;
  monthly_revenue: number;
  seat_rate: number;
}

export interface ClientMandateSummary {
  client_name: string;
  process_count: number;
  total_mandate_seats: number;
  total_revenue: number;
  avg_seat_rate: number;
  latest_change: number;
}

/**
 * Sync mandate seat data from db_bill inv_particulars for a given period
 */
export async function syncMandateSeatsFromDbBill(
  financeYear: string,
  month: string
): Promise<{ synced: number; errors: string[] }> {
  const errors: string[] = [];

  const rows = await billQuery<RowDataPacket>(
    `SELECT
       cm.cost_center,
       cm.client,
       cm.process_name,
       cm.branch,
       p.fin_year,
       p.month_for,
       CAST(COALESCE(p.qty, 0) AS DECIMAL(10,2)) AS seats,
       CAST(COALESCE(p.rate, 0) AS DECIMAL(12,2)) AS rate,
       CAST(COALESCE(p.amount, 0) AS DECIMAL(14,2)) AS amount
     FROM inv_particulars p
     JOIN cost_master cm ON cm.cost_center = p.cost_center
     WHERE p.fin_year = ?
       AND p.month_for = ?
       AND p.qty IS NOT NULL AND p.qty != ''
       AND CAST(p.qty AS DECIMAL(10,2)) >= 1
       AND CAST(p.rate AS DECIMAL(12,2)) BETWEEN 10000 AND 100000
       AND cm.active = 1
     ORDER BY cm.client, cm.cost_center`,
    [financeYear, month]
  );

  const periodMonth = monthToPeriod(month, financeYear);
  let synced = 0;

  for (const r of rows) {
    try {
      const [existing] = await db.execute<RowDataPacket[]>(
        `SELECT id, mandate_seats FROM mandate_seat_history
         WHERE cost_center = ? AND period_month = ?`,
        [r.cost_center, periodMonth]
      );

      const prevMonth = getPreviousMonth(periodMonth);
      const [prevRecord] = await db.execute<RowDataPacket[]>(
        `SELECT mandate_seats FROM mandate_seat_history
         WHERE cost_center = ? AND period_month = ?`,
        [r.cost_center, prevMonth]
      );
      const prevSeats = prevRecord[0]?.mandate_seats ?? null;
      const seatChange = prevSeats !== null ? Math.round(r.seats) - prevSeats : 0;

      if (existing.length > 0) {
        await db.execute(
          `UPDATE mandate_seat_history SET
             client_name = ?, process_name = ?, branch_name = ?,
             mandate_seats = ?, actual_billed_seats = ?, seat_rate = ?,
             monthly_revenue = ?, previous_mandate_seats = ?, seat_change = ?,
             source = 'db_bill'
           WHERE id = ?`,
          [
            r.client || r.process_name,
            r.process_name,
            r.branch,
            Math.round(r.seats),
            r.seats,
            r.rate,
            r.amount,
            prevSeats,
            seatChange,
            existing[0].id,
          ]
        );
      } else {
        await db.execute(
          `INSERT INTO mandate_seat_history
             (cost_center, client_name, process_name, branch_name, period_month,
              finance_year, mandate_seats, actual_billed_seats, seat_rate,
              monthly_revenue, previous_mandate_seats, seat_change, source)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'db_bill')`,
          [
            r.cost_center,
            r.client || r.process_name,
            r.process_name,
            r.branch,
            periodMonth,
            financeYear,
            Math.round(r.seats),
            r.seats,
            r.rate,
            r.amount,
            prevSeats,
            seatChange,
          ]
        );
      }
      synced++;
    } catch (err: any) {
      errors.push(`${r.cost_center}: ${err.message}`);
    }
  }

  return { synced, errors };
}

/**
 * Get mandate seat history for a cost center (for trend graph)
 */
export async function getMandateSeatTrend(
  costCenter: string,
  months = 12
): Promise<SeatTrendPoint[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT period_month, mandate_seats, actual_billed_seats, monthly_revenue, seat_rate
     FROM mandate_seat_history
     WHERE cost_center = ?
     ORDER BY period_month DESC
     LIMIT ?`,
    [costCenter, months]
  );

  return rows
    .map((r) => ({
      period_month: r.period_month,
      mandate_seats: Number(r.mandate_seats),
      actual_billed_seats: Number(r.actual_billed_seats),
      monthly_revenue: Number(r.monthly_revenue),
      seat_rate: Number(r.seat_rate),
    }))
    .reverse();
}

/**
 * Get client-level mandate summary with drill-down data
 */
export async function getClientMandateSummary(
  periodMonth: string
): Promise<ClientMandateSummary[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
       client_name,
       COUNT(DISTINCT cost_center) AS process_count,
       SUM(mandate_seats) AS total_mandate_seats,
       SUM(monthly_revenue) AS total_revenue,
       AVG(seat_rate) AS avg_seat_rate,
       SUM(seat_change) AS latest_change
     FROM mandate_seat_history
     WHERE period_month = ?
     GROUP BY client_name
     ORDER BY total_revenue DESC`,
    [periodMonth]
  );

  return rows.map((r) => ({
    client_name: r.client_name,
    process_count: Number(r.process_count),
    total_mandate_seats: Number(r.total_mandate_seats),
    total_revenue: Number(r.total_revenue),
    avg_seat_rate: Number(r.avg_seat_rate),
    latest_change: Number(r.latest_change),
  }));
}

/**
 * Get cost center level data for a client (drill-down)
 */
export async function getClientCostCenterDetails(
  clientName: string,
  periodMonth: string
): Promise<MandateSeatRecord[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
       cost_center, client_name, process_name, branch_name,
       period_month, finance_year, mandate_seats, actual_billed_seats,
       seat_rate, monthly_revenue, seat_change,
       CASE WHEN previous_mandate_seats > 0
         THEN ROUND((mandate_seats - previous_mandate_seats) / previous_mandate_seats * 100, 1)
         ELSE NULL END AS seat_change_pct,
       source
     FROM mandate_seat_history
     WHERE client_name = ? AND period_month = ?
     ORDER BY monthly_revenue DESC`,
    [clientName, periodMonth]
  );

  return rows.map((r) => ({
    cost_center: r.cost_center,
    client_name: r.client_name,
    process_name: r.process_name,
    branch_name: r.branch_name,
    period_month: r.period_month,
    finance_year: r.finance_year,
    mandate_seats: Number(r.mandate_seats),
    actual_billed_seats: Number(r.actual_billed_seats),
    seat_rate: Number(r.seat_rate),
    monthly_revenue: Number(r.monthly_revenue),
    seat_change: Number(r.seat_change),
    seat_change_pct: r.seat_change_pct !== null ? Number(r.seat_change_pct) : null,
    source: r.source,
  }));
}

/**
 * Update mandate seats manually (with audit trail)
 */
export async function updateMandateSeats(
  costCenter: string,
  periodMonth: string,
  newMandateSeats: number,
  changeReason: string,
  userId: string
): Promise<{ success: boolean; previous: number }> {
  const [existing] = await db.execute<RowDataPacket[]>(
    `SELECT id, mandate_seats FROM mandate_seat_history
     WHERE cost_center = ? AND period_month = ?`,
    [costCenter, periodMonth]
  );

  const previous = existing[0]?.mandate_seats ?? 0;

  if (existing.length > 0) {
    await db.execute(
      `UPDATE mandate_seat_history SET
         mandate_seats = ?,
         previous_mandate_seats = ?,
         seat_change = ?,
         change_reason = ?,
         change_effective_date = CURDATE(),
         source = 'manual',
         updated_by = ?
       WHERE id = ?`,
      [
        newMandateSeats,
        previous,
        newMandateSeats - previous,
        changeReason,
        userId,
        existing[0].id,
      ]
    );
  } else {
    await db.execute(
      `INSERT INTO mandate_seat_history
         (cost_center, period_month, mandate_seats, seat_change,
          change_reason, change_effective_date, source, updated_by)
       VALUES (?, ?, ?, 0, ?, CURDATE(), 'manual', ?)`,
      [costCenter, periodMonth, newMandateSeats, changeReason, userId]
    );
  }

  return { success: true, previous };
}

/**
 * Get branch-level mandate summary (for P&L drill-down)
 */
export async function getBranchMandateSummary(
  periodMonth: string
): Promise<
  Array<{
    branch_name: string;
    client_count: number;
    total_seats: number;
    total_revenue: number;
    avg_rate: number;
  }>
> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
       branch_name,
       COUNT(DISTINCT client_name) AS client_count,
       SUM(mandate_seats) AS total_seats,
       SUM(monthly_revenue) AS total_revenue,
       AVG(seat_rate) AS avg_rate
     FROM mandate_seat_history
     WHERE period_month = ? AND branch_name IS NOT NULL
     GROUP BY branch_name
     ORDER BY total_revenue DESC`,
    [periodMonth]
  );

  return rows.map((r) => ({
    branch_name: r.branch_name,
    client_count: Number(r.client_count),
    total_seats: Number(r.total_seats),
    total_revenue: Number(r.total_revenue),
    avg_rate: Math.round(Number(r.avg_rate)),
  }));
}

/**
 * Get comparison data for trend chart (multiple periods)
 */
export async function getMultiPeriodTrend(
  costCenters: string[],
  periods = 6
): Promise<Map<string, SeatTrendPoint[]>> {
  if (costCenters.length === 0) return new Map();

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT cost_center, period_month, mandate_seats, actual_billed_seats,
            monthly_revenue, seat_rate
     FROM mandate_seat_history
     WHERE cost_center IN (${costCenters.map(() => "?").join(",")})
     ORDER BY cost_center, period_month DESC`,
    costCenters
  );

  const result = new Map<string, SeatTrendPoint[]>();
  for (const r of rows) {
    const key = r.cost_center;
    if (!result.has(key)) result.set(key, []);
    const arr = result.get(key)!;
    if (arr.length < periods) {
      arr.push({
        period_month: r.period_month,
        mandate_seats: Number(r.mandate_seats),
        actual_billed_seats: Number(r.actual_billed_seats),
        monthly_revenue: Number(r.monthly_revenue),
        seat_rate: Number(r.seat_rate),
      });
    }
  }

  for (const [k, v] of result) {
    result.set(k, v.reverse());
  }

  return result;
}

// Helpers
function monthToPeriod(monthLabel: string, finYear: string): string {
  const months: Record<string, string> = {
    Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
    Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12",
  };
  const [mon] = monthLabel.split("-");
  const monthNum = months[mon] ?? "01";
  const [startYear] = finYear.split("-").map(Number);
  const year = Number(monthNum) >= 4 ? startYear : startYear + 1;
  return `${year}-${monthNum}`;
}

function getPreviousMonth(period: string): string {
  const [y, m] = period.split("-").map(Number);
  if (m === 1) return `${y - 1}-12`;
  return `${y}-${String(m - 1).padStart(2, "0")}`;
}
