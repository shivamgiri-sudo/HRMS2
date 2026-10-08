/**
 * A leave row whose dates fall on a week-off or holiday is APPLIED, not refused or skipped.
 *
 * WHAT WAS WRONG. Applying leave was roster-validated. leave.service computed a
 * chargeable-day count from the employee's roster week-off and company holidays, and when
 * that count was zero it threw NO_CHARGEABLE_DAYS. The bulk importer caught that code and
 * marked the row 'skipped'. Net effect: an operator uploaded a leave for a Sunday, the run
 * reported clean, and no leave record was ever created — the row vanished silently.
 *
 * The rule is that the roster does not gate the APPLICATION. It governs what gets charged
 * against the balance and what gets written to attendance; whether the employee may book
 * the leave at all is not the roster's business. So the request is accepted, stored with
 * the applied calendar days when nothing in the range is chargeable, and approvable.
 *
 * Charging is deliberately unchanged: the approval path still deducts only chargeable
 * dates, so a week-off day inside a leave range still costs no entitlement and still
 * leaves attendance untouched.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi, beforeEach } from "vitest";

const execute = vi.fn();
vi.mock("../../../db/mysql.js", () => ({ db: { execute: (...a: unknown[]) => execute(...a) } }));
vi.mock("../lock-retry.js", () => ({ withBulkLockRetry: (fn: () => Promise<unknown>) => fn() }));

const { markRowFailed } = await import("../bulk-approval.service.js");

const DIR = path.dirname(fileURLToPath(import.meta.url));
const leaveBulkSrc = fs.readFileSync(path.resolve(DIR, "..", "leave-application-bulk.service.ts"), "utf8");
const leaveSrc = fs.readFileSync(path.resolve(DIR, "../../leave/leave.service.ts"), "utf8");

beforeEach(() => execute.mockReset());

describe("submitting a leave is not roster-validated", () => {
  it("no longer refuses a range with no chargeable day", () => {
    // The exact refusal that used to strand these rows. Its absence is the fix.
    expect(leaveSrc).not.toContain("no working days to charge leave against");
    expect(leaveSrc).not.toMatch(/\{ code: NO_CHARGEABLE_DAYS \}/);
  });

  it("stores the applied calendar days when nothing in the range is chargeable", () => {
    // Without the fallback the row would be accepted and then stored as 0.00 days — a
    // ghost record that reads as a leave nobody took.
    expect(leaveSrc).toContain(
      "const effectiveDayCount = chargeableCount > 0 ? chargeableCount : submitClassification.size;",
    );
    expect(leaveSrc).toContain("const storedDays = isHalfDay ? 0.5 : effectiveDayCount;");
  });

  it("measures policy caps against the same count it stores", () => {
    // CL/ML 2-day limit, the monthly cap and the EL single-go cap must all read the count
    // the row is actually stored with, or a request could be stored at one size and
    // policed at another.
    expect(leaveSrc).toContain("if (effectiveDayCount > 2) {");
    expect(leaveSrc).toContain("checkELSingleGoCap(effectiveDayCount)");
  });
});

describe("approving such a leave is possible", () => {
  it("no longer refuses a request with zero chargeable dates", () => {
    // Submit accepting a row that approval then refuses would strand it in pending forever.
    expect(leaveSrc).not.toContain("Nothing to approve.");
  });
});

describe("charging behaviour is unchanged", () => {
  it("still deducts and writes attendance for chargeable dates only", () => {
    // The fix removes a gate, not the week-off exemption. groupDatesByYear(chargeable) is
    // what drives the ledger deduction; a week-off inside a range must still cost nothing.
    expect(leaveSrc).toContain("const byYear = groupDatesByYear(chargeable);");
  });
});

describe("the bulk importer applies the row like any other", () => {
  it("has no week-off skip branch left", () => {
    expect(leaveBulkSrc).not.toContain("?.code === NO_CHARGEABLE_DAYS");
    expect(leaveBulkSrc).not.toContain("markRowSkipped(row.rowId");
  });

  it("still fails every genuine refusal", () => {
    // The monthly CL/ML cap, one-EL-per-month and overlapping-dates rules must keep failing
    // their rows — those are real refusals, unrelated to the roster.
    expect(leaveBulkSrc).toContain("await markRowFailed(row.rowId, msg);");
    expect(leaveBulkSrc).toContain("grpFailed++");
  });

  it("marks a genuinely bad row as an error, not a skip", async () => {
    execute.mockResolvedValueOnce([{ affectedRows: 1 }]);
    await markRowFailed("row-2", "Monthly leave limit reached");
    expect(String(execute.mock.calls[0][0])).toContain("row_status = 'error'");
  });
});
