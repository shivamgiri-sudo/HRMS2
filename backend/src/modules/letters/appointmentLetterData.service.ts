/**
 * Resolves the salary breakup printed on an Appointment Letter.
 *
 * There is exactly ONE admissible source: the salary package the **Payroll Head
 * approved** for this employee, i.e.
 *
 *   employee_payroll_head_review (status = 'approved' AND package_accepted = 1)
 *     -> salary_package_id -> salary_package_master
 *
 * Nothing else may reach a letter. That is a deliberate narrowing, decided
 * 2026-09-08, and the reason is worth stating because the wider version looked
 * harmless:
 *
 *   The previous chain was salary_package_master (via
 *   salary_component_assignments.package_id) -> salary_component_assignments ->
 *   legacy_payslip_snapshot, and **none of those three consults the Payroll Head
 *   review at all**. Measured live on 2026-09-08: 264 active, non-legacy
 *   employees hold an `active` salary_component_assignments row with no approved
 *   review — 23 of them still `pending_review` and one outright `rejected`.
 *   Every one of those would have been printed onto a digitally signed letter
 *   and emailed to the employee as their agreed remuneration. A rejected salary
 *   emailed under the company signature is not a formatting defect; it is a
 *   commitment the company never made.
 *
 * salary_component_assignments is still read, but only for the PF/ESIC
 * applicability flags on the row that carries the approved package_id — never
 * for amounts. It cannot become an amount source again by accident: those two
 * flags are the only fields taken from it.
 *
 * Never invents zeros, and never degrades to a lesser source: when no approved
 * package resolves, issuance is blocked with the specific reason, so HR is sent
 * to the Payroll Head review queue rather than to a letter full of guesses.
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
  /**
   * Which table decided these figures — recorded on the letter for audit.
   * One value, because there is one admissible source. It stays a union rather
   * than a bare string so widening it later is a visible type change, not a
   * silent one.
   */
  source: "payroll_head_approved_package";
  /** The salary_package_master.id the Payroll Head signed off. */
  sourceRef: string | null;
  /** Who approved it and when. Printed nowhere; stored on the letter for audit. */
  approvedBy: string | null;
  approvedAt: Date | null;
  packageEffectiveFrom: Date | null;
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

const asDate = (v: unknown): Date | null => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
};

/**
 * The Payroll-Head-approved package, or null.
 *
 * employee_payroll_head_review carries UNIQUE KEY uq_ephr_employee (employee_id),
 * so there is at most one review per employee and no ORDER BY is needed to make
 * this deterministic.
 *
 * The join to salary_component_assignments is LEFT and pinned to the SAME
 * package_id the Payroll Head accepted: a row for some other package must not
 * lend its PF/ESIC flags to this one. No matching row at all is fine — the
 * package's own epf_employee/esic_employee amounts then decide applicability.
 */
async function fromApprovedPackage(employeeId: string): Promise<AppointmentLetterSalary | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT p.*,
            a.pf_applicable, a.esi_applicable,
            r.package_effective_from, r.reviewed_by, r.reviewed_at
       FROM employee_payroll_head_review r
       JOIN salary_package_master p ON p.id = r.salary_package_id
       LEFT JOIN salary_component_assignments a
              ON a.employee_id = r.employee_id
             AND a.status = 'active'
             AND a.package_id = r.salary_package_id
      WHERE r.employee_id = ?
        AND r.status = 'approved'
        AND r.package_accepted = 1
        AND r.salary_package_id IS NOT NULL
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
    source: "payroll_head_approved_package",
    sourceRef: String(p.id),
    approvedBy: p.reviewed_by ? String(p.reviewed_by) : null,
    approvedAt: asDate(p.reviewed_at),
    packageEffectiveFrom: asDate(p.package_effective_from),
    pfApplicable: num(p.epf_employee) > 0 || Number(p.pf_applicable ?? 0) === 1,
    esicApplicable: num(p.esic_employee) > 0 || Number(p.esi_applicable ?? 0) === 1,
    unavailableLines: [],
  };
}

/**
 * Why no approved package resolved.
 *
 * One blanket "salary not approved" message would send HR to the wrong screen
 * half the time — "the Payroll Head has not reviewed this employee yet" and
 * "the Payroll Head rejected this salary" call for opposite actions. So the
 * failure is diagnosed against the review row rather than collapsed into a
 * single condition.
 */
async function diagnoseMissingApproval(employeeId: string): Promise<AppointmentLetterSalaryError> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT status, package_accepted, salary_package_id, rejection_remarks
       FROM employee_payroll_head_review WHERE employee_id = ? LIMIT 1`,
    [employeeId],
  ).catch(() => [[]] as unknown as [RowDataPacket[]]);
  const r = (rows as RowDataPacket[])[0];

  if (!r) {
    return new AppointmentLetterSalaryError(
      "salary_not_reviewed",
      "This employee has no Payroll Head salary review, so there is no approved salary to print. " +
        "Complete the review in Payroll -> Salary Review first.",
    );
  }
  const status = String(r.status ?? "");
  if (status === "rejected") {
    return new AppointmentLetterSalaryError(
      "salary_review_rejected",
      "The Payroll Head rejected this employee's salary review" +
        (r.rejection_remarks ? ` (${String(r.rejection_remarks)})` : "") +
        ". No appointment letter can be issued until it is corrected and re-approved.",
    );
  }
  if (status !== "approved") {
    return new AppointmentLetterSalaryError(
      "salary_not_approved",
      `The Payroll Head salary review for this employee is "${status || "pending"}", not approved. ` +
        "The letter prints the approved salary, so it cannot be issued yet.",
    );
  }
  if (Number(r.package_accepted ?? 0) !== 1) {
    return new AppointmentLetterSalaryError(
      "salary_package_not_accepted",
      "The Payroll Head review is approved but the salary package was never accepted on it, " +
        "so there is no signed-off breakup to print.",
    );
  }
  return new AppointmentLetterSalaryError(
    "salary_package_missing",
    "The Payroll Head review is approved but carries no salary package, so the letter's " +
      "remuneration table cannot be produced. Assign the approved package on the review.",
  );
}

/**
 * Resolve the salary an appointment letter should print.
 *
 * Throws rather than emitting a letter of zeros, and throws rather than falling
 * back to an unapproved source. Both are the same principle: the letter states
 * what the company committed to, so a figure nobody approved must never appear
 * on one.
 */
export async function resolveAppointmentLetterSalary(employeeId: string): Promise<AppointmentLetterSalary> {
  const resolved = await fromApprovedPackage(employeeId);
  if (!resolved) throw await diagnoseMissingApproval(employeeId);

  if (resolved.gross <= 0 && resolved.basic <= 0) {
    throw new AppointmentLetterSalaryError(
      "salary_empty",
      `The Payroll-Head-approved package (${resolved.sourceRef}) carries no amounts. ` +
        "Refusing to issue a letter showing zero.",
    );
  }
  return resolved;
}

/** Every salary variable the Handlebars letter templates can reference. */
const LETTER_SALARY_KEYS = [
  "basic", "hra", "lta", "conveyance", "other_allowance", "special_allowance",
  "bonus", "medical_allowance", "portfolio", "pli", "gross_salary", "esic",
  "epf", "net_salary", "employer_esic", "employer_epf", "admin_charges", "ctc",
] as const;

/**
 * Salary rows for the GENERIC letter generator, which must not be taken down by
 * this module's strictness.
 *
 * letters.service.ts and letters.routes.ts render whatever letter_template the
 * caller picked — live, that is `offer`, `confirmation` and `experience`, none
 * of which is the appointment letter and two of which do not print a salary at
 * all. They called resolveAppointmentLetterSalary() unconditionally, so once
 * that function became "Payroll-Head-approved package or throw", generating an
 * experience letter for someone with no review row would have started failing
 * outright. That would be a regression introduced by tightening a rule that was
 * never about those letters.
 *
 * So: the approved package if there is one, otherwise BLANK strings and the
 * reason. Blank, not zero — a template that does print a salary then renders
 * visibly empty rather than confidently stating "0.00", and a template that
 * does not print one is unaffected. An unapproved figure is still never
 * substituted, which is the whole point of the narrowing.
 */
export async function letterSalaryRowsOrBlank(
  employeeId: string,
): Promise<{ rows: Record<string, string>; unavailableReason: string | null }> {
  try {
    return { rows: toLetterRows(await resolveAppointmentLetterSalary(employeeId)), unavailableReason: null };
  } catch (err) {
    const rows: Record<string, string> = {};
    for (const k of LETTER_SALARY_KEYS) rows[k] = "";
    return { rows, unavailableReason: err instanceof Error ? err.message : "Salary unavailable" };
  }
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
