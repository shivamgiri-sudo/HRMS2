import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import { financialYearFromPeriodCode } from "../grn-number-on-submit.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, "../../../..");
const read = (p: string) => fs.readFileSync(path.join(backendRoot, p), "utf8");

/**
 * A GRN's number is assigned at SUBMISSION — draft → submitted — and nowhere else. Abandoned
 * drafts must not burn a sequence slot, and the number must exist before the first approver sees
 * it so every query and payment reference has something to quote.
 *
 * The bug this pins: there are TWO submit paths, and only the dead one allocated.
 * grn.routes.ts mounts smartGrnRouter on "/grns" hundreds of lines above its own
 * POST /grns/:id/submit, so Express matches the smart router first and
 * grnService.submitForApproval() — the only code that wrote grn_number — was never reached.
 * Every GRN raised through the current form reached Branch Head AND Finance Head approval
 * carrying grn_number = NULL. Six were found live on 2026-08-27, one of them Rs 28,024.98.
 */
describe("the GRN number is allocated on submit, by whichever path runs", () => {
  it("the submit that actually runs allocates it", () => {
    const service = read("src/modules/finance/grn-validation-control.service.ts");
    expect(service).toContain("const grnNumber = await resolveGrnNumberOnSubmit(typeRows[0]);");
    // Written with COALESCE so a concurrent submit cannot overwrite an existing number.
    expect(service).toContain("grn_number = COALESCE(grn_number, ?),");
    // The row it reads must actually carry what the allocator needs.
    expect(service).toContain("SELECT grn_type, grn_number, branch_id, accounting_period, financial_year");
    // And the number reaches the caller and the audit trail.
    expect(service).toContain("grn_number: grnNumber,");
    expect(service).toContain("newStatus: \"submitted\", grnNumber, validation");
  });

  it("the legacy path shares the same helper rather than its own copy", () => {
    const service = read("src/modules/finance/grn.service.ts");
    expect(service).toContain("const grnNumber = await resolveGrnNumberOnSubmit(grn);");
    // The inline copy is gone — two implementations could drift on format or on when they fire.
    expect(service).not.toContain("const numberFormat = await resolveGrnNumberFormat();");
    expect(service).not.toContain("await allocateGrnNumber(String(grn.branch_id)");
  });

  it("both submit paths, and only those, allocate a number", () => {
    const helper = read("src/modules/finance/grn-number-on-submit.ts");
    // An existing number is never reissued: re-submit after a return, and migrated db_bill rows.
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

  it("no approval stage assigns a number — submission is the only moment", () => {
    const smart = read("src/modules/finance/grn-smart.service.ts");
    const control = read("src/modules/finance/grn-validation-control.service.ts");
    // review() moves the status on; it must never mint a number, or a rejected-then-resubmitted
    // GRN would end up with two.
    const reviewBody = smart.slice(smart.indexOf("async review("), smart.indexOf("async review(") + 8000);
    expect(reviewBody).not.toContain("resolveGrnNumberOnSubmit");
    expect(control.slice(control.indexOf("async review("))).not.toContain("resolveGrnNumberOnSubmit");
  });
});
