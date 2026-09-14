import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";

/**
 * Multi-month wiring into the GRN save path (Requirement 5).
 *
 * The split arithmetic is proven in grn-period-allocation.test.ts. What is proven here is that
 * the invoice save actually reaches it, and — the part that matters more — that a GRN which says
 * nothing about recognition behaves exactly as it did before multi-month existed.
 *
 * These are source-level contract assertions rather than behavioural ones, deliberately.
 * saveAllocations is a 200-line transaction over locked budget lines; a mock faithful enough to
 * drive it would assert the mock, not the code. What can fail silently here is the WIRING —
 * someone reverting the period comparison, or dropping the DELETE that clears a stale schedule —
 * and that is exactly what a source assertion catches. The same idiom is already used by
 * grn-form-capabilities.contract.test.ts and report-format.contract.test.ts.
 */

const at = (rel: string) =>
  new URL(rel, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

const SRC = readFileSync(at("../grn-smart.service.ts"), "utf8");
const SPLIT_SRC = readFileSync(at("../grn-period-allocation.service.ts"), "utf8");
const MIGRATION = readFileSync(at("../../../../sql/1099_grn_period_allocation.sql"), "utf8");

/**
 * The body of a top-level function, up to its closing brace at column 0.
 *
 * The terminator is "\n}\n", not "\n}" — an inline parameter type ends with "\n}): string {",
 * which would otherwise truncate the body to the signature and make every assertion below read
 * a slice that contains no code at all.
 */
function bodyOf(source: string, declaration: string): string {
  const start = source.indexOf(declaration);
  expect(start, `${declaration} must exist`).toBeGreaterThan(-1);
  const rest = source.slice(start);
  const end = rest.indexOf("\n}\n");
  expect(end, `${declaration} must have a closing brace at column 0`).toBeGreaterThan(-1);
  return rest.slice(0, end);
}

describe("consumptionPeriodOf — the widened period check", () => {
  it("prefers accounting_period, then recognition_start_period, then bill_date", () => {
    // Order is the whole point: the month Finance booked the GRN to wins over where recognition
    // starts, and both win over the vendor-controlled invoice date.
    const body = bodyOf(SRC, "function consumptionPeriodOf");
    expect(body.indexOf("accounting_period")).toBeLessThan(body.indexOf("recognition_start_period"));
    expect(body.indexOf("recognition_start_period")).toBeLessThan(body.indexOf("bill_date"));
  });

  it("falls back to bill_date when both new columns are NULL, so history is unaffected", () => {
    // Every GRN raised before this migration has NULL in both, and must gate exactly as before.
    const body = bodyOf(SRC, "function consumptionPeriodOf");
    expect(body).toContain('return String(grn.bill_date ?? "").slice(0, 7)');
  });

  it("accepts only a well-formed YYYY-MM from either new column", () => {
    // An empty string or a stray "Aug-26" must fall through to bill_date rather than become the
    // accounting month — a bad period here would silently mis-gate budget consumption.
    const body = bodyOf(SRC, "function consumptionPeriodOf");
    const guards = body.match(/\/\^\\d\{4\}-\\d\{2\}\$\/\.test\(/g) ?? [];
    expect(guards, "both candidate columns must be validated").toHaveLength(2);
  });

  it("gates both allocation paths, and neither still slices bill_date", () => {
    // grn-smart.service.ts holds two independent period comparisons — the allocation path and
    // the cost-centre-split path. Widening one and not the other leaves multi-month half-blocked.
    const widened = SRC.match(/if \(consumptionPeriodOf\(grn\) !== String\(line\.period_code\)\)/g) ?? [];
    expect(widened, "both paths must be widened").toHaveLength(2);
    expect(SRC.includes("String(grn.bill_date).slice(0, 7) !== String(line.period_code)")).toBe(false);
  });
});

describe("writePeriodSplits", () => {
  it("clears the schedule when the recognition window is removed", () => {
    // A GRN re-saved as single-month that kept its twelve rows would go on recognising months it
    // no longer claims, and the P&L would never tie again.
    const body = bodyOf(SRC, "async function writePeriodSplits");
    expect(body).toContain("DELETE FROM grn_period_allocation WHERE grn_request_id = ?");
    expect(body).toContain("period_allocation_mode = 'single'");
    expect(body).toContain("is_multi_month = 0");
  });

  it("refuses half a window rather than guessing the missing end", () => {
    const body = bodyOf(SRC, "async function writePeriodSplits");
    expect(body).toContain("needs both a first and a last recognition month");
  });

  it("splits each allocation against its own pnl_cost_amount, never amount_with_tax", () => {
    // Recoverable GST is not an expense; spreading amount_with_tax would recognise tax as cost.
    // Splitting per allocation also avoids rounding twice on a multi-cost-centre invoice.
    const body = bodyOf(SRC, "async function writePeriodSplits");
    expect(body).toContain("SELECT id, pnl_cost_amount FROM grn_cost_allocation");
    expect(body).toContain("recognitionAmount: Number(row.pnl_cost_amount ?? 0)");
    expect(body).not.toContain("amount_with_tax");
  });

  it("is called from both invoice write paths, inside the transaction", () => {
    // A split that fails to reconcile has to take the invoice save down with it, so the call
    // must sit before the commit rather than after it.
    // actorRole was added to the signature when the recognition override gate landed;
    // matched loosely so a later argument does not silently drop this assertion to zero
    const calls = [...SRC.matchAll(/await writePeriodSplits\(connection, grnId, grn, input, actorUserId[^)]*\);/g)];
    expect(calls, "saveAllocations and saveComponentAllocations both author the schedule")
      .toHaveLength(2);

    // Checked structurally rather than inside a fixed character window. This assertion used to
    // slice 400 characters after each call and look for the commit in there; both call sites are
    // still correct, but the code between call and commit grew to 444 and 510 characters, so the
    // window stopped reaching and the test failed against working code. A magic number that
    // encodes "how much code happens to sit here today" rots by design.
    //
    // What actually matters is ordering: the commit must be the next transaction-terminating
    // statement after the call, with no rollback or early return in between, so a split that
    // fails to reconcile takes the invoice save down with it.
    for (const call of calls) {
      const after = SRC.slice(call.index ?? 0);
      const commitAt = after.indexOf("await connection.commit();");
      const rollbackAt = after.indexOf("await connection.rollback();");

      expect(commitAt, "a commit must follow this writePeriodSplits call").toBeGreaterThan(0);
      // A rollback may appear later in the catch block; it must not come first.
      if (rollbackAt !== -1) {
        expect(rollbackAt, "rollback must not precede the commit for this call").toBeGreaterThan(commitAt);
      }
      // And the commit must belong to the same function — no later call site may satisfy it.
      const nextCallAt = after.indexOf("await writePeriodSplits(connection", 1);
      if (nextCallAt !== -1) {
        expect(commitAt, "each call must reach its own commit, not a later one").toBeLessThan(nextCallAt);
      }
    }
  });

  it("exposes the schedule on the workspace, so one GRN keeps one detail surface", () => {
    expect(SRC).toContain("periodAllocations,");
    expect(SRC).toContain("FROM grn_period_allocation p");
  });
});

describe("one invoice is still one payable", () => {
  it("nothing in the multi-month path touches vendor payment", () => {
    // amount_with_tax stays whole on the header, and that is what createFromGrn reads for
    // due_amount — which is why splitting recognition cannot split the payable.
    expect(SPLIT_SRC).not.toContain("vendor_payment_tracking");
    expect(SPLIT_SRC).not.toContain("amount_with_tax");
    expect(MIGRATION).not.toMatch(/ALTER TABLE vendor_payment_tracking/);
  });

  it("hangs the schedule off the cost allocation, not off the GRN header", () => {
    // As a child of grn_cost_allocation, cost-centre/process/LOB attribution survives the split:
    // a 3-cost-centre invoice over 12 months is 36 facts, not 12.
    expect(MIGRATION).toMatch(/FOREIGN KEY \(cost_allocation_id\)\s+REFERENCES grn_cost_allocation\(id\)/);
    expect(MIGRATION).toContain("UNIQUE KEY uq_grn_period_month (cost_allocation_id, period_code)");
  });

  it("adds no unguarded ALTER, which would 503 the app at boot", () => {
    // MIGRATION_STOP_ON_FAILURE defaults true and migrations run at boot, so a re-applied
    // ADD COLUMN must be guarded on information_schema rather than IF NOT EXISTS.
    expect(MIGRATION).not.toMatch(/ADD COLUMN IF NOT EXISTS/i);
    expect(MIGRATION).toContain("information_schema.columns");
    expect(MIGRATION).toContain("ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
  });
});
