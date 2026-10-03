import { describe, it, expect } from "vitest";
import { EMPLOYMENT_END_DATE_SQL, employmentWindowPredicate } from "../employment-end-date.js";

describe("employment end date vs rejoined exits", () => {
  it("only accepted / notice_serving / exited exits count as an end of employment", () => {
    const m = EMPLOYMENT_END_DATE_SQL.match(/IN \(([^)]*)\)/);
    expect(m).not.toBeNull();
    const statuses = m![1]!.split(",").map((s) => s.trim().replace(/'/g, "")).sort();
    expect(statuses).toEqual(["accepted", "exited", "notice_serving"]);
  });

  it("'rejoined' can never qualify", () => {
    expect(EMPLOYMENT_END_DATE_SQL).not.toMatch(/rejoined/i);
  });

  it("an active employee with no resolvable end date stays in the run", () => {
    expect(employmentWindowPredicate()).toMatch(/IS NULL AND LOWER\(e\.employment_status\) = 'active'/);
  });
});
