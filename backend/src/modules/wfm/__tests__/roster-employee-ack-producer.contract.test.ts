import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Rule 10 — the roster acknowledgement chain had no entry point.
 *
 * Everything downstream was already built: GET /my-weekoff, the acknowledge and reject
 * handlers, the manager review queue with realign / force-approve / escalate /
 * reject-request, publish-final, and the RTA feed. Every one of them was unreachable.
 *
 * Verified live 2026-08-16 against mas_hrms:
 *   - wfm_roster_assignment.final_roster_status is an 11-value enum
 *   - only FOUR values had any writer anywhere in the backend:
 *     force_approved_by_manager, escalated_to_hr, manager_rejected_employee_request,
 *     published_to_rta
 *   - all 413,386 assignments sat in 'generated'
 *   - acknowledged = 0, pending_employee_ack = 0, rejected_by_employee = 0
 *
 * Nothing wrote 'pending_employee_ack', so no employee could ever be asked to acknowledge a
 * roster, and publish-final — which requires approved_final / force_approved_by_manager /
 * realigned_by_manager / acknowledged — could only ever match rows a manager had manually
 * force-approved. published_to_rta was 0: nothing had ever been published.
 *
 * Owner decision (Rule 10 option A): acknowledgement is requested at publish, for the whole
 * cycle at once.
 *
 * Source-text assertions, matching the convention this repo uses for the large inline Express
 * handlers in wfm.routes.ts. Every statement asserted here was separately validated by PREPARE
 * against the production schema before shipping.
 */
const SRC = readFileSync(resolve(__dirname, "../wfm.routes.ts"), "utf8");

describe("the producer for pending_employee_ack exists", () => {
  it("publishes a cycle's assignments into pending_employee_ack", () => {
    expect(SRC).toMatch(/roster\/publish-to-employees/);
    expect(SRC).toMatch(/SET final_roster_status = 'pending_employee_ack'/);
  });

  it("moves only 'generated' rows, so re-publishing cannot discard an answer already given", () => {
    // Without this an employee who had acknowledged, or a rejection already sitting in the
    // manager queue, would be dragged back to pending on the next publish.
    const publishBlock = SRC.slice(SRC.indexOf("publish-to-employees"));
    expect(publishBlock).toMatch(/WHERE cycle_id = \?\s*\n\s*AND final_roster_status = 'generated'/);
  });

  it("runs the whole publish in one transaction and releases the connection", () => {
    const block = SRC.slice(SRC.indexOf("publish-to-employees"), SRC.indexOf("FINAL ROSTER PUBLISH"));
    expect(block).toMatch(/beginTransaction/);
    expect(block).toMatch(/FOR UPDATE/);
    expect(block).toMatch(/rollback/);
    expect(block).toMatch(/conn\.release\(\)/);
  });

  it("raises a work-inbox item per employee, not per assignment", () => {
    // A week is seven rows per person; an inbox listing them separately is one nobody reads.
    expect(SRC).toMatch(/ROSTER_ACK_PENDING/);
    expect(SRC).toMatch(/SELECT DISTINCT employee_id FROM wfm_roster_assignment/);
  });

  it("does not stack duplicate inbox items when a cycle is re-published", () => {
    expect(SRC).toMatch(/NOT EXISTS \(\s*\n?\s*SELECT 1 FROM work_inbox_item w/);
  });

  it("only notifies employees who actually have a login", () => {
    // employees.user_id is not guaranteed to reference a live auth_user row — 51 active
    // employees carry a dangling one. A work item addressed to a ghost id is invisible.
    expect(SRC).toMatch(/JOIN auth_user au ON au\.id = e\.user_id/);
  });
});

describe("the employee's answer cannot overwrite a decision already taken", () => {
  it("acknowledge is guarded on pending_employee_ack", () => {
    expect(SRC).toMatch(
      /SET employee_ack_status = 'acknowledged'[\s\S]{0,220}AND final_roster_status = 'pending_employee_ack'/
    );
  });

  it("reject is guarded on pending_employee_ack", () => {
    expect(SRC).toMatch(
      /SET employee_ack_status = 'rejected'[\s\S]{0,260}AND final_roster_status = 'pending_employee_ack'/
    );
  });

  it("both refuse with 409 rather than reporting a success that did not happen", () => {
    expect(SRC).toMatch(/ackResult\.affectedRows !== 1/);
    expect(SRC).toMatch(/rejectResult\.affectedRows !== 1/);
    expect(SRC).toMatch(/no longer awaiting your acknowledgement/);
  });

  it("a rejection lands in the manager queue's own status", () => {
    // GET /manager/weekoff-review is what lists these; the value must match.
    expect(SRC).toMatch(/final_roster_status = 'pending_manager_action'/);
  });
});

describe("the inbox item closes only when the employee has nothing left to answer", () => {
  it("is not cleared by the first of seven days being acknowledged", () => {
    const helper = SRC.slice(SRC.indexOf("async function closeRosterAckInboxItem"));
    expect(helper).toMatch(/NOT EXISTS/);
    expect(helper).toMatch(/a\.final_roster_status = 'pending_employee_ack'/);
  });
});
