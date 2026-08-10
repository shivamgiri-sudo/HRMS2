import type { RowDataPacket } from "mysql2/promise";
import { db } from "../../db/mysql.js";
import { billQuery } from "../../db/billDb.js";
import { env } from "../../config/env.js";
import { salaryVoucherService } from "./salary-voucher.service.js";

/**
 * The salary voucher for a company whose payroll is NOT in mas_hrms — IDC.
 *
 * WHY THIS EXISTS SEPARATELY FROM salary-voucher.service.ts
 * `mas_hrms` holds zero IDC employees. IDC's monthly payroll lives in `db_bill.salary_data`,
 * proven on 2026-08-10 to reconcile to the reference IDC voucher to the rupee
 * (`HEAD OFFICE/IDC/06/26/614` = 1,112,869 net, `NOIDA-DIALDESK/IDC/06/26/615` = 1,348,906). So
 * the ONLY thing the main generator lacked was a line source, not any logic — this file is that
 * source, mapped into the exact shape `buildVouchersFromLines` consumes.
 *
 * IT CROSSES A DATABASE BOUNDARY, AND THAT IS DELIBERATELY OPT-IN.
 * The charter treats `db_bill` as a read-only upstream source and lists live upstream DB access
 * as a hard gate. So this is NOT wired into the default `/vouchers` endpoint. It only runs when
 * called explicitly AND when `BILL_DB_HOST` is configured; an unconfigured environment (which is
 * how most run) never touches db_bill. Reads go through `billQuery`, whose SELECT/SHOW allowlist
 * makes a write impossible from here. Nothing is ever written back to db_bill.
 *
 * The alternative — syncing `salary_data` into `mas_hrms` via a connector — is the more
 * charter-aligned long-term shape and is recorded in DB-BILL-FINDINGS-2026-08-10.md §4. This
 * path is the pragmatic one that works today without moving data.
 */

/** salary_data → the PrepLine shape buildVouchersFromLines consumes. Column names are db_bill's. */
type BillSalaryRow = RowDataPacket & {
  EmpCode: string;
  Branch: string;
  Designation: string | null;
  NetSalary: unknown;
  Gross: unknown;
  EPF: unknown;
  EPFCompany: unknown;
  ESIC: unknown;
  ESICCompany: unknown;
  ProTaxDeduction: unknown;
  IncomeTax: unknown;
  LoanDed: unknown;
  OtherDeduction: unknown;
};

export const billSalaryVoucherService = {
  /** Whether the db_bill path can run at all in this environment. */
  isConfigured(): boolean {
    return Boolean(String(env.BILL_DB_HOST ?? "").trim());
  },

  /**
   * Vouchers for one company sourced from db_bill, for a period (YYYY-MM).
   *
   * `entityPrefix` is the employee-code prefix that identifies the company in salary_data — 'IDC'
   * for iSpark Data Connect. Only rows whose code starts with it are read, so a MAS row can never
   * leak into an IDC voucher and vice versa.
   */
  async generateForPeriod(
    period: string,
    options: { companyCode: string; entityPrefix: string; serialFrom?: number },
  ) {
    if (!this.isConfigured()) {
      throw new Error(
        "db_bill is not configured (BILL_DB_HOST is empty), so IDC payroll cannot be read. "
        + "This voucher is sourced from db_bill, not mas_hrms.",
      );
    }
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
      throw new Error(`Period must be YYYY-MM, received "${period}"`);
    }
    const prefix = String(options.entityPrefix ?? "").trim();
    if (!prefix) throw new Error("An entity prefix (e.g. 'IDC') is required");

    const [year, month] = period.split("-");
    const monthStart = `${year}-${month}-01`;
    const monthEnd = `${year}-${month}-31`;

    // READ-ONLY. billQuery rejects anything that is not SELECT/SHOW. The LIKE prefix is
    // parameterised; only this company's rows come back.
    const rows = await billQuery<BillSalaryRow>(
      `SELECT EmpCode, Branch, Designation, NetSalary, Gross, EPF, EPFCompany,
              ESIC, ESICCompany, ProTaxDeduction, IncomeTax, LoanDed, OtherDeduction
         FROM salary_data
        WHERE SalDate BETWEEN ? AND ?
          AND EmpCode LIKE ?`,
      [monthStart, monthEnd, `${prefix}%`],
    );

    // db_bill has the branch NAME but no branch_id; the voucher buckets by id, and "HEAD OFFICE"
    // exists three times in branch_master. Resolve to the ACTIVE row's id so scope and numbering
    // are deterministic — the same resolution the mas_hrms path gets for free from the FK.
    const branchIdByName = await resolveActiveBranchIds(rows.map((r) => String(r.Branch)));

    const lines = rows.map((r) => {
      const name = String(r.Branch ?? "").trim();
      return {
        employee_code: String(r.EmpCode ?? ""),
        branch_id: branchIdByName.get(name.toUpperCase()) ?? "",
        branch_name: name,
        // salary_data has the designation NAME, which is exactly what the CHIEF% cohort matches
        // on. IDC has no cohort rule anyway, so this is single-column regardless.
        designation_name: r.Designation ?? null,
        employment_type: null,
        net_salary: r.NetSalary,
        gross_salary: r.Gross,
        pf_employee: r.EPF,
        pf_employer: r.EPFCompany,
        esic_employee: r.ESIC,
        esic_employer: r.ESICCompany,
        professional_tax: r.ProTaxDeduction,
        tds: r.IncomeTax,
        loan_emi: r.LoanDed,
        other_deductions: r.OtherDeduction,
      } as RowDataPacket;
    });

    const entityRules = await salaryVoucherService.loadEntityRules();
    const result = await salaryVoucherService.buildVouchersFromLines(
      period,
      lines as never,
      entityRules,
      { companyCode: options.companyCode, serialFrom: options.serialFrom },
    );
    return { ...result, source: "db_bill" as const };
  },
};

/**
 * Active branch_master id for each name, from mas_hrms.
 *
 * Prefers `active_status = 1`, because "HEAD OFFICE" has three rows and only one is live — the
 * same one the mas_hrms voucher lands on. A name with no branch_master row maps to nothing, and
 * that line is then excluded upstream as "no branch" rather than posted to a guess.
 */
async function resolveActiveBranchIds(names: string[]): Promise<Map<string, string>> {
  const wanted = [...new Set(names.map((n) => n.trim().toUpperCase()).filter(Boolean))];
  if (!wanted.length) return new Map();
  const placeholders = wanted.map(() => "?").join(", ");
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, branch_name, active_status
       FROM branch_master
      WHERE UPPER(TRIM(branch_name)) IN (${placeholders})`,
    wanted,
  );
  // Prefer the active row EXPLICITLY, in code, rather than trusting the query's row order — an
  // ORDER BY is a weak guarantee and this decides which branch real money is scoped to. An
  // active id already chosen is never replaced by an inactive one.
  const map = new Map<string, string>();
  const chosenActive = new Set<string>();
  for (const row of rows as RowDataPacket[]) {
    const key = String(row.branch_name ?? "").trim().toUpperCase();
    const isActive = Number(row.active_status) === 1;
    if (!map.has(key) || (isActive && !chosenActive.has(key))) {
      map.set(key, String(row.id));
      if (isActive) chosenActive.add(key);
    }
  }
  return map;
}
