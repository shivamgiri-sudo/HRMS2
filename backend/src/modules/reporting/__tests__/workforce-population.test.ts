import { describe, expect, it } from "vitest";
import {
  ACTIVE_EMPLOYEE_SQL,
  AON_BUCKETS,
  AON_BUCKET_ORDER_SQL,
  AON_BUCKET_SQL,
  IN_TRAINING_LABEL,
  IN_TRAINING_SQL,
} from "../workforce-population.js";

describe("workforce population definition", () => {
  it("requires BOTH flags for an active employee", () => {
    const sql = ACTIVE_EMPLOYEE_SQL("e");
    expect(sql).toContain("e.active_status = 1");
    expect(sql).toContain("employment_status");
  });

  it("lower-cases employment_status", () => {
    // Reactivation writes 'Active' with a capital A, and the column already holds
    // 'Active' 273 against 'active' 1,039. A case-sensitive compare drops real staff.
    expect(ACTIVE_EMPLOYEE_SQL("e")).toMatch(/LOWER\(\s*COALESCE\(\s*e\.employment_status/i);
  });

  it("never uses date_of_exit alone as the active test", () => {
    // 28,426 inactive employees carry no exit date; that predicate would count them all.
    expect(ACTIVE_EMPLOYEE_SQL("e")).not.toContain("date_of_exit");
  });

  it("has exactly five buckets, In Training first", () => {
    expect(AON_BUCKETS).toEqual(["In Training", "0-30", "31-60", "61-90", "90+"]);
    expect(AON_BUCKETS[0]).toBe(IN_TRAINING_LABEL);
  });

  it("treats joined-but-unpaid as In Training", () => {
    const sql = IN_TRAINING_SQL("e", "CURDATE()");
    expect(sql).toContain("e.date_of_joining <= CURDATE()");
    expect(sql).toContain("e.salary_start_date > CURDATE()");
  });

  it("puts In Training ahead of every tenure bucket", () => {
    const sql = AON_BUCKET_SQL("e", "CURDATE()");
    expect(sql.indexOf("In Training")).toBeLessThan(sql.indexOf("'0-30'"));
    expect(AON_BUCKET_ORDER_SQL("e", "CURDATE()")).toContain("THEN 0");
  });

  it("clamps negative tenure so a future joiner cannot land in 0-30 by accident", () => {
    // A negative DATEDIFF satisfies `<= 30`. That is how 13 not-yet-paid employees were
    // being counted as the newest joiners.
    const sql = AON_BUCKET_SQL("e", "CURDATE()");
    expect(sql).toContain("GREATEST(");
    expect(sql).not.toMatch(/DATEDIFF\([^)]*\)\s*<=\s*30/);
  });

  it("works for exits too, where asOf is the exit date", () => {
    // With asOf = date_of_exit, In Training means "left before payroll started" —
    // quit during training, which is a real and useful category.
    const sql = AON_BUCKET_SQL("e", "e.date_of_exit");
    expect(sql).toContain("e.date_of_exit");
    expect(sql).toContain(IN_TRAINING_LABEL);
  });
});
