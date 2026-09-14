import { readFileSync, readdirSync } from "fs";
import { describe, expect, it } from "vitest";

/**
 * Built, tested, and called by nothing.
 *
 * This is the dominant defect class in this codebase and it survives a green test suite by
 * design: unit tests prove a service WORKS, never that anything INVOKES it. Four separate
 * features shipped this way before this sweep existed —
 *
 *   - the imprest voucher DEBIT was never posted, so a float could only ever go up and the
 *     Details report would have shown inflows and no outflows;
 *   - `assertSufficientBalance` guarded nothing, so a float could go negative in silence;
 *   - `vendorFilterClause` restricted nothing, so a vendor limited to one company or branch
 *     still appeared for everyone — a restriction feature that does not restrict;
 *   - `allocateMonthlyGrnNumber` (Requirement 12) had ZERO callers, and neither did the config
 *     flag meant to switch to it, so flipping `grn_number_format` did nothing whatsoever.
 *
 * Every one of those had passing tests. What follows asserts the CALL SITE exists, which is the
 * only thing that would have caught them.
 *
 * Adding a service to this list is cheap; forgetting to wire one is not.
 */

const at = (rel: string) =>
  new URL(rel, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

/** Every non-test .ts under src/modules and src/shared, concatenated. */
function productionSource(): string {
  const roots = [at("../../../modules"), at("../../../shared")];
  const chunks: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        if (entry.name === "__tests__") continue;
        walk(full);
      } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
        chunks.push(readFileSync(full, "utf8"));
      }
    }
  };
  for (const root of roots) walk(root);
  return chunks.join("\n");
}

const SOURCE = productionSource();

/**
 * A call site is a mention that is not the declaration itself. Counting occurrences of the bare
 * name across production code and requiring more than one is enough: the declaration is one, so
 * two or more means something references it.
 */
function callSites(name: string): number {
  const matches = SOURCE.match(new RegExp(`\\b${name}\\b`, "g")) ?? [];
  return matches.length;
}

describe("finance services are actually invoked", () => {
  it.each([
    // [symbol, what silently does not happen when nothing calls it]
    ["allocateMonthlyGrnNumber", "Requirement 12's MAS/MM/YY/SERIAL numbering never runs"],
    ["resolveGrnNumberFormat", "the grn_number_format flag does nothing when flipped"],
    ["vendorFilterClause", "vendor company/branch restrictions never restrict"],
    ["assertSufficientBalance", "an imprest float can go negative unchecked"],
    ["postImprestVoucherDebit", "an approved imprest voucher never debits the float"],
    ["recordFinanceApprovalEvent", "approval history is never written"],
    ["writePeriodSplits", "multi-month recognition never produces a schedule"],
    ["getDetailsReport", "the Imprest Details report has no endpoint"],
    ["listFinanceApprovalEvents", "approval history is written and can never be read back"],
  ])("%s has a call site — otherwise %s", (symbol) => {
    expect(
      callSites(symbol),
      `${symbol} appears only where it is declared: nothing calls it`,
    ).toBeGreaterThan(1);
  });
});

describe("the GRN numbering flag is genuinely switchable", () => {
  const GRN_SERVICE = readFileSync(at("../grn.service.ts"), "utf8");
  // 2026-08-27: the numbering block moved OUT of grn.service.ts into grn-number-on-submit.ts,
  // because there were two SUBMIT paths and only one allocated. Superseded since: the CALL SITE
  // moved again, from submission to final (Finance Head) approval — a number now identifies
  // approved spend, not merely raised spend, and a rejected GRN never gets one. There are two
  // live approval implementations for the same reason there were two submit ones (grn-smart's
  // review() for allocation-aware GRNs, grn.service.ts's reviewGrn() as the fallback — see
  // grn-smart.routes.ts's onlyWhenSmart), and both must call this one shared helper.
  const ON_SUBMIT = readFileSync(at("../grn-number-on-submit.ts"), "utf8");

  it("reads the format at approval time rather than assuming one", () => {
    expect(ON_SUBMIT).toContain("await resolveGrnNumberFormat()");
  });

  it("routes to the monthly allocator when the flag says so", () => {
    expect(ON_SUBMIT).toContain('format === "monthly_company"');
    expect(ON_SUBMIT).toContain("allocateMonthlyGrnNumber({");
  });

  it("still calls the legacy allocator otherwise, unchanged", () => {
    // Both formats stay reachable; flipping the flag never renumbers what already exists,
    // because the two draw on different sequence tables.
    expect(ON_SUBMIT).toContain("allocateGrnNumber(String(");
  });

  it("both live finance_head-approval paths go through it, so they cannot disagree", () => {
    expect(GRN_SERVICE).toContain("await resolveGrnNumberOnSubmit(grn)");
    expect(readFileSync(at("../grn-smart.service.ts"), "utf8"))
      .toContain("await resolveGrnNumberOnSubmit(grn)");
  });

  it("neither live submit path calls it any more", () => {
    expect(readFileSync(at("../grn-validation-control.service.ts"), "utf8"))
      .not.toContain("resolveGrnNumberOnSubmit(typeRows[0])");
    const submitBlock = GRN_SERVICE.slice(
      GRN_SERVICE.indexOf("async submitForApproval("),
      GRN_SERVICE.indexOf("async submitForApproval(") + 2500,
    );
    expect(submitBlock).not.toContain("resolveGrnNumberOnSubmit(");
  });

  it("numbers from the accounting period, not the vendor's bill date", () => {
    // The MM/YY belongs to the month the GRN books to — the decision taken when multi-month
    // was specified. bill_date is vendor-controlled.
    expect(GRN_SERVICE).toContain("resolveAccountingPeriod({");
    expect(GRN_SERVICE).toContain("accountingPeriod: payload.accountingPeriod");
  });
});

describe("vendor applicability actually narrows the query", () => {
  const ERP = readFileSync(at("../../erp/erp.service.ts"), "utf8");

  it("applies the predicate in the vendor list", () => {
    // Aliased "v", not the bare table name — the vendor list query wraps vendor_master in a
    // de-duplicating subquery (Group A2) that aliases it as v; every reference inside that
    // query, including this predicate, must use the alias or MySQL rejects it.
    expect(ERP).toContain("vendorApplicabilityService.vendorFilterClause(\"v\"");
  });

  it("only narrows when a company or branch is asked for", () => {
    // Every existing screen sends neither, and must keep seeing the full list.
    expect(ERP).toContain("if (filters.companyCode || filters.branchId)");
  });

  it("binds the values rather than interpolating them", () => {
    expect(ERP).toContain("params.push(...applicability.params)");
  });
});
