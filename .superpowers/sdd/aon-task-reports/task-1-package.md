985f5b0d feat(reporting): one shared definition of the workforce population
 .../__tests__/workforce-population.test.ts         | 61 +++++++++++++++++
 .../src/modules/reporting/workforce-population.ts  | 79 ++++++++++++++++++++++
 2 files changed, 140 insertions(+)
diff --git a/backend/src/modules/reporting/__tests__/workforce-population.test.ts b/backend/src/modules/reporting/__tests__/workforce-population.test.ts
new file mode 100644
index 00000000..aab33656
--- /dev/null
+++ b/backend/src/modules/reporting/__tests__/workforce-population.test.ts
@@ -0,0 +1,61 @@
+import { describe, expect, it } from "vitest";
+import {
+  ACTIVE_EMPLOYEE_SQL,
+  AON_BUCKETS,
+  AON_BUCKET_ORDER_SQL,
+  AON_BUCKET_SQL,
+  IN_TRAINING_LABEL,
+  IN_TRAINING_SQL,
+} from "../workforce-population.js";
+
+describe("workforce population definition", () => {
+  it("requires BOTH flags for an active employee", () => {
+    const sql = ACTIVE_EMPLOYEE_SQL("e");
+    expect(sql).toContain("e.active_status = 1");
+    expect(sql).toContain("employment_status");
+  });
+
+  it("lower-cases employment_status", () => {
+    // Reactivation writes 'Active' with a capital A, and the column already holds
+    // 'Active' 273 against 'active' 1,039. A case-sensitive compare drops real staff.
+    expect(ACTIVE_EMPLOYEE_SQL("e")).toMatch(/LOWER\(\s*COALESCE\(\s*e\.employment_status/i);
+  });
+
+  it("never uses date_of_exit alone as the active test", () => {
+    // 28,426 inactive employees carry no exit date; that predicate would count them all.
+    expect(ACTIVE_EMPLOYEE_SQL("e")).not.toContain("date_of_exit");
+  });
+
+  it("has exactly five buckets, In Training first", () => {
+    expect(AON_BUCKETS).toEqual(["In Training", "0-30", "31-60", "61-90", "90+"]);
+    expect(AON_BUCKETS[0]).toBe(IN_TRAINING_LABEL);
+  });
+
+  it("treats joined-but-unpaid as In Training", () => {
+    const sql = IN_TRAINING_SQL("e", "CURDATE()");
+    expect(sql).toContain("e.date_of_joining <= CURDATE()");
+    expect(sql).toContain("e.salary_start_date > CURDATE()");
+  });
+
+  it("puts In Training ahead of every tenure bucket", () => {
+    const sql = AON_BUCKET_SQL("e", "CURDATE()");
+    expect(sql.indexOf("In Training")).toBeLessThan(sql.indexOf("'0-30'"));
+    expect(AON_BUCKET_ORDER_SQL("e", "CURDATE()")).toContain("THEN 0");
+  });
+
+  it("clamps negative tenure so a future joiner cannot land in 0-30 by accident", () => {
+    // A negative DATEDIFF satisfies `<= 30`. That is how 13 not-yet-paid employees were
+    // being counted as the newest joiners.
+    const sql = AON_BUCKET_SQL("e", "CURDATE()");
+    expect(sql).toContain("GREATEST(");
+    expect(sql).not.toMatch(/DATEDIFF\([^)]*\)\s*<=\s*30/);
+  });
+
+  it("works for exits too, where asOf is the exit date", () => {
+    // With asOf = date_of_exit, In Training means "left before payroll started" —
+    // quit during training, which is a real and useful category.
+    const sql = AON_BUCKET_SQL("e", "e.date_of_exit");
+    expect(sql).toContain("e.date_of_exit");
+    expect(sql).toContain(IN_TRAINING_LABEL);
+  });
+});
diff --git a/backend/src/modules/reporting/workforce-population.ts b/backend/src/modules/reporting/workforce-population.ts
new file mode 100644
index 00000000..04eb475a
--- /dev/null
+++ b/backend/src/modules/reporting/workforce-population.ts
@@ -0,0 +1,79 @@
+/**
+ * One definition of the reporting workforce population.
+ *
+ * Every executor used to spell out its own rule, and they diverged: the AON page counted
+ * `active_status = 1` alone and reported 1,121 where every other page reported 1,091. The
+ * extra 30 were people who resigned or were terminated in June/July 2026 and whose
+ * active_status flag was never cleared — verified live 2026-08-26, all 30 carry a
+ * date_of_exit, and the inverse case (employment_status active, active_status not 1)
+ * returns zero rows.
+ *
+ * These are SQL fragments rather than query builders so callers keep control of their joins.
+ */
+
+/** Default table alias used across the reporting executors. */
+const A = "e";
+
+/**
+ * The active-employee test.
+ *
+ * LOWER() is mandatory, not stylistic. Reactivation writes employment_status = 'Active'
+ * with a capital A, and the column already holds 'Active' 273 against 'active' 1,039.
+ *
+ * `date_of_exit IS NULL` is deliberately NOT part of this: 28,426 inactive employees carry
+ * no exit date at all and would every one be counted as active.
+ */
+export const ACTIVE_EMPLOYEE_SQL = (alias: string = A): string =>
+  `${alias}.active_status = 1 AND LOWER(COALESCE(${alias}.employment_status, 'active')) = 'active'`;
+
+/**
+ * The date AON is measured from. salary_start_date wins when present; 1,063 of 1,091 active
+ * employees have it equal to date_of_joining anyway.
+ */
+export const AON_REFERENCE_DATE_SQL = (alias: string = A): string =>
+  `COALESCE(${alias}.salary_start_date, ${alias}.date_of_joining)`;
+
+export const IN_TRAINING_LABEL = "In Training" as const;
+
+/**
+ * Joined and on the floor, but not yet on payroll.
+ *
+ * Validated live: 1,063 of 1,091 active employees have salary_start_date = date_of_joining,
+ * 28 have a later salary date (most commonly by exactly 6 days — a training week), and none
+ * has a salary date before joining. 13 were in this state on 2026-08-26.
+ *
+ * Used with asOf = date_of_exit this reads "left before payroll started", i.e. quit during
+ * training, which is a real category rather than an artefact.
+ */
+export const IN_TRAINING_SQL = (alias: string = A, asOf: string = "CURDATE()"): string =>
+  `${alias}.date_of_joining <= ${asOf} AND ${alias}.salary_start_date > ${asOf}`;
+
+export const AON_BUCKETS = ["In Training", "0-30", "31-60", "61-90", "90+"] as const;
+export type AonBucket = (typeof AON_BUCKETS)[number];
+
+/**
+ * Tenure in days, floored at zero.
+ *
+ * The clamp is load-bearing. The previous bucket test was `DATEDIFF(...) <= 30 THEN '0-30'`,
+ * and a NEGATIVE DATEDIFF satisfies `<= 30` — which is how employees whose reference date had
+ * not arrived were silently counted as the newest joiners.
+ */
+const AON_DAYS = (alias: string, asOf: string): string =>
+  `GREATEST(DATEDIFF(${asOf}, ${AON_REFERENCE_DATE_SQL(alias)}), 0)`;
+
+export const AON_BUCKET_SQL = (alias: string = A, asOf: string = "CURDATE()"): string => `CASE
+             WHEN ${IN_TRAINING_SQL(alias, asOf)} THEN '${IN_TRAINING_LABEL}'
+             WHEN ${AON_DAYS(alias, asOf)} <= 30 THEN '0-30'
+             WHEN ${AON_DAYS(alias, asOf)} <= 60 THEN '31-60'
+             WHEN ${AON_DAYS(alias, asOf)} <= 90 THEN '61-90'
+             ELSE '90+'
+           END`;
+
+/** Sort key. A string sort puts '90+' ahead of '0-30'; every report orders by this instead. */
+export const AON_BUCKET_ORDER_SQL = (alias: string = A, asOf: string = "CURDATE()"): string => `CASE
+             WHEN ${IN_TRAINING_SQL(alias, asOf)} THEN 0
+             WHEN ${AON_DAYS(alias, asOf)} <= 30 THEN 1
+             WHEN ${AON_DAYS(alias, asOf)} <= 60 THEN 2
+             WHEN ${AON_DAYS(alias, asOf)} <= 90 THEN 3
+             ELSE 4
+           END`;
