/**
 * SBI Card Collections (migration 2075) - read-only production verification.
 *
 *   node scripts/sbi-card-verify.mjs
 *
 * READ-ONLY. Every statement is a SELECT and the session is put into READ ONLY transaction mode first, so a mistaken write would be
 * refused by the server. There is no apply mode: any "apply" argument exits with an error before connecting.
 *
 * Answers, after a deploy of the SBI Card collections-ops work:
 *   1. Does sbi_card_agent_time (the dialer Agent Time / APR import) exist with every column?
 *   2. Did sbi_card_account_file gain the collections-ops columns, including `flow`?
 *   3. Was the unique key swapped (uq_sbi_card_account_file_flow present, the old one gone), and did existing rows keep flow = NEW?
 *   4. Is migration 2075 recorded as applied in schema_migrations?
 *   5. Are the SBI_CARD_APR and SBI_CARD_ACCOUNT_FILE upload templates registered (and the account template listing Flow)?
 *   6. (migration 2076) Does sbi_card_outcome exist with every column, is 2076 recorded, and is the SBI_CARD_OUTCOME template registered?
 *   7. Does the SBI_CARD process still resolve, and what do the SBI tables hold (counts only, no values)?
 *
 * Exit code 1 when any FAIL check fails. Loads env like the other ops scripts (dotenv/config, honouring DOTENV_CONFIG_PATH).
 */
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

export const MIGRATION_FILE = "migrations/2075_sbi_collections_ops_and_apr.sql";
export const AGENT_TIME_COLUMNS = [
  "id", "process_id", "report_date", "employee_id", "agent_name", "calls", "time_clock_sec", "login_sec", "wait_sec", "talk_sec", "dispo_sec",
  "pause_sec", "dead_sec", "customer_sec", "first_login_time", "last_logout_time", "acht_sec", "dismx_sec", "lagged_sec", "pause_lb_sec",
  "pause_login_sec", "pause_mb_sec", "pause_qb_sec", "pause_tb_sec", "pause_wb_sec", "data_source", "source_reference", "created_by", "created_at", "updated_at",
];
export const OUTCOME_COLUMNS = [
  "id", "process_id", "report_date", "segment", "opening_accounts", "opening_amount", "resolved_accounts", "normalised_accounts", "rollback_accounts",
  "resolved_amount", "normalised_amount", "rollback_amount", "resolution_pct", "normalisation_pct", "rollback_pct", "data_source", "source_reference", "created_by", "created_at", "updated_at",
];
export const ROSTER_COLUMNS = ["id", "process_id", "dialer_id", "employee_id", "agent_name", "gh", "team", "team_leader", "mode", "data_source", "source_reference", "created_by", "created_at", "updated_at"];
export const ACCOUNT_FILE_NEW_COLUMNS = [
  "flow", "cd", "nrr", "block_1", "block_2", "ntc_flag", "new_to_card_flag", "promo_code", "product_class", "account_class", "donotcall", "callback_dt",
  ...[1, 2, 3, 4, 5, 6].flatMap((n) => [`call${n}_dt`, `disp${n}_c`, `agent${n}_id`]),
];

export function refuseWriteMode(argv) {
  const bad = argv.find((a) => /^(--)?apply$/i.test(String(a)) || /^--mode=apply$/i.test(String(a)));
  return bad ? `sbi-card-verify is read-only and has no apply mode (got '${bad}').` : null;
}

/**
 * Pure evaluation of the collected facts. facts: {
 *   agentTimeColumns: string[] | null, accountColumns: string[] | null, uniqueKeys: string[],
 *   migrationRow: { filename, success } | null, templates: { [code]: { active, optional: string[] } | null },
 *   process: { id } | null, counts: { account: number|null, agentTime: number|null }, flows: { [flow]: number } | null }
 */
export function evaluate(facts) {
  const checks = []; const add = (name, status, detail) => checks.push({ name, status, detail });

  if (!facts.agentTimeColumns) add("table sbi_card_agent_time exists", "FAIL", "missing: migration 2075 has not run");
  else {
    const missing = AGENT_TIME_COLUMNS.filter((c) => !facts.agentTimeColumns.includes(c));
    add("table sbi_card_agent_time exists with all columns", missing.length ? "FAIL" : "PASS", missing.length ? `missing: ${missing.join(", ")}` : `${facts.agentTimeColumns.length} columns`);
  }

  if (!facts.accountColumns) add("table sbi_card_account_file exists", "FAIL", "missing");
  else {
    const missing = ACCOUNT_FILE_NEW_COLUMNS.filter((c) => !facts.accountColumns.includes(c));
    add("sbi_card_account_file has the collections-ops columns", missing.length ? "FAIL" : "PASS", missing.length ? `missing: ${missing.join(", ")}` : `${ACCOUNT_FILE_NEW_COLUMNS.length} new columns present`);
  }

  const hasNew = facts.uniqueKeys.includes("uq_sbi_card_account_file_flow"); const hasOld = facts.uniqueKeys.includes("uq_sbi_card_account_file");
  add("unique key includes flow (uq_sbi_card_account_file_flow)", hasNew ? "PASS" : "FAIL", hasNew ? "present" : "absent: an account in both day-end exports would overwrite itself");
  add("old unique key removed (uq_sbi_card_account_file)", hasOld ? "FAIL" : "PASS", hasOld ? "still present: a second flow for the same account and day would be rejected" : "gone");

  const m = facts.migrationRow;
  if (!m) add("migration 2075 recorded in schema_migrations", "FAIL", `no row for ${MIGRATION_FILE}`);
  else if (m.success !== undefined && m.success !== null && Number(m.success) !== 1) add("migration 2075 recorded in schema_migrations", "FAIL", `row ${m.filename} has success=${m.success}`);
  else add("migration 2075 recorded in schema_migrations", "PASS", `${m.filename}${m.applied_at ? ` applied_at=${m.applied_at}` : ""}`);

  if (facts.outcomeColumns !== undefined) {
    if (!facts.outcomeColumns) add("table sbi_card_outcome exists (migration 2076)", "FAIL", "missing: migration 2076 has not run");
    else {
      const missing = OUTCOME_COLUMNS.filter((c) => !facts.outcomeColumns.includes(c));
      add("table sbi_card_outcome exists with all columns (migration 2076)", missing.length ? "FAIL" : "PASS", missing.length ? `missing: ${missing.join(", ")}` : `${facts.outcomeColumns.length} columns`);
    }
    const m2 = facts.outcomeMigrationRow;
    add("migration 2076 recorded in schema_migrations", m2 && (m2.success === undefined || m2.success === null || Number(m2.success) === 1) ? "PASS" : "FAIL", m2 ? `${m2.filename}${m2.applied_at ? ` applied_at=${m2.applied_at}` : ""}` : "no row for migrations/2076_sbi_card_outcome.sql");
    const oc = facts.templates.SBI_CARD_OUTCOME;
    add("upload template SBI_CARD_OUTCOME registered", oc && Number(oc.active) === 1 ? "PASS" : "FAIL", oc ? `active=${oc.active}, ${oc.optional.length} optional columns` : "missing");
    if (facts.counts.outcome !== null && facts.counts.outcome !== undefined) add("rows in sbi_card_outcome", "INFO", `${facts.counts.outcome} (0 until the first Outcome file is uploaded)`);
  }

  if (facts.rosterColumns !== undefined) {
    if (!facts.rosterColumns) add("table sbi_card_roster exists (migration 2077)", "FAIL", "missing: migration 2077 has not run");
    else {
      const missing = ROSTER_COLUMNS.filter((c) => !facts.rosterColumns.includes(c));
      add("table sbi_card_roster exists with all columns (migration 2077)", missing.length ? "FAIL" : "PASS", missing.length ? `missing: ${missing.join(", ")}` : `${facts.rosterColumns.length} columns`);
    }
    const m3 = facts.rosterMigrationRow;
    add("migration 2077 recorded in schema_migrations", m3 && (m3.success === undefined || m3.success === null || Number(m3.success) === 1) ? "PASS" : "FAIL", m3 ? `${m3.filename}${m3.applied_at ? ` applied_at=${m3.applied_at}` : ""}` : "no row for migrations/2077_sbi_card_roster.sql");
    const rt = facts.templates.SBI_CARD_ROSTER;
    add("upload template SBI_CARD_ROSTER registered", rt && Number(rt.active) === 1 ? "PASS" : "FAIL", rt ? `active=${rt.active}, ${rt.optional.length} optional columns` : "missing");
    if (facts.counts.roster !== null && facts.counts.roster !== undefined) add("rows in sbi_card_roster", "INFO", `${facts.counts.roster} (0 until the roster is uploaded)`);
  }

  const apr = facts.templates.SBI_CARD_APR;
  add("upload template SBI_CARD_APR registered", apr && Number(apr.active) === 1 ? "PASS" : "FAIL", apr ? `active=${apr.active}, ${apr.optional.length} optional columns` : "missing");
  const acc = facts.templates.SBI_CARD_ACCOUNT_FILE;
  add("upload template SBI_CARD_ACCOUNT_FILE lists Flow", acc && acc.optional.includes("Flow") ? "PASS" : "FAIL", acc ? `${acc.optional.length} optional columns` : "missing");

  add("process SBI_CARD resolves", facts.process ? "PASS" : "FAIL", facts.process ? facts.process.id : "no active process with code SBI_CARD");

  if (facts.counts.account !== null) add("rows in sbi_card_account_file", "INFO", String(facts.counts.account));
  if (facts.flows) {
    const bad = Object.keys(facts.flows).filter((f) => !["NEW", "MANUAL"].includes(f));
    add("flow values", bad.length ? "FAIL" : "PASS", Object.entries(facts.flows).map(([k, v]) => `${k}=${v}`).join(" ") || "no rows");
  }
  if (facts.counts.agentTime !== null) add("rows in sbi_card_agent_time", "INFO", `${facts.counts.agentTime} (0 until the first APR file is uploaded)`);

  return { checks, ok: !checks.some((c) => c.status === "FAIL") };
}

async function collect(conn) {
  const q = async (sql, params = []) => (await conn.query(sql, params))[0];
  const cols = async (t) => {
    const rows = await q("SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION", [t]);
    return rows.length ? rows.map((r) => String(r.c)) : null;
  };
  const agentTimeColumns = await cols("sbi_card_agent_time"); const accountColumns = await cols("sbi_card_account_file"); const outcomeColumns = await cols("sbi_card_outcome"); const rosterColumns = await cols("sbi_card_roster");
  const uniqueKeys = (await q("SELECT DISTINCT INDEX_NAME AS i FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sbi_card_account_file' AND NON_UNIQUE = 0")).map((r) => String(r.i));

  let migrationRow = null;
  const smCols = (await q("SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'schema_migrations'")).map((r) => String(r.c));
  if (smCols.length) {
    const select = ["filename", smCols.includes("applied_at") ? "applied_at" : null, smCols.includes("success") ? "success" : null].filter(Boolean).join(", ");
    migrationRow = (await q(`SELECT ${select} FROM schema_migrations WHERE filename = ? OR filename LIKE ? ORDER BY filename = ? DESC LIMIT 1`,
      [MIGRATION_FILE, "%2075_sbi_collections_ops_and_apr.sql", MIGRATION_FILE]))[0] ?? null;
  }

  let outcomeMigrationRow = null;
  if (smCols.length) {
    outcomeMigrationRow = (await q("SELECT filename" + (smCols.includes("applied_at") ? ", applied_at" : "") + (smCols.includes("success") ? ", success" : "") + " FROM schema_migrations WHERE filename = ? OR filename LIKE ? LIMIT 1",
      ["migrations/2076_sbi_card_outcome.sql", "%2076_sbi_card_outcome.sql"]))[0] ?? null;
  }

  let rosterMigrationRow = null;
  if (smCols.length) {
    rosterMigrationRow = (await q("SELECT filename" + (smCols.includes("applied_at") ? ", applied_at" : "") + (smCols.includes("success") ? ", success" : "") + " FROM schema_migrations WHERE filename = ? OR filename LIKE ? LIMIT 1",
      ["migrations/2077_sbi_card_roster.sql", "%2077_sbi_card_roster.sql"]))[0] ?? null;
  }

  const templates = {};
  for (const code of ["SBI_CARD_APR", "SBI_CARD_ACCOUNT_FILE", "SBI_CARD_OUTCOME", "SBI_CARD_ROSTER"]) {
    const r = (await q("SELECT active_status AS active, optional_columns AS opt FROM upload_template_master WHERE upload_type_code = ? LIMIT 1", [code]))[0];
    if (!r) { templates[code] = null; continue; }
    let opt = r.opt; try { opt = typeof opt === "string" ? JSON.parse(opt) : opt; } catch { opt = []; }
    templates[code] = { active: r.active, optional: Array.isArray(opt) ? opt.map(String) : [] };
  }

  const process = (await q("SELECT id FROM process_master WHERE process_code = 'SBI_CARD' AND active_status = 1 LIMIT 1"))[0] ?? null;
  const counts = { account: null, agentTime: null, outcome: null, roster: null }; let flows = null;
  if (accountColumns) {
    counts.account = Number((await q("SELECT COUNT(*) AS n FROM sbi_card_account_file"))[0].n);
    if (accountColumns.includes("flow")) { flows = {}; for (const r of await q("SELECT flow, COUNT(*) AS n FROM sbi_card_account_file GROUP BY flow")) flows[String(r.flow)] = Number(r.n); }
  }
  if (rosterColumns) counts.roster = Number((await q("SELECT COUNT(*) AS n FROM sbi_card_roster"))[0].n);
  if (outcomeColumns) counts.outcome = Number((await q("SELECT COUNT(*) AS n FROM sbi_card_outcome"))[0].n);
  if (agentTimeColumns) counts.agentTime = Number((await q("SELECT COUNT(*) AS n FROM sbi_card_agent_time"))[0].n);
  return { agentTimeColumns, accountColumns, outcomeColumns, outcomeMigrationRow, rosterColumns, rosterMigrationRow, uniqueKeys, migrationRow, templates, process, counts, flows };
}

async function main() {
  const refusal = refuseWriteMode(process.argv.slice(2));
  if (refusal) { console.error(`::error::${refusal}`); process.exit(1); }
  await import("dotenv/config");
  const require = createRequire(import.meta.url);
  const mysql = require("mysql2/promise");
  const strip = (v) => String(v ?? "").trim().replace(/^["']|["']$/g, "");
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST_OVERRIDE || strip(process.env.DB_HOST), port: Number(strip(process.env.DB_PORT) || 3306),
    user: strip(process.env.DB_USER), password: strip(process.env.DB_PASSWORD), database: strip(process.env.DB_NAME), connectTimeout: 20000, dateStrings: true,
  });
  try {
    await conn.query("SET SESSION TRANSACTION READ ONLY");
    const [[who]] = await conn.query("SELECT DATABASE() AS db, VERSION() AS version");
    console.log(`sbi-card-verify (read-only)  database=${who.db}  mysql=${who.version}`);
    const { checks, ok } = evaluate(await collect(conn));
    for (const c of checks) console.log(`${c.status.padEnd(4)}  ${c.name}: ${c.detail}`);
    console.log(`\nSUMMARY: ${ok ? "PASS" : "FAIL"} (${checks.filter((c) => c.status === "PASS").length} pass, ${checks.filter((c) => c.status === "FAIL").length} fail)`);
    if (!ok) process.exitCode = 1;
  } finally { await conn.end(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => { console.error(`::error::sbi-card-verify failed: ${err?.code ?? ""} ${err?.message ?? err}`); process.exit(1); });
}
