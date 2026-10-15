/**
 * What is a db_bill cost master id? Finds the cost-centre master row(s) by id and summarises the GRN
 * (expense entry) lines booked to it by finance month. READ-ONLY (billQuery SELECT only), no person data.
 *
 *   npx tsx scripts/dbbill-cost-master-lookup.ts <cost_master_id>
 */
import "dotenv/config";
import { billQuery, closeBillPool } from "../src/db/billDb.js";

(async () => {
  const id = Number(process.argv[2]);
  if (!Number.isInteger(id) || id <= 0) throw new Error("pass the numeric cost master id");
  const tables = (await billQuery<any>("SHOW TABLES")).map((r: any) => String(Object.values(r)[0]));
  const candidates = tables.filter((t) => /cost/i.test(t));
  console.log("CM_TABLES " + JSON.stringify(candidates));
  for (const t of candidates) {
    try {
      const cols = (await billQuery<any>(`SHOW COLUMNS FROM \`${t}\``)).map((c: any) => String(c.Field));
      const idCol = cols.find((c) => c.toLowerCase() === "id");
      if (!idCol) continue;
      const rows = await billQuery<any>(`SELECT * FROM \`${t}\` WHERE \`${idCol}\` = ? LIMIT 3`, [id]);
      for (const r of rows) {
        const slim: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(r)) if (v !== null && v !== "" && !/pass|token|secret|email|phone|mobile|pan|bank|account/i.test(k)) slim[k] = typeof v === "string" ? v.slice(0, 80) : v;
        console.log("CM_ROW " + JSON.stringify({ table: t, ...slim }));
      }
    } catch (e) { console.log("CM_ERR " + JSON.stringify({ table: t, error: e instanceof Error ? e.message.slice(0, 100) : String(e) })); }
  }
  const lines = await billQuery<any>(
    `SELECT m.FinanceYear fy, m.FinanceMonth fm, m.ExpenseEntryType typ, COUNT(*) n, SUM(CAST(p.Amount AS DECIMAL(16,2))) amt
       FROM expense_entry_particular p JOIN expense_entry_master m ON m.Id = CAST(p.ExpenseEntry AS UNSIGNED)
      WHERE CAST(p.CostCenterId AS UNSIGNED) = ? AND m.RejectDate IS NULL
      GROUP BY m.FinanceYear, m.FinanceMonth, m.ExpenseEntryType ORDER BY m.FinanceYear DESC, m.FinanceMonth`, [id]);
  for (const r of lines) console.log("CM_SPEND " + JSON.stringify({ fy: r.fy, month: r.fm, type: r.typ, lines: Number(r.n), amount: Math.round(Number(r.amt ?? 0)) }));
  await closeBillPool?.();
  await new Promise((resolve) => process.stdout.write("CM_DONE\n", resolve));
  process.exit(0);
})();
