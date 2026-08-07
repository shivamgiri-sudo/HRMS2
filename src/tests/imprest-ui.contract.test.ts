import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";

/**
 * Imprest UI invariants (Requirements 6 and 7).
 *
 * Two things here are quietly easy to regress, and neither shows up as a broken screen:
 *
 *   1. The export must hit the API, not serialise the loaded rows. Serialising what is on
 *      screen produces a file that silently depends on paging and on whatever filter happened
 *      to be applied — and, worse, bypasses the server-side branch entitlement that the list
 *      endpoint enforces.
 *   2. No balance may be computed from the allocation list. The float is derived server-side
 *      from an append-only ledger; a second implementation in the browser is exactly how two
 *      balances end up disagreeing, with neither obviously wrong.
 *
 * The running balance in the ledger table is the one permitted client-side arithmetic: it is a
 * per-row display of a figure whose opening and closing both come from the server, and the test
 * below pins it to open at the server's opening balance so the last row equals closing.
 */

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");

const ALLOCATION = read("src/components/finance/grn/imprest/ImprestAllocationPanel.tsx");
const REPORT = read("src/components/finance/grn/imprest/ImprestReportPanel.tsx");
const WORKSPACE = read("src/components/finance/grn/imprest/ImprestWorkspace.tsx");

describe("the report exports through the API", () => {
  it("opens the export endpoint rather than building a file from state", () => {
    expect(REPORT).toContain("/api/finance/imprest/ledger/export?");
    // No client-side CSV assembly. If one appears, the branch entitlement stops being enforced
    // on the file the user actually receives.
    expect(REPORT).not.toMatch(/new Blob\(/);
    expect(REPORT).not.toMatch(/URL\.createObjectURL/);
  });

  it("sends the same filters to the export as to the table", () => {
    // One query string, built once, used by the summary, the ledger and the export.
    const uses = REPORT.match(/\$\{query\}/g) ?? [];
    expect(uses.length, "summary, ledger and export all reuse the query").toBeGreaterThanOrEqual(3);
  });
});

describe("balances are server-derived", () => {
  it("the allocation panel reads the float from the reports endpoint", () => {
    expect(ALLOCATION).toContain("/api/finance/imprest/reports/balance");
    expect(ALLOCATION).toContain("closing_balance");
  });

  it("the allocation panel never sums the allocation list into a balance", () => {
    // A .reduce over allocations would produce a figure that ignores vouchers and returns, and
    // would look plausible while being wrong by exactly the amount that has been spent.
    expect(ALLOCATION).not.toMatch(/allocations\s*\.\s*reduce/);
  });

  it("the ledger's running balance opens at the server's opening figure", () => {
    // Starting at zero would make every row wrong by the opening balance, and the last row
    // would not equal the closing figure shown directly above it.
    expect(REPORT).toContain("let running = summary?.opening_balance ?? 0;");
  });

  it("shows the full identity, not just a closing number", () => {
    // Opening + allocated - vouchers - returned +/- adjustments = closing. A report showing
    // only closing cannot be reconciled by the person reading it.
    for (const field of [
      "opening_balance", "allocated", "voucher_utilisation", "returned", "adjustments", "closing_balance",
    ]) {
      expect(REPORT, `${field} must be shown`).toContain(field);
    }
  });
});

describe("the allocation form", () => {
  it("takes the branch from the manager's appointment, never from a free field", () => {
    // An allocation must credit the branch the chosen manager actually holds; letting the two
    // diverge would credit a float in a branch that manager has no appointment for.
    expect(ALLOCATION).toContain("branchId: selectedManager.branch_id");
  });

  it("refuses to submit without a manager and a positive amount", () => {
    expect(ALLOCATION).toContain("!draft.imprestManagerId || !(Number(draft.amount) > 0)");
  });

  it("requires a reason before a rejection can be sent", () => {
    expect(ALLOCATION).toContain("disabled={!rejecting.reason.trim() || review.isPending}");
  });
});

describe("the three surfaces share one tab", () => {
  it("hosts approvals, allocation and report without new routed pages", () => {
    // Three routed pages would need three page_catalog rows, three nav entries and three sets
    // of role grants to stay reachable — the checklist FINANCE_COST_CENTRES failed.
    for (const pane of ["approvals", "allocation", "report"]) {
      expect(WORKSPACE).toContain(`value: "${pane}"`);
    }
    expect(WORKSPACE).toContain("ImprestApprovalQueue");
    expect(WORKSPACE).toContain("ImprestAllocationPanel");
    expect(WORKSPACE).toContain("ImprestReportPanel");
  });
});
