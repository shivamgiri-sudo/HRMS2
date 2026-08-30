/**
 * Bank Payment Readiness — classifies every active payable employee into exactly one of
 * READY / MISSING / INVALID / CONFLICT / PENDING_APPROVAL / BLOCKED.
 *
 * WHY THIS EXISTS
 *   Before this, "can we pay this person" had no single answer. /runs/:runId/bank-exception-report
 *   answers it for two classes (missing, conflict) on one run and has no UI; scripts/bank-exception
 *   -report.ts answers it for five classes on the command line. Neither covers duplicate accounts,
 *   beneficiary information, approval state, or who owns the exception.
 *
 * THE ACCOUNT SOURCE IS employee_bank_detail, AND ONLY THAT
 *   Three payment paths disagree today: bank-advice pays to employees.bank_account_number,
 *   neft-transfer-file and /bank-export pay to employee_bank_detail. Verified 2026-08-13 against
 *   the live backend: employees.bank_account_number has NO writer anywhere in backend/src — no
 *   UPDATE, no INSERT sets it — so it is frozen legacy data that no onboarding, HR edit or
 *   approved change has touched since migration. employee_bank_detail is the only table the
 *   application maintains, so it is the only defensible payment source.
 *
 *   This module therefore treats employees.bank_account_number as a CONFLICT SIGNAL ONLY and
 *   never as a payment source. It deliberately does NOT change what any existing payment path
 *   reads — that divergence is reported by getPaymentSourceDivergence() and left for a decision.
 *
 *   CORRECTION, 2026-08-18: "the only defensible payment source" is the right call for what to
 *   trust BY DEFAULT (it's the only actively-maintained table), but it is not evidence the value
 *   is correct. Checked against db_bill's own confirmed-credit history for all 7 employees
 *   conflicting on the 2026-07 run: the frozen legacy column was the one actually paid, correctly,
 *   every time — including through real account changes employee_bank_detail missed. A future
 *   fix must not resolve a CONFLICT by defaulting to employee_bank_detail; verify per-employee
 *   against db_bill (or a human) the same way this module already does for READY.
 *
 * VERIFICATION COMES FROM db_bill, NOT FROM employee_bank_detail.verified
 *   `verified` is not a bank-confirmation flag. Only PATCH /bank-change-requests/:id ever writes
 *   it (payroll-window.routes.ts), so it means "arrived via the approval workflow" and is set on
 *   5 of 12,768 rows. Gating payment on it would block the entire workforce.
 *
 *   db_bill.salary_data is the real finance system: one row per employee per month carrying the
 *   account the salary was actually credited to (AcNo) and whether receipt was confirmed
 *   (SalaryReceiveStatus = 'YES'). An HRMS account that equals a confirmed-received credit is
 *   verified by the strongest evidence available — the money reached it.
 *
 *   ⚠️ THE VERIFICATION MONTH IS NOT "LAST MONTH". SalaryReceiveStatus is stamped when receipt is
 *   confirmed, which lags the run. Measured 2026-08-13: all 1,453 rows for 2026-07-31 carry NULL,
 *   while 2026-06-30 carries 1,227 YES. Taking the newest month would verify nobody and report
 *   the whole workforce as BLOCKED. resolveVerificationMonth() therefore picks the newest month
 *   that actually HAS confirmed receipts rather than the newest month present.
 *
 * DO NOT INFER MISSING BANK DATA
 *   db_bill is used to VERIFY and to FLAG recoverability. It is never used to fill in an account
 *   number for classification: an employee with no HRMS bank record is MISSING even when db_bill
 *   knows the account, and says so with recoverable_from_db_bill = true. Promoting that account
 *   into HRMS is a separate, explicitly approved write (scripts/bank-detail-db-bill-backfill.ts).
 *
 * DEGRADATION IS EXPLICIT
 *   If db_bill is unreachable, verification is UNAVAILABLE, not "failed". Rows that would have
 *   been READY become BLOCKED with reason bank_source_unavailable and the report carries
 *   verification_source.available = false. Silently reporting READY (or silently reporting
 *   everyone BLOCKED) on a dead link is the failure mode this whole module exists to prevent.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { billQuery } from "../../db/billDb.js";
import { resolveAccountNumberWithConflict } from "../../shared/fieldEncryption.js";

// ─── Taxonomy ────────────────────────────────────────────────────────────────

export type BankReadinessClass =
  | "READY"
  | "MISSING"
  | "INVALID"
  | "CONFLICT"
  | "PENDING_APPROVAL"
  | "BLOCKED";

export const BANK_READINESS_CLASSES: readonly BankReadinessClass[] = [
  "READY",
  "MISSING",
  "INVALID",
  "CONFLICT",
  "PENDING_APPROVAL",
  "BLOCKED",
] as const;

/**
 * Reason codes are stable identifiers, not display strings — the UI maps them to copy and the
 * exception table stores them. Renaming one silently orphans stored exception rows.
 */
export type BankReadinessReason =
  // MISSING
  | "no_primary_bank_record"
  | "account_number_empty"
  // INVALID
  | "account_number_corrupt"
  | "ifsc_invalid_format"
  // CONFLICT
  | "multiple_active_primary_records"
  | "account_shared_with_another_employee"
  | "disagrees_with_credited_account"
  | "encrypted_and_legacy_columns_disagree"
  // PENDING_APPROVAL
  | "change_request_awaiting_approval"
  // BLOCKED
  | "no_payment_history_to_verify_against"
  | "credit_receipt_unconfirmed"
  | "bank_source_unavailable"
  // READY
  | "verified_against_confirmed_credit";

/** RBI IFSC: 4 letters, then a literal zero, then 6 alphanumerics. */
export const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;

/** Indian account numbers are 6–20 digits. Anything else cannot be sent to a bank. */
const PLAUSIBLE_ACCOUNT_RE = /^[0-9]{6,20}$/;

/** Excel precision loss, e.g. "2.0021E+14". The digits behind it are genuinely gone. */
const SCIENTIFIC_NOTATION_RE = /[Ee][+-]?\d/;

export function normaliseAccount(value: unknown): string {
  return String(value ?? "").trim().replace(/\s+/g, "");
}

export function isCorruptAccount(value: unknown): boolean {
  const v = normaliseAccount(value);
  if (!v) return true;
  if (SCIENTIFIC_NOTATION_RE.test(v)) return true;
  if (/^0+$/.test(v)) return true;
  return !PLAUSIBLE_ACCOUNT_RE.test(v);
}

export function isValidIfsc(value: unknown): boolean {
  return IFSC_RE.test(String(value ?? "").trim().toUpperCase());
}

/**
 * Mask for every general screen: XXXX + last 4. A value too short to have a last 4 masks
 * entirely rather than leaking what it does have.
 */
export function maskAccount(value: unknown): string {
  const v = normaliseAccount(value);
  return v.length >= 4 ? `XXXX${v.slice(-4)}` : "XXXX";
}

// ─── Classification input/output ─────────────────────────────────────────────

export interface BankReadinessInput {
  employee_id: string;
  employee_code: string;
  employee_name: string;
  /** Count of active is_primary rows. > 1 is structurally unpayable. */
  active_primary_count: number;
  /** Resolved account number from employee_bank_detail, or null when there is no record. */
  account_number: string | null;
  /** True when the encrypted and legacy columns hold different values. */
  account_sources_conflict: boolean;
  ifsc_code: string | null;
  bank_name: string | null;
  /** employee_bank_detail.account_holder_name — blank on almost every row. */
  account_holder_name: string | null;
  /** Frozen legacy column. Compared, never paid to. */
  legacy_employee_column_account: string | null;
  has_open_change_request: boolean;
  /** Set when another employee holds the same account number. */
  duplicate_of_employee_code: string | null;
  /** The account db_bill actually credited in the verification month, if any. */
  credited_account: string | null;
  /** True when db_bill confirmed the employee received that credit. */
  credit_receipt_confirmed: boolean;
}

export interface BankReadinessResult {
  employee_id: string;
  employee_code: string;
  employee_name: string;
  readiness_class: BankReadinessClass;
  reasons: BankReadinessReason[];
  /** Human-readable, non-sensitive. Never contains a full account number. */
  reason_detail: string;
  account_masked: string | null;
  ifsc_code: string | null;
  bank_name: string | null;
  /** Where the beneficiary name came from. See the beneficiary note below. */
  beneficiary_name: string | null;
  beneficiary_source: "bank_record" | "employee_record" | "none";
  beneficiary_unconfirmed: boolean;
  recoverable_from_db_bill: boolean;
  payable: boolean;
}

/**
 * BENEFICIARY NAME
 *   account_holder_name is blank on 928 of 944 active-employee bank records, and the live
 *   /bank-export already substitutes employees.full_name for it without saying so. Per the
 *   payroll owner's ruling (2026-08-13) the fallback stays — blocking 928 people over a field
 *   the bank does not match on would be worse than the risk — but it is now FLAGGED rather than
 *   silent: beneficiary_unconfirmed = true says nobody has confirmed this name against what the
 *   bank holds for the account. It does not by itself make a row unpayable.
 */
function resolveBeneficiary(input: BankReadinessInput): {
  name: string | null;
  source: "bank_record" | "employee_record" | "none";
  unconfirmed: boolean;
} {
  const onRecord = String(input.account_holder_name ?? "").trim();
  if (onRecord) return { name: onRecord, source: "bank_record", unconfirmed: false };
  const fallback = String(input.employee_name ?? "").trim();
  if (fallback) return { name: fallback, source: "employee_record", unconfirmed: true };
  return { name: null, source: "none", unconfirmed: true };
}

/**
 * Classify one employee. Pure — no I/O — so the precedence below is unit-testable without a
 * database. Every branch returns, so exactly one class is assigned.
 *
 * PRECEDENCE, worst first. The order is deliberate:
 *   1. A structurally ambiguous record (two active primaries) outranks everything: we cannot
 *      even say which record we would be judging.
 *   2. Absence outranks quality checks — there is nothing to check.
 *   3. Conflicts outrank INVALID: a well-formed number that disagrees with what was actually
 *      credited is more dangerous than a malformed one, because it would silently pay.
 *   4. PENDING_APPROVAL sits below the data faults so an in-flight request cannot mask one.
 *   5. BLOCKED is last before READY: everything about the record is fine, but nothing
 *      independent confirms it belongs to this employee.
 */
export function classifyBankReadiness(input: BankReadinessInput): BankReadinessResult {
  const bene = resolveBeneficiary(input);
  const base = {
    employee_id: input.employee_id,
    employee_code: input.employee_code,
    employee_name: input.employee_name,
    account_masked: input.account_number ? maskAccount(input.account_number) : null,
    ifsc_code: input.ifsc_code ?? null,
    bank_name: input.bank_name ?? null,
    beneficiary_name: bene.name,
    beneficiary_source: bene.source,
    beneficiary_unconfirmed: bene.unconfirmed,
    recoverable_from_db_bill: false,
  };
  const out = (
    readiness_class: BankReadinessClass,
    reasons: BankReadinessReason[],
    reason_detail: string,
    extra: Partial<BankReadinessResult> = {},
  ): BankReadinessResult => ({
    ...base,
    readiness_class,
    reasons,
    reason_detail,
    payable: readiness_class === "READY",
    ...extra,
  });

  // 1 ── structurally ambiguous
  if (input.active_primary_count > 1) {
    return out(
      "CONFLICT",
      ["multiple_active_primary_records"],
      `${input.active_primary_count} active primary bank records — cannot determine which one to pay`,
    );
  }

  // 2 ── nothing to pay to
  const account = normaliseAccount(input.account_number);
  if (!account) {
    const recoverable = !!normaliseAccount(input.credited_account);
    const reason: BankReadinessReason = input.active_primary_count === 0
      ? "no_primary_bank_record"
      : "account_number_empty";
    if (input.has_open_change_request) {
      return out(
        "PENDING_APPROVAL",
        ["change_request_awaiting_approval", reason],
        "No usable bank record; a change request is awaiting approval",
        { recoverable_from_db_bill: recoverable },
      );
    }
    return out(
      "MISSING",
      [reason],
      recoverable
        ? "No bank record in HRMS. The account that received the last confirmed salary credit is known and can be proposed for approval."
        : "No bank record in HRMS, and no prior salary credit to recover one from. Must be collected from the employee.",
      { recoverable_from_db_bill: recoverable },
    );
  }

  // 3 ── conflicts
  if (input.account_sources_conflict) {
    return out(
      "CONFLICT",
      ["encrypted_and_legacy_columns_disagree"],
      "The encrypted and legacy account columns hold different numbers — HR must confirm which is correct",
    );
  }
  // A corrupt account is never a duplicate, however identical two of them look.
  //
  // Excel mangles long account numbers into scientific notation on import, and every distinct
  // number that rounds to the same mantissa collapses to the same string. Verified live
  // 2026-08-16: all three "shared" accounts among active employees are exactly that —
  // 6.276E+15 (MAS20525, MAS27845), 8.5962E+12 (MAS26744, MAS27953) and 9.0901E+14
  // (MAS07170, MAS07629). 32 of 944 active primary accounts carry the corruption.
  //
  // Because this check ran before the quality check below, all six were reported as
  // "account_shared_with_another_employee" — sending HR to investigate a shared-account fraud
  // that does not exist, when the actual defect is that six account numbers were destroyed on
  // import and none of the six people can be paid. Payability is unchanged either way; the
  // reason code is the whole point of the report.
  if (input.duplicate_of_employee_code && !isCorruptAccount(account)) {
    return out(
      "CONFLICT",
      ["account_shared_with_another_employee"],
      `This account number is also the primary account of employee ${input.duplicate_of_employee_code}`,
    );
  }
  const credited = normaliseAccount(input.credited_account);
  if (credited && credited !== account) {
    return out(
      "CONFLICT",
      ["disagrees_with_credited_account"],
      `The account on file (${maskAccount(account)}) is not the account the last salary was credited to (${maskAccount(credited)})`,
    );
  }

  // 4 ── quality
  const invalidReasons: BankReadinessReason[] = [];
  const invalidDetail: string[] = [];
  if (isCorruptAccount(account)) {
    invalidReasons.push("account_number_corrupt");
    invalidDetail.push(
      SCIENTIFIC_NOTATION_RE.test(account)
        ? "account number was truncated to scientific notation by a spreadsheet and its digits cannot be recovered"
        : "account number is not a valid 6–20 digit account number",
    );
  }
  if (!isValidIfsc(input.ifsc_code)) {
    invalidReasons.push("ifsc_invalid_format");
    invalidDetail.push(
      `IFSC '${String(input.ifsc_code ?? "").trim() || "(empty)"}' does not match the RBI format AAAA0BBBBBB`,
    );
  }
  if (invalidReasons.length) {
    return out("INVALID", invalidReasons, invalidDetail.join("; "));
  }

  // 5 ── in-flight change
  if (input.has_open_change_request) {
    return out(
      "PENDING_APPROVAL",
      ["change_request_awaiting_approval"],
      "A bank change request is awaiting approval — pay on the current record or wait for the decision",
    );
  }

  // 6 ── unverifiable
  if (!credited) {
    return out(
      "BLOCKED",
      ["no_payment_history_to_verify_against"],
      "No prior salary credit exists for this employee, so the account cannot be independently confirmed",
    );
  }
  if (!input.credit_receipt_confirmed) {
    return out(
      "BLOCKED",
      ["credit_receipt_unconfirmed"],
      "The account matches the last salary credit, but receipt of that credit has not been confirmed",
    );
  }

  // 7 ── payable
  return out(
    "READY",
    ["verified_against_confirmed_credit"],
    "Account matches the account that received the last confirmed salary credit",
  );
}

/** Applied when db_bill cannot be reached — see the degradation note in the file header. */
export function degradeUnverifiable(result: BankReadinessResult): BankReadinessResult {
  if (result.readiness_class !== "READY" && result.readiness_class !== "BLOCKED") return result;
  return {
    ...result,
    readiness_class: "BLOCKED",
    reasons: ["bank_source_unavailable"],
    reason_detail:
      "The payment-history source (db_bill) could not be reached, so no account can be confirmed. This is a system fault, not a fault on the employee's record.",
    payable: false,
  };
}

// ─── Data access ─────────────────────────────────────────────────────────────

export interface VerificationSource {
  available: boolean;
  /** SalDate of the month used, e.g. "2026-06-30". Null when unavailable. */
  month: string | null;
  confirmed_credits: number;
  error: string | null;
}

interface CreditRow extends RowDataPacket {
  EmpCode: string;
  AcNo: string;
  SalaryReceiveStatus: string | null;
}

/**
 * The newest SalDate that actually carries confirmed receipts.
 *
 * Not MAX(SalDate): see the header. A month whose receipts have not been stamped yet would
 * verify nobody, and the report would say the entire workforce is BLOCKED — a confident wrong
 * answer about who can be paid, which is exactly what this module must not produce.
 *
 * db_bill is MySQL 5.5.44 — no CTEs, no window functions.
 */
export async function resolveVerificationMonth(): Promise<string | null> {
  const rows = await billQuery<RowDataPacket & { SalDate: string; n: number }>(
    `SELECT SalDate, COUNT(*) AS n
       FROM salary_data
      WHERE SalaryReceiveStatus = 'YES'
        AND AcNo IS NOT NULL AND TRIM(AcNo) <> ''
      GROUP BY SalDate
      ORDER BY SalDate DESC
      LIMIT 1`,
  );
  const row = rows[0];
  if (!row?.SalDate) return null;
  // mysql2 hands DATE back as a Date on some driver settings and a string on others.
  return typeof row.SalDate === "string" ? row.SalDate : new Date(row.SalDate).toISOString().slice(0, 10);
}

/**
 * Credits for the verification month, keyed by upper-cased employee code.
 *
 * Returns an UNAVAILABLE source rather than throwing when db_bill is down. The caller degrades
 * every row explicitly; a throw here would 500 the whole page and tell the user nothing about
 * which half of the answer was lost.
 */
export async function loadCreditedAccounts(): Promise<{
  source: VerificationSource;
  credits: Map<string, { account: string; confirmed: boolean }>;
}> {
  const credits = new Map<string, { account: string; confirmed: boolean }>();
  try {
    const month = await resolveVerificationMonth();
    if (!month) {
      return {
        source: {
          available: false,
          month: null,
          confirmed_credits: 0,
          error: "db_bill holds no salary row with a confirmed receipt",
        },
        credits,
      };
    }
    const rows = await billQuery<CreditRow>(
      `SELECT EmpCode, AcNo, SalaryReceiveStatus
         FROM salary_data
        WHERE SalDate = ?
          AND AcNo IS NOT NULL AND TRIM(AcNo) <> ''`,
      [month],
    );
    // CONFIRMATION IS NOT PER-MONTH - IT IS PER ACCOUNT, ACROSS ALL HISTORY.
    //
    // SalaryReceiveStatus is stamped when receipt is confirmed, and that stamping lags the
    // run unevenly: 2026-07 carries 1,071 confirmations against 1,371 rows, while 2026-06
    // carries 1,122 of 1,432. Reading confirmation from the verification month ALONE
    // therefore blocks an employee whose account has been receiving confirmed salary for
    // years, purely because this one month has not been stamped yet.
    //
    // Measured 2026-08-30: of 271 employees whose 2026-07 receipt is unconfirmed, 120 have
    // a confirmed credit to THE SAME ACCOUNT in an earlier month.
    //
    // What verification actually asks is "has money ever demonstrably reached this
    // account", and one confirmed credit answers it permanently. An employee who CHANGES
    // bank is unaffected: their new account matches no confirmed credit, so they stay
    // unverified and go through penny-drop, which is the intended route for a change.
    const confirmedRows = await billQuery<RowDataPacket & { EmpCode: string; AcNo: string }>(
      `SELECT DISTINCT EmpCode, AcNo
         FROM salary_data
        WHERE SalaryReceiveStatus = 'YES'
          AND AcNo IS NOT NULL AND TRIM(AcNo) <> ''`,
    );
    const everConfirmed = new Set<string>();
    for (const r of confirmedRows) {
      const k = String(r.EmpCode ?? "").trim().toUpperCase();
      if (!k) continue;
      everConfirmed.add(`${k}|${normaliseAccount(r.AcNo)}`);
    }

    for (const r of rows) {
      const key = String(r.EmpCode ?? "").trim().toUpperCase();
      if (!key) continue;
      const account = normaliseAccount(r.AcNo);
      credits.set(key, {
        account,
        confirmed:
          String(r.SalaryReceiveStatus ?? "").toUpperCase() === "YES" ||
          everConfirmed.has(`${key}|${account}`),
      });
    }

    // Employees with no row in the verification month at all, but with a confirmed credit in
    // an earlier one. Without this they fall to no_payment_history_to_verify_against, the
    // reason reserved for someone who has genuinely never been paid - a new HRMS joiner.
    for (const compound of everConfirmed) {
      const sep = compound.lastIndexOf("|");
      const k = compound.slice(0, sep);
      const account = compound.slice(sep + 1);
      if (!credits.has(k)) credits.set(k, { account, confirmed: true });
    }
    return {
      source: {
        available: true,
        month,
        confirmed_credits: [...credits.values()].filter((c) => c.confirmed).length,
        error: null,
      },
      credits,
    };
  } catch (err) {
    const e = err as { code?: string; message?: string; name?: string };
    // A pool failure arrives as an AggregateError whose message is the EMPTY STRING, so the
    // obvious err.message alone renders as "db_bill unavailable: " and reads like a bug in
    // this line rather than a dead link. Same trap documented in scripts/bank-exception-report.ts.
    const detail = [e?.name, e?.code, e?.message].filter((p) => p && String(p).trim()).join(" | ");
    return {
      source: { available: false, month: null, confirmed_credits: 0, error: detail || String(err) },
      credits,
    };
  }
}

interface EmployeeBankRow extends RowDataPacket {
  employee_id: string;
  employee_code: string;
  employee_name: string;
  branch_id: string | null;
  branch_name: string | null;
  bank_detail_id: string | null;
  account_number_enc: string | null;
  account_number_legacy: string | null;
  ifsc_code: string | null;
  bank_name: string | null;
  account_holder_name: string | null;
  legacy_employee_column_account: string | null;
  active_primary_count: number;
  open_change_requests: number;
  official_email: string | null;
  personal_email: string | null;
}

/**
 * Every active employee, with their single active primary bank record if one exists.
 *
 * LEFT JOIN, not INNER: an employee with no bank record is the single largest exception class
 * (382 of 1,327 on 2026-08-13) and an inner join would silently drop exactly the people the
 * report exists to surface.
 *
 * account_number is varbinary(500) on this table, so it is CAST to CHAR before it reaches JS —
 * without the cast mysql2 returns a Buffer and every string comparison below fails open.
 */
/**
 * THE PAYMENT POPULATION. One definition, used by the readiness screen and the exporter.
 *
 * Owner ruling 2026-08-16 (decision 6): readiness follows the payroll RUN, not the staff list.
 *
 * This used to end `WHERE e.active_status = 1` unconditionally — "every active employee" — while
 * the payment file contains whoever has a payable line in the run. Two different lists judged by
 * one indicator. Measured on the live 2026-07 run: 1,273 positive-net lines, of which 161
 * (Rs 1,49,692.69) belong to employees who are no longer active_status = 1 and were therefore
 * never classified at all — they fell into a synthetic "NOT_ACTIVE" bucket produced by a `??`
 * fallback rather than by the classifier. Meanwhile 215 active employees with no payable line
 * in that run were counted, and could hold the gate red over money nobody was paying them.
 *
 * With a runId the population is the run's own payable lines. Without one it stays the
 * org-wide list, which is still the right answer for the standing bank-exceptions queue.
 *
 * `net_salary > 0` mirrors what the exporters treat as payable; run_id is matched explicitly
 * rather than by run_month, because two runs can share a month (2026-03 has twins) and joining
 * on the month alone doubles every row.
 */
async function loadEmployeeBankRows(runId?: string | null): Promise<EmployeeBankRow[]> {
  if (runId) {
    const [runRows] = await db.query<EmployeeBankRow[]>(
      `SELECT
         e.id                                                          AS employee_id,
         e.employee_code,
         COALESCE(NULLIF(TRIM(e.full_name), ''),
                  CONCAT(e.first_name, ' ', COALESCE(e.last_name, ''))) AS employee_name,
         e.branch_id,
         b.branch_name,
         e.official_email,
         e.personal_email,
         CAST(e.bank_account_number AS CHAR)                            AS legacy_employee_column_account,
         ebd.id                                                         AS bank_detail_id,
         ebd.account_number_enc,
         CAST(ebd.account_number AS CHAR)                               AS account_number_legacy,
         ebd.ifsc_code,
         ebd.bank_name,
         ebd.account_holder_name,
         (SELECT COUNT(*) FROM employee_bank_detail x
           WHERE x.employee_id = e.id AND x.active_status = 1 AND x.is_primary = 1)
                                                                        AS active_primary_count,
         (SELECT COUNT(*) FROM profile_update_approval p
           WHERE p.employee_id = e.id AND p.request_type = 'bank_details' AND p.status = 'pending')
                                                                        AS open_change_requests
       -- DISTINCT on the line side rather than GROUP BY on the result: an employee can hold
       -- more than one payable line in a run, and grouping the joined rows would both trip
       -- only_full_group_by and quietly change which bank row survives. This keeps the join
       -- shape byte-identical to the org-wide query below, so both populations classify the
       -- same way — including the multiple-active-primary case the classifier reports as
       -- CONFLICT rather than collapsing.
       FROM (SELECT DISTINCT employee_id
               FROM salary_prep_line
              WHERE run_id = ? AND COALESCE(net_salary, 0) > 0) pay
       JOIN employees e ON e.id = pay.employee_id
       LEFT JOIN employee_bank_detail ebd
              ON ebd.employee_id = e.id AND ebd.active_status = 1 AND ebd.is_primary = 1
       LEFT JOIN branch_master b ON b.id = e.branch_id
      ORDER BY e.employee_code`,
      [runId],
    );
    return runRows;
  }

  const [rows] = await db.query<EmployeeBankRow[]>(
    `SELECT
       e.id                                                          AS employee_id,
       e.employee_code,
       COALESCE(NULLIF(TRIM(e.full_name), ''),
                CONCAT(e.first_name, ' ', COALESCE(e.last_name, ''))) AS employee_name,
       e.branch_id,
       b.branch_name,
       e.official_email,
       e.personal_email,
       CAST(e.bank_account_number AS CHAR)                            AS legacy_employee_column_account,
       ebd.id                                                         AS bank_detail_id,
       ebd.account_number_enc,
       CAST(ebd.account_number AS CHAR)                               AS account_number_legacy,
       ebd.ifsc_code,
       ebd.bank_name,
       ebd.account_holder_name,
       (SELECT COUNT(*) FROM employee_bank_detail x
         WHERE x.employee_id = e.id AND x.active_status = 1 AND x.is_primary = 1)
                                                                      AS active_primary_count,
       (SELECT COUNT(*) FROM profile_update_approval p
         WHERE p.employee_id = e.id AND p.request_type = 'bank_details' AND p.status = 'pending')
                                                                      AS open_change_requests
     FROM employees e
     LEFT JOIN employee_bank_detail ebd
            ON ebd.employee_id = e.id AND ebd.active_status = 1 AND ebd.is_primary = 1
     LEFT JOIN branch_master b ON b.id = e.branch_id
    WHERE e.active_status = 1
    ORDER BY e.employee_code`,
  );
  return rows;
}

export interface BankReadinessReport {
  as_of: string;
  /** The run this population was scoped to, or null for the org-wide exceptions queue. */
  run_id: string | null;
  verification_source: VerificationSource;
  totals: Record<BankReadinessClass, number>;
  total_employees: number;
  payable_count: number;
  unresolved_count: number;
  gate_clear: boolean;
  rows: Array<BankReadinessResult & { branch_id: string | null; branch_name: string | null; has_email: boolean }>;
}

/**
 * Build the full readiness picture.
 *
 * as_of is stamped once, here, and carried onto the response. A page that recomputes it per
 * section can show two different answers on one screen.
 */
export async function buildBankReadinessReport(runId?: string | null): Promise<BankReadinessReport> {
  const as_of = new Date().toISOString();
  const [employeeRows, { source, credits }] = await Promise.all([
    loadEmployeeBankRows(runId),
    loadCreditedAccounts(),
  ]);

  // Resolve every account first, so the duplicate map is built from resolved values rather than
  // from whichever column happened to be populated. Building it from the raw legacy column would
  // miss a collision between an encrypted row and a legacy one.
  const resolved = employeeRows.map((r) => {
    const resolution = resolveAccountNumberWithConflict({
      account_number_enc: r.account_number_enc,
      account_number: r.account_number_legacy,
    });
    return { row: r, resolution };
  });

  const byAccount = new Map<string, string[]>();
  for (const { row, resolution } of resolved) {
    const acct = normaliseAccount(resolution.resolved);
    if (!acct) continue;
    const list = byAccount.get(acct) ?? [];
    list.push(row.employee_code);
    byAccount.set(acct, list);
  }

  const totals = Object.fromEntries(
    BANK_READINESS_CLASSES.map((c) => [c, 0]),
  ) as Record<BankReadinessClass, number>;

  const rows = resolved.map(({ row, resolution }) => {
    const acct = normaliseAccount(resolution.resolved);
    const sharers = acct ? (byAccount.get(acct) ?? []).filter((c) => c !== row.employee_code) : [];
    const credit = credits.get(String(row.employee_code ?? "").trim().toUpperCase());

    let result = classifyBankReadiness({
      employee_id: row.employee_id,
      employee_code: row.employee_code,
      employee_name: String(row.employee_name ?? "").trim(),
      active_primary_count: Number(row.active_primary_count ?? 0),
      account_number: acct || null,
      account_sources_conflict: resolution.status === "conflict",
      ifsc_code: row.ifsc_code,
      bank_name: row.bank_name,
      account_holder_name: row.account_holder_name,
      legacy_employee_column_account: row.legacy_employee_column_account,
      has_open_change_request: Number(row.open_change_requests ?? 0) > 0,
      duplicate_of_employee_code: sharers[0] ?? null,
      credited_account: credit?.account ?? null,
      credit_receipt_confirmed: credit?.confirmed ?? false,
    });
    if (!source.available) result = degradeUnverifiable(result);

    totals[result.readiness_class]++;
    return {
      ...result,
      branch_id: row.branch_id,
      branch_name: row.branch_name,
      has_email:
        !!String(row.official_email ?? "").trim() || !!String(row.personal_email ?? "").trim(),
    };
  });

  const payable_count = totals.READY;
  const unresolved_count = rows.length - payable_count;

  return {
    as_of,
    run_id: runId ?? null,
    verification_source: source,
    totals,
    total_employees: rows.length,
    payable_count,
    unresolved_count,
    gate_clear: unresolved_count === 0,
    rows,
  };
}

/**
 * The three payment paths and what each of them pays to, measured live.
 *
 * REPORTED, NOT FIXED — by explicit instruction (2026-08-13). Repointing bank-advice off
 * employees.bank_account_number changes where real salary money goes for the employees counted
 * here, which is a decision, not a cleanup. This function exists so the number is visible on the
 * page instead of living in a commit message.
 */
export async function getPaymentSourceDivergence(runId: string): Promise<{
  run_id: string;
  employees_column_only: number;
  bank_detail_only: number;
  both_and_differ: number;
  neither: number;
  note: string;
}> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
       SUM(emp_has = 1 AND ebd_has = 0)                  AS employees_column_only,
       SUM(emp_has = 0 AND ebd_has = 1)                  AS bank_detail_only,
       SUM(emp_has = 1 AND ebd_has = 1 AND same = 0)     AS both_and_differ,
       SUM(emp_has = 0 AND ebd_has = 0)                  AS neither
     FROM (
       SELECT
         (e.bank_account_number IS NOT NULL AND TRIM(e.bank_account_number) <> '')            AS emp_has,
         (ebd.id IS NOT NULL AND ebd.account_number IS NOT NULL AND LENGTH(ebd.account_number) > 0) AS ebd_has,
         (TRIM(CAST(e.bank_account_number AS CHAR)) = TRIM(CAST(ebd.account_number AS CHAR))) AS same
       FROM salary_prep_line spl
       JOIN employees e ON e.id = spl.employee_id
       LEFT JOIN employee_bank_detail ebd
              ON ebd.employee_id = e.id AND ebd.is_primary = 1 AND ebd.active_status = 1
      WHERE spl.run_id = ?
     ) x`,
    [runId],
  );
  const r = (rows[0] ?? {}) as Record<string, number | null>;
  return {
    run_id: runId,
    employees_column_only: Number(r.employees_column_only ?? 0),
    bank_detail_only: Number(r.bank_detail_only ?? 0),
    both_and_differ: Number(r.both_and_differ ?? 0),
    neither: Number(r.neither ?? 0),
    note:
      "bank-advice pays to employees.bank_account_number; neft-transfer-file and /bank-export pay to " +
      "employee_bank_detail. employees.bank_account_number has no writer in the application and is " +
      "frozen legacy data. Employees counted under both_and_differ would receive their salary at a " +
      "different account depending on which file is given to the bank.",
  };
}
