/**
 * Every leave policy refusal must carry an HTTP status.
 *
 * middleware/errorHandler.ts masks any Error that reaches it WITHOUT a statusCode as
 * "An unexpected server error occurred. Please quote reference <hex> if you contact HR."
 * So a refusal thrown as a bare `new Error(...)` — "you already have a request for those
 * dates", "monthly leave limit reached", "insufficient leave balance" — reached the
 * employee (and the approver) as a server crash with a reference number, hiding the one
 * sentence that told them what to do. Reported live on 2026-09-08: an employee re-applied
 * for a date she already had pending and got reference d8efc9ae instead of "a leave request
 * already exists for 2026-09-10".
 *
 * Source-level rather than behavioural because these throws sit deep inside submitRequest /
 * reviewRequest behind a MySQL named lock and a transaction; the invariant that matters is
 * simply that none of them is ever written bare again.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const SERVICE = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "leave.service.ts"),
  "utf8",
);

/** A distinctive fragment of each refusal, and the status it must be thrown with. */
const REFUSALS: Array<{ fragment: string; status: number }> = [
  { fragment: "This leave type is not available for your profile", status: 400 },
  { fragment: "can only be applied for up to 2 continuous days", status: 400 },
  { fragment: "Monthly leave limit reached for", status: 400 },
  { fragment: "Earned Leave cannot exceed", status: 400 },
  { fragment: "Only one EL application per calendar month is allowed", status: 400 },
  { fragment: "Another leave submission for this employee is already in progress", status: 409 },
  { fragment: "A leave request already exists for one or more dates in the range", status: 409 },
  { fragment: "already has an approved leave request overlapping", status: 409 },
  { fragment: "would exceed the annual limit of", status: 400 },
  { fragment: "Insufficient leave balance for", status: 400 },
  // Deliberately includes the clause after the comma: the phrase alone also appears in the
  // explanatory comment above the guard, which carries no statusCode of its own.
  { fragment: "have not been opened yet, so this request cannot", status: 400 },
];

describe("leave policy refusals carry an HTTP status", () => {
  for (const { fragment, status } of REFUSALS) {
    it(`"${fragment}" is thrown with ${status}`, () => {
      const at = SERVICE.indexOf(fragment);
      expect(at, `refusal message not found in leave.service.ts: ${fragment}`).toBeGreaterThan(-1);

      // The message and its `{ statusCode: N }` are part of one Object.assign call, so the
      // status always lands within a few lines of the message it belongs to. Ten lines is
      // wide enough for the longest of these (a three-line template) and far too narrow to
      // accidentally match a neighbouring throw.
      const window = SERVICE.slice(at, at + 600).split("\n").slice(0, 10).join("\n");
      expect(window, `refusal is thrown without a statusCode: ${fragment}`).toMatch(
        new RegExp(`statusCode:\\s*${status}`),
      );
    });
  }

  it("no bare `throw new Error(` remains in the submit or approve policy blocks", () => {
    const submitAt = SERVICE.indexOf("async submitRequest(");
    const getRequestAt = SERVICE.indexOf("async getRequest(");
    expect(submitAt).toBeGreaterThan(-1);
    expect(getRequestAt).toBeGreaterThan(submitAt);

    const submitBody = SERVICE.slice(submitAt, getRequestAt);
    expect(submitBody).not.toMatch(/throw new Error\(/);
  });
});
