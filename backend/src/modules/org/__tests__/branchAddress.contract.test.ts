/**
 * Documents must print the address of the branch that issued them.
 *
 * Four different company addresses were hardcoded across the renderers — Okhla
 * on the joining-document letterhead, a Karampura registered office on the
 * experience letter, "Corporate Office: Mumbai, India" on the offer letter, and
 * nothing at all on the appointment letter. Only the digital ID card ever
 * resolved a real branch address.
 *
 * The gap this guards: branch_master.address is NULL on roughly 41 of 45
 * branches, and employees.branch_id is nullable with an ON DELETE SET NULL FK.
 * Printing an empty letterhead is a real outcome, so it must be a visible
 * blocker instead.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs";
import path from "path";

let branchRow: Record<string, unknown> | undefined;
let employeeRow: Record<string, unknown> | undefined;

vi.mock("../../../db/mysql.js", () => ({
  db: {
    execute: vi.fn(async (sql: string) => {
      if (String(sql).includes("FROM branch_master")) return [branchRow ? [branchRow] : []];
      if (String(sql).includes("FROM employees")) return [employeeRow ? [employeeRow] : []];
      return [[]];
    }),
  },
}));

const {
  resolveBranchLetterhead, resolveEmployeeLetterhead, assertPrintableLetterhead,
  letterheadOneLine, clearBranchLetterheadCache,
} = await import("../branchAddress.service.js");

beforeEach(() => {
  clearBranchLetterheadCache();
  branchRow = undefined;
  employeeRow = undefined;
});

describe("resolving a branch letterhead", () => {
  it("splits the free-text address into lines", async () => {
    // branch_master has one address VARCHAR(500) holding the whole postal
    // address newline-separated — there is no pincode or full_address column.
    branchRow = {
      id: "b1", branch_name: "NOIDA-2",
      address: "A-45, Sector 63\nNoida, Uttar Pradesh 201301",
      city: "Noida", state: "Uttar Pradesh", hr_contact: "hr.noida@teammas.in",
    };
    const lh = await resolveBranchLetterhead("b1");
    expect(lh.branchName).toBe("NOIDA-2");
    expect(lh.addressLines).toEqual(["A-45, Sector 63", "Noida, Uttar Pradesh 201301"]);
    expect(lh.hasAddress).toBe(true);
    expect(letterheadOneLine(lh)).toBe("A-45, Sector 63, Noida, Uttar Pradesh 201301");
  });

  it("falls back to city/state when the address is blank, and says so", async () => {
    branchRow = { id: "b2", branch_name: "DELHI", address: "", city: "Delhi", state: "Delhi", hr_contact: "" };
    const lh = await resolveBranchLetterhead("b2");
    expect(lh.addressLines).toEqual(["Delhi, Delhi"]);
    // Still false: a city/state line is not a postal address.
    expect(lh.hasAddress).toBe(false);
  });

  it("returns an empty letterhead for a null branch rather than throwing", async () => {
    const lh = await resolveBranchLetterhead(null);
    expect(lh.branchId).toBeNull();
    expect(lh.hasAddress).toBe(false);
  });

  it("resolves through the employee", async () => {
    employeeRow = { branch_id: "b1" };
    branchRow = { id: "b1", branch_name: "NOIDA-2", address: "A-45, Sector 63", city: "", state: "", hr_contact: "" };
    const lh = await resolveEmployeeLetterhead("emp-1");
    expect(lh.branchName).toBe("NOIDA-2");
  });
});

describe("refusing to print a blank letterhead", () => {
  it("blocks when the employee has no branch", async () => {
    const lh = await resolveBranchLetterhead(null);
    expect(() => assertPrintableLetterhead(lh)).toThrow();
    try { assertPrintableLetterhead(lh); } catch (e) {
      expect((e as { code?: string }).code).toBe("branch_not_assigned");
    }
  });

  it("blocks when the branch has no address on record", async () => {
    branchRow = { id: "b2", branch_name: "HQ", address: "", city: "Mumbai", state: "MH", hr_contact: "" };
    const lh = await resolveBranchLetterhead("b2");
    try {
      assertPrintableLetterhead(lh);
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as { code?: string }).code).toBe("branch_address_missing");
      // The message must name the branch so HR knows which one to fix.
      expect((e as Error).message).toContain("HQ");
    }
  });

  it("passes a fully populated branch", async () => {
    branchRow = { id: "b1", branch_name: "NOIDA-2", address: "A-45, Sector 63", city: "", state: "", hr_contact: "" };
    const lh = await resolveBranchLetterhead("b1");
    expect(() => assertPrintableLetterhead(lh)).not.toThrow();
  });
});

describe("renderers no longer hardcode an address", () => {
  const root = path.resolve(__dirname, "../../..");
  const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");

  it("the letter header and footer take the issuing branch", () => {
    const src = read("modules/letters/letters-render.service.ts");
    expect(src).toContain("function letterHeader(logoUrl: string, d?: Record<string, string>)");
    expect(src).toContain("function footer(d?: Record<string, string>)");
    expect(src).toContain("d?.branch_address");
    // No call site may still render without the branch context.
    expect(src).not.toContain("${footer()}");
    expect(src).not.toContain("${letterHeader(logoUrl)}");
  });

  it("keeps the registered office on the experience letter", () => {
    // Registered office is a legal fact and is NOT the issuing branch; the
    // branch is added beneath it rather than replacing it.
    const src = read("modules/letters/letters-render.service.ts");
    expect(src).toContain("Karampura Commercial Complex");
    expect(src).toContain("Issuing Branch");
  });

  it("the joining-document letterhead accepts a branch", () => {
    const src = read("modules/employees/joiningDocumentPdf.service.ts");
    expect(src).toContain("function drawLetterhead(doc: Doc, letterhead?: PdfLetterhead)");
    expect(src).toContain("COMPANY_ADDRESS_FALLBACK");
  });

  it("blank-page removal uses the address actually drawn", () => {
    // finish() strips pages carrying nothing but the letterhead. If it compared
    // against a different string than drawLetterhead rendered, trailing blank
    // pages would stop being removed and joiners would get empty sheets.
    const src = read("modules/employees/joiningDocumentPdf.service.ts");
    expect(src).toContain("function letterheadAddressText(");
    expect(src).toContain("(COMPANY_NAME + addressText)");
  });

  it("letters supply the branch fields to the renderer", () => {
    for (const f of ["modules/letters/letters.service.ts", "modules/letters/letters.routes.ts"]) {
      const src = read(f);
      expect(src).toContain("AS branch_address");
      expect(src).toContain("branch_address:    emp.branch_address");
    }
  });
});
