import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * generateEcrFile() — the ACTUAL EPFO-submittable file generator (distinct from
 * statutory.executor.ts's pfEcrFormat, a reporting-module browse/export view of the same
 * data). Fixed 2026-08-17, two defects found while wiring Section Q of a go-live checklist:
 *
 * 1. Population + identity source was employee_epf_compliance_profile (6 rows total in
 *    production) joined on pf_applicable=1 AND uan_masked NOT NULL — both wrong. uan_masked
 *    is not a truncated display copy, it NEVER holds the real UAN: epfKycCapture.service.ts's
 *    recordMaskedAudit() writes maskUan(uan) there by explicit design ("Deliberately does not
 *    accept or write the raw values"). Every row the old code emitted carried an unfileable
 *    masked UAN, and the near-empty table meant almost every real PF-deducted employee was
 *    silently absent with no refusal, no error, nothing — the file just looked complete.
 *
 * 2. All 3 pre-existing throws in this function used { status: N } — the errorHandler only
 *    reads statusCode, so all three (Establishment not found / No finalised salary run found /
 *    No employees with PF deducted) were being masked to a generic 500 in production. Fixed
 *    alongside the readiness gate below, which correctly used statusCode from the start.
 *
 * Contribution arithmetic (epf_wages/epf_contri/eps_contri/ncp_days) is UNCHANGED — same
 * salary_prep_line columns, same formulas. Only population and identity source changed.
 */

const ESTABLISHMENT_ID = "est-1";
const RUN_ID = "run-1";
const MONTH = "2026-07";

const { query, execute } = vi.hoisted(() => ({ query: vi.fn(), execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { query, execute } }));

const { resolveUanFilingReadinessForPeriod } = vi.hoisted(() => ({
  resolveUanFilingReadinessForPeriod: vi.fn(),
}));
vi.mock("../pf-applicability.service.js", () => ({ resolveUanFilingReadinessForPeriod }));

const { validateEpfCompliance } = vi.hoisted(() => ({ validateEpfCompliance: vi.fn() }));
vi.mock("../../employees/epfComplianceValidation.service.js", () => ({ validateEpfCompliance }));

const { pfCreationService } = await import("../pf-creation.service.js");

function contributor(code: string, overrides: Partial<Record<string, unknown>> = {}) {
  return {
    employee_code: code,
    member_name: `Employee ${code}`,
    gross_wages: 30000,
    epf_wages: 15000,
    epf_contri: 1800,
    eps_contri: 1250,
    ncp_days: 0,
    ...overrides,
  };
}

function readinessMap(entries: Array<[string, { uan: string | null; uanValid: boolean | null }]>) {
  return new Map(entries.map(([code, v]) => [code, { employeeCode: code, ...v }]));
}

beforeEach(() => {
  query.mockReset();
  execute.mockReset();
  resolveUanFilingReadinessForPeriod.mockReset();
});

function mockLookups(contributors: ReturnType<typeof contributor>[]) {
  query
    .mockResolvedValueOnce([[{ establishment_code: "EST01", establishment_name: "Test Establishment" }]]) // establishment
    .mockResolvedValueOnce([[{ run_id: RUN_ID }]]) // run
    .mockResolvedValueOnce([contributors]); // contributor population
}

describe("generateEcrFile — population and identity", () => {
  it("generates the file with the REAL UAN from the resolver, never a masked value", async () => {
    mockLookups([contributor("MAS001")]);
    resolveUanFilingReadinessForPeriod.mockResolvedValue(
      readinessMap([["MAS001", { uan: "123456789012", uanValid: true }]]),
    );

    const result = await pfCreationService.generateEcrFile(MONTH, ESTABLISHMENT_ID);

    expect(result.content).toContain("123456789012");
    expect(result.employeeCount).toBe(1);
    expect(result.filename).toBe("ECR_EST01_202607.txt");
  });

  it("refuses (ECR_NOT_READY) rather than silently dropping a contributor with no UAN", async () => {
    mockLookups([contributor("MAS001"), contributor("MAS002")]);
    resolveUanFilingReadinessForPeriod.mockResolvedValue(
      readinessMap([
        ["MAS001", { uan: "123456789012", uanValid: true }],
        ["MAS002", { uan: null, uanValid: null }],
      ]),
    );

    await expect(pfCreationService.generateEcrFile(MONTH, ESTABLISHMENT_ID)).rejects.toMatchObject({
      statusCode: 409,
      code: "ECR_NOT_READY",
      blockedEmployees: [{ employee_code: "MAS002", member_name: "Employee MAS002", reason: "MISSING_UAN" }],
    });
  });

  it("refuses on an invalid (non-12-digit) UAN, distinctly from a missing one", async () => {
    mockLookups([contributor("MAS001")]);
    resolveUanFilingReadinessForPeriod.mockResolvedValue(
      readinessMap([["MAS001", { uan: "12345", uanValid: false }]]),
    );

    await expect(pfCreationService.generateEcrFile(MONTH, ESTABLISHMENT_ID)).rejects.toMatchObject({
      statusCode: 409,
      code: "ECR_NOT_READY",
      blockedEmployees: [{ employee_code: "MAS001", reason: "INVALID_UAN" }],
    });
  });

  it("never partially generates — one blocked contributor refuses the whole file, even with 9 clean ones", async () => {
    const clean = Array.from({ length: 9 }, (_, i) => contributor(`MAS0${i}`));
    mockLookups([...clean, contributor("MASBAD")]);
    resolveUanFilingReadinessForPeriod.mockResolvedValue(
      readinessMap([
        ...clean.map((c) => [c.employee_code, { uan: "123456789012", uanValid: true }] as const),
        ["MASBAD", { uan: null, uanValid: null }],
      ]),
    );

    await expect(pfCreationService.generateEcrFile(MONTH, ESTABLISHMENT_ID)).rejects.toMatchObject({
      code: "ECR_NOT_READY",
    });
  });

  it("scopes the population query to PF-deducted ONROLL employees only, matching the register this file must reconcile against", async () => {
    mockLookups([contributor("MAS001")]);
    resolveUanFilingReadinessForPeriod.mockResolvedValue(
      readinessMap([["MAS001", { uan: "123456789012", uanValid: true }]]),
    );

    await pfCreationService.generateEcrFile(MONTH, ESTABLISHMENT_ID);

    const populationCall = query.mock.calls[2];
    expect(String(populationCall[0])).toContain("spl.pf_employee > 0");
    expect(String(populationCall[0])).toContain("e.employment_type = 'ONROLL'");
    expect(String(populationCall[0])).not.toContain("employee_epf_compliance_profile");
  });

  it("does not compute contribution amounts from the compliance-profile table", async () => {
    mockLookups([contributor("MAS001")]);
    resolveUanFilingReadinessForPeriod.mockResolvedValue(
      readinessMap([["MAS001", { uan: "123456789012", uanValid: true }]]),
    );

    await pfCreationService.generateEcrFile(MONTH, ESTABLISHMENT_ID);

    const populationCall = query.mock.calls[2];
    expect(String(populationCall[0])).toContain("spl.pf_employee");
    expect(String(populationCall[0])).toContain("spl.pf_employer");
  });
});

describe("generateEcrFile — statusCode, not status (errorHandler.ts only reads statusCode)", () => {
  it("Establishment not found carries statusCode 404", async () => {
    query.mockResolvedValueOnce([[]]); // no establishment row
    await expect(pfCreationService.generateEcrFile(MONTH, ESTABLISHMENT_ID)).rejects.toMatchObject({
      statusCode: 404,
      message: "Establishment not found",
    });
  });

  it("No finalised salary run found carries statusCode 404", async () => {
    query
      .mockResolvedValueOnce([[{ establishment_code: "EST01", establishment_name: "Test" }]])
      .mockResolvedValueOnce([[]]); // no run row
    await expect(pfCreationService.generateEcrFile(MONTH, ESTABLISHMENT_ID)).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it("No employees with PF deducted carries statusCode 404", async () => {
    query
      .mockResolvedValueOnce([[{ establishment_code: "EST01", establishment_name: "Test" }]])
      .mockResolvedValueOnce([[{ run_id: RUN_ID }]])
      .mockResolvedValueOnce([[]]); // no contributors
    await expect(pfCreationService.generateEcrFile(MONTH, ESTABLISHMENT_ID)).rejects.toMatchObject({
      statusCode: 404,
    });
  });
});
