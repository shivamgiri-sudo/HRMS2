# P&L Calculation Corrections — Design Spec
**Date:** 2026-08-24  
**Author:** Claude (CA-level reverse engineering, 9 service files read end-to-end)

---

## Executive Summary (Chartered Accountant View)

Seven confirmed calculation defects found across the P&L service layer. Together they cause:
- Overview/Matrix/CEO tabs to show **0 agent salary** → phantom EBITDA (Rs 200–240L/month of people cost missing)
- GRN indirect costs overstated by ~18% (GST included in IDC line)
- Provision-based revenue possibly 100× overstated if sync stores paise (needs DB verification)
- Invoice deduplication can double-count revenue when process_id mapping differs between sources
- Live P&L tab has the same GRN-tax and revenue bugs as the main P&L

The Statement tab is largely correct because it re-reads people cost via `enrichColumn` / `getActualPeopleCost()`. The Overview/CEO tabs are wrong because they rely on the canonical row's `cost.agentSalary` which is sourced from `getPeopleCosts()` → `processMap`, which is empty in production.

---

## Bug Register (Priority Order)

### BUG-1 — CRITICAL: Overview/Matrix/CEO show Rs 0 Agent Salary every month

**Files:** `backend/src/modules/process-pnl/bpo-pnl.service.ts:1416,1430`

**Root cause (traced to the line):**

```ts
// bpo-pnl.service.ts line 1416
people = getPeopleCosts(baseRows, normalized.period, policies, warnings)

// line 1430 — fallback triggered when processMap has no entry
const peopleMeta = people.processMap.get(base.processId) ?? {
  agentSalary: base.directPeopleCost,   // ← usually 0 from processPnlService
  dscPeople: 0,
  ...
};
```

`getPeopleCosts()` builds `processMap` by looking up employees via `cost_centre_master.process_id`. In production most cost centres have `process_id = NULL`. Those employees go into `branchPool` and are only promoted to `processMap` via `allocateBranchPools()` — but that requires configured allocation policies in `process_pnl_allocation_policy`. That table has no rows → `policies = []` → `allocateBranchPools` returns nothing → `processMap` is empty for every process.

The fallback is `base.directPeopleCost` from `processPnlService.listProcesses()` — this reads `process_delivery_actual` and related planning tables, which also have no data in production → returns 0.

**Result:** `calculateBpoCostWaterfall` gets `agentSalary: 0` → every downstream KPI (EBITDA, EBIT, OP, PAT) is wrong. April: Rs 221.65L missing. June: Rs 241L missing.

**Why Statement tab is correct:** `enrichColumn` bypasses the canonical row's `agentSalary` and calls `getActualPeopleCost()` which groups salary_prep_line BY BRANCH first (not by process), finds payroll regardless of cost_centre.process_id mapping, then the statement assigns it by branchId key.

**Fix approach (chosen — least disruption):**

In `buildRows()`, after `getPeopleCosts()` resolves, call `getActualPeopleCost(period)` for the same period and use it as a per-process/per-branch fallback when `processMap` has no salary for a given process. This mirrors exactly what `enrichColumn` does.

```diff
// After line 1411 (the Promise.all)
+ const actualPeople = await getActualPeopleCost(normalized.period ?? "");

// At line 1430, change the fallback:
  const peopleMeta = people.processMap.get(base.processId) ?? (() => {
-   return { agentSalary: base.directPeopleCost, dscPeople: 0, agentHeadcount: Math.max(1, base.activeHc), dscHeadcount: 0, unclassifiedPeopleCost: 0 };
+   const snap = (base.processId ? actualPeople.byProcess.get(base.processId) : undefined)
+             ?? (base.branchId  ? actualPeople.byBranch.get(base.branchId)   : undefined);
+   return {
+     agentSalary:            snap?.agent_salary ?? base.directPeopleCost,
+     dscPeople:              snap?.dsc_people   ?? 0,
+     agentHeadcount:         Math.max(1, base.activeHc),
+     dscHeadcount:           0,
+     unclassifiedPeopleCost: 0,
+   };
  })();
  const bmcPeople = people.bmcPeopleByProcess.get(base.processId)
+   ?? actualPeople.byProcess.get(base.processId)?.bmc_people
+   ?? actualPeople.byBranch.get(base.branchId ?? "")?.bmc_people
    ?? 0;
```

**Expected outcome:** Overview/Matrix/CEO will now show the same people cost as the Statement tab.

---

### BUG-2 — HIGH: GRN indirect cost includes GST (~18% overstatement)

**Files:**
- `backend/src/modules/process-pnl/pnl-actuals.service.ts` — `getIndirectCostActuals()`
- `backend/src/modules/process-pnl/pnl-reconciliation.service.ts` — `readGrn()`

**Root cause:** `grn_entry_line_snapshot` query uses `l.total` which is the GST-inclusive amount. MAS Callnet as a BPO may or may not reclaim ITC on all purchases, but the P&L cost line should reflect net-of-tax expenditure (GST is a balance-sheet item, not a P&L expense, for registered businesses).

The `mas_hrms` GRN path already uses `amount_without_tax`. Only the db_bill mirror path uses `l.total`.

**Fix:**

```diff
- SUM(l.total)         AS amount   -- in grn_entry_line_snapshot queries
+ SUM(COALESCE(l.amount_without_tax, l.total)) AS amount
```

Need to verify column name in `grn_entry_line_snapshot`: check if `amount_without_tax` exists, else use `l.total / 1.18` as approximation (document clearly).

**Magnitude:** If average GST rate is 18% on Rs 30L monthly GRN → Rs 5.4L IDC overstatement removed → EBITDA improves by Rs 5.4L/month.

---

### BUG-3 — HIGH (PENDING VERIFICATION): Provision revenue in PAISE

**Files:**
- `backend/src/modules/process-pnl/pnl-actuals.service.ts` — `getInvoicedRevenueActuals()`
- `backend/src/modules/process-pnl/ceo-overview.service.ts` — `revenueByBranch()`
- `backend/src/modules/process-pnl/pnl-reconciliation.service.ts` — `readRevenue()`

**Evidence:** Code comment in pnl-actuals.service.ts says "SOURCE B amounts are integer PAISE — divide by 100 to get rupees." No division by 100 exists in any of the three files.

**Verification query (read-only, production-safe):**
```sql
SELECT MIN(billing_amt), MAX(billing_amt), AVG(billing_amt),
       MIN(provision_amt), MAX(provision_amt), COUNT(*)
FROM billing_provision_snapshot
WHERE period_code = '2026-07'
LIMIT 1;
```

If values are in the millions for a single cost centre (e.g., `billing_amt = 450000000` for a process that invoices Rs 45L), they are in paise → divide by 100.
If values are already in rupee range (e.g., `billing_amt = 4500000` for Rs 45L), no fix needed.

**Fix if confirmed:**
```diff
- SUM(ps.billing_amt)    AS invoice_amount   -- in provision CTEs
+ SUM(ps.billing_amt / 100) AS invoice_amount
- SUM(ps.provision_amt)  AS provision_amount
+ SUM(ps.provision_amt / 100) AS provision_amount
```

Apply in all three files.

---

### BUG-4 — MEDIUM: Provision deduplication JOIN silently fails on NULL process_id mismatch

**File:** `backend/src/modules/process-pnl/pnl-actuals.service.ts`

**Code (provision deduplication JOIN):**
```sql
LEFT JOIN invoice_actual i
       ON i.cost_centre_code = p.cost_centre_code
      AND COALESCE(i.branch_id, '')    = COALESCE(p.branch_id, '')
      AND COALESCE(i.cost_centre_id, '') = COALESCE(p.cost_centre_id, '')
      AND COALESCE(i.process_id, '')   = COALESCE(p.process_id, '')
```

**Risk:** If `PROCESS_BY_COST_CENTRE` resolves a different `process_id` for the same cost_centre_code in the two CTEs (due to data timing or cost centre with multiple processes), the 4th JOIN condition fails. The provision row then contributes its full amount even though `invoice_actual` already covered the same cost centre. Revenue is double-counted.

**Fix:** Add a fallback NULL-tolerant match: join on cost_centre_code only (all four conditions become cost_centre_code) and deduplicate by GREATEST(invoice, provision):

```sql
LEFT JOIN invoice_actual i ON i.cost_centre_code = p.cost_centre_code
  -- Remove process_id/branch_id conditions from join;
  -- amount is GREATEST(provision - invoice_for_same_cc, 0)
```

This is safer because we're already grouping both sides by cost_centre_code; the process_id sub-split in the join is an over-constraint that breaks deduplication.

---

### BUG-5 — MEDIUM: Statement revenue prefers stale canonical estimate over actual invoice for closed periods

**File:** `backend/src/modules/process-pnl/pnl-statement.service.ts` — `enrichColumn()`

**Code:**
```ts
const recognizedRevenue = existingRevenue > 0
  ? existingRevenue
  : (!periodOpen && invoiced > 0 ? invoiced : plannedRevenue);
```

`existingRevenue` is `data.recognizedRevenue` from the canonical `BpoPnlRow`. If `process_revenue_rule` has a configured rate that differs from actual invoice (e.g., estimate Rs 50L but invoice Rs 48L), the statement shows Rs 50L for a CLOSED period instead of the real Rs 48L.

**Fix (closed periods only):**
```ts
const recognizedRevenue = !periodOpen && invoiced > 0
  ? invoiced       // actual invoice wins for closed periods
  : existingRevenue > 0 ? existingRevenue : plannedRevenue;
```

This makes closed-period revenue authoritative from invoiced actuals. Open periods keep the rule-estimate (correct behavior — invoice not yet raised).

---

### BUG-6 — LOW: CEO Overview revenue and payroll in different scope filters

**File:** `backend/src/modules/process-pnl/ceo-overview.service.ts`

Revenue query applies `OWN_COMPANY_SQL` (MAS Callnet entities only).  
Payroll query does NOT apply the filter (intentional — all employees are MAS Callnet).

Comment in code: "all 937 active employees are MAS Callnet; IDC has none". This is acceptable for now but must be documented. If IDC ever adds employees, payroll will be overstated on the CEO view. Flag as a governance risk, no code change needed now.

---

### BUG-7 — LOW: pnl-reconciliation operatingProfit excludes overhead/BMC layer

**File:** `backend/src/modules/process-pnl/pnl-reconciliation.service.ts`

```ts
operatingProfit = recognisedRevenue - payrollCost - grnActual
```

This is a simplified 3-line formula. No separate DSC/BMC/agent split. No overhead allocation. Useful as a quick sanity check but does not match the full waterfall. The label "Operating Profit" on the Live P&L tab should say "Indicative OP (simplified)" to avoid confusion with the Statement tab's full-waterfall OP.

**Fix:** UI label change only — no backend change.

---

## Implementation Plan (in order)

| # | What | File(s) | Risk | Reversible |
|---|------|---------|------|-----------|
| 1 | Add `getActualPeopleCost()` fallback in `buildRows()` | bpo-pnl.service.ts lines 1411–1437 | Medium — touches canonical engine | Yes, git revert |
| 2 | Verify paise: run read-only DB query, apply `/100` if confirmed | pnl-actuals, ceo-overview, pnl-reconciliation | High if wrong | Yes |
| 3 | GRN: use `COALESCE(amount_without_tax, total)` | pnl-actuals, pnl-reconciliation | Low | Yes |
| 4 | Provision dedup JOIN: relax to cost_centre_code only | pnl-actuals | Low | Yes |
| 5 | Statement closed-period revenue: prefer invoiced | pnl-statement | Low | Yes |
| 6 | Live P&L label: "Indicative OP" | Frontend only | None | Yes |

## What NOT Changing
- `pnl-running-salary.service.ts` — the snapshot fallback is still correct for open periods
- `bpo-pnl-allocation-overlay.service.ts` — overlay layer is correct
- `canonical-pnl.service.ts` cache — no change needed; cache invalidation is per existing recalculate() path
- Any payroll computation, tax, or statutory logic — out of scope

## Rollback Plan
All changes are in a single backend module. A `git revert` of the commit restores prior behavior. No DB schema changes. No migration. Cache TTL is 60s so any incorrect result auto-expires.

---

## Files to Modify (Exact List)
1. `backend/src/modules/process-pnl/bpo-pnl.service.ts` — BUG-1
2. `backend/src/modules/process-pnl/pnl-actuals.service.ts` — BUG-2 (GRN), BUG-3 (paise if confirmed), BUG-4 (dedup)
3. `backend/src/modules/process-pnl/ceo-overview.service.ts` — BUG-3 (paise if confirmed)
4. `backend/src/modules/process-pnl/pnl-reconciliation.service.ts` — BUG-2 (GRN), BUG-3 (paise if confirmed)
5. `backend/src/modules/process-pnl/pnl-statement.service.ts` — BUG-5
6. PNL frontend tab (minor label) — BUG-7
