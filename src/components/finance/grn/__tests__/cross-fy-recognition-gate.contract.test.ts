import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { windowCrossesFinancialYear } from "../sections/MonthSplitPanel";

/**
 * The UI half of the cross-FY recognition gate.
 *
 * The server refuses a recognition window that crosses a financial year for anyone
 * but Finance Head / Accounts Head / Super Admin. Before this, MonthSplitPanel showed
 * the same amber "confirm this is intentional" warning to everyone, so a branch_admin
 * could choose the window, fill in the rest of a long form, attach proof, and only
 * then be refused on save.
 *
 * The server stays the authority — this is about telling the truth earlier, not about
 * moving the check. Both sides read the same rule: windowCrossesFinancialYear is
 * exported from the panel and used by the form, so the displayed rule and the blocked
 * rule cannot drift apart.
 */
const PANEL = readFileSync(new URL("../sections/MonthSplitPanel.tsx", import.meta.url), "utf8");
const FORM = readFileSync(new URL("../BudgetLinkedGrnForm.tsx", import.meta.url), "utf8");

describe("windowCrossesFinancialYear", () => {
  it("is false for a window inside the GRN's own financial year", () => {
    expect(windowCrossesFinancialYear("2026-04", "2026-04", "2027-03")).toBe(false);
  });

  it("is true once the window runs past March", () => {
    expect(windowCrossesFinancialYear("2026-07", "2026-07", "2027-06")).toBe(true);
  });

  it("is true for a window lying entirely in the next financial year", () => {
    expect(windowCrossesFinancialYear("2026-08", "2027-04", "2027-06")).toBe(true);
  });

  it("is false for a single month in the same year", () => {
    expect(windowCrossesFinancialYear("2026-09", "2026-09", "2026-09")).toBe(false);
  });

  it("is false when either end is missing, so an unset window blocks nothing", () => {
    expect(windowCrossesFinancialYear("2026-04", null, "2027-06")).toBe(false);
    expect(windowCrossesFinancialYear("2026-04", "2026-04", undefined)).toBe(false);
    expect(windowCrossesFinancialYear("2026-04", "", "")).toBe(false);
  });

  it("is false when the accounting period is not yet known", () => {
    // The bill date drives the FY; before it is set there is nothing to cross.
    expect(windowCrossesFinancialYear("", "2026-07", "2027-06")).toBe(false);
  });
});

describe("MonthSplitPanel tells the user which side of the gate they are on", () => {
  it("takes canCrossFy separately from canCustomSplit", () => {
    // Two distinct overrides on the server, so two distinct props here even though
    // the same three roles satisfy both today.
    expect(PANEL).toMatch(/canCrossFy\?: boolean/);
    expect(PANEL).toMatch(/canCustomSplit\?: boolean/);
  });

  it("keeps the advisory warning for someone who may commit the window", () => {
    expect(PANEL).toMatch(/schedule\.crossFy && canCrossFy/);
    expect(PANEL).toMatch(/Confirm this is\s*\n?\s*intentional/);
  });

  it("shows a blocking message to someone who may not", () => {
    expect(PANEL).toMatch(/schedule\.crossFy && !canCrossFy/);
    expect(PANEL).toMatch(/tone="crit"/);
    expect(PANEL).toMatch(/Finance\s*\n?\s*Head, Accounts Head or Super Admin/);
  });
});

describe("BudgetLinkedGrnForm refuses to submit what the server will reject", () => {
  it("computes the block from the same exported rule, not a second copy", () => {
    expect(FORM).toContain("windowCrossesFinancialYear");
    expect(FORM).toMatch(/const crossFyBlocked =\s*\n?\s*!canOverridePeriod/);
  });

  it("folds it into canSubmit", () => {
    expect(FORM).toMatch(/canSubmit =[\s\S]{0,160}!crossFyBlocked/);
  });

  it("passes the capability down to the panel", () => {
    expect(FORM).toMatch(/canCrossFy=\{canOverridePeriod\}/);
  });

  it("uses the same three roles the server enforces", () => {
    expect(FORM).toMatch(
      /useHasRole\("finance_head",\s*"accounts_head",\s*"super_admin"\)/,
    );
  });
});
