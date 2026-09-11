/**
 * Validated Bank Account MIS — the branch-wise bank-account status board, plus the
 * employee-level drill-down behind every count on it.
 *
 * WHAT THIS IS
 *   The legacy HRMS screen of the same name: one row per branch carrying
 *   Uploaded / Verified / Pending / Not Uploaded / Rejected / Total, where each count links to the
 *   employees behind it. Payroll HR uses it to find who cannot be paid before the run; the Payroll
 *   Head uses it to see whether a branch is clear.
 *
 * mas_hrms ONLY — NO db_bill
 *   Per the payroll owner's instruction this module reads mas_hrms and nothing else. It does not
 *   import billQuery and must not: adding a cross-server dependency here would make a status
 *   screen fail whenever the finance server is unreachable.
 *
 *   That is affordable because employee_bank_detail.verified is REAL DATA on this database.
 *   Measured live 2026-09-08 against mas_hrms: 1,004 of the 1,020 active employees holding an
 *   active primary bank row carry verified = 1; 1,040 of 13,233 rows overall. An older comment in
 *   bank-payment-readiness.service.ts says the flag is set on "5 of 12,768 rows" and warns against
 *   gating on it — that was true when written and is now STALE; the mark-bank-verified backfills
 *   have since populated it. Do not reinstate that warning without re-measuring.
 *
 *   The consequence to understand: Verified here means "someone/something marked this account
 *   verified in HRMS", which is a weaker claim than the Bank Payment Readiness page's READY (that
 *   one proves the account received a confirmed salary credit in db_bill). The two screens can
 *   therefore disagree about an individual, deliberately, because they are answering different
 *   questions. That is the accepted cost of keeping this screen on one database.
 *
 * THE BUCKETS ARE ADDITIVE, MATCHING THE LEGACY SCREEN'S OWN ARITHMETIC
 *   Total    = Uploaded + Not Uploaded
 *   Uploaded = Verified + Pending + Rejected
 *
 *   Confirmed against a live legacy screenshot (AHMEDABAD-JALDARSHAN): Uploaded 236, Verified 234,
 *   Pending 0, Not Uploaded 1, Rejected 2, Total 237 — 236 + 1 = 237 and 234 + 0 + 2 = 236. So
 *   "Uploaded" is not a sixth exclusive state; it is every employee who has a bank record at all,
 *   whatever its condition. Preserving that identity is what makes the row cross-foot.
 *
 * PRECEDENCE, WORST FIRST
 *   An employee lands in exactly one exclusive bucket, decided in this order:
 *     1. NOT UPLOADED — no active primary record, or a record with no account number.
 *     2. REJECTED     — an explicitly rejected bank change request, or data that cannot be paid:
 *                       corrupt account number, IFSC failing the RBI format, the account also
 *                       being another employee's, two active primary rows, or the encrypted and
 *                       legacy columns disagreeing.
 *     3. PENDING      — a bank change request awaiting approval, or simply not yet verified.
 *     4. VERIFIED     — verified = 1 and none of the above.
 *
 *   Faults outrank verified = 1 on purpose. A record flagged verified whose IFSC cannot be sent to
 *   a bank is not payable, and reporting it green would hide the one thing someone must fix. 3
 *   active employees are in exactly that state on this database.
 *
 * REJECTED IS REAL HERE, PARTLY
 *   profile_update_approval carries status 'rejected' and a reviewer_note for request_type =
 *   'bank_details', so an explicitly rejected account is a genuine signal rather than an invention.
 *   Measured 2026-09-08: 6 bank_details requests exist and all 6 are 'pending', so in practice
 *   today's Rejected column is populated by the data faults above. Both routes are implemented so
 *   the column starts working the moment a reviewer rejects something.
 *
 * PAYMENT MODE IS A CONSTANT, DELIBERATELY
 *   employee_bank_detail has no payment_mode column. Salary is paid by bank transfer, so the
 *   column renders a constant rather than being dropped (the legacy format is fixed) or invented
 *   per employee from salary_disbursal, which records what happened on one past payment and is not
 *   an attribute of the bank record. Per the payroll owner's instruction.
 *
 * ACCOUNT NUMBERS ARE MASKED HERE, ALWAYS
 *   Every row carries XXXX + last 4. This module has no full-account-number path. The digits come
 *   only from /payment-file, behind its own org-wide scope gate.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { resolveAccountNumberWithConflict } from "../../shared/fieldEncryption.js";
// Pure, database-free predicates. Imported rather than re-implemented so this screen judges
// account and IFSC quality by exactly the same rules the payment path does — importing them
// touches nothing in that module and pulls in no db_bill dependency.
import {
  isCorruptAccount,
  isValidIfsc,
  maskAccount,
  normaliseAccount,
} from "./bank-payment-readiness.service.js";

// ─── Bucket taxonomy ─────────────────────────────────────────────────────────

/** The five drill-down buckets, in the column order the legacy screen shows them. */
export const MIS_BUCKETS = ["uploaded", "verified", "pending", "not_uploaded", "rejected"] as const;
export type MisBucket = (typeof MIS_BUCKETS)[number];

/** The four states an employee can actually be in. "uploaded" is a union of three of them. */
export type ExclusiveBucket = Exclude<MisBucket, "uploaded">;

export const MIS_BUCKET_LABELS: Record<MisBucket, string> = {
  uploaded: "Uploaded",
  verified: "Verified",
  pending: "Pending",
  not_uploaded: "Not Uploaded",
  rejected: "Rejected",
};

/** Stable identifiers, not display strings — the UI maps them to copy. */
export type MisReason =
  | "no_primary_bank_record"
  | "account_number_empty"
  | "change_request_rejected"
  | "account_number_corrupt"
  | "ifsc_invalid_format"
  | "multiple_active_primary_records"
  | "account_shared_with_another_employee"
  | "encrypted_and_legacy_columns_disagree"
  | "change_request_awaiting_approval"
  | "not_yet_verified"
  | "verified_in_hrms";

/** Whether a class falls inside the requested bucket, honouring "uploaded" as a union. */
export function classMatchesBucket(bucket_of: ExclusiveBucket, requested: MisBucket): boolean {
  if (requested === "uploaded") return bucket_of !== "not_uploaded";
  return bucket_of === requested;
}

// ─── Shapes ──────────────────────────────────────────────────────────────────

export interface MisSummaryRow {
  branch_id: string | null;
  branch_name: string;
  uploaded: number;
  verified: number;
  pending: number;
  not_uploaded: number;
  rejected: number;
  total: number;
}

/** The legacy detail column set, one field per column, in display order. */
export interface MisDetailRow {
  employee_id: string;
  emp_code: string;
  emp_name: string;
  branch: string;
  cost_center: string;
  ac_holder_name: string;
  account_no: string;
  bank_name: string;
  ifsc_code: string;
  account_type: string;
  payment_mode: string;
  remarks: string;
  /** Carried for UI badging/filtering, not part of the legacy column set. */
  bucket: ExclusiveBucket;
  reasons: MisReason[];
}

export interface MisSummaryResult {
  as_of: string;
  rows: MisSummaryRow[];
  totals: MisSummaryRow;
}

/**
 * Salary is disbursed by bank transfer. A constant because the schema has no per-employee payment
 * mode, not because the value is unknown.
 */
export const PAYMENT_MODE = "NEFT/Bank Transfer";

const UNASSIGNED = "UNASSIGNED";

/** The legacy detail header row, used by the UI table, the CSV export and the catalogue report. */
export const MIS_DETAIL_COLUMNS: ReadonlyArray<{ key: keyof MisDetailRow; label: string }> = [
  { key: "emp_code", label: "EmpCode" },
  { key: "emp_name", label: "EmpName" },
  { key: "branch", label: "Branch" },
  { key: "cost_center", label: "CostCenter" },
  { key: "ac_holder_name", label: "ACHolderName" },
  { key: "account_no", label: "Account No" },
  { key: "bank_name", label: "Bank Name" },
  { key: "ifsc_code", label: "IFSC Code" },
  { key: "account_type", label: "Account Type" },
  { key: "payment_mode", label: "Payment Mode" },
  { key: "remarks", label: "Remarks" },
];

// ─── Classification (pure) ───────────────────────────────────────────────────

export interface MisClassifyInput {
  active_primary_count: number;
  /** Resolved account number, or null when there is no record / no number. */
  account_number: string | null;
  /** True when the encrypted and legacy columns hold different values. */
  account_sources_conflict: boolean;
  ifsc_code: string | null;
  verified: boolean;
  /** Another employee holding the same resolved account number, if any. */
  duplicate_of_employee_code: string | null;
  /** Latest bank_details request state, or null when the employee has never raised one. */
  change_request_status: "pending" | "approved" | "rejected" | null;
}

export interface MisClassification {
  bucket: ExclusiveBucket;
  reasons: MisReason[];
  detail: string;
}

/**
 * Decide one employee's bucket. Pure — no I/O — so the precedence is unit-testable without a
 * database. Every branch returns, so exactly one bucket is assigned.
 */
export function classifyMisBucket(input: MisClassifyInput): MisClassification {
  const out = (bucket: ExclusiveBucket, reasons: MisReason[], detail: string): MisClassification => ({
    bucket,
    reasons,
    detail,
  });

  // 1 ── nothing to pay to
  const account = normaliseAccount(input.account_number);
  if (!account) {
    return input.active_primary_count === 0
      ? out("not_uploaded", ["no_primary_bank_record"], "No bank account uploaded in HRMS.")
      : out(
          "not_uploaded",
          ["account_number_empty"],
          "A bank record exists but carries no account number.",
        );
  }

  // 2 ── rejected: an explicit decision, or data that cannot be paid
  if (input.change_request_status === "rejected") {
    return out(
      "rejected",
      ["change_request_rejected"],
      "The submitted bank account was rejected on review.",
    );
  }
  if (input.active_primary_count > 1) {
    return out(
      "rejected",
      ["multiple_active_primary_records"],
      `${input.active_primary_count} active primary bank records — cannot determine which to pay.`,
    );
  }
  if (input.account_sources_conflict) {
    return out(
      "rejected",
      ["encrypted_and_legacy_columns_disagree"],
      "The encrypted and legacy account columns hold different numbers — HR must confirm which is correct.",
    );
  }

  const faults: MisReason[] = [];
  const detail: string[] = [];

  // A corrupt account is never a duplicate, however identical two of them look: a spreadsheet
  // mangles long numbers into scientific notation, and every distinct number that rounds to the
  // same mantissa collapses to the same string. Reporting those as a shared account sends someone
  // to investigate a fraud that does not exist when the real defect is destroyed digits.
  if (isCorruptAccount(account)) {
    faults.push("account_number_corrupt");
    detail.push("account number is not a valid 6-20 digit account number");
  } else if (input.duplicate_of_employee_code) {
    faults.push("account_shared_with_another_employee");
    detail.push(`account is also the primary account of employee ${input.duplicate_of_employee_code}`);
  }
  if (!isValidIfsc(input.ifsc_code)) {
    faults.push("ifsc_invalid_format");
    detail.push(
      `IFSC '${String(input.ifsc_code ?? "").trim() || "(empty)"}' does not match the RBI format AAAA0BBBBBB`,
    );
  }
  if (faults.length) {
    // Ahead of verified = 1 on purpose — see the precedence note in the file header.
    return out("rejected", faults, `Cannot be paid: ${detail.join("; ")}.`);
  }

  // 3 ── in flight
  if (input.change_request_status === "pending") {
    return out(
      "pending",
      ["change_request_awaiting_approval"],
      "A bank account change is awaiting approval.",
    );
  }

  // 4 ── not yet confirmed
  if (!input.verified) {
    return out(
      "pending",
      ["not_yet_verified"],
      "Bank account uploaded but not yet verified.",
    );
  }

  return out("verified", ["verified_in_hrms"], "Bank account verified.");
}

// ─── Data access ─────────────────────────────────────────────────────────────

interface BankRow extends RowDataPacket {
  employee_id: string;
  employee_code: string | null;
  employee_name: string | null;
  branch_id: string | null;
  branch_name: string | null;
  cost_centre_code: string | null;
  account_number_enc: string | null;
  account_number_legacy: string | null;
  ifsc_code: string | null;
  bank_name: string | null;
  account_type: string | null;
  account_holder_name: string | null;
  verified: number | null;
  active_primary_count: number;
  change_request_status: string | null;
  reviewer_note: string | null;
  exception_note: string | null;
}

/**
 * Every active employee, with their single active primary bank record if one exists.
 *
 * LEFT JOIN, not INNER: an employee with no bank record is the whole point of the Not Uploaded
 * column (47 of 1,067 active on 2026-09-08) and an inner join would silently drop exactly the
 * people the screen exists to surface.
 *
 * account_number is varbinary(500), so it is CAST to CHAR before it reaches JS — without the cast
 * mysql2 returns a Buffer and every string comparison fails open.
 *
 * The latest bank_details request is picked by a correlated subquery on requested_at rather than a
 * GROUP BY join, so an employee with several requests contributes exactly one row and the bank row
 * cannot be duplicated by the join.
 */
async function loadBankRows(): Promise<BankRow[]> {
  const [rows] = await db.query<BankRow[]>(
    `SELECT
       e.id                                                           AS employee_id,
       e.employee_code,
       COALESCE(NULLIF(TRIM(e.full_name), ''),
                CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')))  AS employee_name,
       e.branch_id,
       b.branch_name,
       cc.cost_centre_code,
       ebd.account_number_enc,
       CAST(ebd.account_number AS CHAR)                                AS account_number_legacy,
       ebd.ifsc_code,
       ebd.bank_name,
       ebd.account_type,
       ebd.account_holder_name,
       ebd.verified,
       (SELECT COUNT(*) FROM employee_bank_detail x
         WHERE x.employee_id = e.id AND x.active_status = 1 AND x.is_primary = 1)
                                                                       AS active_primary_count,
       (SELECT p.status FROM profile_update_approval p
         WHERE p.employee_id = e.id AND p.request_type = 'bank_details'
         ORDER BY p.requested_at DESC LIMIT 1)                          AS change_request_status,
       (SELECT p.reviewer_note FROM profile_update_approval p
         WHERE p.employee_id = e.id AND p.request_type = 'bank_details'
         ORDER BY p.requested_at DESC LIMIT 1)                          AS reviewer_note,
       (SELECT x.notes FROM payroll_bank_exception x
         WHERE x.employee_id = e.id LIMIT 1)                            AS exception_note
     FROM employees e
     LEFT JOIN employee_bank_detail ebd
            ON ebd.employee_id = e.id AND ebd.active_status = 1 AND ebd.is_primary = 1
     LEFT JOIN branch_master b ON b.id = e.branch_id
     LEFT JOIN cost_centre_master cc ON cc.id = e.cost_centre_id
    WHERE e.active_status = 1
    ORDER BY e.employee_code`,
  );
  return rows;
}

interface ClassifiedRow {
  row: BankRow;
  classification: MisClassification;
  account: string;
}

/**
 * Load and classify the whole active population once.
 *
 * Resolve every account before building the duplicate map, so the map is keyed on resolved values
 * rather than on whichever column happened to be populated — built from the raw legacy column it
 * would miss a collision between an encrypted row and a legacy one.
 */
async function loadClassified(): Promise<{ as_of: string; rows: ClassifiedRow[] }> {
  const as_of = new Date().toISOString();
  const raw = await loadBankRows();

  const resolved = raw.map((row) => {
    const resolution = resolveAccountNumberWithConflict({
      account_number_enc: row.account_number_enc,
      account_number: row.account_number_legacy,
    });
    return { row, resolution, account: normaliseAccount(resolution.resolved) };
  });

  const byAccount = new Map<string, string[]>();
  for (const { row, account } of resolved) {
    if (!account) continue;
    const list = byAccount.get(account) ?? [];
    list.push(String(row.employee_code ?? ""));
    byAccount.set(account, list);
  }

  const status = (v: string | null): MisClassifyInput["change_request_status"] => {
    const s = String(v ?? "").trim().toLowerCase();
    return s === "pending" || s === "approved" || s === "rejected" ? s : null;
  };

  const rows = resolved.map(({ row, resolution, account }) => {
    const sharers = account
      ? (byAccount.get(account) ?? []).filter((c) => c !== String(row.employee_code ?? ""))
      : [];
    return {
      row,
      account,
      classification: classifyMisBucket({
        active_primary_count: Number(row.active_primary_count ?? 0),
        account_number: account || null,
        account_sources_conflict: resolution.status === "conflict",
        ifsc_code: row.ifsc_code,
        verified: Number(row.verified ?? 0) === 1,
        duplicate_of_employee_code: sharers[0] ?? null,
        change_request_status: status(row.change_request_status),
      }),
    };
  });

  return { as_of, rows };
}

// ─── Projection ──────────────────────────────────────────────────────────────

/**
 * Restrict to the branches this caller may see.
 *
 * null means no restriction — an org-wide caller, or (deliberately) a caller with no scope rows at
 * all. Same convention as resolveVisibleBranchIds() in bank-payment-readiness.routes.ts.
 */
function applyScope(
  rows: ClassifiedRow[],
  visibleBranchIds: Set<string> | null,
  branchId?: string | null,
): ClassifiedRow[] {
  let out = rows;
  if (visibleBranchIds) out = out.filter((r) => r.row.branch_id && visibleBranchIds.has(r.row.branch_id));
  if (branchId) out = out.filter((r) => r.row.branch_id === branchId);
  return out;
}

function emptySummaryRow(branch_id: string | null, branch_name: string): MisSummaryRow {
  return {
    branch_id,
    branch_name,
    uploaded: 0,
    verified: 0,
    pending: 0,
    not_uploaded: 0,
    rejected: 0,
    total: 0,
  };
}

/**
 * Branch-wise counts, plus a totals row.
 *
 * Branches are keyed by branch_id, not branch_name: two branches can carry the same display name
 * and collapsing them would report one row whose counts belong to two places.
 */
export async function buildValidatedBankAccountMisSummary(options: {
  visibleBranchIds: Set<string> | null;
  branchId?: string | null;
}): Promise<MisSummaryResult> {
  const { as_of, rows: all } = await loadClassified();
  const rows = applyScope(all, options.visibleBranchIds, options.branchId);

  const byBranch = new Map<string, MisSummaryRow>();
  const totals = emptySummaryRow(null, "Total");

  for (const { row, classification } of rows) {
    const key = row.branch_id ?? UNASSIGNED;
    let summary = byBranch.get(key);
    if (!summary) {
      summary = emptySummaryRow(row.branch_id, row.branch_name ?? UNASSIGNED);
      byBranch.set(key, summary);
    }

    const bucket = classification.bucket;
    summary[bucket]++;
    summary.total++;
    totals[bucket]++;
    totals.total++;

    // Uploaded is the union: everyone with a bank record at all. Derived, never assigned, so every
    // row satisfies total = uploaded + not_uploaded.
    if (bucket !== "not_uploaded") {
      summary.uploaded++;
      totals.uploaded++;
    }
  }

  return {
    as_of,
    rows: [...byBranch.values()].sort((a, b) => a.branch_name.localeCompare(b.branch_name)),
    totals,
  };
}

/**
 * The employees behind one count, in the legacy column set.
 *
 * ACHolderName shows the name on the BANK RECORD only, and is blank when there is none. It is
 * blank on 711 of 1,020 active bank records (measured 2026-09-08), and substituting the employee's
 * own name — which the payment path does, flagging it unconfirmed — would report all 711 as
 * complete and hide the gap this screen exists to find.
 */
export async function buildValidatedBankAccountMisDetail(options: {
  visibleBranchIds: Set<string> | null;
  branchId?: string | null;
  bucket?: MisBucket | null;
  search?: string | null;
}): Promise<{ as_of: string; rows: MisDetailRow[] }> {
  const { as_of, rows: all } = await loadClassified();
  let rows = applyScope(all, options.visibleBranchIds, options.branchId);

  if (options.bucket) {
    const wanted = options.bucket;
    rows = rows.filter((r) => classMatchesBucket(r.classification.bucket, wanted));
  }

  const q = String(options.search ?? "").trim().toLowerCase();
  if (q) {
    rows = rows.filter(
      (r) =>
        String(r.row.employee_code ?? "").toLowerCase().includes(q) ||
        String(r.row.employee_name ?? "").toLowerCase().includes(q),
    );
  }

  const detail = rows.map(({ row, classification, account }): MisDetailRow => {
    // Remarks: what is wrong, then any human note. The reviewer's rejection reason and an
    // exception owner's note are the two places a person explains a case, and they are what makes
    // this column worth reading rather than a restatement of the bucket.
    const notes = [
      String(row.reviewer_note ?? "").trim(),
      String(row.exception_note ?? "").trim(),
    ].filter(Boolean);
    const remarks = notes.length
      ? `${classification.detail} Note: ${notes.join(" | ")}`
      : classification.detail;

    return {
      employee_id: row.employee_id,
      emp_code: row.employee_code ?? "",
      emp_name: row.employee_name ?? "",
      branch: row.branch_name ?? UNASSIGNED,
      cost_center: row.cost_centre_code ?? "",
      ac_holder_name: String(row.account_holder_name ?? "").trim(),
      account_no: account ? maskAccount(account) : "",
      bank_name: String(row.bank_name ?? "").trim(),
      ifsc_code: String(row.ifsc_code ?? "").trim(),
      account_type: String(row.account_type ?? "").trim(),
      // Blank for an employee with no account to pay into, rather than asserting a mode for a
      // payment that cannot be made.
      payment_mode: classification.bucket === "not_uploaded" ? "" : PAYMENT_MODE,
      remarks,
      bucket: classification.bucket,
      reasons: classification.reasons,
    };
  });

  return { as_of, rows: detail };
}
