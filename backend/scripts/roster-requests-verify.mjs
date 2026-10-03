/**
 * Roster Requests hub — read-only production verification.
 *
 *   node scripts/roster-requests-verify.mjs
 *
 * READ-ONLY. Every statement is a SELECT, and the session is put into READ ONLY transaction mode
 * first, so even a mistaken write would be refused by the server. There is no apply mode: any
 * "--apply" / "apply" argument makes the script exit with an error before it connects.
 *
 * What it answers (after a deploy of the hub, migration 1995):
 *   1. Do roster_request_decision_log / roster_request_auto_rule / roster_request_escalation exist?
 *   2. Do their columns match migration 1995?
 *   3. Is migration 1995 recorded as applied in schema_migrations (runPendingMigrations.ts)?
 *   4. Row counts of the three tables, and of work_inbox_item for the four hub notification types.
 *   5. Collation of the three tables vs employees / process_master, and of the id columns the hub
 *      JOINs them to. A unicode_ci vs 0900_ai_ci pair raises ER_CANT_AGGREGATE_2COLLATIONS (1267)
 *      on the JOIN, e.g. the escalation sweep's x.source_id = s.id.
 *   6. Whether wfm_roster_swap_request.counterpart_status exists (migration 1212; the hub falls back
 *      without it, so this is informational).
 *   7. Whether roster_daily_assignment carries fk_rda_dispute_resolver (migration 223:
 *      dispute_resolved_by -> employees.id). resolveDispute writes the deciding USER id there, so
 *      with that FK in place a dispute decision fails unless the user id is also an employees.id.
 *      Informational (WARN), not part of PASS/FAIL.
 *   8. Migration 2074 (the hub's real "raised at"): does roster_daily_assignment.disputed_at exist
 *      (FAIL when not), and how many open disputed rows still have it NULL / rejected week-offs have
 *      employee_ack_at NULL (WARN when any: the backfill missed them, or a writer is not stamping).
 *
 * Exit code 1 when any FAIL check fails. Loads env exactly like the other ops scripts
 * (`dotenv/config`, honouring DOTENV_CONFIG_PATH set by .github/workflows/ops-scripts.yml).
 */
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

export const MIGRATION_FILE = "migrations/1995_roster_request_decision_log_auto_rule.sql";

/** Columns migration 1995 declares, per table (asserted against the migration file by a test). */
export const EXPECTED_COLUMNS = {
  roster_request_decision_log: ["id", "kind", "source_id", "action", "actor_user_id", "auto", "reason", "before_json", "after_json", "created_at"],
  roster_request_auto_rule: ["id", "process_id", "kind", "enabled", "max_coverage_drop", "require_counterpart_accept", "updated_by", "updated_at"],
  roster_request_escalation: ["id", "kind", "source_id", "escalated_at"],
};
export const HUB_TABLES = Object.keys(EXPECTED_COLUMNS);
export const INBOX_TYPES = ["ROSTER_REQUEST_DECIDED", "ROSTER_REQUEST_PENDING", "ROSTER_REQUEST_AUTO_APPROVED", "ROSTER_REQUEST_ESCALATED"];
/** Tables whose `id` the hub compares with source_id / process_id of the new tables. */
export const JOINED_ID_TABLES = ["employees", "process_master", "wfm_roster_swap_request", "wfm_roster_assignment", "roster_daily_assignment", "wfm_roster_conflict_log"];

export const RAISED_AT_MIGRATION_FILE = "migrations/2074_roster_request_raised_at.sql";

/** Read-only queries behind check 8. The two counts use only rows the hub would age. */
export const RAISED_AT_SQL = {
  disputedAtColumn:
    "SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'roster_daily_assignment' AND COLUMN_NAME = 'disputed_at'",
  employeeAckAtColumn:
    "SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'wfm_roster_assignment' AND COLUMN_NAME = 'employee_ack_at'",
  disputedWithoutRaisedAt:
    "SELECT COUNT(*) AS n FROM roster_daily_assignment WHERE acknowledgement_status = 'disputed' AND disputed_at IS NULL",
  rejectedWithoutRaisedAt:
    "SELECT COUNT(*) AS n FROM wfm_roster_assignment WHERE employee_ack_status = 'rejected' AND employee_ack_at IS NULL",
};

/** Refuses any write mode. Returns an error message, or null when the arguments are fine. */
export function refuseWriteMode(argv) {
  const bad = argv.find((a) => /^(--)?apply$/i.test(String(a)) || /^--mode=apply$/i.test(String(a)));
  return bad ? `roster-requests-verify is read-only and has no apply mode (got '${bad}').` : null;
}

/**
 * Pure evaluation of the collected facts -> checks. Each check: { name, status: PASS|FAIL|INFO|WARN, detail }.
 * facts: {
 *   columns: { [table]: string[] | null },            // null = table missing
 *   migrationRow: { filename, success } | null,
 *   counts: { [table]: number | null }, inboxCounts: { [type]: number } | null,
 *   tableCollation: { [table]: string | null }, idCollation: { [table]: string | null },
 *   counterpartStatus: boolean, disputeResolverFk: boolean,
 *   raisedAt: { disputedAtColumn: boolean, employeeAckAtColumn: boolean,
 *               disputedWithoutRaisedAt: number | null, rejectedWithoutRaisedAt: number | null },
 * }
 */
export function evaluate(facts) {
  const checks = [];
  const add = (name, status, detail) => checks.push({ name, status, detail });

  for (const t of HUB_TABLES) {
    const cols = facts.columns[t];
    if (!cols) {
      add(`table ${t} exists`, "FAIL", "missing");
      continue;
    }
    add(`table ${t} exists`, "PASS", `${cols.length} columns`);
    const missing = EXPECTED_COLUMNS[t].filter((c) => !cols.includes(c));
    const extra = cols.filter((c) => !EXPECTED_COLUMNS[t].includes(c));
    add(`columns of ${t} match migration 1995`, missing.length ? "FAIL" : "PASS",
      missing.length ? `missing: ${missing.join(", ")}${extra.length ? `; extra: ${extra.join(", ")}` : ""}` : extra.length ? `extra: ${extra.join(", ")}` : "exact match");
  }

  const m = facts.migrationRow;
  if (!m) add("migration 1995 recorded in schema_migrations", "FAIL", `no row for ${MIGRATION_FILE}`);
  else if (m.success !== undefined && m.success !== null && Number(m.success) !== 1) add("migration 1995 recorded in schema_migrations", "FAIL", `row ${m.filename} has success=${m.success}`);
  else add("migration 1995 recorded in schema_migrations", "PASS", `${m.filename}${m.applied_at ? ` applied_at=${m.applied_at}` : ""}`);

  for (const t of HUB_TABLES) {
    if (facts.counts[t] !== null && facts.counts[t] !== undefined) add(`rows in ${t}`, "INFO", String(facts.counts[t]));
  }
  if (facts.inboxCounts) {
    add("work_inbox_item hub notifications", "INFO", INBOX_TYPES.map((k) => `${k}=${facts.inboxCounts[k] ?? 0}`).join(" "));
  }

  const ref = facts.idCollation.employees ?? null;
  for (const t of HUB_TABLES) {
    const c = facts.tableCollation[t];
    if (!c) continue;
    const mismatched = JOINED_ID_TABLES.filter((j) => facts.idCollation[j] && facts.idCollation[j] !== c);
    add(`collation of ${t}`, mismatched.length ? "FAIL" : "PASS",
      `${c}${mismatched.length ? `; differs from ${mismatched.map((j) => `${j}.id=${facts.idCollation[j]}`).join(", ")}` : ` (employees.id=${ref ?? "?"}, process_master.id=${facts.idCollation.process_master ?? "?"})`}`);
  }
  add("JOINed id collations", "INFO", JOINED_ID_TABLES.map((j) => `${j}.id=${facts.idCollation[j] ?? "missing"}`).join(" "));

  add("wfm_roster_swap_request.counterpart_status exists", "INFO", facts.counterpartStatus ? "yes" : "no (hub falls back: counterpart acceptance untracked)");
  if (facts.disputeResolverFk) {
    add("fk_rda_dispute_resolver (dispute_resolved_by -> employees.id)", "WARN",
      "present: resolveDispute stores the deciding user id there, so a dispute decision fails with ER_NO_REFERENCED_ROW_2 unless that user id is also an employees.id");
  } else {
    add("fk_rda_dispute_resolver (dispute_resolved_by -> employees.id)", "INFO", "absent");
  }

  const ra = facts.raisedAt;
  if (ra) {
    add("roster_daily_assignment.disputed_at exists (migration 2074)", ra.disputedAtColumn ? "PASS" : "FAIL",
      ra.disputedAtColumn ? "yes" : `missing: ${RAISED_AT_MIGRATION_FILE} has not run; dispute SLA age falls back to updated_at`);
    if (!ra.employeeAckAtColumn) add("wfm_roster_assignment.employee_ack_at exists (migration 228)", "FAIL", "missing");
    const nulls = (name, n, why) => {
      if (n === null || n === undefined) return;
      add(name, n > 0 ? "WARN" : "PASS", n > 0 ? `${n} (${why})` : "0");
    };
    nulls("disputed rows without disputed_at", ra.disputedWithoutRaisedAt, "backfill missed them or the dispute handler is not stamping it; SLA age falls back to updated_at");
    nulls("rejected week-offs without employee_ack_at", ra.rejectedWithoutRaisedAt, "backfill missed them or the reject handler is not stamping it; SLA age falls back to updated_at");
  }

  const failed = checks.filter((c) => c.status === "FAIL");
  return { checks, ok: failed.length === 0 };
}

async function collect(conn) {
  const q = async (sql, params = []) => (await conn.query(sql, params))[0];
  const columns = {};
  for (const t of HUB_TABLES) {
    const rows = await q(
      "SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION", [t]);
    columns[t] = rows.length ? rows.map((r) => String(r.c)) : null;
  }

  let migrationRow = null;
  const smCols = (await q(
    "SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'schema_migrations'")).map((r) => String(r.c));
  if (smCols.length) {
    const select = ["filename", smCols.includes("applied_at") ? "applied_at" : null, smCols.includes("success") ? "success" : null].filter(Boolean).join(", ");
    const rows = await q(
      `SELECT ${select} FROM schema_migrations WHERE filename = ? OR filename LIKE ? ORDER BY filename = ? DESC LIMIT 1`,
      [MIGRATION_FILE, "%1995_roster_request_decision_log_auto_rule.sql", MIGRATION_FILE]);
    migrationRow = rows[0] ?? null;
  }

  const counts = {};
  for (const t of HUB_TABLES) counts[t] = columns[t] ? Number((await q(`SELECT COUNT(*) AS n FROM \`${t}\``))[0].n) : null;

  let inboxCounts = null;
  const hasInbox = (await q("SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'work_inbox_item'"))[0].n > 0;
  if (hasInbox) {
    inboxCounts = {};
    const rows = await q(`SELECT type, COUNT(*) AS n FROM work_inbox_item WHERE type IN (${INBOX_TYPES.map(() => "?").join(", ")}) GROUP BY type`, INBOX_TYPES);
    for (const r of rows) inboxCounts[r.type] = Number(r.n);
  }

  const tableCollation = {};
  for (const r of await q(
    `SELECT TABLE_NAME AS t, TABLE_COLLATION AS c FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${HUB_TABLES.map(() => "?").join(", ")})`, HUB_TABLES)) {
    tableCollation[r.t] = r.c;
  }
  const idCollation = {};
  for (const r of await q(
    `SELECT TABLE_NAME AS t, COLLATION_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND COLUMN_NAME = 'id' AND TABLE_NAME IN (${JOINED_ID_TABLES.map(() => "?").join(", ")})`, JOINED_ID_TABLES)) {
    idCollation[r.t] = r.c;
  }

  const counterpartStatus = (await q(
    "SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'wfm_roster_swap_request' AND COLUMN_NAME = 'counterpart_status'"))[0].n > 0;
  const disputeResolverFk = (await q(
    "SELECT COUNT(*) AS n FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'roster_daily_assignment' AND CONSTRAINT_NAME = 'fk_rda_dispute_resolver'"))[0].n > 0;

  const one = async (sql) => Number((await q(sql))[0].n);
  const disputedAtColumn = (await one(RAISED_AT_SQL.disputedAtColumn)) > 0;
  const employeeAckAtColumn = (await one(RAISED_AT_SQL.employeeAckAtColumn)) > 0;
  const raisedAt = {
    disputedAtColumn,
    employeeAckAtColumn,
    disputedWithoutRaisedAt: disputedAtColumn ? await one(RAISED_AT_SQL.disputedWithoutRaisedAt) : null,
    rejectedWithoutRaisedAt: employeeAckAtColumn ? await one(RAISED_AT_SQL.rejectedWithoutRaisedAt) : null,
  };

  return { columns, migrationRow, counts, inboxCounts, tableCollation, idCollation, counterpartStatus, disputeResolverFk, raisedAt };
}

async function main() {
  const refusal = refuseWriteMode(process.argv.slice(2));
  if (refusal) {
    console.error(`::error::${refusal}`);
    process.exit(1);
  }
  await import("dotenv/config");
  const require = createRequire(import.meta.url);
  const mysql = require("mysql2/promise");
  const strip = (v) => String(v ?? "").trim().replace(/^["']|["']$/g, "");
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST_OVERRIDE || strip(process.env.DB_HOST),
    port: Number(strip(process.env.DB_PORT) || 3306),
    user: strip(process.env.DB_USER),
    password: strip(process.env.DB_PASSWORD),
    database: strip(process.env.DB_NAME),
    connectTimeout: 20000,
    dateStrings: true,
  });
  try {
    await conn.query("SET SESSION TRANSACTION READ ONLY");
    const [[who]] = await conn.query("SELECT DATABASE() AS db, VERSION() AS version");
    console.log(`roster-requests-verify (read-only)  database=${who.db}  mysql=${who.version}`);
    const { checks, ok } = evaluate(await collect(conn));
    for (const c of checks) console.log(`${c.status.padEnd(4)}  ${c.name}: ${c.detail}`);
    const failed = checks.filter((c) => c.status === "FAIL").length;
    console.log(`\nSUMMARY: ${ok ? "PASS" : "FAIL"} (${checks.filter((c) => c.status === "PASS").length} pass, ${failed} fail, ${checks.filter((c) => c.status === "WARN").length} warn)`);
    if (!ok) process.exitCode = 1;
  } finally {
    await conn.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`::error::roster-requests-verify failed: ${err?.code ?? ""} ${err?.message ?? err}`);
    process.exit(1);
  });
}
