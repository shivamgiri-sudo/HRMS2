import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * A partially-completed provisioning task must stay completable.
 *
 * ADMIN_BIOMETRIC_ID_CARD is two independent sub-tasks. completeAdminProvisioningTask()
 * refuses the ID card with a 422 while the employee has no photo_url, so submitting the
 * biometric half and returning for the card once the photo is uploaded is the intended
 * working pattern — not a mistake. Nothing validated the admin form (unlike the IT and WFM
 * branches, which require their fields), so that half-submission was stamped 'actioned'.
 *
 * Two separate things then made it unfinishable:
 *
 *   1. NativeITProvisioningTracker rendered its action button only for status 'pending'.
 *      An actioned row offered Waive (wrong — the work was not waived) and Lock Now (worse
 *      — it freezes the evidence half-finished).
 *   2. POST /tasks/:id/complete skipped persistStructuredFields() once the row was
 *      'actioned', so even reaching the endpoint again synced master data while leaving the
 *      task row still reporting the card unprinted.
 *
 * Measured live 2026-08-26: 12 ADMIN_BIOMETRIC_ID_CARD requests actioned with
 * id_card_printed = 0, all 12 for employees with no photo_url, all actioned within three
 * minutes of each other. autoLockConfirmedRequests() locks an actioned row 48h after
 * actioned_at, so they had a two-day window before becoming permanently incomplete.
 *
 * Source-inspection rather than behavioural: this route's handler reaches dispatchTaskCompletion
 * and five master-data tables, and the repo has no harness that stands those up. Asserting on
 * the handler's own control flow is the strongest check available without inventing one.
 */

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const ROUTES = "src/modules/it-provisioning/it-provisioning.routes.ts";
// Resolved from the backend package root (vitest cwd), like the other suites here.
const TRACKER = "../src/pages/NativeITProvisioningTracker.tsx";

/** The body of the POST /tasks/:id/complete handler. */
function completeHandler(src: string): string {
  const start = src.indexOf("router.post('/tasks/:id/complete'");
  if (start === -1) return "";
  const next = src.indexOf("\nrouter.", start + 1);
  return src.slice(start, next === -1 ? src.length : next);
}

describe("a partially-completed provisioning task can be completed", () => {
  const src = read(ROUTES);
  const handler = completeHandler(src);

  it("has the handler this test is derived from", () => {
    expect(handler, "POST /tasks/:id/complete must exist").toBeTruthy();
    expect(handler).toContain("dispatchTaskCompletion");
  });

  it("persists structured fields unconditionally, not only on first submission", () => {
    const persistAt = handler.indexOf("persistStructuredFields(taskId, body)");
    expect(persistAt, "persistStructuredFields must still be called").toBeGreaterThan(-1);

    const guardAt = handler.indexOf("if (!alreadyActioned)");
    expect(guardAt, "the alreadyActioned guard must still exist for the state transition").toBeGreaterThan(-1);

    expect(
      persistAt,
      "persistStructuredFields must run BEFORE the !alreadyActioned guard. Inside it, a " +
        "second submission syncs master data while the task row keeps reporting the work " +
        "undone — which is how 12 admin requests ended up actioned with id_card_printed = 0.",
    ).toBeLessThan(guardAt);
  });

  it("still guards the state transition so a re-submit does not restart the auto-lock clock", () => {
    const guarded = handler.slice(handler.indexOf("if (!alreadyActioned)"));
    expect(
      guarded,
      "actionProvisioningRequest must stay inside the !alreadyActioned guard: re-stamping " +
        "actioned_at restarts the 48h autoLockConfirmedRequests window and re-fires the " +
        "completion notification for work already reported.",
    ).toContain("actionProvisioningRequest");
  });

  it("refuses a locked task before dispatching any master-data write", () => {
    const lockAt = handler.indexOf("taskRow.locked");
    const dispatchAt = handler.indexOf("await dispatchTaskCompletion");
    expect(lockAt, "the handler must check the locked flag").toBeGreaterThan(-1);
    expect(
      lockAt,
      "the lock check must precede dispatchTaskCompletion. Neither that function nor any of " +
        "its handlers looks at `locked` — they write biometric enrolments, ID card documents, " +
        "employees.official_email and auth_user rows regardless — so this is the only thing " +
        "making locked evidence immutable over the API.",
    ).toBeLessThan(dispatchAt);
    expect(handler).toContain("statusCode: 403");
  });

  it("reads the task row before dispatching, so status is pre-dispatch state", () => {
    const selectAt = handler.indexOf("SELECT task_code, status, locked");
    const dispatchAt = handler.indexOf("await dispatchTaskCompletion");
    expect(selectAt).toBeGreaterThan(-1);
    expect(
      selectAt,
      "reading status AFTER dispatch would observe the status dispatch itself just set, so " +
        "alreadyActioned would be true on the very first submission and the request would " +
        "never transition.",
    ).toBeLessThan(dispatchAt);
  });
});

describe("the provisioning queue offers a way back into an actioned request", () => {
  const tracker = read(TRACKER);

  it("renders the action button for actioned rows, not only pending ones", () => {
    /*
     * Anchored on the openDialog(req, "action") call rather than on the gate text, because
     * the Waive button sitting directly below carries a byte-identical
     * `(req.status === "pending" || req.status === "actioned")` gate. A regex for that gate
     * matches Waive and passes even when the action button is back to pending-only —
     * verified by mutation, which is how this assertion was caught being useless.
     */
    const actionAt = tracker.indexOf('openDialog(req, "action")');
    expect(actionAt, 'the action button must still call openDialog(req, "action")').toBeGreaterThan(-1);
    const gate = tracker.slice(Math.max(0, actionAt - 400), actionAt);
    expect(
      gate,
      'The action button was gated on status === "pending" alone, which left an actioned but ' +
        "half-finished request with only Waive and Lock Now — neither of which completes it.",
    ).toContain('req.status === "actioned"');
  });

  it("labels the re-entry action as an update rather than a fresh completion", () => {
    expect(tracker).toContain('"Update Details"');
  });

  it("keeps every completion action hidden once the row is locked, offering only Reopen", () => {
    // The lock branch must still short-circuit the whole action cell — the only
    // way back in is the audited Reopen action (see reopen-locked-request.contract.test.ts),
    // not a plain completion/waive/lock button reappearing.
    expect(tracker).toMatch(/req\.locked \?/);
    expect(tracker).toContain("Evidence locked");
  });

  it("names what is still outstanding on a half-finished admin task", () => {
    // "Actioned" reads identically for a finished and an unfinished admin task, and the
    // stats tile counts both as completed.
    expect(tracker).toContain("still pending");
    expect(tracker).toContain("ADMIN_BIOMETRIC_ID_CARD");
  });
});
