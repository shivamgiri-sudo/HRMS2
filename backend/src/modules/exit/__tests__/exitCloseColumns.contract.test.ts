import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

/**
 * Closing an exit request has never worked.
 *
 * POST /:exitId/close set closed_at and closed_by. exit_request has neither -
 * it records closure through status alone, and tracks its other terminal
 * transitions with revoked_at/revoked_by/revoke_reason and exit_confirmed_at.
 * So the UPDATE raised ER_BAD_FIELD_ERROR, the endpoint returned 500, and the
 * request stayed in whatever state it was already in. Verified against a
 * temporary copy of the real table: the original statement fails, the corrected
 * one is accepted.
 *
 * Dropping the two columns loses nothing. logExitStatusChange runs on the next
 * line and writes the actor and NOW() into exit_approval_log, which is the same
 * audit every other transition on this router uses.
 */
const ROUTES = path.resolve(__dirname, "../resignation.routes.ts");

const liveCode = () =>
  fs
    .readFileSync(ROUTES, "utf8")
    .split("\n")
    .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"))
    .join("\n");

describe("exit request closure", () => {
  it("does not write columns exit_request lacks", () => {
    const code = liveCode();
    expect(code).not.toMatch(/closed_at\s*=/);
    expect(code).not.toMatch(/closed_by\s*=/);
  });

  it("still marks the request closed", () => {
    expect(liveCode()).toMatch(/SET\s+status\s*=\s*'closed'/);
  });

  it("still records who closed it, through the approval log", () => {
    // the actor and timestamp live in exit_approval_log, not on exit_request
    const code = liveCode();
    const close = code.slice(code.indexOf('"/:exitId/close"'));
    expect(close.slice(0, 1200)).toContain("logExitStatusChange");
  });
});
