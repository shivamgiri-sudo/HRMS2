import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

/**
 * This exact protection has been silently dropped from bulk-upload.routes.ts THREE times
 * in one day (2026-09-09) by unrelated "Add <new source> bulk-upload" commits — each one
 * built its full-file diff from a local copy that predated this fix, so pushing it
 * overwrote the file back to a pre-fix version while still correctly adding whatever new
 * import type it intended to add. Twice the fix came back with its full hardening intact
 * (a second engineer/session independently re-noticed and restored it); there is no reason
 * to expect a fourth stale-based commit won't happen again, since the root cause is a
 * workflow habit elsewhere, not something a one-off restore can prevent.
 *
 * This is a real production incident, not a hypothetical: it directly caused two data-loss
 * events — BATCH-1788948395588-R6909's 14 resubmitted roster rows, and 6 Onfido DOC_RAW
 * files (~137k rows) — both silently staged as zero rows despite their batch header
 * claiming otherwise, because the retry that would have absorbed a lock conflict on the
 * staging INSERT simply wasn't there to run.
 *
 * A source-text contract test is the right tool here specifically because the failure mode
 * is "the code compiles and every existing test still passes, the protection is just gone" —
 * a stale-graft revert doesn't break syntax or change behavior for the tests that already
 * exist, it just quietly deletes a code path nothing else asserts on. This test exists
 * purely to make that deletion loud (a failing test in CI/pre-push) instead of silent.
 */
const routes = fs.readFileSync(
  path.resolve(__dirname, "..", "bulk-upload.routes.ts"),
  "utf8",
);

describe("bulk-upload row/batch staging keeps its deadlock-retry protection", () => {
  it("imports withDeadlockRetry", () => {
    expect(routes).toMatch(/import\s*\{\s*withDeadlockRetry\s*\}\s*from\s*["']\.\.\/\.\.\/shared\/deadlockRetry\.js["']/);
  });

  it("wraps the /batches header INSERT in withDeadlockRetry", () => {
    const routeMatch = /router\.post\(\s*"\/batches",/.exec(routes);
    expect(routeMatch, '"/batches" route not found').not.toBeNull();
    const routeAt = routeMatch!.index;
    const insertAt = routes.indexOf("INSERT INTO upload_batch (", routeAt);
    expect(insertAt, "batch header INSERT not found").toBeGreaterThan(-1);
    // withDeadlockRetry must appear BETWEEN the route start and the INSERT — i.e. it wraps
    // the call, rather than merely existing somewhere else in the file.
    const between = routes.slice(routeAt, insertAt);
    expect(between).toMatch(/withDeadlockRetry\(/);
  });

  it("wraps the /batches/:id/rows staging INSERT in withDeadlockRetry, with a longer backoff than the shared default", () => {
    const routeMatch = /router\.post\(\s*"\/batches\/:id\/rows",/.exec(routes);
    expect(routeMatch, '"/batches/:id/rows" route not found').not.toBeNull();
    const routeAt = routeMatch!.index;
    const insertAt = routes.indexOf("INSERT INTO upload_batch_row (", routeAt);
    expect(insertAt, "row-staging INSERT not found").toBeGreaterThan(-1);
    const between = routes.slice(routeAt, insertAt);
    expect(between).toMatch(/withDeadlockRetry\(/);
    // The retry call's options (attempts/delayMs) sit shortly after the INSERT text —
    // `withDeadlockRetry(() => db.execute(\`INSERT...\`, values), { attempts, delayMs })`.
    // Require a longer backoff than the shared 100ms default so this specific call site
    // can't quietly regress back to a backoff too short for a real lock-wait-timeout.
    const afterInsert = routes.slice(insertAt, insertAt + 600);
    expect(afterInsert, "row-staging retry must specify attempts/delayMs longer than the shared default")
      .toMatch(/delayMs:\s*[2-9]\d{2,}/);
  });

  it("refuses to run Import on a batch that claims rows but has none actually staged", () => {
    expect(routes).toMatch(/validRows > 0 && stagedCount === 0/);
    expect(routes).toMatch(/validation_failed/);
  });
});
