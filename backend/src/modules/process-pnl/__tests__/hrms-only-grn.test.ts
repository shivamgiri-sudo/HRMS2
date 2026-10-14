import { describe, expect, it } from "vitest";
import { hrmsAllocationSql, legacyAllocationSql, withoutLegacy } from "../hrms-only-grn.js";

/**
 * HRMS budgets show HRMS GRNs only (owner rule 2026-10-14). Legacy (db_bill-migrated) GRN spend
 * was linked to Apr-Aug 2026 budget lines by the 2026-08-22 remediation; budget views subtract it.
 */
describe("withoutLegacy", () => {
  const line = { id: "l1", reserved_amount: 140894.44, consumed_amount: 5000, available_gross_amount: 20000 };

  it("takes the legacy share out of reserved/consumed and returns it to headroom", () => {
    const out = withoutLegacy(line, { reserved: 100000, consumed: 5000 });
    expect(out.reserved_amount).toBe(40894.44);
    expect(out.consumed_amount).toBe(0);
    expect(out.available_gross_amount).toBe(125000);
  });

  it("returns the line untouched when there is no legacy spend", () => {
    expect(withoutLegacy(line, undefined)).toBe(line);
    expect(withoutLegacy(line, { reserved: 0, consumed: 0 })).toBe(line);
  });

  it("never goes negative when the legacy share exceeds the stored counter", () => {
    const out = withoutLegacy({ ...line, reserved_amount: 10 }, { reserved: 99, consumed: 0 });
    expect(out.reserved_amount).toBe(0);
  });
});

describe("allocation predicates", () => {
  it("legacy = migrated bill_source_id or sentinel creator, tested on the GRN header", () => {
    const sql = legacyAllocationSql("ca").replace(/\s+/g, " ");
    expect(sql).toContain("lgr.id = ca.grn_request_id");
    expect(sql).toContain("bill_source_id IS NOT NULL");
    expect(sql).toContain("LIKE '00000000-%'");
  });
  it("hrms is the exact negation", () => {
    expect(hrmsAllocationSql("ca")).toBe(`NOT ${legacyAllocationSql("ca")}`);
  });
});
