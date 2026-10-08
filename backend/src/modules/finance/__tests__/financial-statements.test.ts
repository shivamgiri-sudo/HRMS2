import { describe, expect, it } from "vitest";
import {
  buildStatements,
  classifyAccount,
  type StatementAccount,
} from "../financial-statements.js";

const acc = (
  accountType: StatementAccount["accountType"],
  accountId: string,
  accountName: string,
  d: number,
  c: number,
): StatementAccount => ({
  accountType,
  accountId,
  accountName,
  totalDebit: d,
  totalCredit: c,
  netBalance: d - c,
});

describe("classifyAccount", () => {
  it("maps the account kinds", () => {
    expect(
      classifyAccount(acc("bank_account", "b", "HDFC (Bank)", 1, 0)).section,
    ).toBe("asset");
    expect(
      classifyAccount(acc("vendor", "v", "X (Sundry Creditor)", 0, 1)).section,
    ).toBe("liability");
    expect(
      classifyAccount(
        acc("expense_sub_head", "e", "Office Rent / Office Rent", 1, 0),
      ),
    ).toEqual({ section: "expense", group: "Office Rent" });
  });
  it("uses the ledger head's type for payable accounts", () => {
    expect(
      classifyAccount(
        acc("payable_account", "p", "TDS Payable", 0, 1),
        "payable",
      ),
    ).toEqual({ section: "liability", group: "Duties and Taxes" });
    expect(
      classifyAccount(
        acc("payable_account", "p", "Salary Payable", 0, 1),
        "payable",
      ).group,
    ).toBe("Salary and Payroll Liabilities");
    expect(
      classifyAccount(
        acc("payable_account", "p", "Sundry Debtors", 1, 0),
        "receivable",
      ).section,
    ).toBe("asset");
    expect(
      classifyAccount(
        acc("payable_account", "p", "Interest Income", 0, 1),
        "income",
      ).section,
    ).toBe("income");
    expect(
      classifyAccount(
        acc("payable_account", "p", "Bank Charges", 1, 0),
        "bank_charge",
      ).section,
    ).toBe("expense");
    expect(
      classifyAccount(
        acc("payable_account", "p", "Imprest Float", 1, 0),
        "other",
      ).section,
    ).toBe("asset");
  });
  it("places an 'other' head by the sign of its balance", () => {
    expect(
      classifyAccount(acc("payable_account", "p", "Other", 5, 1), "other")
        .section,
    ).toBe("asset");
    expect(
      classifyAccount(acc("payable_account", "p", "Other", 1, 5), "other")
        .section,
    ).toBe("liability");
  });
});

describe("buildStatements", () => {
  // Rent 100 accrued to a vendor, 40 paid from the bank, 10 interest earned into the bank.
  const rows = [
    acc("expense_sub_head", "e1", "Office Rent / Office Rent", 100, 0),
    acc("vendor", "v1", "Landlord (Sundry Creditor)", 40, 100),
    acc("bank_account", "b1", "HDFC (Bank)", 10, 40),
    acc("payable_account", "p1", "Interest Income", 0, 10),
  ];
  const s = buildStatements(rows, new Map([["p1", "income"]]));

  it("balance sheet balances with the surplus carried to the liabilities side", () => {
    expect(s.profitAndLoss.totalIncome).toBe(10);
    expect(s.profitAndLoss.totalExpenses).toBe(100);
    expect(s.profitAndLoss.surplus).toBe(-90);
    expect(s.balanceSheet.totalAssets).toBe(-30); // bank overdrawn by 30
    expect(s.balanceSheet.totalLiabilities).toBe(-30); // creditors 60 plus the 90 loss
    expect(s.balanceSheet.difference).toBe(0);
  });

  it("groups and totals by group, largest first", () => {
    expect(s.balanceSheet.liabilities[0]).toMatchObject({
      group: "Sundry Creditors (Vendors)",
      total: 60,
    });
    expect(s.profitAndLoss.expenses[0]).toMatchObject({
      group: "Office Rent",
      total: 100,
    });
  });

  it("shows a difference instead of hiding an incomplete ledger", () => {
    const lopsided = buildStatements(
      [acc("bank_account", "b1", "HDFC (Bank)", 500, 0)],
      new Map(),
    );
    expect(lopsided.balanceSheet.difference).toBe(500);
  });

  it("drops zero-balance accounts", () => {
    const z = buildStatements(
      [acc("bank_account", "b1", "HDFC (Bank)", 5, 5)],
      new Map(),
    );
    expect(z.balanceSheet.assets).toHaveLength(0);
  });
});
