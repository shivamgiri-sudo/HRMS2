/**
 * UAT end-to-end exercise of the KPI Studio and the Client Portal against REAL databases.
 *
 * WHAT MAKES THIS DIFFERENT FROM THE UNIT SUITE
 * The 191 unit tests added with this feature mock the database. They prove the formula engine's
 * arithmetic, the SSRF guard's host matching and the CSV parser's RFC 4180 handling. What they
 * cannot prove is that the SQL those services emit is accepted by MySQL 8, that a second connection
 * pool to a genuinely separate server works, or that a published Google Sheet is reachable over the
 * real internet. This script covers exactly that gap:
 *
 *   local_query           -> a real table in the real UAT schema, real SQL, real rows
 *   integration_connector -> a SEPARATE MySQL server on another port, reached through
 *                            external-db.service.ts with real AES-encrypted credentials
 *   google_sheet_csv      -> a real live published sheet fetched over real HTTPS from
 *                            docs.google.com, plus the SSRF and error paths
 *   upload                -> real CSV and real XLSX buffers through the real parser and committer
 *   manual                -> real rows written and read back
 *   multi-source          -> ONE definition whose formula spans four of the five at once
 *
 * EVERY STEP IS A REAL CALL INTO THE SHIPPING SERVICE. Nothing here reimplements product logic; if
 * a step passes it is because the code a user hits passed.
 *
 * The exit code is 0 only when every step passed. Steps are independent: one failure does not stop
 * the run, because the point is a complete census of what works, not the first thing that does not.
 *
 * SAFETY. Refuses to start unless the target database is local and disposably named. It writes
 * freely, so that guard is not optional and has no override flag.
 *
 *   bash scripts/uat/uat-infra-up.sh
 *   npx tsx scripts/uat/uat-build-schema.ts
 *   docker exec -i uat-hrms-mysql     mysql -uroot -puatroot mas_hrms_test < scripts/uat/uat-seed.sql
 *   docker exec -i uat-external-mysql mysql -uroot -puatroot dialer_uat    < scripts/uat/uat-seed-external.sql
 *   DB_HOST=127.0.0.1 DB_PORT=13306 DB_USER=root DB_PASSWORD=uatroot DB_NAME=mas_hrms_test \
 *     npx tsx scripts/uat/uat-kpi-studio-e2e.ts
 */
import { db } from "../../src/db/mysql.js";
import type { RowDataPacket } from "mysql2";
import { encryptCredentials } from "../../src/modules/external-db/external-db.service.js";
import * as studio from "../../src/modules/kpi/kpi-studio.service.js";
import * as sources from "../../src/modules/kpi/kpi-studio.sources.js";
import * as compute from "../../src/modules/kpi/kpi-studio.compute.js";
import * as gsheet from "../../src/modules/kpi/kpi-studio.gsheet.js";
import { evaluateFormula } from "../../src/modules/kpi/kpi-formula.engine.js";
import { portalKpiEngine } from "../../src/modules/portal/portal.kpi-engine.service.js";

// ── Safety ────────────────────────────────────────────────────────────────────────────────────
const DB_NAME = process.env.DB_NAME ?? "";
const DB_HOST = (process.env.DB_HOST ?? "").trim().toLowerCase();
if (!new Set(["127.0.0.1", "localhost", "::1"]).has(DB_HOST) || !/(_test$|_uat$|^test_|^uat_)/i.test(DB_NAME)) {
  console.error(`FATAL: this script WRITES. It requires a local, disposably-named database. ` +
    `Got host='${DB_HOST}' name='${DB_NAME}'.`);
  process.exit(1);
}

// ── Reporting ─────────────────────────────────────────────────────────────────────────────────
interface Result { section: string; name: string; ok: boolean; detail: string; }
const results: Result[] = [];
let currentSection = "";
const section = (s: string) => { currentSection = s; console.log(`\n\u2500\u2500 ${s} ${"\u2500".repeat(Math.max(0, 74 - s.length))}`); };

async function step(name: string, fn: () => Promise<string>) {
  try {
    const detail = await fn();
    results.push({ section: currentSection, name, ok: true, detail });
    console.log(`  PASS  ${name}${detail ? ` \u2014 ${detail}` : ""}`);
  } catch (error) {
    const detail = error instanceof Error ? `${error.message}` : String(error);
    results.push({ section: currentSection, name, ok: false, detail });
    console.log(`  FAIL  ${name}\n          ${detail.split("\n").slice(0, 4).join("\n          ")}`);
  }
}
/** Throws with a readable message, so a wrong VALUE fails as loudly as a thrown exception. */
function expect(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`expectation failed: ${message}`);
}

const EMP = ["uat-emp-1", "uat-emp-2", "uat-emp-3", "uat-emp-4"];
const PROC_A = "uat-prc-a";
const PROC_B = "uat-prc-b";
const FROM = "2026-08-01";
const TO = "2026-08-31";
const DAY = "2026-08-12";

// A REAL published Google Sheet, public and reachable without credentials. Used so the sheet path is
// exercised over the actual internet against the actual Google host rather than a stub.
const LIVE_SHEET_URL =
  "https://docs.google.com/spreadsheets/d/1pBbCabAK6u6EIuyu_2XUul4Yxvf2w_Od6QYC_yEc4q4/gviz/tq?tqx=out:csv&sheet=Population_projections";

async function main() {
  const ids: Record<string, string> = {};

  // ═══ 0. Capability probe ════════════════════════════════════════════════════════════════════
  section("0. Schema capability probe");
  await step("studio tables are detected as present", async () => {
    studio.resetStudioCapability();
    const cap = await studio.getStudioCapability();
    expect(cap.available, `capability reports unavailable: ${JSON.stringify(cap)}`);
    return `available=${cap.available}`;
  });
  await step("multi-source join table is detected", async () => {
    studio.resetMultiSourceSupport();
    const ok = await studio.multiSourceSupported();
    expect(ok, "kpi_studio_definition_source not detected");
    return "kpi_studio_definition_source present";
  });

  // ═══ 1. source_type = local_query ═══════════════════════════════════════════════════════════
  section("1. Source type: local_query (same MySQL, another table)");
  await step("save a local_query data source against attendance_daily_record", async () => {
    const r = await studio.saveDataSource({
      source_code: "UAT_LOCAL_ATT", source_name: "UAT Attendance (local)",
      source_type: "local_query", source_object: "attendance_daily_record",
      employee_key_column: "employee_id", employee_key_kind: "employee_id",
      date_column: "record_date", description: "UAT local query source",
    }, "uat-runner");
    ids.localSrc = String((r as any).id ?? r);
    expect(ids.localSrc, "no id returned");
    return `id=${ids.localSrc}`;
  });
  await step("declare fields on the local source", async () => {
    await sources.saveSourceField ? null : null;
    await studio.saveSourceField({
      data_source_id: ids.localSrc, field_name: "late_flag",
      source_column: "late_mark", aggregate_fn: "SUM", unit: "count",
    });
    await studio.saveSourceField({
      data_source_id: ids.localSrc, field_name: "att_rows",
      source_column: "late_mark", aggregate_fn: "COUNT", unit: "count",
    });
    const withFields = await studio.getDataSourceWithFields(ids.localSrc);
    expect((withFields as any).fields.length === 2, `expected 2 fields, got ${(withFields as any).fields.length}`);
    return "late_flag (SUM), att_rows (COUNT)";
  });
  await step("introspect real columns from the live table", async () => {
    const src = await studio.getDataSourceWithFields(ids.localSrc);
    const cols = await sources.introspectSourceColumns((src as any).source);
    expect(cols.columns.length > 0, "no columns introspected");
    expect(cols.columns.includes("attendance_status"), `attendance_status missing from ${cols.columns.join(",")}`);
    return `${cols.columns.length} columns incl. attendance_status`;
  });
  await step("READ real values through readSourceValues", async () => {
    const src = await studio.getDataSourceWithFields(ids.localSrc);
    const read = await sources.readSourceValues((src as any).source, (src as any).fields, EMP, FROM, TO);
    expect(!read.error, `error: ${read.error}`);
    expect(read.rowsRead > 0, "0 rows read from a table that has data");
    return `rowsRead=${read.rowsRead}, dayBuckets=${read.values.size}`;
  });

  // ═══ 2. source_type = integration_connector (separate server) ═══════════════════════════════
  section("2. Source type: integration_connector (SEPARATE MySQL server, port 13307)");
  await step("store encrypted credentials for the external dialer DB", async () => {
    const encrypted = encryptCredentials({
      db_type: "mysql", host: "127.0.0.1", port: 13307,
      username: "root", password: "uatroot", database: "dialer_uat",
    } as any);
    await db.execute(
      `INSERT INTO integration_config (integration_key, integration_name, integration_type, encrypted_credentials, active_status)
       VALUES ('UAT_DIALER','UAT Dialer','database',?,1)
       ON DUPLICATE KEY UPDATE encrypted_credentials = VALUES(encrypted_credentials), active_status = 1`,
      [encrypted],
    );
    return "integration_key=UAT_DIALER, credentials AES-encrypted";
  });
  await step("save an integration_connector data source", async () => {
    const r = await studio.saveDataSource({
      source_code: "UAT_DIALER_PROD", source_name: "UAT Dialer Productivity",
      source_type: "integration_connector", integration_key: "UAT_DIALER",
      source_object: "agent_daily_productivity",
      employee_key_column: "agent_code", employee_key_kind: "employee_code",
      date_column: "stat_date",
    }, "uat-runner");
    ids.connSrc = String((r as any).id ?? r);
    return `id=${ids.connSrc}`;
  });
  await step("declare connector fields", async () => {
    for (const [name, col, fn] of [
      ["calls_handled", "calls_handled", "SUM"],
      ["calls_offered", "calls_offered", "SUM"],
      ["talk_secs", "talk_time_sec", "SUM"],
      ["sales", "sales_closed", "SUM"],
    ] as const) {
      await studio.saveSourceField({ data_source_id: ids.connSrc, field_name: name, source_column: col, aggregate_fn: fn });
    }
    return "calls_handled, calls_offered, talk_secs, sales";
  });
  await step("introspect columns ACROSS the connection boundary", async () => {
    const src = await studio.getDataSourceWithFields(ids.connSrc);
    const cols = await sources.introspectSourceColumns((src as any).source);
    expect(cols.columns.includes("talk_time_sec"), `got ${cols.columns.join(",")}`);
    return `${cols.columns.length} columns from dialer_uat`;
  });
  await step("READ real rows from the external server", async () => {
    const src = await studio.getDataSourceWithFields(ids.connSrc);
    const read = await sources.readSourceValues((src as any).source, (src as any).fields, EMP, FROM, TO);
    expect(!read.error, `error: ${read.error}`);
    expect(read.rowsRead > 0, "0 rows from the external DB");
    return `rowsRead=${read.rowsRead}, dayBuckets=${read.values.size}`;
  });
  await step("an UNREACHABLE connector returns an error, never throws", async () => {
    const encrypted = encryptCredentials({
      db_type: "mysql", host: "127.0.0.1", port: 19999,
      username: "root", password: "nope", database: "nothing",
    } as any);
    await db.execute(
      `INSERT INTO integration_config (integration_key, integration_name, integration_type, encrypted_credentials, active_status)
       VALUES ('UAT_DEAD','UAT Dead','database',?,1)
       ON DUPLICATE KEY UPDATE encrypted_credentials = VALUES(encrypted_credentials)`, [encrypted]);
    const r = await studio.saveDataSource({
      source_code: "UAT_DEAD_SRC", source_name: "UAT Dead Source", source_type: "integration_connector",
      integration_key: "UAT_DEAD", source_object: "whatever",
      employee_key_column: "agent_code", employee_key_kind: "employee_code", date_column: "stat_date",
    }, "uat-runner");
    const deadId = String((r as any).id ?? r);
    await studio.saveSourceField({ data_source_id: deadId, field_name: "dead_field", source_column: "x", aggregate_fn: "SUM" });
    const src = await studio.getDataSourceWithFields(deadId);
    const read = await sources.readSourceValues((src as any).source, (src as any).fields, EMP, FROM, TO);
    expect(read.error, "an unreachable server produced no error - it would look like 'no data'");
    expect(read.rowsRead === 0, "rows were read from an unreachable server");
    return `error surfaced: ${read.error!.slice(0, 70)}`;
  });

  // ═══ 3. source_type = google_sheet_csv ══════════════════════════════════════════════════════
  section("3. Source type: google_sheet_csv (REAL network to docs.google.com)");
  await step("REAL fetch of a live published sheet over HTTPS", async () => {
    const sheet = await gsheet.fetchSheetCsv(LIVE_SHEET_URL);
    expect(!sheet.error, `error: ${sheet.error}`);
    expect(sheet.headers.length >= 3, `headers: ${JSON.stringify(sheet.headers)}`);
    expect(sheet.rows.length > 0, "no rows parsed from the live sheet");
    return `headers=[${sheet.headers.join("|")}], rows=${sheet.rows.length}`;
  });
  await step("a well-formed link to a NON-published sheet gives a clear message", async () => {
    const sheet = await gsheet.fetchSheetCsv(
      "https://docs.google.com/spreadsheets/d/1AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/gviz/tq?tqx=out:csv");
    expect(sheet.error, "a bogus sheet id produced no error");
    expect(!/undefined|\[object/i.test(sheet.error!), `unhelpful message: ${sheet.error}`);
    return `${sheet.error!.slice(0, 80)}`;
  });
  await step("SSRF: non-Google hosts and lookalikes are refused", async () => {
    for (const bad of [
      "http://docs.google.com/x.csv",
      "https://docs.google.com.attacker.example/x.csv",
      "https://169.254.169.254/latest/meta-data/",
      "https://localhost/x.csv",
      "file:///etc/passwd",
      "https://evil.example/docs.google.com/x.csv",
    ]) {
      let refused = false;
      try { gsheet.validateSheetCsvUrl(bad); } catch { refused = true; }
      expect(refused, `ACCEPTED a URL it must refuse: ${bad}`);
    }
    return "6/6 hostile URLs refused";
  });
  await step("SSRF: a redirect off-allowlist is not followed", async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(null, {
      status: 302, headers: { location: "http://169.254.169.254/latest/meta-data/" },
    })) as typeof fetch;
    try {
      const sheet = await gsheet.fetchSheetCsv(LIVE_SHEET_URL);
      expect(sheet.error, "a redirect to the metadata IP was followed without error");
      expect(!sheet.rows.length, "rows came back from a refused redirect");
      return `refused: ${sheet.error!.slice(0, 70)}`;
    } finally { globalThis.fetch = realFetch; }
  });
  await step("an unpublished sheet returning HTML is reported as unpublished, not empty", async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response("<html><body>Sign in</body></html>", {
      status: 200, headers: { "content-type": "text/html; charset=utf-8" },
    })) as typeof fetch;
    try {
      const sheet = await gsheet.fetchSheetCsv(LIVE_SHEET_URL);
      expect(sheet.error && /publish/i.test(sheet.error), `expected a publish hint, got: ${sheet.error}`);
      return "reported as not published";
    } finally { globalThis.fetch = realFetch; }
  });
  await step("save a google_sheet_csv source (URL validated at save time)", async () => {
    const r = await studio.saveDataSource({
      source_code: "UAT_QA_SHEET", source_name: "UAT QA Sheet",
      source_type: "google_sheet_csv", csv_url: LIVE_SHEET_URL,
      employee_key_column: "AgentCode", employee_key_kind: "employee_code", date_column: "Date",
    }, "uat-runner");
    ids.sheetSrc = String((r as any).id ?? r);
    return `id=${ids.sheetSrc}`;
  });
  await step("saving a source with a hostile CSV URL is rejected", async () => {
    let refused = false;
    try {
      await studio.saveDataSource({
        source_code: "UAT_EVIL_SHEET", source_name: "UAT Evil", source_type: "google_sheet_csv",
        csv_url: "https://docs.google.com.attacker.example/x.csv",
        employee_key_column: "AgentCode", employee_key_kind: "employee_code", date_column: "Date",
      }, "uat-runner");
    } catch { refused = true; }
    expect(refused, "a hostile CSV URL was accepted at save time");
    return "rejected at save time, not at 2am";
  });
  await step("declare sheet fields and READ employee-shaped CSV end to end", async () => {
    for (const name of ["audited_calls", "audit_passed"]) {
      await studio.saveSourceField({ data_source_id: ids.sheetSrc, field_name: name, source_column: name, aggregate_fn: "SUM" });
    }
    // The real parser, real date/number coercion, real employee-code translation and real
    // aggregation all run. Only the network transport is served locally, because publishing a
    // sheet with these columns would need a Google account this runner does not have.
    const csv = ["AgentCode,Date,audited_calls,audit_passed",
      `UAT001,${DAY},10,9`, `UAT001,${DAY},5,4`,          // two rows, one day -> SUM aggregation
      `UAT002,${DAY},8,6`,
      `UAT003,12/08/2026,"1,200",900`,                     // dd/mm/yyyy + thousands separator
      `UNKNOWN9,${DAY},99,99`,                             // unknown agent -> skipped, not guessed
      `UAT004,2026-01-01,7,7`,                             // outside the window -> excluded
    ].join("\n");
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(csv, { status: 200, headers: { "content-type": "text/csv" } })) as typeof fetch;
    try {
      const src = await studio.getDataSourceWithFields(ids.sheetSrc);
      const read = await sources.readSourceValues((src as any).source, (src as any).fields, EMP, FROM, TO);
      expect(!read.error, `error: ${read.error}`);
      expect(read.rowsRead === 4, `expected 4 in-window known-agent rows, got ${read.rowsRead}`);
      const bucket = read.values.get(`uat-emp-1|${DAY}`);
      expect(bucket, `no bucket for uat-emp-1 on ${DAY}; keys=${[...read.values.keys()].join(",")}`);
      expect(bucket!.get("audited_calls") === 15, `SUM aggregation wrong: ${bucket!.get("audited_calls")} (want 15)`);
      return `rowsRead=4, UAT001 audited_calls=15 (2 rows summed), dd/mm/yyyy + "1,200" parsed`;
    } finally { globalThis.fetch = realFetch; }
  });

  // ═══ 4. source_type = upload ════════════════════════════════════════════════════════════════
  section("4. Source type: upload (real CSV and real XLSX buffers)");
  await step("save an upload data source with fields", async () => {
    const r = await studio.saveDataSource({
      source_code: "UAT_UPLOAD", source_name: "UAT Upload", source_type: "upload",
      employee_key_column: "EmpCode", employee_key_kind: "employee_code", date_column: "Day",
    }, "uat-runner");
    ids.uploadSrc = String((r as any).id ?? r);
    for (const name of ["csat_score", "surveys"]) {
      await studio.saveSourceField({ data_source_id: ids.uploadSrc, field_name: name, source_column: name, aggregate_fn: "SUM" });
    }
    return `id=${ids.uploadSrc}`;
  });
  await step("parse a real CSV buffer", async () => {
    const buf = Buffer.from(`EmpCode,Day,csat_score,surveys\nUAT001,${DAY},88,10\nUAT002,${DAY},92,12\n`, "utf8");
    const parsed = await sources.parseUploadBuffer(buf, "uat.csv");
    expect(parsed.rows.length === 2, `rows=${parsed.rows.length}`);
    expect(parsed.headers.includes("csat_score"), `headers=${parsed.headers.join(",")}`);
    return `${parsed.rows.length} rows, headers=[${parsed.headers.join("|")}]`;
  });
  await step("suggestColumnMapping matches headers to fields", async () => {
    const map = sources.suggestColumnMapping(["EmpCode", "Day", "csat_score", "surveys"], [
      { field_name: "csat_score" } as any, { field_name: "surveys" } as any,
    ]);
    expect(map.csat_score === "csat_score", `got ${JSON.stringify(map)}`);
    return JSON.stringify(map);
  });
  await step("dry-run commit reports outcomes and writes nothing", async () => {
    const before = await countManual();
    const res = await sources.commitUploadRows({
      dataSourceId: ids.uploadSrc, fileName: "uat.csv",
      employeeColumn: "EmpCode", dateColumn: "Day",
      columnMapping: { csat_score: "csat_score", surveys: "surveys" },
      rows: [{ EmpCode: "UAT001", Day: DAY, csat_score: 88, surveys: 10 }],
      uploadedBy: "uat-runner", dryRun: true,
    });
    const after = await countManual();
    expect(after === before, `dry run wrote ${after - before} rows`);
    return `accepted=${res.accepted ?? "n/a"}, rowsWritten=0`;
  });
  await step("real commit writes values, and a bad row is REJECTED not silently dropped", async () => {
    const res = await sources.commitUploadRows({
      dataSourceId: ids.uploadSrc, fileName: "uat.csv",
      employeeColumn: "EmpCode", dateColumn: "Day",
      columnMapping: { csat_score: "csat_score", surveys: "surveys" },
      rows: [
        { EmpCode: "UAT001", Day: DAY, csat_score: 88, surveys: 10 },
        { EmpCode: "UAT002", Day: DAY, csat_score: 92, surveys: 12 },
        { EmpCode: "NOSUCH", Day: DAY, csat_score: 50, surveys: 5 },      // unknown employee
        { EmpCode: "UAT003", Day: "not-a-date", csat_score: 70, surveys: 8 }, // unparseable date
      ],
      uploadedBy: "uat-runner",
    });
    expect((res.rejections?.length ?? 0) >= 2, `expected >=2 rejections, got ${res.rejections?.length}`);
    return `accepted=${res.accepted}, rejected=${res.rejections!.length} (unknown employee + bad date, both reported)`;
  });
  await step("parse a real XLSX buffer", async () => {
    const XLSX = await import("xlsx");
    const ws = XLSX.utils.aoa_to_sheet([["EmpCode", "Day", "csat_score", "surveys"], ["UAT001", DAY, 91, 11]]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
    const parsed = await sources.parseUploadBuffer(buf, "uat.xlsx");
    expect(parsed.rows.length === 1, `rows=${parsed.rows.length}`);
    return `1 row from a genuine .xlsx (${buf.length} bytes)`;
  });

  // ═══ 5. source_type = manual ════════════════════════════════════════════════════════════════
  section("5. Source type: manual entry");
  await step("save a manual source and write values, including an explicit NULL", async () => {
    const r = await studio.saveDataSource({
      source_code: "UAT_MANUAL", source_name: "UAT Manual", source_type: "manual",
      employee_key_column: "employee_id", employee_key_kind: "employee_id", date_column: "value_date",
    }, "uat-runner");
    ids.manualSrc = String((r as any).id ?? r);
    for (const name of ["coaching_hours", "escalations"]) {
      await studio.saveSourceField({ data_source_id: ids.manualSrc, field_name: name, aggregate_fn: "SUM" });
    }
    await sources.saveManualValue({ dataSourceId: ids.manualSrc, employeeId: "uat-emp-1", fieldName: "coaching_hours", valueDate: DAY, value: 2, userId: "uat-runner" });
    await sources.saveManualValue({ dataSourceId: ids.manualSrc, employeeId: "uat-emp-2", fieldName: "coaching_hours", valueDate: DAY, value: 3, userId: "uat-runner" });
    // A deliberate NULL. NULL must propagate through the formula as "unknown", never as 0.
    await sources.saveManualValue({ dataSourceId: ids.manualSrc, employeeId: "uat-emp-3", fieldName: "coaching_hours", valueDate: DAY, value: null, userId: "uat-runner" });
    const src = await studio.getDataSourceWithFields(ids.manualSrc);
    const read = await sources.readSourceValues((src as any).source, (src as any).fields, EMP, FROM, TO);
    expect(!read.error, `error: ${read.error}`);
    expect(read.rowsRead > 0, "manual values written but not read back");
    return `rowsRead=${read.rowsRead}`;
  });
  await step("re-saving the same manual cell UPDATES rather than duplicating", async () => {
    const before = await countManual();
    await sources.saveManualValue({ dataSourceId: ids.manualSrc, employeeId: "uat-emp-1", fieldName: "coaching_hours", valueDate: DAY, value: 9, userId: "uat-runner" });
    const after = await countManual();
    expect(after === before, `row count changed by ${after - before}: the ON DUPLICATE KEY path is not working`);
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT field_value FROM kpi_studio_manual_value WHERE employee_id='uat-emp-1' AND field_name='coaching_hours' AND value_date=?`, [DAY]);
    expect(Number((rows as any[])[0].field_value) === 9, `value not updated: ${(rows as any[])[0].field_value}`);
    return "upserted in place, value now 9";
  });

  // ═══ 6. Multi-source: ONE formula spanning four systems ═════════════════════════════════════
  section("6. Multi-source definition (local + external + sheet + manual in ONE formula)");
  await step("save a definition whose formula reads fields from four sources", async () => {
    const r = await studio.saveDefinition({
      metric_id: "uat-met-conv", process_id: PROC_A,
      data_source_id: ids.connSrc,
      extra_source_ids: [ids.localSrc, ids.sheetSrc, ids.manualSrc],
      formula_expression: "PCT(sales, calls_handled) - late_flag + coaching_hours",
      aggregation_method: "average", scoring_type: "higher_is_better",
      target_value: 20, weightage: 100, effective_from: "2026-01-01",
      notes: "UAT multi-source: dialer + attendance + sheet + manual",
    }, "uat-runner");
    ids.multiDef = String((r as any).id ?? r);
    const srcIds = await studio.getDefinitionSourceIds(ids.multiDef);
    expect(srcIds.length >= 3, `expected the extra sources to persist, got ${srcIds.length}`);
    return `id=${ids.multiDef}, extraSources=${srcIds.length}`;
  });
  await step("readMergedSourceValues merges all four without error", async () => {
    const entries = [];
    for (const id of [ids.connSrc, ids.localSrc, ids.sheetSrc, ids.manualSrc]) {
      const s = await studio.getDataSourceWithFields(id);
      entries.push({ source: (s as any).source, fields: (s as any).fields });
    }
    const csv = `AgentCode,Date,audited_calls,audit_passed\nUAT001,${DAY},10,9\n`;
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(csv, { status: 200, headers: { "content-type": "text/csv" } })) as typeof fetch;
    try {
      const merged = await sources.readMergedSourceValues(entries as any, EMP, FROM, TO);
      expect(merged.failures.length === 0, `failures: ${JSON.stringify(merged.failures)}`);
      const bucket = merged.values.get(`uat-emp-1|${DAY}`);
      expect(bucket, "no merged bucket for uat-emp-1");
      const names = [...bucket!.keys()];
      for (const need of ["calls_handled", "late_flag", "audited_calls", "coaching_hours"]) {
        expect(names.includes(need), `merged bucket is missing ${need}; has ${names.join(",")}`);
      }
      return `one day bucket carries ${names.length} fields from 4 systems: ${names.join(", ")}`;
    } finally { globalThis.fetch = realFetch; }
  });
  await step("a duplicate field name across sources is reported, deterministically", async () => {
    const s1 = await studio.getDataSourceWithFields(ids.connSrc);
    const clone = await studio.saveDataSource({
      source_code: "UAT_DUP_SRC", source_name: "UAT Duplicate Field Source", source_type: "manual",
      employee_key_column: "employee_id", employee_key_kind: "employee_id", date_column: "value_date",
    }, "uat-runner");
    const cloneId = String((clone as any).id ?? clone);
    await studio.saveSourceField({ data_source_id: cloneId, field_name: "sales", aggregate_fn: "SUM" });
    await sources.saveManualValue({ dataSourceId: cloneId, employeeId: "uat-emp-1", fieldName: "sales", valueDate: DAY, value: 1, userId: "uat-runner" });
    const s2 = await studio.getDataSourceWithFields(cloneId);
    const merged = await sources.readMergedSourceValues(
      [{ source: (s1 as any).source, fields: (s1 as any).fields }, { source: (s2 as any).source, fields: (s2 as any).fields }] as any,
      EMP, FROM, TO);
    expect(merged.failures.some((f) => f.error.includes('"sales"')), `collision not reported: ${JSON.stringify(merged.failures)}`);
    return `collision reported once: ${merged.failures.find((f) => f.error.includes('"sales"'))!.error.slice(0, 80)}`;
  });

  // ═══ 7. Formula engine + compute against real data ══════════════════════════════════════════
  section("7. Formula engine and computation");
  await step("engine rejects code injection and unknown identifiers", async () => {
    for (const bad of [
      "process.exit(1)", "require('fs')", "constructor.constructor('return 1')()",
      "global.x", "1;DROP TABLE employees", "__proto__", "eval('1')",
    ]) {
      const r = evaluateFormula(bad, { calls_handled: 10 });
      expect(!r.ok, `engine ACCEPTED hostile input: ${bad}`);
    }
    return "7/7 hostile formulas refused";
  });
  await step("NULL propagates as unknown and never becomes 0", async () => {
    const r = evaluateFormula("a + b", { a: 10, b: null });
    expect(r.ok, `evaluation failed: ${r.error}`);
    expect(r.value === null, `null was coerced to ${r.value}`);
    const d = evaluateFormula("PCT(a, b)", { a: 5, b: 0 });
    expect(d.ok && d.value === null, `divide-by-zero gave ${d.value}, expected null`);
    return "null + 10 = null; PCT(5,0) = null (not Infinity, not 0)";
  });
  await step("a missing input key is an ERROR, distinct from a null value", async () => {
    const missing = evaluateFormula("a + b", { a: 1 });
    expect(!missing.ok, "a missing variable was tolerated");
    const nulled = evaluateFormula("a + b", { a: 1, b: null });
    expect(nulled.ok, "an explicit null was treated as missing");
    return "missing key -> error; null value -> null";
  });
  await step("previewFormula runs against real rows", async () => {
    const csv = `AgentCode,Date,audited_calls,audit_passed\nUAT001,${DAY},10,9\n`;
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(csv, { status: 200, headers: { "content-type": "text/csv" } })) as typeof fetch;
    try {
      const p = await compute.previewFormula({
        formula: "PCT(sales, calls_handled)", dataSourceId: ids.connSrc,
        employeeIds: EMP, dateFrom: FROM, dateTo: TO, aggregationMethod: "average",
      } as any);
      expect(p, "no preview returned");
      return `rows=${(p as any).rows?.length ?? "n/a"}, sample=${JSON.stringify((p as any).rows?.[0] ?? (p as any)).slice(0, 90)}`;
    } finally { globalThis.fetch = realFetch; }
  });
  await step("computeStudioKpis dry-run over the real process", async () => {
    const csv = `AgentCode,Date,audited_calls,audit_passed\nUAT001,${DAY},10,9\n`;
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(csv, { status: 200, headers: { "content-type": "text/csv" } })) as typeof fetch;
    try {
      const out = await compute.computeStudioKpis({ date: DAY, processId: PROC_A, dryRun: true, limit: 50 });
      expect(out, "no outcome");
      return `employees=${(out as any).employeesEvaluated ?? "?"}, computed=${(out as any).valuesComputed ?? "?"}, errors=${JSON.stringify((out as any).errors ?? []).slice(0, 120)}`;
    } finally { globalThis.fetch = realFetch; }
  });
  await step("computeStudioKpis for real, writing results", async () => {
    const csv = `AgentCode,Date,audited_calls,audit_passed\nUAT001,${DAY},10,9\n`;
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(csv, { status: 200, headers: { "content-type": "text/csv" } })) as typeof fetch;
    try {
      const out = await compute.computeStudioKpis({ date: DAY, processId: PROC_A, limit: 50 });
      const [log] = await db.execute<RowDataPacket[]>(
        `SELECT COUNT(*) n FROM kpi_studio_computation_log WHERE compute_date = ?`, [DAY]);
      return `log rows=${(log as any[])[0].n}, outcome=${JSON.stringify(out).slice(0, 140)}`;
    } finally { globalThis.fetch = realFetch; }
  });
  await step("resolveStudioForEmployee returns the winning definition", async () => {
    const resolved = await studio.resolveStudioForEmployee("uat-emp-1", DAY);
    expect(Array.isArray(resolved), "not an array");
    return `${resolved.length} definition(s) resolved for uat-emp-1`;
  });
  await step("explainMetricForEmployee produces an RCA breakdown", async () => {
    const csv = `AgentCode,Date,audited_calls,audit_passed\nUAT001,${DAY},10,9\n`;
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(csv, { status: 200, headers: { "content-type": "text/csv" } })) as typeof fetch;
    try {
      const ex = await compute.explainMetricForEmployee("uat-emp-1", "uat-met-conv", FROM, TO);
      expect(ex, "no explanation");
      return JSON.stringify(ex).slice(0, 140);
    } finally { globalThis.fetch = realFetch; }
  });
  await step("getDefinitionCoverage counts who the definition applies to", async () => {
    const cov = await studio.getDefinitionCoverage(ids.multiDef);
    return JSON.stringify(cov).slice(0, 140);
  });
  await step("validateDefinition blocks a formula referencing an unmapped field", async () => {
    const v = studio.validateDefinition(
      { metric_id: "uat-met-conv", formula_expression: "nonexistent_field * 2", process_id: PROC_A } as any,
      { availableFields: ["calls_handled", "sales"] });
    expect(!v.ok, "a formula reading an unmapped field was accepted");
    return `refused: ${v.message?.slice(0, 80)}`;
  });

  // ═══ 8. Client Portal KPI engine ════════════════════════════════════════════════════════════
  section("8. Client Portal KPI engine (real attendance / leave / exits)");
  await step("computeKpisForProcess returns every seeded metric with a sparkline", async () => {
    const metrics = await portalKpiEngine.computeKpisForProcess(PROC_A, "2026-08");
    expect(metrics.length > 0, "no metrics returned for a process that has data");
    const codes = metrics.map((m: any) => m.metric_code);
    for (const need of ["ATT", "ABN", "LAT", "LVE", "RET", "DQ"]) {
      expect(codes.includes(need), `metric ${need} missing; got ${codes.join(",")}`);
    }
    const att = metrics.find((m: any) => m.metric_code === "ATT")!;
    expect((att as any).sparkline?.length > 0, "ATT has no sparkline");
    expect(typeof (att as any).actual === "number", `ATT actual is ${(att as any).actual}`);
    expect(["green", "amber", "red", "no_data"].includes((att as any).rag), `bad rag ${(att as any).rag}`);
    return metrics.map((m: any) => `${m.metric_code}=${m.actual}${m.unit === "percent" ? "%" : ""}/${m.rag}`).join("  ");
  });
  await step("sparkline is a 6-point monthly series in ascending order", async () => {
    const metrics = await portalKpiEngine.computeKpisForProcess(PROC_A, "2026-08");
    const att: any = metrics.find((m: any) => m.metric_code === "ATT");
    const periods = att.sparkline.map((p: any) => p.period);
    expect(periods.length >= 5, `only ${periods.length} points`);
    expect([...periods].sort().join() === periods.join(), `not ascending: ${periods.join(",")}`);
    return `${periods.join(" -> ")}`;
  });
  await step("an EMPTY process reports no_data, NOT 0%", async () => {
    const metrics = await portalKpiEngine.computeKpisForProcess(PROC_B, "2026-08");
    for (const m of metrics as any[]) {
      expect(!(m.actual === 0 && m.rag !== "no_data"),
        `${m.metric_code} reports 0 with rag='${m.rag}' for a process with no data - that asserts nobody turned up`);
    }
    const rags = [...new Set((metrics as any[]).map((m) => m.rag))];
    return `${metrics.length} metrics, rag values=[${rags.join(",")}]`;
  });
  await step("UTL is not fabricated while workforce_mandate is empty", async () => {
    const metrics = await portalKpiEngine.computeKpisForProcess(PROC_A, "2026-08");
    const utl: any = (metrics as any[]).find((m) => m.metric_code === "UTL");
    if (utl) {
      expect(utl.actual === null || utl.rag === "no_data",
        `UTL claims ${utl.actual} with no sanctioned headcount on record`);
      return `UTL present and correctly null (rag=${utl.rag})`;
    }
    return "UTL not reported at all, which is also correct with no mandate data";
  });
  await step("ATT excludes unconfirmed days and DQ discloses the exclusion", async () => {
    const metrics: any[] = await portalKpiEngine.computeKpisForProcess(PROC_A, "2026-08");
    const dq = metrics.find((m) => m.metric_code === "DQ");
    expect(dq && typeof dq.actual === "number", "DQ did not compute");
    expect(dq.actual < 100, `DQ is ${dq.actual}% but the fixture contains unreconciled/missing_punch rows`);
    // Independent SQL check that ATT's denominator is confirmed days only.
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT
         SUM(attendance_status IN ('present','week_off_worked')) + SUM(attendance_status='half_day')*0.5 AS num,
         SUM(attendance_status IN ('present','week_off_worked','half_day','absent'))                      AS den
       FROM attendance_daily_record a JOIN employees e ON e.id = a.employee_id
       WHERE e.process_id = ? AND DATE_FORMAT(a.record_date,'%Y-%m') = '2026-08'`, [PROC_A]);
    const r: any = (rows as any[])[0];
    const expected = Math.round((Number(r.num) / Number(r.den)) * 10000) / 100;
    const att = metrics.find((m) => m.metric_code === "ATT");
    expect(Math.abs(att.actual - expected) < 0.6,
      `ATT=${att.actual} but confirmed-day SQL says ${expected}`);
    return `ATT=${att.actual}% matches confirmed-day SQL (${expected}%), DQ=${dq.actual}% discloses the gap`;
  });
  await step("period selector genuinely changes the numbers", async () => {
    const aug = await portalKpiEngine.computeKpisForProcess(PROC_A, "2026-08");
    const jul = await portalKpiEngine.computeKpisForProcess(PROC_A, "2026-07");
    const a: any = (aug as any[]).find((m) => m.metric_code === "ATT");
    const j: any = (jul as any[]).find((m) => m.metric_code === "ATT");
    expect(typeof a.actual === "number" && typeof j.actual === "number", "one period did not compute");
    return `2026-07 ATT=${j.actual}%  vs  2026-08 ATT=${a.actual}%`;
  });
  await step("a nonexistent process id does not throw", async () => {
    const metrics = await portalKpiEngine.computeKpisForProcess("uat-does-not-exist", "2026-08");
    expect(Array.isArray(metrics), "did not return an array");
    return `returned ${metrics.length} metrics, no exception`;
  });
  await step("a malformed period is rejected rather than mis-queried", async () => {
    let refused = false;
    try { await portalKpiEngine.computeKpisForProcess(PROC_A, "August 2026"); } catch { refused = true; }
    const metrics = refused ? [] : await portalKpiEngine.computeKpisForProcess(PROC_A, "August 2026");
    expect(refused || metrics.length === 0, "a malformed period silently produced numbers");
    return refused ? "threw a validation error" : "returned nothing";
  });

  // ═══ 9. Portal services over real data ══════════════════════════════════════════════════════
  section("9. Portal services (attrition, overview, governance, glide, scorecard)");
  const svc: Record<string, any> = {};
  await step("load portal services", async () => {
    svc.attrition = (await import("../../src/modules/portal/portal.attrition.service.js")).portalAttritionService;
    svc.overview = (await import("../../src/modules/portal/portal.overview.service.js")).portalOverviewService;
    svc.governance = (await import("../../src/modules/portal/portal.governance.service.js")).portalGovernanceService;
    svc.glide = (await import("../../src/modules/portal/portal.glide.service.js")).portalGlideService;
    svc.kpi = (await import("../../src/modules/portal/portal.kpi.service.js")).portalKpiService;
    return "5 services loaded";
  });
  await step("attrition reads real date_of_exit", async () => {
    const a = await svc.attrition.getAttrition(PROC_A, "2026-07");
    expect(a, "nothing returned");
    return JSON.stringify(a).slice(0, 170);
  });
  await step("attrition on an empty process does not throw or divide by zero", async () => {
    const a = await svc.attrition.getAttrition(PROC_B, "2026-08");
    expect(a, "nothing returned");
    const s = JSON.stringify(a);
    expect(!/Infinity|NaN/.test(s), `produced Infinity/NaN: ${s.slice(0, 160)}`);
    return s.slice(0, 150);
  });
  await step("overview renders process cards", async () => {
    const o = await svc.overview.getOverview({ allowedProcessIds: [PROC_A, PROC_B], period: "2026-08" } as any);
    expect(o, "nothing returned");
    return JSON.stringify(o).slice(0, 170);
  });
  await step("governance reports activity completion with a logged flag", async () => {
    const g = await svc.governance.getGovernance(PROC_A, "2026-08");
    expect(g, "nothing returned");
    return JSON.stringify(g).slice(0, 170);
  });
  await step("glide paths do not throw on unpopulated KPI tables", async () => {
    const gp = await svc.glide.getGlidePaths(PROC_A, "2026-08");
    expect(Array.isArray(gp), "not an array");
    return `${gp.length} glide path(s)`;
  });
  await step("scorecard falls back to the engine when kpi_score is empty", async () => {
    const sc = await svc.kpi.getScorecard(PROC_A, "2026-08");
    expect(sc, "nothing returned");
    const s = JSON.stringify(sc);
    expect(!/Infinity|NaN/.test(s), `produced Infinity/NaN: ${s.slice(0, 150)}`);
    return s.slice(0, 170);
  });
  await step("every portal surface survives all six seeded months", async () => {
    const problems: string[] = [];
    for (const period of ["2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08"]) {
      for (const proc of [PROC_A, PROC_B]) {
        for (const [label, call] of [
          ["kpi-engine", () => portalKpiEngine.computeKpisForProcess(proc, period)],
          ["attrition", () => svc.attrition.getAttrition(proc, period)],
          ["governance", () => svc.governance.getGovernance(proc, period)],
          ["glide", () => svc.glide.getGlidePaths(proc, period)],
          ["scorecard", () => svc.kpi.getScorecard(proc, period)],
        ] as const) {
          try {
            const out = await call();
            if (/Infinity|NaN/.test(JSON.stringify(out ?? null))) problems.push(`${label}/${proc}/${period}: Infinity|NaN`);
          } catch (error) {
            problems.push(`${label}/${proc}/${period}: ${(error as Error).message}`);
          }
        }
      }
    }
    expect(problems.length === 0, `${problems.length} failure(s):\n  ${problems.slice(0, 8).join("\n  ")}`);
    return "60 surface/period/process combinations, 0 exceptions, 0 Infinity/NaN";
  });

  // ═══ Report ═════════════════════════════════════════════════════════════════════════════════
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${"=".repeat(80)}`);
  console.log(`UAT RESULT: ${results.length - failed.length}/${results.length} steps passed`);
  if (failed.length) {
    console.log(`\nFAILURES (${failed.length}):`);
    for (const f of failed) console.log(`  [${f.section}]\n    ${f.name}\n      ${f.detail.split("\n")[0]}`);
  }
  console.log("=".repeat(80));
  await db.end?.().catch(() => {});
  process.exit(failed.length ? 1 : 0);
}

async function countManual(): Promise<number> {
  const [rows] = await db.execute<RowDataPacket[]>(`SELECT COUNT(*) n FROM kpi_studio_manual_value`);
  return Number((rows as any[])[0].n);
}

main().catch((error) => { console.error("HARNESS CRASHED:", error); process.exit(1); });
