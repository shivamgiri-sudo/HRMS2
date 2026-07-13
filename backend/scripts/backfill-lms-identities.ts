import { db } from "../src/db/mysql.js";
import { provisionLmsIdentityForEmployee } from "../src/modules/lms/lms-provisioning.service.js";
import type { RowDataPacket } from "mysql2/promise";

function parseLimit(): number {
  const arg = process.argv.find((value) => value.startsWith("--limit="));
  if (!arg) return 250;
  const parsed = Number(arg.split("=", 2)[1]);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 250;
}

async function main() {
  const limit = parseLimit();
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT e.employee_code
       FROM employees e
       LEFT JOIN lms_employee_mapping m ON m.employee_id = e.id AND m.is_active = 1
      WHERE e.active_status = 1
        AND m.id IS NULL
      ORDER BY e.employee_code ASC
      LIMIT ?`,
    [limit],
  );

  let created = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const row of rows as Array<{ employee_code: string }>) {
    const employeeCode = String(row.employee_code ?? "").trim();
    if (!employeeCode) {
      skipped++;
      continue;
    }

    try {
      const result = await provisionLmsIdentityForEmployee({ employeeCode });
      if (result.mappingSynced && result.lmsLearnerId) {
        created++;
        console.log(`[ok] ${employeeCode} -> ${result.lmsLearnerId}`);
      } else {
        skipped++;
        console.log(`[skip] ${employeeCode} -> ${result.message ?? "no change"}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${employeeCode}: ${message}`);
      console.error(`[err] ${employeeCode}: ${message}`);
    }
  }

  console.log(JSON.stringify({ limit, created, skipped, errors: errors.length }, null, 2));
  if (errors.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
