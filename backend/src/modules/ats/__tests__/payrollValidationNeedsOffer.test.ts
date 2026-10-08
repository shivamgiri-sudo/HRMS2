/**
 * Saving payroll details must not silently do nothing.
 *
 * `savePayrollControlRoomDetails` seeds `ats_payroll_hr_validation` with an
 * INSERT ... SELECT FROM ats_employment_offer. With no offer row for the
 * candidate the SELECT returns nothing, the INSERT writes nothing, and MySQL
 * reports no error — so the function returned success while creating no record.
 *
 * That matters because the validation record is a hard gate on employee
 * creation (`validateSalaryLock` in employee-creation-orchestrator.service.ts
 * requires validation_status='validated'). Payroll HR filled the form, saved,
 * was told it worked, and the candidate then sat in the queue with nothing
 * indicating why.
 *
 * In production this is the common path, not an edge case: of 44 candidates who
 * submitted onboarding, 31 have no employment offer.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SOURCE = readFileSync(
  resolve(process.cwd(), "src/modules/ats/joining-control-room.service.ts"),
  "utf8",
);

/**
 * The whole "no validation row yet" branch — from the guard that enters it to
 * the else. Anchored on the guard rather than the SQL string, because the
 * db.execute call that captures the result sits above the SQL.
 */
function seedingBlock(): string {
  const insertAt = SOURCE.indexOf("INSERT INTO ats_payroll_hr_validation");
  expect(insertAt, "the seeding INSERT has moved or been removed").toBeGreaterThan(-1);
  const start = SOURCE.lastIndexOf("if (!existingRows[0])", insertAt);
  expect(start, "could not find the branch guard").toBeGreaterThan(-1);
  const end = SOURCE.indexOf("} else {", insertAt);
  expect(end, "could not find the end of the seeding branch").toBeGreaterThan(insertAt);
  return SOURCE.slice(start, end);
}

describe("seeding a payroll validation record", () => {
  it("still seeds from the employment offer", () => {
    // If this ever stops being true, the reasoning below needs revisiting
    // rather than silently continuing to hold.
    expect(seedingBlock()).toContain("FROM ats_employment_offer");
  });

  it("captures the insert result rather than discarding it", () => {
    expect(
      seedingBlock(),
      "an INSERT ... SELECT that matches nothing writes nothing and raises nothing",
    ).toMatch(/const\s+\[\s*\w+\s*\]\s*=\s*await\s+db\.execute<ResultSetHeader>/);
  });

  it("raises when no row was written", () => {
    const block = seedingBlock();
    expect(block).toMatch(/affectedRows\s*===\s*0/);
    expect(block).toMatch(/throw /);
  });

  it("says why, naming the missing offer", () => {
    // A generic failure would send Payroll HR looking in the wrong place.
    const block = seedingBlock();
    expect(block.toLowerCase()).toContain("no employment offer");
  });

  it("fails as a client error, not a 500", () => {
    // The candidate genuinely lacks a prerequisite; that is a 400, and the
    // message is meant to be shown.
    expect(seedingBlock()).toMatch(/statusCode:\s*400/);
  });
});
