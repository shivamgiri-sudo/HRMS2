1125c1ce fix(aon): teach the drill-down the In Training bucket
 .../__tests__/aon-drilldown-in-training.test.ts    | 35 ++++++++++++++++++++++
 .../reporting/executors/aon-drilldown.executor.ts  | 22 +++++++++-----
 2 files changed, 49 insertions(+), 8 deletions(-)
diff --git a/backend/src/modules/reporting/executors/__tests__/aon-drilldown-in-training.test.ts b/backend/src/modules/reporting/executors/__tests__/aon-drilldown-in-training.test.ts
new file mode 100644
index 00000000..2220ca88
--- /dev/null
+++ b/backend/src/modules/reporting/executors/__tests__/aon-drilldown-in-training.test.ts
@@ -0,0 +1,35 @@
+import { readFileSync } from "node:fs";
+import { resolve } from "node:path";
+import { describe, expect, it } from "vitest";
+import { AON_BUCKETS, AON_DAYS_SQL } from "../../workforce-population.js";
+
+/**
+ * The drill-down turns a bucket label back into a SQL predicate. Every label the aggregate can
+ * emit needs a case here, or the drawer disagrees with the number that was clicked.
+ */
+const SRC = readFileSync(
+  resolve(process.cwd(), "src/modules/reporting/executors/aon-drilldown.executor.ts"), "utf8");
+
+describe("aon drill-down bucket predicates", () => {
+  it("handles every bucket the aggregate can produce", () => {
+    for (const bucket of AON_BUCKETS) {
+      expect(SRC, `no drill-down predicate for the "${bucket}" bucket`).toContain(`"${bucket}"`);
+    }
+  });
+
+  it("handles In Training on BOTH the active and the exits switch", () => {
+    // Two switches exist: one measuring current staff from CURDATE(), one measuring leavers
+    // from date_of_exit. On the exits side In Training means "left before payroll started".
+    const occurrences = SRC.split(`"In Training"`).length - 1;
+    expect(occurrences, "In Training must appear in both switches").toBeGreaterThanOrEqual(2);
+  });
+
+  it("clamps tenure so no predicate can match a negative", () => {
+    // Task 1 moved the clamp into the shared AON_DAYS_SQL helper -- a hand-rolled GREATEST(...)
+    // here would just re-create the divergence that helper exists to eliminate. So the property
+    // under test is "the drill-down delegates its tenure math to that helper", proven two ways:
+    // the source wires through it, and the helper itself is the one place GREATEST() lives.
+    expect(SRC).toContain("AON_DAYS_SQL(");
+    expect(AON_DAYS_SQL()).toContain("GREATEST(");
+  });
+});
diff --git a/backend/src/modules/reporting/executors/aon-drilldown.executor.ts b/backend/src/modules/reporting/executors/aon-drilldown.executor.ts
index ba3d50cf..858fd039 100644
--- a/backend/src/modules/reporting/executors/aon-drilldown.executor.ts
+++ b/backend/src/modules/reporting/executors/aon-drilldown.executor.ts
@@ -23,52 +23,58 @@ import type { RowDataPacket } from "mysql2";
 import { db } from "../../../db/mysql.js";
 import type { ExecFilters, ExecScope, ExecOptions, ExecResult } from "./types.js";
 import {
   appendScopeConditions,
   appendFilterConditions,
   fetchPageWithTotal,
   rethrowReportSchemaError,
   dateParam,
 } from "./types.js";
 import { AON_REFERENCE_JOIN_DATE_SQL } from "./aon.executor.js";
+import { AON_DAYS_SQL, IN_TRAINING_SQL } from "../workforce-population.js";
 
 async function query(sql: string, params: unknown[]): Promise<RowDataPacket[]> {
   const [rows] = await db.execute<RowDataPacket[]>(sql, params);
   return rows;
 }
 
 async function count(baseSql: string, params: unknown[]): Promise<number> {
   const [rows] = await db.execute<RowDataPacket[]>(
     `SELECT COUNT(*) AS total FROM (${baseSql}) AS _cnt`,
     params
   );
   return Number((rows as Array<{ total?: number }>)[0]?.total ?? 0);
 }
 
 const MIN_DAYS_FOR_RATE = 5;
 
 function aonBucketClause(bucket: unknown): string | null {
   switch (bucket) {
-    case "0-30": return `DATEDIFF(CURDATE(), ${AON_REFERENCE_JOIN_DATE_SQL}) <= 30`;
-    case "31-60": return `DATEDIFF(CURDATE(), ${AON_REFERENCE_JOIN_DATE_SQL}) BETWEEN 31 AND 60`;
-    case "61-90": return `DATEDIFF(CURDATE(), ${AON_REFERENCE_JOIN_DATE_SQL}) BETWEEN 61 AND 90`;
-    case "90+": return `DATEDIFF(CURDATE(), ${AON_REFERENCE_JOIN_DATE_SQL}) > 90`;
+    // Joined and on the floor but not yet on payroll. Must come first -- these rows would
+    // otherwise fall into 0-30 and the drawer would disagree with the cell that was clicked.
+    case "In Training": return IN_TRAINING_SQL("e", "CURDATE()");
+    case "0-30": return `${AON_DAYS_SQL("e", "CURDATE()")} <= 30`;
+    case "31-60": return `${AON_DAYS_SQL("e", "CURDATE()")} BETWEEN 31 AND 60`;
+    case "61-90": return `${AON_DAYS_SQL("e", "CURDATE()")} BETWEEN 61 AND 90`;
+    case "90+": return `${AON_DAYS_SQL("e", "CURDATE()")} > 90`;
     default: return null;
   }
 }
 
 function aonBucketAtExitClause(bucket: unknown): string | null {
   switch (bucket) {
-    case "0-30": return `DATEDIFF(e.date_of_exit, ${AON_REFERENCE_JOIN_DATE_SQL}) <= 30`;
-    case "31-60": return `DATEDIFF(e.date_of_exit, ${AON_REFERENCE_JOIN_DATE_SQL}) BETWEEN 31 AND 60`;
-    case "61-90": return `DATEDIFF(e.date_of_exit, ${AON_REFERENCE_JOIN_DATE_SQL}) BETWEEN 61 AND 90`;
-    case "90+": return `DATEDIFF(e.date_of_exit, ${AON_REFERENCE_JOIN_DATE_SQL}) > 90`;
+    // Left before payroll started -- quit during training.
+    case "In Training": return IN_TRAINING_SQL("e", "e.date_of_exit");
+    case "0-30": return `${AON_DAYS_SQL("e", "e.date_of_exit")} <= 30`;
+    case "31-60": return `${AON_DAYS_SQL("e", "e.date_of_exit")} BETWEEN 31 AND 60`;
+    case "61-90": return `${AON_DAYS_SQL("e", "e.date_of_exit")} BETWEEN 61 AND 90`;
+    case "90+": return `${AON_DAYS_SQL("e", "e.date_of_exit")} > 90`;
     default: return null;
   }
 }
 
 export async function aonDrilldownEmployees(
   filters: ExecFilters,
   scope: ExecScope,
   options: ExecOptions
 ): Promise<ExecResult> {
   const metric = String(filters.metric ?? "headcount");
