import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

export interface TaxDeclarationInput {
  regime?: "old" | "new";
  totalInvestment?: number;
  total_investment?: number;
  declaredHra?: number;
  declared_hra?: number;
  declared80c?: number;
  declared_80c?: number;
  declared80d?: number;
  declared_80d?: number;
  declaredLtc?: number;
  declared_ltc?: number;
  declaredHomeLoanInterest?: number;
  declared_home_loan_interest?: number;
  declaredNps80ccd1b?: number;
  declared_nps_80ccd1b?: number;
  declared80e?: number;
  declared_80e?: number;
  declared80g?: number;
  declared_80g?: number;
  declaredOtherChapterVia?: number;
  declared_other_chapter_via?: number;
  otherIncome?: number;
  other_income?: number;
  employeeConsent?: boolean;
  employee_consent?: boolean;
}

export interface TaxDeclaration {
  id: string;
  employee_id: string;
  financial_year: string;
  regime: "old" | "new";
  total_investment: number;
  declared_hra: number;
  declared_80c: number;
  declared_80d: number;
  declared_ltc: number;
  declared_home_loan_interest: number;
  declared_nps_80ccd1b: number;
  declared_80e: number;
  declared_80g: number;
  declared_other_chapter_via: number;
  other_income: number;
  employee_consent: boolean;
  submission_status: "draft" | "submitted" | "verified" | "rejected";
  tds_projected: number;
  submitted_by: string | null;
  submitted_at: string | null;
  created_at: string;
  updated_at: string;
}

type NormalizedDeclaration = {
  regime: "old" | "new";
  totalInvestment: number;
  declaredHra: number;
  declared80c: number;
  declared80d: number;
  declaredLtc: number;
  declaredHomeLoanInterest: number;
  declaredNps80ccd1b: number;
  declared80e: number;
  declared80g: number;
  declaredOtherChapterVia: number;
  otherIncome: number;
  employeeConsent: boolean;
};

function amount(value: unknown, field: string): number {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100_000_000) {
    throw Object.assign(new Error(`${field} must be a non-negative amount`), { statusCode: 400 });
  }
  return Math.round(parsed * 100) / 100;
}

function pick(input: TaxDeclarationInput, camel: keyof TaxDeclarationInput, snake: keyof TaxDeclarationInput): unknown {
  return input[camel] ?? input[snake] ?? 0;
}

function normalizeInput(input: TaxDeclarationInput): NormalizedDeclaration {
  const declared80c = amount(pick(input, "declared80c", "declared_80c"), "80C investment");
  const declared80d = amount(pick(input, "declared80d", "declared_80d"), "80D premium");
  const declaredNps80ccd1b = amount(
    pick(input, "declaredNps80ccd1b", "declared_nps_80ccd1b"),
    "80CCD(1B) contribution"
  );
  const declared80e = amount(pick(input, "declared80e", "declared_80e"), "80E interest");
  const declared80g = amount(pick(input, "declared80g", "declared_80g"), "80G donation");
  const declaredOtherChapterVia = amount(
    pick(input, "declaredOtherChapterVia", "declared_other_chapter_via"),
    "other Chapter VI-A deduction"
  );
  const calculatedInvestment =
    declared80c + declared80d + declaredNps80ccd1b + declared80e + declared80g + declaredOtherChapterVia;
  const suppliedTotal = pick(input, "totalInvestment", "total_investment");

  return {
    regime: input.regime === "old" ? "old" : "new",
    totalInvestment: suppliedTotal ? amount(suppliedTotal, "total investment") : calculatedInvestment,
    declaredHra: amount(pick(input, "declaredHra", "declared_hra"), "HRA exemption"),
    declared80c,
    declared80d,
    declaredLtc: amount(pick(input, "declaredLtc", "declared_ltc"), "LTC exemption"),
    declaredHomeLoanInterest: amount(
      pick(input, "declaredHomeLoanInterest", "declared_home_loan_interest"),
      "home-loan interest"
    ),
    declaredNps80ccd1b,
    declared80e,
    declared80g,
    declaredOtherChapterVia,
    otherIncome: amount(pick(input, "otherIncome", "other_income"), "other income"),
    employeeConsent: Boolean(input.employeeConsent ?? input.employee_consent),
  };
}

export function normalizeFinancialYear(value: string): string {
  const trimmed = value.trim();
  const full = /^(\d{4})-(\d{4})$/.exec(trimmed);
  if (full) {
    const start = Number(full[1]);
    const end = Number(full[2]);
    if (end === start + 1) return `${start}-${end}`;
  }

  const short = /^(\d{4})-(\d{2})$/.exec(trimmed);
  if (short) {
    const start = Number(short[1]);
    const end = 2000 + Number(short[2]);
    if (end === start + 1) return `${start}-${end}`;
  }

  throw Object.assign(new Error("financial year must be consecutive, for example 2026-2027"), {
    statusCode: 400,
  });
}

export function financialYearAliases(value: string): [string, string] {
  const full = normalizeFinancialYear(value);
  return [full, `${full.slice(0, 5)}${full.slice(-2)}`];
}

function slabTax(income: number, slabs: Array<{ from: number; to: number | null; rate: number }>): number {
  return slabs.reduce((tax, slab) => {
    if (income <= slab.from) return tax;
    const upper = slab.to === null ? income : Math.min(income, slab.to);
    return tax + Math.max(0, upper - slab.from) * slab.rate;
  }, 0);
}

function computeProjectedTds(
  annualGross: number,
  financialYear: string,
  declaration: NormalizedDeclaration
): number {
  const gross = Math.max(0, annualGross + declaration.otherIncome);
  let taxable = gross;
  let tax = 0;

  if (declaration.regime === "old") {
    const chapterVia =
      Math.min(declaration.declared80c, 150_000) +
      Math.min(declaration.declared80d, 100_000) +
      Math.min(declaration.declaredNps80ccd1b, 50_000) +
      declaration.declared80e +
      declaration.declared80g +
      declaration.declaredOtherChapterVia;
    taxable = Math.max(
      0,
      gross -
        50_000 -
        declaration.declaredHra -
        declaration.declaredLtc -
        Math.min(declaration.declaredHomeLoanInterest, 200_000) -
        chapterVia
    );
    tax = slabTax(taxable, [
      { from: 0, to: 250_000, rate: 0 },
      { from: 250_000, to: 500_000, rate: 0.05 },
      { from: 500_000, to: 1_000_000, rate: 0.2 },
      { from: 1_000_000, to: null, rate: 0.3 },
    ]);
    if (taxable <= 500_000) tax = Math.max(0, tax - Math.min(tax, 12_500));
  } else {
    taxable = Math.max(0, gross - 75_000);
    const startYear = Number(financialYear.slice(0, 4));
    if (startYear >= 2025) {
      tax = slabTax(taxable, [
        { from: 0, to: 400_000, rate: 0 },
        { from: 400_000, to: 800_000, rate: 0.05 },
        { from: 800_000, to: 1_200_000, rate: 0.1 },
        { from: 1_200_000, to: 1_600_000, rate: 0.15 },
        { from: 1_600_000, to: 2_000_000, rate: 0.2 },
        { from: 2_000_000, to: 2_400_000, rate: 0.25 },
        { from: 2_400_000, to: null, rate: 0.3 },
      ]);
      if (taxable <= 1_200_000) tax = Math.max(0, tax - Math.min(tax, 60_000));
    } else {
      tax = slabTax(taxable, [
        { from: 0, to: 300_000, rate: 0 },
        { from: 300_000, to: 700_000, rate: 0.05 },
        { from: 700_000, to: 1_000_000, rate: 0.1 },
        { from: 1_000_000, to: 1_200_000, rate: 0.15 },
        { from: 1_200_000, to: 1_500_000, rate: 0.2 },
        { from: 1_500_000, to: null, rate: 0.3 },
      ]);
      if (taxable <= 700_000) tax = Math.max(0, tax - Math.min(tax, 25_000));
    }
  }

  return Math.round(Math.max(0, tax) * 1.04 * 100) / 100;
}

const selectDeclaration = `
  SELECT td.*,
         COALESCE(fd.declared_ltc, 0) AS declared_ltc,
         COALESCE(fd.declared_home_loan_interest, 0) AS declared_home_loan_interest,
         COALESCE(fd.declared_nps_80ccd1b, 0) AS declared_nps_80ccd1b,
         COALESCE(fd.declared_80e, 0) AS declared_80e,
         COALESCE(fd.declared_80g, 0) AS declared_80g,
         COALESCE(fd.declared_other_chapter_via, 0) AS declared_other_chapter_via,
         COALESCE(fd.other_income, 0) AS other_income,
         COALESCE(fd.employee_consent, 0) AS employee_consent,
         COALESCE(fd.submission_status, 'submitted') AS submission_status,
         fd.submitted_at
    FROM tax_declaration td
    LEFT JOIN tax_declaration_form12bb_detail fd ON fd.declaration_id = td.id`;

export const taxDeclarationService = {
  async upsert(
    employeeId: string,
    financialYearInput: string,
    input: TaxDeclarationInput,
    submittedBy: string
  ): Promise<TaxDeclaration> {
    const financialYear = normalizeFinancialYear(financialYearInput);
    const aliases = financialYearAliases(financialYear);
    const data = normalizeInput(input);

    const [salRows] = await db.execute<RowDataPacket[]>(
      `SELECT ctc_annual
         FROM employee_salary_assignment
        WHERE employee_id = ? AND active_status = 1
        ORDER BY effective_from DESC
        LIMIT 1`,
      [employeeId]
    );
    const ctcAnnual = Number((salRows as any[])[0]?.ctc_annual ?? 0);
    const tdsProjected = computeProjectedTds(ctcAnnual, financialYear, data);

    const [existingRows] = await db.execute<RowDataPacket[]>(
      `SELECT id, financial_year
         FROM tax_declaration
        WHERE employee_id = ? AND financial_year IN (?, ?)
        ORDER BY financial_year = ? DESC
        LIMIT 1`,
      [employeeId, aliases[0], aliases[1], aliases[0]]
    );
    const existing = existingRows[0] as { id: string; financial_year: string } | undefined;
    const declarationId = existing?.id ?? randomUUID();

    if (existing) {
      await db.execute(
        `UPDATE tax_declaration
            SET financial_year = ?, regime = ?, total_investment = ?,
                declared_hra = ?, declared_80c = ?, declared_80d = ?,
                tds_projected = ?, submitted_by = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?`,
        [
          financialYear,
          data.regime,
          data.totalInvestment,
          data.declaredHra,
          data.declared80c,
          data.declared80d,
          tdsProjected,
          submittedBy,
          declarationId,
        ]
      );
    } else {
      await db.execute(
        `INSERT INTO tax_declaration
           (id, employee_id, financial_year, regime, total_investment,
            declared_hra, declared_80c, declared_80d, tds_projected, submitted_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          declarationId,
          employeeId,
          financialYear,
          data.regime,
          data.totalInvestment,
          data.declaredHra,
          data.declared80c,
          data.declared80d,
          tdsProjected,
          submittedBy,
        ]
      );
    }

    await db.execute(
      `INSERT INTO tax_declaration_form12bb_detail
         (declaration_id, declared_ltc, declared_home_loan_interest,
          declared_nps_80ccd1b, declared_80e, declared_80g,
          declared_other_chapter_via, other_income, employee_consent,
          submission_status, submitted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'submitted', CURRENT_TIMESTAMP)
       ON DUPLICATE KEY UPDATE
         declared_ltc = VALUES(declared_ltc),
         declared_home_loan_interest = VALUES(declared_home_loan_interest),
         declared_nps_80ccd1b = VALUES(declared_nps_80ccd1b),
         declared_80e = VALUES(declared_80e),
         declared_80g = VALUES(declared_80g),
         declared_other_chapter_via = VALUES(declared_other_chapter_via),
         other_income = VALUES(other_income),
         employee_consent = VALUES(employee_consent),
         submission_status = 'submitted',
         submitted_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP`,
      [
        declarationId,
        data.declaredLtc,
        data.declaredHomeLoanInterest,
        data.declaredNps80ccd1b,
        data.declared80e,
        data.declared80g,
        data.declaredOtherChapterVia,
        data.otherIncome,
        data.employeeConsent ? 1 : 0,
      ]
    );

    return this.get(employeeId, financialYear);
  },

  async find(employeeId: string, financialYearInput: string): Promise<TaxDeclaration | null> {
    const [full, short] = financialYearAliases(financialYearInput);
    const [rows] = await db.execute<RowDataPacket[]>(
      `${selectDeclaration}
        WHERE td.employee_id = ? AND td.financial_year IN (?, ?)
        ORDER BY td.financial_year = ? DESC
        LIMIT 1`,
      [employeeId, full, short, full]
    );
    return (rows[0] as TaxDeclaration | undefined) ?? null;
  },

  async get(employeeId: string, financialYearInput: string): Promise<TaxDeclaration> {
    const declaration = await this.find(employeeId, financialYearInput);
    if (!declaration) throw Object.assign(new Error("Tax declaration not found"), { statusCode: 404 });
    return declaration;
  },

  async listHistory(employeeId: string): Promise<TaxDeclaration[]> {
    const [rows] = await db.execute<RowDataPacket[]>(
      `${selectDeclaration}
        WHERE td.employee_id = ?
        ORDER BY CAST(LEFT(td.financial_year, 4) AS UNSIGNED) DESC, td.updated_at DESC`,
      [employeeId]
    );
    return rows as TaxDeclaration[];
  },
};
