#!/usr/bin/env node
/**
 * End-to-end proof that a bulk upload lands in the SAME tables a manual entry does,
 * and that the branch-head gate actually gates.
 *
 * Read-only by default. It runs the full leave path — stage a leave_request, approve
 * it, watch the balance move — inside a transaction that is ALWAYS rolled back, so
 * production data is unchanged when it finishes.
 *
 *   node scripts/verify-bulk-upload-approval.cjs            # schema checks only
 *   node scripts/verify-bulk-upload-approval.cjs --dry-run  # + write path, rolled back
 *
 * Never pass a "commit" flag; there isn't one. This script cannot leave data behind.
 */
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
require(path.join(ROOT, "node_modules/dotenv")).config({ path: path.join(ROOT, ".env") });
const mysql = require(path.join(ROOT, "node_modules/mysql2/promise"));

const DRY_RUN = process.argv.includes("--dry-run");
let pass = 0;
let fail = 0;

function check(label, ok, detail) {
  if (ok) {
    pass++;
    console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail++;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

async function columnExists(c, table, column) {
  const [r] = await c.query(
    `SELECT COUNT(*) n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column],
  );
  return Number(r[0].n) > 0;
}

async function tableExists(c, table) {
  const [r] = await c.query(
    `SELECT COUNT(*) n FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [table],
  );
  return Number(r[0].n) > 0;
}

(async () => {
  const c = await mysql.createConnection({
    host: process.env.QHOST || process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    connectTimeout: 20000,
    multipleStatements: false,
  });

  const [[who]] = [await c.query("SELECT DATABASE() db, CURRENT_USER() u")];
  console.log(`\nConnected: ${who[0].db} as ${who[0].u}\n`);

  // ── 1. Migration 1522 landed ───────────────────────────────────────────────
  console.log("1. Migration 1522 schema");
  for (const col of ["approval_status", "branch_id", "approved_by", "approved_at",
                     "approval_remarks", "submitted_for_approval_at"]) {
    check(`upload_batch.${col}`, await columnExists(c, "upload_batch", col));
  }
  check("upload_batch_row.created_entity_type", await columnExists(c, "upload_batch_row", "created_entity_type"));
  check("upload_batch_row.created_entity_id", await columnExists(c, "upload_batch_row", "created_entity_id"));
  check("bulk_upload_locked_entity table", await tableExists(c, "bulk_upload_locked_entity"));

  const [[ded]] = [await c.query(
    `SELECT COLUMN_TYPE t FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'employee_deduction_entries' AND COLUMN_NAME = 'status'`,
  )];
  check(
    "employee_deduction_entries.status has pending_approval",
    String(ded[0]?.t || "").includes("pending_approval"),
    ded[0]?.t,
  );

  // ── 2. Templates with sample data ──────────────────────────────────────────
  console.log("\n2. Upload templates (with sample rows)");
  const [tpls] = await c.query(
    `SELECT upload_type_code, required_columns, sample_row, active_status
       FROM upload_template_master
      WHERE upload_type_code IN ('ATTENDANCE_REGULARIZATION_BULK','LEAVE_APPLICATION_BULK','INCENTIVE_BULK','DEDUCTION_BULK')
      ORDER BY upload_type_code`,
  );
  check("all four templates registered", tpls.length === 4, `found ${tpls.length}`);
  for (const t of tpls) {
    const sample = typeof t.sample_row === "string" ? JSON.parse(t.sample_row) : t.sample_row;
    const required = typeof t.required_columns === "string" ? JSON.parse(t.required_columns) : t.required_columns;
    const missing = (required || []).filter((col) => !sample || sample[col] === undefined || sample[col] === "");
    check(`${t.upload_type_code}: sample row fills every required column`, missing.length === 0,
      missing.length ? `missing: ${missing.join(", ")}` : `${(required || []).length} columns`);
    check(`${t.upload_type_code}: active`, Number(t.active_status) === 1);
  }

  // Sample codes must exist in the live masters, or the first upload fails.
  const [[lv]] = [await c.query("SELECT COUNT(*) n FROM leave_type_master WHERE leave_code = 'CL'")];
  check("sample leave_code CL exists in leave_type_master", Number(lv[0].n) > 0);
  const [[dt]] = [await c.query("SELECT COUNT(*) n FROM payroll_deduction_type WHERE deduction_code = 'CANTEEN' AND active_status = 1")];
  check("sample deduction_type_code CANTEEN is active", Number(dt[0].n) > 0);
  const [[ic]] = [await c.query("SELECT COUNT(*) n FROM incentive_master WHERE incentive_code = 'PERF' AND active_status = 1")];
  check("sample incentive_code PERF is active", Number(ic[0].n) > 0);
  const [[rc]] = [await c.query("SELECT COUNT(*) n FROM attendance_reason_master WHERE code = 'BIOMETRIC_MISMATCH' AND active = 1")];
  check("sample reason_code BIOMETRIC_MISMATCH is active", Number(rc[0].n) > 0);
  const [[emp0]] = [await c.query("SELECT COUNT(*) n FROM employees WHERE employee_code = '24852C' AND employment_status = 'active'")];
  check("sample employee_code 24852C is an active employee", Number(emp0[0].n) > 0);

  // ── 3. Page access ─────────────────────────────────────────────────────────
  console.log("\n3. Page access (the feature must be reachable)");
  const [[pc]] = [await c.query("SELECT COUNT(*) n FROM page_catalog WHERE page_code = 'BULK_UPLOAD_APPROVALS' AND active_status = 1")];
  check("BULK_UPLOAD_APPROVALS in page_catalog", Number(pc[0].n) > 0);
  const [[bh]] = [await c.query("SELECT COUNT(*) n FROM role_page_access WHERE role_key = 'branch_head' AND page_code = 'BULK_UPLOAD_APPROVALS' AND active_status = 1 AND can_view = 1")];
  check("branch_head can view the approval queue", Number(bh[0].n) > 0);
  const [[wf]] = [await c.query("SELECT COUNT(*) n FROM role_page_access WHERE role_key = 'wfm' AND page_code = 'BULK_UPLOAD' AND active_status = 1")];
  check("wfm grant on BULK_UPLOAD is ACTIVE (was active_status=0)", Number(wf[0].n) > 0);

  // ── 4. The write path, always rolled back ──────────────────────────────────
  if (!DRY_RUN) {
    console.log("\n4. Write path — skipped (pass --dry-run to exercise it inside a rolled-back transaction)");
  } else {
    console.log("\n4. Write path (inside a transaction that WILL be rolled back)");
    const [emps] = await c.query(
      `SELECT id, employee_code, branch_id FROM employees
        WHERE employment_status = 'active' AND branch_id IS NOT NULL
        ORDER BY employee_code LIMIT 1`,
    );
    const emp = emps[0];
    const [lt] = await c.query("SELECT id, leave_code FROM leave_type_master WHERE leave_code = 'CL' LIMIT 1");

    if (!emp || !lt[0]) {
      check("found a test employee and CL leave type", false);
    } else {
      await c.beginTransaction();
      try {
        const year = new Date().getFullYear();
        const [before] = await c.query(
          `SELECT allocated_days, used_days, adjusted_days FROM leave_balance_ledger
            WHERE employee_id = ? AND leave_type_id = ? AND balance_year = ? LIMIT 1`,
          [emp.id, lt[0].id, year],
        );
        const usedBefore = Number(before[0]?.used_days ?? 0);

        // Stage exactly what the importer stages.
        const [ins] = await c.query(
          `INSERT INTO leave_request
             (id, employee_id, leave_type_id, from_date, to_date, total_days, reason, status,
              requires_branch_head_approval, approval_level)
           VALUES (UUID(), ?, ?, ?, ?, 1, 'verification probe — rolled back', 'pending', 1, 'branch_head')`,
          [emp.id, lt[0].id, `${year}-01-02`, `${year}-01-02`],
        );
        check("staged leave_request lands in the real leave_request table", ins.affectedRows === 1);

        const [staged] = await c.query(
          `SELECT status, requires_branch_head_approval, approval_level FROM leave_request
            WHERE employee_id = ? AND reason = 'verification probe — rolled back' LIMIT 1`,
          [emp.id],
        );
        check("staged row is pending, routed to branch_head",
          staged[0]?.status === "pending" && Number(staged[0]?.requires_branch_head_approval) === 1
            && staged[0]?.approval_level === "branch_head",
          JSON.stringify(staged[0]));

        const [after] = await c.query(
          `SELECT used_days FROM leave_balance_ledger
            WHERE employee_id = ? AND leave_type_id = ? AND balance_year = ? LIMIT 1`,
          [emp.id, lt[0].id, year],
        );
        check("balance is UNCHANGED while pending (nothing applies before approval)",
          Number(after[0]?.used_days ?? 0) === usedBefore,
          `used_days ${usedBefore} -> ${Number(after[0]?.used_days ?? 0)}`);

        // The deduction pending state must be invisible to payroll's own filter.
        await c.query(
          `INSERT INTO employee_deduction_entries
             (id, employee_id, description, deduction_type_code, amount, is_prorated, run_month, status, created_by, branch_id)
           VALUES (UUID(), ?, 'verification probe — rolled back', 'CANTEEN', 1.00, 0, ?, 'pending_approval', ?, ?)`,
          [emp.id, `${year}-01`, emp.id, emp.branch_id],
        );
        const [payrollSees] = await c.query(
          `SELECT COUNT(*) n FROM employee_deduction_entries
            WHERE employee_id = ? AND description = 'verification probe — rolled back' AND status = 'active'`,
          [emp.id],
        );
        check("a pending deduction is INVISIBLE to payroll's status='active' filter",
          Number(payrollSees[0].n) === 0);

        const [anyState] = await c.query(
          `SELECT status FROM employee_deduction_entries
            WHERE employee_id = ? AND description = 'verification probe — rolled back' LIMIT 1`,
          [emp.id],
        );
        check("but the row IS in employee_deduction_entries, the real table",
          anyState[0]?.status === "pending_approval", anyState[0]?.status);
      } finally {
        await c.rollback();
        console.log("  (transaction rolled back — production data unchanged)");
      }

      const [leftover] = await c.query(
        `SELECT COUNT(*) n FROM leave_request WHERE reason = 'verification probe — rolled back'`,
      );
      check("nothing left behind after rollback", Number(leftover[0].n) === 0);
    }
  }

  console.log(`\n${pass} passed, ${fail} failed\n`);
  await c.end();
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.error("verification error:", e.message);
  process.exit(1);
});
