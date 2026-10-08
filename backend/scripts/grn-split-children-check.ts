/** What the 164 budget-remediation GRNs are, and whether they double-count a parent bill. READ-ONLY. */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";
const q = async (label: string, sql: string) => { try { const [r] = await db.execute<RowDataPacket[]>(sql); console.log(`\n## ${label}`); console.table(r); } catch (e: any) { console.log(`\n## ${label}\nSKIPPED: ${e.message}`); } };
const AMT = (a: string) => `COALESCE(NULLIF(${a}.amount_with_tax,0), ${a}.amount)`;
async function main() {
  await q("the 164: number shape, parent present, amounts",
    `SELECT CASE WHEN g.grn_number REGEXP '-[A-Za-z]{3}$' THEN 'month-suffixed' WHEN g.grn_number REGEXP '-[0-9]+$' THEN 'numeric-suffixed' ELSE 'plain' END shape,
            COUNT(*) n, ROUND(SUM(${AMT("g")}),2) amt,
            SUM(EXISTS (SELECT 1 FROM grn_request p WHERE p.id <> g.id AND p.grn_number = REGEXP_REPLACE(g.grn_number, '-[A-Za-z0-9]+$', ''))) has_parent_by_number,
            SUM(g.bill_source_id IS NOT NULL) from_dbbill, MIN(g.bill_date) min_bill, MAX(g.bill_date) max_bill
       FROM grn_request g WHERE g.created_by = '00000000-0000-0000-0000-budgetfix001' GROUP BY shape`);
  await q("sample: child and parent side by side",
    `SELECT g.grn_number child, g.status child_status, ROUND(${AMT("g")},2) child_amt, g.invoice_number,
            p.grn_number parent, p.status parent_status, ROUND(${AMT("p")},2) parent_amt, p.vendor_id IS NOT NULL parent_has_vendor,
            EXISTS (SELECT 1 FROM journal_entry je WHERE je.source_type='grn' AND je.source_id = p.id AND je.reversed_by_entry_id IS NULL) parent_journaled
       FROM grn_request g LEFT JOIN grn_request p ON p.id <> g.id AND p.grn_number = REGEXP_REPLACE(g.grn_number, '-[A-Za-z0-9]+$', '')
      WHERE g.created_by = '00000000-0000-0000-0000-budgetfix001' ORDER BY ${AMT("g")} DESC LIMIT 12`);
  await q("sum of children vs parent, by parent",
    `SELECT p.grn_number parent, ROUND(${AMT("p")},2) parent_amt, COUNT(*) children, ROUND(SUM(${AMT("g")}),2) children_amt
       FROM grn_request g JOIN grn_request p ON p.id <> g.id AND p.grn_number = REGEXP_REPLACE(g.grn_number, '-[A-Za-z0-9]+$', '')
      WHERE g.created_by = '00000000-0000-0000-0000-budgetfix001' GROUP BY p.id, p.grn_number, parent_amt ORDER BY children_amt DESC LIMIT 12`);
  await q("do the children carry budget lines / allocations (is spend counted twice?)",
    `SELECT COUNT(*) n, SUM(g.budget_line_id IS NOT NULL) with_budget_line, ROUND(SUM(${AMT("g")}),2) amt FROM grn_request g WHERE g.created_by = '00000000-0000-0000-0000-budgetfix001'`);
}
main().then(() => db.end?.()).catch(async (e) => { console.error("ERR", e?.message ?? e); try { await db.end?.(); } catch { } process.exit(1); });
