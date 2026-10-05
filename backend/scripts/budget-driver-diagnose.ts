/**
 * Why does a branch budget refuse with "no cost centre ... has any seat count for <period>"?
 * STRICTLY READ-ONLY (SELECTs only).
 *
 *   npx tsx scripts/budget-driver-diagnose.ts [BRANCH_CODE] [YYYY-MM] [YYYY-MM]
 *
 * For each active cost centre of the branch: seat stores on cost_centre_master, the monthly-driver
 * seat_count for each period given, and what getMonthlyDrivers() hands the budget engine.
 */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";
import { getMonthlyDrivers, listActiveCostCentres } from "../src/modules/process-pnl/branch-budget-allocation.service.js";

const BRANCH_CODE = process.argv[2] ?? "NOIDA-2";
const PERIODS = process.argv.slice(3).length ? process.argv.slice(3) : ["2026-10", "2026-09"];

async function main() {
  const [b] = await db.execute<RowDataPacket[]>(`SELECT id, branch_name FROM branch_master WHERE branch_code = ? OR branch_name = ? LIMIT 1`, [BRANCH_CODE, BRANCH_CODE]);
  const branchId = String(b[0]?.id);
  console.log("BRANCH", JSON.stringify(b[0]));
  const ccs = await listActiveCostCentres(branchId);
  console.log("ACTIVE COST CENTRES", ccs.length);
  const [master] = await db.execute<RowDataPacket[]>(
    `SELECT id, cost_centre_code, mandated_seats, mandated_seats_value FROM cost_centre_master WHERE branch_id = ?`, [branchId]);
  const m = new Map(master.map((r) => [String(r.id), r]));
  const [raw] = await db.execute<RowDataPacket[]>(
    `SELECT period_code, cost_centre_id, seat_count, planned_headcount, status, updated_at FROM finance_cost_centre_monthly_driver WHERE branch_id = ? ORDER BY period_code DESC, updated_at DESC LIMIT 200`, [branchId]);
  console.log("DRIVER ROWS (latest 200) periods:", JSON.stringify([...new Set(raw.map((r) => r.period_code))]));
  for (const p of PERIODS) {
    const drivers = await getMonthlyDrivers(branchId, p);
    const withSeats = drivers.filter((d) => d.seatCount > 0);
    console.log(`PERIOD ${p}: driver rows in table=${raw.filter((r) => r.period_code === p).length}, cost centres with seatCount>0 via engine=${withSeats.length}/${drivers.length}`);
  }
  for (const cc of ccs) {
    const r = m.get(cc.id);
    const seats = PERIODS.map((p) => `${p}=${raw.find((x) => x.period_code === p && String(x.cost_centre_id) === cc.id)?.seat_count ?? "-"}`).join(" ");
    console.log(`${cc.costCentreName} | master.mandated_seats=${r?.mandated_seats ?? "-"} value=${r?.mandated_seats_value ?? "-"} | driver ${seats}`);
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
