import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Payroll → Tally salary voucher.
 *
 * The reference is the supplied `MAS SALARY VCH JUNE - 2026.xls`, and HEAD OFFICE is the branch
 * that reconciles exactly against the June-2026 run — so the fixture below is that branch's real
 * payroll shape, and the expectations are that voucher's real figures. Nothing here is invented.
 *
 * Three properties carry the whole design:
 *
 *   1. THE VOUCHER BALANCES BY CONSTRUCTION. `Gross Salary` is the plug — credits minus the
 *      three employer debits — not payroll gross. Using payroll gross produces a voucher that is
 *      out by 1,167 at HEAD OFFICE, and Tally rejects an unbalanced journal on import.
 *   2. THE COLUMNS SUM TO THE LINE. `amount = columns[0] + columns[1]` on every line, which is
 *      the invariant the reference file satisfies on every one of its rows.
 *   3. AN UNIDENTIFIABLE SALARY IS EXCLUDED, NEVER DEFAULTED. Putting a salary whose entity is
 *      unknown into MasCallnet's books because MAS happened to sort first is the exact failure
 *      migration 1098 refused to risk by shipping its rule table empty.
 */

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));

let svc: typeof import("../salary-voucher.service.js");
beforeAll(async () => {
  svc = await import("../salary-voucher.service.js");
}, 120_000);

beforeEach(() => execute.mockReset());

/**
 * HEAD OFFICE, June 2026 — the real sixteen rows of `salary_prep_line`, unedited.
 *
 * A real population rather than an aggregate, because two things here are not distributive and
 * an aggregate fixture would quietly prove the wrong thing:
 *
 *   - EPF admin is rounded per employee, so fifteen staff rows do not round like one row
 *     carrying their total (3,519 against 3,520);
 *   - advances are one line per employee, so the count only appears with real rows.
 *
 * Note MAS00183 is CHAIRMAN and MAS59445 is VICE PRESIDENT — neither matches `CHIEF%`, and the
 * reference voucher agrees: its second column is 166,262, which is the CEO's gross alone.
 */
const HEAD_OFFICE = [
  { employee_code: "MAS59445", designation_name: "VICE PRESIDENT", employment_type: "ONROLL", branch_id: "br-ho", branch_name: "HEAD OFFICE",
    net_salary: 222307, gross_salary: 266667, pf_employee: 0, pf_employer: 0,
    esic_employee: 0, esic_employer: 0, professional_tax: 0, tds: 44360, loan_emi: 0, other_deductions: 0 },
  { employee_code: "MAS00001", designation_name: "CHIEF EXECUTIVE OFFICER", employment_type: "ONROLL", branch_id: "br-ho", branch_name: "HEAD OFFICE",
    net_salary: 133462, gross_salary: 166262, pf_employee: 16800, pf_employer: 16800,
    esic_employee: 0, esic_employer: 0, professional_tax: 0, tds: 16000, loan_emi: 0, other_deductions: 0 },
  { employee_code: "MAS38964", designation_name: "DY. GENERAL MANAGER", employment_type: "ONROLL", branch_id: "br-ho", branch_name: "HEAD OFFICE",
    net_salary: 109088, gross_salary: 124368, pf_employee: 6480, pf_employer: 6480,
    esic_employee: 0, esic_employer: 0, professional_tax: 0, tds: 8800, loan_emi: 0, other_deductions: 0 },
  { employee_code: "MAS47905", designation_name: "SR. MANAGER", employment_type: "ONROLL", branch_id: "br-ho", branch_name: "HEAD OFFICE",
    net_salary: 107812, gross_salary: 124184, pf_employee: 6672, pf_employer: 6672,
    esic_employee: 0, esic_employer: 0, professional_tax: 0, tds: 9700, loan_emi: 0, other_deductions: 0 },
  { employee_code: "MAS00176", designation_name: "SR. MANAGER", employment_type: "ONROLL", branch_id: "br-ho", branch_name: "HEAD OFFICE",
    net_salary: 85512, gross_salary: 95672, pf_employee: 5160, pf_employer: 5160,
    esic_employee: 0, esic_employer: 0, professional_tax: 0, tds: 0, loan_emi: 5000, other_deductions: 0 },
  { employee_code: "MAS00175", designation_name: "DY. MANAGER", employment_type: "ONROLL", branch_id: "br-ho", branch_name: "HEAD OFFICE",
    net_salary: 75932, gross_salary: 80096, pf_employee: 4164, pf_employer: 4164,
    esic_employee: 0, esic_employer: 0, professional_tax: 0, tds: 0, loan_emi: 0, other_deductions: 0 },
  { employee_code: "MAS00183", designation_name: "CHAIRMAN", employment_type: "ONROLL", branch_id: "br-ho", branch_name: "HEAD OFFICE",
    net_salary: 62500, gross_salary: 68500, pf_employee: 6000, pf_employer: 6000,
    esic_employee: 0, esic_employer: 0, professional_tax: 0, tds: 0, loan_emi: 0, other_deductions: 0 },
  { employee_code: "MAS07197", designation_name: "DY. MANAGER", employment_type: "ONROLL", branch_id: "br-ho", branch_name: "HEAD OFFICE",
    net_salary: 59379, gross_salary: 65581, pf_employee: 6202, pf_employer: 6202,
    esic_employee: 0, esic_employer: 0, professional_tax: 0, tds: 0, loan_emi: 0, other_deductions: 0 },
  { employee_code: "MAS00182", designation_name: "ASSISTANT MANAGER", employment_type: "ONROLL", branch_id: "br-ho", branch_name: "HEAD OFFICE",
    net_salary: 56935, gross_salary: 65535, pf_employee: 3600, pf_employer: 3600,
    esic_employee: 0, esic_employer: 0, professional_tax: 0, tds: 0, loan_emi: 5000, other_deductions: 0 },
  { employee_code: "MAS55833", designation_name: "EXECUTIVE", employment_type: "ONROLL", branch_id: "br-ho", branch_name: "HEAD OFFICE",
    net_salary: 35016, gross_salary: 40632, pf_employee: 616, pf_employer: 616,
    esic_employee: 0, esic_employer: 0, professional_tax: 0, tds: 0, loan_emi: 5000, other_deductions: 0 },
  { employee_code: "MAS62735", designation_name: "BUSINESS DEVELOPER", employment_type: "ONROLL", branch_id: "br-ho", branch_name: "HEAD OFFICE",
    net_salary: 31501, gross_salary: 32414, pf_employee: 2080, pf_employer: 2080,
    esic_employee: 0, esic_employer: 0, professional_tax: 0, tds: 0, loan_emi: 0, other_deductions: 0 },
  { employee_code: "MAS60079", designation_name: "EXECUTIVE", employment_type: "ONROLL", branch_id: "br-ho", branch_name: "HEAD OFFICE",
    net_salary: 30000, gross_salary: 30000, pf_employee: 0, pf_employer: 0,
    esic_employee: 0, esic_employer: 0, professional_tax: 0, tds: 0, loan_emi: 0, other_deductions: 0 },
  { employee_code: "MAS08107", designation_name: "SR. EXECUTIVE", employment_type: "ONROLL", branch_id: "br-ho", branch_name: "HEAD OFFICE",
    net_salary: 27075, gross_salary: 28335, pf_employee: 1260, pf_employer: 1260,
    esic_employee: 0, esic_employer: 0, professional_tax: 0, tds: 0, loan_emi: 0, other_deductions: 0 },
  { employee_code: "MAS07320", designation_name: "DY. MANAGER", employment_type: "ONROLL", branch_id: "br-ho", branch_name: "HEAD OFFICE",
    net_salary: 0, gross_salary: 0, pf_employee: 0, pf_employer: 0,
    esic_employee: 0, esic_employer: 0, professional_tax: 200, tds: 0, loan_emi: 0, other_deductions: 0 },
  { employee_code: "MAS28874", designation_name: "ASSISTANT MANAGER", employment_type: "ONROLL", branch_id: "br-ho", branch_name: "HEAD OFFICE",
    net_salary: 0, gross_salary: 0, pf_employee: 0, pf_employer: 0,
    esic_employee: 0, esic_employer: 0, professional_tax: 200, tds: 0, loan_emi: 0, other_deductions: 0 },
  { employee_code: "MAS02995", designation_name: "SR. MANAGER", employment_type: "ONROLL", branch_id: "br-ho", branch_name: "HEAD OFFICE",
    net_salary: 0, gross_salary: 0, pf_employee: 0, pf_employer: 0,
    esic_employee: 0, esic_employer: 0, professional_tax: 200, tds: 0, loan_emi: 0, other_deductions: 0 },
];

/** The CEO row, for the tests that need one identifiable person. */
const CEO = HEAD_OFFICE.find((r) => r.employee_code === "MAS00001")!;
const STAFF = HEAD_OFFICE.find((r) => r.employee_code === "MAS07197")!;

const COHORT = {
  cohort_key: "c_suite", label: "C-Suite", designation_pattern: "CHIEF%",
  employment_type: null, employee_code_prefix: null, column_index: 1, priority: 100,
};
const ENTITY_MAS = { company_code: "MAS", employee_code_prefix: "MAS", employment_type: null, branch_id: null, priority: 100 };

/** Scripts the four reads generate() performs, in order. */
function script(lines: unknown[], opts: { entities?: unknown[]; cohorts?: unknown[] } = {}) {
  execute.mockImplementation(async (sql: string) => {
    if (/FROM salary_prep_run/.test(sql)) return [[{ id: "run1", run_month: "2026-06" }], []];
    if (/FROM finance_payroll_entity_rule/.test(sql)) return [opts.entities ?? [ENTITY_MAS], []];
    if (/FROM salary_prep_line/.test(sql)) return [lines, []];
    if (/FROM finance_payroll_voucher_cohort/.test(sql)) return [opts.cohorts ?? [COHORT], []];
    return [[], []];
  });
}

const lineOf = (voucher: { lines: { ledger_name: string }[] }, name: string) =>
  voucher.lines.find((l) => l.ledger_name === name)!;

describe("reproducing the June-2026 HEAD OFFICE voucher", () => {
  it("produces one voucher, numbered and dated as the reference is", async () => {
    script(HEAD_OFFICE);
    const { vouchers, period } = await svc.salaryVoucherService.generate("run1", { serialFrom: 614 });
    expect(period).toBe("2026-06");
    expect(vouchers).toHaveLength(1);
    expect(vouchers[0].voucher_no).toBe("HEAD OFFICE/MAS/06/26/614");
    expect(vouchers[0].cost_category).toBe("HEAD OFFICE");
    expect(vouchers[0].cost_centre).toBe("HO/2606");
    expect(vouchers[0].voucher_type).toBe("JRNLSAL");
    expect(vouchers[0].narration).toBe("Salary Jun Month");
  });

  it("matches the reference on every credit line, to the rupee", async () => {
    script(HEAD_OFFICE);
    const [v] = (await svc.salaryVoucherService.generate("run1")).vouchers;
    expect(lineOf(v, "Salary Payable A/C").amount).toBe(1_036_519);
    expect(lineOf(v, "EPF Payable").amount).toBe(122_987);
    expect(lineOf(v, "ESIC Payable").amount).toBe(0);
    expect(lineOf(v, "TDS SALARY 2026-27").amount).toBe(78_860);
  });

  it("matches the reference on the employer debits", async () => {
    script(HEAD_OFFICE);
    const [v] = (await svc.salaryVoucherService.generate("run1")).vouchers;
    expect(lineOf(v, "Employer's Contribution to Epf").amount).toBe(59_034);
    expect(lineOf(v, "Employer's Contribution to Esic").amount).toBe(0);
    expect(lineOf(v, "EPF Admin Charges").amount).toBe(4_919);
  });

  it("derives Gross Salary as the reference's 1,189,413, not payroll's 1,188,246", async () => {
    // The whole point of the plug. Payroll gross is carried separately so the gap stays visible.
    script(HEAD_OFFICE);
    const [v] = (await svc.salaryVoucherService.generate("run1")).vouchers;
    expect(lineOf(v, "Gross Salary").amount).toBe(1_189_413);
    expect(v.payroll_gross).toBe(1_188_246);
  });

  it("splits every line into C-suite and staff exactly as the reference does", async () => {
    script(HEAD_OFFICE);
    const [v] = (await svc.salaryVoucherService.generate("run1")).vouchers;
    expect(v.cohort_labels).toEqual(["Staff", "C-Suite"]);
    // columns are [staff, c-suite]; the reference prints [c-suite, staff].
    expect(lineOf(v, "Gross Salary").columns).toEqual([1_023_151, 166_262]);
    expect(lineOf(v, "Salary Payable A/C").columns).toEqual([903_057, 133_462]);
    expect(lineOf(v, "Employer's Contribution to Epf").columns).toEqual([42_234, 16_800]);
    expect(lineOf(v, "TDS SALARY 2026-27").columns).toEqual([62_860, 16_000]);
    expect(lineOf(v, "EPF Admin Charges").columns).toEqual([3_519, 1_400]);
  });

  it("balances, and its columns sum to their line totals", async () => {
    script(HEAD_OFFICE);
    const [v] = (await svc.salaryVoucherService.generate("run1")).vouchers;
    expect(v.totals.balanced).toBe(true);
    expect(v.totals.debit).toBe(1_253_366);
    expect(v.totals.credit).toBe(1_253_366);
    for (const line of v.lines) {
      const summed = Math.round(line.columns.reduce((s, n) => s + n, 0) * 100) / 100;
      expect(summed, `${line.ledger_name} columns must sum to its amount`).toBe(line.amount);
    }
  });
});

describe("advances are per employee", () => {
  it("emits one line each rather than a consolidated total", async () => {
    // The reference shows three separate 5,000 rows at HEAD OFFICE, not one 15,000.
    script([
      { ...STAFF, employee_code: "MAS-A", loan_emi: 5000 },
      { ...STAFF, employee_code: "MAS-B", loan_emi: 5000 },
      { ...STAFF, employee_code: "MAS-C", loan_emi: 5000 },
    ]);
    const [v] = (await svc.salaryVoucherService.generate("run1")).vouchers;
    const advances = v.lines.filter((l) => l.ledger_name.startsWith("Advance Against Salary"));
    expect(advances).toHaveLength(3);
    expect(advances.every((a) => a.amount === 5000)).toBe(true);
    expect(advances[0].ledger_name).toBe("Advance Against Salary (HEAD OFFICE)");
    expect(advances.map((a) => a.employee_code)).toEqual(["MAS-A", "MAS-B", "MAS-C"]);
  });
});

describe("the entity rule", () => {
  it("refuses to generate when no rule is configured", async () => {
    // Rather than defaulting every salary to whichever company sorts first.
    script([CEO], { entities: [] });
    await expect(svc.salaryVoucherService.generate("run1")).rejects.toThrow(/No payroll entity rule/i);
  });

  it("excludes an employee whose code matches no entity, and names them", async () => {
    script([CEO, { ...STAFF, employee_code: "24852C" }]);
    const out = await svc.salaryVoucherService.generate("run1");
    expect(out.unassigned).toEqual(["24852C"]);
    expect(out.vouchers[0].employees).toBe(1);
  });

  it("excludes a line with no branch rather than inventing a cost centre", async () => {
    script([CEO, { ...STAFF, employee_code: "MAS99999", branch_name: null }]);
    const out = await svc.salaryVoucherService.generate("run1");
    expect(out.unassigned).toContain("MAS99999");
  });

  it("separates entities into their own vouchers at the same branch", async () => {
    // HEAD OFFICE genuinely issues both HEAD OFFICE/MAS/... and HEAD OFFICE/IDC/... .
    script(
      [CEO, { ...STAFF, employee_code: "IDC61387" }],
      { entities: [ENTITY_MAS, { company_code: "IDC", employee_code_prefix: "IDC", priority: 100 }] },
    );
    const { vouchers } = await svc.salaryVoucherService.generate("run1", { serialFrom: 614 });
    expect(vouchers).toHaveLength(2);
    expect(vouchers.map((v) => v.voucher_no)).toEqual([
      "HEAD OFFICE/IDC/06/26/614",
      "HEAD OFFICE/MAS/06/26/615",
    ]);
  });
});

describe("cohorts are configuration", () => {
  it("produces a single-column voucher when a company has no cohort rule", async () => {
    // Which is exactly what the IDC reference file looks like.
    script([CEO, STAFF], { cohorts: [] });
    const [v] = (await svc.salaryVoucherService.generate("run1")).vouchers;
    expect(v.cohort_labels).toEqual(["Staff"]);
    // Two employees only here: the CEO and one staff member, 133,462 + 59,379.
    expect(lineOf(v, "Salary Payable A/C").columns).toEqual([192_841]);
    expect(v.totals.balanced).toBe(true);
  });

  it("a cohort with no matchers matches nobody, not everybody", async () => {
    // The dangerous direction: an unconfigured cohort silently swallowing the whole payroll.
    script([CEO, STAFF], {
      cohorts: [{ ...COHORT, designation_pattern: null, employment_type: null, employee_code_prefix: null }],
    });
    const [v] = (await svc.salaryVoucherService.generate("run1")).vouchers;
    expect(lineOf(v, "Salary Payable A/C").columns).toEqual([192_841, 0]);
  });

  it("can split on employment type instead, without a code change", async () => {
    script([CEO, { ...STAFF, employment_type: "MGMT. TRAINEE" }], {
      cohorts: [{ ...COHORT, cohort_key: "trainee", label: "Trainees",
                  designation_pattern: null, employment_type: "MGMT. TRAINEE" }],
    });
    const [v] = (await svc.salaryVoucherService.generate("run1")).vouchers;
    expect(v.cohort_labels).toEqual(["Staff", "Trainees"]);
    expect(lineOf(v, "Salary Payable A/C").columns).toEqual([133_462, 59_379]);
  });
});

describe("formatting helpers", () => {
  it("uses the reference's branch short codes", async () => {
    expect(svc.branchShortCode("HEAD OFFICE")).toBe("HO");
    expect(svc.branchShortCode("AHMEDABAD-JALDARSHAN")).toBe("AHM");
    expect(svc.branchShortCode("NOIDA-DIALDESK")).toBe("NOIDA-DD");
    expect(svc.branchShortCode("NOIDA-2")).toBe("NOIDA-2");
  });

  it("falls back to the branch name for an unknown branch", async () => {
    // Wrong-but-visible beats wrong-and-plausible; a made-up abbreviation would post silently.
    expect(svc.branchShortCode("SOMEWHERE NEW")).toBe("SOMEWHERE NEW");
  });

  it("builds the cost centre as short code and YYMM", async () => {
    expect(svc.costCentreLabel("AHMEDABAD-JALDARSHAN", "2026-06")).toBe("AHM/2606");
    expect(svc.costCentreLabel("HEAD OFFICE", "2027-01")).toBe("HO/2701");
  });

  it("rounds EPF admin per employee, which is what reproduces the reference", async () => {
    // Takes and returns paise, but the result is always a whole number of rupees: Tally will
    // not accept a fractional-rupee admin charge, and the reference voucher has none.
    expect(svc.epfAdminCharge(1_680_000)).toBe(140_000);        // 16,800 -> 1,400.00
    expect(svc.epfAdminCharge(4_223_400)).toBe(352_000);        // 42,234 -> 3,519.50 -> 3,520
    expect(svc.epfAdminCharge(620_200)).toBe(51_700);           //  6,202 ->   516.83 ->   517
    expect(svc.epfAdminCharge(4_223_400) % 100, "never a fractional rupee").toBe(0);
  });

  it("labels the financial year from April", async () => {
    script(HEAD_OFFICE);
    const [june] = (await svc.salaryVoucherService.generate("run1")).vouchers;
    expect(june.lines.some((l) => l.ledger_name === "TDS SALARY 2026-27")).toBe(true);
    expect(june.lines.some((l) => l.ledger_name === "Professional Tax 2026-27")).toBe(true);
  });

  it("dates the voucher on the last day of the payroll month", async () => {
    script(HEAD_OFFICE);
    const [v] = (await svc.salaryVoucherService.generate("run1")).vouchers;
    expect(v.date).toBe("2026-06-30");
  });
});

describe("Gross Salary and GROSS SALARY are different ledgers", () => {
  it("keeps them as separate lines on opposite sides", async () => {
    // Merging them would net a recovery against gross pay and post both wrong.
    script([CEO, { ...STAFF, other_deductions: 833 }]);
    const [v] = (await svc.salaryVoucherService.generate("run1")).vouchers;
    const debitGross = v.lines.find((l) => l.ledger_name === "Gross Salary")!;
    const creditGross = v.lines.find((l) => l.ledger_name === "GROSS SALARY")!;
    expect(debitGross.debit_credit).toBe("D");
    expect(creditGross.debit_credit).toBe("C");
    expect(creditGross.amount).toBe(833);
    expect(v.totals.balanced).toBe(true);
  });
});
