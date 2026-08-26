import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A bare "0" appeared in every queue row, between the status chips and the
 * Review link.
 *
 * package_accepted is a MySQL tinyint, so it reaches the client as the NUMBER 0
 * rather than false. `canQuickApprove` ended its && chain on that value, so for
 * any row whose package was not yet accepted the whole expression evaluated to
 * 0 -- and React renders the number 0 as text, where false would have rendered
 * nothing. The same leak sat on the drawer's approve button.
 *
 * Both are coerced with !!. This is the JSX falsy-number trap, and it is
 * invisible to the type checker: `number && JSX.Element` is a perfectly valid
 * expression whose only symptom is a stray digit on screen.
 */
const QUEUE = readFileSync(
  resolve(process.cwd(), "..", "src", "pages", "payroll", "PayrollHeadSalaryReviewQueue.tsx"),
  "utf8",
);

describe("Queue row — no stray 0 from a tinyint flag", () => {
  it("coerces canQuickApprove to a boolean", () => {
    expect(QUEUE).toMatch(/const canQuickApprove = !!\(/);
  });

  it("does not end the canQuickApprove chain on a raw numeric field", () => {
    const line = QUEUE.split("\n").find((l) => l.includes("const canQuickApprove ="))!;
    expect(line).toContain("!!(");
    // The tell-tale shape: `&& row.package_accepted;` with nothing coercing it.
    expect(line).not.toMatch(/&& row\.package_accepted;\s*$/);
  });

  it("coerces the drawer's approve-button guard too", () => {
    expect(QUEUE).toMatch(/\{!!\(status === 'pending_review' && isReviewer && review\?\.package_accepted\) && \(/);
  });

  it("leaves no bare `package_accepted &&` render guard anywhere in the file", () => {
    // Negated forms (!review?.package_accepted) are already booleans and are fine.
    const bare = [...QUEUE.matchAll(/\{[^{}\n]{0,80}[^!(]\breview\?\.package_accepted && \(/g)];
    expect(bare.map((m) => m[0])).toEqual([]);
  });
});
