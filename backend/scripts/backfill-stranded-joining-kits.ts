/**
 * Backfill_Runner — the one-off bulk reconciliation of the 26 stranded joining kits.
 *
 * Luckpay never pushes completion, and the single pull mechanism (the eSign
 * reconciliation worker) has never run, so 26 kits dispatched between
 * 2026-08-01 and 2026-08-26 sit at status 'sent' with signed_file_id NULL while
 * their 215 checklist rows sit at esign_initiated / pending_candidate_esign.
 * The worker cannot recover them even once it is enabled: claimBatch's
 * `initiated_at > (NOW() - INTERVAL 30 DAY)` predicate already excludes
 * MAS47814 (dispatched 2026-08-01), which is the whole reason this exists as a
 * separate path rather than as a worker tick.
 *
 *   # on the server, from /var/www/HRMS2/backend
 *   npm run backfill:stranded-kits -- --actor-user-id <ID>            # dry run
 *   npm run backfill:stranded-kits -- --actor-user-id <ID> --confirm   # writes
 *   npm run backfill:stranded-kits -- --actor-user-id <ID> --kit-id <ID> --report ./r.csv
 *
 * Dry-run by default. A dry run still issues the status call for every eligible
 * kit — that is the point of it, because how many of the 26 Luckpay reports
 * signed is unknown until it has been asked — but performs no writes at all.
 *
 * Three things this deliberately does NOT do:
 *
 *   - It never re-sends, expires or otherwise touches an unsigned kit. Decision
 *     3 of the requirements is report-only: a kit the provider says is not
 *     signed is left byte-identical, and the absence of action is evidenced with
 *     an ESIGN_BACKFILL_EXAMINED_UNSIGNED audit row rather than left silent.
 *   - It never guesses the operator. --actor-user-id is mandatory, because
 *     Requirement 12 wants attribution that was stated rather than inferred from
 *     whichever session happened to exist.
 *   - It never restamps a signature with the time the script ran. The provider's
 *     own completion time is passed through to finalizeKitEsign whenever the
 *     provider reported one, and when it did not, the report says so in
 *     completedAtSource rather than disguising the absence.
 *
 * Provider spend is bounded by construction: exactly one checkESignStatus per
 * kit per run, and at most one downloadESignDocument per kit (inside
 * finalizeKitEsign's single existing download). Upper bound 26 and 26, per
 * Requirement 11 criterion 5. Both are counted through the injected client, so
 * the bound is observable rather than asserted.
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Pool, RowDataPacket } from "mysql2/promise";
// Type-only: the provider client is imported for its value only inside main(),
// so a test supplying a fake never pulls the real transport into the graph.
import type { luckpayClient } from "../src/modules/integrations/luckpay/luckpay.client.js";
import { finalizeKitEsign } from "../src/modules/employees/joiningKitDispatch.service.js";

// ── Data models ───────────────────────────────────────────────────────────────

export type KitClassification =
  | "closed"                               // R3.3, R3.4 — finalizeKitEsign ran
  | "left_untouched"                       // R3.5 — provider reports unsigned, zero writes
  | "already_closed"                       // R3.8 — no provider call
  | "unresolvable_no_provider_reference"   // R3.7 — no provider call, not an error
  | "error";                               // per-kit throw, message reported, run continues

export interface BackfillReportEntry {
  employee_code: string;
  dispatch_date: string;
  provider_reference: string | null;
  provider_status: string | null;          // null where no call was made
  classification: KitClassification;
  documents_closed: number;
  note: string;                            // carries completedAtSource, or the error message
}

export interface BackfillReport {
  entries: BackfillReportEntry[];          // exactly one per selected kit
  totals: Record<KitClassification, number>;
  providerCalls: { status: number; download: number };
}

/** Every classification, so the tally names a zero rather than omitting it. */
const CLASSIFICATIONS: readonly KitClassification[] = [
  "closed",
  "left_untouched",
  "already_closed",
  "unresolvable_no_provider_reference",
  "error",
] as const;

/**
 * A pollable provider reference. `fallback_internal_link` and `link_generated`
 * transactions carry no APIB… id, so there is nothing to ask the provider about
 * and no call is made for them — R3.7 classifies that, not errors it.
 */
const POLLABLE_PROVIDER_REFERENCE = /^APIB/;

// ── Selection ─────────────────────────────────────────────────────────────────

/**
 * Stranded_Kits, selected directly rather than through the worker's claimBatch.
 *
 * ORDER BY k.sent_at ASC puts MAS47814 (2026-08-01, the closest to its 30-day
 * Give_Up_Window) first, so a run interrupted part-way has resolved the most
 * urgent kits rather than an arbitrary subset.
 */
const SELECT_STRANDED_KITS = `
SELECT k.id AS kit_id, k.employee_id, k.status AS kit_status, k.sent_at,
       k.signed_file_id, e.employee_code,
       t.id AS tx_id, t.client_transaction_id, t.provider_reference_id, t.status AS tx_status
  FROM employee_joining_esign_kit k
  JOIN employees e ON e.id = k.employee_id
  LEFT JOIN employee_document_esign_transaction t
         ON t.kit_id = k.id AND t.provider = 'luckpay' AND t.scope = 'kit'
 WHERE k.status = 'sent'
   AND k.signed_file_id IS NULL
   AND k.sent_at >= '2026-08-01' AND k.sent_at < '2026-08-27'`;

type StrandedKitRow = {
  kit_id: string;
  employee_id: string;
  kit_status: string | null;
  sent_at: string | Date | null;
  signed_file_id: string | null;
  employee_code: string | null;
  tx_id: string | null;
  client_transaction_id: string | null;
  provider_reference_id: string | null;
  tx_status: string | null;
};

async function selectStrandedKits(db: Pool, kitIds?: string[]): Promise<StrandedKitRow[]> {
  const restrict = kitIds?.length
    ? ` AND k.id IN (${kitIds.map(() => "?").join(", ")})`
    : "";
  const [rows] = await db.execute<RowDataPacket[]>(
    `${SELECT_STRANDED_KITS}${restrict}\n ORDER BY k.sent_at ASC`,
    kitIds?.length ? kitIds : [],
  );
  return rows as unknown as StrandedKitRow[];
}

// ── Provider completion time ──────────────────────────────────────────────────

function readPath(source: unknown, dotted: string): unknown {
  let cursor: unknown = source;
  for (const segment of dotted.split(".")) {
    if (!cursor || typeof cursor !== "object") return undefined;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor;
}

/**
 * The provider's own completion time, or null when it reported none.
 *
 * LuckpayStatusResult carries no timestamp field — only `sanitized`, which is
 * the PII-masked response envelope — so the time has to be read out of the
 * payload by path. Both the envelope and its `data` member are searched for each
 * path in turn, the same two scopes pickLuckpayField consults, because the
 * provider nests differently across endpoints.
 *
 * Returning null is a real answer, not a failure: the caller records
 * completedAtSource=backfill_run_time rather than pretending a provider time.
 */
export function extractProviderCompletedAt(sanitized: unknown): Date | null {
  const paths = [
    "esignDetails.signed_at",
    "esignDetails.completed_at",
    "signedAt",
    "completedAt",
  ];
  for (const dotted of paths) {
    for (const scope of [sanitized, readPath(sanitized, "data")]) {
      const raw = readPath(scope, dotted);
      if (raw === null || raw === undefined || raw === "") continue;
      if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? null : raw;
      if (typeof raw !== "string" && typeof raw !== "number") continue;
      const parsed = new Date(raw);
      if (!Number.isNaN(parsed.getTime())) return parsed;
    }
  }
  return null;
}

// ── Audit (kits left untouched) ───────────────────────────────────────────────

/**
 * R12.4 — the absence of action is itself evidence.
 *
 * employee_joining_document_audit_log.employee_id is NOT NULL, and the selection
 * query always carries it, so this can never be attempted with a null. Written
 * through the injected pool rather than through joiningKitDispatch's private
 * audit helper, which is not exported.
 *
 * A failed audit write is reported in the entry's note and does not reclassify
 * the kit: nothing was wrong with the kit, and 'error' would say there was.
 */
async function auditExaminedUnsigned(
  db: Pool,
  row: StrandedKitRow,
  actorUserId: string,
  providerStatus: string | null,
  observedChecklist: unknown,
): Promise<string | null> {
  try {
    await db.execute(
      `INSERT INTO employee_joining_document_audit_log
         (id, employee_id, checklist_id, document_code, action_type,
          old_value, new_value, remarks, actor_user_id, actor_type)
       VALUES (?, ?, NULL, 'JOINING_KIT', 'ESIGN_BACKFILL_EXAMINED_UNSIGNED',
               CAST(? AS JSON), CAST(? AS JSON), ?, ?, 'system')`,
      [
        randomUUID(),
        row.employee_id,
        // The state found and deliberately left alone, so the remediation stays
        // reviewable against what it saw rather than against what it changed.
        JSON.stringify({ kit: { status: row.kit_status }, checklist: observedChecklist }),
        JSON.stringify({
          kitId: row.kit_id,
          examined: true,
          action: "none",
          providerStatus,
          providerReferenceId: row.provider_reference_id ?? null,
          backfillActorUserId: actorUserId,
        }),
        `Joining kit ${row.kit_id} examined by backfill and found not signed`,
        actorUserId,
      ],
    );
    return null;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.warn(`[backfill] audit row not written for kit ${row.kit_id}: ${message}`);
    return message;
  }
}

/** Read-only: the member rows' current state, for the audit row's old_value. */
async function observeChecklist(db: Pool, kitId: string): Promise<unknown> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT c.id, c.status, c.verification_status, c.due_at
       FROM employee_joining_esign_kit_item i
       JOIN employee_joining_document_checklist c ON c.id = i.checklist_id
      WHERE i.kit_id = ?`,
    [kitId],
  );
  return (rows as RowDataPacket[]).map((r) => ({
    id: String(r.id),
    status: r.status ?? null,
    verification_status: r.verification_status ?? null,
    due_at: r.due_at ?? null,
  }));
}

// ── The runner ────────────────────────────────────────────────────────────────

export async function runBackfill(deps: {
  client: Pick<typeof luckpayClient, "checkESignStatus" | "downloadESignDocument">;
  db: Pool;
  actorUserId: string;
  confirm: boolean;
  kitIds?: string[];
}): Promise<BackfillReport> {
  if (!deps.actorUserId?.trim()) {
    // Attribution is stated, never inferred (R12.1).
    throw new Error("runBackfill requires actorUserId");
  }

  const providerCalls = { status: 0, download: 0 };

  /**
   * Every provider call the run makes passes through here, including the
   * artefact download that happens inside finalizeKitEsign — which is why the
   * wrapper is threaded into its optional `client` parameter rather than left to
   * default to the real client. Without that, the download half of the bound
   * would be unmeasured.
   */
  const countingClient = {
    async checkESignStatus(ref: Parameters<typeof deps.client.checkESignStatus>[0]) {
      providerCalls.status += 1;
      return deps.client.checkESignStatus(ref);
    },
    async downloadESignDocument(ref: Parameters<typeof deps.client.downloadESignDocument>[0]) {
      providerCalls.download += 1;
      return deps.client.downloadESignDocument(ref);
    },
  };

  const rows = await selectStrandedKits(deps.db, deps.kitIds);
  const entries: BackfillReportEntry[] = [];

  for (const row of rows) {
    // One entry per selected kit, allocated before any branch runs, so no path
    // through the tree — including a throw — can drop a kit from the report.
    const entry: BackfillReportEntry = {
      employee_code: row.employee_code ?? "(unknown)",
      dispatch_date: formatDispatchDate(row.sent_at),
      provider_reference: row.provider_reference_id ?? null,
      provider_status: null,
      classification: "error",
      documents_closed: 0,
      note: "",
    };
    entries.push(entry);

    try {
      // Idempotence layer 1 — before any provider call, so a re-run costs
      // nothing. Re-read live rather than trusting the selection snapshot: 26
      // provider calls take time, and a concurrent worker completion (or an
      // earlier interrupted run) can close a kit while this one is mid-flight.
      const live = await readKitState(deps.db, row.kit_id);
      if (!live || live.status === "signed" || live.signed_file_id) {
        entry.classification = "already_closed";
        entry.note = live
          ? `kit already ${live.status ?? "closed"}${live.signed_file_id ? " with a signed artefact" : ""}; no provider call`
          : "kit row no longer present; no provider call";
        continue;
      }

      // R3.7 — nothing to poll with. Not an error, and no billed call.
      const providerReference = row.provider_reference_id?.trim() ?? "";
      if (!row.tx_id || !providerReference || !POLLABLE_PROVIDER_REFERENCE.test(providerReference)) {
        entry.classification = "unresolvable_no_provider_reference";
        entry.note = !row.tx_id
          ? "no kit-scope luckpay transaction row; no provider call"
          : `provider_reference_id ${providerReference ? `'${providerReference}'` : "NULL"} is not an APIB reference (tx status ${row.tx_status ?? "unknown"}); no provider call`;
        continue;
      }

      // The one billed status call for this kit. Issued in dry run too — how
      // many of the 26 the provider reports signed is the question a dry run
      // exists to answer.
      const status = await countingClient.checkESignStatus({
        clientTransactionId: row.client_transaction_id ?? "",
        transactionId: providerReference,
      });
      entry.provider_status = status.providerStatus ?? status.state;

      if (status.state !== "completed") {
        // R3.5 — zero writes to the kit, its checklist rows, its token and its
        // reminders. The only thing written is the evidence that it was looked
        // at, and in a dry run not even that.
        entry.classification = "left_untouched";
        if (!deps.confirm) {
          entry.note = "DRY RUN — unchanged; no audit row written";
          continue;
        }
        const observed = await observeChecklist(deps.db, row.kit_id);
        const auditError = await auditExaminedUnsigned(
          deps.db,
          row,
          deps.actorUserId,
          entry.provider_status,
          observed,
        );
        entry.note = auditError
          ? `unchanged; ESIGN_BACKFILL_EXAMINED_UNSIGNED audit row not written: ${auditError}`
          : "unchanged; examined and evidenced";
        continue;
      }

      // R12.3 — the provider's own completion time when it reported one. When it
      // did not, completedAt stays null, finalizeKitEsign's COALESCE(?, NOW())
      // uses the run time, and the note says so rather than disguising it.
      const providerCompletedAt = extractProviderCompletedAt(status.sanitized);
      const completedAtSource = providerCompletedAt ? "provider" : "backfill_run_time";

      if (!deps.confirm) {
        // Dry run reports the provider's verdict — what a confirmed run would
        // do — while documents_closed stays 0, because nothing was closed.
        entry.classification = "closed";
        entry.note = `DRY RUN — would close; completedAtSource=${completedAtSource}`;
        continue;
      }

      const result = await finalizeKitEsign({
        kitId: row.kit_id,
        transactionId: row.tx_id,
        clientTransactionId: row.client_transaction_id,
        providerReferenceId: providerReference,
        completedAt: providerCompletedAt,
        // Switches the verification audit row from ESIGN_VERIFICATION_AUTO to
        // ESIGN_VERIFICATION_BACKFILL and names the operator, so a bulk
        // remediation is distinguishable by value rather than by timestamp
        // (R12.1, R12.2). old_value there retains the pre-backfill status of the
        // kit and of every member checklist row (R12.5).
        backfill: { actorUserId: deps.actorUserId, providerReferenceId: providerReference },
        client: countingClient,
      });

      entry.classification = "closed";
      entry.documents_closed = result.documentsClosed;
      entry.note =
        `completedAtSource=${completedAtSource}` +
        (result.artefactRetrieved ? "" : "; signed artefact not retrieved") +
        (result.placementOk ? "" : "; signature placement outside reserved band");
    } catch (e) {
      // A single bad kit must not abandon the other 25 before the window closes.
      entry.classification = "error";
      entry.note = e instanceof Error ? e.message : String(e);
      console.warn(`[backfill] kit ${row.kit_id} failed: ${entry.note}`);
    }
  }

  const totals = Object.fromEntries(
    CLASSIFICATIONS.map((c) => [c, entries.filter((e) => e.classification === c).length]),
  ) as Record<KitClassification, number>;

  return { entries, totals, providerCalls };
}

async function readKitState(
  db: Pool,
  kitId: string,
): Promise<{ status: string | null; signed_file_id: string | null } | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT status, signed_file_id FROM employee_joining_esign_kit WHERE id = ? LIMIT 1`,
    [kitId],
  );
  const row = (rows as RowDataPacket[])[0];
  if (!row) return null;
  return {
    status: (row.status as string | null) ?? null,
    signed_file_id: (row.signed_file_id as string | null) ?? null,
  };
}

function formatDispatchDate(sentAt: string | Date | null): string {
  if (!sentAt) return "";
  // The pool runs with dateStrings: true, so this is normally already
  // 'YYYY-MM-DD HH:MM:SS'; a Date is handled for callers with other settings.
  if (sentAt instanceof Date) return sentAt.toISOString().slice(0, 10);
  return String(sentAt).slice(0, 10);
}

// ── Report ────────────────────────────────────────────────────────────────────

const COLUMNS = [
  "employee_code",
  "dispatch_date",
  "provider_reference",
  "provider_status",
  "classification",
  "documents_closed",
  "note",
] as const;

function cell(entry: BackfillReportEntry, column: (typeof COLUMNS)[number]): string {
  const value = entry[column];
  return value === null || value === undefined ? "" : String(value);
}

function csvField(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function toCsv(report: BackfillReport): string {
  return (
    [
      COLUMNS.join(","),
      ...report.entries.map((e) => COLUMNS.map((c) => csvField(cell(e, c))).join(",")),
    ].join("\n") + "\n"
  );
}

export function renderTable(report: BackfillReport): string {
  const rows = [COLUMNS as unknown as string[], ...report.entries.map((e) => COLUMNS.map((c) => cell(e, c)))];
  const widths = COLUMNS.map((_, i) => Math.max(...rows.map((r) => r[i].length)));
  const line = (r: string[]) => r.map((v, i) => v.padEnd(widths[i])).join("  ").trimEnd();
  return [
    line(rows[0]),
    widths.map((w) => "-".repeat(w)).join("  "),
    ...rows.slice(1).map(line),
  ].join("\n");
}

function printReport(report: BackfillReport, confirm: boolean, reportPath: string | null): void {
  console.log(`\nExamined ${report.entries.length} kit(s).\n`);
  if (report.entries.length) console.log(renderTable(report));

  console.log("\nTally by classification:");
  for (const c of CLASSIFICATIONS) {
    console.log(`  ${String(report.totals[c]).padStart(4)}  ${c}`);
  }
  console.log(
    `\nProvider calls: ${report.providerCalls.status} status, ${report.providerCalls.download} download` +
      ` (upper bound one status and one download per kit).`,
  );
  if (!confirm) {
    console.log("\nDRY RUN — nothing was written. Re-run with --confirm to act.");
  }

  if (reportPath) {
    const resolved = path.resolve(reportPath);
    mkdirSync(path.dirname(resolved), { recursive: true });
    writeFileSync(resolved, toCsv(report));
    console.log(`\nCSV written: ${resolved}`);
  }
}

// ── CLI ───────────────────────────────────────────────────────────────────────

export function parseArgs(argv: string[]): {
  actorUserId: string | null;
  kitIds: string[];
  reportPath: string | null;
  confirm: boolean;
} {
  const kitIds: string[] = [];
  let actorUserId: string | null = null;
  let reportPath: string | null = null;
  let confirm = false;

  for (let i = 0; i < argv.length; i += 1) {
    switch (argv[i]) {
      case "--actor-user-id":
        actorUserId = argv[++i] ?? null;
        break;
      case "--kit-id": {
        const id = argv[++i];
        if (id) kitIds.push(id);
        break;
      }
      case "--report":
        reportPath = argv[++i] ?? null;
        break;
      case "--confirm":
        confirm = true;
        break;
      default:
        break;
    }
  }
  return { actorUserId, kitIds, reportPath, confirm };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (!args.actorUserId?.trim()) {
    // Refuses to start rather than defaulting to 'system'. The operator behind a
    // bulk remediation has to be stated (R12.1).
    console.error(
      "Refusing to run without --actor-user-id.\n" +
        "  npm run backfill:stranded-kits -- --actor-user-id <ID> [--kit-id <ID>...] [--report <path.csv>] [--confirm]",
    );
    process.exit(1);
    return;
  }

  const { db } = await import("../src/db/mysql.js");
  const { luckpayClient } = await import("../src/modules/integrations/luckpay/luckpay.client.js");

  console.log(args.confirm ? "MODE: CONFIRMED (writes)" : "MODE: DRY RUN (status calls only, no writes)");
  console.log(`Actor: ${args.actorUserId}`);
  if (args.kitIds.length) console.log(`Restricted to ${args.kitIds.length} kit id(s).`);

  try {
    const report = await runBackfill({
      client: luckpayClient,
      // The db facade in src/db/mysql.ts wraps the mysql2 pool with retry and a
      // circuit breaker rather than extending it, so it is not structurally a
      // Pool. Only .execute() is used from it here, which the facade provides
      // with the same contract; the cast keeps the exported signature the one
      // the design states and the tests inject against.
      db: db as unknown as Pool,
      actorUserId: args.actorUserId.trim(),
      confirm: args.confirm,
      kitIds: args.kitIds.length ? args.kitIds : undefined,
    });
    printReport(report, args.confirm, args.reportPath);
    // A kit that threw is reported, not swallowed: the run continued past it, and
    // a non-zero exit is what tells the operator to read the error rows.
    if (report.totals.error > 0) process.exitCode = 1;
  } finally {
    await db.end().catch(() => undefined);
  }
}

// Only when run directly, so the module can be imported by tests without
// opening a pool or reading argv.
if (process.argv[1] && /backfill-stranded-joining-kits\.(ts|js)$/.test(process.argv[1])) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
