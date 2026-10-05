/**
 * What the 14k implemented salary_increment_request rows are. STRICTLY READ-ONLY, employee codes only in samples.
 *
 *   npx tsx scripts/increment-requests-audit.ts
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
  console.log("by source / status / month created:");
  console.table(await q(`SELECT source, status, DATE_FORMAT(created_at,'%Y-%m') AS created, COUNT(*) AS n,
        MIN(effective_from) AS first_effective, MAX(effective_from) AS last_effective FROM salary_increment_request GROUP BY 1,2,3 ORDER BY 3,1`));

  console.log("change size (proposed vs current CTC), all rows:");
  console.table(await q(`SELECT source, CASE WHEN proposed_ctc = current_ctc THEN 'no change' WHEN proposed_ctc > current_ctc THEN 'increase' ELSE 'decrease' END AS kind,
        COUNT(*) AS n, ROUND(AVG(increment_percentage),2) AS avg_pct, ROUND(MAX(increment_percentage),2) AS max_pct FROM salary_increment_request GROUP BY 1,2 ORDER BY 1,2`));

  console.log("who / how they were created:");
  console.table(await q(`SELECT source, requested_role, reason_code, COUNT(*) AS n, COUNT(DISTINCT requested_by) AS requesters, COUNT(DISTINCT implemented_by) AS implementers,
        SUM(approved_at IS NULL) AS no_approval, SUM(new_assignment_id IS NOT NULL) AS made_esa_row, SUM(current_assignment_id IS NULL) AS no_current_assignment
        FROM salary_increment_request GROUP BY 1,2,3 ORDER BY n DESC LIMIT 12`));

  console.log("real increases (not 0%), any source:");
  console.table(await q(`SELECT e.employee_code, r.source, r.status, r.effective_from, ROUND(r.current_ctc) AS cur, ROUND(r.proposed_ctc) AS prop, ROUND(r.increment_percentage,2) AS pct, r.reason_code
        FROM salary_increment_request r JOIN employees e ON e.id = r.employee_id WHERE r.proposed_ctc <> r.current_ctc ORDER BY r.created_at DESC LIMIT 25`));

  console.log("employees with more than one request:");
  console.table(await q(`SELECT n, COUNT(*) AS employees FROM (SELECT employee_id, COUNT(*) AS n FROM salary_increment_request GROUP BY employee_id) t GROUP BY n ORDER BY n`));

  console.log("downstream rows tied to these requests:");
  console.table(await q(`SELECT (SELECT COUNT(*) FROM salary_increment_audit_log) AS audit_rows, (SELECT COUNT(*) FROM salary_increment_letter) AS letter_rows,
        (SELECT COUNT(*) FROM salary_increment_letter WHERE status NOT IN ('pending','not_required')) AS letters_sent_or_generated`).catch((x) => [{ note: String(x.message).slice(0, 100) }]));

  console.log("do the 'no change' requests match the employee's current CTC? (sample of 10)");
  console.table(await q(`SELECT e.employee_code, ROUND(r.current_ctc) AS cur, ROUND(r.proposed_ctc) AS prop,
        (SELECT ROUND(a.ctc_annual) FROM employee_salary_assignment a WHERE a.employee_id = r.employee_id AND a.active_status = 1 ORDER BY a.effective_from DESC LIMIT 1) AS esa_now
        FROM salary_increment_request r JOIN employees e ON e.id = r.employee_id WHERE r.proposed_ctc = r.current_ctc ORDER BY r.created_at LIMIT 10`));
}

main().then(() => closePool()).catch(async (e) => { console.error("ERR", e?.message ?? e); try { await closePool(); } catch { } process.exit(1); });
