/**
 * Times the budget-line GRN drill-down queries on the live database. READ-ONLY.
 *
 *   npx tsx scripts/grn-drilldown-timing.ts [YYYY-MM] [branch-name-like]
 *
 * Calls the same service functions the screen calls (listGrns for the dialog, getGrnsForLine for
 * the per-line endpoint), three times each, so cold vs warm is visible, then prints EXPLAIN rows
 * for the dialog's header-table predicate so a missing index shows up by name.
 */
import "dotenv/config";
import { db } from "../src/db/mysql.js";
import { grnService } from "../src/modules/finance/grn.service.js";
import { branchBudgetService } from "../src/modules/process-pnl/branch-budget.service.js";
import { refreshHiddenGrnScope } from "../src/shared/ownCompanyCostCentre.js";
import type { RowDataPacket } from "mysql2";

const PERIOD = process.argv[2] ?? "2026-10";
const BRANCH = process.argv[3] ?? "%head office%";
const q = async (sql: string, p: unknown[] = []) => (await db.execute<RowDataPacket[]>(sql, p))[0];
const time = async <T>(label: string, fn: () => Promise<T>) => {
  const t0 = Date.now();
  const r = await fn();
  console.log(`${label}: ${Date.now() - t0} ms`);
  return r;
};

const captured: { sql: string; params: unknown[]; ms: number }[] = [];
const origQuery = (db as any).query.bind(db);
(db as any).query = async (sql: any, params: any) => {
  const t0 = Date.now();
  const r = await origQuery(sql, params);
  if (typeof sql === "string" && /grn_request g/.test(sql)) captured.push({ sql, params, ms: Date.now() - t0 });
  return r;
};

(async () => {
  const [hdr] = (await q(
    `SELECT h.id, h.branch_id FROM finance_budget_header h JOIN branch_master bm ON bm.id = h.branch_id
      WHERE h.period_code = ? AND bm.branch_name LIKE ? AND h.status = 'active' LIMIT 1`, [PERIOD, BRANCH])) as any[];
  if (!hdr) { console.log("no active header"); process.exit(0); }
  const [line] = (await q(
    `SELECT id, head, sub_head FROM finance_budget_line WHERE budget_id = ? AND head LIKE 'Fee%' LIMIT 1`, [hdr.id])) as any[];
  const [cc] = (await q(
    `SELECT id FROM cost_centre_master WHERE cost_centre_name = 'BSS-HR' LIMIT 1`)) as any[];

  for (let i = 1; i <= 2; i++) await time(`refreshHiddenGrnScope (run ${i})`, () => refreshHiddenGrnScope());
  await time("listGrns branch+period only", () => grnService.listGrns({ branchId: hdr.branch_id, accountingPeriod: PERIOD, excludeDraft: true, limit: 100 } as any));
  await time("listGrns branch+period+costCentre", () => grnService.listGrns({ branchId: hdr.branch_id, accountingPeriod: PERIOD, costCentreId: cc?.id, excludeDraft: true, limit: 100 } as any));
  await time("listGrns branch+period+cc+head", () => grnService.listGrns({ branchId: hdr.branch_id, accountingPeriod: PERIOD, costCentreId: cc?.id, head: line?.head, excludeDraft: true, limit: 100 } as any));
  await time("COUNT head-office GRNs (all periods)", () => q(`SELECT COUNT(*) n FROM grn_request WHERE branch_id = ?`, [hdr.branch_id]));
  for (let i = 1; i <= 3; i++) {
    await time(`listGrns dialog (run ${i})`, () => grnService.listGrns({
      branchId: hdr.branch_id, accountingPeriod: PERIOD, costCentreId: cc?.id,
      head: line?.head, subHead: line?.sub_head, excludeDraft: true, limit: 100,
    } as any));
  }
  if (line) for (let i = 1; i <= 3; i++) {
    await time(`getGrnsForLine (run ${i})`, () => branchBudgetService.getGrnsForLine(line.id));
  }
  const slowest = captured.sort((a, b) => b.ms - a.ms)[0];
  if (slowest) {
    console.log(`\nslowest list SQL took ${slowest.ms} ms; EXPLAIN ANALYZE:`);
    try {
      const [r] = await origQuery(`EXPLAIN ANALYZE ${slowest.sql}`, slowest.params);
      for (const row of r as any[]) console.log(Object.values(row)[0]);
    } catch (e) { console.log("EXPLAIN ANALYZE failed:", (e as Error).message); }
  }
  console.log("\nEXPLAIN grn_request by branch+period (COALESCE form, as in listGrns):");
  console.table(await q(
    `EXPLAIN SELECT g.id FROM grn_request g WHERE g.branch_id = ? AND COALESCE(g.accounting_period, DATE_FORMAT(g.bill_date,'%Y-%m')) = ? ORDER BY g.created_at DESC LIMIT 100`,
    [hdr.branch_id, PERIOD]));
  console.log("\nEXPLAIN the five-times-repeated employees derived table:");
  console.table(await q(`EXPLAIN SELECT user_id, MIN(first_name), MIN(last_name) FROM employees WHERE user_id IS NOT NULL GROUP BY user_id`));
  const [c] = (await q(`SELECT COUNT(*) n FROM employees`)) as any[];
  console.log("employees rows:", c.n);
  console.log("\nindexes on grn_cost_allocation:");
  console.table(await q(`SELECT index_name, GROUP_CONCAT(column_name ORDER BY seq_in_index) cols FROM information_schema.STATISTICS WHERE table_schema = DATABASE() AND table_name = 'grn_cost_allocation' GROUP BY index_name`));
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
