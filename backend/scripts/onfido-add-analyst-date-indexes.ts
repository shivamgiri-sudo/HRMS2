/**
 * One-off, idempotent, ONLINE speed-up for the Onfido dashboard's per-analyst views (2026-09-25).
 *
 * Measured against the real onfido_db: the week-by-week analyst view spent ~6 s in onfido_doc_raw because
 * the only date index (idx_report_date) cannot narrow by analyst, so every analyst lookup reads the whole
 * date range. An (analyst_email, date) index answers it directly. Each ALTER uses ALGORITHM = INPLACE,
 * LOCK = NONE, which FAILS rather than blocks a live upload. Existing code ignores the new indexes, so
 * nothing else changes. Run off-peak: npx tsx scripts/onfido-add-analyst-date-indexes.ts
 * Add --dry-run to print what it would do without changing anything.
 */
import { getOnfidoPool } from "../src/db/onfidoDb.js";

interface IndexPlan {
  table: string;
  index: string;
  columns: string;
}

const PLAN: readonly IndexPlan[] = [
  {
    table: "onfido_doc_raw",
    index: "idx_onfido_doc_raw_analyst_date",
    columns: "analyst_email, report_date",
  },
  {
    table: "onfido_poa_raw",
    index: "idx_onfido_poa_raw_analyst_date",
    columns: "analyst_email, report_completed_date",
  },
  {
    table: "onfido_doc_external_audit_raw",
    index: "idx_onfido_audit_analyst_date",
    columns: "analyst_email, report_date",
  },
  {
    table: "onfido_poa_quality_raw",
    index: "idx_onfido_poa_quality_analyst_date",
    columns: "analyst_email, report_completed_date",
  },
  {
    table: "onfido_doc_quality_raw",
    index: "idx_onfido_doc_quality_analyst_date",
    columns: "analyst_email, task_complete_date",
  },
];

const dryRun = process.argv.includes("--dry-run");
const pool = await getOnfidoPool();
const conn = await pool.getConnection();
try {
  await conn.query("SET SESSION lock_wait_timeout = 30");
  for (const item of PLAN) {
    const [existing] = await conn.query(
      "SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ?",
      [item.table, item.index],
    );
    if ((existing as unknown[]).length > 0) {
      console.log(`${item.table}: ${item.index} already present`);
      continue;
    }
    if (dryRun) {
      console.log(`${item.table}: would add ${item.index} (${item.columns})`);
      continue;
    }
    const started = Date.now();
    await conn.query(
      `ALTER TABLE ${item.table} ADD INDEX ${item.index} (${item.columns}), ALGORITHM = INPLACE, LOCK = NONE`,
    );
    console.log(
      `${item.table}: ${item.index} built in ${((Date.now() - started) / 1000).toFixed(1)} s`,
    );
  }
} finally {
  conn.release();
  await pool.end();
}
