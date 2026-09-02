import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import { financialYearFromPeriodCode } from "../grn-number-on-submit.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, "../../../..");
const read = (p: string) => fs.readFileSync(path.join(backendRoot, p), "utf8");

/**
 * A GRN's number is assigned at FINAL APPROVAL — Finance Head clearing a `branch_head_approved`
 * GRN — and nowhere else. This supersedes the 2026-08-27 "assign at submission" design (see git
 * history / grn-number-on-submit.ts's own header for that story): assigning at submission meant
 * a REJECTED GRN kept a real number forever, indistinguishable in a naive scan from one that was
 * actually spent. Owner ruling: the number identifies approved spend, not merely raised spend.
 *
 * The routing story that made "both paths" matter for submit() applies identically here: there
 * are two live finance_head-approval implementations (grn-smart.service.ts's review() for GRNs
 * with saved cost allocations, grn.service.ts's reviewGrn() as the fallback for GRNs with none —
 * see grn-smart.routes.ts's onlyWhenSmart middleware), and both must allocate identically or a
 * GRN's number depends on which internal path happened to review it.
 */
describe("the GRN number is allocated at final (Finance Head) approval, by whichever path runs", () => {
  it("submission no longer allocates one, on either live submit path", () => {
    const control = read("src/modules/finance/grn-validation-control.service.ts");
    const legacy = read("src/modules/finance/grn.service.ts");
    const controlSubmit = control.slice(control.indexOf("async submit("), control.indexOf("async review("));
    const legacySubmit = legacy.slice(
      legacy.indexOf("async submitForApproval("),
      legacy.indexOf("async submitForApproval(") + 2500,
    );
    expect(controlSubmit).not.toContain("resolveGrnNumberOnSubmit(");
    expect(controlSubmit).not.toContain("grn_number = COALESCE(grn_number");
    expect(legacySubmit).not.toContain("resolveGrnNumberOnSubmit(");
    expect(legacySubmit).not.toContain("grn_number = COALESCE(grn_number");
  });

  it("both live finance_head-approval branches allocate one, in the same atomic UPDATE that flips status", () => {
    // Anchored on the branch HEADER text (with its "} else if"/"if" prefix and trailing "{"),
    // not the bare role check — both files also test the actor's role in a maker-checker guard
    // earlier in the same function, using the identical "role === \"finance_head\"" substring
    // without the "} else if" prefix, which would otherwise be matched first.
    const smart = read("src/modules/finance/grn-smart.service.ts");
    const legacy = read("src/modules/finance/grn.service.ts");

    const smartAnchor = '} else if (role === "finance_head") {';
    const smartFhBranch = smart.slice(smart.indexOf(smartAnchor), smart.indexOf(smartAnchor) + 3000);
    expect(smartFhBranch).toContain("grnNumber = await resolveGrnNumberOnSubmit(grn)");
    expect(smartFhBranch).toContain("grn_number = COALESCE(grn_number, ?)");

    const legacyAnchor = '} else if (effectiveStage === "finance_head") {';
    const legacyFhBranch = legacy.slice(legacy.indexOf(legacyAnchor), legacy.indexOf(legacyAnchor) + 3000);
    expect(legacyFhBranch).toContain("grnNumber = await resolveGrnNumberOnSubmit(grn)");
    expect(legacyFhBranch).toContain("grn_number = COALESCE(grn_number, ?)");
  });

  it("a rejection never allocates one, on either path — the deliberate, approved consequence", () => {
    // Reject branches sit textually right after their approve sibling in both files; a bare
    // occurrence count check would pass even if a stray call crept into the reject arm, so this
    // slices each file's own reject-branch text and asserts the allocator is absent from it.
    const smart = read("src/modules/finance/grn-smart.service.ts");
    const legacy = read("src/modules/finance/grn.service.ts");

    const smartAnchor = '} else if (role === "finance_head") {';
    const smartFhRejectBranch = smart.slice(
      smart.indexOf("} else {", smart.indexOf(smartAnchor)),
      smart.indexOf("} else {", smart.indexOf(smartAnchor)) + 900,
    );
    expect(smartFhRejectBranch).toContain("status = 'rejected'");
    expect(smartFhRejectBranch).not.toContain("resolveGrnNumberOnSubmit");

    const legacyAnchor = '} else if (effectiveStage === "finance_head") {';
    const legacyFhRejectBranch = legacy.slice(
      legacy.indexOf("} else {", legacy.indexOf(legacyAnchor)),
      legacy.indexOf("} else {", legacy.indexOf(legacyAnchor)) + 900,
    );
    expect(legacyFhRejectBranch).toContain("status = 'rejected'");
    expect(legacyFhRejectBranch).not.toContain("resolveGrnNumberOnSubmit");
  });

  it("branch_head approval — the FIRST stage — never allocates one either", () => {
    const smart = read("src/modules/finance/grn-smart.service.ts");
    const legacy = read("src/modules/finance/grn.service.ts");
    const smartBhBranch = smart.slice(
      smart.indexOf('if (role === "branch_head") {'),
      smart.indexOf('} else if (role === "finance_head") {'),
    );
    const legacyBhBranch = legacy.slice(
      legacy.indexOf('if (effectiveStage === "branch_head") {'),
      legacy.indexOf('} else if (effectiveStage === "finance_head") {'),
    );
    expect(smartBhBranch).not.toContain("resolveGrnNumberOnSubmit");
    expect(legacyBhBranch).not.toContain("resolveGrnNumberOnSubmit");
  });

  it("the allocator itself is unchanged — same format-flag routing, same idempotency guard", () => {
    const helper = read("src/modules/finance/grn-number-on-submit.ts");
    // An existing number is never reissued: re-approval races, re-submit after a return, and
    // migrated db_bill rows.
    expect(helper).toContain("if (existing) return existing;");
    // The format stays a config flag, not a deploy.
    expect(helper).toContain("await resolveGrnNumberFormat()");
    expect(helper).toContain("allocateMonthlyGrnNumber");
    expect(helper).toContain("allocateGrnNumber");
  });

  it("derives the Indian financial year from the accounting period", () => {
    expect(financialYearFromPeriodCode("2026-08")).toBe("2026-27"); // Aug — after April
    expect(financialYearFromPeriodCode("2026-04")).toBe("2026-27"); // the year starts in April
    expect(financialYearFromPeriodCode("2026-03")).toBe("2025-26"); // March — previous year
    expect(financialYearFromPeriodCode("2027-01")).toBe("2026-27");
    expect(() => financialYearFromPeriodCode("")).toThrow(/invalid accounting period/i);
    expect(() => financialYearFromPeriodCode("garbage")).toThrow(/invalid accounting period/i);
  });
});
