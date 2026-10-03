/**
 * Validate flagged HRMS rows against db_bill. READ-ONLY (HRMS SELECTs + billQuery SELECTs).
 *
 *   npx tsx scripts/dbbill-validate-flagged.ts
 */
import "dotenv/config";
import { db } from "../src/db/mysql.js";
import { billQuery } from "../src/db/billDb.js";
import type { RowDataPacket } from "mysql2";

const INC_CODES = ["59699C", "62516C", "62654C", "63107C", "MAS58094"];
const SAL_CODE = "MAS63386";
const ph = INC_CODES.map(() => "?").join(",");

(async () => {
  console.log("== db_bill upload_incentive_breakup, Aug 2026, per employee + type + status ==");
  const bill = (await billQuery(
    `SELECT EmpCode, IncentiveType, ApproveStatus, COUNT(*) n, SUM(Amount) amt
       FROM upload_incentive_breakup
      WHERE SalaryMonth >= '2026-08-01' AND SalaryMonth < '2026-09-01'
        AND EmpCode IN (${INC_CODES.map((c) => `'${c}'`).join(",")})
      GROUP BY EmpCode, IncentiveType, ApproveStatus ORDER BY EmpCode, IncentiveType`)) as any[];
  console.table(bill);

  console.log("== HRMS approved Aug lines per employee + type + batch_ref ==");
  const [hr] = await db.execute<RowDataPacket[]>(
    `SELECT l.employee_code, l.incentive_code, b.batch_ref, b.status, COUNT(*) n, SUM(l.amount) amt
       FROM incentive_upload_line l JOIN incentive_upload_batch b ON b.id = l.batch_id
      WHERE b.pay_month = '2026-08' AND l.employee_code IN (${ph})
      GROUP BY l.employee_code, l.incentive_code, b.batch_ref, b.status
      ORDER BY l.employee_code, l.incentive_code, b.batch_ref`, INC_CODES);
  console.table(hr);

  console.log(`== db_bill salary_data for ${SAL_CODE} (salary figures only) ==`);
  const sal = (await billQuery(
    `SELECT * FROM salary_data WHERE EmpCode = '${SAL_CODE}' ORDER BY SalayDate DESC LIMIT 3`)) as any[];
  for (const r of sal) {
    const keep: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(r)) if (/^(EmpCode|SalayDate)$|gross|ctc|basic|hra|package|total|net|payable|paid/i.test(k)) keep[k] = v;
    console.log(JSON.stringify(keep));
  }
  console.log(`== HRMS ${SAL_CODE}: salary rows ==`);
  const [esa] = await db.execute<RowDataPacket[]>(
    `SELECT esa.id, esa.ctc_annual, esa.structure_id, esa.effective_from, esa.created_at, esa.active_status
       FROM employee_salary_assignment esa JOIN employees e ON e.id = esa.employee_id WHERE e.employee_code = ?`, [SAL_CODE]);
  console.table(esa);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
