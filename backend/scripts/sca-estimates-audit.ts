/**
 * Are the stored net/CTC estimates on active salary_component_assignments rows believable? STRICTLY READ-ONLY.
 *
 *   npx tsx scripts/sca-estimates-audit.ts
 *
 * net_estimate and ctc are display fields (Salary Change page, employee salary view, migration report). The
 * expected net is gross minus employee PF (12% of basic when pf_applicable) minus employee ESIC (0.75% of gross
 * when esi_applicable and gross <= 21,000). Rows are grouped by how they were created (approval_reference).
 */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { db, closePool } from "../src/db/mysql.js";

const q = async (sql: string, p: unknown[] = []) => {
  if (!/^\s*select/i.test(sql)) throw new Error("read-only");
  const [rows] = await db.execute<RowDataPacket[]>(sql, p as any[]);
  return rows as any[];
};

async function main() {
  const expectedNet = `(s.gross - IF(s.pf_applicable = 1, ROUND(s.basic * 0.12), 0) - IF(s.esi_applicable = 1 AND s.gross <= 21000, ROUND(s.gross * 0.0075), 0))`;
  console.log("active package rows by origin: how many have a missing or implausible net_estimate (off the formula by more than Rs 50)");
  console.table(await q(
    `SELECT COALESCE(LEFT(s.approval_reference, 28), '(none)') AS origin, COUNT(*) AS rows_n,
            SUM(s.net_estimate IS NULL) AS net_null, SUM(s.net_estimate IS NOT NULL AND ABS(s.net_estimate - ${expectedNet}) > 50) AS net_off,
            SUM(s.ctc IS NULL) AS ctc_null
       FROM salary_component_assignments s JOIN employees e ON e.id = s.employee_id
      WHERE s.status = 'active' AND e.active_status = 1 GROUP BY 1 ORDER BY rows_n DESC LIMIT 12`));
  console.log("rows made by the db_bill increment sync (sample of 12): stored vs expected");
  console.table(await q(
    `SELECT e.employee_code, s.gross, s.basic, s.pf_applicable AS pf, s.esi_applicable AS esi, s.net_estimate AS stored_net, ${expectedNet} AS expected_net,
            s.ctc AS stored_ctc, s.employer_pf, s.pf_employee
       FROM salary_component_assignments s JOIN employees e ON e.id = s.employee_id
      WHERE s.status = 'active' AND s.approval_reference LIKE 'db_bill increment%' ORDER BY e.employee_code LIMIT 12`));
}

main().then(() => closePool()).catch(async (e) => { console.error("ERR", e?.message ?? e); try { await closePool(); } catch { } process.exit(1); });
