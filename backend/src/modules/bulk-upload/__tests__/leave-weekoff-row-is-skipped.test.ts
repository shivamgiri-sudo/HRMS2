/**
 * A leave row whose every date is a week-off or holiday is SKIPPED, not failed.
 *
 * WHAT WAS WRONG. MAS50174's file had a row for 2026-08-23 – a Sunday, and his roster week-off.
 * The upload reported it as an error: "there are no working days to charge leave against." His
 * surrounding leave (20–22, 24–26 Aug) applied fine, so nothing was actually lost — but a 29-row
 * file reporting 28 errors, most of them Sundays, reads as a broken upload, and the operator has
 * no way to tell the Sundays apart from the rows that genuinely could not be applied.
 *
 * The distinction that matters: every other refusal in leave.service means "this request is not
 * allowed" (monthly cap, one EL per month, overlapping dates). This one means "there is nothing
 * to charge". Creating the request would deduct entitlement for a day nobody was rostered to
 * work; failing the row misreports a correct file. Neither is right — the row is a no-op.
 *
 * A person submitting ONE request still gets the error: they picked a date and deserve to be
 * told it needs no leave. Only the bulk path skips.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi, beforeEach } from "vitest";

const execute = vi.fn();
vi.mock("../../../db/mysql.js", () => ({ db: { execute: (...a: unknown[]) => execute(...a) } }));
vi.mock("../lock-retry.js", () => ({ withBulkLockRetry: (fn: () => Promise<unknown>) => fn() }));

const { markRowSkipped, markRowFailed } = await import("../bulk-approval.service.js");

const DIR = path.dirname(fileURLToPath(import.meta.url));
const approvalSrc = fs.readFileSync(path.resolve(DIR, "..", "bulk-approval.service.ts"), "utf8");
const leaveBulkSrc = fs.readFileSync(path.resolve(DIR, "..", "leave-application-bulk.service.ts"), "utf8");
const leaveSrc = fs.readFileSync(path.resolve(DIR, "../../leave/leave.service.ts"), "utf8");

beforeEach(() => execute.mockReset());

describe("the row is marked skipped, not error", () => {
  it("writes row_status 'skipped'", async () => {
    execute.mockResolvedValueOnce([{ affectedRows: 1 }]);
    await markRowSkipped("row-1", "every date is a week off");
    expect(String(execute.mock.calls[0][0])).toContain("row_status = 'skipped'");
  });

  it("still records why, so a skipped row can be explained", async () => {
    // Silently vanishing is its own problem — the operator must be able to see what happened
    // to a row that produced nothing.
    execute.mockResolvedValueOnce([{ affectedRows: 1 }]);
    await markRowSkipped("row-1", "every date is a week off");
    expect(String(execute.mock.calls[0][1]?.[0] ?? "")).toContain("week off");
  });

  it("leaves markRowFailed alone for everything else", async () => {
    execute.mockResolvedValueOnce([{ affectedRows: 1 }]);
    await markRowFailed("row-2", "Monthly leave limit reached");
    expect(String(execute.mock.calls[0][0])).toContain("row_status = 'error'");
  });
});

describe("the new status survives reconciliation", () => {
  it("is not force-converted back to error", () => {
    /*
     * reconcileStuckRows sweeps any row NOT in a known terminal state into 'error' before the
     * batch is shown for decision. Without 'skipped' in that list every skipped row would be
     * flipped straight back to an error and the fix would do nothing at all.
     */
    expect(approvalSrc).toContain("row_status NOT IN ('imported', 'error', 'discarded', 'skipped')");
  });

  it("is counted separately rather than folded into the error tally", () => {
    expect(approvalSrc).toContain("SUM(row_status = 'skipped')");
    expect(approvalSrc).toMatch(/skippedRows: Number\(c\.skipped \?\? 0\)/);
  });
});

describe("only this one condition is skipped", () => {
  it("is recognised by a code, not by matching the message text", () => {
    // Message matching would silently stop working the first time someone reworded the error,
    // and would catch any future message that happened to share a phrase.
    expect(leaveSrc).toContain('export const NO_CHARGEABLE_DAYS = "NO_CHARGEABLE_DAYS"');
    expect(leaveSrc).toMatch(/\{ code: NO_CHARGEABLE_DAYS \}/);
    expect(leaveBulkSrc).toMatch(/\(err as \{ code\?: string \}\)\?\.code === NO_CHARGEABLE_DAYS/);
  });

  it("still fails every other refusal", () => {
    /*
     * The monthly CL/ML cap, one-EL-per-month and overlapping-dates rules must keep failing
     * their rows. Skipping those would hand people leave they are not entitled to, which is a
     * far worse outcome than a confusing error message.
     */
    // Anchored on the comparison in the catch block, not on the identifier — the first
    // occurrence of the name is the import at the top of the file, which proves nothing.
    const idx = leaveBulkSrc.indexOf("?.code === NO_CHARGEABLE_DAYS");
    expect(idx, "the skip branch was not found").toBeGreaterThan(-1);
    const after = leaveBulkSrc.slice(idx, idx + 400);
    expect(after).toContain("markRowFailed");
    expect(after).toContain("grpFailed++");
  });

  it("counts a skipped row as neither staged nor failed", () => {
    expect(leaveBulkSrc).toContain("grpSkipped++");
    expect(leaveBulkSrc).toContain("skipped += r.grpSkipped");
    expect(leaveBulkSrc).toContain("return { staged, failed, skipped, branchId, errors }");
  });
});

describe("a single submission is unaffected", () => {
  it("still throws, so one person picking a week-off date is told", () => {
    // The bulk path is the only caller that treats this as a no-op. Someone using the Apply
    // Leave screen chose that date deliberately and needs to know it charges nothing.
    expect(leaveSrc).toMatch(/throw Object\.assign\(\s*\n?\s*new Error\(/);
    expect(leaveSrc).toContain("no working days to charge leave against");
  });
});
