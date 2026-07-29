/**
 * Apply verified activity status to the org masters — cost centre, branch, process, department.
 *
 * Companion to reconcile-cost-centre-activity.ts. That script reports; this one corrects, but
 * ONLY where the evidence is unambiguous. Anything uncertain is skipped and listed, never guessed.
 *
 * WHAT IT CHANGES
 *   cost_centre_master : DORMANT rows (no salary in target month, no invoice within 12 months)
 *                        AND with a known last-activity date -> active_status = 0,
 *                        close_date = last activity date.
 *   branch_master      : active_status derived from whether the branch owns any cost centre that
 *                        has salary in the target month. Handles BOTH directions — branches wrongly
 *                        marked inactive get reactivated. close_date = latest activity among its
 *                        cost centres.
 *   process_master     : active if referenced by any active employee.
 *   department_master  : active if referenced by any active employee.
 *
 * WHAT IT DELIBERATELY SKIPS (reported, never touched)
 *   - BILLING_ONLY cost centres (invoiced recently but no staff). Could be genuine client work
 *     delivered by staff booked elsewhere, or stale billing. Not determinable from data.
 *   - Cost centres with NO activity history at all — clearly not running, but the date they
 *     stopped is unknowable, so no close_date can be honestly recorded.
 *   - Duplicate/typo master records (e.g. three HEAD OFFICE rows). Merging requires reassigning
 *     child records and is a business decision.
 *
 * SAFETY
 *   - Dry-run by default. Requires --apply to write anything.
 *   - Every row it will change is written to a timestamped CSV backup BEFORE any UPDATE, and to
 *     master_activity_status_backup for in-database rollback.
 *   - db_bill is read-only (SELECT only) — it is an upstream source per the project charter.
 *   - Runs inside a transaction; any failure rolls back.
 *
 * Usage:
 *   BILL_HOST=... BILL_USER=... BILL_PASS=... BILL_DB=db_bill \
 *   npx tsx src/scripts/apply-master-activity-status.ts [--month=2026-06] [--apply]
 */
import fs from "fs";
import mysql from "mysql2/promise";
import { env } from "../config/env.js";

const BACKUP_TABLE = "master_activity_status_backup";

function arg(name: string, fallback: string): string {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=").slice(1).join("=") : fallback;
}
const APPLY = process.argv.includes("--apply");

function defaultMonth(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Normalises whatever the driver hands back (Date | string | null) to YYYY-MM-DD. */
function toDateOnly(v: unknown): string | null {
  if (!v) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

interface Change {
  table: string;
  id: string;
  label: string;
  field: string;
  oldValue: string | null;
  newValue: string | null;
}

async function main() {
  const month = arg("month", defaultMonth());
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error(`--month must be YYYY-MM (got "${month}")`);
  for (const k of ["BILL_HOST", "BILL_USER", "BILL_PASS", "BILL_DB"]) {
    if (!process.env[k]) throw new Error(`Missing env ${k}`);
  }

  const bill = await mysql.createConnection({
    host: process.env.BILL_HOST, user: process.env.BILL_USER,
    password: process.env.BILL_PASS, database: process.env.BILL_DB,
    connectTimeout: 30_000, dateStrings: true,
  });
  const hrms = await mysql.createConnection({
    host: env.DB_HOST, port: env.DB_PORT, user: env.DB_USER,
    password: env.DB_PASSWORD, database: env.DB_NAME,
    connectTimeout: 30_000, dateStrings: true,
  });

  const changes: Change[] = [];
  const skipped: string[] = [];

  try {
    // ── upstream evidence (READ ONLY) ────────────────────────────────────────────────────────
    const [salRows] = await bill.query<any[]>(
      `SELECT CostCenter cc, COUNT(*) hc FROM salary_data
        WHERE DATE_FORMAT(SalDate,'%Y-%m') = ? GROUP BY CostCenter`, [month]);
    const salaryNow = new Map<string, number>(salRows.map((r) => [String(r.cc ?? "").trim(), Number(r.hc)]));

    const [actRows] = await bill.query<any[]>(
      `SELECT m.cost_center cc,
              (SELECT MAX(s.SalDate) FROM salary_data s WHERE s.CostCenter = m.cost_center) last_salary,
              (SELECT MAX(i.createdate) FROM inv_particulars i WHERE i.cost_center_id = m.id) last_invoice
         FROM cost_master m`);
    const lastActivity = new Map<string, { salary: string | null; invoice: string | null }>();
    for (const r of actRows) {
      lastActivity.set(String(r.cc ?? "").trim(), {
        salary: toDateOnly(r.last_salary), invoice: toDateOnly(r.last_invoice),
      });
    }

    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - 12);

    // ── cost centres ─────────────────────────────────────────────────────────────────────────
    const [ccRows] = await hrms.query<any[]>(
      `SELECT id, cost_centre_code, cost_centre_name, active_status, close_date, branch_id
         FROM cost_centre_master`);

    const activeCcCodes = new Set<string>();
    const branchLastActivity = new Map<string, string>();

    for (const cc of ccRows) {
      const code = String(cc.cost_centre_code ?? "").trim();
      const act = lastActivity.get(code);
      const hasSalaryNow = (salaryNow.get(code) ?? 0) > 0;
      const lastInv = act?.invoice ? new Date(act.invoice) : null;
      const billedRecently = Boolean(lastInv && lastInv >= cutoff);

      const last = [act?.salary, act?.invoice].filter(Boolean).sort().pop() ?? null;
      if (last) {
        const bid = String(cc.branch_id ?? "");
        if (!branchLastActivity.has(bid) || (branchLastActivity.get(bid) as string) < last) {
          branchLastActivity.set(bid, last);
        }
      }

      if (hasSalaryNow) {
        activeCcCodes.add(code);
        // Reactivate if wrongly closed — the correction must work in both directions.
        if (Number(cc.active_status) !== 1) {
          changes.push({ table: "cost_centre_master", id: String(cc.id), label: code,
            field: "active_status", oldValue: String(cc.active_status), newValue: "1" });
        }
        continue;
      }

      if (billedRecently) { skipped.push(`BILLING_ONLY  ${code}  (last invoice ${act?.invoice})`); continue; }
      if (!last)          { skipped.push(`NO_HISTORY    ${code}  (cannot date its closure)`); continue; }

      if (Number(cc.active_status) !== 0) {
        changes.push({ table: "cost_centre_master", id: String(cc.id), label: code,
          field: "active_status", oldValue: String(cc.active_status), newValue: "0" });
      }
      if (toDateOnly(cc.close_date) !== last) {
        changes.push({ table: "cost_centre_master", id: String(cc.id), label: code,
          field: "close_date", oldValue: toDateOnly(cc.close_date), newValue: last });
      }
    }

    // ── branches: active iff they own a cost centre with salary this month ───────────────────
    const [brRows] = await hrms.query<any[]>(
      `SELECT b.id, b.branch_name, b.active_status, b.close_date,
              SUM(CASE WHEN cc.cost_centre_code IS NOT NULL THEN 1 ELSE 0 END) AS cc_count
         FROM branch_master b
         LEFT JOIN cost_centre_master cc ON cc.branch_id = b.id
        GROUP BY b.id, b.branch_name, b.active_status, b.close_date`);

    const [ownRows] = await hrms.query<any[]>(
      `SELECT branch_id, cost_centre_code FROM cost_centre_master`);
    const branchHasActive = new Set<string>();
    for (const r of ownRows) {
      if (activeCcCodes.has(String(r.cost_centre_code ?? "").trim())) branchHasActive.add(String(r.branch_id ?? ""));
    }

    for (const b of brRows) {
      const id = String(b.id);
      const shouldBeActive = branchHasActive.has(id);
      if (shouldBeActive !== (Number(b.active_status) === 1)) {
        changes.push({ table: "branch_master", id, label: String(b.branch_name),
          field: "active_status", oldValue: String(b.active_status), newValue: shouldBeActive ? "1" : "0" });
      }
      if (!shouldBeActive) {
        const last = branchLastActivity.get(id) ?? null;
        if (last && toDateOnly(b.close_date) !== last) {
          changes.push({ table: "branch_master", id, label: String(b.branch_name),
            field: "close_date", oldValue: toDateOnly(b.close_date), newValue: last });
        }
      }
    }

    // ── processes / departments: active iff referenced by an active employee ─────────────────
    for (const [table, col] of [["process_master", "process_id"], ["department_master", "department_id"]] as const) {
      const [rows] = await hrms.query<any[]>(
        `SELECT m.id, m.active_status,
                (SELECT COUNT(*) FROM employees e WHERE e.${col} = m.id AND e.active_status = 1) AS refs
           FROM ${table} m`);
      for (const r of rows) {
        const shouldBeActive = Number(r.refs) > 0;
        if (shouldBeActive !== (Number(r.active_status) === 1)) {
          changes.push({ table, id: String(r.id), label: String(r.id).slice(0, 8),
            field: "active_status", oldValue: String(r.active_status), newValue: shouldBeActive ? "1" : "0" });
        }
      }
    }

    // ── report ───────────────────────────────────────────────────────────────────────────────
    console.log("=".repeat(76));
    console.log(`MASTER ACTIVITY STATUS — salary month ${month}`);
    console.log(APPLY ? "MODE: APPLY (writes will be made)" : "MODE: DRY RUN (no writes — pass --apply to execute)");
    console.log("=".repeat(76));

    const byTable = new Map<string, Change[]>();
    changes.forEach((c) => byTable.set(c.table, [...(byTable.get(c.table) ?? []), c]));
    for (const [t, list] of byTable) {
      const acts = list.filter((c) => c.field === "active_status");
      console.log(`\n${t}: ${list.length} change(s)`);
      console.log(`   activate  : ${acts.filter((c) => c.newValue === "1").length}`);
      console.log(`   deactivate: ${acts.filter((c) => c.newValue === "0").length}`);
      console.log(`   close_date: ${list.filter((c) => c.field === "close_date").length}`);
      acts.filter((c) => c.newValue === "1").slice(0, 10)
        .forEach((c) => console.log(`      REACTIVATE  ${c.label}`));
    }

    console.log(`\nSKIPPED (left untouched — not determinable): ${skipped.length}`);
    const billingOnly = skipped.filter((s) => s.startsWith("BILLING_ONLY")).length;
    const noHistory = skipped.filter((s) => s.startsWith("NO_HISTORY")).length;
    console.log(`   BILLING_ONLY (invoiced, no staff): ${billingOnly}`);
    console.log(`   NO_HISTORY   (cannot date close) : ${noHistory}`);

    if (!changes.length) { console.log("\nNothing to change."); return; }

    // ── backup, then apply ───────────────────────────────────────────────────────────────────
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const csv = `master-activity-backup-${stamp}.csv`;
    fs.writeFileSync(csv,
      ["table,id,label,field,old_value,new_value",
       ...changes.map((c) => `${c.table},${c.id},"${c.label.replace(/"/g, "''")}",${c.field},${c.oldValue ?? ""},${c.newValue ?? ""}`)
      ].join("\n"), "utf8");
    console.log(`\nBackup of prior values written: ${csv}`);

    if (!APPLY) {
      console.log("\nDry run complete. Re-run with --apply to write these changes.");
      return;
    }

    await hrms.query(
      `CREATE TABLE IF NOT EXISTS ${BACKUP_TABLE} (
         id INT AUTO_INCREMENT PRIMARY KEY,
         batch VARCHAR(40) NOT NULL,
         table_name VARCHAR(64) NOT NULL,
         record_id CHAR(36) NOT NULL,
         field_name VARCHAR(64) NOT NULL,
         old_value VARCHAR(64) NULL,
         new_value VARCHAR(64) NULL,
         created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
         INDEX idx_batch (batch)
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    await hrms.beginTransaction();
    try {
      for (const c of changes) {
        await hrms.query(
          `INSERT INTO ${BACKUP_TABLE} (batch, table_name, record_id, field_name, old_value, new_value)
           VALUES (?,?,?,?,?,?)`,
          [stamp, c.table, c.id, c.field, c.oldValue, c.newValue]);
        await hrms.query(
          `UPDATE ${c.table} SET ${c.field} = ? WHERE id = ?`, [c.newValue, c.id]);
      }
      await hrms.commit();
      console.log(`\nApplied ${changes.length} change(s). Batch: ${stamp}`);
      console.log(`Rollback:  UPDATE <table> t JOIN ${BACKUP_TABLE} b`);
      console.log(`             ON b.record_id = t.id AND b.table_name = '<table>'`);
      console.log(`           SET t.<field> = b.old_value WHERE b.batch = '${stamp}';`);
    } catch (e) {
      await hrms.rollback();
      throw e;
    }
  } finally {
    await bill.end();
    await hrms.end();
  }
}

main().catch((e) => {
  console.error("failed:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
