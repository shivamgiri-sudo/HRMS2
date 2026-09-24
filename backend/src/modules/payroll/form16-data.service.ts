import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { statutoryRegimeForFinancialYear } from "./statutory-regime.js";
import { loadFlatStatutoryConfig } from "./statutory-config.loader.js";
import { getPartAAvailability } from "./tds-certificate-part-a.service.js";
import { resolvePii } from "../../shared/piiCiphertext.js";

/**
 * Form 16 / Form 130 Part B, computed from the year's actual payroll lines.
 *
 * This is the single source of truth for the salary TDS certificate's Part B
 * figures. It used to live inline in the GET /form16-data route handler in
 * payroll.routes.ts; it was lifted out unchanged so the certificate PDF
 * (form16-certificate.service.ts) renders exactly the same numbers the data
 * modal shows, rather than a third, subtly-different re-derivation.
 *
 * Access control is deliberately NOT here — it stays in the route, which knows
 * the caller. This function only computes, and reports a missing run / line /
 * statutory config as a typed verdict rather than throwing, so a route can map
 * each to the right HTTP status.
 *
 * Part A (tax deposited, challan/BSR, TRACES verification) is issued by TRACES
 * and cannot be produced here; its availability is reported alongside so a
 * caller never presents Part B alone as a whole certificate.
 */

export interface Form16Data {
  financial_year: string;
  period: string;
  part_a: {
    status: "verified" | "awaiting_verification" | "not_uploaded";
    available: boolean;
    certificate_number: string | null;
    vault_document_id: string | null;
    covers_quarters: string | null;
    message: string;
  };
  is_complete: boolean;
  statutory: {
    act: string;
    certificate_form: string;
    certificate_label: string;
    salary_tds_section: string;
    quarterly_return_form: string;
    rebate_section: string;
    period_term: string;
  };
  employee: {
    name: string;
    pan: string | null;
    designation: string | null;
    period: string;
  };
  gross_salary: number;
  standard_deduction: number;
  professional_tax: number;
  tds_deducted: number;
  net_taxable_income: number;
  basis: {
    months_paid: number;
    first_month: string | null;
    last_month: string | null;
    is_partial_year: boolean;
    financial_year_range: string;
  };
  declaration: {
    hra: number;
    "80c": number;
    "80d": number;
    regime: string;
  } | null;
}

export type Form16Result =
  | { ok: true; data: Form16Data }
  | { ok: false; kind: "run_not_found" }
  | { ok: false; kind: "line_not_found" }
  | {
      ok: false;
      kind: "missing_config";
      missingKeys: string[];
      financialYearLabel: string;
    };

/**
 * Compute Part B for one employee in the financial year the given run falls in.
 *
 * `runId` names a payroll run only to (a) resolve which financial year the
 * caller means and (b) confirm the employee actually belonged to that run —
 * the figures themselves are summed across the whole FY, not that one run.
 */
export async function computeForm16Data(
  runId: string,
  employeeId: string,
): Promise<Form16Result> {
  // Load run — resolves the financial year the caller is asking about.
  const [runRows] = await db.execute<RowDataPacket[]>(
    "SELECT run_month FROM salary_prep_run WHERE id = ? LIMIT 1",
    [runId],
  );
  const run = (runRows as Array<{ run_month: string }>)[0];
  if (!run) return { ok: false, kind: "run_not_found" };

  // Existence guard only. The certificate's figures are summed across the whole
  // financial year below; this just confirms the employee actually belongs to
  // the run the caller named, so an arbitrary runId cannot be used to pull a
  // certificate for someone who was never in it.
  const [lineRows] = await db.execute<RowDataPacket[]>(
    `SELECT 1 AS present
       FROM salary_prep_line spl
      WHERE spl.run_id = ? AND spl.employee_id = ? LIMIT 1`,
    [runId, employeeId],
  );
  if ((lineRows as RowDataPacket[]).length === 0) {
    return { ok: false, kind: "line_not_found" };
  }

  // Load employee details. PAN comes from employees (employee_documents is the
  // file store and has no pan_number); a missing PAN renders empty rather than
  // failing the whole request.
  const [empRows] = await db.execute<RowDataPacket[]>(
    `SELECT CONCAT_WS(' ', e.first_name, e.last_name) AS name,
            e.pan_number AS pan, e.pan_number_encrypted,
            dm.designation_name AS designation,
            e.date_of_joining
       FROM employees e
       LEFT JOIN designation_master dm  ON dm.id = e.designation_id
      WHERE e.id = ? LIMIT 1`,
    [employeeId],
  );
  const emp = (
    empRows as Array<{
      name: string;
      pan: string | null;
      pan_number_encrypted: string | null;
      designation: string | null;
      date_of_joining: string | null;
    }>
  )[0];
  if (emp) {
    emp.pan = resolvePii(emp.pan_number_encrypted, emp.pan).value;
  }

  // Derive financial year for declaration lookup.
  const [yr, mo] = run.run_month.split("-").map(Number);
  const fyStart = mo >= 4 ? yr : yr - 1;
  const financialYear = `${fyStart}-${fyStart + 1}`;
  const legacyFinancialYear = `${fyStart}-${String(fyStart + 1).slice(2)}`;

  // Load tax declaration.
  const [declRows] = await db.execute<RowDataPacket[]>(
    `SELECT declared_hra, declared_80c, declared_80d, regime
       FROM tax_declaration
      WHERE employee_id = ? AND financial_year IN (?, ?)
      ORDER BY financial_year = ? DESC
      LIMIT 1`,
    [employeeId, financialYear, legacyFinancialYear, financialYear],
  );
  const decl =
    (
      declRows as Array<{
        declared_hra: number;
        declared_80c: number;
        declared_80d: number;
        regime: string;
      }>
    )[0] ?? null;

  /**
   * Actual amounts paid across the financial year — not one month annualised.
   * Only finalized-type runs count; one canonical line per month (most-progressed
   * status, newest on a tie) so a corrected month is not double-counted.
   */
  const fyFirstMonth = `${fyStart}-04`;
  const fyLastMonth = `${fyStart + 1}-03`;

  const [fyRows] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*)                                   AS months_paid,
            COALESCE(SUM(gross_salary), 0)             AS gross_salary,
            COALESCE(SUM(tds_deducted), 0)             AS tds_deducted,
            COALESCE(SUM(professional_tax), 0)         AS professional_tax,
            COALESCE(SUM(pf_employee), 0)              AS pf_employee,
            MIN(run_month)                             AS first_month,
            MAX(run_month)                             AS last_month
       FROM (
         SELECT spr.run_month,
                spl.gross_salary,
                COALESCE(NULLIF(spl.tds_amount, 0), spl.tds) AS tds_deducted,
                spl.professional_tax,
                spl.pf_employee,
                ROW_NUMBER() OVER (
                  PARTITION BY spr.run_month
                  ORDER BY FIELD(spr.status, 'disbursed', 'finalized', 'locked', 'approved', 'completed'),
                           spr.created_at DESC
                ) AS rn
           FROM salary_prep_line spl
           JOIN salary_prep_run spr ON spr.id = spl.run_id
          WHERE spl.employee_id = ?
            AND spr.run_month BETWEEN ? AND ?
            AND spr.status IN ('locked', 'finalized', 'approved', 'disbursed', 'completed')
            AND spl.status NOT IN ('excluded', 'blocked')
       ) canonical
      WHERE canonical.rn = 1`,
    [employeeId, fyFirstMonth, fyLastMonth],
  );
  const fy = (
    fyRows as Array<{
      months_paid: number;
      gross_salary: number;
      tds_deducted: number;
      professional_tax: number;
      pf_employee: number;
      first_month: string | null;
      last_month: string | null;
    }>
  )[0];

  const grossSalary = Number(fy?.gross_salary ?? 0);
  const tdsDeducted = Number(fy?.tds_deducted ?? 0);
  const professionalTax = Number(fy?.professional_tax ?? 0);
  const monthsPaid = Number(fy?.months_paid ?? 0);

  // Standard deduction resolved for the FY the certificate covers, with no
  // fallback: a guessed figure on a tax document the employee files a return
  // on is not recoverable. Refusing is.
  const fyConfig = await loadFlatStatutoryConfig(`${fyStart}-04-01`);
  const standardDeduction = fyConfig["tds_standard_deduction"];
  if (standardDeduction === undefined) {
    return {
      ok: false,
      kind: "missing_config",
      missingKeys: ["tds_standard_deduction"],
      financialYearLabel: `${fyStart}-${String(fyStart + 1).slice(2)}`,
    };
  }

  // Professional tax is deductible from salary income (s.16(iii)), so it
  // reduces taxable income alongside the standard deduction.
  const totalDeductions =
    standardDeduction +
    professionalTax +
    (decl
      ? Number(decl.declared_hra) +
        Number(decl.declared_80c) +
        Number(decl.declared_80d)
      : 0);
  const netTaxableIncome = Math.max(0, grossSalary - totalDeductions);

  // The Act governing the covered year sets the certificate's name (Form 16 vs
  // Form 130), resolved from the FY covered, never from today's date.
  const regime = statutoryRegimeForFinancialYear(fyStart);

  // Part A comes from TRACES; reported alongside so Part B is never mistaken
  // for a complete certificate.
  const partA = await getPartAAvailability(employeeId, fyStart);

  return {
    ok: true,
    data: {
      financial_year: financialYear,
      period: run.run_month,
      part_a: {
        status: partA.status,
        available: partA.verified,
        certificate_number: partA.certificateNumber,
        vault_document_id: partA.vaultDocumentId,
        covers_quarters: partA.coversQuarters,
        message: partA.message,
      },
      is_complete: partA.verified,
      statutory: {
        act: regime.actName,
        certificate_form: regime.salaryCertificateForm,
        certificate_label: `Form ${regime.salaryCertificateForm}`,
        salary_tds_section: regime.salaryTdsSection,
        quarterly_return_form: regime.quarterlyReturnForm,
        rebate_section: regime.rebateSection,
        period_term: regime.periodTerm,
      },
      employee: {
        name: emp?.name ?? "",
        pan: emp?.pan ?? null,
        designation: emp?.designation ?? null,
        period: `Apr ${fyStart} – Mar ${fyStart + 1}`,
      },
      gross_salary: grossSalary,
      standard_deduction: standardDeduction,
      professional_tax: professionalTax,
      tds_deducted: tdsDeducted,
      net_taxable_income: netTaxableIncome,
      basis: {
        months_paid: monthsPaid,
        first_month: fy?.first_month ?? null,
        last_month: fy?.last_month ?? null,
        is_partial_year: monthsPaid > 0 && monthsPaid < 12,
        financial_year_range: `${fyFirstMonth} to ${fyLastMonth}`,
      },
      declaration: decl
        ? {
            hra: Number(decl.declared_hra),
            "80c": Number(decl.declared_80c),
            "80d": Number(decl.declared_80d),
            regime: decl.regime,
          }
        : null,
    },
  };
}
