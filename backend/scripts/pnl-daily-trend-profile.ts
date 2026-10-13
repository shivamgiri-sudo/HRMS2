/** Times the parts of the P&L daily-trend read on prod. READ-ONLY, milliseconds only. */
import "dotenv/config";
import { db } from "../src/db/mysql.js";
import { getSeatRevenueForecast } from "../src/modules/process-pnl/pnl-seat-revenue-forecast.service.js";

const t = async (name: string, fn: () => Promise<unknown>) => { const s = Date.now(); let note = ""; try { const r: any = await fn(); if (Array.isArray(r)) note = `${r.length} rows`; } catch (e) { note = "ERROR " + (e instanceof Error ? e.message.slice(0, 90) : String(e)); } console.log(`DT ${name.padEnd(52)} ${String(Date.now() - s).padStart(7)} ms ${note}`); };
(async () => {
  const p = "2026-09", from = "2026-09-01", to = "2026-10-01";
  await t("getSeatRevenueForecast (cold)", () => getSeatRevenueForecast(p, {}));
  await t("getSeatRevenueForecast (repeat)", () => getSeatRevenueForecast(p, {}));
  await t("GRN by bill_date (grn_request)", async () => (await db.execute(`SELECT DATE_FORMAT(g.bill_date,'%Y-%m-%d') d, COUNT(*) n FROM grn_request g WHERE g.status NOT IN ('draft','rejected','cancelled') AND g.bill_source_id IS NULL AND COALESCE(g.created_by,'') NOT LIKE '00000000-%' AND g.bill_date >= ? AND g.bill_date < ? GROUP BY d`, [from, to]))[0]);
  await t("attendance by day (attendance_daily_record)", async () => (await db.execute(`SELECT DATE_FORMAT(a.record_date,'%Y-%m-%d') d, COUNT(DISTINCT a.employee_id) h FROM attendance_daily_record a WHERE a.record_date >= ? AND a.record_date < ? GROUP BY d`, [from, to]))[0]);
  await t("EXPLAIN grn_request by bill_date", async () => (await db.execute(`EXPLAIN SELECT COUNT(*) FROM grn_request g WHERE g.bill_date >= ? AND g.bill_date < ?`, [from, to]))[0].map((r: any) => ({ key: r.key, rows: r.rows, type: r.type })) as any);
  await t("EXPLAIN attendance by record_date", async () => (await db.execute(`EXPLAIN SELECT COUNT(*) FROM attendance_daily_record a WHERE a.record_date >= ? AND a.record_date < ?`, [from, to]))[0].map((r: any) => ({ key: r.key, rows: r.rows, type: r.type })) as any);
  const [ex1] = await db.execute<any[]>(`EXPLAIN SELECT COUNT(*) FROM grn_request g WHERE g.bill_date >= ? AND g.bill_date < ?`, [from, to]);
  console.log("DT_EXPLAIN_GRN " + JSON.stringify(ex1.map((r: any) => ({ key: r.key, rows: r.rows, type: r.type }))));
  const [ex2] = await db.execute<any[]>(`EXPLAIN SELECT COUNT(*) FROM attendance_daily_record a WHERE a.record_date >= ? AND a.record_date < ?`, [from, to]);
  console.log("DT_EXPLAIN_ATT " + JSON.stringify(ex2.map((r: any) => ({ key: r.key, rows: r.rows, type: r.type }))));
  await new Promise((resolve) => process.stdout.write("DT_DONE\n", resolve));
  process.exit(0);
})();
