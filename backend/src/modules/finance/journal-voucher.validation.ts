import { refuse } from "../process-pnl/finance-error.js";

export const JV_TYPES = [
  "reclassification",
  "provision",
  "accrual_reversal",
  "prepaid_amortisation",
  "depreciation",
  "correction",
  "opening_balance",
  "other",
] as const;
export type JvType = (typeof JV_TYPES)[number];

export const JV_STATUSES = ["draft", "pending_approval", "posted", "rejected", "withdrawn", "reversed"] as const;
export type JvStatus = (typeof JV_STATUSES)[number];

/** Bank and vendor accounts are deliberately absent: each has its own sub-ledger (bank
 *  reconciliation, vendor dues) that only Payment Vouchers / GRNs may move. */
export const JV_ACCOUNT_TYPES = ["expense_sub_head", "payable_account"] as const;
export type JvAccountType = (typeof JV_ACCOUNT_TYPES)[number];

/** payable_account_master heads whose balance is owned by another sub-ledger. */
export const JV_BLOCKED_PAYABLE_ACCOUNT_NAMES = ["Imprest Float"] as const;

export const JV_MIN_LINES = 2;
export const JV_MAX_LINES = 100;
export const JV_MAX_LINE_AMOUNT = 99_999_999_999.99;
export const JV_MIN_NARRATION_LENGTH = 5;
export const JV_MAX_NARRATION_LENGTH = 2000;
export const JV_MAX_LINE_NARRATION_LENGTH = 500;
export const JV_MAX_REFERENCE_LENGTH = 100;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const UUID_PATTERN = /^[0-9a-fA-F-]{36}$/;

export type JvLineInput = {
  accountType: JvAccountType;
  accountId: string;
  debitAmount: number;
  creditAmount: number;
  narration: string | null;
};

export type JvInput = {
  voucherDate: string;
  jvType: JvType;
  narration: string;
  referenceNo: string | null;
  branchId: string | null;
  costCentreId: string | null;
  processId: string | null;
  lines: JvLineInput[];
};

const toPaise = (value: number) => Math.round(value * 100);

export function isValidIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function optionalId(value: unknown, label: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw refuse(400, "JV_INVALID_ID", `${label} is not a valid id.`);
  }
  return value;
}

function parseAmount(raw: unknown, label: string, lineNo: number): number {
  if (raw === undefined || raw === null || raw === "") return 0;
  const n = typeof raw === "number" ? raw : Number(String(raw).replace(/,/g, ""));
  if (!Number.isFinite(n) || n < 0) throw refuse(400, "JV_INVALID_AMOUNT", `Line ${lineNo}: ${label} must be a positive number.`);
  if (n > JV_MAX_LINE_AMOUNT) throw refuse(400, "JV_AMOUNT_TOO_LARGE", `Line ${lineNo}: ${label} is above the allowed maximum.`);
  const paise = Math.round(n * 100);
  if (Math.abs(n * 100 - paise) > 1e-6) {
    throw refuse(400, "JV_AMOUNT_PRECISION", `Line ${lineNo}: ${label} can have at most two decimal places.`);
  }
  return paise / 100;
}

/**
 * Shape/format validation only — pure, no DB. Account existence, active state and branch/cost
 * centre consistency are checked by the service against the live masters. Balance is NOT
 * checked here: a draft may be saved unbalanced; assertBalanced() runs at submit.
 */
export function normalizeJournalVoucherInput(raw: unknown, todayIst: string): JvInput {
  if (!raw || typeof raw !== "object") throw refuse(400, "JV_INVALID_BODY", "A journal voucher body is required.");
  const body = raw as Record<string, unknown>;

  if (!isValidIsoDate(body.voucherDate)) throw refuse(400, "JV_INVALID_DATE", "Voucher date must be a valid date (YYYY-MM-DD).");
  if (body.voucherDate > todayIst) throw refuse(400, "JV_FUTURE_DATE", "Voucher date cannot be in the future.");

  if (!JV_TYPES.includes(body.jvType as JvType)) throw refuse(400, "JV_INVALID_TYPE", "Pick a valid voucher type.");

  const narration = typeof body.narration === "string" ? body.narration.trim() : "";
  if (narration.length < JV_MIN_NARRATION_LENGTH) {
    throw refuse(400, "JV_NARRATION_REQUIRED", `Narration is required (at least ${JV_MIN_NARRATION_LENGTH} characters) — say why this entry is being made.`);
  }
  if (narration.length > JV_MAX_NARRATION_LENGTH) throw refuse(400, "JV_NARRATION_TOO_LONG", `Narration is too long (max ${JV_MAX_NARRATION_LENGTH} characters).`);

  const referenceNo = typeof body.referenceNo === "string" ? body.referenceNo.trim() : "";
  if (referenceNo.length > JV_MAX_REFERENCE_LENGTH) throw refuse(400, "JV_REFERENCE_TOO_LONG", `Reference is too long (max ${JV_MAX_REFERENCE_LENGTH} characters).`);

  if (!Array.isArray(body.lines)) throw refuse(400, "JV_LINES_REQUIRED", "Add the debit and credit lines.");
  if (body.lines.length > JV_MAX_LINES) throw refuse(400, "JV_TOO_MANY_LINES", `A voucher can have at most ${JV_MAX_LINES} lines.`);

  const lines: JvLineInput[] = body.lines.map((rawLine, index) => {
    const lineNo = index + 1;
    if (!rawLine || typeof rawLine !== "object") throw refuse(400, "JV_INVALID_LINE", `Line ${lineNo} is not valid.`);
    const line = rawLine as Record<string, unknown>;
    if (!JV_ACCOUNT_TYPES.includes(line.accountType as JvAccountType)) {
      throw refuse(400, "JV_ACCOUNT_TYPE_NOT_ALLOWED", `Line ${lineNo}: only expense heads and ledger heads can be used in a journal voucher.`);
    }
    if (typeof line.accountId !== "string" || !UUID_PATTERN.test(line.accountId)) {
      throw refuse(400, "JV_ACCOUNT_REQUIRED", `Line ${lineNo}: pick an account.`);
    }
    const debitAmount = parseAmount(line.debitAmount, "debit", lineNo);
    const creditAmount = parseAmount(line.creditAmount, "credit", lineNo);
    if (debitAmount > 0 && creditAmount > 0) {
      throw refuse(400, "JV_LINE_BOTH_SIDES", `Line ${lineNo} has both a debit and a credit — a line moves exactly one side.`);
    }
    if (debitAmount === 0 && creditAmount === 0) {
      throw refuse(400, "JV_LINE_ZERO", `Line ${lineNo} has no amount — enter a debit or a credit.`);
    }
    const lineNarration = typeof line.narration === "string" ? line.narration.trim() : "";
    if (lineNarration.length > JV_MAX_LINE_NARRATION_LENGTH) {
      throw refuse(400, "JV_LINE_NARRATION_TOO_LONG", `Line ${lineNo}: narration is too long (max ${JV_MAX_LINE_NARRATION_LENGTH} characters).`);
    }
    return {
      accountType: line.accountType as JvAccountType,
      accountId: line.accountId,
      debitAmount,
      creditAmount,
      narration: lineNarration || null,
    };
  });

  return {
    voucherDate: body.voucherDate,
    jvType: body.jvType as JvType,
    narration,
    referenceNo: referenceNo || null,
    branchId: optionalId(body.branchId, "Branch"),
    costCentreId: optionalId(body.costCentreId, "Cost centre"),
    processId: optionalId(body.processId, "Process"),
    lines,
  };
}

export function totalsOf(lines: Pick<JvLineInput, "debitAmount" | "creditAmount">[]) {
  let debitPaise = 0;
  let creditPaise = 0;
  for (const line of lines) {
    debitPaise += toPaise(line.debitAmount);
    creditPaise += toPaise(line.creditAmount);
  }
  return { debit: debitPaise / 100, credit: creditPaise / 100, difference: (debitPaise - creditPaise) / 100 };
}

/** Submit-time rules: enough lines, both sides present, debits equal credits to the paisa. */
export function assertSubmittable(lines: Pick<JvLineInput, "debitAmount" | "creditAmount">[]) {
  if (lines.length < JV_MIN_LINES) {
    throw refuse(400, "JV_TOO_FEW_LINES", "A journal voucher needs at least two lines — one debit side, one credit side.");
  }
  const { debit, credit, difference } = totalsOf(lines);
  if (debit === 0 || credit === 0) {
    throw refuse(400, "JV_ONE_SIDED", "A journal voucher needs at least one debit and one credit line.");
  }
  if (difference !== 0) {
    throw refuse(
      409,
      "JV_UNBALANCED",
      `Debits ₹${debit.toFixed(2)} and credits ₹${credit.toFixed(2)} do not match — the difference is ₹${Math.abs(difference).toFixed(2)}.`,
    );
  }
}
