import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { taxEngineService } from "./taxEngine.service.js";

export interface TaxDeclarationInput {
  regime?: "old" | "new";
  totalInvestment?: number;
  declaredHra?: number;
  declared80c?: number;
  declared80d?: number;
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
  tds_projected: number;
  submitted_by: string | null;
  created_at: string;
  updated_at: string;
}

export const taxDeclarationService = {
  async upsert(employeeId: string, financialYear: string, data: TaxDeclarationInput, submittedBy: string): Promise<TaxDeclaration> {
    const [salRows] = await db.execute<RowDataPacket[]>(
      "SELECT ctc_annual FROM employee_salary_assignment WHERE employee_id = ? AND active_status = 1 LIMIT 1",
      [employeeId]
    );
    const ctcAnnual: number = Number((salRows as any[])[0]?.ctc_annual ?? 0);

    const regime = data.regime ?? "new";
    const inv80c = data.declared80c ?? 0;
    const inv80d = data.declared80d ?? 0;
    const invHra = data.declaredHra ?? 0;
    const totalInv = data.totalInvestment ?? (inv80c + inv80d);

    const projection = await taxEngineService.calculateMonthlyTds({
      financialYear,
      annualGross: ctcAnnual,
      declaration: { regime, declared_hra: invHra, declared_80c: inv80c, declared_80d: inv80d },
      alreadyDeducted: 0,
      monthsRemaining: 12,
    });

    const id = randomUUID();
    await db.execute(
      `INSERT INTO tax_declaration
         (id, employee_id, financial_year, regime, total_investment,
          declared_hra, declared_80c, declared_80d, tds_projected, submitted_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         regime = VALUES(regime),
         total_investment = VALUES(total_investment),
         declared_hra = VALUES(declared_hra),
         declared_80c = VALUES(declared_80c),
         declared_80d = VALUES(declared_80d),
         tds_projected = VALUES(tds_projected),
         submitted_by = VALUES(submitted_by),
         updated_at = CURRENT_TIMESTAMP`,
      [id, employeeId, financialYear, regime, totalInv, invHra, inv80c, inv80d, projection.tax_annual, submittedBy]
    );

    return this.get(employeeId, financialYear);
  },

  async get(employeeId: string, financialYear: string): Promise<TaxDeclaration> {
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM tax_declaration WHERE employee_id = ? AND financial_year = ? LIMIT 1",
      [employeeId, financialYear]
    );
    const rec = (rows as TaxDeclaration[])[0];
    if (!rec) throw new Error("Tax declaration not found");
    return rec;
  },
};
