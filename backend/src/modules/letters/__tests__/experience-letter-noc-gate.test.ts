import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * generateLetter() must gate the "experience" (relieving) letter type on the employee having
 * actually exited, and on the same NOC clearance (noc_case, via nocReleaseStatusForEmployee)
 * that gates F&F release — owner ruling 2026-09-16.
 *
 * Before this gate, letters.service.ts's generateLetter() had NO eligibility check of any kind
 * for ANY letter type: any admin/hr/super_admin could issue an experience letter for a still-
 * active employee, or one whose NOC was never cleared, with manually-typed override values.
 *
 * These tests pin the three behaviours that matter:
 *   1. Employee still active (or no exit date recorded) -> refused, NOC never even consulted.
 *   2. Employee exited but NOC blocked                   -> refused with the NOC reason surfaced.
 *   3. Employee exited and NOC cleared                    -> letter is generated.
 * Plus: a non-"experience" letter type (e.g. "increment") is never subject to either check.
 */

const { dbExecute, nocReleaseStatusMock, letterSalaryRowsMock } = vi.hoisted(() => ({
  dbExecute: vi.fn(),
  nocReleaseStatusMock: vi.fn(),
  letterSalaryRowsMock: vi.fn(),
}));

vi.mock("../../../db/mysql.js", () => ({
  db: { execute: dbExecute, query: dbExecute },
}));
vi.mock("../../payroll/noc-release-gate.service.js", () => ({
  nocReleaseStatusForEmployee: nocReleaseStatusMock,
}));
vi.mock("../appointmentLetterData.service.js", () => ({
  letterSalaryRowsOrBlank: letterSalaryRowsMock,
}));

const TEMPLATE_ID = "tpl-1";
const EMP_ID = "emp-1";

function primeDb(opts: {
  letterType: string;
  employmentStatus: string;
  dateOfExit: string | null;
}) {
  dbExecute.mockReset();
  dbExecute
    // 1. letter_template lookup
    .mockResolvedValueOnce([[{ id: TEMPLATE_ID, letter_type: opts.letterType, template_code: "X" }]])
    // 2. employees + joins lookup
    .mockResolvedValueOnce([[{
      id: EMP_ID, first_name: "Test", last_name: "Employee", full_name: "Test Employee",
      employee_code: "MAS1", employment_status: opts.employmentStatus, date_of_exit: opts.dateOfExit,
      designation_name: null, dept_name: null, branch_name: null, branch_address: "", branch_hr_contact: "",
      date_of_joining: "2020-01-01", epf_number: null, esic_number: null,
    }]])
    // 3. INSERT INTO generated_letter (only reached if not blocked)
    .mockResolvedValueOnce([{ affectedRows: 1 }]);
  letterSalaryRowsMock.mockResolvedValue({ rows: {}, unavailableReason: null });
}

async function loadService() {
  vi.resetModules();
  return import("../letters.service.js");
}

describe("generateLetter — experience letter NOC/exit gate", () => {
  beforeEach(() => {
    nocReleaseStatusMock.mockReset();
  });

  it("refuses an experience letter for a still-active employee, without consulting NOC", async () => {
    const { lettersService } = await loadService();
    primeDb({ letterType: "experience", employmentStatus: "active", dateOfExit: null });

    await expect(
      lettersService.generateLetter({ employee_id: EMP_ID, template_code: "EXPERIENCE_LETTER", generated_by: "u1" }),
    ).rejects.toMatchObject({ statusCode: 409, code: "EXPERIENCE_LETTER_NOT_EXITED" });
    expect(nocReleaseStatusMock).not.toHaveBeenCalled();
  });

  it("refuses an experience letter when NOC clearance is blocked", async () => {
    const { lettersService } = await loadService();
    primeDb({ letterType: "experience", employmentStatus: "inactive", dateOfExit: "2026-09-01" });
    nocReleaseStatusMock.mockResolvedValue({
      blocked: true, reason: "NOC clearance is in progress — not all signatories have responded.",
      caseStatus: "in_progress", hasCase: true, overridden: false,
    });

    await expect(
      lettersService.generateLetter({ employee_id: EMP_ID, template_code: "EXPERIENCE_LETTER", generated_by: "u1" }),
    ).rejects.toMatchObject({ statusCode: 409, code: "EXPERIENCE_LETTER_NOC_BLOCKED" });
    expect(nocReleaseStatusMock).toHaveBeenCalledWith(EMP_ID);
  });

  it("issues the letter once exited and NOC is cleared", async () => {
    const { lettersService } = await loadService();
    primeDb({ letterType: "experience", employmentStatus: "inactive", dateOfExit: "2026-09-01" });
    nocReleaseStatusMock.mockResolvedValue({
      blocked: false, reason: null, caseStatus: "completed", hasCase: true, overridden: false,
    });

    const result = await lettersService.generateLetter({
      employee_id: EMP_ID, template_code: "EXPERIENCE_LETTER", generated_by: "u1",
    });
    expect(result.letter_type).toBe("experience");
  });

  it("never applies the exit/NOC gate to a non-experience letter type", async () => {
    const { lettersService } = await loadService();
    primeDb({ letterType: "increment", employmentStatus: "active", dateOfExit: null });

    const result = await lettersService.generateLetter({
      employee_id: EMP_ID, template_code: "INCREMENT_LETTER", generated_by: "u1",
    });
    expect(result.letter_type).toBe("increment");
    expect(nocReleaseStatusMock).not.toHaveBeenCalled();
  });
});
