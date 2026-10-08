import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Vendor applicability: three concepts, never merged.
 *
 * The rule being defended is one the legacy system broke. db_bill.tbl_vendormaster holds 1,829
 * rows for 1,552 distinct vendor names because branch applicability was encoded by duplicating
 * the vendor: "Unicel Technologies Pvt. Ltd." exists six times across five branches, each copy
 * carrying its own PAN, GST number, TDS section and payment history. Correcting one GSTIN means
 * finding six rows, and any report grouped by vendor counts one supplier as six.
 *
 * THE PROPERTY THAT MATTERS MOST IS "NO ROWS MEANS UNRESTRICTED".
 * There are 1,821 live vendors and none of them has an applicability row. If absence meant
 * "deny", shipping this would make every vendor unusable everywhere — GRN creation would stop
 * dead. Restriction is opt-in, and several tests below exist purely to pin that down.
 */

const { execute, getConnection } = vi.hoisted(() => ({ execute: vi.fn(), getConnection: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute, getConnection } }));

let service: typeof import("../vendor-applicability.service.js")["vendorApplicabilityService"];
beforeAll(async () => {
  ({ vendorApplicabilityService: service } = await import("../vendor-applicability.service.js"));
}, 120_000);

beforeEach(() => {
  execute.mockReset();
  getConnection.mockReset();
});

/** Scripts the two reads getForVendor performs, in order. */
function scriptApplicability(companies: unknown[], branches: unknown[]) {
  execute.mockImplementation(async (sql: string) => {
    if (/FROM vendor_company_applicability/.test(sql)) return [companies, []];
    if (/FROM vendor_branch_applicability/.test(sql)) return [branches, []];
    return [[], []];
  });
}

describe("no rows means unrestricted", () => {
  it("treats a vendor with no rows as available to every company and branch", async () => {
    scriptApplicability([], []);
    await expect(
      service.isAvailable("v1", { companyCode: "MAS", branchId: "br1" }),
    ).resolves.toBe(true);
  });

  it("restricts only once rows exist", async () => {
    scriptApplicability([{ company_code: "IDC" }], []);
    await expect(service.isAvailable("v1", { companyCode: "MAS" })).resolves.toBe(false);
    await expect(service.isAvailable("v1", { companyCode: "IDC" })).resolves.toBe(true);
  });

  it("keeps the two concepts independent — a company restriction does not restrict branches", async () => {
    // The whole point of separate tables. A vendor limited to IDC is still usable at every IDC
    // branch unless somebody separately restricts branches.
    scriptApplicability([{ company_code: "IDC" }], []);
    await expect(
      service.isAvailable("v1", { companyCode: "IDC", branchId: "any-branch" }),
    ).resolves.toBe(true);
  });

  it("applies a branch restriction independently of company", async () => {
    scriptApplicability([], [{ branch_id: "br1" }]);
    await expect(service.isAvailable("v1", { branchId: "br1" })).resolves.toBe(true);
    await expect(service.isAvailable("v1", { branchId: "br2" })).resolves.toBe(false);
  });
});

describe("vendorFilterClause", () => {
  it("passes vendors that have no rows, via NOT EXISTS", async () => {
    const clause = service.vendorFilterClause("v", { companyCode: "MAS" });
    expect(clause.sql).toContain("NOT EXISTS");
    expect(clause.sql).toContain("vendor_company_applicability");
    expect(clause.params).toEqual(["MAS"]);
  });

  it("is a no-op predicate when nothing is scoped", async () => {
    // Dropped into an existing query, it must not change the row count when no scope applies.
    const clause = service.vendorFilterClause("v", {});
    expect(clause.sql).toBe("1=1");
    expect(clause.params).toEqual([]);
  });

  it("ANDs the two restrictions rather than ORing them", async () => {
    // A vendor restricted to IDC and to branch A must satisfy both, not either.
    const clause = service.vendorFilterClause("v", { companyCode: "IDC", branchId: "br1" });
    expect(clause.sql).toContain(") AND (");
    expect(clause.params).toEqual(["IDC", "br1"]);
  });

  it("binds values as parameters, never interpolating them", async () => {
    const clause = service.vendorFilterClause("v", { companyCode: "MAS'; DROP TABLE x; --" });
    expect(clause.sql).not.toContain("DROP TABLE");
    expect(clause.params[0]).toBe("MAS'; DROP TABLE x; --");
  });
});

describe("replaceForVendor", () => {
  function conn() {
    const statements: string[] = [];
    return {
      statements,
      execute: vi.fn(async (sql: string) => {
        statements.push(String(sql).replace(/\s+/g, " ").trim());
        return [[], []];
      }),
      beginTransaction: vi.fn(async () => {}),
      commit: vi.fn(async () => {}),
      rollback: vi.fn(async () => {}),
      release: vi.fn(() => {}),
    };
  }

  it("replaces only the concept the caller actually sent", async () => {
    // Saving the Company tab must not silently clear the Branch tab.
    const c = conn();
    getConnection.mockResolvedValue(c);
    scriptApplicability([], []);
    await service.replaceForVendor("v1", { companyCodes: ["MAS"] }, "u1");
    expect(c.statements.some((s) => /DELETE FROM vendor_company_applicability/.test(s))).toBe(true);
    expect(
      c.statements.some((s) => /DELETE FROM vendor_branch_applicability/.test(s)),
      "branches were not sent, so they must be left alone",
    ).toBe(false);
  });

  it("clears an emptied list rather than ignoring it", async () => {
    // An explicitly empty array means "no restriction", which must actually delete the rows.
    const c = conn();
    getConnection.mockResolvedValue(c);
    scriptApplicability([], []);
    await service.replaceForVendor("v1", { companyCodes: [] }, "u1");
    expect(c.statements.some((s) => /DELETE FROM vendor_company_applicability/.test(s))).toBe(true);
    expect(c.statements.some((s) => /INSERT INTO vendor_company_applicability/.test(s))).toBe(false);
  });

  it("de-duplicates, so a repeated code cannot trip the unique key", async () => {
    const c = conn();
    getConnection.mockResolvedValue(c);
    scriptApplicability([], []);
    await service.replaceForVendor("v1", { companyCodes: ["MAS", "MAS", " MAS "] }, "u1");
    const inserts = c.statements.filter((s) => /INSERT INTO vendor_company_applicability/.test(s));
    expect(inserts).toHaveLength(1);
  });

  it("writes both concepts inside one transaction", async () => {
    const c = conn();
    getConnection.mockResolvedValue(c);
    scriptApplicability([], []);
    await service.replaceForVendor(
      "v1",
      { companyCodes: ["MAS"], branches: [{ branchId: "br1" }] },
      "u1",
    );
    expect(c.beginTransaction).toHaveBeenCalledOnce();
    expect(c.commit).toHaveBeenCalledOnce();
    expect(c.rollback).not.toHaveBeenCalled();
  });

  it("stores a blank ship-to as NULL, not an empty string", async () => {
    // NULL is what means "use the branch's own address". An empty string would read as a
    // deliberate override to nothing, and print a blank Ship-To on the document.
    const c = conn();
    getConnection.mockResolvedValue(c);
    scriptApplicability([], []);
    await service.replaceForVendor(
      "v1",
      { branches: [{ branchId: "br1", ship_to_address1: "   ", ship_to_city: "Noida" }] },
      "u1",
    );
    const insert = c.execute.mock.calls.find(([s]) => /INSERT INTO vendor_branch_applicability/.test(String(s)));
    const params = insert?.[1] as unknown[];
    expect(params).toContain(null);
    expect(params).toContain("Noida");
  });
});

describe("resolveShipTo", () => {
  it("falls back to the branch's own address when nothing is overridden", async () => {
    execute.mockResolvedValue([
      [{
        ship_to_address1: null, ship_to_name: null, branch_name: "Noida",
        branch_address: "A-24, Sector 63", branch_city: "Noida", branch_pincode: "201301",
        branch_state_code: "09",
      }],
      [],
    ]);
    const shipTo = await service.resolveShipTo("v1", "br1");
    expect(shipTo?.source).toBe("branch_master");
    expect(shipTo?.address1).toBe("A-24, Sector 63");
    expect(shipTo?.pincode).toBe("201301");
  });

  it("uses the override when one is set, and says where it came from", async () => {
    execute.mockResolvedValue([
      [{
        ship_to_name: "Warehouse", ship_to_address1: "Plot 9, Industrial Area",
        ship_to_city: "Ghaziabad", ship_to_pincode: "201009", ship_to_state_code: "09",
        branch_name: "Noida", branch_address: "A-24, Sector 63", branch_city: "Noida",
      }],
      [],
    ]);
    const shipTo = await service.resolveShipTo("v1", "br1");
    expect(shipTo?.source).toBe("vendor_branch_override");
    expect(shipTo?.address1).toBe("Plot 9, Industrial Area");
    expect(shipTo?.name).toBe("Warehouse");
  });

  it("returns null for a branch that does not exist", async () => {
    execute.mockResolvedValue([[], []]);
    await expect(service.resolveShipTo("v1", "nope")).resolves.toBeNull();
  });
});
