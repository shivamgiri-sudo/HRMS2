/**
 * The polling budget and the kit-scope delegation, pinned against source text.
 *
 * Two separate things are guarded here, both of which are invisible to the type
 * checker and both of which cost real money or real correctness when they drift.
 *
 * 1. THE BUDGET. checkESignStatus and downloadESignDocument may each be billed
 *    per call, so the backoff ladder, the tick interval, the batch size and the
 *    give-up window are the contract with the Luckpay bill — not tuning knobs.
 *    Requirement 1 criterion 2 says the worker follows the ladder "as already
 *    implemented, without altering the interval sequence, TICK_MS, BATCH_SIZE or
 *    GIVE_UP_AFTER_DAYS", and Requirement 11 criterion 2 caps a tick at
 *    BATCH_SIZE transactions at the existing TICK_MS. Widening any of these
 *    widens the invoice, which is why each failure message says so.
 *
 * 2. THE KIT DELEGATION. Requirement 1 criterion 3 is satisfied entirely by
 *    existing, unchanged code in luckpay-status.service.ts: a signed transaction
 *    whose scope is 'kit' is handed to finalizeKitEsign, which closes ALL six
 *    member checklists under the one signature. That branch has to be reached
 *    BEFORE the inline per-document download block. If the document branch ran
 *    first, a kit transaction would close only its anchor checklist and leave the
 *    other five members open — the perpetually-open kit with reminders firing
 *    indefinitely that the branch exists to prevent. Nothing else in the suite
 *    covers this, so a refactor that reorders the two blocks would land silently.
 *
 * Source-reading rather than behavioural: there is no harness that drives a real
 * provider response through to a live database, and the constants are module-private
 * (not exported), so their values are only observable in the text.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const read = (p: string) => fs.readFileSync(path.resolve(__dirname, p), "utf8");

const WORKER_PATH = "../esign-reconciliation.worker.ts";
const STATUS_SERVICE_PATH =
  "../../modules/integrations/luckpay/luckpay-status.service.ts";

const worker = read(WORKER_PATH);
const statusService = read(STATUS_SERVICE_PATH);

/** Comments name these constants too, so assertions run against code only. */
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const workerCode = stripComments(worker);
const statusCode = stripComments(statusService);

function constantExpression(src: string, name: string): string {
  const m = src.match(new RegExp(`const ${name}\\s*=\\s*([^;]+);`));
  expect(m, `${name} is not declared in esign-reconciliation.worker.ts`).not.toBeNull();
  return m![1].trim();
}

describe("esign reconciliation polling budget (R1.2, R11.2)", () => {
  it("keeps the backoff ladder at [2, 10, 30, 60, 60, 60] minutes", () => {
    // Revised 2026-09-04, deliberately, after the ORIGINAL ladder's 1440-minute
    // (24h) tail cost a real signature going unnoticed for hours: MAS63438's
    // joining-kit Aadhaar eSign completed on Luckpay's side while her transaction
    // was already on that tail, and the tracker read "0 of 9 signed" until a
    // human forced a manual check. The early steps this governs most — 2, 10, 30
    // minutes, where a transaction is plausibly still mid-signature — are
    // UNCHANGED; only the tail a long-pending transaction settles into is
    // shortened, from once a day to once an hour. Still a governed constant: any
    // further change to the ladder, TICK_MS, BATCH_SIZE or GIVE_UP_AFTER_DAYS
    // widens the Luckpay bill and belongs in this same conversation, not a
    // silent edit.
    const expr = constantExpression(workerCode, "BACKOFF_MINUTES");
    const ladder = JSON.parse(expr) as number[];
    expect(
      ladder,
      "BACKOFF_MINUTES is the agreed polling schedule. Shortening any step below " +
        "the value pinned here, or adding a step, means more billed " +
        "checkESignStatus calls per transaction and a bigger Luckpay bill.",
    ).toEqual([2, 10, 30, 60, 60, 60]);
  });

  it("keeps TICK_MS at 5 minutes", () => {
    const expr = constantExpression(workerCode, "TICK_MS");
    // Evaluated rather than string-matched so `5 * 60 * 1000` and `300000` both pass:
    // what is being pinned is the interval, not how it is spelled.
    const value = Number(new Function(`return (${expr});`)());
    expect(
      value,
      "TICK_MS is how often a batch of up to BATCH_SIZE transactions is polled. " +
        "Lowering it multiplies billed provider calls per hour — R11.2 caps a tick " +
        "at BATCH_SIZE transactions at THIS interval, so the two only bound spend together.",
    ).toBe(5 * 60 * 1000);
  });

  it("keeps BATCH_SIZE at 25", () => {
    const value = Number(new Function(`return (${constantExpression(workerCode, "BATCH_SIZE")});`)());
    expect(
      value,
      "BATCH_SIZE is the per-tick ceiling on billed calls: every row claimBatch " +
        "returns reaches the provider. Raising it raises the maximum spend per tick " +
        "directly, one billed checkESignStatus per extra row (R11.2).",
    ).toBe(25);
  });

  it("keeps GIVE_UP_AFTER_DAYS at 30", () => {
    const value = Number(
      new Function(`return (${constantExpression(workerCode, "GIVE_UP_AFTER_DAYS")});`)(),
    );
    expect(
      value,
      "GIVE_UP_AFTER_DAYS is when the worker stops chasing a transaction the provider " +
        "never completed. Widening it keeps dead transactions on the ladder, paying " +
        "1440-minute polls forever for a signature that is never coming.",
    ).toBe(30);
  });

  it("the tick log line reports the enabled state from the env flag", () => {
    // Deliberately not asserting a literal `enabled=true`: runEsignReconciliationOnce
    // is callable with the flag off (the backfill runner and tests do exactly that),
    // so reading env is the honest form. R1.5 asks for the enabled state, not a constant.
    const logMatch = workerCode.match(/\[esign-reconciliation\] enabled=\$\{([^}]+)\}/);
    expect(
      logMatch,
      "the tick log line must interpolate the enabled state rather than hard-code it",
    ).not.toBeNull();
    expect(logMatch![1]).toContain("ESIGN_RECONCILIATION_ENABLED");
  });
});

describe("claimBatch selection predicate (R11.2)", () => {
  const claimBatch = (() => {
    const start = workerCode.indexOf("async function claimBatch(");
    expect(start, "claimBatch is not declared in esign-reconciliation.worker.ts").toBeGreaterThan(-1);
    const next = workerCode.indexOf("\nasync function ", start + 1);
    const alt = workerCode.indexOf("\n/** Push a transaction", start + 1);
    const end = [next, alt].filter((i) => i > -1).sort((a, b) => a - b)[0] ?? workerCode.length;
    return workerCode.slice(start, end);
  })();

  it("still tolerates next_poll_at IS NULL", () => {
    expect(
      claimBatch.replace(/\s+/g, " "),
      "a freshly created transaction has no schedule yet, so next_poll_at is NULL. " +
        "Without this tolerance the currently-pending production transactions would " +
        "never be selected at all and the worker would poll nothing.",
    ).toContain("next_poll_at IS NULL OR next_poll_at <= NOW()");
  });

  it("still requires provider_reference_id IS NOT NULL", () => {
    expect(
      claimBatch.replace(/\s+/g, " "),
      "a transaction with no provider_reference_id cannot be polled — syncEsignStatus " +
        "bails on it immediately. Selecting it would burn a billed provider call to " +
        "learn nothing (R11.2).",
    ).toContain("provider_reference_id IS NOT NULL");
  });
});

describe("kit-scope completion delegates before the per-document download (R1.3)", () => {
  const kitBranchAt = statusCode.search(/String\(row\.scope \?\? "document"\) === "kit"/);
  const finalizeAt = statusCode.indexOf("finalizeKitEsign(");
  const downloadAt = statusCode.indexOf("downloadESignDocument(");

  it("a scope === 'kit' branch exists and delegates to finalizeKitEsign", () => {
    expect(kitBranchAt, "the scope === 'kit' branch is gone from luckpay-status.service.ts").toBeGreaterThan(-1);
    expect(finalizeAt, "nothing calls finalizeKitEsign").toBeGreaterThan(-1);
    expect(finalizeAt).toBeGreaterThan(kitBranchAt);
  });

  it("the inline per-document downloadESignDocument block still exists", () => {
    expect(downloadAt, "the per-document download block is gone").toBeGreaterThan(-1);
  });

  it("the kit delegation appears BEFORE the per-document download", () => {
    expect(
      finalizeAt,
      "the per-document downloadESignDocument block is reached before the scope === 'kit' " +
        "delegation. A kit transaction would then close only its anchor checklist and leave " +
        "the other five members of the kit open — the kit stays perpetually open and its " +
        "reminders keep firing. The kit branch must return first (R1.3).",
    ).toBeLessThan(downloadAt);
  });

  it("the kit branch returns rather than falling through into the download", () => {
    const branch = statusCode.slice(kitBranchAt, downloadAt);
    expect(
      branch,
      "the kit branch must return its completed outcome; falling through would also run " +
        "the per-document download and double-bill the provider for one signature (R11.3).",
    ).toMatch(/return \{[^}]*state: "completed"/);
  });
});
