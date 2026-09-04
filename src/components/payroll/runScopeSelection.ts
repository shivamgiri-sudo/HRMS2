/**
 * Selection maths for the payroll run scope picker.
 *
 * Kept apart from rendering so it can be tested directly. The same reasoning as readinessViewScope:
 * a rule buried inside a component is a rule nothing asserts, and this one decides which cost
 * centres a payroll run will pay.
 */

export type PickerCostCentre = {
  costCentreId: string;
  costCentreCode: string;
  staff: number;
  /** From the coverage endpoint: anything other than "not_started" is already claimed this month. */
  status: "paid" | "in_run" | "not_started";
};

export type PickerBranch = {
  branchId: string;
  branchName: string;
  costCentres: PickerCostCentre[];
};

export type BranchState = "none" | "some" | "all";

/**
 * A cost centre already covered by a live run this month cannot be selected.
 *
 * The API refuses it either way — assertCostCentresFree, and the UNIQUE key behind it — so this is
 * about telling the user before they submit, not about enforcement. Enforcement is server-side.
 */
export function isSelectable(cc: PickerCostCentre): boolean {
  return cc.status === "not_started";
}

/** The cost centres of a branch a user is actually allowed to pick. */
export function selectableIds(branch: PickerBranch): string[] {
  return branch.costCentres.filter(isSelectable).map((c) => c.costCentreId);
}

/**
 * Whether a branch is fully, partly or not selected — drives the indeterminate checkbox.
 *
 * Judged against the SELECTABLE cost centres only. Counting ones already in another run would leave
 * a branch permanently stuck at "some", so the parent checkbox could never show complete even when
 * the user had picked everything available to them.
 */
export function branchState(selected: readonly string[], branch: PickerBranch): BranchState {
  const ids = selectableIds(branch);
  if (!ids.length) return "none";
  const chosen = ids.filter((id) => selected.includes(id)).length;
  if (chosen === 0) return "none";
  return chosen === ids.length ? "all" : "some";
}

/**
 * Clicking a branch selects all of its selectable cost centres, or clears them when all were
 * already selected.
 *
 * A partial selection COMPLETES rather than clears. Clearing would silently discard picks the user
 * had just made by hand, which is the more annoying of the two guesses and the harder to notice.
 */
export function toggleBranch(selected: readonly string[], branch: PickerBranch): string[] {
  const ids = selectableIds(branch);
  if (branchState(selected, branch) === "all") {
    return selected.filter((id) => !ids.includes(id));
  }
  return [...new Set([...selected, ...ids])];
}

/** Add or remove one cost centre. Ignores a cost centre that is not selectable. */
export function toggleCostCentre(selected: readonly string[], cc: PickerCostCentre): string[] {
  if (!isSelectable(cc)) return [...selected];
  return selected.includes(cc.costCentreId)
    ? selected.filter((id) => id !== cc.costCentreId)
    : [...selected, cc.costCentreId];
}

/**
 * What the user is about to run, for the confirmation line.
 *
 * Headcount is the number that matters — "12 cost centres" says nothing about whether this run pays
 * 15 people or 900 — so it leads, and the branch count comes from the selection rather than from
 * however many branches happen to be on screen.
 */
export function selectionSummary(
  selected: readonly string[],
  branches: readonly PickerBranch[],
): { branches: number; costCentres: number; employees: number } {
  let costCentres = 0;
  let employees = 0;
  const branchIds = new Set<string>();

  for (const branch of branches) {
    for (const cc of branch.costCentres) {
      if (!selected.includes(cc.costCentreId)) continue;
      costCentres += 1;
      employees += cc.staff;
      branchIds.add(branch.branchId);
    }
  }

  return { branches: branchIds.size, costCentres, employees };
}
