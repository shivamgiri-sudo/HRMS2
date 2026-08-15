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
    // isFinanceLead since 2026-08-15, not canOverridePeriod: the server gates a cross-FY
    // window on RECOGNITION_OVERRIDE_ROLES, which excludes branch_admin, while
    // canOverridePeriod now includes it. See the split explained further down this file.
    expect(FORM).toMatch(/const crossFyBlocked =\s*\n?\s*!isFinanceLead/);
  });

  it("folds it into canSubmit", () => {
    expect(FORM).toMatch(/canSubmit =[\s\S]{0,160}!crossFyBlocked/);
  });

  it("passes the capability down to the panel", () => {
    expect(FORM).toMatch(/canCrossFy=\{canOverridePeriod\}/);
  });

  it("uses the same three roles the server enforces", () => {
    // isFinanceLead is the flag that must mirror RECOGNITION_OVERRIDE_ROLES
    // (grn-smart.service.ts) — finance_head / accounts_head / super_admin, exactly.
    expect(FORM).toMatch(
      /const isFinanceLead = useHasRole\("finance_head",\s*"accounts_head",\s*"super_admin"\)/,
    );
  });

  /**
   * These two flags were ONE flag until 2026-08-15, and conflating them shipped a form that
   * promised permissions the API refuses.
   *
   * 139ee3b7 added branch_admin to the single canOverridePeriod flag so a branch admin could
   * set the accounting period. But that flag was also gating three OTHER server checks, none
   * of which the server widened:
   *   round-off tolerance 500/1  -> isElevatedRole            (branch_admin: no)
   *   late-invoice reason needed -> isRestrictedRole          (branch_admin: explicitly YES,
   *                                                            it is a restricted role there)
   *   cross-FY recognition       -> RECOGNITION_OVERRIDE_ROLES (branch_admin: no)
   *
   * So a branch_admin saw a Rs 500 round-off allowance, no late-invoice justification, and an
   * unblocked cross-FY window — then had the submission rejected. The split keeps the one
   * permission that commit intended and takes back the three it granted by accident.
   */
  it("does not let the period-override role list leak into the finance-lead checks", () => {
    expect(FORM).toMatch(
      /const canOverridePeriod = useHasRole\("finance_head",\s*"accounts_head",\s*"super_admin",\s*"branch_admin"\)/,
    );
    // The round-off limit mirrors isElevatedRole, which excludes branch_admin.
    expect(FORM).toMatch(/roundoffLimit = isFinanceLead \? 500 : 1/);
    // The cross-FY block mirrors RECOGNITION_OVERRIDE_ROLES, which excludes branch_admin.
    expect(FORM).toMatch(/crossFyBlocked\s*=\s*\n?\s*!isFinanceLead/);
    // The late-invoice reason requirement mirrors isRestrictedRole, which NAMES branch_admin.
    expect(FORM).toMatch(/isVendor && !isFinanceLead && form\.billDate/);
  });

  it("keeps the accounting-period override on the wider list, matching the server", () => {
    // grn-smart.routes.ts's canOverridePeriod now includes branch_admin, so this is the one
    // place the wider flag is correct.
    expect(FORM).toMatch(/accountingPeriod: canOverridePeriod && form\.accountingPeriod/);
  });
});
