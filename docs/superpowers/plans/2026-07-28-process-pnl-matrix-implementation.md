# Process P&L Matrix Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign `/finance/process-pnl` so the matrix defaults to a user-friendly summary view with presets, issue filters, sticky totals, row inspection, and an alerts-first workspace while preserving the full accounting matrix.

**Architecture:** Keep the existing finance data flow and `useBpoProcessPnl` contract unchanged. Concentrate the redesign in frontend state, matrix configuration metadata, and focused UI components around `ProcessPnlPage.tsx` and `BpoPnlMatrixTable.tsx`, with pure helper functions and Vitest coverage for filter, preset, and totals behavior.

**Tech Stack:** React 18, TypeScript, Vite, TanStack Query, React Router, shadcn/ui, Tailwind CSS, Vitest

## Global Constraints

- No finance calculation logic changes.
- No changes to revenue recognition logic.
- No changes to cost allocation logic.
- No downgrade in export completeness.
- No replacement of the process detail page.
- Default matrix view is `Summary`, not `Full Matrix`.
- `Full Matrix` remains available and retains current accounting completeness.
- First identifying columns remain sticky.
- The active filtered set shows a visible summary/totals row.
- Users can filter by process health status and issue chips.
- The page remains desktop-friendly and does not regress export capability.

---

## File Structure

### Existing files to modify

- `src/pages/finance/ProcessPnlPage.tsx`
  - Own page-level filters, active tab state, and wiring between overview, matrix, and alerts workspace.
- `src/components/finance/pnl/BpoPnlMatrixTable.tsx`
  - Stop rendering one always-on mega grid; consume column presets, filter state, totals, density, and row drawer.
- `src/components/finance/pnl/CeoCommandCenter.tsx`
  - Keep overview behavior intact but update the matrix jump action and alert handoff language if needed.
- `src/components/finance/pnl/PnlDataQualityPanel.tsx`
  - Reuse alert rendering inside the new alerts workspace with optional grouping/filter affordances.

### New files to create

- `src/components/finance/pnl/processPnlMatrixConfig.ts`
  - Source of truth for matrix presets, column metadata, issue-chip definitions, sorting defaults, row filtering, and totals helpers.
- `src/components/finance/pnl/ProcessPnlMatrixToolbar.tsx`
  - Toolbar for preset switching, status filtering, issue chips, density mode, and matrix-local controls.
- `src/components/finance/pnl/ProcessPnlMatrixTotals.tsx`
  - Sticky totals row component driven by visible columns and filtered rows.
- `src/components/finance/pnl/ProcessPnlRowDrawer.tsx`
  - Right-side drawer with process snapshot, alerts, and quick links.
- `src/components/finance/pnl/ProcessPnlAlertsWorkspace.tsx`
  - Replacement for the current `Charts & Quality` pane, focused on alert severity, grouping, and process-level follow-up.
- `src/tests/process-pnl-matrix-config.test.ts`
  - Pure logic tests for presets, issue filters, search matching, and totals.
- `src/tests/process-pnl-page.contract.test.tsx`
  - Runtime/contract tests covering renamed tabs, default preset, visible controls, and preservation of the full matrix mode.

## Interfaces

### `src/components/finance/pnl/processPnlMatrixConfig.ts`

```ts
import type { BpoPnlRow } from "@/hooks/useBpoProcessPnl";

export type ProcessPnlMatrixPreset =
  | "summary"
  | "revenue"
  | "cost"
  | "profitability"
  | "budget-risk"
  | "full";

export type ProcessPnlStatusFilter = "all" | BpoPnlRow["processStatus"];

export type ProcessPnlIssueFilter =
  | "all"
  | "revenue-at-risk"
  | "delivery-missing"
  | "budget-exceeded"
  | "high-receivable"
  | "accounting-fallback";

export type ProcessPnlDensity = "comfortable" | "compact";

export type ProcessPnlSortDirection = "asc" | "desc";

export type ProcessPnlColumnKey =
  | "processName"
  | "clientName"
  | "branchName"
  | "processStatus"
  | "revenueDataStatus"
  | "recognizedRevenue"
  | "agentSalaryPctRevenue"
  | "dscPctRevenue"
  | "bmcPctRevenue"
  | "ebitda"
  | "ebitdaMarginPct"
  | "budgetUtilizationPct"
  | "revenueAtRisk"
  | "billingModels"
  | "mandatedSeats"
  | "deliveredUnits"
  | "billableUnits"
  | "earnedRevenue"
  | "invoicedRevenue"
  | "collectedRevenue"
  | "outstandingReceivable"
  | "unbilledRevenue"
  | "revenueVariance"
  | "agentSalary"
  | "averageAgentSalary"
  | "dscPeople"
  | "dscNonPeople"
  | "dsc"
  | "bmcPeople"
  | "bmcNonPeople"
  | "bmc"
  | "grnVendorActual"
  | "peopleCostPctRevenue"
  | "contribution"
  | "contributionMarginPct"
  | "ebit"
  | "operatingProfitPct"
  | "pbt"
  | "pat"
  | "approvedBudget"
  | "reservedBudget"
  | "consumedBudget"
  | "availableBudget";

export interface ProcessPnlColumnDefinition {
  key: ProcessPnlColumnKey;
  label: string;
  align?: "left" | "right";
  sticky?: boolean;
  widthClass?: string;
  render: (row: BpoPnlRow) => React.ReactNode;
  total?: (rows: BpoPnlRow[]) => React.ReactNode;
  sortValue?: (row: BpoPnlRow) => number | string;
}

export interface ProcessPnlViewState {
  preset: ProcessPnlMatrixPreset;
  status: ProcessPnlStatusFilter;
  issue: ProcessPnlIssueFilter;
  density: ProcessPnlDensity;
  sortKey: ProcessPnlColumnKey;
  sortDirection: ProcessPnlSortDirection;
  search: string;
}

export function getPresetColumns(preset: ProcessPnlMatrixPreset): ProcessPnlColumnDefinition[];
export function getDefaultSort(
  preset: ProcessPnlMatrixPreset,
): { sortKey: ProcessPnlColumnKey; sortDirection: ProcessPnlSortDirection };
export function filterMatrixRows(rows: BpoPnlRow[], state: ProcessPnlViewState): BpoPnlRow[];
export function sortMatrixRows(rows: BpoPnlRow[], state: ProcessPnlViewState): BpoPnlRow[];
export function getIssueCounts(rows: BpoPnlRow[]): Record<ProcessPnlIssueFilter, number>;
```

### `src/components/finance/pnl/ProcessPnlMatrixToolbar.tsx`

```ts
import type {
  ProcessPnlDensity,
  ProcessPnlIssueFilter,
  ProcessPnlMatrixPreset,
  ProcessPnlStatusFilter,
} from "./processPnlMatrixConfig";

export interface ProcessPnlMatrixToolbarProps {
  preset: ProcessPnlMatrixPreset;
  status: ProcessPnlStatusFilter;
  issue: ProcessPnlIssueFilter;
  density: ProcessPnlDensity;
  issueCounts: Record<ProcessPnlIssueFilter, number>;
  onPresetChange: (value: ProcessPnlMatrixPreset) => void;
  onStatusChange: (value: ProcessPnlStatusFilter) => void;
  onIssueChange: (value: ProcessPnlIssueFilter) => void;
  onDensityChange: (value: ProcessPnlDensity) => void;
}
```

### `src/components/finance/pnl/ProcessPnlRowDrawer.tsx`

```ts
import type { BpoPnlRow, BpoPnlSummary } from "@/hooks/useBpoProcessPnl";

export interface ProcessPnlRowDrawerProps {
  period: string;
  row: BpoPnlRow | null;
  alerts: BpoPnlSummary["alerts"];
  onOpenChange: (open: boolean) => void;
}
```

## Task List

### Task 1: Build matrix configuration helpers and pure tests

**Files:**
- Create: `src/components/finance/pnl/processPnlMatrixConfig.ts`
- Create: `src/tests/process-pnl-matrix-config.test.ts`

**Interfaces:**
- Consumes: `BpoPnlRow` from `@/hooks/useBpoProcessPnl`
- Produces:
  - `getPresetColumns(preset: ProcessPnlMatrixPreset): ProcessPnlColumnDefinition[]`
  - `getDefaultSort(preset: ProcessPnlMatrixPreset): { sortKey: ProcessPnlColumnKey; sortDirection: ProcessPnlSortDirection }`
  - `filterMatrixRows(rows: BpoPnlRow[], state: ProcessPnlViewState): BpoPnlRow[]`
  - `sortMatrixRows(rows: BpoPnlRow[], state: ProcessPnlViewState): BpoPnlRow[]`
  - `getIssueCounts(rows: BpoPnlRow[]): Record<ProcessPnlIssueFilter, number>`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import {
  filterMatrixRows,
  getDefaultSort,
  getIssueCounts,
  getPresetColumns,
  sortMatrixRows,
  type ProcessPnlViewState,
} from "@/components/finance/pnl/processPnlMatrixConfig";
import type { BpoPnlRow } from "@/hooks/useBpoProcessPnl";

const rows: BpoPnlRow[] = [
  {
    processId: "p1",
    processName: "Alpha Voice",
    clientId: "c1",
    clientName: "Apex",
    branchId: "b1",
    branchName: "Noida",
    costCentreId: "cc1",
    costCentreCode: "CC-100",
    billingModels: ["seat_based"],
    primaryBillingModel: "seat_based",
    revenueDataStatus: "configured",
    mandatedSeats: 100,
    contractedSeats: 100,
    requiredProductiveHc: 90,
    requiredRosterHc: 96,
    activeHc: 92,
    agentHeadcount: 88,
    supportHeadcount: 4,
    billableHc: 86,
    seatFillPct: 92,
    billableSeatUtilizationPct: 86,
    plannedDeliveryUnits: 1000,
    deliveredUnits: 980,
    acceptedUnits: 970,
    rejectedUnits: 10,
    billableUnits: 970,
    productiveHours: 0,
    loginHours: 0,
    talkMinutes: 0,
    qualityScore: 98,
    slaScore: 99,
    deliveryAttainmentPct: 98,
    acceptancePct: 99,
    grossPotentialRevenue: 1000000,
    baseEarnedRevenue: 950000,
    minimumCommitmentTopUp: 0,
    incentiveRevenue: 10000,
    rewardRevenue: 5000,
    trainingRevenue: 0,
    otherRevenueIncrease: 0,
    penalty: 0,
    slaDeduction: 0,
    creditNote: 0,
    otherRevenueDecrease: 0,
    earnedRevenue: 965000,
    recognizedRevenue: 965000,
    invoicedRevenue: 900000,
    collectedRevenue: 700000,
    outstandingReceivable: 200000,
    unbilledRevenue: 65000,
    deferredRevenue: 0,
    revenueLeakage: 0,
    revenueAtRisk: 15000,
    revenueBudget: 900000,
    revenueVariance: 65000,
    agentSalary: 350000,
    averageAgentSalary: 3977,
    agentSalaryPctRevenue: 36.2,
    dscPeople: 60000,
    dscNonPeople: 30000,
    dsc: 90000,
    dscPctRevenue: 9.3,
    bmcPeople: 45000,
    bmcNonPeople: 25000,
    bmc: 70000,
    bmcPctRevenue: 7.3,
    grnVendorActual: 10000,
    totalPeopleCost: 455000,
    peopleCostPctRevenue: 47.2,
    contribution: 430000,
    contributionMarginPct: 44.6,
    ebitda: 360000,
    ebitdaMarginPct: 37.3,
    depreciation: 10000,
    amortization: 5000,
    ebit: 345000,
    operatingProfit: 345000,
    operatingProfitPct: 35.8,
    financeCost: 1000,
    pbt: 344000,
    tax: 80000,
    pat: 264000,
    totalOperatingCost: 605000,
    totalCostPctRevenue: 62.7,
    revenuePerAgent: 10965,
    revenuePerActiveEmployee: 10489,
    revenuePerContractedSeat: 9650,
    loadedCostPerBillableSeat: 7034,
    approvedBudget: 600000,
    reservedBudget: 100000,
    consumedBudget: 550000,
    availableBudget: 50000,
    budgetUtilizationPct: 91.7,
    ebitdaBudget: 300000,
    ebitdaVariance: 60000,
    processStatus: "profitable",
    freshness: "2026-07-28T08:00:00.000Z",
  },
  {
    ...rows[0],
    processId: "p2",
    processName: "Beta Support",
    branchName: "Gurgaon",
    costCentreCode: "CC-200",
    revenueDataStatus: "configured_no_delivery",
    recognizedRevenue: 400000,
    outstandingReceivable: 350000,
    revenueAtRisk: 120000,
    budgetUtilizationPct: 118,
    ebitda: -50000,
    ebitdaMarginPct: -12.5,
    processStatus: "loss-making",
  },
];

describe("processPnlMatrixConfig", () => {
  it("returns summary preset columns without exposing the full matrix by default", () => {
    const columns = getPresetColumns("summary");
    expect(columns.map((column) => column.key)).toEqual([
      "processName",
      "clientName",
      "branchName",
      "processStatus",
      "recognizedRevenue",
      "agentSalaryPctRevenue",
      "dscPctRevenue",
      "bmcPctRevenue",
      "ebitda",
      "ebitdaMarginPct",
      "budgetUtilizationPct",
      "revenueAtRisk",
      "revenueDataStatus",
    ]);
  });

  it("filters by status, issue chip, and universal search", () => {
    const state: ProcessPnlViewState = {
      preset: "summary",
      status: "loss-making",
      issue: "delivery-missing",
      density: "comfortable",
      sortKey: "ebitda",
      sortDirection: "asc",
      search: "gurgaon",
    };
    expect(filterMatrixRows(rows, state).map((row) => row.processId)).toEqual(["p2"]);
  });

  it("sorts summary view by the preset default", () => {
    const state: ProcessPnlViewState = {
      preset: "summary",
      status: "all",
      issue: "all",
      density: "comfortable",
      ...getDefaultSort("summary"),
      search: "",
    };
    expect(sortMatrixRows(rows, state)[0]?.processId).toBe("p2");
  });

  it("counts issue chips from the raw filtered rows", () => {
    expect(getIssueCounts(rows)["budget-exceeded"]).toBe(1);
    expect(getIssueCounts(rows)["delivery-missing"]).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node backend/node_modules/vitest/vitest.mjs run src/tests/process-pnl-matrix-config.test.ts --config vite.config.ts --globals
```

Expected: FAIL with module-not-found errors for `processPnlMatrixConfig` exports.

- [ ] **Step 3: Write minimal implementation**

```ts
import type { ReactNode } from "react";
import type { BpoPnlRow } from "@/hooks/useBpoProcessPnl";

export type ProcessPnlMatrixPreset =
  | "summary"
  | "revenue"
  | "cost"
  | "profitability"
  | "budget-risk"
  | "full";

export type ProcessPnlStatusFilter = "all" | BpoPnlRow["processStatus"];
export type ProcessPnlIssueFilter =
  | "all"
  | "revenue-at-risk"
  | "delivery-missing"
  | "budget-exceeded"
  | "high-receivable"
  | "accounting-fallback";
export type ProcessPnlDensity = "comfortable" | "compact";
export type ProcessPnlSortDirection = "asc" | "desc";

export type ProcessPnlColumnKey =
  | "processName"
  | "clientName"
  | "branchName"
  | "processStatus"
  | "revenueDataStatus"
  | "recognizedRevenue"
  | "agentSalaryPctRevenue"
  | "dscPctRevenue"
  | "bmcPctRevenue"
  | "ebitda"
  | "ebitdaMarginPct"
  | "budgetUtilizationPct"
  | "revenueAtRisk";

export interface ProcessPnlColumnDefinition {
  key: ProcessPnlColumnKey;
  label: string;
  align?: "left" | "right";
  sticky?: boolean;
  widthClass?: string;
  render: (row: BpoPnlRow) => ReactNode;
  total?: (rows: BpoPnlRow[]) => ReactNode;
  sortValue?: (row: BpoPnlRow) => number | string;
}

export interface ProcessPnlViewState {
  preset: ProcessPnlMatrixPreset;
  status: ProcessPnlStatusFilter;
  issue: ProcessPnlIssueFilter;
  density: ProcessPnlDensity;
  sortKey: ProcessPnlColumnKey;
  sortDirection: ProcessPnlSortDirection;
  search: string;
}

const SUMMARY_COLUMNS: ProcessPnlColumnDefinition[] = [
  { key: "processName", label: "Process", sticky: true, render: (row) => row.processName },
  { key: "clientName", label: "Client", sticky: true, render: (row) => row.clientName ?? "Unmapped" },
  { key: "branchName", label: "Branch", sticky: true, render: (row) => row.branchName ?? "Unassigned" },
  { key: "processStatus", label: "Status", sticky: true, render: (row) => row.processStatus },
  { key: "recognizedRevenue", label: "Recognized revenue", align: "right", render: (row) => row.recognizedRevenue, sortValue: (row) => row.recognizedRevenue },
  { key: "agentSalaryPctRevenue", label: "Agent salary %", align: "right", render: (row) => row.agentSalaryPctRevenue ?? 0, sortValue: (row) => row.agentSalaryPctRevenue ?? 0 },
  { key: "dscPctRevenue", label: "DSC %", align: "right", render: (row) => row.dscPctRevenue ?? 0, sortValue: (row) => row.dscPctRevenue ?? 0 },
  { key: "bmcPctRevenue", label: "BMC %", align: "right", render: (row) => row.bmcPctRevenue ?? 0, sortValue: (row) => row.bmcPctRevenue ?? 0 },
  { key: "ebitda", label: "EBITDA", align: "right", render: (row) => row.ebitda, sortValue: (row) => row.ebitda },
  { key: "ebitdaMarginPct", label: "EBITDA %", align: "right", render: (row) => row.ebitdaMarginPct ?? 0, sortValue: (row) => row.ebitdaMarginPct ?? 0 },
  { key: "budgetUtilizationPct", label: "Budget utilization", align: "right", render: (row) => row.budgetUtilizationPct ?? 0, sortValue: (row) => row.budgetUtilizationPct ?? 0 },
  { key: "revenueAtRisk", label: "Revenue at risk", align: "right", render: (row) => row.revenueAtRisk, sortValue: (row) => row.revenueAtRisk },
  { key: "revenueDataStatus", label: "Data status", render: (row) => row.revenueDataStatus },
];

export function getPresetColumns(): ProcessPnlColumnDefinition[] {
  return SUMMARY_COLUMNS;
}

export function getDefaultSort() {
  return { sortKey: "ebitda" as const, sortDirection: "asc" as const };
}

export function filterMatrixRows(rows: BpoPnlRow[], state: ProcessPnlViewState) {
  return rows.filter((row) => {
    if (state.status !== "all" && row.processStatus !== state.status) return false;
    if (state.issue === "delivery-missing" && row.revenueDataStatus !== "configured_no_delivery") return false;
    if (state.issue === "budget-exceeded" && (row.budgetUtilizationPct ?? 0) <= 100) return false;
    if (state.issue === "revenue-at-risk" && row.revenueAtRisk <= 0) return false;
    if (state.issue === "high-receivable" && row.outstandingReceivable <= 0) return false;
    if (state.issue === "accounting-fallback" && row.revenueDataStatus !== "accounting_fallback") return false;
    const haystack = [
      row.processName,
      row.clientName ?? "",
      row.branchName ?? "",
      row.costCentreCode ?? "",
    ].join(" ").toLowerCase();
    return state.search ? haystack.includes(state.search.toLowerCase()) : true;
  });
}

export function sortMatrixRows(rows: BpoPnlRow[], state: ProcessPnlViewState) {
  const value = (row: BpoPnlRow) => {
    if (state.sortKey === "ebitda") return row.ebitda;
    return row[state.sortKey as keyof BpoPnlRow] ?? 0;
  };
  return [...rows].sort((left, right) => Number(value(left)) - Number(value(right)));
}

export function getIssueCounts(rows: BpoPnlRow[]) {
  return {
    all: rows.length,
    "revenue-at-risk": rows.filter((row) => row.revenueAtRisk > 0).length,
    "delivery-missing": rows.filter((row) => row.revenueDataStatus === "configured_no_delivery").length,
    "budget-exceeded": rows.filter((row) => (row.budgetUtilizationPct ?? 0) > 100).length,
    "high-receivable": rows.filter((row) => row.outstandingReceivable > 0).length,
    "accounting-fallback": rows.filter((row) => row.revenueDataStatus === "accounting_fallback").length,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
node backend/node_modules/vitest/vitest.mjs run src/tests/process-pnl-matrix-config.test.ts --config vite.config.ts --globals
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/finance/pnl/processPnlMatrixConfig.ts src/tests/process-pnl-matrix-config.test.ts
git commit -m "feat: add process pnl matrix view config"
```

### Task 2: Add page-level view state and the new matrix toolbar

**Files:**
- Create: `src/components/finance/pnl/ProcessPnlMatrixToolbar.tsx`
- Modify: `src/pages/finance/ProcessPnlPage.tsx`
- Test: `src/tests/process-pnl-page.contract.test.tsx`

**Interfaces:**
- Consumes:
  - `ProcessPnlMatrixPreset`
  - `ProcessPnlStatusFilter`
  - `ProcessPnlIssueFilter`
  - `ProcessPnlDensity`
  - `getIssueCounts(rows: BpoPnlRow[])`
- Produces:
  - `ProcessPnlMatrixToolbarProps`
  - page state persisted under `process-pnl-matrix:view`
  - renamed top-level tab label `Alerts & Reconciliation`

- [ ] **Step 1: Write the failing test**

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync("src/pages/finance/ProcessPnlPage.tsx", "utf8");

describe("ProcessPnlPage contract", () => {
  it("renames charts and quality to alerts and reconciliation", () => {
    expect(page).toContain('TabsTrigger value="alerts">Alerts &amp; Reconciliation</TabsTrigger>');
  });

  it("tracks matrix preset and issue filters in page state", () => {
    expect(page).toContain("const [matrixPreset, setMatrixPreset]");
    expect(page).toContain("const [statusFilter, setStatusFilter]");
    expect(page).toContain("const [issueFilter, setIssueFilter]");
    expect(page).toContain("<ProcessPnlMatrixToolbar");
  });

  it("keeps summary as the default preset", () => {
    expect(page).toContain('useState<ProcessPnlMatrixPreset>("summary")');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node backend/node_modules/vitest/vitest.mjs run src/tests/process-pnl-page.contract.test.tsx --config vite.config.ts --globals
```

Expected: FAIL because the page still uses `charts` and has no matrix-specific state.

- [ ] **Step 3: Write minimal implementation**

```tsx
import { useEffect, useMemo, useState } from "react";
import {
  getIssueCounts,
  type ProcessPnlDensity,
  type ProcessPnlIssueFilter,
  type ProcessPnlMatrixPreset,
  type ProcessPnlStatusFilter,
} from "@/components/finance/pnl/processPnlMatrixConfig";
import { ProcessPnlMatrixToolbar } from "@/components/finance/pnl/ProcessPnlMatrixToolbar";

const VIEW_STORAGE_KEY = "process-pnl-matrix:view";

type StoredView = {
  preset: ProcessPnlMatrixPreset;
  status: ProcessPnlStatusFilter;
  issue: ProcessPnlIssueFilter;
  density: ProcessPnlDensity;
};

function readStoredView(): StoredView {
  if (typeof window === "undefined") {
    return { preset: "summary", status: "all", issue: "all", density: "comfortable" };
  }
  try {
    const raw = window.localStorage.getItem(VIEW_STORAGE_KEY);
    if (!raw) return { preset: "summary", status: "all", issue: "all", density: "comfortable" };
    return { preset: "summary", status: "all", issue: "all", density: "comfortable", ...JSON.parse(raw) };
  } catch {
    return { preset: "summary", status: "all", issue: "all", density: "comfortable" };
  }
}

const [matrixPreset, setMatrixPreset] = useState<ProcessPnlMatrixPreset>("summary");
const [statusFilter, setStatusFilter] = useState<ProcessPnlStatusFilter>("all");
const [issueFilter, setIssueFilter] = useState<ProcessPnlIssueFilter>("all");
const [matrixDensity, setMatrixDensity] = useState<ProcessPnlDensity>("comfortable");
const [activeTab, setActiveTab] = useState<"overview" | "matrix" | "alerts">("overview");

useEffect(() => {
  const stored = readStoredView();
  setMatrixPreset(stored.preset);
  setStatusFilter(stored.status);
  setIssueFilter(stored.issue);
  setMatrixDensity(stored.density);
}, []);

useEffect(() => {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(
      VIEW_STORAGE_KEY,
      JSON.stringify({
        preset: matrixPreset,
        status: statusFilter,
        issue: issueFilter,
        density: matrixDensity,
      }),
    );
  }
}, [matrixPreset, statusFilter, issueFilter, matrixDensity]);

const issueCounts = useMemo(() => getIssueCounts(rows), [rows]);

<TabsList className="mx-4 mt-3 w-fit shrink-0">
  <TabsTrigger value="overview">CEO Overview</TabsTrigger>
  <TabsTrigger value="matrix">Process Matrix</TabsTrigger>
  <TabsTrigger value="alerts">Alerts &amp; Reconciliation</TabsTrigger>
</TabsList>

<TabsContent value="matrix" className="flex-1 overflow-auto px-4 py-3 m-0">
  <div className="space-y-3">
    <ProcessPnlMatrixToolbar
      preset={matrixPreset}
      status={statusFilter}
      issue={issueFilter}
      density={matrixDensity}
      issueCounts={issueCounts}
      onPresetChange={setMatrixPreset}
      onStatusChange={setStatusFilter}
      onIssueChange={setIssueFilter}
      onDensityChange={setMatrixDensity}
    />
    <BpoPnlMatrixTable
      rows={rows}
      period={period}
      preset={matrixPreset}
      status={statusFilter}
      issue={issueFilter}
      density={matrixDensity}
      search={search}
      alerts={summary?.alerts ?? []}
    />
  </div>
</TabsContent>
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
node backend/node_modules/vitest/vitest.mjs run src/tests/process-pnl-page.contract.test.tsx --config vite.config.ts --globals
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/finance/pnl/ProcessPnlMatrixToolbar.tsx src/pages/finance/ProcessPnlPage.tsx src/tests/process-pnl-page.contract.test.tsx
git commit -m "feat: add process pnl matrix page controls"
```

### Task 3: Refactor the matrix into presets, sticky totals, and sorting

**Files:**
- Create: `src/components/finance/pnl/ProcessPnlMatrixTotals.tsx`
- Modify: `src/components/finance/pnl/BpoPnlMatrixTable.tsx`
- Modify: `src/components/finance/pnl/processPnlMatrixConfig.ts`
- Test: `src/tests/process-pnl-matrix-config.test.ts`

**Interfaces:**
- Consumes:
  - `getPresetColumns`
  - `filterMatrixRows`
  - `sortMatrixRows`
  - `ProcessPnlMatrixPreset`
  - `ProcessPnlStatusFilter`
  - `ProcessPnlIssueFilter`
  - `ProcessPnlDensity`
- Produces:
  - `BpoPnlMatrixTable(props: { rows; period; preset; status; issue; density; search; alerts; })`
  - sticky totals row above the table body
  - clickable sortable headers for visible metric columns

- [ ] **Step 1: Extend the failing test**

```ts
it("exposes revenue, cost, profitability, budget-risk, and full presets", () => {
  expect(getPresetColumns("revenue").length).toBeGreaterThan(10);
  expect(getPresetColumns("cost").length).toBeGreaterThan(10);
  expect(getPresetColumns("profitability").length).toBeGreaterThan(8);
  expect(getPresetColumns("budget-risk").length).toBeGreaterThan(8);
  expect(getPresetColumns("full").length).toBeGreaterThan(getPresetColumns("summary").length);
});
```

Add a contract assertion for the matrix component:

```ts
const matrix = readFileSync("src/components/finance/pnl/BpoPnlMatrixTable.tsx", "utf8");

it("renders a totals row and sortable headers instead of one fixed export-only grid", () => {
  expect(matrix).toContain("<ProcessPnlMatrixTotals");
  expect(matrix).toContain("onClick={() => handleSort(column.key)}");
  expect(matrix).toContain('preset === "full"');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node backend/node_modules/vitest/vitest.mjs run src/tests/process-pnl-matrix-config.test.ts src/tests/process-pnl-page.contract.test.tsx --config vite.config.ts --globals
```

Expected: FAIL because only the summary preset exists and the matrix still renders one hardcoded table shape.

- [ ] **Step 3: Write minimal implementation**

```tsx
export function BpoPnlMatrixTable({
  rows,
  period,
  preset,
  status,
  issue,
  density,
  search,
  alerts,
}: {
  rows: BpoPnlRow[];
  period: string;
  preset: ProcessPnlMatrixPreset;
  status: ProcessPnlStatusFilter;
  issue: ProcessPnlIssueFilter;
  density: ProcessPnlDensity;
  search: string;
  alerts: BpoPnlSummary["alerts"];
}) {
  const [sort, setSort] = useState(() => getDefaultSort(preset));

  useEffect(() => {
    setSort(getDefaultSort(preset));
  }, [preset]);

  const state = {
    preset,
    status,
    issue,
    density,
    search,
    sortKey: sort.sortKey,
    sortDirection: sort.sortDirection,
  } satisfies ProcessPnlViewState;

  const filteredRows = useMemo(() => filterMatrixRows(rows, state), [rows, state]);
  const sortedRows = useMemo(() => sortMatrixRows(filteredRows, state), [filteredRows, state]);
  const columns = useMemo(() => getPresetColumns(preset), [preset]);

  function handleSort(sortKey: ProcessPnlColumnKey) {
    setSort((current) => ({
      sortKey,
      sortDirection:
        current.sortKey === sortKey && current.sortDirection === "asc" ? "desc" : "asc",
    }));
  }

  return (
    <div className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-col gap-3 border-b border-slate-100 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-950">Process-wise BPO P&amp;L matrix</h2>
          <p className="mt-1 text-sm text-slate-500">
            {preset === "full"
              ? "Advanced finance sheet with full accounting detail."
              : "Focused view for the selected finance lens with full-matrix drill-through still available."}
          </p>
        </div>
      </div>

      <div className="overflow-auto">
        <table className={preset === "full" ? "min-w-[5200px] w-full text-xs" : "min-w-[1600px] w-full text-xs"}>
          <thead className="sticky top-0 z-30 bg-slate-50 text-slate-600">
            <tr>
              {columns.map((column) => (
                <th
                  key={column.key}
                  className="border-b border-slate-200 px-3 py-3 text-left"
                >
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 font-semibold"
                    onClick={() => handleSort(column.key)}
                  >
                    {column.label}
                  </button>
                </th>
              ))}
            </tr>
            <ProcessPnlMatrixTotals columns={columns} rows={sortedRows} />
          </thead>
          <tbody>
            {sortedRows.map((row) => (
              <tr key={row.processId}>
                {columns.map((column) => (
                  <td key={column.key} className="px-3 py-3">
                    {column.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests and build**

Run:

```bash
node backend/node_modules/vitest/vitest.mjs run src/tests/process-pnl-matrix-config.test.ts src/tests/process-pnl-page.contract.test.tsx --config vite.config.ts --globals
npm run build
```

Expected:

- Vitest: PASS
- Build: `vite build` completes successfully

- [ ] **Step 5: Commit**

```bash
git add src/components/finance/pnl/BpoPnlMatrixTable.tsx src/components/finance/pnl/ProcessPnlMatrixTotals.tsx src/components/finance/pnl/processPnlMatrixConfig.ts src/tests/process-pnl-matrix-config.test.ts src/tests/process-pnl-page.contract.test.tsx
git commit -m "feat: add process pnl matrix presets and totals"
```

### Task 4: Add row drawer inspection and local matrix persistence polish

**Files:**
- Create: `src/components/finance/pnl/ProcessPnlRowDrawer.tsx`
- Modify: `src/components/finance/pnl/BpoPnlMatrixTable.tsx`
- Modify: `src/pages/finance/ProcessPnlPage.tsx`
- Test: `src/tests/process-pnl-page.contract.test.tsx`

**Interfaces:**
- Consumes:
  - `row: BpoPnlRow | null`
  - `alerts: BpoPnlSummary["alerts"]`
  - `period: string`
- Produces:
  - row detail drawer opened by explicit action icon
  - persisted matrix density and preset state

- [ ] **Step 1: Extend the failing contract test**

```ts
it("opens process inspection from an explicit matrix action instead of row-click hijacking", () => {
  const matrix = readFileSync("src/components/finance/pnl/BpoPnlMatrixTable.tsx", "utf8");
  expect(matrix).toContain("setSelectedRow(row)");
  expect(matrix).toContain("<ProcessPnlRowDrawer");
  expect(matrix).toContain("title=\"Open process snapshot\"");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node backend/node_modules/vitest/vitest.mjs run src/tests/process-pnl-page.contract.test.tsx --config vite.config.ts --globals
```

Expected: FAIL because no drawer exists yet.

- [ ] **Step 3: Write minimal implementation**

```tsx
const [selectedRow, setSelectedRow] = useState<BpoPnlRow | null>(null);

<td className="px-3 py-3 text-right">
  <Button
    type="button"
    size="icon"
    variant="ghost"
    title="Open process snapshot"
    onClick={() => setSelectedRow(row)}
  >
    <PanelRightOpen className="h-4 w-4" />
  </Button>
</td>

<ProcessPnlRowDrawer
  period={period}
  row={selectedRow}
  alerts={alerts}
  onOpenChange={(open) => {
    if (!open) setSelectedRow(null);
  }}
/>;
```

Drawer body:

```tsx
export function ProcessPnlRowDrawer({ period, row, alerts, onOpenChange }: ProcessPnlRowDrawerProps) {
  const processAlerts = alerts.filter((alert) => alert.processId === row?.processId);

  return (
    <Sheet open={!!row} onOpenChange={onOpenChange}>
      <SheetContent className="w-[460px] sm:max-w-[460px]">
        <SheetHeader>
          <SheetTitle>{row?.processName ?? "Process snapshot"}</SheetTitle>
        </SheetHeader>
        {row && (
          <div className="mt-6 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <MetricCard label="Recognized revenue" value={currency(row.recognizedRevenue)} />
              <MetricCard label="EBITDA" value={currency(row.ebitda)} />
              <MetricCard label="EBITDA %" value={percent(row.ebitdaMarginPct)} />
              <MetricCard label="Budget util." value={percent(row.budgetUtilizationPct)} />
            </div>
            <PnlDataQualityPanel alerts={processAlerts} />
            <div className="flex gap-2">
              <Button asChild>
                <Link to={`/finance/process-pnl/${row.processId}?period=${period}`}>Open detail</Link>
              </Button>
              <Button variant="outline" asChild>
                <Link to={`/finance/branch-budget?period=${period}`}>Open budget</Link>
              </Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
```

- [ ] **Step 4: Run tests and build**

Run:

```bash
node backend/node_modules/vitest/vitest.mjs run src/tests/process-pnl-page.contract.test.tsx --config vite.config.ts --globals
npm run build
```

Expected:

- Vitest: PASS
- Build: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/finance/pnl/ProcessPnlRowDrawer.tsx src/components/finance/pnl/BpoPnlMatrixTable.tsx src/pages/finance/ProcessPnlPage.tsx src/tests/process-pnl-page.contract.test.tsx
git commit -m "feat: add process pnl row inspection drawer"
```

### Task 5: Replace Charts & Quality with Alerts & Reconciliation workspace

**Files:**
- Create: `src/components/finance/pnl/ProcessPnlAlertsWorkspace.tsx`
- Modify: `src/pages/finance/ProcessPnlPage.tsx`
- Modify: `src/components/finance/pnl/PnlDataQualityPanel.tsx`
- Test: `src/tests/process-pnl-page.contract.test.tsx`

**Interfaces:**
- Consumes:
  - `alerts: BpoPnlSummary["alerts"]`
  - `rows: BpoPnlRow[]`
  - `period: string`
- Produces:
  - `ProcessPnlAlertsWorkspace(props: { alerts; rows; period; })`
  - severity sections: critical, warning, info
  - grouping by branch/process and process detail links

- [ ] **Step 1: Extend the failing contract test**

```ts
it("mounts an alerts workspace instead of the old charts-and-quality tab", () => {
  expect(page).toContain("<ProcessPnlAlertsWorkspace");
  expect(page).not.toContain('TabsContent value="charts"');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node backend/node_modules/vitest/vitest.mjs run src/tests/process-pnl-page.contract.test.tsx --config vite.config.ts --globals
```

Expected: FAIL because the old `charts` tab still exists or the new workspace is not mounted.

- [ ] **Step 3: Write minimal implementation**

```tsx
export function ProcessPnlAlertsWorkspace({
  alerts,
  rows,
  period,
}: {
  alerts: BpoPnlSummary["alerts"];
  rows: BpoPnlRow[];
  period: string;
}) {
  const critical = alerts.filter((alert) => alert.type === "critical");
  const warning = alerts.filter((alert) => alert.type === "warning");
  const info = alerts.filter((alert) => alert.type === "info");

  return (
    <div className="space-y-4">
      <AlertsSection title="Critical alerts" tone="rose" alerts={critical} period={period} />
      <AlertsSection title="Warnings" tone="amber" alerts={warning} period={period} />
      <AlertsSection title="Data coverage gaps" tone="sky" alerts={info} period={period} />
      <Card className="rounded-3xl border-slate-200 shadow-sm">
        <CardHeader>
          <CardTitle>Portfolio reconciliation watchlist</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          <MetricCard label="Delivery missing" value={String(rows.filter((row) => row.revenueDataStatus === "configured_no_delivery").length)} />
          <MetricCard label="Accounting fallback" value={String(rows.filter((row) => row.revenueDataStatus === "accounting_fallback").length)} />
          <MetricCard label="Budget exceeded" value={String(rows.filter((row) => (row.budgetUtilizationPct ?? 0) > 100).length)} />
        </CardContent>
      </Card>
    </div>
  );
}

<TabsContent value="alerts" className="flex-1 overflow-auto px-4 py-3 m-0">
  {summary ? (
    <ProcessPnlAlertsWorkspace
      alerts={summary.alerts}
      rows={summary.rows}
      period={period}
    />
  ) : (
    <Skeleton className="h-96 rounded-3xl" />
  )}
</TabsContent>
```

- [ ] **Step 4: Run tests and build**

Run:

```bash
node backend/node_modules/vitest/vitest.mjs run src/tests/process-pnl-page.contract.test.tsx src/tests/process-pnl-matrix-config.test.ts --config vite.config.ts --globals
npm run build
```

Expected:

- Vitest: PASS
- Build: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/finance/pnl/ProcessPnlAlertsWorkspace.tsx src/components/finance/pnl/PnlDataQualityPanel.tsx src/pages/finance/ProcessPnlPage.tsx src/tests/process-pnl-page.contract.test.tsx
git commit -m "feat: add process pnl alerts workspace"
```

## Final Verification

- [ ] Run focused frontend tests

```bash
node backend/node_modules/vitest/vitest.mjs run src/tests/process-pnl-matrix-config.test.ts src/tests/process-pnl-page.contract.test.tsx --config vite.config.ts --globals
```

Expected: PASS

- [ ] Run route composition smoke if page structure changed

```bash
npm run verify:routes
```

Expected: PASS

- [ ] Run build

```bash
npm run build
```

Expected: `vite build` completes successfully

- [ ] Manual checks

```text
1. Open /finance/process-pnl
2. Confirm default tab is CEO Overview and Process Matrix opens with Summary preset
3. Confirm Summary, Revenue, Cost, Profitability, Budget & Risk, and Full Matrix presets all render
4. Confirm status chips and issue chips filter the table
5. Confirm sticky identifying columns remain visible during horizontal scroll
6. Confirm totals row remains visible below the header
7. Confirm drawer opens only from explicit action icon
8. Confirm Alerts & Reconciliation tab renders grouped alert sections
9. Confirm Export still downloads without changing backend APIs
```

## Spec Coverage Check

- Matrix presets: covered by Tasks 1-3
- Default summary view: covered by Task 2
- Sticky totals row: covered by Task 3
- Status and issue filters: covered by Tasks 1-2
- Full matrix preservation: covered by Task 3
- Row inspection drawer: covered by Task 4
- Alerts & Reconciliation workspace: covered by Task 5
- No backend finance changes: preserved across all tasks by file scope

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Preset refactor accidentally changes displayed finance values | High | Keep all row values sourced from existing `BpoPnlRow`; add pure helper tests before UI refactor |
| Matrix remains visually dense after presets | Medium | Limit default summary to the approved subset and keep Full Matrix explicitly advanced |
| Drawer and toolbar state become tangled | Medium | Keep state ownership in `ProcessPnlPage.tsx` and use pure config helpers for filtering/sorting |
| Alerts workspace duplicates overview behavior | Low | Keep Overview for executive story; move follow-up and grouping behavior into Alerts workspace |

