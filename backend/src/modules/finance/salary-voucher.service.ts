import type { RowDataPacket } from "mysql2/promise";
import { db } from "../../db/mysql.js";

/**
 * Payroll → Tally salary voucher.
 *
 * Produces, for one payroll run, one journal voucher per (legal entity × branch), in the exact
 * shape of the reference files supplied by Finance.
 *
 * THE VOUCHER IS BUILT FROM THE CREDIT SIDE, AND GROSS IS THE PLUG.
 * This is the single most important thing in this file and it is not obvious. `Gross Salary` in
 * the reference vouchers is NOT payroll gross — it is the balancing figure:
 *
 *     Gross Salary = (all credits) − (the three employer debits)
 *
 * Verified on all four MAS branches of the June-2026 voucher, where it holds to the rupee and
 * every voucher balances exactly. Taking payroll's own `gross_salary` instead produces a
 * voucher that does NOT balance — at HEAD OFFICE it is out by 1,167 — and an unbalanced journal
 * is rejected by Tally on import. Constructing it as the plug makes balance a property of the
 * output rather than something to hope for.
 *
 * Payroll gross is still reported, as `payroll_gross`, precisely so the difference is visible
 * rather than silently absorbed. A large gap means the component mapping is wrong and somebody
 * needs to look; hiding it would let a wrong voucher post quietly.
 *
 * THE COHORT SPLIT
 * A MAS voucher reports each line as `amount = column[0] + column[1]`, where column 1 is C-suite
 * remuneration. IDC reports a single amount. That difference is configuration
 * (finance_payroll_voucher_cohort), not a branch in the code, because the C-suite changes and a
 * hardcoded pair of employee codes would go wrong silently — the voucher would still balance,
 * it would just put a director's pay in the staff column.
 *
 * NOTHING HERE RECALCULATES PAYROLL. Every figure is an aggregate of salary_prep_line as it
 * already stands. Payroll arithmetic is read-only.
 */

/** Money is summed in paise. Rupee floats do not survive 1,400 additions. */
const toPaise = (value: unknown) => Math.round(Number(value ?? 0) * 100);
const toRupees = (paise: number) => paise / 100;

export type VoucherLine = {
  ledger_name: string;
  debit_credit: "D" | "C";
  /** Total for the line — always the sum of `columns`. */
  amount: number;
  /** [everyone else, cohort 1, cohort 2, …]. Length 1 when the company has no cohort rules. */
  columns: number[];
  /** Set only on the per-employee advance rows, which are never consolidated. */
  employee_code?: string;
};

export type Voucher = {
  voucher_no: string;
  company_code: string;
  branch_id: string;
  branch_name: string;
  cost_category: string;
  cost_centre: string;
  voucher_type: string;
  date: string;
  narration: string;
  cohort_labels: string[];
  lines: VoucherLine[];
  totals: { debit: number; credit: number; balanced: boolean };
  /** Payroll's own gross, for comparison against the derived Gross Salary line. */
  payroll_gross: number;
  employees: number;
};

type CohortRule = {
  cohort_key: string;
  label: string;
  designation_pattern: string | null;
  employment_type: string | null;
  employee_code_prefix: string | null;
  column_index: number;
  priority: number;
};

/**
 * Branch short codes as the reference vouchers spell them (AHM/2606, HO/2606, NOIDA-DD/2606).
 *
 * A lookup rather than an algorithm: "NOIDA-DIALDESK" → "NOIDA-DD" and "HEAD OFFICE" → "HO"
 * follow no rule that also produces "NOIDA-2" → "NOIDA-2". An unknown branch falls back to its
 * own name, which is wrong-but-visible rather than wrong-and-plausible.
 */
const BRANCH_SHORT_CODE: Record<string, string> = {
  "HEAD OFFICE": "HO",
  "AHMEDABAD-JALDARSHAN": "AHM",
  "NOIDA": "NOIDA",
  "NOIDA-2": "NOIDA-2",
  "NOIDA-DIALDESK": "NOIDA-DD",
};

export function branchShortCode(branchName: string): string {
  return BRANCH_SHORT_CODE[branchName.trim().toUpperCase()] ?? branchName.trim();
}

/** `AHM/2606` — short code and the period as YYMM. */
export function costCentreLabel(branchName: string, period: string): string {
  const [year, month] = period.split("-");
  return `${branchShortCode(branchName)}/${year.slice(-2)}${month}`;
}

/** `HEAD OFFICE/MAS/06/26/614` — the serial is allocated by the caller. */
export function voucherNumber(branchName: string, companyCode: string, period: string, serial: number): string {
  const [year, month] = period.split("-");
  return `${branchName.trim().toUpperCase()}/${companyCode}/${month}/${year.slice(-2)}/${serial}`;
}

/**
 * EPF administration charges.
 *
 * One twelfth of the employer contribution, rounded PER EMPLOYEE to a WHOLE RUPEE and then
 * summed. Employer PF is 12% of PF wages and admin is 1% of the same wages, so the ratio is
 * exact; the only choices are where to round and when.
 *
 * Both choices are load-bearing and were settled against the real 16-employee HEAD OFFICE
 * population, not derived:
 *
 *   per employee, whole rupee  ->  1,400 + 3,519 = 4,919   the reference voucher
 *   rounding the branch total  ->  4,920                    off by one
 *   keeping paise             ->  1,400.00 + 3,519.50      a fractional rupee Tally will not take
 *
 * Rounding is not distributive, so this must stay inside the per-employee loop. Summing employer
 * PF first and dividing once gives a different answer.
 */
export function epfAdminCharge(pfEmployerPaise: number): number {
  return Math.round(pfEmployerPaise / 12 / 100) * 100;
}

async function loadCohortRules(companyCode: string): Promise<CohortRule[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT cohort_key, label, designation_pattern, employment_type,
            employee_code_prefix, column_index, priority
       FROM finance_payroll_voucher_cohort
      WHERE company_code = ? AND active_status = 1
      ORDER BY column_index, priority DESC`,
    [companyCode],
  );
  return rows as CohortRule[];
}

/**
 * Which column an employee's figures belong in.
 *
 * Highest priority wins, and no match means column 0 — the remainder. A cohort with no matchers
 * at all matches NOBODY rather than everybody: an unconfigured cohort silently swallowing the
 * whole payroll is the worse failure.
 */
function columnFor(
  employee: { designation_name?: string | null; employment_type?: string | null; employee_code?: string | null },
  rules: CohortRule[],
): number {
  let best: CohortRule | null = null;
  for (const rule of rules) {
    const matchers = [rule.designation_pattern, rule.employment_type, rule.employee_code_prefix]
      .filter((m) => m != null && String(m).trim() !== "");
    if (!matchers.length) continue;

    if (rule.designation_pattern) {
      const pattern = rule.designation_pattern.replace(/%/g, "").toUpperCase();
      const designation = String(employee.designation_name ?? "").toUpperCase();
      if (!pattern || !designation.startsWith(pattern)) continue;
    }
    if (rule.employment_type
        && String(employee.employment_type ?? "").toUpperCase() !== rule.employment_type.toUpperCase()) continue;
    if (rule.employee_code_prefix
        && !String(employee.employee_code ?? "").toUpperCase().startsWith(rule.employee_code_prefix.toUpperCase())) continue;

    if (!best || rule.priority > best.priority) best = rule;
  }
  return best ? best.column_index : 0;
}

type PrepLine = RowDataPacket & {
  employee_code: string;
  branch_id: string;
  branch_name: string;
  designation_name: string | null;
  employment_type: string | null;
  net_salary: unknown;
  gross_salary: unknown;
  pf_employee: unknown;
  pf_employer: unknown;
  esic_employee: unknown;
  esic_employer: unknown;
  professional_tax: unknown;
  tds: unknown;
  loan_emi: unknown;
  other_deductions: unknown;
};

export const salaryVoucherService = {
  /**
   * Builds every voucher for a run.
   *
   * One voucher per (entity × branch). An employee whose code matches no entity rule is
   * EXCLUDED and reported in `unassigned` rather than defaulted — putting an unidentifiable
   * salary into MasCallnet's books because it was the first rule in the table is exactly the
   * failure 1098 refused to risk by shipping empty.
   */
  async generate(runId: string, options: { companyCode?: string; serialFrom?: number } = {}) {
    const [runRows] = await db.execute<RowDataPacket[]>(
      // run_month is already 'YYYY-MM'; the run table has no separate month/year columns.
      `SELECT id, run_month FROM salary_prep_run WHERE id = ? LIMIT 1`,
      [runId],
    );
    if (!runRows[0]) throw new Error("Payroll run not found");
    const period = String(runRows[0].run_month ?? "").trim();
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
      throw new Error(`Payroll run ${runId} has no usable period (run_month = "${period}")`);
    }

    const [entityRules] = await db.execute<RowDataPacket[]>(
      `SELECT company_code, employee_code_prefix, employment_type, branch_id, priority
         FROM finance_payroll_entity_rule
        WHERE active_status = 1
        ORDER BY priority DESC`,
    );
    if (!entityRules.length) {
      throw new Error(
        "No payroll entity rule is configured, so the legal entity of each salary cannot be "
        + "determined. Refusing to generate rather than defaulting everyone to one company.",
      );
    }

    const [lines] = await db.execute<RowDataPacket[]>(
      `SELECT l.employee_code, e.branch_id, bm.branch_name,
              dm.designation_name, e.employment_type,
              l.net_salary, l.gross_salary, l.pf_employee, l.pf_employer,
              l.esic_employee, l.esic_employer, l.professional_tax,
              COALESCE(l.tds_amount, l.tds) AS tds, l.loan_emi, l.other_deductions
         FROM salary_prep_line l
         JOIN employees e ON e.id = l.employee_id
         LEFT JOIN branch_master bm ON bm.id = e.branch_id
         LEFT JOIN designation_master dm ON dm.id = e.designation_id
        WHERE l.run_id = ?`,
      [runId],
    );

    const entityOf = (code: string): string | null => {
      for (const rule of entityRules as RowDataPacket[]) {
        const prefix = String(rule.employee_code_prefix ?? "");
        if (!prefix) continue;
        if (String(code ?? "").toUpperCase().startsWith(prefix.toUpperCase())) {
          return String(rule.company_code);
        }
      }
      return null;
    };

    const cohortCache = new Map<string, CohortRule[]>();
    const buckets = new Map<string, { company: string; branchId: string; branchName: string; rows: PrepLine[] }>();
    const unassigned: string[] = [];
    const unpaid: string[] = [];

    for (const raw of lines as PrepLine[]) {
      const company = entityOf(raw.employee_code);
      if (!company || (options.companyCode && company !== options.companyCode)) {
        if (!company) unassigned.push(raw.employee_code);
        continue;
      }
      const branchName = String(raw.branch_name ?? "").trim();
      const branchId = String(raw.branch_id ?? "").trim();
      // A payroll line with no branch cannot be posted to a cost centre, and inventing one
      // would put real money against the wrong branch. Reported, not guessed.
      if (!branchName || !branchId) { unassigned.push(raw.employee_code); continue; }

      // An employee who was not paid contributes nothing to the voucher.
      //
      // This is not a tidy-up: HEAD OFFICE carries three inactive employees whose gross and net
      // are both zero but who still hold a 200 professional-tax figure. Including them adds 600
      // to the Professional Tax credit, which pushes the derived Gross Salary to 1,190,013
      // against the reference's 1,189,413. The reference voucher shows Professional Tax as 0
      // for this branch, so it excludes them, and so does this.
      const paid = toPaise(raw.gross_salary) !== 0 || toPaise(raw.net_salary) !== 0;
      if (!paid) { unpaid.push(raw.employee_code); continue; }
      // Bucketed by branch ID, never by branch NAME.
      //
      // branch_master contains "HEAD OFFICE" THREE times under three different ids (plus a
      // "Head Office"), and two of those ids carry MAS payroll in the June-2026 run. Keying by
      // name merges them into one voucher whose branch_id is then whichever row the database
      // happened to return first — and that id is exactly what the API scopes on. The result is
      // non-deterministic: a finance user entitled to one of the ids could be denied their own
      // branch's voucher while being shown one full of the other's money.
      //
      // Keying by id makes each branch_master row its own voucher, which is also the honest
      // answer: as far as every other table is concerned they ARE separate branches. Merging
      // duplicate spellings is a master-data decision, not one to take inside a voucher
      // generator. The duplicates are listed in docs/finance/OPEN-QUESTIONS.md.
      const key = `${company}|${branchId}`;
      if (!buckets.has(key)) {
        buckets.set(key, { company, branchId, branchName, rows: [] });
      }
      buckets.get(key)!.rows.push(raw);
    }

    const vouchers: Voucher[] = [];
    let serial = options.serialFrom ?? 1;
    for (const bucket of [...buckets.values()].sort(
      (a, b) => a.company.localeCompare(b.company)
        || a.branchName.localeCompare(b.branchName)
        // Two branch rows can share a name, so the id is the tie-break that keeps serial
        // allocation stable between runs.
        || a.branchId.localeCompare(b.branchId),
    )) {
      if (!cohortCache.has(bucket.company)) {
        cohortCache.set(bucket.company, await loadCohortRules(bucket.company));
      }
      vouchers.push(
        buildVoucher(bucket, cohortCache.get(bucket.company)!, period, serial++),
      );
    }

    return {
      period,
      vouchers,
      // Deduplicated: one line per employee, however many payroll rows they had.
      unassigned: [...new Set(unassigned)],
      // Reported rather than silently dropped, so "16 employees, 13 on the voucher" is a
      // visible fact instead of a discrepancy someone has to chase.
      unpaid: [...new Set(unpaid)],
    };
  },

  branchShortCode,
  costCentreLabel,
  voucherNumber,
  epfAdminCharge,
};

/** Sums one bucket into the reference voucher's ledger lines, in the reference order. */
function buildVoucher(
  bucket: { company: string; branchId: string; branchName: string; rows: PrepLine[] },
  cohorts: CohortRule[],
  period: string,
  serial: number,
): Voucher {
  const columnCount = 1 + cohorts.reduce((max, c) => Math.max(max, c.column_index), 0);
  const zero = () => Array.from({ length: columnCount }, () => 0);

  const acc = {
    net: zero(), pfEmployee: zero(), pfEmployer: zero(), esicEmployee: zero(),
    esicEmployer: zero(), professionalTax: zero(), tds: zero(), otherDeductions: zero(),
    epfAdmin: zero(), payrollGross: 0,
  };
  const advances: { employee_code: string; column: number; paise: number }[] = [];

  for (const row of bucket.rows) {
    const column = columnFor(row, cohorts);
    acc.net[column] += toPaise(row.net_salary);
    acc.pfEmployee[column] += toPaise(row.pf_employee);
    acc.pfEmployer[column] += toPaise(row.pf_employer);
    acc.esicEmployee[column] += toPaise(row.esic_employee);
    acc.esicEmployer[column] += toPaise(row.esic_employer);
    acc.professionalTax[column] += toPaise(row.professional_tax);
    acc.tds[column] += toPaise(row.tds);
    acc.otherDeductions[column] += toPaise(row.other_deductions);
    // Rounded per employee, then summed — see epfAdminCharge().
    acc.epfAdmin[column] += epfAdminCharge(toPaise(row.pf_employer));
    acc.payrollGross += toPaise(row.gross_salary);

    const advance = toPaise(row.loan_emi);
    // One row per employee, never consolidated: the reference voucher shows three separate
    // 5,000 lines at HEAD OFFICE rather than a single 15,000.
    if (advance > 0) advances.push({ employee_code: row.employee_code, column, paise: advance });
  }

  const add = (a: number[], b: number[]) => a.map((v, i) => v + b[i]);
  const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);

  const epfPayable = add(add(acc.pfEmployee, acc.pfEmployer), acc.epfAdmin);
  const esicPayable = add(acc.esicEmployee, acc.esicEmployer);

  const credits: { ledger_name: string; columns: number[]; employee_code?: string }[] = [
    { ledger_name: "Salary Payable A/C", columns: acc.net },
    { ledger_name: "ESIC Payable", columns: esicPayable },
    { ledger_name: "EPF Payable", columns: epfPayable },
    ...advances.map((a) => ({
      ledger_name: `Advance Against Salary (${bucket.branchName})`,
      columns: zero().map((_, i) => (i === a.column ? a.paise : 0)),
      employee_code: a.employee_code,
    })),
    { ledger_name: "STAY HEALTHY STAY HAPPY INSURANCE", columns: zero() },
    // Distinct from the debit-side "Gross Salary" — different ledger, deliberately. Carries
    // miscellaneous recoveries (833 at Ahmedabad in the reference).
    { ledger_name: "GROSS SALARY", columns: acc.otherDeductions },
    { ledger_name: `Professional Tax ${financialYearLabel(period)}`, columns: acc.professionalTax },
    { ledger_name: `TDS SALARY ${financialYearLabel(period)}`, columns: acc.tds },
  ];

  const otherDebits = [
    { ledger_name: "Employer's Contribution to Esic", columns: acc.esicEmployer },
    { ledger_name: "Employer's Contribution to Epf", columns: acc.pfEmployer },
    { ledger_name: "EPF Admin Charges", columns: acc.epfAdmin },
  ];

  // Gross is the plug. Computed per column so the columns still sum to the line total.
  const grossColumns = zero().map((_, i) =>
    credits.reduce((s, c) => s + c.columns[i], 0) - otherDebits.reduce((s, d) => s + d.columns[i], 0));

  const toLine = (
    entry: { ledger_name: string; columns: number[]; employee_code?: string },
    dc: "D" | "C",
  ): VoucherLine => ({
    ledger_name: entry.ledger_name,
    debit_credit: dc,
    amount: toRupees(sum(entry.columns)),
    columns: entry.columns.map(toRupees),
    ...(entry.employee_code ? { employee_code: entry.employee_code } : {}),
  });

  const lines: VoucherLine[] = [
    toLine({ ledger_name: "Gross Salary", columns: grossColumns }, "D"),
    ...otherDebits.map((d) => toLine(d, "D")),
    ...credits.map((c) => toLine(c, "C")),
  ];

  const debit = lines.filter((l) => l.debit_credit === "D").reduce((s, l) => s + toPaise(l.amount), 0);
  const credit = lines.filter((l) => l.debit_credit === "C").reduce((s, l) => s + toPaise(l.amount), 0);

  return {
    voucher_no: voucherNumber(bucket.branchName, bucket.company, period, serial),
    company_code: bucket.company,
    branch_id: bucket.branchId,
    branch_name: bucket.branchName,
    cost_category: bucket.branchName,
    cost_centre: costCentreLabel(bucket.branchName, period),
    voucher_type: "JRNLSAL",
    date: lastDayOf(period),
    narration: `Salary ${monthLabel(period)} Month`,
    cohort_labels: ["Staff", ...cohorts.sort((a, b) => a.column_index - b.column_index).map((c) => c.label)],
    lines,
    totals: { debit: toRupees(debit), credit: toRupees(credit), balanced: debit === credit },
    payroll_gross: toRupees(acc.payrollGross),
    employees: bucket.rows.length,
  };
}

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function monthLabel(period: string) { return MONTHS[Number(period.split("-")[1]) - 1]; }

/** `2026-27` — the ledger names carry the financial year, and April starts it. */
function financialYearLabel(period: string): string {
  const [year, month] = period.split("-").map(Number);
  return month >= 4 ? `${year}-${String(year + 1).slice(-2)}` : `${year - 1}-${String(year).slice(-2)}`;
}

function lastDayOf(period: string): string {
  const [year, month] = period.split("-").map(Number);
  return `${year}-${String(month).padStart(2, "0")}-${new Date(year, month, 0).getDate()}`;
}
