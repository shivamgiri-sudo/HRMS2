// Read-only audit of the Branch Health escalations on LIVE data. Nothing is sent, nothing is written.
// For every reported branch it builds the report, prints each escalation with its source, then re-reads the
// underlying rows with independent SQL (not the report's own functions) and prints both side by side, so a
// reviewer can see the email's numbers match the tables. No employee names or codes are printed.
//
//   DOTENV_CONFIG_PATH=/var/www/HRMS2/backend/.env npx tsx scripts/audit-branch-health-escalations.ts [branch]
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";
import { fetchAllBranchHealthData } from "../src/modules/branch-health-report/query.js";
import { buildBranchHealthReport } from "../src/modules/branch-health-report/metrics.js";
import { summarisePeers } from "../src/modules/branch-health-report/rollup.js";
import { cycleMonthOf } from "../src/modules/branch-health-report/payroll-readiness.js";

const only = process.argv[2];
const date = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10); // IST
const cycle = cycleMonthOf(date);
const one = async (sql: string, p: unknown[] = []) => ((await db.execute<RowDataPacket[]>(sql, p))[0][0] ?? {}) as any;

const [branches] = await db.execute<RowDataPacket[]>(
  `SELECT id, branch_name FROM branch_master WHERE active_status = 1 ORDER BY branch_name`);
const wanted = (branches as any[]).filter((b) => !only || String(b.branch_name).toLowerCase() === only.toLowerCase());

console.log(`report date ${date} (IST), payroll cycle month ${cycle}`);
const cal = await one(`SELECT DATE_FORMAT(attendance_cutoff_date,'%Y-%m-%d') cutoff, DATE_FORMAT(incentive_upload_deadline,'%Y-%m-%d') incentive,
  DATE_FORMAT(payroll_run_date,'%Y-%m-%d') run FROM payroll_calendar WHERE calendar_month = ?`, [cycle]);
console.log("payroll_calendar:", Object.keys(cal).length ? JSON.stringify(cal) : "NO ROW for the cycle month (payroll rules stay silent)");

const reports = [];
for (const b of wanted) {
  const raw = await fetchAllBranchHealthData(String(b.branch_name), date);
  reports.push({ b, report: buildBranchHealthReport(String(b.branch_name), date, raw) });
}
const peers = summarisePeers(reports.map((r) => r.report));

let mismatches = 0;
for (const { b, report } of reports) {
  const id = String(b.id);
  const p = peers.get(report.branch);
  console.log(`\n== ${report.branch}: ${report.escalations.length} escalation(s)${p ? `, rank ${p.rank}/${p.total}` : ""}, status ${report.overallStatus}`);
  for (const e of report.escalations) console.log(` - [${e.key}] ${e.label}\n     ${e.detail}\n     source: ${e.source}`);

  // Independent re-reads of the same facts.
  const hdr = await db.execute<RowDataPacket[]>(`SELECT status, COUNT(*) n FROM finance_budget_header WHERE branch_id = ? AND period_code = ? GROUP BY status`, [id, date.slice(0, 7)]);
  const statuses = (hdr[0] as any[]).map((r) => `${r.status}:${r.n}`).join(", ") || "none";
  const hasActive = (hdr[0] as any[]).some((r) => r.status === "active");
  const flaggedBudget = report.escalations.some((e) => e.key.startsWith("budget_"));
  console.log(`   check budget headers ${date.slice(0, 7)}: ${statuses}${hasActive && flaggedBudget ? "   <-- MISMATCH: active budget but flagged" : ""}`);
  if (hasActive && flaggedBudget) mismatches++;

  const [cs, ce] = [`${cycle}-01`, new Date(Date.UTC(+cycle.slice(0, 4), +cycle.slice(5, 7), 0)).toISOString().slice(0, 10)];
  const reg = await one(`SELECT COUNT(*) n FROM attendance_regularization ar JOIN employees e ON e.id = ar.employee_id
     WHERE e.active_status = 1 AND e.branch_id = ? AND LOWER(ar.status) IN ('pending','escalated') AND ar.session_date BETWEEN ? AND ?`, [id, cs, ce]);
  const lv = await one(`SELECT COUNT(*) n FROM leave_request lr JOIN employees e ON e.id = lr.employee_id
     WHERE e.active_status = 1 AND e.branch_id = ? AND LOWER(lr.status) = 'pending' AND COALESCE(lr.start_date, lr.from_date) <= ? AND COALESCE(lr.end_date, lr.to_date) >= ?`, [id, ce, cs]);
  const pr = report.raw.payrollReadiness;
  const sameReg = pr?.pendingRegularization == null || Number(reg.n) === pr.pendingRegularization;
  const sameLv = pr?.pendingLeave == null || Number(lv.n) === pr.pendingLeave;
  if (!sameReg || !sameLv) mismatches++;
  console.log(`   check cycle ${cycle}: regularization pending ${reg.n} (report ${pr?.pendingRegularization ?? "n/a"}), leave pending ${lv.n} (report ${pr?.pendingLeave ?? "n/a"})${sameReg && sameLv ? "" : "   <-- MISMATCH"}`);

  try {
    const inc = (await db.execute<RowDataPacket[]>(
      `SELECT COALESCE(NULLIF(salary_month,''), NULLIF(pay_month,'')) m, status, COUNT(*) n FROM incentive_upload_batch
        WHERE branch_id = ? AND COALESCE(NULLIF(salary_month,''), NULLIF(pay_month,'')) >= ? GROUP BY 1, 2 ORDER BY 1 DESC`, [id, `${cycle.slice(0, 4)}-01`]))[0] as any[];
    console.log(`   check incentive batches this year: ${inc.map((r) => `${r.m}/${r.status}:${r.n}`).join(", ") || "none"}; report: state=${pr?.incentiveState ?? "n/a"} expected=${pr?.incentivesExpected ?? "n/a"}`);
  } catch (e) { console.log(`   check incentive batches: not readable (${e instanceof Error ? e.message : e}); report makes no claim: state=${pr?.incentiveState ?? "n/a"}`); }

  const ic = await one(`SELECT COUNT(*) n FROM salary_increment_request s JOIN employees e ON e.id = s.employee_id
     WHERE e.branch_id = ? AND s.source = 'hrms' AND s.status IN ('submitted','hr_validated')`, [id]);
  console.log(`   check increments pending ${ic.n} (report ${pr?.pendingIncrements ?? "n/a"})`);
  if (pr?.pendingIncrements != null && Number(ic.n) !== pr.pendingIncrements) mismatches++;
}
// Breakdown of the open ("stuck") GRNs the report counts, to show exactly what is in the number.
console.log("\n== Stuck GRN breakdown (same filter the report uses: bill_source_id IS NULL, created_by not migration sentinel)");
for (const { b, report } of reports) {
  const id = String(b.id);
  const rows = (await db.execute<RowDataPacket[]>(
    `SELECT status,
            (legacy_raised_by_name IS NOT NULL AND legacy_raised_by_name <> '') AS has_legacy_name,
            (grn_type) AS grn_type,
            DATE_FORMAT(created_at,'%Y-%m') AS created_month,
            COUNT(*) AS n, MIN(DATEDIFF(CURDATE(), DATE(created_at))) AS newest_days, MAX(DATEDIFF(CURDATE(), DATE(created_at))) AS oldest_days
       FROM grn_request
      WHERE branch_id = ? AND bill_source_id IS NULL AND COALESCE(created_by,'') NOT LIKE '00000000-%'
        AND status IN ('submitted','branch_head_approved','accounts_head_approved','returned_to_branch_head','returned_to_raiser')
      GROUP BY 1,2,3,4 ORDER BY 4,1`, [id]))[0] as any[];
  const total = rows.reduce((a, r) => a + Number(r.n), 0);
  console.log(`-- ${report.branch}: ${total} (report says ${report.raw.grnStats.pending})`);
  for (const r of rows) console.log(`   ${r.created_month} ${r.status} type=${r.grn_type} legacyName=${r.has_legacy_name} n=${r.n} age ${r.newest_days}-${r.oldest_days}d`);
  const sent = (await db.execute<RowDataPacket[]>(`SELECT COUNT(*) n FROM grn_request WHERE branch_id = ? AND status IN ('submitted','branch_head_approved','accounts_head_approved','returned_to_branch_head','returned_to_raiser') AND (bill_source_id IS NOT NULL OR COALESCE(created_by,'') LIKE '00000000-%')`, [id]))[0][0] as any;
  console.log(`   (excluded as migrated, same statuses: ${sent.n})`);
}
console.log(`\nMISMATCHES: ${mismatches}`);
process.exit(mismatches ? 2 : 0);
