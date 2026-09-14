import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every row on the salary-review queue reported BGV as "Conditional", in red.
 *
 * Two separate things caused that. candidate_bgv_report.overall_status is an
 * enum of ('pending','in_progress','clear','refer','negative') -- there is no
 * 'conditional' value -- and getEmployeeBgvStatus maps 'refer' onto
 * 'conditional' before returning. Live, 21 of the 22 candidates in this queue
 * are 'refer', with 41 checks at manual_review and none failed, so they really
 * are all conditional.
 *
 * The tile's `overall === 'refer'` branch was therefore dead code, and every
 * conditional row fell through to the red 'bad' tone -- showing "checks awaiting
 * review" as though something had failed. And the bare word carried no
 * information about what was outstanding.
 */
const QUEUE = readFileSync(
  resolve(process.cwd(), "..", "src", "pages", "payroll", "PayrollHeadSalaryReviewQueue.tsx"),
  "utf8",
);
const RESOLVER = readFileSync(
  resolve(process.cwd(), "src/modules/employees/employee-bgv.service.ts"),
  "utf8",
);
const BGV_CASE = QUEUE.slice(QUEUE.indexOf("case 'bgv': {"), QUEUE.indexOf("case 'bank': {"));

describe("BGV conditional — tone and detail", () => {
  it("the resolver really does map refer onto conditional", () => {
    // If this ever changes, the tile's handling below has to change with it.
    expect(RESOLVER).toMatch(/verdict === "conditional" \|\| verdict === "refer"/);
  });

  it("treats conditional as warn, not as a failure", () => {
    expect(BGV_CASE).toMatch(/overall === 'conditional'[\s\S]{0,900}tone: 'warn'/);
  });

  it("still handles the raw refer value, so the branch is not dead either way", () => {
    expect(BGV_CASE).toMatch(/overall === 'conditional' \|\| overall === 'refer'/);
  });

  it("reports how many checks are outstanding rather than a bare word", () => {
    expect(BGV_CASE).toMatch(/manual_review/);
    expect(BGV_CASE).toMatch(/Conditional · \$\{pending\} pending/);
  });

  it("counts only checks that are genuinely still open", () => {
    // verified and waived are settled; counting them would overstate the work left.
    const counter = BGV_CASE.slice(BGV_CASE.indexOf("const pending ="), BGV_CASE.indexOf("return { text: pending"));
    expect(counter).not.toMatch(/'verified'/);
    expect(counter).not.toMatch(/'waived'/);
  });

  it("does not paint a genuine negative verdict as merely conditional", () => {
    // 'negative' must still fall through to the red branch.
    expect(BGV_CASE.trimEnd()).toMatch(/return \{ text: overall, tone: 'bad' \};\s*\}$/);
  });
});
