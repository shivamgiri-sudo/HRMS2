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

  // Grants this tool has itself applied before. A grant is only a revocation
  // candidate if it is in here AND missing from today's matrix — i.e. the
  // matrix used to want it and no longer does. A grant that is active in
  // role_page_access but was never recorded here was granted some other way
  // (an admin UI action, a migration, a manual SQL fix) and this tool has no
  // basis to claim it as wrong; it is left alone unconditionally. Table starts
  // empty, so on first run nothing existing is a candidate — this can only
  // ever be as safe or safer than before, never more destructive.
  await conn.execute(
    `CREATE TABLE IF NOT EXISTS rbac_matrix_applied_grants (
       role_key VARCHAR(64) NOT NULL,
       page_code VARCHAR(128) NOT NULL,
       first_applied_at DATETIME NOT NULL,
       last_applied_at DATETIME NOT NULL,
       PRIMARY KEY (role_key, page_code)
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  );
  const [appliedRows] = await conn.query("SELECT role_key, page_code FROM rbac_matrix_applied_grants");
  const previouslyApplied = new Map();
  for (const row of appliedRows) {
    if (!previouslyApplied.has(row.role_key)) previouslyApplied.set(row.role_key, new Set());
    previouslyApplied.get(row.role_key).add(row.page_code);
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
  // The split is computed on every run, not just under --apply. The refusal below tells
  // the operator to "run without --apply first to see the full picture", and that was a
  // lie while this block was gated on `apply`: a dry run printed only a per-role `extra`
  // count, which merges live revocations with inert ones and so never showed the number
  // that actually decides whether --apply is refused.
  const allowRevoke = process.argv.includes("--allow-revoke");
  {
    const wouldRevoke = [];
    const inertRevokes = [];
    for (const role of roles) {
      const desiredSet = new Set(
        getRolePageCodes(role, activePages).filter((pageCode) => activePageSet.has(pageCode)),
      );
      for (const pageCode of grants.get(role) ?? new Set()) {
        if (desiredSet.has(pageCode)) continue;
        // Never a revocation candidate unless this tool granted it before — see
        // rbac_matrix_applied_grants above. A grant absent from the matrix but
        // also absent from that table was granted some other way and is not
        // this tool's to flag, let alone revoke.
        if (!(previouslyApplied.get(role)?.has(pageCode))) continue;
        // A grant on a page_catalog row with active_status = 0 reaches nothing: getAccessMe
        // returns those codes as disabledPageCodes and ProtectedRoute denies them regardless
        // of the grant. Revoking one removes no access a user could actually use, so it must
        // not be the thing that blocks an otherwise-correct apply. Only a grant on a LIVE
        // page is real access worth protecting.
        (activePageSet.has(pageCode) ? wouldRevoke : inertRevokes).push(`${role}: ${pageCode}`);
      }
    }
    if (inertRevokes.length > 0) {
      console.log(
        `Note: ${inertRevokes.length} grant(s) on pages that are inactive in page_catalog will be ` +
          `deactivated. These reach nothing today — ProtectedRoute already denies disabled pages — ` +
          `so they are not treated as revocations:\n` +
          inertRevokes.map((entry) => `  - ${entry}`).join("\n"),
      );
    }
    if (wouldRevoke.length > 0) {
      const detail =
        `${wouldRevoke.length} existing grant(s) on LIVE pages are not in the matrix:\n\n` +
        wouldRevoke.map((entry) => `  - ${entry}`).join("\n") +
        `\n\nThe matrix is behind production. Either add these to LIVE_IMPORTED_PAGE_CODES in` +
        ` backend/src/shared/rbacPageMatrix.ts (it is keyed by role, so add each code under` +
        ` the role that holds it — never to a shared list, which would widen access to every` +
        ` role), or re-run with --allow-revoke if every revocation above is intended.`;

      // Only --apply refuses. A dry run reports the same list and exits 0, which is what
      // makes "run without --apply first" actually useful.
      if (apply && !allowRevoke) {
        console.error(`Refusing to apply: applying would deactivate ${detail}`);
        process.exitCode = 1;
        await conn.end();
        process.exit(1);
      }
      console.log(
        (allowRevoke
          ? `--allow-revoke is set, so these WILL be deactivated. `
          : `Dry run — nothing was written. An --apply would be refused because `) + detail,
      );
    } else if (!apply) {
      console.log("Revocation guard: no live grant would be revoked; --apply would not be refused.");
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
      // Only ever deactivates a grant this tool previously wrote AND no longer
      // wants. Anything active that this tool never recorded applying is left
      // untouched, no matter what today's matrix says — see previouslyApplied.
      const ownedExtras = [...actualSet].filter(
        (pageCode) => !desiredSet.has(pageCode) && previouslyApplied.get(role)?.has(pageCode),
      );
      if (ownedExtras.length > 0) {
        const [disableResult] = await conn.execute(
          `UPDATE role_page_access SET active_status = 0 WHERE role_key = ? AND active_status = 1 AND page_code IN (${ownedExtras.map(() => "?").join(",")})`,
          [role, ...ownedExtras],
        );
        disabled += Number(disableResult.affectedRows || 0);
      }
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

      // Record that this tool is now the one asserting this grant, so a future
      // run may revoke it if the matrix later drops it — never before then.
      await conn.execute(
        `INSERT INTO rbac_matrix_applied_grants (role_key, page_code, first_applied_at, last_applied_at)
         VALUES (?, ?, NOW(), NOW())
         ON DUPLICATE KEY UPDATE last_applied_at = NOW()`,
        [role, pageCode],
      );
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
