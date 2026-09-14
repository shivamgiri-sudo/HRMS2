import { db, closePool } from "../src/db/mysql.js";
import { calculatePayrollRunScoped } from "../src/modules/payroll/payrollCalculate.service.js";
import type { RowDataPacket } from "mysql2";

function arg(name: string) {
  const prefix = `--${name}=`;
  const hit = process.argv.find((part) => part.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : undefined;
}

const runId = arg("run-id");
const chunkSize = Math.max(1, Number(arg("chunk-size") ?? 25));
const limit = Math.max(0, Number(arg("limit") ?? 0));
const from = arg("from");
const to = arg("to");
const source = arg("source") ?? "ledger";

if (!runId) {
  throw new Error("Usage: npm run payroll:recalculate-affected -- --run-id=<salary_prep_run_id> [--chunk-size=25]");
}

try {
  let rows: RowDataPacket[];
  if (source === "current-mismatch") {
    if (!from || !to) {
      throw new Error("Usage for current-mismatch: add --from=YYYY-MM-DD --to=YYYY-MM-DD");
    }
    const [currentRows] = await db.query<RowDataPacket[]>(
      `SELECT spl.employee_id
         FROM salary_prep_line spl
        WHERE spl.run_id = ?
          AND EXISTS (
            SELECT 1
              FROM apr a
              JOIN employees e2 ON e2.employee_code = a.UserID
             WHERE e2.id = spl.employee_id
               AND a.ReportDate BETWEEN ? AND ?
          )
          AND ABS(COALESCE(spl.final_payable_days, 0) - LEAST(
            COALESCE(spl.paid_working_days, 0)
            + COALESCE(spl.eligible_weekoff_days, 0)
            + COALESCE(spl.eligible_holiday_days, 0),
            DAY(LAST_DAY(?))
          )) > 0.01`,
      [runId, from, to, from],
    );
    rows = currentRows;
  } else {
    const [ledgerRows] = await db.query<RowDataPacket[]>(
      `SELECT DISTINCT employee_id
         FROM attendance_reconciliation_issue
        WHERE issue_type = 'salary_payable_days_mismatch'
          AND resolved_at IS NULL
          AND JSON_UNQUOTE(JSON_EXTRACT(source_payload_json, '$.runId')) = ?`,
      [runId],
    );
    rows = ledgerRows;
  }
  let employeeIds = (rows as any[]).map((row) => String(row.employee_id)).filter(Boolean);
  if (limit > 0) employeeIds = employeeIds.slice(0, limit);
  const chunks: Array<{ index: number; employees: number; total_net: number }> = [];

  for (let i = 0; i < employeeIds.length; i += chunkSize) {
    const chunk = employeeIds.slice(i, i + chunkSize);
    const index = chunks.length + 1;
    console.log(JSON.stringify({ event: "chunk_start", index, employees: chunk.length }));
    const result = await calculatePayrollRunScoped(runId, "payroll_recalculate_affected", { employeeIds: chunk });
    chunks.push({ index, employees: chunk.length, total_net: result.total_net });
    console.log(JSON.stringify({ event: "chunk_done", index, employees: chunk.length, total_net: result.total_net }));
  }

  console.log(JSON.stringify({
    run_id: runId,
    affected_employees: employeeIds.length,
    chunk_size: chunkSize,
    chunks,
  }, null, 2));
} finally {
  await closePool();
}
