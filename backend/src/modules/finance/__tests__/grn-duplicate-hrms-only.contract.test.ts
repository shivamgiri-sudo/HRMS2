import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");

describe("GRN duplicate check only compares HRMS-raised GRNs", () => {
  const service = read("src/modules/finance/grn-smart.service.ts");
  const body = service.slice(
    service.indexOf("async function refreshDuplicateMatches"),
    service.indexOf("for (const match of matches)"),
  );

  it("excludes db_bill-migrated GRNs from the invoice-identity, document-hash and amount/date queries", () => {
    expect(body.match(/bill_source_id IS NULL/g)?.length).toBe(3);
  });
});

describe("access control shows the official email", () => {
  it("prefers employees.official_email over the login email in both user lists", () => {
    expect(read("src/modules/access/access.routes.ts")).toContain(
      "COALESCE(NULLIF(TRIM(e.official_email), ''), au.email) AS email",
    );
    expect(read("src/modules/access/user-page-access.service.ts")).toContain(
      "COALESCE(NULLIF(TRIM(e.official_email), ''), u.email) AS email",
    );
  });
});

describe("joining-kit contract remuneration", () => {
  it("prints the Payroll Head assigned CTC, not the payslip gross", () => {
    const src = read("src/modules/employees/universalDigitalFormFill.service.ts");
    expect(src).toContain("SELECT p.ctc AS package_gross");
    expect(src).not.toContain("SELECT p.gross AS package_gross");
  });
});
