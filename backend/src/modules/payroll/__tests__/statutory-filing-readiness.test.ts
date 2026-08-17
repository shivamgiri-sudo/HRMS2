import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Filing readiness = applicability AND a valid government identifier.
 *
 * Applicability alone was never enough to file: EPFO rejects a PF contributor without a 12-digit
 * UAN, and ESIC rejects an IP without a 10-digit number. This resolver answers both together for
 * both schemes.
 *
 * Measured live 2026-08-17 (applicability from db_bill 2026-07):
 *
 *                READY   NOT_APPLICABLE   MISSING_ID   INVALID_ID   UNRESOLVED
 *     UAN / PF     472              321          443            0           96
 *     ESIC / ESI   334              510          392            0           96
 */

const { billQuery, execute } = vi.hoisted(() => ({ billQuery: vi.fn(), execute: vi.fn() }));
vi.mock("../../../db/billDb.js", () => ({ billQuery }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));

const { resolveStatutoryFilingReadinessForPeriod, summariseFilingReadiness } =
  await import("../statutory-filing-readiness.service.js");

beforeEach(() => {
  billQuery.mockReset();
  execute.mockReset();
});

/**
 * Route each mas_hrms query to its answer by what it selects, not by call order.
 *
 * This used to queue two mockResolvedValueOnce in sequence: the applicability resolver's
 * employee_statutory_info fallback, then this resolver's identifier query. Adding the approved
 * opt-out override lookup upstream inserted a third query between them, so every queued answer
 * shifted by one and the identifier query received `[]` — surfacing as "(intermediate value) is
 * not iterable" in the resolver rather than anything resembling the real cause.
 *
 * Positional mocks encode the number of queries a dependency happens to make today, which is not
 * part of its contract. Dispatching on the SQL keeps these tests about behaviour: a query added
 * upstream tomorrow falls through to the empty default instead of corrupting an unrelated
 * assertion.
 */
const mockIdentifiers = (rows: Array<Record<string, unknown>>) => {
  execute.mockImplementation(async (sql: unknown) => {
    const text = String(sql);
    if (text.includes("uan_employees")) return [rows, []]; // this resolver's identifier query
    return [[], []];                                       // statutory fallback, opt-out overrides
  });
};

describe("READY requires BOTH applicability and a well-formed identifier", () => {
  it("READY when applicable and the identifier is valid, for each scheme", async () => {
    billQuery.mockResolvedValue([{ EmpCode: "MAS001", PFELig: "YES", ESIElig: "YES" }]);
    mockIdentifiers([{
      employee_code: "MAS001",
      uan_employees: "123456789012", uan_statutory_info: null, uan_employee_uan: null,
      esi_employees: "1234567890", esi_statutory_info: null,
    }]);
    const all = await resolveStatutoryFilingReadinessForPeriod("2026-07");
    expect(all.get("MAS001")?.pf).toMatchObject({ status: "READY", identifierSource: "employees", identifierValid: true });
    expect(all.get("MAS001")?.esi).toMatchObject({ status: "READY", identifier: "1234567890" });
  });

  it("MISSING_ID when applicable with no identifier anywhere", async () => {
    billQuery.mockResolvedValue([{ EmpCode: "MAS002", PFELig: "YES", ESIElig: "YES" }]);
    mockIdentifiers([{ employee_code: "MAS002", uan_employees: null, uan_statutory_info: null, uan_employee_uan: null, esi_employees: null, esi_statutory_info: null }]);
    const all = await resolveStatutoryFilingReadinessForPeriod("2026-07");
    expect(all.get("MAS002")?.pf.status).toBe("MISSING_ID");
    expect(all.get("MAS002")?.esi.status).toBe("MISSING_ID");
    expect(all.get("MAS002")?.esi.identifierValid).toBeNull(); // nothing was validated
  });

  it("INVALID_ID when applicable and the identifier is malformed", async () => {
    // The state that matters: "Not Applicable" typed into the identifier field of someone who IS
    // covered. Live today every such value sits on a not-applicable employee, so this never fires
    // — one row over, and it would.
    billQuery.mockResolvedValue([{ EmpCode: "MAS003", PFELig: "YES", ESIElig: "YES" }]);
    mockIdentifiers([{
      employee_code: "MAS003",
      uan_employees: "12345", uan_statutory_info: null, uan_employee_uan: null,
      esi_employees: "Not Applicable", esi_statutory_info: null,
    }]);
    const all = await resolveStatutoryFilingReadinessForPeriod("2026-07");
    expect(all.get("MAS003")?.pf.status).toBe("INVALID_ID");
    expect(all.get("MAS003")?.esi.status).toBe("INVALID_ID");
    expect(all.get("MAS003")?.esi.identifierValid).toBe(false);
  });

  it("NOT_APPLICABLE outranks a missing OR malformed identifier", async () => {
    // An employee the scheme does not cover is not a filing problem, however junk their ID field
    // is. Classifying them MISSING_ID would manufacture ~500 false gaps per scheme.
    billQuery.mockResolvedValue([{ EmpCode: "MAS004", PFELig: "NO", ESIElig: "NO" }]);
    mockIdentifiers([{ employee_code: "MAS004", uan_employees: null, uan_statutory_info: null, uan_employee_uan: null, esi_employees: "0", esi_statutory_info: null }]);
    const all = await resolveStatutoryFilingReadinessForPeriod("2026-07");
    expect(all.get("MAS004")?.pf.status).toBe("NOT_APPLICABLE");
    expect(all.get("MAS004")?.esi.status).toBe("NOT_APPLICABLE");
  });

  it("APPLICABILITY_UNRESOLVED is never reported as READY, even with a perfect identifier", async () => {
    // Not knowing whether someone is covered is not the same as knowing they are. Filing them
    // because their number looks right would file a contribution nobody decided to make.
    billQuery.mockResolvedValue([]); // employee absent from the period's payroll
    mockIdentifiers([{
      employee_code: "MAS005",
      uan_employees: "123456789012", uan_statutory_info: null, uan_employee_uan: null,
      esi_employees: "1234567890", esi_statutory_info: null,
    }]);
    const all = await resolveStatutoryFilingReadinessForPeriod("2026-07");
    expect(all.get("MAS005")?.pf.status).toBe("APPLICABILITY_UNRESOLVED");
    expect(all.get("MAS005")?.esi.status).toBe("APPLICABILITY_UNRESOLVED");
  });
});

describe("an approved statutory opt-out reaches readiness", () => {
  it("makes an otherwise-READY employee NOT_APPLICABLE, identifier notwithstanding", async () => {
    // The seam between two changes: the shared applicability resolver gained an approved-opt-out
    // tier that outranks db_bill, and readiness is built on top of it. Nothing tested that the
    // override survives the journey. It has to: an employee who opted out and still holds a valid
    // UAN would otherwise be filed for a contribution they elected not to make, and their
    // identifier being perfectly well-formed is exactly what makes that failure invisible.
    billQuery.mockResolvedValue([{ EmpCode: "MAS010", PFELig: "YES", ESIElig: "YES" }]);
    execute.mockImplementation(async (sql: unknown) => {
      const text = String(sql);
      if (text.includes("employee_statutory_override")) {
        return [[{ employee_code: "MAS010", override_type: "pf_opt_out" }], []];
      }
      if (text.includes("uan_employees")) {
        return [[{
          employee_code: "MAS010",
          uan_employees: "123456789012", uan_statutory_info: null, uan_employee_uan: null,
          esi_employees: "1234567890", esi_statutory_info: null,
        }], []];
      }
      return [[], []];
    });

    const all = await resolveStatutoryFilingReadinessForPeriod("2026-07");
    // PF opted out — not filable, despite a valid UAN on file.
    expect(all.get("MAS010")?.pf.status).toBe("NOT_APPLICABLE");
    expect(all.get("MAS010")?.pf.identifier).toBe("123456789012");
    // ESI untouched by a PF opt-out.
    expect(all.get("MAS010")?.esi.status).toBe("READY");
  });
});

describe("identifiers are read from every store, in precedence order", () => {
  it("falls through to employee_statutory_info when the employees column is empty", async () => {
    // Not cosmetic: employee_statutory_info.esi_number holds 39 active employees that
    // employees.esic_number does not. Reading one column undercounts ESIC coverage by 45.
    billQuery.mockResolvedValue([{ EmpCode: "MAS006", PFELig: "YES", ESIElig: "YES" }]);
    mockIdentifiers([{
      employee_code: "MAS006",
      uan_employees: "", uan_statutory_info: "123456789012", uan_employee_uan: null,
      esi_employees: null, esi_statutory_info: "1234567890",
    }]);
    const all = await resolveStatutoryFilingReadinessForPeriod("2026-07");
    expect(all.get("MAS006")?.pf).toMatchObject({ status: "READY", identifierSource: "employee_statutory_info" });
    expect(all.get("MAS006")?.esi).toMatchObject({ status: "READY", identifierSource: "employee_statutory_info" });
  });

  it("prefers the earlier store and does not merge across stores", async () => {
    billQuery.mockResolvedValue([{ EmpCode: "MAS007", PFELig: "YES", ESIElig: "YES" }]);
    mockIdentifiers([{
      employee_code: "MAS007",
      uan_employees: "111111111111", uan_statutory_info: "222222222222", uan_employee_uan: "333333333333",
      esi_employees: "1111111111", esi_statutory_info: "2222222222",
    }]);
    const all = await resolveStatutoryFilingReadinessForPeriod("2026-07");
    expect(all.get("MAS007")?.pf.identifier).toBe("111111111111");
    expect(all.get("MAS007")?.esi.identifier).toBe("1111111111");
  });

  it("reaches employee_uan only for PF, and only when both earlier stores are empty", async () => {
    billQuery.mockResolvedValue([{ EmpCode: "MAS008", PFELig: "YES", ESIElig: "NO" }]);
    mockIdentifiers([{
      employee_code: "MAS008",
      uan_employees: null, uan_statutory_info: "", uan_employee_uan: "444444444444",
      esi_employees: null, esi_statutory_info: null,
    }]);
    const all = await resolveStatutoryFilingReadinessForPeriod("2026-07");
    expect(all.get("MAS008")?.pf).toMatchObject({ status: "READY", identifierSource: "employee_uan" });
  });
});

describe("it costs two queries, not two per employee", () => {
  it("hits db_bill once regardless of headcount", async () => {
    // db_bill is MySQL 5.5 across the WAN. A per-employee round trip would make a readiness
    // screen over a thousand of them.
    billQuery.mockResolvedValue([
      { EmpCode: "A", PFELig: "YES", ESIElig: "YES" },
      { EmpCode: "B", PFELig: "NO", ESIElig: "NO" },
      { EmpCode: "C", PFELig: "YES", ESIElig: "NO" },
    ]);
    mockIdentifiers([
      { employee_code: "A", uan_employees: "123456789012", esi_employees: "1234567890" },
      { employee_code: "B", uan_employees: null, esi_employees: null },
      { employee_code: "C", uan_employees: null, esi_employees: null },
    ]);
    const all = await resolveStatutoryFilingReadinessForPeriod("2026-07");
    expect(all.size).toBe(3);
    expect(billQuery).toHaveBeenCalledTimes(1);
    // The mas_hrms side is asserted as "one identifier query", not as a total call count — the
    // shared applicability resolver is free to add lookups without that being this test's business.
    const identifierQueries = execute.mock.calls.filter((c) => String(c[0]).includes("uan_employees"));
    expect(identifierQueries).toHaveLength(1);
  });
});

describe("summary counts per scheme", () => {
  it("keeps the five states distinct", () => {
    const mk = (pf: string, esi: string) => ({
      employeeCode: "X",
      pf: { status: pf as never, identifier: null, identifierSource: "none" as const, identifierValid: null },
      esi: { status: esi as never, identifier: null, identifierSource: "none" as const, identifierValid: null },
    });
    const rows = [
      mk("READY", "MISSING_ID"),
      mk("MISSING_ID", "NOT_APPLICABLE"),
      mk("INVALID_ID", "READY"),
      mk("APPLICABILITY_UNRESOLVED", "APPLICABILITY_UNRESOLVED"),
    ];
    expect(summariseFilingReadiness(rows, "pf")).toEqual({ ready: 1, notApplicable: 0, missingId: 1, invalidId: 1, unresolved: 1 });
    expect(summariseFilingReadiness(rows, "esi")).toEqual({ ready: 1, notApplicable: 1, missingId: 1, invalidId: 0, unresolved: 1 });
  });
});
