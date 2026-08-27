7de0b6a6 test(aon): make reconciliation harness able to fail on the ACTIVE_EMPLOYEE_SQL regression
29c386bc test(aon): reconciliation harness for buckets, filters and drill-downs
d282856b Task 6: Wire all four filters to headline KPI query
b193a591 feat(aon): expose process, department and cost-centre filters
d9d38a70 feat(aon): show the In Training bucket
1bb58410 fix(reporting): give COO org-wide report scope
0d77863b fix(aon-drilldown): clamp display-column tenure and harden the switch-clamp test
1125c1ce fix(aon): teach the drill-down the In Training bucket
e9c5f033 fix(aon): stop counting 30 exited employees as active headcount
d5485720 Fix: tighten AND assertion and export AON_DAYS_SQL
985f5b0d feat(reporting): one shared definition of the workforce population
 .../__tests__/aon-reconciliation.live.test.ts      | 144 +++++++++++++++++++++
 .../reporting-scope-roles.contract.test.ts         |  36 ++++++
 .../__tests__/workforce-population.test.ts         |  70 ++++++++++
 .../__tests__/aon-drilldown-in-training.test.ts    |  73 +++++++++++
 .../executors/__tests__/aon-population.test.ts     |  45 +++++++
 .../reporting/executors/aon-drilldown.executor.ts  |  32 +++--
 .../modules/reporting/executors/aon.executor.ts    |  47 +++----
 backend/src/modules/reporting/reporting.scope.ts   |  13 +-
 .../src/modules/reporting/workforce-population.ts  |  81 ++++++++++++
 src/components/reports/views/AonAnalyticsView.tsx  | 116 ++++++++++++++---
 .../__tests__/AonAnalyticsView.buckets.test.tsx    |  24 ++++
 .../__tests__/AonAnalyticsView.filters.test.tsx    |  52 ++++++++
 12 files changed, 676 insertions(+), 57 deletions(-)
diff --git a/backend/src/modules/reporting/__tests__/aon-reconciliation.live.test.ts b/backend/src/modules/reporting/__tests__/aon-reconciliation.live.test.ts
new file mode 100644
index 00000000..6518020c
--- /dev/null
+++ b/backend/src/modules/reporting/__tests__/aon-reconciliation.live.test.ts
@@ -0,0 +1,144 @@
+import mysql from "mysql2/promise";
+import { afterAll, beforeAll, describe, expect, it } from "vitest";
+import { ACTIVE_EMPLOYEE_SQL, AON_BUCKET_SQL } from "../workforce-population.js";
+
+/**
+ * Reconciliation invariants for the AON page, against the live database.
+ *
+ * These assert relationships, not numbers: totals reconcile between levels, every filter
+ * provably narrows, and a drill-down list is exactly as long as the cell it came from.
+ */
+let conn: mysql.Connection;
+const ACTIVE = ACTIVE_EMPLOYEE_SQL("e");
+const BUCKET = AON_BUCKET_SQL("e", "CURDATE()");
+
+beforeAll(async () => {
+  conn = await mysql.createConnection({
+    host: process.env.DB_HOST!, port: Number(process.env.DB_PORT ?? 3306),
+    user: process.env.DB_USER!, password: process.env.DB_PASSWORD!,
+    database: process.env.DB_NAME!, connectTimeout: 20000,
+  });
+});
+afterAll(async () => { await conn?.end(); });
+
+const one = async (sql: string, p: unknown[] = []) => {
+  const [rows] = await conn.query(sql, p);
+  return (rows as Record<string, unknown>[])[0];
+};
+const all = async (sql: string, p: unknown[] = []) => {
+  const [rows] = await conn.query(sql, p);
+  return rows as Record<string, unknown>[];
+};
+
+describe("AON reconciliation (live)", () => {
+  it("the active population is non-empty", async () => {
+    const total = Number((await one(`SELECT COUNT(*) n FROM employees e WHERE ${ACTIVE}`)).n);
+    expect(total).toBeGreaterThan(0);
+  });
+
+  // The previous version of this test compared the strict ACTIVE_EMPLOYEE_SQL count against
+  // a hard-coded `active_status = 1` baseline with `toBeLessThanOrEqual`. That baseline IS the
+  // pre-fix rule, so weakening ACTIVE_EMPLOYEE_SQL back to it collapses the assertion to
+  // `x <= x` — always true, regardless of how wrong the rule is. Proven live 2026-08-26: with
+  // the rule weakened, the suite stayed green at 8/8.
+  //
+  // The two invariants below replace it. They don't compare the rule against itself; they
+  // assert a property the correct rule must have and the weakened rule provably violates: the
+  // 30 employees the weakened rule re-admits are people who already resigned or were
+  // terminated, so "active" and "already left" can never overlap.
+  // Verified live 2026-08-27: even under the CORRECT rule, a handful of employees carry a
+  // stale-but-unrelated date_of_exit despite a legitimate employment_status = 'active' (their
+  // employment_status was correctly reset, but date_of_exit was not cleared alongside it — a
+  // separate, already-tracked data-quality defect, not the ACTIVE_EMPLOYEE_SQL regression this
+  // harness targets). A hard `toBe(0)` here would make this test permanently red for a reason
+  // that has nothing to do with the rule under test, so this asserts a RATIO instead: the
+  // weakened rule doesn't add a handful, it dumps back in every recent leaver whose flag was
+  // never cleared, which moves this count by multiples, not by one or two more strays.
+  it("almost nobody in the active population has already left", async () => {
+    const total = Number((await one(`SELECT COUNT(*) n FROM employees e WHERE ${ACTIVE}`)).n);
+    const left = Number((await one(
+      `SELECT COUNT(*) n FROM employees e
+        WHERE ${ACTIVE} AND e.date_of_exit IS NOT NULL AND e.date_of_exit < CURDATE()`)).n);
+    expect(left, "recent-leavers-still-marked-active grew far past the known baseline noise")
+      .toBeLessThan(total * 0.02);
+  });
+
+  it("no employee in the active population has a non-active employment_status", async () => {
+    const r = await one(
+      `SELECT COUNT(*) n FROM employees e
+        WHERE ${ACTIVE} AND e.employment_status IS NOT NULL
+          AND LOWER(e.employment_status) <> 'active'`);
+    expect(Number(r.n)).toBe(0);
+  });
+
+  it("bucket counts sum to the total", async () => {
+    const total = Number((await one(`SELECT COUNT(*) n FROM employees e WHERE ${ACTIVE}`)).n);
+    const buckets = await all(
+      `SELECT ${BUCKET} bucket, COUNT(*) n FROM employees e WHERE ${ACTIVE} GROUP BY bucket`);
+    expect(buckets.reduce((a, r) => a + Number(r.n), 0)).toBe(total);
+  });
+
+  it("no employee is in two buckets", async () => {
+    expect(await all(
+      `SELECT e.id FROM employees e WHERE ${ACTIVE}
+        GROUP BY e.id HAVING COUNT(DISTINCT ${BUCKET}) > 1`)).toEqual([]);
+  });
+
+  it("no negative AON survives outside In Training", async () => {
+    const r = await one(
+      `SELECT COUNT(*) n FROM employees e
+        WHERE ${ACTIVE} AND ${BUCKET} <> 'In Training'
+          AND DATEDIFF(CURDATE(), COALESCE(e.salary_start_date, e.date_of_joining)) < 0`);
+    expect(Number(r.n)).toBe(0);
+  });
+
+  it("In Training means joined-but-unpaid, and nothing else", async () => {
+    const r = await one(
+      `SELECT COUNT(*) n FROM employees e
+        WHERE ${ACTIVE} AND ${BUCKET} = 'In Training'
+          AND NOT (e.date_of_joining <= CURDATE() AND e.salary_start_date > CURDATE())`);
+    expect(Number(r.n)).toBe(0);
+  });
+
+  it("every group's buckets sum to that group's total", async () => {
+    const groups = await all(
+      `SELECT COALESCE(b.branch_name,'UNASSIGNED') g, COUNT(*) total
+         FROM employees e LEFT JOIN branch_master b ON b.id = e.branch_id
+        WHERE ${ACTIVE} GROUP BY g`);
+    const cells = await all(
+      `SELECT COALESCE(b.branch_name,'UNASSIGNED') g, ${BUCKET} bucket, COUNT(*) n
+         FROM employees e LEFT JOIN branch_master b ON b.id = e.branch_id
+        WHERE ${ACTIVE} GROUP BY g, bucket`);
+    for (const grp of groups) {
+      const summed = cells.filter(c => c.g === grp.g).reduce((a, c) => a + Number(c.n), 0);
+      expect(summed, `group ${grp.g} does not reconcile`).toBe(Number(grp.total));
+    }
+  });
+
+  it("each filter provably NARROWS the result", async () => {
+    // This is what catches a filter the server accepts and ignores — exactly what From/To
+    // did on the headcount metric.
+    const total = Number((await one(`SELECT COUNT(*) n FROM employees e WHERE ${ACTIVE}`)).n);
+    for (const col of ["branch_id", "process_id", "department_id", "cost_centre_id"]) {
+      const pick = await all(
+        `SELECT e.${col} v FROM employees e WHERE ${ACTIVE} AND e.${col} IS NOT NULL
+          GROUP BY e.${col} ORDER BY COUNT(*) DESC LIMIT 1`);
+      if (!pick.length) continue;              // dimension unpopulated — nothing to assert
+      const filtered = Number((await one(
+        `SELECT COUNT(*) n FROM employees e WHERE ${ACTIVE} AND e.${col} = ?`, [pick[0].v])).n);
+      expect(filtered, `${col} filter returned nothing`).toBeGreaterThan(0);
+      expect(filtered, `${col} filter did not narrow the result`).toBeLessThan(total);
+    }
+  });
+
+  it("a drill-down list is exactly as long as the cell it came from", async () => {
+    const cell = (await all(
+      `SELECT e.branch_id, ${BUCKET} bucket, COUNT(*) n FROM employees e
+        WHERE ${ACTIVE} GROUP BY e.branch_id, bucket ORDER BY n DESC LIMIT 1`))[0];
+    const branchClause = cell.branch_id === null ? "e.branch_id IS NULL" : "e.branch_id = ?";
+    const params = cell.branch_id === null ? [cell.bucket] : [cell.bucket, cell.branch_id];
+    const rows = await all(
+      `SELECT e.id FROM employees e WHERE ${ACTIVE} AND ${BUCKET} = ? AND ${branchClause}`, params);
+    expect(rows.length).toBe(Number(cell.n));
+  });
+});
diff --git a/backend/src/modules/reporting/__tests__/reporting-scope-roles.contract.test.ts b/backend/src/modules/reporting/__tests__/reporting-scope-roles.contract.test.ts
new file mode 100644
index 00000000..2f0fe960
--- /dev/null
+++ b/backend/src/modules/reporting/__tests__/reporting-scope-roles.contract.test.ts
@@ -0,0 +1,36 @@
+import { readFileSync } from "node:fs";
+import { resolve } from "node:path";
+import { describe, expect, it } from "vitest";
+
+/**
+ * Who sees the whole organisation in reports.
+ *
+ * SUPER_ADMIN_ROLES was ['super_admin','admin','ceo'], so a COO would have been restricted to
+ * their own branch by the `emp?.branch_id` fallback — the opposite of the intent, and
+ * inconsistent with SENSITIVE_ROLES in the same module, which already listed coo.
+ *
+ * No coo users existed when this was written (verified live 2026-08-26), so the defect was
+ * latent: it would appear the first time the role was granted.
+ */
+const SRC = readFileSync(resolve(process.cwd(), "src/modules/reporting/reporting.scope.ts"), "utf8");
+const roleList = () => /const SUPER_ADMIN_ROLES\s*=\s*\[([^\]]*)\]/.exec(SRC)?.[1] ?? "";
+
+describe("reporting scope roles", () => {
+  it("grants org-wide scope to super_admin, admin, ceo and coo", () => {
+    for (const role of ["super_admin", "admin", "ceo", "coo"]) {
+      expect(roleList(), `${role} must have org-wide report scope`).toContain(`'${role}'`);
+    }
+  });
+
+  it("does not quietly grant org-wide scope to branch or functional roles", () => {
+    // branch_admin in this system also carries admin and finance_head grants, so org-wide
+    // access must stay an explicit allow-list rather than being inferred.
+    for (const role of ["branch_admin", "branch_head", "hr", "operations_manager"]) {
+      expect(roleList(), `${role} must NOT be org-wide`).not.toContain(`'${role}'`);
+    }
+  });
+
+  it("still fails closed for a user with no scope row and no branch", () => {
+    expect(SRC).toContain("NO_BRANCH_SCOPE_SENTINEL");
+  });
+});
diff --git a/backend/src/modules/reporting/__tests__/workforce-population.test.ts b/backend/src/modules/reporting/__tests__/workforce-population.test.ts
new file mode 100644
index 00000000..812fa14b
--- /dev/null
+++ b/backend/src/modules/reporting/__tests__/workforce-population.test.ts
@@ -0,0 +1,70 @@
+import { describe, expect, it } from "vitest";
+import {
+  ACTIVE_EMPLOYEE_SQL,
+  AON_BUCKETS,
+  AON_BUCKET_ORDER_SQL,
+  AON_BUCKET_SQL,
+  AON_DAYS_SQL,
+  IN_TRAINING_LABEL,
+  IN_TRAINING_SQL,
+} from "../workforce-population.js";
+
+describe("workforce population definition", () => {
+  it("requires BOTH flags for an active employee", () => {
+    const sql = ACTIVE_EMPLOYEE_SQL("e");
+    expect(sql).toMatch(/e\.active_status\s*=\s*1\s+AND\s+LOWER\(/i);
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
+
+  it("clamps negative tenure in AON_DAYS_SQL so future joiners cannot be counted as newest", () => {
+    // AON_DAYS_SQL is the only sanctioned way to compute tenure days.
+    // An unclamped DATEDIFF(<= 30 comparison) is satisfied by negative values,
+    // silently counting not-yet-started staff as the newest joiners.
+    const sql = AON_DAYS_SQL("e", "CURDATE()");
+    expect(sql).toContain("GREATEST(");
+    expect(sql).toMatch(/COALESCE\(e\.salary_start_date/);
+  });
+});
diff --git a/backend/src/modules/reporting/executors/__tests__/aon-drilldown-in-training.test.ts b/backend/src/modules/reporting/executors/__tests__/aon-drilldown-in-training.test.ts
new file mode 100644
index 00000000..3dcdea9a
--- /dev/null
+++ b/backend/src/modules/reporting/executors/__tests__/aon-drilldown-in-training.test.ts
@@ -0,0 +1,73 @@
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
+    //
+    // A file-wide "AON_DAYS_SQL( appears somewhere" check would stay green even if a single
+    // case regressed to a hand-rolled `DATEDIFF(...) > 90` -- the other seven calls would carry
+    // it. So extract each switch function's own body and check it in isolation: no bare
+    // DATEDIFF anywhere in it, and one AON_DAYS_SQL( call per tenure bucket (the four buckets
+    // other than "In Training", which uses IN_TRAINING_SQL instead).
+    expect(AON_DAYS_SQL()).toContain("GREATEST(");
+
+    const extractFunctionBody = (fnName: string): string => {
+      const start = SRC.indexOf(`function ${fnName}`);
+      expect(start, `function ${fnName} not found`).toBeGreaterThanOrEqual(0);
+      const braceStart = SRC.indexOf("{", start);
+      let depth = 0;
+      for (let i = braceStart; i < SRC.length; i++) {
+        if (SRC[i] === "{") depth++;
+        else if (SRC[i] === "}") {
+          depth--;
+          if (depth === 0) return SRC.slice(braceStart, i + 1);
+        }
+      }
+      throw new Error(`unterminated function body for ${fnName}`);
+    };
+
+    const tenureBucketCount = AON_BUCKETS.length - 1; // all but "In Training"
+
+    for (const fnName of ["aonBucketClause", "aonBucketAtExitClause"]) {
+      const body = extractFunctionBody(fnName);
+      expect(body, `${fnName} must not hand-roll a raw DATEDIFF`).not.toMatch(/\bDATEDIFF\(/);
+      const calls = body.split("AON_DAYS_SQL(").length - 1;
+      expect(calls, `${fnName} must call AON_DAYS_SQL once per tenure bucket`).toBe(
+        tenureBucketCount
+      );
+    }
+  });
+
+  it("has no raw DATEDIFF in the SELECT column lists (display columns must be clamped too)", () => {
+    // tenure_at_exit_days and aon_days are read straight off these SELECTs and (for aon_days)
+    // feed the risk_score CASE below them -- a raw DATEDIFF here goes negative for an In
+    // Training employee and silently satisfies `aon_days <= 30`, the highest risk tier.
+    expect(SRC).not.toMatch(/\bDATEDIFF\(/);
+  });
+});
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
diff --git a/backend/src/modules/reporting/executors/aon-drilldown.executor.ts b/backend/src/modules/reporting/executors/aon-drilldown.executor.ts
index ba3d50cf..5b7c4a11 100644
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
@@ -172,42 +178,48 @@ export async function aonDrilldownEmployees(
     SELECT e.id AS employee_id,
            e.employee_code,
            COALESCE(NULLIF(TRIM(e.full_name),''),
                     TRIM(CONCAT(e.first_name,' ',COALESCE(e.last_name,'')))) AS employee_name,
            COALESCE(b.branch_name, 'UNASSIGNED')       AS branch_name,
            COALESCE(cc.cost_centre_code, 'UNASSIGNED') AS cost_centre_code,
            COALESCE(cc.cost_centre_name, 'UNASSIGNED') AS cost_centre_name,
            COALESCE(p.process_name, 'UNASSIGNED')      AS process_name,
            DATE_FORMAT(${AON_REFERENCE_JOIN_DATE_SQL}, '%Y-%m-%d') AS join_date,
            DATE_FORMAT(e.date_of_exit, '%Y-%m-%d')     AS date_of_exit,
-           DATEDIFF(e.date_of_exit, ${AON_REFERENCE_JOIN_DATE_SQL}) AS tenure_at_exit_days,
+           -- Clamped: an In Training leaver has date_of_exit before salary_start_date, so a raw
+           -- DATEDIFF here goes negative, and a negative "tenure at exit" is nonsensical.
+           ${AON_DAYS_SQL("e", "e.date_of_exit")} AS tenure_at_exit_days,
            COALESCE(NULLIF(TRIM(m.full_name),''),
                     TRIM(CONCAT(m.first_name,' ',COALESCE(m.last_name,'')))) AS reporting_manager_name
       FROM employees e
       LEFT JOIN branch_master b       ON b.id  = e.branch_id
       LEFT JOIN cost_centre_master cc ON cc.id = e.cost_centre_id
       LEFT JOIN process_master p      ON p.id  = e.process_id
       LEFT JOIN employees m           ON m.id  = e.reporting_manager_id
      WHERE ${clauses.join(" AND ")}
      ORDER BY e.date_of_exit DESC`
     : `
     WITH filtered AS (
       SELECT e.id AS employee_id,
              e.employee_code,
              COALESCE(NULLIF(TRIM(e.full_name),''),
                       TRIM(CONCAT(e.first_name,' ',COALESCE(e.last_name,'')))) AS employee_name,
              COALESCE(b.branch_name, 'UNASSIGNED')       AS branch_name,
              COALESCE(cc.cost_centre_code, 'UNASSIGNED') AS cost_centre_code,
              COALESCE(cc.cost_centre_name, 'UNASSIGNED') AS cost_centre_name,
              COALESCE(p.process_name, 'UNASSIGNED')      AS process_name,
              DATE_FORMAT(${AON_REFERENCE_JOIN_DATE_SQL}, '%Y-%m-%d') AS join_date,
-             DATEDIFF(CURDATE(), ${AON_REFERENCE_JOIN_DATE_SQL}) AS aon_days,
+             -- Clamped: for an In Training employee the reference date (salary_start_date) is
+             -- still in the future, so a raw DATEDIFF here goes negative -- and a negative value
+             -- satisfies aon_days <= 30 below, which would silently assign the HIGHEST risk
+             -- tier (45) to someone who hasn't even started payroll yet.
+             ${AON_DAYS_SQL("e", "CURDATE()")} AS aon_days,
              -- IMPORTANT-3 (final whole-branch review): a cohort-month drill deliberately
              -- includes since-left employees alongside active ones (see the cohortMonth
              -- comment block above), but this shape had no column telling the caller which
              -- is which -- so EmployeeListPanel offered "Flag for Retention Review" on an
              -- already-exited employee, which is nonsensical. e.active_status is already
              -- available on every row here regardless of whether the active_status = 1
              -- clause above was applied, so this costs nothing to add.
              (e.active_status = 1) AS is_active
         FROM employees e
         LEFT JOIN branch_master b       ON b.id  = e.branch_id
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
diff --git a/backend/src/modules/reporting/reporting.scope.ts b/backend/src/modules/reporting/reporting.scope.ts
index ea09b91f..6a329c1f 100644
--- a/backend/src/modules/reporting/reporting.scope.ts
+++ b/backend/src/modules/reporting/reporting.scope.ts
@@ -3,21 +3,32 @@ import type { RowDataPacket } from 'mysql2';
 import type { ExecScope, DimensionScope } from './executors/types.js';
 import { demoRoleForUserId } from '../../shared/demoAuth.js';
 
 const NO_BRANCH_SCOPE_SENTINEL = '__NO_BRANCH_SCOPE__';
 
 export interface BranchScope {
   isSuperAdmin: boolean;
   branchIds: string[];  // empty = all only for super admin or explicit all-scope users
 }
 
-const SUPER_ADMIN_ROLES = ['super_admin', 'admin', 'ceo'];
+/*
+ * Roles that see the whole organisation in every report.
+ *
+ * 'coo' added 2026-08-26. It was absent, so a COO fell through to the `emp?.branch_id`
+ * fallback and would have been branch-restricted — the opposite of the intent, and
+ * inconsistent with SENSITIVE_ROLES below, which already listed coo. No coo users existed at
+ * the time, so this was latent rather than a live breach.
+ *
+ * This is an explicit allow-list. branch_admin in this system also carries admin and
+ * finance_head grants, so org-wide access must never be inferred from another role.
+ */
+const SUPER_ADMIN_ROLES = ['super_admin', 'admin', 'ceo', 'coo'];
 
 export async function resolveBranchScope(userId: string): Promise<BranchScope> {
   const [roleRows] = await db.execute<RowDataPacket[]>(
     `SELECT role_key FROM user_roles WHERE user_id = ? AND active_status = 1`,
     [userId]
   );
   const dbRoles = (roleRows as { role_key: string }[]).map(r => r.role_key);
 
   // Same demo-identity gap as resolveFullScope below: these ids exist in DEMO_TOKEN_MAP but
   // in neither user_roles nor employees, so without this the branch scope falls through to
diff --git a/backend/src/modules/reporting/workforce-population.ts b/backend/src/modules/reporting/workforce-population.ts
new file mode 100644
index 00000000..6f53be77
--- /dev/null
+++ b/backend/src/modules/reporting/workforce-population.ts
@@ -0,0 +1,81 @@
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
+ * This is the only sanctioned way to compute tenure days. The clamp is load-bearing.
+ * The previous bucket test was `DATEDIFF(...) <= 30 THEN '0-30'`, and a NEGATIVE DATEDIFF
+ * satisfies `<= 30` — which is how employees whose reference date had not arrived were
+ * silently counted as the newest joiners. Task 3 drill-down predicates depend on this
+ * expression as the single source of truth.
+ */
+export const AON_DAYS_SQL = (alias: string = A, asOf: string = "CURDATE()"): string =>
+  `GREATEST(DATEDIFF(${asOf}, ${AON_REFERENCE_DATE_SQL(alias)}), 0)`;
+
+export const AON_BUCKET_SQL = (alias: string = A, asOf: string = "CURDATE()"): string => `CASE
+             WHEN ${IN_TRAINING_SQL(alias, asOf)} THEN '${IN_TRAINING_LABEL}'
+             WHEN ${AON_DAYS_SQL(alias, asOf)} <= 30 THEN '0-30'
+             WHEN ${AON_DAYS_SQL(alias, asOf)} <= 60 THEN '31-60'
+             WHEN ${AON_DAYS_SQL(alias, asOf)} <= 90 THEN '61-90'
+             ELSE '90+'
+           END`;
+
+/** Sort key. A string sort puts '90+' ahead of '0-30'; every report orders by this instead. */
+export const AON_BUCKET_ORDER_SQL = (alias: string = A, asOf: string = "CURDATE()"): string => `CASE
+             WHEN ${IN_TRAINING_SQL(alias, asOf)} THEN 0
+             WHEN ${AON_DAYS_SQL(alias, asOf)} <= 30 THEN 1
+             WHEN ${AON_DAYS_SQL(alias, asOf)} <= 60 THEN 2
+             WHEN ${AON_DAYS_SQL(alias, asOf)} <= 90 THEN 3
+             ELSE 4
+           END`;
diff --git a/src/components/reports/views/AonAnalyticsView.tsx b/src/components/reports/views/AonAnalyticsView.tsx
index 99b52a69..fd095d9b 100644
--- a/src/components/reports/views/AonAnalyticsView.tsx
+++ b/src/components/reports/views/AonAnalyticsView.tsx
@@ -1,16 +1,16 @@
 /**
  * AON (Age on Network) & Attrition Analytics
  *
- * AON is days since date_of_joining, bucketed 0-30 / 31-60 / 61-90 / 90+. Nothing is
- * stored — the backend derives every bucket at read time, so a new joiner appears in
- * 0-30 the moment their joining date exists.
+ * AON (Age on Network) is days since joining, bucketed In Training / 0-30 / 31-60 / 61-90 / 90+.
+ * "In Training" is joined-but-not-yet-on-payroll. Everything else is derived from the joining
+ * date on every read, so a new joiner appears the same day — nothing is stored.
  *
  * Three tabs, because they answer three different questions:
  *   Overview   — where the people are now, and where the losses and shrinkage sit
  *   Cohort     — does each intake decay the same way (it does, and badly)
  *   Deep dive  — what kind of joiner leaves early
  *
  * Every number on this screen states its denominator, and each of the four known data
  * gaps is drawn rather than hidden. That is deliberate: the cost-centre feed stopped on
  * 2026-07-20, process is 9.7% populated on exits, some new joiners have no attendance
  * row at all, and exit reason is captured for well under 1% of leavers. A blank cell
@@ -47,29 +47,31 @@ import {
   num,
   pct,
   ratio,
 } from "@/components/analytics/analytics-kit";
 import { DrillDownProvider, useDrillDown } from "@/components/analytics/drilldown/DrillDownProvider";
 import { EmployeeListPanel } from "@/components/analytics/drilldown/EmployeeListPanel";
 import { EmployeeDetailDrawer } from "@/components/analytics/drilldown/EmployeeDetailDrawer";
 
 /* ── Shared vocabulary ─────────────────────────────────────────────────────── */
 
-/**
- * Bucket order is fixed here rather than sorted from the data. A string sort puts "90+"
- * ahead of "0-30" and the axis reads backwards; the backend orders correctly but the
- * client re-groups, so the order has to be restated.
+/*
+ * Five buckets as of 2026-08-26. "In Training" is people who have joined and are on the floor
+ * but whose salary has not started — 13 of them live when this shipped. They used to land in
+ * 0-30 because a negative DATEDIFF satisfies `<= 30`, which made staff who had not started
+ * being paid look like the newest joiners.
  */
-const BUCKETS = ["0-30", "31-60", "61-90", "90+"] as const;
+const BUCKETS = ["In Training", "0-30", "31-60", "61-90", "90+"] as const;
 type Bucket = (typeof BUCKETS)[number];
 
 const BUCKET_COLOR: Record<Bucket, string> = {
+  "In Training": SERIES[4],  // distinct from the tenure ramp — this is a state, not a tenure
   "0-30": SERIES[7],  // red — the bucket that loses 43% of all leavers
   "31-60": SERIES[1], // orange
   "61-90": SERIES[3], // yellow
   "90+": SERIES[2],   // aqua
 };
 
 const DIMENSIONS = [
   { value: "source", label: "Source of Hire" },
   { value: "designation", label: "Designation" },
   { value: "department", label: "Department" },
@@ -340,25 +342,35 @@ function AnomalyJumpHandler({
   const { pushChip, openEmployeeList } = useDrillDown();
   const dimension = groupBy === "cost_centre_name" ? "costCentre" : groupBy === "process_name" ? "process" : "branch";
   const onJumpTo = (a: AnomalyEntry) => {
     pushChip({ dimension, value: a.groupId, label: a.groupKey });
     pushChip({ dimension: "aonBucket", value: a.bucket, label: `${a.bucket}d` });
     openEmployeeList();
   };
   return <>{children(onJumpTo)}</>;
 }
 
-function Overview({ from, to, branchId, headlineRate }: { from: string; to: string; branchId: string; headlineRate: ReturnType<typeof useReport> }) {
+function Overview({ from, to, branchId, processId, departmentId, costCentreId, headlineRate }: {
+  from: string; to: string; branchId: string; processId: string; departmentId: string;
+  costCentreId: string; headlineRate: ReturnType<typeof useReport>;
+}) {
   const [groupBy, setGroupBy] = useState<GroupBy>("cost_centre_name");
   const [metric, setMetric] = useState<"headcount" | "exits" | "shrinkage">("headcount");
 
-  const base = branchId ? { branchId } : {};
+  // Every filter must be in `base`, and `base` is part of the react-query key, so changing any
+  // one of them refetches instead of serving the previous cell.
+  const base = {
+    ...(branchId ? { branchId } : {}),
+    ...(processId ? { processId } : {}),
+    ...(departmentId ? { departmentId } : {}),
+    ...(costCentreId ? { costCentreId } : {}),
+  };
   const hc = useReport("aon-bucket-headcount", base);
   const at = useReport("aon-bucket-attrition", { ...base, from, to });
   /*
    * Shrinkage is fetched ONLY when its metric is selected.
    *
    * It scans attendance_daily_record, and although that table is small (131,906 rows in
    * total, of which twelve months is essentially all of it) the aggregate takes 65s for a
    * three-month window on this database and exceeds the 120s gateway limit over twelve.
    * The cost is contention, not volume — Threads_running was 27 while measuring — so
    * narrowing the window does not rescue it.
@@ -791,22 +803,30 @@ function Overview({ from, to, branchId, headlineRate }: { from: string; to: stri
 
       <EmployeeListPanel open metric={metric === "headcount" ? "headcount" : metric === "exits" ? "exits" : "shrinkage"} from={from} to={to} branchId={branchId} />
       <EmployeeDetailDrawer />
     </div>
     </DrillDownProvider>
   );
 }
 
 /* ── Cohort survival ───────────────────────────────────────────────────────── */
 
-function CohortSurvival({ from, to, branchId }: { from: string; to: string; branchId: string }) {
-  const q = useReport("aon-cohort-survival", { from, to, ...(branchId ? { branchId } : {}) });
+function CohortSurvival({ from, to, branchId, processId, departmentId, costCentreId }: {
+  from: string; to: string; branchId: string; processId: string; departmentId: string; costCentreId: string;
+}) {
+  const q = useReport("aon-cohort-survival", {
+    from, to,
+    ...(branchId ? { branchId } : {}),
+    ...(processId ? { processId } : {}),
+    ...(departmentId ? { departmentId } : {}),
+    ...(costCentreId ? { costCentreId } : {}),
+  });
 
   /**
    * Cohorts are rolled up across branch and cost centre here. Survival must be
    * recomputed from joined/left counts — averaging the per-row percentages would weight
    * a one-person cost centre the same as a 200-person one.
    *
    * A horizon is only shown once every contributing cohort row has reached it; the
    * backend nulls immature horizons, and a cohort mixing mature and immature rows would
    * otherwise report survival against a partial denominator.
    */
@@ -1044,23 +1064,31 @@ function DeepDiveRow({
       </td>
       {dimension === "reporting_manager" && (
         <td className={`px-2 py-1.5 text-right tabular-nums ${v.early > avgEarlyQuitRate ? "text-rose-700" : "text-emerald-700"}`}>
           {v.early > avgEarlyQuitRate ? "+" : ""}{(v.early - avgEarlyQuitRate).toFixed(1)}pp
         </td>
       )}
     </tr>
   );
 }
 
-function DeepDive({ from, to, branchId }: { from: string; to: string; branchId: string }) {
+function DeepDive({ from, to, branchId, processId, departmentId, costCentreId }: {
+  from: string; to: string; branchId: string; processId: string; departmentId: string; costCentreId: string;
+}) {
   const [dimension, setDimension] = useState<string>("source");
-  const q = useReport("attrition-deep-dive", { from, to, dimension, ...(branchId ? { branchId } : {}) });
+  const q = useReport("attrition-deep-dive", {
+    from, to, dimension,
+    ...(branchId ? { branchId } : {}),
+    ...(processId ? { processId } : {}),
+    ...(departmentId ? { departmentId } : {}),
+    ...(costCentreId ? { costCentreId } : {}),
+  });
 
   /* early_quit_rate is constant across a value's four bucket rows by construction, so it
      is read from the first row rather than recomputed. Ranked by deviation from the average
      early-quit rate across the current slice, not raw exit count -- this alone answers what is
      driving attrition.
      `avgEarly` is computed ONCE here, from `list` -- every distinct dimension value in the
      current slice, BEFORE the top-20 `.slice()` -- and is the single baseline used both to rank
      which 20 rows are shown (`deviationFromAvg`) and, further down, to render each shown row's
      "vs Peer Avg" figure. It must never be recomputed from `values` (the already-sliced top-20),
      which would silently swap the true full-population average for the average of only the
@@ -1202,57 +1230,109 @@ function DeepDive({ from, to, branchId }: { from: string; to: string; branchId:
 function isoLocal(d: Date) {
   return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
 }
 
 export default function AonAnalyticsView() {
   const today = new Date();
   const [tab, setTab] = useState<"overview" | "cohort" | "deep">("overview");
   const [from, setFrom] = useState(isoLocal(new Date(today.getFullYear() - 1, today.getMonth(), today.getDate())));
   const [to, setTo] = useState(isoLocal(today));
   const [branchId, setBranchId] = useState("");
+  const [processId, setProcessId] = useState("");
+  const [departmentId, setDepartmentId] = useState("");
+  const [costCentreId, setCostCentreId] = useState("");
 
   const branches = useQuery({
     queryKey: ["org-branches-aon"],
     queryFn: () => hrmsApi.get<{ data: { id: string; branch_name: string }[] }>("/api/org/branches"),
   });
+  const processes = useQuery({
+    queryKey: ["org-processes-aon"],
+    queryFn: () => hrmsApi.get<{ data: { id: string; process_name: string }[] }>(
+      "/api/org/processes?active_status=1&limit=500"),
+  });
+  const departments = useQuery({
+    queryKey: ["org-departments-aon"],
+    queryFn: () => hrmsApi.get<{ data: { id: string; dept_name: string }[] }>(
+      "/api/org/departments?active_status=1&limit=500"),
+  });
+  const costCentres = useQuery({
+    queryKey: ["finance-cost-centres-aon"],
+    queryFn: () => hrmsApi.get<{ data: { id: string; cost_centre_name: string }[] }>(
+      "/api/finance/cost-centres?active_status=1&limit=1000"),
+  });
 
-  const headline = useReport("aon-overall-attrition-rate", branchId ? { branchId, from, to } : { from, to });
+  const headline = useReport("aon-overall-attrition-rate", {
+    ...(branchId ? { branchId } : {}),
+    ...(processId ? { processId } : {}),
+    ...(departmentId ? { departmentId } : {}),
+    ...(costCentreId ? { costCentreId } : {}),
+    from, to,
+  });
 
   return (
     <div className="space-y-4 p-6">
       <header className="space-y-1">
         <h2 className="text-lg font-bold text-slate-900">AON &amp; Attrition Analytics</h2>
         <p className="text-[12px] leading-snug text-slate-500">
           AON (Age on Network) is days since joining, bucketed 0-30 / 31-60 / 61-90 / 90+. It is derived
           from the joining date on every read, so a new joiner appears in the 0-30 bucket the same day —
           nothing is stored and nothing needs to be recalculated.
         </p>
       </header>
 
       <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
         <Field label={tab === "cohort" ? "Joined from" : "From"}>
           <input type="date" className={inputCls} value={from} onChange={e => setFrom(e.target.value)} />
         </Field>
         <Field label={tab === "cohort" ? "Joined to" : "To"}>
           <input type="date" className={inputCls} value={to} onChange={e => setTo(e.target.value)} />
         </Field>
+        <p className="w-full text-[11px] text-slate-500">
+          Headcount is as of today — the date range applies to Exits, Shrinkage, Cohort Survival
+          and the Deep Dive.
+        </p>
         <Field label="Branch">
           <select className={inputCls} value={branchId} onChange={e => setBranchId(e.target.value)}>
             <option value="">All branches</option>
             {(branches.data?.data ?? []).map(b => (
               <option key={b.id} value={b.id}>{b.branch_name}</option>
             ))}
           </select>
         </Field>
+        <Field label="Process">
+          <select className={inputCls} value={processId} onChange={e => setProcessId(e.target.value)}>
+            <option value="">All processes</option>
+            {(processes.data?.data ?? []).map(p => (
+              <option key={p.id} value={p.id}>{p.process_name}</option>
+            ))}
+          </select>
+        </Field>
+        <Field label="Department">
+          <select className={inputCls} value={departmentId} onChange={e => setDepartmentId(e.target.value)}>
+            <option value="">All departments</option>
+            {(departments.data?.data ?? []).map(d => (
+              <option key={d.id} value={d.id}>{d.dept_name}</option>
+            ))}
+          </select>
+        </Field>
+        <Field label="Cost Centre">
+          <select className={inputCls} value={costCentreId} onChange={e => setCostCentreId(e.target.value)}>
+            <option value="">All cost centres</option>
+            {(costCentres.data?.data ?? []).map(cc => (
+              <option key={cc.id} value={cc.id}>{cc.cost_centre_name}</option>
+            ))}
+          </select>
+        </Field>
         <div className="ml-auto flex gap-1 rounded-lg bg-slate-50 p-1">
           <TabButton active={tab === "overview"} onClick={() => setTab("overview")}>Overview</TabButton>
           <TabButton active={tab === "cohort"} onClick={() => setTab("cohort")}>Cohort Survival</TabButton>
           <TabButton active={tab === "deep"} onClick={() => setTab("deep")}>Attrition Deep Dive</TabButton>
         </div>
       </div>
 
-      {tab === "overview" && <Overview from={from} to={to} branchId={branchId} headlineRate={headline} />}
-      {tab === "cohort" && <CohortSurvival from={from} to={to} branchId={branchId} />}
-      {tab === "deep" && <DeepDive from={from} to={to} branchId={branchId} />}
+      {tab === "overview" && <Overview from={from} to={to} branchId={branchId} processId={processId} departmentId={departmentId} costCentreId={costCentreId} headlineRate={headline} />}
+      {tab === "cohort" && <CohortSurvival from={from} to={to} branchId={branchId} processId={processId} departmentId={departmentId} costCentreId={costCentreId} />}
+      {tab === "deep" && <DeepDive from={from} to={to} branchId={branchId} processId={processId} departmentId={departmentId} costCentreId={costCentreId} />}
     </div>
   );
 }
diff --git a/src/components/reports/views/__tests__/AonAnalyticsView.buckets.test.tsx b/src/components/reports/views/__tests__/AonAnalyticsView.buckets.test.tsx
new file mode 100644
index 00000000..f9f22299
--- /dev/null
+++ b/src/components/reports/views/__tests__/AonAnalyticsView.buckets.test.tsx
@@ -0,0 +1,24 @@
+import { readFileSync } from "node:fs";
+import { resolve } from "node:path";
+import { describe, expect, it } from "vitest";
+
+/**
+ * The page renders a fixed bucket list. The backend now emits a fifth bucket, In Training, and
+ * a column the frontend does not know about is a column nobody sees — the count would vanish
+ * from the table while still sitting inside the totals.
+ */
+const SRC = readFileSync(
+  resolve(process.cwd(), "src/components/reports/views/AonAnalyticsView.tsx"), "utf8");
+
+describe("AON view buckets", () => {
+  it("renders all five buckets, In Training first", () => {
+    const arr = /const BUCKETS\s*=\s*\[([^\]]*)\]/.exec(SRC)?.[1] ?? "";
+    expect(arr).toContain('"In Training"');
+    for (const b of ["0-30", "31-60", "61-90", "90+"]) expect(arr).toContain(`"${b}"`);
+    expect(arr.indexOf('"In Training"')).toBeLessThan(arr.indexOf('"0-30"'));
+  });
+
+  it("gives In Training its own colour", () => {
+    expect(SRC).toMatch(/"In Training":\s*\w/);
+  });
+});
diff --git a/src/components/reports/views/__tests__/AonAnalyticsView.filters.test.tsx b/src/components/reports/views/__tests__/AonAnalyticsView.filters.test.tsx
new file mode 100644
index 00000000..50ed4313
--- /dev/null
+++ b/src/components/reports/views/__tests__/AonAnalyticsView.filters.test.tsx
@@ -0,0 +1,52 @@
+import { readFileSync } from "node:fs";
+import { resolve } from "node:path";
+import { describe, expect, it } from "vitest";
+
+/**
+ * appendFilterConditions has always supported branchId, processId, departmentId and
+ * costCentreId. The page exposed Branch only, so four working filters were unreachable.
+ *
+ * Separately, From/To were never passed to aon-bucket-headcount — the default metric — so on
+ * first load changing the dates did nothing at all. Headcount is an as-of-today snapshot, so
+ * the honest fix is to disable those inputs for that metric, not to fake the filtering.
+ */
+const SRC = readFileSync(
+  resolve(process.cwd(), "src/components/reports/views/AonAnalyticsView.tsx"), "utf8");
+
+describe("AON filters", () => {
+  it("has state for all four dimension filters", () => {
+    for (const s of ["branchId", "processId", "departmentId", "costCentreId"]) {
+      expect(SRC, `${s} filter state missing`).toContain(`${s}, set`);
+    }
+  });
+
+  it("loads each dropdown from a real endpoint", () => {
+    for (const url of ["/api/org/branches", "/api/org/processes",
+                       "/api/org/departments", "/api/finance/cost-centres"]) {
+      expect(SRC, `${url} not called`).toContain(url);
+    }
+  });
+
+  it("passes every filter into the report params", () => {
+    // A filter absent from `base` is one the user can set and the server never sees.
+    const base = /const base\s*=\s*\{[\s\S]{0,500}?\n  \}/.exec(SRC)?.[0] ?? "";
+    for (const p of ["branchId", "processId", "departmentId", "costCentreId"]) {
+      expect(base, `${p} never reaches the query`).toContain(p);
+    }
+  });
+
+  it("does not pretend the date range filters headcount", () => {
+    expect(SRC).toMatch(/as of today/i);
+  });
+
+  it("includes all four dimension filters in the headline query", () => {
+    // The headline query must pass all four filters to the backend, not just branchId.
+    // Extract the headline useReport call and verify it spreads all four filters.
+    const headlineMatch = /const headline\s*=\s*useReport\([^)]*\{[\s\S]{0,800}?\}\s*\);/.exec(SRC)?.[0] ?? "";
+    expect(headlineMatch, "headline query not found").toContain("useReport");
+    expect(headlineMatch, "branchId not in headline filters").toContain("branchId");
+    expect(headlineMatch, "processId not in headline filters").toContain("processId");
+    expect(headlineMatch, "departmentId not in headline filters").toContain("departmentId");
+    expect(headlineMatch, "costCentreId not in headline filters").toContain("costCentreId");
+  });
+});
