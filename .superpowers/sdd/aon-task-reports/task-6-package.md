d282856b Task 6: Wire all four filters to headline KPI query
b193a591 feat(aon): expose process, department and cost-centre filters
 src/components/reports/views/AonAnalyticsView.tsx  | 98 +++++++++++++++++++---
 .../__tests__/AonAnalyticsView.filters.test.tsx    | 52 ++++++++++++
 2 files changed, 140 insertions(+), 10 deletions(-)
diff --git a/src/components/reports/views/AonAnalyticsView.tsx b/src/components/reports/views/AonAnalyticsView.tsx
index b25a7f08..fd095d9b 100644
--- a/src/components/reports/views/AonAnalyticsView.tsx
+++ b/src/components/reports/views/AonAnalyticsView.tsx
@@ -342,25 +342,35 @@ function AnomalyJumpHandler({
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
@@ -793,22 +803,30 @@ function Overview({ from, to, branchId, headlineRate }: { from: string; to: stri
 
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
@@ -1046,23 +1064,31 @@ function DeepDiveRow({
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
@@ -1204,57 +1230,109 @@ function DeepDive({ from, to, branchId }: { from: string; to: string; branchId:
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
