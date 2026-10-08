/**
 * Close specific cost centres on an explicit business ruling.
 *
 * The activity reconciliation deliberately leaves two categories untouched because data alone
 * cannot decide them: BILLING_ONLY (invoiced recently but no staff) and NO_HISTORY (no salary or
 * invoice ever). Those require a human call. This script applies such a call to a named list.
 *
 * close_date is set to the last invoice date where one exists. Where there is no evidence at all,
 * the record is deactivated with close_date left NULL — recording "inactive, date unknown" rather
 * than inventing one. The Org Masters UI renders that as "Inactive" with no "since" label.
 *
 * Backs up prior values to master_activity_status_backup (same table and rollback pattern as
 * apply-master-activity-status.ts) before writing, inside a transaction. Dry-run by default.
 *
 * Usage:
 *   npx tsx src/scripts/close-unruled-cost-centres.ts --codes=A,B,C [--apply]
 */
import mysql from "mysql2/promise";
import { env } from "../config/env.js";

const BACKUP_TABLE = "master_activity_status_backup";
const APPLY = process.argv.includes("--apply");

function arg(name: string, fallback = ""): string {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=").slice(1).join("=") : fallback;
}

async function main() {
  const codes = arg("codes").split(",").map((s) => s.trim()).filter(Boolean);
  if (!codes.length) throw new Error("--codes=CODE1,CODE2 is required");

  const hrms = await mysql.createConnection({
    host: env.DB_HOST, port: env.DB_PORT, user: env.DB_USER,
    password: env.DB_PASSWORD, database: env.DB_NAME,
    connectTimeout: 30_000, dateStrings: true,
  });

  // Last invoice date per code, read-only from the upstream billing DB when available.
  const lastInvoice = new Map<string, string | null>();
  if (process.env.BILL_HOST) {
    const bill = await mysql.createConnection({
      host: process.env.BILL_HOST, user: process.env.BILL_USER,
      password: process.env.BILL_PASS, database: process.env.BILL_DB,
      connectTimeout: 30_000, dateStrings: true,
    });
    try {
      const [rows] = await bill.query<any[]>(
        `SELECT m.cost_center cc,
                (SELECT MAX(i.createdate) FROM inv_particulars i WHERE i.cost_center_id = m.id) li
           FROM cost_master m WHERE m.cost_center IN (?)`, [codes]);
      for (const r of rows) {
        const d = r.li ? new Date(r.li) : null;
        lastInvoice.set(String(r.cc).trim(),
          d && !Number.isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : null);
      }
    } finally { await bill.end(); }
  }

  try {
    const [rows] = await hrms.query<any[]>(
      `SELECT id, cost_centre_code, active_status, close_date
         FROM cost_centre_master WHERE cost_centre_code IN (?)`, [codes]);

    const found = new Set(rows.map((r) => String(r.cost_centre_code).trim()));
    codes.filter((c) => !found.has(c)).forEach((c) => console.log(`  NOT FOUND: ${c}`));

    const changes: { id: string; code: string; field: string; oldValue: string | null; newValue: string | null }[] = [];
    for (const r of rows) {
      const code = String(r.cost_centre_code).trim();
      const closeDate = lastInvoice.get(code) ?? null;
      if (Number(r.active_status) !== 0) {
        changes.push({ id: String(r.id), code, field: "active_status",
          oldValue: String(r.active_status), newValue: "0" });
      }
      const currentClose = r.close_date ? String(r.close_date).slice(0, 10) : null;
      if (closeDate && currentClose !== closeDate) {
        changes.push({ id: String(r.id), code, field: "close_date",
          oldValue: currentClose, newValue: closeDate });
      }
    }

    console.log(APPLY ? "MODE: APPLY" : "MODE: DRY RUN (pass --apply to write)");
    console.log(`\ncost centres targeted: ${rows.length}`);
    for (const r of rows) {
      const code = String(r.cost_centre_code).trim();
      const cd = lastInvoice.get(code) ?? null;
      console.log(`   ${code.padEnd(24)} -> inactive, close_date=${cd ?? "(none — no evidence to date it)"}`);
    }
    console.log(`\nchanges to write: ${changes.length}`);
    if (!changes.length || !APPLY) {
      if (!APPLY) console.log("Dry run complete.");
      return;
    }

    await hrms.query(
      `CREATE TABLE IF NOT EXISTS ${BACKUP_TABLE} (
         id INT AUTO_INCREMENT PRIMARY KEY, batch VARCHAR(40) NOT NULL,
         table_name VARCHAR(64) NOT NULL, record_id CHAR(36) NOT NULL,
         field_name VARCHAR(64) NOT NULL, old_value VARCHAR(64) NULL, new_value VARCHAR(64) NULL,
         created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, INDEX idx_batch (batch)
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    const batch = `ruling-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    await hrms.beginTransaction();
    try {
      for (const c of changes) {
        await hrms.query(
          `INSERT INTO ${BACKUP_TABLE} (batch, table_name, record_id, field_name, old_value, new_value)
           VALUES (?,?,?,?,?,?)`,
          [batch, "cost_centre_master", c.id, c.field, c.oldValue, c.newValue]);
        await hrms.query(
          `UPDATE cost_centre_master SET ${c.field} = ? WHERE id = ?`, [c.newValue, c.id]);
      }
      await hrms.commit();
      console.log(`\nApplied ${changes.length} change(s). Batch: ${batch}`);
      console.log(`Rollback: UPDATE cost_centre_master t JOIN ${BACKUP_TABLE} b`);
      console.log(`            ON b.record_id = t.id AND b.table_name = 'cost_centre_master'`);
      console.log(`          SET t.active_status = b.old_value WHERE b.batch = '${batch}';`);
    } catch (e) {
      await hrms.rollback();
      throw e;
    }
  } finally {
    await hrms.end();
  }
}

main().catch((e) => {
  console.error("failed:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
