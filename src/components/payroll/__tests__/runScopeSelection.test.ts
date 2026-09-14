/**
 * Selection maths for the payroll run scope picker.
 *
 * This decides which cost centres a payroll run will pay, so the cases below are the ones where a
 * plausible-looking implementation quietly does the wrong thing: clearing a user's hand-picked
 * selection when they click the parent, letting a cost centre already in another run be selected
 * anyway, or reporting a headcount that does not match what will actually be paid.
 *
 * Fixtures are the real HEAD OFFICE shape — 4 cost centres, 15 staff — because that is the branch
 * this feature is being verified against.
 */

import { describe, expect, it } from "vitest";
import {
  branchState,
  isSelectable,
  selectableIds,
  selectionSummary,
  toggleBranch,
  toggleCostCentre,
  type PickerBranch,
} from "../runScopeSelection";

const headOffice: PickerBranch = {
  branchId: "br-ho",
  branchName: "HEAD OFFICE",
  costCentres: [
    { costCentreId: "cc-mgmt", costCentreCode: "MANAGEMENT-CORPORATE", staff: 7, status: "not_started" },
    { costCentreId: "cc-fin", costCentreCode: "FINANCE/ACCOUNTS", staff: 4, status: "not_started" },
    { costCentreId: "cc-bss", costCentreCode: "BSS/BLD/CORP/796", staff: 3, status: "not_started" },
    { costCentreId: "cc-it", costCentreCode: "IT/SYSTEM", staff: 1, status: "not_started" },
  ],
};

/** Same branch with one cost centre already covered by another run this month. */
const partlyClaimed: PickerBranch = {
  ...headOffice,
  costCentres: headOffice.costCentres.map((c) =>
    c.costCentreId === "cc-it" ? { ...c, status: "paid" as const } : c,
  ),
};

const emptyBranch: PickerBranch = { branchId: "br-delhi", branchName: "Delhi Office", costCentres: [] };

describe("what can be picked", () => {
  it("offers a cost centre no run has claimed", () => {
    expect(isSelectable(headOffice.costCentres[0])).toBe(true);
  });

  it("refuses one already in a run this month", () => {
    // The API refuses it too — this is about saying so before the user submits.
    expect(isSelectable({ ...headOffice.costCentres[0], status: "paid" })).toBe(false);
    expect(isSelectable({ ...headOffice.costCentres[0], status: "in_run" })).toBe(false);
  });

  it("lists only the selectable ones for a branch", () => {
    expect(selectableIds(partlyClaimed)).toEqual(["cc-mgmt", "cc-fin", "cc-bss"]);
  });
});

describe("selecting a whole branch", () => {
  it("adds every selectable cost centre", () => {
    expect(toggleBranch([], headOffice).sort()).toEqual(["cc-bss", "cc-fin", "cc-it", "cc-mgmt"]);
  });

  it("never adds one already in another run", () => {
    expect(toggleBranch([], partlyClaimed)).not.toContain("cc-it");
  });

  it("clears the branch when all of it is selected", () => {
    expect(toggleBranch(["cc-mgmt", "cc-fin", "cc-bss", "cc-it"], headOffice)).toEqual([]);
  });

  it("completes a partial selection rather than clearing it", () => {
    /*
     * The behaviour worth pinning. Clearing here would silently discard picks the user had just
     * made by hand — the more annoying guess, and the harder one to notice.
     */
    expect(toggleBranch(["cc-it"], headOffice).sort()).toEqual(["cc-bss", "cc-fin", "cc-it", "cc-mgmt"]);
  });

  it("leaves other branches' selections untouched", () => {
    expect(toggleBranch(["cc-elsewhere"], headOffice)).toContain("cc-elsewhere");
  });

  it("does nothing for a branch with no cost centres", () => {
    // Delhi Office and NOIDA-DIALDESK are active but hold no staff.
    expect(toggleBranch(["cc-mgmt"], emptyBranch)).toEqual(["cc-mgmt"]);
  });
});

describe("branch checkbox state", () => {
  it("is none, some or all", () => {
    expect(branchState([], headOffice)).toBe("none");
    expect(branchState(["cc-it"], headOffice)).toBe("some");
    expect(branchState(["cc-mgmt", "cc-fin", "cc-bss", "cc-it"], headOffice)).toBe("all");
  });

  it("reaches 'all' once every SELECTABLE cost centre is chosen", () => {
    /*
     * Judged against selectable cost centres only. Counting the claimed one would leave this branch
     * permanently at "some", so the parent checkbox could never show complete however much the user
     * picked.
     */
    expect(branchState(["cc-mgmt", "cc-fin", "cc-bss"], partlyClaimed)).toBe("all");
  });

  it("is 'none' for a branch with nothing to pick", () => {
    expect(branchState([], emptyBranch)).toBe("none");
  });
});

describe("toggling one cost centre", () => {
  it("adds then removes", () => {
    const once = toggleCostCentre([], headOffice.costCentres[3]);
    expect(once).toEqual(["cc-it"]);
    expect(toggleCostCentre(once, headOffice.costCentres[3])).toEqual([]);
  });

  it("ignores one that is already in a run", () => {
    expect(toggleCostCentre([], { ...headOffice.costCentres[0], status: "in_run" })).toEqual([]);
  });
});

describe("the confirmation summary", () => {
  it("counts branches, cost centres and employees for the real HEAD OFFICE selection", () => {
    // 7 + 4 + 3 + 1 = 15, the figure the run must produce exactly.
    expect(selectionSummary(["cc-mgmt", "cc-fin", "cc-bss", "cc-it"], [headOffice])).toEqual({
      branches: 1,
      costCentres: 4,
      employees: 15,
    });
  });

  it("counts a branch once however many of its cost centres are picked", () => {
    expect(selectionSummary(["cc-mgmt", "cc-fin"], [headOffice]).branches).toBe(1);
  });

  it("spans branches", () => {
    const other: PickerBranch = {
      branchId: "br-noida",
      branchName: "NOIDA",
      costCentres: [{ costCentreId: "cc-n1", costCentreCode: "N1", staff: 100, status: "not_started" }],
    };
    expect(selectionSummary(["cc-it", "cc-n1"], [headOffice, other])).toEqual({
      branches: 2,
      costCentres: 2,
      employees: 101,
    });
  });

  it("is zero for an empty selection", () => {
    // The run button must be disabled here: an empty scope would fall through to the whole company.
    expect(selectionSummary([], [headOffice])).toEqual({ branches: 0, costCentres: 0, employees: 0 });
  });

  it("ignores a selected id that no longer appears in the branch list", () => {
    // A cost centre deactivated between load and submit must not inflate the headcount.
    expect(selectionSummary(["cc-gone"], [headOffice]).employees).toBe(0);
  });
});
