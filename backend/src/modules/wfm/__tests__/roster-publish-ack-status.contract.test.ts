/**
 * Guards the roster publish -> acknowledge loop against the defect that kept it dead.
 *
 * POST /api/wfm/roster/publish-to-employees moved assignments to 'pending_employee_ack' while
 * setting `employee_ack_status = NULL`. That column is NOT NULL —
 * enum('pending','acknowledged','rejected') DEFAULT 'pending' — so the statement threw
 * "Column 'employee_ack_status' cannot be null" on every call and the whole transaction rolled
 * back. Publishing a roster was impossible, which is why all 5 weekly_roster_cycle rows sat at
 * 'draft' and 0 of 413,386 assignments carried an acknowledgement.
 *
 * It was invisible for two reasons: the throw carries no statusCode, so production replaced the
 * message and returned an empty 500 body, and nothing in the suite exercised the route.
 *
 * Asserted against source text on purpose. The failure is a database constraint violation, so a
 * mocked-db unit test cannot reproduce it — backend/tests/setup.ts mocks src/db/mysql.js
 * globally, and a mock happily accepts NULL. Only the real schema rejects it. Verified against
 * production 2026-08-20: before the fix the route returned 500 and moved 0 rows; after it,
 * 7 assignments published and 1 employee notified, with a re-publish correctly moving 0.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SOURCE = readFileSync(resolve(__dirname, "../wfm.routes.ts"), "utf8");

/** The publish route's assignment UPDATE, isolated from the rest of the file. */
function publishUpdateStatement(): string {
  const start = SOURCE.indexOf("SET final_roster_status = 'pending_employee_ack'");
  expect(start, "publish route's UPDATE not found — was it renamed or removed?").toBeGreaterThan(-1);
  return SOURCE.slice(start, start + 400);
}

describe("roster publish — employee_ack_status must never be set to NULL", () => {
  it("assigns 'pending' rather than NULL", () => {
    const stmt = publishUpdateStatement();
    expect(stmt).toMatch(/employee_ack_status\s*=\s*'pending'/);
  });

  it("does not contain employee_ack_status = NULL", () => {
    const stmt = publishUpdateStatement();
    expect(
      /employee_ack_status\s*=\s*NULL/i.test(stmt),
      "employee_ack_status is NOT NULL in the live schema; setting it to NULL makes every publish throw",
    ).toBe(false);
  });

  it("still clears the genuinely nullable acknowledgement fields", () => {
    // These two ARE nullable and SHOULD be reset, so a re-published week does not carry a
    // previous answer forward. Only employee_ack_status was the mistake.
    const stmt = publishUpdateStatement();
    expect(stmt).toMatch(/employee_ack_at\s*=\s*NULL/);
    expect(stmt).toMatch(/employee_rejection_reason\s*=\s*NULL/);
  });

  it("only moves rows that are still 'generated'", () => {
    // What makes re-publishing safe: an assignment someone already acknowledged is not dragged
    // back into pending.
    const stmt = publishUpdateStatement();
    expect(stmt).toMatch(/final_roster_status\s*=\s*'generated'/);
  });
});
