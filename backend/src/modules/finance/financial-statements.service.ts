import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import type { FinanceBranchScope } from "./finance-access-scope.js";
import {
  buildStatements,
  type Statements,
  type StatementAccount,
} from "./financial-statements.js";
import { ledgerReportsService } from "./ledger-reports.service.js";

export type FinancialStatementsResult = Statements & {
  asOf: string | null;
  /** Debits equal credits in the trial balance the statements were built from. */
  trialBalanceBalanced: boolean;
  trialBalance: { totalDebit: number; totalCredit: number; rows: number };
};

/** Balance sheet and profit and loss as on a date (or to date), from the trial balance. */
export async function financialStatements(
  asOfDate: string | undefined,
  scope?: FinanceBranchScope,
): Promise<FinancialStatementsResult> {
  const tb = await ledgerReportsService.trialBalance(
    asOfDate,
    undefined,
    scope,
  );
  const [types] = await db.execute<RowDataPacket[]>(
    `SELECT id, account_type FROM payable_account_master`,
  );
  const payableTypes = new Map<string, string>(
    types.map((t) => [String(t.id), String(t.account_type)]),
  );
  const statements = buildStatements(
    tb.rows as StatementAccount[],
    payableTypes,
  );
  return {
    ...statements,
    asOf: asOfDate ?? null,
    trialBalanceBalanced: tb.balanced,
    trialBalance: {
      totalDebit: tb.totalDebit,
      totalCredit: tb.totalCredit,
      rows: tb.rows.length,
    },
  };
}
