diff --git a/src/components/reports/views/AonAnalyticsView.tsx b/src/components/reports/views/AonAnalyticsView.tsx
index 99b52a69..b25a7f08 100644
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
