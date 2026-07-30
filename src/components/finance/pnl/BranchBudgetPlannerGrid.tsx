import { Fragment, useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import {
  BRANCH_SHARING_METHODS,
  type BranchBudgetLineInput,
  type CostCentreOption,
  type MonthlyDriverInput,
} from "@/hooks/useBranchBudget";
import type { FinanceExpenseHead } from "@/hooks/useFinanceExpenseMasters";

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

/** The weight each method divides by, read from the same drivers the server uses. */
function weightFor(method: string, driver: MonthlyDriverInput | undefined): number {
  if (!driver) return 0;
  switch (method) {
    case "total_manpower":
    case "agent_headcount":
      return Number(driver.plannedHeadcount) || 0;
    case "revenue_share":
      return (Number(driver.plannedHeadcount) || 0) * (Number(driver.revenueRatePerHead) || 0);
    case "grade_weighted_headcount":
      return Number(driver.plannedHeadcount) || 0;
    case "seat_count":
      return Number(driver.seatCount) || 0;
    case "floor_area":
      return Number(driver.floorAreaSqft) || 0;
    case "device_count":
      return Number(driver.deviceCount) || 0;
    case "hiring_volume":
      return Number(driver.hiringVolume) || 0;
    default:
      return 1; // equal_split
  }
}

/** Largest remainder at whole-rupee granularity, so the visible column always adds up. */
function splitRupees(total: number, weights: number[]): number[] {
  const rupees = Math.round(total);
  const sum = weights.reduce((a, b) => a + b, 0);
  if (!sum || !rupees) return weights.map(() => 0);
  const raw = weights.map((w) => (rupees * w) / sum);
  const floors = raw.map((v) => Math.floor(v));
  const remainder = rupees - floors.reduce((a, b) => a + b, 0);
  const order = raw
    .map((v, i) => ({ i, frac: v - floors[i] }))
    .sort((a, b) => b.frac - a.frac);
  for (let k = 0; k < remainder; k++) floors[order[k % order.length].i] += 1;
  return floors;
}

const money = (n: number) =>
  n || n === 0 ? Math.round(n).toLocaleString("en-IN") : "—";
const qnum = (n: number | null | undefined) =>
  n || n === 0 ? Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 }) : "—";

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
}

export function BranchBudgetPlannerGrid({
  lines, masters, costCentres, drivers, canEdit, period,
  onUpdateLine, onAddLine, onRemoveLine, onDriverChange,
}: BranchBudgetPlannerGridProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [pickerHead, setPickerHead] = useState<string | null>(null);
  const [hint, setHint] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "planned" | "gaps">("all");
  /** Row index whose cost-centre scope popover is open. */
  const [scopeRow, setScopeRow] = useState<number | null>(null);

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
        const pctTotal = scope.reduce((a, cc) => a + (pctById.get(cc.id) ?? 0), 0);
        const parts = splitRupees(amount, scope.map((cc) => pctById.get(cc.id) ?? 0));
        const byCc = new Map(scope.map((cc, i) => [cc.id, parts[i]]));
        byLine.set(index, {
          amount,
          qty: Number(line.quantity) || null,
          cells: costCentres.map((cc) => ({ units: pctById.get(cc.id) ?? null, amount: byCc.get(cc.id) ?? 0 })),
          // Surfaced live, because the server refuses a manual split that is not exactly 100%.
          unallocated: Math.round((100 - pctTotal) * 100) / 100,
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
    <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
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
        <button type="button" className="h-7 rounded-md border border-slate-300 bg-white px-2 hover:bg-slate-100"
          onClick={() => setCollapsed((c) => (c.size ? new Set() : new Set(activeHeads.map((h) => h.id))))}>
          {collapsed.size ? "Expand all" : "Collapse all"}
        </button>
        <span className="ml-2 flex items-center gap-1.5"><span className="h-3 w-5 rounded border border-slate-300 bg-white" />Type here</span>
        <span className="flex items-center gap-1.5"><span className="h-3 w-5 rounded border border-slate-300 bg-slate-100" />Calculated</span>
        <span className="ml-auto font-medium text-blue-700">{hint}</span>
      </div>

      <div className="max-h-[68vh] overflow-auto">
        <table className="w-max table-fixed border-separate border-spacing-0 text-[14px]">
          <colgroup>
            <col style={{ width: 250 }} /><col style={{ width: 160 }} />
            <col style={{ width: 70 }} /><col style={{ width: 88 }} /><col style={{ width: 96 }} />
            <col style={{ width: 112 }} /><col style={{ width: 140 }} /><col style={{ width: 30 }} />
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
              <th className="sticky top-0 z-20 border-b border-r-2 border-slate-300 bg-slate-50 px-2 py-2 text-left" colSpan={6}>&nbsp;</th>
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
              <td className="border-b border-slate-200 bg-blue-50" colSpan={7 + costCentres.length * 2} />
            </tr>
            {DRIVER_ROWS.map((row) => (
              <tr key={row.key} className="hover:bg-blue-50/60">
                <td className="sticky left-0 z-10 border-b border-r border-slate-200 bg-blue-50/50 px-2 py-1 font-medium text-slate-700">{row.label}</td>
                <td className="border-b border-r-2 border-slate-300 bg-blue-50/50" colSpan={7} />
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
                            {line.planningLevel === "branch" && costCentres.length > 0 && (
                              <span className="relative">
                                <button type="button" aria-label={`Cost centres for ${line.subHead}`}
                                  title="Choose which cost centres this line applies to"
                                  className={`rounded border px-1 font-mono text-[10px] ${scopeCount(line) < costCentres.length ? "border-amber-300 bg-amber-50 text-amber-800" : "border-slate-300 text-slate-500 hover:bg-slate-100"}`}
                                  onClick={() => setScopeRow(scopeRow === index ? null : index)}>
                                  {scopeCount(line)}/{costCentres.length}
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
                                        const selected = line.includedCostCentreIds ?? [];
                                        const on = selected.length === 0 || selected.includes(cc.id);
                                        return (
                                          <label key={cc.id} className="flex items-center gap-1.5 py-0.5 text-[11px] text-slate-700">
                                            <input type="checkbox" checked={on} disabled={!canEdit}
                                              onChange={(e) => {
                                                // Empty means "all", so the first unticking has to
                                                // materialise the full set before removing one.
                                                const base = selected.length ? selected : costCentres.map((c) => c.id);
                                                const next = e.target.checked
                                                  ? [...new Set([...base, cc.id])]
                                                  : base.filter((id) => id !== cc.id);
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
                        <td className="border-b border-r border-slate-200 bg-white p-0">
                          <select disabled={!canEdit} aria-label="Sharing method"
                            className="w-full bg-transparent px-1.5 py-1 text-[13px] font-medium text-slate-800 outline-none focus:bg-white focus:ring-2 focus:ring-blue-600/30"
                            value={method} onChange={(e) => onUpdateLine(index, { allocationDriver: e.target.value })}>
                            {BRANCH_SHARING_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                          </select>
                        </td>
                        <td className={`border-b border-r border-slate-200 px-1 text-center font-mono font-bold ${calcCell} ${up ? "text-emerald-700" : "text-blue-700"}`}
                          title={up ? "Bottom-up: type the cost-centre cells, the branch total is their sum." : "Top-down: type the branch Amount, the cost-centre cells are derived."}>
                          {up ? "↑" : "↓"}
                        </td>
                        {/* Units and Amount alternate per cost centre. The Units cell carries the
                            share input: a percentage on a Manual row, and nothing on any other,
                            because no other method takes a per-cost-centre figure from the user. */}
                        {costCentres.flatMap((cc, ci) => [
                          <td key={`u-${index}-${cc.id}`} className={`border-b border-l border-slate-200 p-0 ${isManual ? "bg-white" : calcCell}`}
                            title={isManual ? "Share of this line, in percent. Must total 100." : `${method || "This method"} derives each cost centre's share from its driver, so there is nothing to type here.`}
                            onClick={isManual ? undefined : explain(`${method || "This method"} derives each share from its driver — switch the row to Manual % to type shares.`)}>
                            {isManual ? (
                              <input type="number" min="0" max="100" step="0.01" disabled={!canEdit} aria-label={`${cc.costCentreCode} share percent`}
                                className={`w-full bg-transparent px-2 py-1 ${num} outline-none focus:bg-white focus:ring-2 focus:ring-blue-600/30 ${unbalanced ? "bg-rose-50" : ""}`}
                                value={line.manualAllocations?.find((m) => m.costCentreId === cc.id)?.percentage ?? ""}
                                onChange={(e) => {
                                  const pct = Number(e.target.value);
                                  const rest = (line.manualAllocations ?? []).filter((m) => m.costCentreId !== cc.id);
                                  onUpdateLine(index, { manualAllocations: [...rest, { costCentreId: cc.id, percentage: pct }] });
                                }} />
                            ) : <div className={`px-2 py-1 ${num} text-slate-500`}>—</div>}
                          </td>,
                          <td key={`a-${index}-${cc.id}`} className={`border-b border-r border-slate-200 px-2 py-1 ${num} ${calcCell} ${unbalanced ? "bg-rose-50 text-rose-700" : ""}`}
                            title={isMetered
                              ? "Filled from this period's meter readings when the budget is saved — the browser has no copy of them."
                              : `Derived from the ${method || "sharing"} split. Switch the row to Manual % to set shares yourself.`}
                            onClick={explain(isMetered
                              ? "Metered rows are split by meter consumption, which is read on the server when you save."
                              : `Derived from the ${method || "sharing"} split — switch the row to Manual % to set shares yourself.`)}>
                            {isMetered ? <span className="text-slate-400">on save</span> : (p?.cells[ci]?.amount ? money(p.cells[ci].amount) : "—")}
                          </td>,
                        ])}
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
                        <td className="border-b border-r-2 border-slate-300 bg-rose-50 px-2 py-1 text-rose-700" colSpan={7 + costCentres.length * 2}>
                          <span className="font-semibold">{r.line.subHead}</span>: manual shares total{" "}
                          {(100 - (preview.get(r.index)?.unallocated ?? 0)).toFixed(2)}% — they must total exactly 100% before this budget can be saved.
                        </td>
                      </tr>
                  ))}
                </Fragment>
              );
            })}
          </tbody>

          <tfoot>
            <tr className="font-semibold">
              <td className="sticky bottom-0 left-0 z-40 border-r border-t-2 border-slate-300 bg-slate-100 px-2 py-2 text-slate-700">Cost-centre total</td>
              <td className="sticky bottom-0 z-30 border-r-2 border-t-2 border-slate-300 bg-slate-100 px-2 py-2 text-slate-400">{lines.length} lines</td>
              <td className="sticky bottom-0 z-30 border-r border-t-2 border-slate-300 bg-slate-100" colSpan={3} />
              <td className={`sticky bottom-0 z-30 border-r border-t-2 border-slate-300 bg-slate-100 px-2 py-2 ${num}`}>{money(branchTotal)}</td>
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
