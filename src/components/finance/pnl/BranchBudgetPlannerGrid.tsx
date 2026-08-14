import { Fragment, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Wrench } from "lucide-react";
import {
  BRANCH_SHARING_METHODS,
  type BranchBudgetLineInput,
  type CostCentreOption,
  type MonthlyDriverInput,
} from "@/hooks/useBranchBudget";
import type { FinanceExpenseHead } from "@/hooks/useFinanceExpenseMasters";
import { splitRupees, weightFor } from "@/lib/sharingWeights";

/**
 * Spreadsheet entry for a branch budget: rows are Header / Sub-header / Detail, columns are cost
 * centres. Replaces card-by-card entry, which took an Excel import plus 38 expanding cards to
 * build one month.
 *
 * The per-cost-centre figures shown here are a PREVIEW. computeLineAllocations on the server is
 * authoritative and recomputes everything on save; this mirrors its largest-remainder split so the
 * grid can respond as you type. Both work at whole-rupee granularity for the same reason: a paise
 * split yields shares like 1428.57 which each display as 1,429, so a column of seven would read
 * 10,003 against a 10,000 total.
 */

/**
 * Meter-wise is the one method whose weights live outside the budget: they come from
 * finance_meter_reading, which the browser has no copy of, so its cells cannot be previewed and are
 * filled by the server on save. Manual is the only method whose cells the user types directly, and
 * what they type is a PERCENTAGE — the model has no per-cost-centre units field for a branch-level
 * line, and borrowing manualAllocations to hold units would corrupt real manual splits.
 */
const SERVER_DERIVED = new Set(["meter_wise"]);

const UNIT_OPTIONS = ["Unit", "Nos", "Lot", "Month", "Year", "Seat", "Device", "User", "Connection",
  "Shipment", "Service", "Employee", "Campaign", "Trip", "Event", "Litre", "kWh", "KL"];

type DriverKey = "plannedHeadcount" | "revenueRatePerHead" | "seatCount" | "floorAreaSqft" | "deviceCount" | "hiringVolume";

const DRIVER_ROWS: { label: string; key: DriverKey; column: "units" | "amount" }[] = [
  { label: "Planned headcount", key: "plannedHeadcount", column: "units" },
  { label: "Seats", key: "seatCount", column: "units" },
  { label: "Floor area (sq ft)", key: "floorAreaSqft", column: "units" },
  { label: "Devices", key: "deviceCount", column: "units" },
  { label: "Hiring volume", key: "hiringVolume", column: "units" },
  { label: "Revenue rate / head", key: "revenueRatePerHead", column: "amount" },
];

const money = (n: number) =>
  n || n === 0 ? Math.round(n).toLocaleString("en-IN") : "—";
const qnum = (n: number | null | undefined) =>
  n || n === 0 ? Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 }) : "—";

/**
 * The key both sides of the Prev/Variance lookup must agree on.
 *
 * This existed as a hand-built template literal in four places and they drifted: the map was
 * written with a lower-cased sub-head while this grid read it back with the original case, so
 * every capitalised sub-head — which is all of them, "Office Rent", "Electricity Govt." — missed,
 * and the Prev and Var columns silently read "—" as though last month had no budget. Nothing
 * errored; the columns just looked empty, which is indistinguishable from having no prior data.
 *
 * Case-fold both halves and keep it in one function so the two sides cannot disagree again.
 */
export function budgetLineKey(head: string | null | undefined, subHead: string | null | undefined): string {
  return `${(head ?? "").trim().toLowerCase()}|${(subHead ?? "").trim().toLowerCase()}`;
}

/** One head/sub-head from last month, carrying the original casing a new row needs. */
export interface PriorBudgetRow {
  head: string;
  subHead: string;
  /** Gross for the month. The mirror supplies only this; a workspace budget also has qty x rate. */
  amount: number;
  quantity?: number | null;
  unitRate?: number | null;
}

/**
 * Copy last month's budget forward into this month's draft.
 *
 * WHAT WAS WRONG. This lived inline in the workspace and only ever `.map()`ed over rows that
 * already existed — it never created one. A branch opening a fresh month gets a single starter
 * row with `head: ""`, whose key matches nothing, so the button did nothing at all when clicked
 * and the Prev/Var cells on that row stayed blank. Both reported symptoms, one cause. Extracted
 * here as a pure function because a reducer that silently does nothing is exactly the kind that
 * needs a test.
 *
 * Rules, in order:
 *   1. An existing row with a matching prior key and no figure yet is FILLED. A row that already
 *      carries a figure is never overwritten — the branch's own planning wins over last month's.
 *   2. Every prior key with no row is CREATED.
 *   3. The untouched starter row is dropped once anything was created, so the branch is not left
 *      with a stray empty line above its budget.
 *
 * `makeLine` is injected rather than imported so the caller supplies the same preset the
 * "add from masters" path uses — notably non-GST, since blankLine()'s own default is 18%
 * exclusive and the branch would have to clear it on every copied row.
 */
export function applyCopyForward(
  lines: BranchBudgetLineInput[],
  priorRows: PriorBudgetRow[],
  makeLine: (preset: Partial<BranchBudgetLineInput>) => BranchBudgetLineInput,
): BranchBudgetLineInput[] {
  if (priorRows.length === 0) return lines;

  // Duplicate head/sub-head pairs occur in real prior data (2026-09 NOIDA-2 carries several
  // twice), so collapse to one row per key and sum, matching how the Prev column totals them.
  const byKey = new Map<string, PriorBudgetRow>();
  for (const row of priorRows) {
    const key = budgetLineKey(row.head, row.subHead);
    const existing = byKey.get(key);
    if (existing) {
      // Summed rows can no longer claim a single qty x rate; fall back to the total.
      byKey.set(key, { ...existing, amount: existing.amount + row.amount, quantity: null, unitRate: null });
    } else {
      byKey.set(key, row);
    }
  }

  const seen = new Set<string>();
  const filled = lines.map((line) => {
    const key = budgetLineKey(line.head, line.subHead);
    seen.add(key);
    const prior = byKey.get(key);
    if (!prior || prior.amount <= 0) return line;
    const already = (Number(line.quantity) || 0) * (Number(line.unitRate) || 0);
    if (already !== 0) return line;
    return { ...line, ...splitAmount(prior) };
  });

  const created: BranchBudgetLineInput[] = [];
  for (const [key, prior] of byKey.entries()) {
    if (seen.has(key) || prior.amount <= 0) continue;
    created.push(makeLine({
      head: prior.head,
      subHead: prior.subHead,
      itemName: prior.subHead || prior.head,
      ...splitAmount(prior),
    }));
  }

  if (created.length === 0) return filled;
  // Drop the starter row only if it is still untouched — an empty head with nothing priced on it.
  const kept = filled.filter((line) => !(!line.head && !line.subHead && !(Number(line.unitRate) || 0)));
  return [...kept, ...created];
}

/** Prefer the real quantity x rate when the prior month has one; the mirror carries only a total. */
function splitAmount(prior: PriorBudgetRow): { quantity: number; unitRate: number } {
  const qty = Number(prior.quantity) || 0;
  const rate = Number(prior.unitRate) || 0;
  if (qty > 0 && rate > 0) return { quantity: qty, unitRate: rate };
  return { quantity: 1, unitRate: prior.amount };
}

export interface PlannerRow {
  index: number;
  line: BranchBudgetLineInput;
}

export interface BranchBudgetPlannerGridProps {
  lines: BranchBudgetLineInput[];
  masters: FinanceExpenseHead[];
  costCentres: CostCentreOption[];
  drivers: Record<string, MonthlyDriverInput>;
  canEdit: boolean;
  period: string;
  onUpdateLine: (index: number, patch: Partial<BranchBudgetLineInput>) => void;
  onAddLine: (head: string, subHead: string, unit: string, method: string) => void;
  onRemoveLine: (index: number) => void;
  onDriverChange: (costCentreId: string, key: DriverKey, value: number) => void;
  onAmendTax?: (lineId: string) => void;
  /** Hiding the standalone drivers card in table mode also hid its Save button, leaving no way to
   *  persist a driver edited in the pinned band. Both saves belong on the grid's own toolbar. */
  onSaveDrivers?: () => void;
  onSaveDraft?: () => void;
  saving?: boolean;
  /** Last month's gross per "head|subHead". Matched by NAME, not line id, because saveDraft
   *  replaces the line set with fresh UUIDs every save. */
  priorByKey?: Map<string, number>;
  priorLabel?: string;
  /** How many head/sub-head rows last month had — shown on the button so a copy that legitimately
   *  changes nothing is distinguishable from one that silently failed. */
  priorRowCount?: number;
  onCopyForward?: () => void;
  dirtyCount?: number;
  canUndo?: boolean;
  onUndo?: () => void;
}

export function BranchBudgetPlannerGrid({
  lines, masters, costCentres, drivers, canEdit, period,
  onUpdateLine, onAddLine, onRemoveLine, onDriverChange,
  onAmendTax,
  onSaveDrivers, onSaveDraft, saving,
  priorByKey, priorLabel, priorRowCount, onCopyForward, dirtyCount = 0, canUndo, onUndo,
}: BranchBudgetPlannerGridProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [pickerHead, setPickerHead] = useState<string | null>(null);
  const [hint, setHint] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "planned" | "gaps">("all");
  /** Row index whose cost-centre scope popover is open. */
  const [scopeRow, setScopeRow] = useState<number | null>(null);
  /** Full-page mode: 38 rows x 7 cost centres does not fit a page that also carries a hero,
   *  a tab bar and a driver card, so the grid can take the whole viewport while planning. */
  const [fullPage, setFullPage] = useState(false);

  useEffect(() => {
    if (!fullPage) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setFullPage(false); };
    window.addEventListener("keydown", onKey);
    // Stop the page behind from scrolling while the grid owns the screen.
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [fullPage]);

  const activeHeads = useMemo(
    () => masters.filter((h) => h.activeStatus).map((h) => ({
      ...h,
      subHeads: h.subHeads.filter((s) => s.activeStatus),
    })),
    [masters]
  );

  /** Preview each line's per-cost-centre figures, mirroring the server's split. */
  const preview = useMemo(() => {
    const byLine = new Map<number, { amount: number; qty: number | null; cells: { units: number | null; amount: number }[]; unallocated: number }>();
    lines.forEach((line, index) => {
      const method = line.allocationDriver ?? "";
      const branchLevel = line.planningLevel === "branch";
      const scope = line.includedCostCentreIds?.length
        ? costCentres.filter((cc) => line.includedCostCentreIds!.includes(cc.id))
        : costCentres;

      if (!branchLevel) {
        // Direct to one cost centre: the whole amount sits on it.
        const amount = Math.round((Number(line.quantity) || 0) * (Number(line.unitRate) || 0));
        byLine.set(index, {
          amount,
          qty: Number(line.quantity) || null,
          cells: costCentres.map((cc) => ({ units: cc.id === line.costCentreId ? Number(line.quantity) || null : null, amount: cc.id === line.costCentreId ? amount : 0 })),
          unallocated: 0,
        });
        return;
      }

      const amount = Math.round((Number(line.quantity) || 0) * (Number(line.unitRate) || 0));

      if (SERVER_DERIVED.has(method)) {
        // No meter readings in the browser, so show the branch figure and leave the cells blank
        // rather than inventing a split that the server would then contradict.
        byLine.set(index, {
          amount,
          qty: Number(line.quantity) || null,
          cells: costCentres.map(() => ({ units: null, amount: 0 })),
          unallocated: 0,
        });
        return;
      }

      if (method === "manual") {
        const pctById = new Map((line.manualAllocations ?? []).map((m) => [m.costCentreId, Number(m.percentage) || 0]));
        // Deliberately NOT splitRupees: that normalises by the weight total, so whatever you type
        // gets rescaled back to the row Amount and a manual split can never appear unbalanced —
        // typing 18,08,800 into one cell silently displayed 15,97,706. Each share is taken at face
        // value so the figure you type is the figure you see, and any shortfall or excess shows up
        // as a real imbalance the save must resolve.
        const byCc = new Map(scope.map((cc) => [cc.id, Math.round(((pctById.get(cc.id) ?? 0) / 100) * amount)]));
        byLine.set(index, {
          amount,
          qty: Number(line.quantity) || null,
          // units carries the rupee share the user types; amount is the same figure, so the
          // Amount column always agrees with what was entered.
          cells: costCentres.map((cc) => ({ units: byCc.get(cc.id) ?? null, amount: byCc.get(cc.id) ?? 0 })),
          // In rupees, because that is what the user is typing. The server still needs the
          // percentages to total 100, which is the same condition as the amounts totalling the row.
          unallocated: Math.round(amount - scope.reduce((a, cc) => a + (byCc.get(cc.id) ?? 0), 0)),
        });
        return;
      }

      const weights = scope.map((cc) => weightFor(method, drivers[cc.id]));
      const parts = splitRupees(amount, weights);
      const byCc = new Map(scope.map((cc, i) => [cc.id, parts[i]]));
      byLine.set(index, {
        amount,
        qty: Number(line.quantity) || null,
        cells: costCentres.map((cc) => ({ units: null, amount: byCc.get(cc.id) ?? 0 })),
        unallocated: 0,
      });
    });
    return byLine;
  }, [lines, costCentres, drivers]);

  const rowsByHead = useMemo(() => {
    const q = query.trim().toLowerCase();
    const map = new Map<string, PlannerRow[]>();
    lines.forEach((line, index) => {
      const key = line.head || "(no head)";
      map.set(key, [...(map.get(key) ?? []), { index, line }]);
    });
    if (!q && filter === "all") return map;
    const filtered = new Map<string, PlannerRow[]>();
    map.forEach((rows, head) => {
      const kept = rows.filter(({ index, line }) => {
        const matches = !q
          || head.toLowerCase().includes(q)
          || (line.subHead ?? "").toLowerCase().includes(q)
          || (line.itemDescription ?? "").toLowerCase().includes(q);
        if (!matches) return false;
        const planned = (preview.get(index)?.amount ?? 0) > 0;
        return filter === "all" || (filter === "planned" ? planned : !planned);
      });
      if (kept.length) filtered.set(head, kept);
    });
    return filtered;
  }, [lines, query, filter, preview]);

  /** How many cost centres a line covers. An empty selection means all of them. */
  const scopeCount = (line: BranchBudgetLineInput) =>
    line.includedCostCentreIds?.length ? line.includedCostCentreIds.length : costCentres.length;

  const branchTotal = lines.reduce((a, _l, i) => a + (preview.get(i)?.amount ?? 0), 0);
  const columnTotal = (ccIndex: number) =>
    lines.reduce((a, _l, i) => a + (preview.get(i)?.cells[ccIndex]?.amount ?? 0), 0);

  const num = "font-mono text-right tabular-nums";
  const calcCell = "bg-slate-50 text-slate-700 cursor-help";

  return (
    <div className={fullPage
      ? "fixed inset-0 z-[70] flex flex-col overflow-hidden border-0 bg-white"
      : "overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm"}>
      {(() => {
        // What actually blocks a save, said before the save fails rather than after.
        const known = new Set(activeHeads.map((h) => h.headName));
        const orphans = lines.filter((l) => !known.has(l.head || "")).length;
        const unbalanced = lines.filter((l, i) =>
          l.planningLevel === "branch" && l.allocationDriver === "manual"
          && Math.abs(preview.get(i)?.unallocated ?? 0) > 0.009).length;
        const plannedSubHeads = new Set(
          lines.filter((l, i) => (preview.get(i)?.amount ?? 0) > 0).map((l) => `${l.head}|${l.subHead ?? ""}`)
        );
        const totalSubHeads = activeHeads.reduce((a, h) => a + h.subHeads.length, 0);
        const undecided = Math.max(0, totalSubHeads - plannedSubHeads.size);
        const bits: string[] = [];
        if (orphans) bits.push(`${orphans} line${orphans > 1 ? "s" : ""} with no recognised head`);
        if (unbalanced) bits.push(`${unbalanced} manual split${unbalanced > 1 ? "s" : ""} not adding up`);
        const blocking = orphans + unbalanced;
        return (
          <div className={`flex flex-wrap items-center gap-3 border-b px-3 py-1.5 text-[13px] ${
            blocking ? "border-rose-200 bg-rose-50 text-rose-900" : "border-emerald-200 bg-emerald-50 text-emerald-900"}`}>
            {blocking
              ? <><strong>{bits.join(" · ")}</strong><span>— these block the save.</span></>
              : <><strong>Nothing blocking.</strong><span>{undecided ? `${undecided} of ${totalSubHeads} sub-heads still have no amount.` : `All ${totalSubHeads} sub-heads carry an amount.`}</span></>}
            {Boolean(unbalanced) && (
              <button type="button" className="underline" onClick={() => setFilter("all")}>Show rows</button>
            )}
          </div>
        );
      })()}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 py-1.5 text-[13px] text-slate-600">
        <input value={query} onChange={(e) => setQuery(e.target.value)} type="search"
          placeholder="Find a head or sub-head…" aria-label="Find a head or sub-head"
          className="h-7 w-48 rounded-md border border-slate-300 bg-white px-2 text-xs outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20" />
        <div className="flex overflow-hidden rounded-md border border-slate-300">
          {([["all", "All"], ["planned", "Planned"], ["gaps", "Not planned"]] as const).map(([key, label]) => (
            <button key={key} type="button" onClick={() => setFilter(key)}
              className={`border-r border-slate-300 px-2 py-1 last:border-r-0 ${filter === key ? "bg-blue-50 font-semibold text-blue-700" : "bg-white text-slate-600 hover:bg-slate-100"}`}>
              {label}
            </button>
          ))}
        </div>
        <button type="button" className="h-8 rounded-md border border-slate-300 bg-white px-2 hover:bg-slate-100"
          onClick={() => setCollapsed((c) => (c.size ? new Set() : new Set(activeHeads.map((h) => h.id))))}>
          {collapsed.size ? "Expand all" : "Collapse all"}
        </button>
        <button type="button" aria-label={fullPage ? "Exit full page" : "Full page"}
          className={`h-8 rounded-md border px-2 font-medium ${fullPage ? "border-blue-600 bg-blue-50 text-blue-700" : "border-slate-300 bg-white hover:bg-slate-100"}`}
          onClick={() => setFullPage((v) => !v)}>
          {fullPage ? "Exit full page (Esc)" : "Full page"}
        </button>
        <span className="ml-2 flex items-center gap-1.5"><span className="h-3 w-5 rounded border border-slate-300 bg-white" />Type here</span>
        <span className="flex items-center gap-1.5"><span className="h-3 w-5 rounded border border-slate-300 bg-slate-100" />Calculated</span>
        {onCopyForward && (
          <button type="button" disabled={!canEdit || !priorByKey?.size}
            title={priorByKey?.size
              ? `Adds every head and sub-head ${priorLabel ?? "last month"} budgeted that is missing here, and fills any empty row, using last month's amount. Rows you have already priced are left alone.`
              : "No previous month budget to copy from"}
            className="h-8 rounded-md border border-slate-300 bg-white px-2 hover:bg-slate-100 disabled:opacity-40"
            onClick={onCopyForward}>
            Copy {priorRowCount ? `${priorRowCount} lines` : ""} from {priorLabel ?? "previous"} →
          </button>
        )}
        {onUndo && (
          <button type="button" disabled={!canUndo} title="Undo the last change"
            className="h-8 rounded-md border border-slate-300 bg-white px-2 hover:bg-slate-100 disabled:opacity-40"
            onClick={onUndo}>Undo</button>
        )}
        <span className="ml-auto flex items-center gap-2 font-medium text-blue-700">
          {dirtyCount > 0 && (
            <span className="flex items-center gap-1.5 text-amber-800">
              <span className="inline-block h-2 w-2 rounded-full bg-amber-500" />
              Unsaved edits on {dirtyCount} line{dirtyCount > 1 ? "s" : ""}
            </span>
          )}
          {hint}
        </span>
        {onSaveDrivers && (
          <button type="button" disabled={!canEdit || saving}
            className="h-8 rounded-md border border-slate-300 bg-white px-2.5 font-medium hover:bg-slate-100 disabled:opacity-50"
            onClick={onSaveDrivers}>Save drivers</button>
        )}
        {onSaveDraft && (
          <button type="button" disabled={!canEdit || saving}
            className="h-8 rounded-md bg-blue-600 px-3 font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            onClick={onSaveDraft}>{saving ? "Saving…" : "Save draft"}</button>
        )}
      </div>

      <div className={fullPage ? "flex-1 overflow-auto" : "max-h-[68vh] overflow-auto"}>
        <table className="w-max table-fixed border-separate border-spacing-0 text-[14px]">
          <colgroup>
            <col style={{ width: 250 }} /><col style={{ width: 160 }} />
            <col style={{ width: 70 }} /><col style={{ width: 88 }} /><col style={{ width: 96 }} />
            <col style={{ width: 96 }} /><col style={{ width: 66 }} /><col style={{ width: 112 }} /><col style={{ width: 140 }} /><col style={{ width: 30 }} />
            {/* Units and Amount must alternate PER cost centre, so each pair sits under its own
                column-group header. Emitting all the Units first produced a header reading
                "UNITS UNITS ... AMOUNT AMOUNT" with nothing lining up. */}
            {costCentres.flatMap((cc) => [
              <col key={`u-${cc.id}`} style={{ width: 74 }} />,
              <col key={`a-${cc.id}`} style={{ width: 104 }} />,
            ])}
          </colgroup>
          <thead>
            <tr className="text-[12px] font-semibold uppercase tracking-wide text-slate-600">
              {/* The frozen region is exactly the two frozen columns — Sub-header and Detail — and
                  nothing more. "Total branch budget" previously sat in a STICKY cell spanning seven
                  columns, so as you scrolled right that one ~560px cell stayed pinned and painted
                  over the cost-centre group headers, hiding them. A sticky cell can only ever cover
                  its neighbours, so the label now lives in a normal cell that scrolls away with the
                  columns it describes. */}
              <th className="sticky left-0 top-0 z-40 border-b border-r border-slate-200 bg-slate-50 px-2 py-2 text-left">Total branch budget</th>
              <th className="sticky top-0 z-40 border-b border-r-2 border-slate-300 bg-slate-50 px-2 py-2 text-left" style={{ left: 250 }}>&nbsp;</th>
              <th className="sticky top-0 z-20 border-b border-r-2 border-slate-300 bg-slate-50 px-2 py-2 text-left" colSpan={8}>&nbsp;</th>
              {costCentres.map((cc) => (
                <th key={cc.id} className="sticky top-0 z-30 border-b border-l border-r border-slate-200 bg-slate-50 px-2 py-2 text-center" colSpan={2}>
                  {/* The process name is real data on cost_centre_master, so show it. Only a cost
                      centre that genuinely has none is flagged — asserting "unmapped" for every
                      column was wrong: all seven NOIDA-2 cost centres carry a process. */}
                  <span className="block font-mono text-[12px] normal-case text-slate-800">{cc.costCentreCode}</span>
                  {cc.processName
                    ? <span className="block text-[12px] font-semibold normal-case text-blue-700">{cc.processName}</span>
                    : <span className="block text-[12px] text-amber-800">process not recorded</span>}
                </th>
              ))}
            </tr>
            <tr className="text-[12px] font-semibold uppercase tracking-wide text-slate-600">
              <th className="sticky left-0 z-40 border-b border-r border-slate-200 bg-slate-50 px-2 py-1.5 text-left" style={{ top: 42 }}>Sub-header</th>
              <th className="sticky z-40 border-b border-r-2 border-slate-300 bg-slate-50 px-2 py-1.5 text-left" style={{ top: 42, left: 250 }}>Detail</th>
              <th className="sticky z-30 border-b border-r border-slate-200 bg-slate-50 px-2 py-1.5 text-right" style={{ top: 42 }}>Qty</th>
              <th className="sticky z-30 border-b border-r border-slate-200 bg-slate-50 px-2 py-1.5 text-left" style={{ top: 42 }}>Unit</th>
              <th className="sticky z-30 border-b border-r border-slate-200 bg-slate-50 px-2 py-1.5 text-right" style={{ top: 42 }}>Rate</th>
              <th className="sticky z-30 border-b border-r border-slate-200 bg-slate-50 px-2 py-1.5 text-right" style={{ top: 42 }}>Amount</th>
              <th className="sticky z-30 border-b border-r border-slate-200 bg-slate-50 px-2 py-1.5 text-right" style={{ top: 42 }} title="Last month's budget for the same sub-head">{priorLabel ?? "Prev"}</th>
              <th className="sticky z-30 border-b border-r border-slate-200 bg-slate-50 px-2 py-1.5 text-right" style={{ top: 42 }}>Var</th>
              <th className="sticky z-30 border-b border-r border-slate-200 bg-slate-50 px-2 py-1.5 text-left" style={{ top: 42 }}>Sharing</th>
              <th className="sticky z-30 border-b border-r border-slate-200 bg-slate-50 px-2 py-1.5" style={{ top: 42 }} title="Direction the arithmetic runs">⇅</th>
              {costCentres.flatMap((cc) => [
                <th key={`hu-${cc.id}`} className="sticky z-30 border-b border-l border-slate-200 bg-slate-50 px-2 py-1.5 text-right" style={{ top: 42 }}>Units</th>,
                <th key={`ha-${cc.id}`} className="sticky z-30 border-b border-r border-slate-200 bg-slate-50 px-2 py-1.5 text-right" style={{ top: 42 }}>Amount</th>,
              ])}
            </tr>
          </thead>

          <tbody>
            <tr>
              <td className="sticky left-0 z-20 border-b border-r border-slate-200 bg-blue-50 px-2 py-1.5 text-[10px] font-bold uppercase tracking-wide text-blue-700">Drivers · {period}</td>
              <td className="border-b border-slate-200 bg-blue-50" colSpan={9 + costCentres.length * 2} />
            </tr>
            {DRIVER_ROWS.map((row) => (
              <tr key={row.key} className="hover:bg-blue-50/60">
                <td className="sticky left-0 z-10 border-b border-r border-slate-200 bg-blue-50/50 px-2 py-1 font-medium text-slate-700">{row.label}</td>
                <td className="border-b border-r-2 border-slate-300 bg-blue-50/50" colSpan={9} />
                {costCentres.flatMap((cc) => [
                  <td key={`${row.key}-u-${cc.id}`} className="border-b border-l border-slate-200 bg-blue-50/50 p-0">
                    {row.column === "units" && (
                      <input type="number" min="0" disabled={!canEdit} aria-label={`${row.label} ${cc.costCentreCode}`}
                        className={`w-full bg-transparent px-2 py-1 ${num} outline-none focus:bg-white focus:ring-2 focus:ring-blue-600/30`}
                        value={Number(drivers[cc.id]?.[row.key] ?? 0)}
                        onChange={(e) => onDriverChange(cc.id, row.key, Number(e.target.value))} />
                    )}
                  </td>,
                  <td key={`${row.key}-a-${cc.id}`} className="border-b border-r border-slate-200 bg-blue-50/50 p-0">
                    {row.column === "amount" && (
                      <input type="number" min="0" disabled={!canEdit} aria-label={`${row.label} ${cc.costCentreCode}`}
                        className={`w-full bg-transparent px-2 py-1 ${num} outline-none focus:bg-white focus:ring-2 focus:ring-blue-600/30`}
                        value={Number(drivers[cc.id]?.[row.key] ?? 0)}
                        onChange={(e) => onDriverChange(cc.id, row.key, Number(e.target.value))} />
                    )}
                  </td>,
                ])}
              </tr>
            ))}

            {/* Lines whose head matches no active master head — the blank starter row, or a line
                left behind by a renamed head — are invisible in a grid keyed on the master, yet the
                engine still validates them and refuses the save with "Head and Sub-head are
                mandatory" about a row nobody can see. Surface them so they can be removed. */}
            {(() => {
              const known = new Set(activeHeads.map((h) => h.headName));
              const orphans = lines
                .map((line, index) => ({ index, line }))
                .filter(({ line }) => !known.has(line.head || ""));
              if (!orphans.length) return null;
              return (
                <>
                  <tr className="bg-amber-50">
                    <td className="sticky left-0 z-10 border-b border-r border-slate-200 bg-amber-50 px-2 py-1.5 font-semibold text-amber-900">
                      Not on the Finance master
                    </td>
                    <td className="border-b border-slate-200 bg-amber-50 px-2 py-1.5 text-amber-800" colSpan={9 + costCentres.length * 2}>
                      {orphans.length} line{orphans.length === 1 ? "" : "s"} with no recognised head. They block the save — remove them or set a head in the detailed line editor.
                    </td>
                  </tr>
                  {orphans.map(({ index, line }) => (
                    <tr key={`orphan-${index}`} className="hover:bg-amber-50/60">
                      <td className="sticky left-0 z-20 border-b border-r border-slate-200 bg-white px-2 py-1">
                        <span className="flex items-center gap-1">
                          <span className="flex-1 truncate text-slate-500">{line.head || "(no head)"}{line.subHead ? ` / ${line.subHead}` : ""}</span>
                          {canEdit && (
                            <button type="button" aria-label="Remove line" title="Remove this line"
                              className="rounded px-1 text-slate-400 hover:bg-rose-50 hover:text-rose-700"
                              onClick={() => onRemoveLine(index)}>✕</button>
                          )}
                        </span>
                      </td>
                      <td className="border-b border-slate-200 bg-white px-2 py-1 text-slate-500" colSpan={9 + costCentres.length * 2}>
                        {line.itemName || "(no item)"}
                      </td>
                    </tr>
                  ))}
                </>
              );
            })()}
            {activeHeads.map((head) => {
              const rows = rowsByHead.get(head.headName) ?? [];
              // While a search or filter is on, a head with no surviving rows must disappear
              // entirely. Rendering its group row regardless made the search box look dead: every
              // one of the 20 heads stayed on screen no matter what was typed.
              const filtering = Boolean(query.trim()) || filter !== "all";
              if (filtering && rows.length === 0) return null;
              const open = !collapsed.has(head.id);
              const headTotal = rows.reduce((a, r) => a + (preview.get(r.index)?.amount ?? 0), 0);
              return (
                <Fragment key={head.id}>
                  <tr className="bg-slate-50 font-semibold">
                    <td className="sticky left-0 z-10 border-b border-r border-slate-200 bg-slate-50 px-2 py-1.5">
                      <button type="button" className="mr-1 text-slate-500"
                        onClick={() => setCollapsed((c) => { const n = new Set(c); n.has(head.id) ? n.delete(head.id) : n.add(head.id); return n; })}>
                        {open ? "▾" : "▸"}
                      </button>
                      {head.headName}
                    </td>
                    <td className="border-b border-r-2 border-slate-300 bg-slate-50 px-2 py-1.5 text-slate-400">
                      {/* A sub-header can only ever come from the Finance master — never typed —
                          because coverage matches budget lines to sub-heads by name. */}
                      {pickerHead === head.id ? (
                        <select autoFocus className="w-full rounded border border-slate-300 px-1 py-0.5 text-xs"
                          onChange={(e) => {
                            const sub = head.subHeads.find((s) => s.subHeadName === e.target.value);
                            if (sub) onAddLine(head.headName, sub.subHeadName, sub.defaultUnit, sub.defaultAllocationDriver ?? "total_manpower");
                            setPickerHead(null);
                          }}>
                          <option value="">Choose sub-header…</option>
                          {head.subHeads.map((s) => <option key={s.id} value={s.subHeadName}>{s.subHeadName}</option>)}
                        </select>
                      ) : (
                        <span className="flex items-center gap-2">
                          {rows.length} line{rows.length === 1 ? "" : "s"}
                          {canEdit && (
                            <button type="button" className="rounded border border-slate-300 px-1.5 text-[11px] text-slate-600 hover:bg-white"
                              onClick={() => { setCollapsed((c) => { const n = new Set(c); n.delete(head.id); return n; }); setPickerHead(head.id); }}>
                              + line
                            </button>
                          )}
                        </span>
                      )}
                    </td>
                    <td className="border-b border-r border-slate-200 bg-slate-50" colSpan={3} />
                    <td className={`border-b border-r border-slate-200 bg-slate-50 px-2 py-1.5 ${num}`}>{headTotal ? money(headTotal) : "—"}</td>
                    <td className="border-b border-r border-slate-200 bg-slate-50" colSpan={2} />
                    {/* Sharing + ⇅ — 2 columns, matching every other row. This was colSpan={4},
                        which made the head-group row 2 columns wider than the colgroup declares,
                        forcing the table to grow 2 unlabeled phantom columns at the end. */}
                    <td className="border-b border-r border-slate-200 bg-slate-50" colSpan={2} />
                    {costCentres.flatMap((cc, ci) => {
                      const v = rows.reduce((a, r) => a + (preview.get(r.index)?.cells[ci]?.amount ?? 0), 0);
                      return [
                        <td key={`hg-u-${head.id}-${cc.id}`} className="border-b border-l border-slate-200 bg-slate-50" />,
                        <td key={`hg-a-${head.id}-${cc.id}`} className={`border-b border-r border-slate-200 bg-slate-50 px-2 py-1.5 ${num}`}>{v ? money(v) : "—"}</td>,
                      ];
                    })}
                  </tr>

                  {open && rows.map(({ index, line }) => {
                    const p = preview.get(index);
                    const method = line.allocationDriver ?? "";
                    const isManual = line.planningLevel === "branch" && method === "manual";
                    const isMetered = line.planningLevel === "branch" && SERVER_DERIVED.has(method);
                    const up = false; // every branch-level line is planned top-down: Qty x Rate
                    const planned = (p?.amount ?? 0) > 0;
                    const unbalanced = isManual && Math.abs(p?.unallocated ?? 0) > 0.009;
                    const explain = (text: string) => () => setHint(text);
                    return (
                      <tr key={`${index}-${line.head}-${line.subHead}`} className="hover:bg-slate-50">
                        <td className="sticky left-0 z-20 border-b border-r border-slate-200 bg-white px-2 py-1 font-medium text-slate-800">
                          <span className="flex items-center gap-1">
                            <span className="flex-1 truncate" title={line.subHead ?? ""}>{line.subHead}</span>
                            {/* Cost-centre scope. A branch-common line hits every cost centre unless
                                you say otherwise — real costs are often partial, so this is where a
                                cost centre gets unselected. */}
                            {costCentres.length > 0 && (
                              <span className="relative">
                                <button type="button" aria-label={`Cost centres for ${line.subHead}`}
                                  title="Choose which cost centres this line applies to"
                                  className={`rounded border px-1.5 font-mono text-[11px] font-semibold ${
                                    line.planningLevel !== "branch"
                                      ? "border-blue-300 bg-blue-50 text-blue-800"
                                      : scopeCount(line) < costCentres.length
                                        ? "border-amber-400 bg-amber-50 text-amber-900"
                                        : "border-slate-400 bg-white text-slate-700 hover:bg-slate-100"}`}
                                  onClick={() => setScopeRow(scopeRow === index ? null : index)}>
                                  {line.planningLevel === "branch" ? `${scopeCount(line)}/${costCentres.length} CC` : "1 CC"}
                                </button>
                                {scopeRow === index && (
                                  <div className="absolute left-0 top-6 z-50 w-56 rounded-lg border border-slate-200 bg-white p-2 shadow-lg">
                                    <div className="mb-1 flex items-center justify-between">
                                      <span className="text-[12px] font-semibold uppercase tracking-wide text-slate-600">Applies to</span>
                                      <button type="button" className="text-[11px] text-blue-700 underline"
                                        onClick={() => onUpdateLine(index, { includedCostCentreIds: null })}>Use all</button>
                                    </div>
                                    <div className="max-h-44 overflow-auto">
                                      {costCentres.map((cc) => {
                                        const direct = line.planningLevel !== "branch";
                                        // null means "all CCs selected" — materialise to full array so .includes() works correctly
                                        const selected = line.includedCostCentreIds ?? costCentres.map((c) => c.id);
                                        const on = direct
                                          ? line.costCentreId === cc.id
                                          : selected.includes(cc.id);
                                        if (direct) {
                                          return (
                                            <label key={cc.id} className="flex items-center gap-1.5 py-0.5 text-[12px] text-slate-700">
                                              <input type="radio" name={`cc-${index}`} checked={on} disabled={!canEdit}
                                                onChange={() => onUpdateLine(index, { costCentreId: cc.id })} />
                                              <span className="truncate font-mono">{cc.costCentreCode}</span>
                                            </label>
                                          );
                                        }
                                        return (
                                          <label key={cc.id} className="flex items-center gap-1.5 py-0.5 text-[12px] text-slate-700">
                                            <input type="checkbox" checked={on} disabled={!canEdit}
                                              onChange={(e) => {
                                                const next = e.target.checked
                                                  ? [...new Set([...selected, cc.id])]
                                                  : selected.filter((id) => id !== cc.id);
                                                onUpdateLine(index, { includedCostCentreIds: next.length === costCentres.length ? null : next });
                                              }} />
                                            <span className="truncate font-mono">{cc.costCentreCode}</span>
                                          </label>
                                        );
                                      })}
                                    </div>
                                    <button type="button" className="mt-1 w-full rounded border border-slate-300 py-0.5 text-[11px] text-slate-600 hover:bg-slate-50"
                                      onClick={() => setScopeRow(null)}>Done</button>
                                  </div>
                                )}
                              </span>
                            )}
                            {canEdit && (
                              <button type="button" title="Remove this line" aria-label="Remove line"
                                className="rounded px-1 text-slate-400 hover:bg-rose-50 hover:text-rose-700"
                                onClick={() => onRemoveLine(index)}>✕</button>
                            )}
                            {!canEdit && onAmendTax && line.id && (
                              <button type="button" title="Amend Tax Treatment" aria-label="Amend Tax Treatment"
                                className="rounded px-1 text-amber-600 hover:bg-amber-50 hover:text-amber-800"
                                onClick={() => onAmendTax(line.id!)}>
                                <Wrench className="h-3 w-3" />
                              </button>
                            )}
                          </span>
                        </td>
                        <td className="border-b border-r-2 border-slate-300 bg-white p-0">
                          <input disabled={!canEdit} aria-label={`Detail for ${line.subHead}`} placeholder="add detail"
                            className="w-full bg-transparent px-2 py-1 outline-none focus:bg-white focus:ring-2 focus:ring-blue-600/30"
                            value={line.itemDescription ?? ""} onChange={(e) => onUpdateLine(index, { itemDescription: e.target.value })} />
                        </td>
                        <td className={`border-b border-r border-slate-200 p-0 ${up ? calcCell : "bg-white"}`}
                          title={up ? "Summed from the per-cost-centre Units you type on the right." : undefined}
                          onClick={up ? explain("Qty is summed from the per-cost-centre Units, because this row is bottom-up (↑).") : undefined}>
                          {up ? <div className={`px-2 py-1 ${num}`}>{qnum(p?.qty)}</div> : (
                            <input type="number" min="0" step="0.0001" disabled={!canEdit} aria-label="Quantity"
                              className={`w-full bg-transparent px-2 py-1 ${num} outline-none focus:bg-white focus:ring-2 focus:ring-blue-600/30`}
                              value={line.quantity ?? ""} onChange={(e) => onUpdateLine(index, { quantity: Number(e.target.value) })} />
                          )}
                        </td>
                        <td className="border-b border-r border-slate-200 bg-white p-0">
                          <select disabled={!canEdit} aria-label="Unit type"
                            className="w-full bg-transparent px-1.5 py-1 text-[13px] font-medium text-slate-800 outline-none focus:bg-white focus:ring-2 focus:ring-blue-600/30"
                            value={line.unit} onChange={(e) => onUpdateLine(index, { unit: e.target.value })}>
                            {UNIT_OPTIONS.map((u) => <option key={u} value={u}>{u}</option>)}
                          </select>
                        </td>
                        <td className="border-b border-r border-slate-200 bg-white p-0">
                          <input type="number" min="0" step="0.0001" disabled={!canEdit} aria-label="Rate"
                            className={`w-full bg-transparent px-2 py-1 ${num} outline-none focus:bg-white focus:ring-2 focus:ring-blue-600/30`}
                            value={line.unitRate ?? ""} onChange={(e) => onUpdateLine(index, { unitRate: Number(e.target.value) })} />
                        </td>
                        <td className={`border-b border-r border-slate-200 px-2 py-1 ${num} ${up ? calcCell : "bg-white font-semibold text-slate-800"}`}
                          title={up ? "Summed from the per-cost-centre Amounts, because this row is bottom-up (↑)." : undefined}
                          onClick={up ? explain("Amount is the sum of the cost-centre cells on this row.") : undefined}>
                          {planned ? money(p!.amount) : "—"}
                        </td>
                        {(() => {
                          const prior = priorByKey?.get(budgetLineKey(line.head, line.subHead)) ?? 0;
                          const varPct = prior > 0 ? (((p?.amount ?? 0) - prior) / prior) * 100 : null;
                          return (
                            <>
                              <td className={`border-b border-r border-slate-200 px-2 py-1 ${num} ${calcCell}`}
                                title="Last month's budget for this sub-head — reference only.">
                                {prior ? money(prior) : "—"}
                              </td>
                              <td className={`border-b border-r border-slate-200 px-2 py-1 ${num} ${calcCell} ${varPct !== null && Math.abs(varPct) > 25 ? "text-rose-700 font-semibold" : ""}`}
                                title="Change against last month.">
                                {varPct === null ? "—" : `${varPct > 0 ? "+" : ""}${varPct.toFixed(1)}%`}
                              </td>
                            </>
                          );
                        })()}
                        <td className="border-b border-r border-slate-200 bg-white p-0">
                          <select disabled={!canEdit} aria-label="Sharing method"
                            className="w-full bg-transparent px-1.5 py-1 text-[13px] font-medium text-slate-800 outline-none focus:bg-white focus:ring-2 focus:ring-blue-600/30"
                            value={line.planningLevel === "branch" ? method : "__direct"}
                            onChange={(e) => {
                              if (e.target.value === "__direct") {
                                onUpdateLine(index, {
                                  planningLevel: "cost_centre",
                                  attributionScope: "cost_centre",
                                  costCentreId: line.costCentreId ?? costCentres[0]?.id ?? null,
                                  allocationDriver: "direct_tagging",
                                  includedCostCentreIds: null,
                                });
                                return;
                              }
                              onUpdateLine(index, {
                                planningLevel: "branch",
                                attributionScope: "branch_common",
                                costCentreId: null,
                                allocationDriver: e.target.value,
                              });
                            }}>
                            {BRANCH_SHARING_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                            {/* Not a branch-level sharing method: it drops the line to
                                planning_level 'cost_centre' so it sits on one cost centre and is
                                never spread. Kept in the same dropdown because that is where a
                                planner looks for it. */}
                            <option value="__direct">Direct to one cost centre</option>
                          </select>
                        </td>
                        <td className={`border-b border-r border-slate-200 px-1 text-center font-mono font-bold ${calcCell} ${up ? "text-emerald-700" : "text-blue-700"}`}
                          title={up ? "Bottom-up: type the cost-centre cells, the branch total is their sum." : "Top-down: type the branch Amount, the cost-centre cells are derived."}>
                          {up ? "↑" : "↓"}
                        </td>
                        {/* Units and Amount alternate per cost centre. The Amount cell is typeable
                            on EVERY branch-level row: typing a figure turns the row into a manual
                            split seeded from whatever the method had just derived, so the numbers
                            do not jump and you can override one cost centre without first hunting
                            for the right sharing method. */}
                        {costCentres.flatMap((cc, ci) => {
                          const cellAmount = p?.cells[ci]?.amount ?? 0;
                          const isDirectRow = line.planningLevel !== "branch";
                          const isAssignedCC = cc.id === line.costCentreId;
                          // Switch to a manual split, keeping every current figure, then apply the
                          // one the user just typed. Percentages are what the engine stores.
                          const typeAmount = (raw: string) => {
                            if (isDirectRow) {
                              // Direct mode: the gross amount is quantity × unitRate; set quantity=1
                              // so the row total equals whatever the user types directly.
                              onUpdateLine(index, { quantity: 1, unitRate: Number(raw) || 0 });
                              return;
                            }
                            const typed = Number(raw) || 0;
                            const total = p?.amount ?? 0;
                            if (total <= 0) return;
                            const amounts = costCentres.map((other, oi) =>
                              other.id === cc.id ? typed : (p?.cells[oi]?.amount ?? 0));
                            onUpdateLine(index, {
                              allocationDriver: "manual",
                              manualAllocations: costCentres.map((other, oi) => ({
                                costCentreId: other.id,
                                percentage: (amounts[oi] / total) * 100,
                              })),
                            });
                          };
                          return [
                            <td key={`u-${index}-${cc.id}`} className={`border-b border-l border-slate-200 p-0 ${isMetered && !isDirectRow ? "bg-white" : calcCell}`}
                              title={isDirectRow
                                ? "Units do not apply to direct cost-centre rows — type directly into the Amount cell."
                                : isMetered
                                  ? "Projected consumption for this cost centre. Units × Rate gives its amount."
                                  : "Units are only entered on a metered row; on this row the amounts are what you type or what the method derives."}
                              onClick={!isDirectRow && !isMetered ? explain("Units apply to metered rows. On this row, type into the Amount cell instead.") : undefined}>
                              {isMetered && !isDirectRow ? (
                                <input type="number" min="0" step="1" disabled={!canEdit} aria-label={`${cc.costCentreCode} units`}
                                  className={`w-full bg-transparent px-2 py-1 ${num} outline-none focus:bg-white focus:ring-2 focus:ring-blue-600/30`}
                                  value={p?.cells[ci]?.units ?? ""}
                                  onChange={(e) => {
                                    const units = Number(e.target.value) || 0;
                                    const rest = (line.manualAllocations ?? []).filter((m) => m.costCentreId !== cc.id);
                                    onUpdateLine(index, { manualAllocations: [...rest, { costCentreId: cc.id, percentage: units }] });
                                  }} />
                              ) : <div className={`px-2 py-1 ${num} text-slate-500`}>—</div>}
                            </td>,
                            <td key={`a-${index}-${cc.id}`} className={`border-b border-r border-slate-200 p-0 ${unbalanced ? "bg-rose-50" : "bg-white"}`}
                              title={isDirectRow
                                ? (isAssignedCC ? "Direct amount for this cost centre." : "Amount is assigned to the selected cost centre only.")
                                : "This cost centre's share in rupees. Typing here overrides the sharing method for this row."}>
                              {isDirectRow && !isAssignedCC ? (
                                <div className={`px-2 py-1 ${num} text-center text-slate-400`}>—</div>
                              ) : (
                                <input type="number" min="0" step="1" disabled={!canEdit}
                                  aria-label={`${cc.costCentreCode} share amount`}
                                  className={`w-full bg-transparent px-2 py-1 ${num} outline-none focus:bg-white focus:ring-2 focus:ring-blue-600/30 ${unbalanced ? "text-rose-700" : ""}`}
                                  value={cellAmount || ""}
                                  onChange={(e) => typeAmount(e.target.value)} />
                              )}
                            </td>,
                          ];
                        })}
                      </tr>
                    );
                  })}
                  {open && rows.filter((r) => {
                      const l = r.line;
                      return l.planningLevel === "branch" && l.allocationDriver === "manual"
                        && Math.abs(preview.get(r.index)?.unallocated ?? 0) > 0.009;
                    }).map((r) => (
                      // The server refuses a manual split that is not exactly 100%, so say so here
                      // rather than letting the save fail with a message about a row you cannot see.
                      <tr key={`warn-${r.index}`}>
                        <td className="sticky left-0 z-10 border-b border-r border-slate-200 bg-rose-50" />
                        <td className="border-b border-r-2 border-slate-300 bg-rose-50 px-2 py-1 text-rose-700" colSpan={9 + costCentres.length * 2}>
                          <span className="font-semibold">{r.line.subHead}</span>: the cost-centre
                          amounts are Rs {money(Math.abs(preview.get(r.index)?.unallocated ?? 0))}{" "}
                          {(preview.get(r.index)?.unallocated ?? 0) > 0 ? "short of" : "over"} the row
                          Amount. They must add up to it exactly before this budget can be saved.
                        </td>
                      </tr>
                  ))}
                </Fragment>
              );
            })}
            {(() => {
              const shown = activeHeads.reduce((a, h) => a + (rowsByHead.get(h.headName)?.length ?? 0), 0);
              const filtering = Boolean(query.trim()) || filter !== "all";
              if (!filtering || shown > 0) return null;
              return (
                <tr>
                  <td className="sticky left-0 z-10 border-b border-r border-slate-200 bg-white" />
                  <td className="border-b border-slate-200 bg-white px-3 py-6 text-center text-slate-600"
                    colSpan={9 + costCentres.length * 2}>
                    Nothing matches{query.trim() ? ` "${query.trim()}"` : ""}
                    {filter !== "all" ? ` in ${filter === "planned" ? "planned" : "not planned"} rows` : ""}.
                    <button type="button" className="ml-2 text-blue-700 underline"
                      onClick={() => { setQuery(""); setFilter("all"); }}>Clear</button>
                  </td>
                </tr>
              );
            })()}
          </tbody>

          <tfoot>
            <tr className="font-semibold">
              <td className="sticky bottom-0 left-0 z-40 border-r border-t-2 border-slate-300 bg-slate-100 px-2 py-2 text-slate-700">Cost-centre total</td>
              <td className="sticky bottom-0 z-30 border-r-2 border-t-2 border-slate-300 bg-slate-100 px-2 py-2 text-slate-400">{lines.length} lines</td>
              <td className="sticky bottom-0 z-30 border-r border-t-2 border-slate-300 bg-slate-100" colSpan={3} />
              <td className={`sticky bottom-0 z-30 border-r border-t-2 border-slate-300 bg-slate-100 px-2 py-2 ${num}`}>{money(branchTotal)}</td>
              <td className="sticky bottom-0 z-30 border-r border-t-2 border-slate-300 bg-slate-100" colSpan={2} />
              {/* Sharing + ⇅ — 2 columns. Same colSpan={4} overflow as the head-group row above. */}
              <td className="sticky bottom-0 z-30 border-r border-t-2 border-slate-300 bg-slate-100" colSpan={2} />
              {costCentres.flatMap((cc, ci) => {
                const pct = branchTotal ? (columnTotal(ci) / branchTotal) * 100 : 0;
                return [
                  <td key={`fu-${cc.id}`} className={`sticky bottom-0 z-30 border-l border-t-2 border-slate-300 bg-slate-100 px-2 py-2 ${num} text-[10px] font-normal text-slate-500`}>{pct ? `${pct.toFixed(1)}%` : "—"}</td>,
                  <td key={`fa-${cc.id}`} className={`sticky bottom-0 z-30 border-r border-t-2 border-slate-300 bg-slate-100 px-2 py-2 ${num}`}>{columnTotal(ci) ? money(columnTotal(ci)) : "—"}</td>,
                ];
              })}
            </tr>
          </tfoot>
        </table>
      </div>

      {!costCentres.length && (
        <div className="flex items-center gap-2 border-t border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <AlertTriangle className="h-4 w-4" />
          This branch has no active cost centres, so a branch-common line cannot be split.
        </div>
      )}
    </div>
  );
}
