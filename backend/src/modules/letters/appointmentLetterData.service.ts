/**
 * Resolves the salary breakup printed on an Appointment Letter.
 *
 * The letter prints 17 lines (letters-render.service.ts:172-195). Until now
 * nothing could fill them: letters.service.ts queried
 * `SELECT * FROM employee_salary_assignment ORDER BY effective_date DESC`, but
 * that column is `effective_from`, so the statement threw — and every field it
 * then read (basic_salary, hra, portfolio, bonus, admin_charges, ...) is absent
 * from that table anyway, so all 17 lines would have rendered "0.00".
 *
 * Three real sources exist, in descending fidelity:
 *
 *   1. salary_package_master via salary_component_assignments.package_id
 *      All 17 lines exactly as approved. 295 packages keyed by branch + cost
 *      centre + band; 223 grant a bonus and 224 carry admin charges.
 *
 *   2. salary_component_assignments
 *      What Payroll HR set at hiring, for the ~1,049 employees assigned before
 *      package_id existed. Carries 11 of the 17 lines; it has no bonus,
 *      admin_charges, portfolio, pli, medical or other_allowance column, so
 *      those render 0.00.
 *
 *   3. legacy_payslip_snapshot
 *      db_bill migrants, who genuinely hold Portfolio and Bonus. Only the
 *      ENTITLEMENT columns may be read — gross_earned / net_salary / ctc_monthly
 *      are attendance-prorated (MAS60616 shows gross_earned 5807 against a
 *      gross_salary of 30000, for 6 earned days).
 *
 * Never invents zeros: when no source resolves, issuance is blocked instead.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

export type AppointmentLetterSalary = {
  basic: number;
  hra: number;
  lta: number;
  conveyance: number;
  otherAllowance: number;
  specialAllowance: number;
  bonus: number;
  medicalAllowance: number;
  portfolio: number;
  pli: number;
  gross: number;
  esicEmployee: number;
  epfEmployee: number;
  netSalary: number;
  esicEmployer: number;
  epfEmployer: number;
  adminCharges: number;
  /** Monthly CTC. The letter prints a monthly table. */
  ctc: number;
  /** Which table decided these figures — recorded on the letter for audit. */
  source: "salary_package_master" | "salary_component_assignments" | "legacy_payslip_snapshot";
  sourceRef: string | null;
  pfApplicable: boolean;
  esicApplicable: boolean;
  /** Lines this source cannot supply, so HR can see what is genuinely absent. */
  unavailableLines: string[];
};

export class AppointmentLetterSalaryError extends Error {
  code: string;
  statusCode: number;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.statusCode = 409;
  }
}

const num = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

/** Columns salary_component_assignments simply does not have. */
const ASSIGNMENT_MISSING = [
  "LTA", "Other Allowance", "Bonus", "Medical Allowance", "Portfolio", "PLI", "Admin Charges",
];

async function fromPackage(employeeId: string): Promise<AppointmentLetterSalary | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT p.*, a.pf_applicable, a.esi_applicable
       FROM salary_component_assignments a
       JOIN salary_package_master p ON p.id = a.package_id
      WHERE a.employee_id = ? AND a.status = 'active' AND a.package_id IS NOT NULL
      ORDER BY a.effective_date DESC
      LIMIT 1`,
    [employeeId],
  ).catch(() => [[]] as unknown as [RowDataPacket[]]);
  const p = (rows as RowDataPacket[])[0];
  if (!p) return null;

  return {
    basic: num(p.basic),
    hra: num(p.hra),
    lta: num(p.lta),
    conveyance: num(p.conveyance),
    otherAllowance: num(p.other_allowance),
    specialAllowance: num(p.special_allowance),
    bonus: num(p.bonus),
    medicalAllowance: num(p.medical),
    portfolio: num(p.portfolio),
    pli: num(p.pli),
    gross: num(p.gross),
    esicEmployee: num(p.esic_employee),
    epfEmployee: num(p.epf_employee),
    netSalary: num(p.net_in_hand),
    esicEmployer: num(p.esic_employer),
    epfEmployer: num(p.epf_employer),
    adminCharges: num(p.admin_charges),
    ctc: num(p.ctc),
    source: "salary_package_master",
    sourceRef: String(p.id),
    pfApplicable: num(p.epf_employee) > 0 || Number(p.pf_applicable ?? 0) === 1,
    esicApplicable: num(p.esic_employee) > 0 || Number(p.esi_applicable ?? 0) === 1,
    unavailableLines: [],
  };
}

async function fromAssignment(employeeId: string): Promise<AppointmentLetterSalary | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM salary_component_assignments
      WHERE employee_id = ? AND status = 'active'
      ORDER BY effective_date DESC
      LIMIT 1`,
    [employeeId],
  ).catch(() => [[]] as unknown as [RowDataPacket[]]);
  const a = (rows as RowDataPacket[])[0];
  if (!a) return null;

  const gross = num(a.gross);
  const epfEmp = Number(a.pf_applicable ?? 0) === 1 ? num(a.employer_pf) : 0;

  return {
    basic: num(a.basic),
    hra: num(a.hra),
    lta: 0,
    conveyance: num(a.conveyance),
    otherAllowance: 0,
    specialAllowance: num(a.special_allowance),
    bonus: 0,
    medicalAllowance: 0,
    portfolio: 0,
    pli: 0,
    gross,
    // The employee-side deduction is not stored; only the employer contribution
    // is. Report what exists rather than guessing a deduction.
    esicEmployee: 0,
    epfEmployee: 0,
    netSalary: num(a.net_estimate) || gross,
    esicEmployer: num(a.employer_esi),
    epfEmployer: epfEmp,
    adminCharges: 0,
    ctc: num(a.ctc),
    source: "salary_component_assignments",
    sourceRef: String(a.id),
    pfApplicable: Number(a.pf_applicable ?? 0) === 1,
    esicApplicable: Number(a.esi_applicable ?? 0) === 1,
    unavailableLines: [...ASSIGNMENT_MISSING],
  };
}

async function fromLegacy(employeeId: string): Promise<AppointmentLetterSalary | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM legacy_payslip_snapshot
      WHERE employee_id = ?
      ORDER BY sal_date DESC
      LIMIT 1`,
    [employeeId],
  ).catch(() => [[]] as unknown as [RowDataPacket[]]);
  const l = (rows as RowDataPacket[])[0];
  if (!l) return null;

  // Entitlement columns only. gross_earned / net_salary / ctc_monthly are
  // prorated by attendance and would understate the letter badly.
  const gross = num(l.gross_salary);
  const ctc = num(l.ctc_offered) || gross;

  // pf/esic eligibility lives on the other legacy table, keyed by employee_code.
  let pfApplicable = false;
  let esicApplicable = false;
  const [elig] = await db.execute<RowDataPacket[]>(
    `SELECT pf_eligible, esic_eligible FROM legacy_salary_snapshot
      WHERE employee_code = ? ORDER BY effective_date DESC LIMIT 1`,
    [String(l.employee_code ?? "")],
  ).catch(() => [[]] as unknown as [RowDataPacket[]]);
  const e = (elig as RowDataPacket[])[0];
  if (e) {
    pfApplicable = String(e.pf_eligible ?? "").toUpperCase() === "YES";
    esicApplicable = String(e.esic_eligible ?? "").toUpperCase() === "YES";
  }

  return {
    basic: num(l.basic),
    hra: num(l.hra),
    lta: num(l.lta),
    conveyance: num(l.conveyance),
    otherAllowance: num(l.other_allowance),
    specialAllowance: num(l.special_allowance),
    bonus: num(l.bonus),
    medicalAllowance: num(l.medical_allowance),
    portfolio: num(l.portfolio),
    pli: num(l.pli),
    gross,
    esicEmployee: pfApplicable || esicApplicable ? num(l.esic_employee) : 0,
    epfEmployee: pfApplicable ? num(l.epf_employee) : 0,
    netSalary: gross - (pfApplicable ? num(l.epf_employee) : 0) - (esicApplicable ? num(l.esic_employee) : 0),
    esicEmployer: 0,
    epfEmployer: 0,
    adminCharges: 0,
    ctc,
    source: "legacy_payslip_snapshot",
    sourceRef: String(l.id ?? ""),
    pfApplicable,
    esicApplicable,
    unavailableLines: [],
  };
}

/**
 * Resolve the salary an appointment letter should print.
 * Throws rather than emitting a letter of zeros.
 */
export async function resolveAppointmentLetterSalary(employeeId: string): Promise<AppointmentLetterSalary> {
  const resolved =
    (await fromPackage(employeeId)) ??
    (await fromAssignment(employeeId)) ??
    (await fromLegacy(employeeId));

  if (!resolved) {
    throw new AppointmentLetterSalaryError(
      "salary_not_assigned",
      "No salary is assigned for this employee, so an appointment letter cannot be issued. Assign an approved salary package first.",
    );
  }
  if (resolved.gross <= 0 && resolved.basic <= 0) {
    throw new AppointmentLetterSalaryError(
      "salary_empty",
      `The salary on record (${resolved.source}) has no amounts. Refusing to issue a letter showing zero.`,
    );
  }
  return resolved;
}

/** Shape the renderer expects — string amounts, two decimals. */
export function toLetterRows(s: AppointmentLetterSalary): Record<string, string> {
  const f = (n: number) => n.toFixed(2);
  return {
    basic: f(s.basic),
    hra: f(s.hra),
    lta: f(s.lta),
    conveyance: f(s.conveyance),
    other_allowance: f(s.otherAllowance),
    special_allowance: f(s.specialAllowance),
    bonus: f(s.bonus),
    medical_allowance: f(s.medicalAllowance),
    portfolio: f(s.portfolio),
    pli: f(s.pli),
    gross_salary: f(s.gross),
    esic: f(s.esicEmployee),
    epf: f(s.epfEmployee),
    net_salary: f(s.netSalary),
    employer_esic: f(s.esicEmployer),
    employer_epf: f(s.epfEmployer),
    admin_charges: f(s.adminCharges),
    ctc: f(s.ctc),
  };
}
