/**
 * The statutory category must never read PASS on UAN grounds while the scope is unapproved.
 *
 * MISSING_UAN is scoped to employee_statutory_info.pf_eligible and reports 1. Measured against
 * PF actually deducted the figure is 655, because that flag is set on 53 of 1,239 July-eligible
 * employees and disagrees with payroll for 1,100 of the 1,111 it deducts from. A gate scoped to
 * a flag nobody maintains cannot go red, so "MISSING_UAN: 1" reads as reassurance when it is
 * really an artefact of the scope.
 *
 * Business ruling 2026-08-13: classify it LEGACY_SCOPE / UNVERIFIED, not PASS, until Payroll
 * approves the canonical PF applicability and filing population — and do not resolve it by
 * editing pf_eligible flags to make the numbers agree. These tests pin that ruling in code.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SOURCE = readFileSync(
  resolve(process.cwd(), "src/modules/payroll/payroll-governance.service.ts"),
  "utf8",
);
/** Assert on code, not on the prose that necessarily quotes the thing being guarded against. */
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("the unverified-scope marker is always emitted", () => {
  it("pushes MISSING_UAN_SCOPE_UNVERIFIED unconditionally, not from a countIssue", () => {
    // countIssue returns null at count 0, so a conditional marker would vanish exactly when the
    // scope artefact makes the count look clean — which is the case it exists for.
    expect(CODE).toContain('code: "MISSING_UAN_SCOPE_UNVERIFIED"');
    expect(CODE).toMatch(/issues\.push\(\{\s*code: "MISSING_UAN_SCOPE_UNVERIFIED"/);
  });

  it("files it under the statutory category, which is the one it must hold open", () => {
    const block = CODE.slice(
      CODE.indexOf('code: "MISSING_UAN_SCOPE_UNVERIFIED"'),
      CODE.indexOf('code: "MISSING_UAN_SCOPE_UNVERIFIED"') + 400,
    );
    expect(block).toContain('category: "statutory"');
  });

  it("carries both figures, so the small one is never read alone", () => {
    expect(CODE).toMatch(/655 employees have no UAN/);
    expect(CODE).toMatch(/1,100 of the 1,111/);
  });

  it("says explicitly not to fix it by editing the flags", () => {
    expect(CODE).toMatch(/Do not resolve this by editing pf_eligible flags/);
  });
});

describe("LEGACY_SCOPE_UNVERIFIED outranks PASS and WARNING", () => {
  it("is part of the category status union", () => {
    expect(CODE).toContain('"LEGACY_SCOPE_UNVERIFIED"');
  });

  it("is raised by any _SCOPE_UNVERIFIED issue code, not by a hardcoded UAN special case", () => {
    expect(CODE).toContain('issue.code.endsWith("_SCOPE_UNVERIFIED")');
  });

  it("ranks below CHECK_ERROR and BLOCKED but above WARNING and PASS", () => {
    // The ternary chain is the ranking. Order matters: if hasUnverifiedScope were tested after
    // `warnings > 0` the category would report WARNING, and after nothing at all it would
    // report PASS — which is the outcome this whole file exists to prevent.
    const chain = CODE.slice(CODE.indexOf("status: hasCheckError"), CODE.indexOf("blockers,\n        warnings,"));
    const iCheck = chain.indexOf("CHECK_ERROR");
    const iBlocked = chain.indexOf("BLOCKED");
    const iUnverified = chain.indexOf("LEGACY_SCOPE_UNVERIFIED");
    const iWarning = chain.indexOf('"WARNING"');
    const iPass = chain.indexOf('"PASS"');
    for (const [name, idx] of Object.entries({ iCheck, iBlocked, iUnverified, iWarning, iPass })) {
      expect(idx, `${name} not found in the status chain`).toBeGreaterThan(-1);
    }
    expect(iCheck).toBeLessThan(iBlocked);
    expect(iBlocked).toBeLessThan(iUnverified);
    expect(iUnverified).toBeLessThan(iWarning);
    expect(iWarning).toBeLessThan(iPass);
  });
});

describe("the defensible checks stay visible alongside it", () => {
  const CATEGORIES = readFileSync(
    resolve(process.cwd(), "src/modules/payroll/payroll-readiness-categories.service.ts"),
    "utf8",
  );

  it("keeps STATUTORY_UAN_MISSING_FOR_PF_DEDUCTED", () => {
    expect(CATEGORIES).toContain("STATUTORY_UAN_MISSING_FOR_PF_DEDUCTED");
  });

  it("keeps STATUTORY_PF_ELIGIBLE_FLAG_UNRELIABLE", () => {
    expect(CATEGORIES).toContain("STATUTORY_PF_ELIGIBLE_FLAG_UNRELIABLE");
  });

  it("scopes the real check to PF actually deducted, not to the flag", () => {
    const block = CATEGORIES.slice(
      CATEGORIES.indexOf("STATUTORY_UAN_MISSING_FOR_PF_DEDUCTED"),
      CATEGORIES.indexOf("STATUTORY_PF_ELIGIBLE_FLAG_UNRELIABLE"),
    );
    expect(block).toContain("spl.pf_employee > 0");
    // It must not narrow itself with the flag, which would reintroduce the artefact.
    expect(block).not.toMatch(/si\.pf_eligible = 1/);
  });
});
