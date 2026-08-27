e9c5f033 fix(aon): stop counting 30 exited employees as active headcount
 .../executors/__tests__/aon-population.test.ts     | 45 +++++++++++++++++++++
 .../modules/reporting/executors/aon.executor.ts    | 47 +++++++++-------------
 2 files changed, 64 insertions(+), 28 deletions(-)
diff --git a/backend/src/modules/reporting/executors/__tests__/aon-population.test.ts b/backend/src/modules/reporting/executors/__tests__/aon-population.test.ts
new file mode 100644
index 00000000..31982847
--- /dev/null
+++ b/backend/src/modules/reporting/executors/__tests__/aon-population.test.ts
@@ -0,0 +1,45 @@
+import { readFileSync } from "node:fs";
+import { resolve } from "node:path";
+import { describe, expect, it } from "vitest";
+
+/**
+ * The AON executor must not carry its own population rule. It defined ACTIVE as
+ * `e.active_status = 1` alone and reported 1,121 active employees where every other page
+ * reported 1,091 — the 30 difference being people who left in June/July 2026 whose
+ * active_status flag was never cleared.
+ */
+const SRC = readFileSync(
+  resolve(process.cwd(), "src/modules/reporting/executors/aon.executor.ts"), "utf8");
+const live = () => SRC.split("\n")
+  .filter(l => !l.trim().startsWith("*") && !l.trim().startsWith("//")).join("\n");
+
+describe("aon.executor population rule", () => {
+  it("imports the shared definition", () => {
+    expect(SRC).toContain("workforce-population.js");
+    expect(SRC).toContain("ACTIVE_EMPLOYEE_SQL");
+  });
+
+  it("no longer hard-codes active_status = 1 as the whole test", () => {
+    expect(live()).not.toMatch(/const ACTIVE\s*=\s*["']e\.active_status = 1["']/);
+  });
+
+  // Scoped to aonBucketSql/aonBucketOrderSql specifically, not the whole file: the file
+  // also defines atRiskBucketSql, a distinct helper used only by aonBucketShrinkage's
+  // at-risk-population CTE (which carries a pre-COALESCE'd join_date column, not the raw
+  // date_of_joining/salary_start_date pair AON_BUCKET_SQL needs for its In Training check).
+  // Task 2's brief names only aonBucketSql/aonBucketOrderSql and the ACTIVE constant as in
+  // scope; aonBucketShrinkage's own population rule is untouched here.
+  it("aonBucketSql/aonBucketOrderSql no longer inline the bucket CASE", () => {
+    const bucketFn = live().match(/function aonBucketSql\([\s\S]*?\n}/)?.[0];
+    const orderFn = live().match(/function aonBucketOrderSql\([\s\S]*?\n}/)?.[0];
+    expect(bucketFn).toBeTruthy();
+    expect(orderFn).toBeTruthy();
+    expect(bucketFn).not.toMatch(/WHEN DATEDIFF/);
+    expect(orderFn).not.toMatch(/WHEN DATEDIFF/);
+  });
+
+  it("uses the shared bucket helpers", () => {
+    expect(SRC).toContain("AON_BUCKET_SQL");
+    expect(SRC).toContain("AON_BUCKET_ORDER_SQL");
+  });
+});
diff --git a/backend/src/modules/reporting/executors/aon.executor.ts b/backend/src/modules/reporting/executors/aon.executor.ts
index c0888e90..3418ae72 100644
--- a/backend/src/modules/reporting/executors/aon.executor.ts
+++ b/backend/src/modules/reporting/executors/aon.executor.ts
@@ -62,20 +62,25 @@
 import type { RowDataPacket } from "mysql2";
 import { db } from "../../../db/mysql.js";
 import type { ExecFilters, ExecScope, ExecOptions, ExecResult } from "./types.js";
 import {
   appendScopeConditions,
   appendFilterConditions,
   dateParam,
   fetchPageWithTotal,
   rethrowReportSchemaError,
 } from "./types.js";
+import {
+  ACTIVE_EMPLOYEE_SQL,
+  AON_BUCKET_ORDER_SQL,
+  AON_BUCKET_SQL,
+} from "../workforce-population.js";
 
 async function query(sql: string, params: unknown[]): Promise<RowDataPacket[]> {
   const [rows] = await db.execute<RowDataPacket[]>(sql, params);
   return rows;
 }
 
 async function count(baseSql: string, params: unknown[]): Promise<number> {
   const [rows] = await db.execute<RowDataPacket[]>(
     `SELECT COUNT(*) AS total FROM (${baseSql}) AS _cnt`,
     params
@@ -92,62 +97,48 @@ async function count(baseSql: string, params: unknown[]): Promise<number> {
  * same way) — so COALESCE here is the existing convention for this column, not a new rule.
  * Of the 1,554 populated rows only 19 actually differ from date_of_joining (6-41 day gaps, all
  * recent joiners), so this is a safe substitution today and correctly future-proofed as more
  * employees get a real salary_start_date set going forward.
  */
 export const AON_REFERENCE_JOIN_DATE_SQL = "COALESCE(e.salary_start_date, e.date_of_joining)";
 
 /**
  * The bucket expression, parameterised only by the reference date.
  *
- * Written as day arithmetic rather than TIMESTAMPDIFF(MONTH, ...) — which is what
- * tenure-distribution uses — because the boundaries here are exact day counts and a
- * month-based comparison does not land on day 30/60/90.
- *
- * Boundaries are inclusive-upper (<= 30, <= 60, <= 90) so the four buckets are disjoint
- * and cover every non-null joining date. Day 0 (joined today) falls in 0-30.
+ * Delegates to workforce-population.ts, which owns the five-bucket shape (In Training,
+ * 0-30, 31-60, 61-90, 90+) shared by every reporting executor.
  */
 function aonBucketSql(asOf: string): string {
-  return `CASE
-             WHEN DATEDIFF(${asOf}, ${AON_REFERENCE_JOIN_DATE_SQL}) <= 30 THEN '0-30'
-             WHEN DATEDIFF(${asOf}, ${AON_REFERENCE_JOIN_DATE_SQL}) <= 60 THEN '31-60'
-             WHEN DATEDIFF(${asOf}, ${AON_REFERENCE_JOIN_DATE_SQL}) <= 90 THEN '61-90'
-             ELSE '90+'
-           END`;
+  return AON_BUCKET_SQL("e", asOf);
 }
 
 /**
- * The ordering key for the four buckets.
+ * The ordering key for the buckets.
  *
  * Sorting on the label alone puts '0-30' before '31-60' but '90+' before both, because it
  * is a string sort. Every report here orders by this instead so the buckets read in
- * tenure order on screen and in the exported workbook.
+ * tenure order on screen and in the exported workbook. Delegates to workforce-population.ts.
  */
 function aonBucketOrderSql(asOf: string): string {
-  return `CASE
-             WHEN DATEDIFF(${asOf}, ${AON_REFERENCE_JOIN_DATE_SQL}) <= 30 THEN 1
-             WHEN DATEDIFF(${asOf}, ${AON_REFERENCE_JOIN_DATE_SQL}) <= 60 THEN 2
-             WHEN DATEDIFF(${asOf}, ${AON_REFERENCE_JOIN_DATE_SQL}) <= 90 THEN 3
-             ELSE 4
-           END`;
+  return AON_BUCKET_ORDER_SQL("e", asOf);
 }
 
-/**
- * The active-employee test.
+/*
+ * The active-employee test now comes from workforce-population.ts.
  *
- * `active_status = 1` alone, deliberately. The superseded two-flag form also required
- * LOWER(COALESCE(employment_status,'active')) = 'active', which returns 1,123 where the
- * agreed definition returns 1,125 — employment_status is mixed-case free text
- * ('Resigned' 28,200 vs 'resigned' 2,118; 'Active' 273 vs 'active' 1,039) and is not a
- * reliable predicate. See report-row-scope notes on cost-centre-headcount.
+ * This file previously used `e.active_status = 1` alone, reporting 1,121 active employees
+ * against 1,091 everywhere else. The 30 extra had all resigned or been terminated in
+ * June/July 2026 with a date_of_exit recorded; only the active_status flag was stale.
+ * Verified live 2026-08-26: the inverse case (employment_status active, active_status not 1)
+ * returns zero rows, so employment_status is the trustworthy field.
  */
-const ACTIVE = "e.active_status = 1";
+const ACTIVE = ACTIVE_EMPLOYEE_SQL("e");
 
 /**
  * The population that can be reasoned about historically.
  *
  * 28,426 inactive employees carry no date_of_exit at all, so "was this person employed on
  * date D" is unanswerable for them and counting them as still employed inflates any
  * point-in-time headcount by an order of magnitude (~29,500 against a real 1,327).
  * They are excluded from every denominator here.
  *
  * This is safe for the rolling windows these reports default to: only 22 of those 28,426
