/**
 * Pure helpers for re-opening a saved GRN draft in BudgetLinkedGrnForm.
 *
 * Kept out of the component so the prefill rules can be unit-tested without a DOM: the edit
 * screen used to come back with the vendor, due date and cost-centre split blank even though
 * the workspace returned all three.
 */

export type SavedSplitRow = {
  costCentreKey: string;
  budgetLineId: string;
  percentage: number;
  included: boolean;
};

export type SplitRowDraft = SavedSplitRow & { key: string };

type GroupLine = { id: string };
export type SplitGroupLike = {
  costCentreKey: string;
  lines: GroupLine[];
  fundableLines?: GroupLine[];
};

/** A DB date (or a Date / ISO timestamp) as the YYYY-MM-DD an <input type="date"> takes, without
 *  shifting the day: a plain "YYYY-MM-DD…" string is cut, anything else is read in local time. */
export function toDateInputValue(value: unknown): string {
  if (value == null || value === "") return "";
  if (typeof value === "string") {
    const plain = value.match(/^(\d{4}-\d{2}-\d{2})(?:$|[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$)/);
    if (plain) return plain[1];
  }
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Per-cost-centre split rows rebuilt from a saved GRN's allocation rows (N splits x M invoice
 *  components, possibly several funding lines per cost centre), summed back to one row each. */
export function buildSavedCostCentreSplits(allocations: Array<Record<string, any>>): SavedSplitRow[] {
  const byCostCentre = new Map<string, { budgetLineId: string; pct: number }>();
  for (const alloc of allocations ?? []) {
    const ccKey = String(alloc.cost_centre_id ?? alloc.funding_cost_centre_id ?? "") || "__none__";
    const existing = byCostCentre.get(ccKey) ?? {
      // An unbudgeted row has budget_line_id NULL — String(null) would send "null" as a line id.
      budgetLineId: alloc.budget_line_id ? String(alloc.budget_line_id) : "",
      pct: 0,
    };
    if (!existing.budgetLineId && alloc.budget_line_id) existing.budgetLineId = String(alloc.budget_line_id);
    existing.pct = Math.round((existing.pct + Number(alloc.allocation_percentage || 0)) * 1_000_000) / 1_000_000;
    byCostCentre.set(ccKey, existing);
  }
  return [...byCostCentre.entries()].map(([costCentreKey, data]) => ({
    costCentreKey,
    budgetLineId: data.budgetLineId,
    percentage: Math.round(data.pct * 1000) / 1000,
    included: true,
  }));
}

/**
 * Re-seeds the split rows from the cost-centre groups. A row already on screen keeps its
 * values; a cost centre with no row on screen falls back to the saved draft's row (so a draft's
 * split survives the moment the groups are empty while cost centres / budget lines load).
 * A budget line is kept only while it is still one this cost centre can be funded from.
 */
export function mergeCostCentreSplits(
  current: SplitRowDraft[],
  groups: SplitGroupLike[],
  saved: SavedSplitRow[] | null,
  newKey: () => string,
): SplitRowDraft[] {
  return groups.map((group) => {
    const existing = current.find((row) => row.costCentreKey === group.costCentreKey);
    const savedRow = saved?.find((row) => row.costCentreKey === group.costCentreKey);
    const fundable = group.fundableLines ?? group.lines;
    const valid = (id: string | undefined) => Boolean(id) && fundable.some((line) => line.id === id);
    const budgetLineId = valid(existing?.budgetLineId)
      ? existing!.budgetLineId
      : valid(savedRow?.budgetLineId)
        ? savedRow!.budgetLineId
        : group.lines[0]?.id ?? "";
    return {
      key: existing?.key ?? newKey(),
      costCentreKey: group.costCentreKey,
      budgetLineId,
      // No cost centre is pre-selected on a new GRN: the raiser must tick each one themselves.
      percentage: existing?.percentage ?? savedRow?.percentage ?? 0,
      included: existing?.included ?? savedRow?.included ?? false,
    };
  });
}

export type VendorLike = { id: string; vendor_name?: string | null; name?: string | null };
export type VendorOption = { value: string; label: string; hint?: string };

/** Vendor picker options: same-name rows collapse to one (the selected vendor wins its name),
 *  and the selected vendor is always present — a saved draft's vendor may sit outside the
 *  50-row search page, and the picker can only label a value that is among its options. */
export function buildVendorOptions(
  vendors: VendorLike[],
  selectedId: string,
  selectedFallbackName?: string | null,
): VendorOption[] {
  const nameOf = (vendor: VendorLike) => String(vendor.vendor_name ?? vendor.name ?? "").trim();
  const byName = new Map<string, VendorLike>();
  for (const vendor of vendors) {
    const key = nameOf(vendor).toUpperCase();
    const kept = byName.get(key);
    // Last row per name wins, as before — except that the selected vendor is never displaced.
    if (!kept || kept.id !== selectedId) byName.set(key, vendor);
  }
  const options = [...byName.values()].map((vendor) => ({ value: vendor.id, label: nameOf(vendor), hint: undefined }));
  if (selectedId && !options.some((option) => option.value === selectedId)) {
    const label = String(selectedFallbackName ?? "").trim();
    if (label) options.unshift({ value: selectedId, label, hint: undefined });
  }
  return options;
}
