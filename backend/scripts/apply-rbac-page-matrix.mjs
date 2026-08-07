import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import mysql from "mysql2/promise";
import {
  getRolePageCodes,
  ROLE_SPECIFIC_PAGE_CODES,
} from "../src/shared/rbacPageMatrix.ts";

function loadBackendEnv() {
  const envPath = path.resolve("backend/.env");
  if (!fs.existsSync(envPath)) return;

  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[match[1]] = value;
  }
}

function assertDbConfig() {
  for (const key of ["DB_HOST", "DB_USER", "DB_PASSWORD", "DB_NAME"]) {
    if (!process.env[key]) throw new Error(`${key} is required`);
  }
}

const apply = process.argv.includes("--apply");
const backupTable = `role_page_access_backup_${new Date().toISOString().slice(0, 10).replaceAll("-", "")}_rbac_cleanup`;
const roles = ["super_admin", ...Object.keys(ROLE_SPECIFIC_PAGE_CODES)];

loadBackendEnv();
assertDbConfig();

const conn = await mysql.createConnection({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

try {
  const [activeRows] = await conn.query("SELECT page_code FROM page_catalog WHERE active_status = 1 ORDER BY page_code");
  const activePages = activeRows.map((row) => row.page_code);
  const activePageSet = new Set(activePages);
  const [grantRows] = await conn.query(
    "SELECT role_key, page_code FROM role_page_access WHERE active_status = 1 AND can_view = 1 ORDER BY role_key, page_code",
  );

  const grants = new Map();
  for (const row of grantRows) {
    if (!grants.has(row.role_key)) grants.set(row.role_key, new Set());
    grants.get(row.role_key).add(row.page_code);
  }

  const summary = [];
  let inserted = 0;
  let enabled = 0;
  let disabled = 0;

  // ── Revocation guard ────────────────────────────────────────────────────────
  // This script's UPDATE deactivates every active grant not present in the matrix.
  // The matrix drifts behind production constantly — other sessions add pages to
  // role_page_access without updating LIVE_IMPORTED_PAGE_CODES — so an --apply run
  // silently revokes whatever has accumulated since the snapshot was last refreshed.
  //
  // Measured on 2026-08-08: a run would have deactivated ~132 grants across 30 roles,
  // including finance_head losing the entire finance module (FINANCE_GRN,
  // FINANCE_PROCESS_PNL, FINANCE_HEAD_DASHBOARD, FINANCE_BRANCH_BUDGET,
  // FINANCE_BUDGET_CONSOLIDATION), payroll_head losing PAYROLL_SIGN_OFF and
  // PAYROLL_AUDIT_TRAIL, and branch_head losing ATS_DASHBOARD and EMPLOYEE_MANAGEMENT.
  //
  // Not every extra is an accident to preserve — some were removed from the matrix
  // deliberately (the CEO's ADVANCED_REPORTS and KPI_DASHBOARD were dropped after UAT).
  // That is exactly why this cannot be auto-resolved: it needs a human to say which
  // revocations are intended. So --apply now refuses when anything would be revoked,
  // and the operator must either refresh LIVE_IMPORTED_PAGE_CODES or pass
  // --allow-revoke having read the list.
  const allowRevoke = process.argv.includes("--allow-revoke");
  if (apply && !allowRevoke) {
    const wouldRevoke = [];
    for (const role of roles) {
      const desiredSet = new Set(
        getRolePageCodes(role, activePages).filter((pageCode) => activePageSet.has(pageCode)),
      );
      for (const pageCode of grants.get(role) ?? new Set()) {
        if (!desiredSet.has(pageCode)) wouldRevoke.push(`${role}: ${pageCode}`);
      }
    }
    if (wouldRevoke.length > 0) {
      console.error(
        `Refusing to apply: this would deactivate ${wouldRevoke.length} existing grant(s).\n\n` +
          wouldRevoke.map((entry) => `  - ${entry}`).join("\n") +
          `\n\nThe matrix is behind production. Either add these to LIVE_IMPORTED_PAGE_CODES in` +
          ` backend/src/shared/rbacPageMatrix.ts, or re-run with --allow-revoke if every` +
          ` revocation above is intended. Run without --apply first to see the full picture.`,
      );
      process.exitCode = 1;
      await conn.end();
      process.exit(1);
    }
  }

  // Backup and the EMPLOYEE_SELF_DASHBOARD reactivation happen only once the
  // revocation guard above has passed. They used to run before any validation, so an
  // --apply that was going to be refused still left a backup table behind and had
  // already written to page_catalog.
  if (apply) {
    await conn.beginTransaction();
    await conn.execute(
      `CREATE TABLE IF NOT EXISTS ${backupTable} AS SELECT *, NOW() AS backed_up_at FROM role_page_access WHERE 1=0`,
    );
    await conn.execute(
      `INSERT INTO ${backupTable} SELECT rpa.*, NOW() AS backed_up_at FROM role_page_access rpa WHERE rpa.role_key IN (${roles.map(() => "?").join(",")})`,
      roles,
    );
    await conn.execute("UPDATE page_catalog SET active_status = 1 WHERE page_code = 'EMPLOYEE_SELF_DASHBOARD'");
  }

  for (const role of roles) {
    const desired = getRolePageCodes(role, activePages).filter((pageCode) => activePageSet.has(pageCode));
    const desiredSet = new Set(desired);
    const actualSet = grants.get(role) ?? new Set();
    const extra = [...actualSet].filter((pageCode) => !desiredSet.has(pageCode));
    const missing = desired.filter((pageCode) => !actualSet.has(pageCode));

    summary.push({
      role,
      actual: actualSet.size,
      desired: desired.length,
      extra: extra.length,
      missing: missing.length,
      extra_sample: extra.slice(0, 8).join(", "),
      missing_sample: missing.slice(0, 8).join(", "),
    });

    if (!apply) continue;

    if (desired.length > 0) {
      const [disableResult] = await conn.execute(
        `UPDATE role_page_access SET active_status = 0 WHERE role_key = ? AND active_status = 1 AND page_code NOT IN (${desired.map(() => "?").join(",")})`,
        [role, ...desired],
      );
      disabled += Number(disableResult.affectedRows || 0);
    }

    for (const pageCode of desired) {
      const full = role === "super_admin" ? 1 : 0;
      const [result] = await conn.execute(
        `INSERT INTO role_page_access (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
         VALUES (UUID(), ?, ?, 1, ?, ?, ?, ?, 1)
         ON DUPLICATE KEY UPDATE can_view = 1, can_create = VALUES(can_create), can_edit = VALUES(can_edit), can_delete = VALUES(can_delete), can_export = VALUES(can_export), active_status = 1`,
        [role, pageCode, full, full, full, full],
      );
      if (result.affectedRows === 1) inserted += 1;
      if (result.affectedRows === 2) enabled += 1;
    }
  }

  if (apply) await conn.commit();

  console.table(summary);
  console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", backupTable: apply ? backupTable : null, inserted, enabled, disabled }, null, 2));
} catch (error) {
  if (apply) await conn.rollback();
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await conn.end();
}
