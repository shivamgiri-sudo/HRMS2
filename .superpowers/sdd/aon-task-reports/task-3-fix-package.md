diff --git a/backend/src/modules/reporting/executors/__tests__/aon-drilldown-in-training.test.ts b/backend/src/modules/reporting/executors/__tests__/aon-drilldown-in-training.test.ts
index 2220ca88..3dcdea9a 100644
--- a/backend/src/modules/reporting/executors/__tests__/aon-drilldown-in-training.test.ts
+++ b/backend/src/modules/reporting/executors/__tests__/aon-drilldown-in-training.test.ts
@@ -22,14 +22,52 @@ describe("aon drill-down bucket predicates", () => {
     // from date_of_exit. On the exits side In Training means "left before payroll started".
     const occurrences = SRC.split(`"In Training"`).length - 1;
     expect(occurrences, "In Training must appear in both switches").toBeGreaterThanOrEqual(2);
   });
 
   it("clamps tenure so no predicate can match a negative", () => {
     // Task 1 moved the clamp into the shared AON_DAYS_SQL helper -- a hand-rolled GREATEST(...)
     // here would just re-create the divergence that helper exists to eliminate. So the property
     // under test is "the drill-down delegates its tenure math to that helper", proven two ways:
     // the source wires through it, and the helper itself is the one place GREATEST() lives.
-    expect(SRC).toContain("AON_DAYS_SQL(");
+    //
+    // A file-wide "AON_DAYS_SQL( appears somewhere" check would stay green even if a single
+    // case regressed to a hand-rolled `DATEDIFF(...) > 90` -- the other seven calls would carry
+    // it. So extract each switch function's own body and check it in isolation: no bare
+    // DATEDIFF anywhere in it, and one AON_DAYS_SQL( call per tenure bucket (the four buckets
+    // other than "In Training", which uses IN_TRAINING_SQL instead).
     expect(AON_DAYS_SQL()).toContain("GREATEST(");
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
   });
 });
diff --git a/backend/src/modules/reporting/executors/aon-drilldown.executor.ts b/backend/src/modules/reporting/executors/aon-drilldown.executor.ts
index 858fd039..5b7c4a11 100644
--- a/backend/src/modules/reporting/executors/aon-drilldown.executor.ts
+++ b/backend/src/modules/reporting/executors/aon-drilldown.executor.ts
@@ -178,42 +178,48 @@ export async function aonDrilldownEmployees(
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
