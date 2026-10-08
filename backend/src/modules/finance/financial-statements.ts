/**
 * Balance sheet and profit and loss built from the trial balance. Pure: no database.
 *
 * Every journal entry balances, so debits equal credits across the whole ledger. Classify each
 * account as an asset, liability, income or expense and the identity
 *     assets = liabilities + (income - expenses)
 * holds, with the net surplus or loss carried into the liabilities side as "Profit and Loss A/c".
 * Whatever the identity does not cover is shown as a difference, never hidden: the ledger holds only
 * what has been posted through HRMS, so opening balances, share capital and fixed assets are not in it
 * and a non-zero difference means the books are missing something, not that the report is wrong.
 */

export type StatementAccount = {
  accountType:
    "bank_account" | "vendor" | "expense_sub_head" | "payable_account";
  accountId: string;
  accountName: string;
  totalDebit: number;
  totalCredit: number;
  netBalance: number; // debit - credit
};

export type Section = "asset" | "liability" | "income" | "expense";

export type StatementLine = {
  accountId: string;
  accountType: string;
  name: string;
  amount: number;
};
export type StatementGroup = {
  group: string;
  total: number;
  lines: StatementLine[];
};

export type Statements = {
  balanceSheet: {
    liabilities: StatementGroup[];
    assets: StatementGroup[];
    profitAndLoss: number; // surplus (+) or loss (-), carried to the liabilities side
    totalLiabilities: number; // including profitAndLoss
    totalAssets: number;
    difference: number; // assets - liabilities; 0 when the ledger is complete
  };
  profitAndLoss: {
    income: StatementGroup[];
    expenses: StatementGroup[];
    totalIncome: number;
    totalExpenses: number;
    surplus: number;
  };
};

const r2 = (n: number) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

const SYNTHETIC_PAYMENTS = "Payments made to vendors (bank / cash)";
const SYNTHETIC_UNPOSTED = "Purchases not yet posted to an expense head";

const TAX_NAMES = /tds|statutory|gst|duties|tax/i;
const PAYROLL_NAMES = /salary|payroll|wages/i;

export function classifyAccount(
  row: StatementAccount,
  payableType?: string | null,
): { section: Section; group: string } {
  switch (row.accountType) {
    case "bank_account":
      return { section: "asset", group: "Bank Accounts" };
    case "vendor":
      return { section: "liability", group: "Sundry Creditors (Vendors)" };
    case "expense_sub_head": {
      const head = row.accountName.includes(" / ")
        ? row.accountName.split(" / ")[0].trim()
        : "";
      return { section: "expense", group: head || "Other Expenses" };
    }
    case "payable_account": {
      if (row.accountName === SYNTHETIC_PAYMENTS)
        return { section: "asset", group: "Bank Accounts" };
      if (row.accountName === SYNTHETIC_UNPOSTED)
        return {
          section: "expense",
          group: "Purchases not yet posted to an expense head",
        };
      const name = row.accountName;
      if (/imprest float/i.test(name))
        return {
          section: "asset",
          group: "Imprest Float (advances held at branches)",
        };
      if (/inter-?account transfer/i.test(name))
        return { section: "asset", group: "Funds in Transit" };
      switch (payableType) {
        case "payable":
          if (/vendor payables/i.test(name))
            return {
              section: "liability",
              group: "Sundry Creditors (Vendors)",
            };
          if (TAX_NAMES.test(name))
            return { section: "liability", group: "Duties and Taxes" };
          if (PAYROLL_NAMES.test(name))
            return {
              section: "liability",
              group: "Salary and Payroll Liabilities",
            };
          return { section: "liability", group: "Other Payables" };
        case "receivable":
          return { section: "asset", group: "Sundry Debtors" };
        case "income":
          return { section: "income", group: "Other Income" };
        case "bank_charge":
          return { section: "expense", group: "Finance Expenses" };
        default:
          // An 'other' ledger head has no fixed nature: a debit balance is an asset, a credit one a liability.
          return row.netBalance >= 0
            ? { section: "asset", group: "Other Assets" }
            : { section: "liability", group: "Other Liabilities" };
      }
    }
  }
}

function signedAmount(section: Section, row: StatementAccount): number {
  // Assets and expenses are debit-natured, liabilities and income credit-natured.
  return r2(
    section === "asset" || section === "expense"
      ? row.totalDebit - row.totalCredit
      : row.totalCredit - row.totalDebit,
  );
}

function groupUp(
  entries: { group: string; line: StatementLine }[],
): StatementGroup[] {
  const map = new Map<string, StatementLine[]>();
  for (const e of entries) {
    if (!map.has(e.group)) map.set(e.group, []);
    map.get(e.group)!.push(e.line);
  }
  return [...map.entries()]
    .map(([group, lines]) => ({
      group,
      total: r2(lines.reduce((s, l) => s + l.amount, 0)),
      lines: lines.sort(
        (a, b) =>
          Math.abs(b.amount) - Math.abs(a.amount) ||
          a.name.localeCompare(b.name),
      ),
    }))
    .sort(
      (a, b) =>
        Math.abs(b.total) - Math.abs(a.total) || a.group.localeCompare(b.group),
    );
}

export function buildStatements(
  rows: StatementAccount[],
  payableTypes: Map<string, string>,
): Statements {
  const buckets: Record<Section, { group: string; line: StatementLine }[]> = {
    asset: [],
    liability: [],
    income: [],
    expense: [],
  };
  for (const row of rows) {
    const { section, group } = classifyAccount(
      row,
      payableTypes.get(row.accountId) ?? null,
    );
    const amount = signedAmount(section, row);
    if (amount === 0) continue;
    buckets[section].push({
      group,
      line: {
        accountId: row.accountId,
        accountType: row.accountType,
        name: row.accountName,
        amount,
      },
    });
  }
  const assets = groupUp(buckets.asset);
  const liabilities = groupUp(buckets.liability);
  const income = groupUp(buckets.income);
  const expenses = groupUp(buckets.expense);

  const sum = (g: StatementGroup[]) => r2(g.reduce((s, x) => s + x.total, 0));
  const totalIncome = sum(income);
  const totalExpenses = sum(expenses);
  const surplus = r2(totalIncome - totalExpenses);
  const totalAssets = sum(assets);
  const totalLiabilities = r2(sum(liabilities) + surplus);

  return {
    balanceSheet: {
      liabilities,
      assets,
      profitAndLoss: surplus,
      totalLiabilities,
      totalAssets,
      difference: r2(totalAssets - totalLiabilities),
    },
    profitAndLoss: { income, expenses, totalIncome, totalExpenses, surplus },
  };
}
