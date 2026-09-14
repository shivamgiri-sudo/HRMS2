import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The Pending Review row presented a final salary before anyone had approved it.
 *
 * assignPackage() writes salary_component_assignments with status='active' the
 * moment a package is attached -- before acceptance and before approval -- so
 * final_ctc becomes non-null immediately and the row's headline figure read as
 * settled while the decision it represents had not been taken.
 *
 * The row now shows the OFFERED figure until the review reaches 'approved', at
 * which point the final one appears. The drawer is deliberately untouched: that
 * is where the Payroll Head assigns and accepts a package, and it has to keep
 * showing the amounts being decided on.
 */
const QUEUE = readFileSync(
  resolve(process.cwd(), "..", "src", "pages", "payroll", "PayrollHeadSalaryReviewQueue.tsx"),
  "utf8",
);
const SERVICE = readFileSync(
  resolve(process.cwd(), "src/modules/payroll-head-review/payroll-head-review.service.ts"),
  "utf8",
);

describe("Final salary is not shown as final before approval", () => {
  it("gates the row's figure on an approved review, not on a package existing", () => {
    expect(QUEUE).toMatch(/const showFinal = row\.status === 'approved' && row\.final_ctc != null;/);
  });

  it("labels the figure so it cannot be misread as final while pending", () => {
    const block = QUEUE.slice(QUEUE.indexOf("const showFinal ="), QUEUE.indexOf("const showFinal =") + 1600);
    expect(block).toMatch(/showFinal \? 'final monthly CTC' : 'offered monthly CTC'/);
  });

  it("falls back to the offered figure rather than hiding the column", () => {
    // Blanking it would read as missing data; the offer is a real, decided number.
    const block = QUEUE.slice(QUEUE.indexOf("const amount = showFinal"), QUEUE.indexOf("const amount = showFinal") + 400);
    expect(block).toContain("row.offered_ctc");
  });

  it("the section tile withholds an amount until the review is approved", () => {
    const tile = QUEUE.slice(QUEUE.indexOf("case 'final': {"), QUEUE.indexOf("case 'final': {") + 900);
    expect(tile).toMatch(/const decided = row\.status === 'approved';/);
    // "Validated", not "Accepted" — the button was renamed to Validate Package on
    // 2026-08-27 (owner request) and this tile's copy follows it. What the assertion
    // actually guards is that the pending branch names a STATE and not an amount.
    expect(tile).toMatch(/Validated — awaiting approval/);
    // The amount may only be quoted on the decided branch.
    expect(tile).toMatch(/decided && s\.final\.ctc/);
  });

  it("leaves the drawer's Final Salary panel intact — it is the approval tool", () => {
    const drawer = QUEUE.slice(QUEUE.indexOf("export function FinalSalarySection"));
    expect(drawer).toMatch(/\{sc \?/);
  });

  it("does not change when the backend stores the assignment", () => {
    // This was a display fix. assignPackage must still write the package on
    // assignment so the Payroll Head has something to review and accept.
    expect(SERVICE).toMatch(/status[^\n]*['"]active['"]/);
  });
});
