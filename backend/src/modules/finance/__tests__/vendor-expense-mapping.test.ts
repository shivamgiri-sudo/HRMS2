import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Requirement 2: selecting a vendor must stop exposing every expense head in the master.
 *
 * The rule being pinned here is the INTERSECTION, and specifically that budget is the floor:
 *
 *     {mapped to this vendor}  ∩  {approved budget line for this branch+period with headroom}
 *
 * A vendor mapping must never be able to bypass budget governance, so the budget half of that
 * is applied unconditionally — enforcement off, vendor unmapped, vendor absent, it still
 * applies. Only the vendor half is conditional.
 *
 * The two "unrestricted" cases matter as much as the restricted one. Every vendor in the
 * system starts with zero mapping rows, so reading "no mappings" as "nothing selectable"
 * would brick GRN creation for every vendor Finance has not yet got round to mapping —
 * 1,191 of them were imported from I-Spark, but that still leaves several hundred.
 */

vi.setConfig({ testTimeout: 20_000 });

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));

/** One budgeted head/sub-head, shaped as the selectable query returns it. */
const BUDGETED = {
  head_id: "h1", head_code: "OFFICE_RENT", head_name: "Office Rent",
  sub_head_id: "s1", sub_head_code: "RENT", sub_head_name: "Rent",
  available_amount: 50000,
};

function mockDb(options: { enforced?: boolean; vendorHasMappings?: boolean; selectable?: unknown[]; mapped?: unknown[] }) {
  execute.mockImplementation(async (sql: string) => {
    const s = String(sql);
    if (s.includes("finance_config")) return [[{ config_value: options.enforced ? "1" : "0" }], []];
    if (s.includes("FROM vendor_expense_mapping") && s.includes("LIMIT 1")) {
      return [options.vendorHasMappings ? [{ 1: 1 }] : [], []];
    }
    if (s.includes("FROM finance_budget_line")) return [options.selectable ?? [BUDGETED], []];
    if (s.includes("FROM vendor_expense_mapping")) return [options.mapped ?? [], []];
    return [[], []];
  });
}

/** The selectable query, as it reached mysql2. */
function selectableCall() {
  const hit = execute.mock.calls.find(([sql]) => String(sql).includes("FROM finance_budget_line"));
  if (!hit) throw new Error("selectable query was never issued");
  return { sql: String(hit[0]), params: (hit[1] ?? []) as unknown[] };
}

beforeEach(() => execute.mockReset());

describe("selectableClassifications — budget is the floor", () => {
  it("always filters to approved budget with remaining headroom, even with enforcement off", async () => {
    mockDb({ enforced: false });
    const { vendorExpenseMappingService } = await import("../vendor-expense-mapping.service.js");
    await vendorExpenseMappingService.selectableClassifications({ vendorId: "v1", branchId: "b1" });

    const { sql } = selectableCall();
    expect(sql).toContain("bh.status = 'active'");
    expect(sql).toContain("HAVING available_amount > 0");
    expect(sql, "headroom is gross minus reserved minus consumed, as budget-consumption defines it")
      .toContain("l.gross_amount - l.reserved_amount - l.consumed_amount");
  });

  it("resolves a budget line's free-text head using the same predicate as the P&L view", async () => {
    // finance_budget_line.head is VARCHAR, not an FK. If the picker and migration 418's P&L
    // bucket view disagreed on which head a line belongs to, a GRN could be raised against one
    // head and reported under another.
    mockDb({ enforced: false });
    const { vendorExpenseMappingService } = await import("../vendor-expense-mapping.service.js");
    await vendorExpenseMappingService.selectableClassifications({ branchId: "b1" });

    const { sql } = selectableCall();
    expect(sql).toContain("LOWER(h.head_code) = LOWER(l.head)");
    expect(sql).toContain("LOWER(h.head_name) = LOWER(l.head)");
  });

  it("narrows to a period when one is given", async () => {
    mockDb({ enforced: false });
    const { vendorExpenseMappingService } = await import("../vendor-expense-mapping.service.js");
    await vendorExpenseMappingService.selectableClassifications({ branchId: "b1", periodCode: "2026-08" });
    const { sql, params } = selectableCall();
    expect(sql).toContain("bh.period_code = ?");
    expect(params).toContain("2026-08");
  });
});

describe("selectableClassifications — when the vendor filter applies", () => {
  it("does NOT restrict when enforcement is off, even if the vendor is mapped", async () => {
    mockDb({ enforced: false, vendorHasMappings: true });
    const { vendorExpenseMappingService } = await import("../vendor-expense-mapping.service.js");
    const result = await vendorExpenseMappingService.selectableClassifications({ vendorId: "v1", branchId: "b1" });
    expect(result.enforced).toBe(false);
    expect(selectableCall().sql).not.toContain("EXISTS");
  });

  it("does NOT restrict an UNMAPPED vendor even when enforcement is on", async () => {
    // The rule that stops this bricking every vendor Finance has not mapped yet.
    mockDb({ enforced: true, vendorHasMappings: false });
    const { vendorExpenseMappingService } = await import("../vendor-expense-mapping.service.js");
    const result = await vendorExpenseMappingService.selectableClassifications({ vendorId: "v1", branchId: "b1" });
    expect(result.vendorHasMappings).toBe(false);
    expect(selectableCall().sql).not.toContain("EXISTS");
    expect(result.selectable).toHaveLength(1);
  });

  it("restricts only when enforcement is on AND the vendor is mapped", async () => {
    mockDb({ enforced: true, vendorHasMappings: true });
    const { vendorExpenseMappingService } = await import("../vendor-expense-mapping.service.js");
    await vendorExpenseMappingService.selectableClassifications({ vendorId: "v1", branchId: "b1" });
    const { sql, params } = selectableCall();
    expect(sql).toContain("EXISTS");
    expect(sql).toContain("m.head_code = h.head_code");
    expect(params).toContain("v1");
  });

  it("honours the '*' wildcard as every sub-head under a mapped head", async () => {
    mockDb({ enforced: true, vendorHasMappings: true });
    const { vendorExpenseMappingService } = await import("../vendor-expense-mapping.service.js");
    await vendorExpenseMappingService.selectableClassifications({ vendorId: "v1", branchId: "b1" });
    expect(selectableCall().sql).toContain("m.sub_head_code = '*'");
  });

  it("ignores a mapping whose effective window has passed", async () => {
    mockDb({ enforced: true, vendorHasMappings: true });
    const { vendorExpenseMappingService } = await import("../vendor-expense-mapping.service.js");
    await vendorExpenseMappingService.selectableClassifications({ vendorId: "v1", branchId: "b1" });
    const { sql } = selectableCall();
    expect(sql).toContain("m.effective_from IS NULL OR m.effective_from <= CURDATE()");
    expect(sql).toContain("m.effective_to IS NULL OR m.effective_to >= CURDATE()");
  });
});

describe("selectableClassifications — an empty answer must explain itself", () => {
  it("blames the budget when nothing is budgeted", async () => {
    // A bare empty dropdown is indistinguishable from a broken page, and the two causes need
    // different fixes: raise a top-up, or map the vendor.
    mockDb({ enforced: false, selectable: [] });
    const { vendorExpenseMappingService } = await import("../vendor-expense-mapping.service.js");
    const result = await vendorExpenseMappingService.selectableClassifications({ branchId: "b1" });
    expect(result.selectable).toHaveLength(0);
    expect(result.reason).toMatch(/no approved budget line with remaining balance/i);
  });

  it("blames the mapping, and names it, when the vendor is mapped somewhere unbudgeted", async () => {
    mockDb({
      enforced: true, vendorHasMappings: true, selectable: [],
      mapped: [{ head_name: "Office Rent", sub_head_name: "Rent" }],
    });
    const { vendorExpenseMappingService } = await import("../vendor-expense-mapping.service.js");
    const result = await vendorExpenseMappingService.selectableClassifications({ vendorId: "v1", branchId: "b1" });
    expect(result.reason).toMatch(/mapped to expense heads that have no approved budget/i);
    expect(result.mappedButUnbudgeted).toEqual([{ head_name: "Office Rent", sub_head_name: "Rent" }]);
  });
});

describe("isEnforced", () => {
  it("defaults to not-enforced when finance_config does not exist yet", async () => {
    // A partially-migrated environment must stay usable rather than block every GRN.
    // Scoped to the finance_config query only. A blanket throwing mock also fires for
    // whatever else the module touches, and the resulting error surfaces as an unrelated
    // test failure rather than exercising this catch.
    execute.mockImplementation(async (sql: string) => {
      if (String(sql).includes("finance_config")) {
        throw Object.assign(new Error("Table 'mas_hrms.finance_config' doesn't exist"), {
          code: "ER_NO_SUCH_TABLE",
        });
      }
      return [[], []];
    });
    const { vendorExpenseMappingService } = await import("../vendor-expense-mapping.service.js");
    expect(await vendorExpenseMappingService.isEnforced()).toBe(false);
  });
});
