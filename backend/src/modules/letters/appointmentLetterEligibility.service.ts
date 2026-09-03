/**
 * Who may be issued an appointment letter.
 *
 * The letter is the last step of joining formalities, so it is only offered once
 * everything it depends on is genuinely finished. Every reason is returned to HR
 * rather than collapsing to a single "not eligible" — an HR user needs to know
 * which document is missing, not that something is.
 *
 * Reuses the definitions that already exist rather than inventing parallel ones:
 *
 *   BGV passed = candidate_bgv_report.overall_status = 'clear' AND
 *                is_auto_approved = 0. That exact expression appears three times
 *                in reconciliation.service.ts and is the codebase's canonical
 *                "BGV really passed" test. An auto-approved report is explicitly
 *                not a pass — it is a report nobody looked at.
 *
 *   Documents complete = every mandatory checklist row in the terminal set
 *                ('verified','completed','esign_completed','signed_verified',
 *                'wet_signed_uploaded'), mirroring isChecklistTerminalStatus and
 *                the live payroll gate in payroll-governance.service.ts. Wet
 *                signatures count: they are HR-gated and cannot be self-asserted.
 *
 *   Joining kit e-signed = separate from the above: at least one mandatory
 *                checklist row has actually reached an e-sign/wet-signature
 *                terminal state, not merely "verified" some other way.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { getApplicableChecks } from "../ats/bgv-verification.service.js";

export type EligibilityBlocker = {
  code: string;
  reason: string;
  /** 'critical' blocks issuance; 'warning' is shown but does not stop it. */
  severity: "critical" | "warning";
};

export type EligibilityResult = {
  employeeId: string;
  employeeCode: string | null;
  employeeName: string | null;
  eligible: boolean;
  blockers: EligibilityBlocker[];
  warnings: EligibilityBlocker[];
  /** Already issued — carries the existing letter number. */
  alreadyIssued: boolean;
  existingLetterNumber: string | null;
};

/** Statuses that mean a checklist item is genuinely finished. */
export const TERMINAL_DOCUMENT_STATUSES = [
  "verified", "completed", "esign_completed", "signed_verified", "wet_signed_uploaded",
] as const;

/**
 * The EPF forms, which do not gate the appointment letter.
 *
 * They are statutory provident-fund paperwork on a deliberately separate track,
 * not part of the employment agreement the letter concludes. joiningKitAssembly's
 * KIT_DOCUMENT_CODES excludes them from the e-sign kit for the same reason and
 * spells it out: they are AcroForms with their own consent receipt, correction
 * loop, payroll review stage and company-seal step, and Form 2 alone carries 53
 * fields of statutory nominee data. Because they sit outside the kit they finish
 * days or weeks after the six kit documents do — so counting them here held every
 * appointment letter behind PF paperwork the letter does not depend on.
 *
 * They remain mandatory and still count towards joining-document completion on
 * the tracker; this exclusion is scoped to this one gate.
 */
const EPF_DOCUMENT_CODES = ["EPF_DECLARATION", "EPF_NOMINATION_FORM2"] as const;

/**
 * Which BGV categories are still holding this report back, in HR's words.
 *
 * Applicability comes from getApplicableChecks() — the same function that builds
 * the BGV score denominator — rather than a second copy of the "criminal only for
 * managers, employment only for non-freshers" rules, so this cannot name a check
 * the report never needed. DigiLocker verified covers aadhaar and pan together,
 * mirroring deriveOverallStatus().
 *
 * A category counts as done only at 'passed' or 'waived'. Everything else —
 * 'not_run', 'partial', 'failed' — is outstanding, which is the honest reading:
 * education and address have no automated provider, so they sit at 'not_run'
 * until a human marks them, and that is precisely what HR needs telling.
 */
async function outstandingBgvCategories(
  candidateId: string,
  report: RowDataPacket,
): Promise<string[]> {
  const { includeEmployment, includeCriminal } = await getApplicableChecks(candidateId)
    // A failure here must not cost HR the blocker itself — fall back to the
    // narrower base set rather than throwing away the whole eligibility answer.
    .catch(() => ({ includeEmployment: false, includeCriminal: false }));

  const done = (col: string) => {
    const v = String(report[col] ?? "").trim().toLowerCase();
    return v === "passed" || v === "waived" || v === "verified";
  };

  const outstanding: string[] = [];
  if (!done("digilocker_status")) {
    if (!done("aadhaar_status")) outstanding.push("Aadhaar");
    if (!done("pan_status")) outstanding.push("PAN");
  }
  if (!done("bank_status")) outstanding.push("bank");
  if (!done("education_status")) outstanding.push("education");
  if (!done("address_status")) outstanding.push("address");
  if (includeEmployment && !done("employment_status")) outstanding.push("employment");
  if (includeCriminal && !done("criminal_status")) outstanding.push("criminal");
  return outstanding;
}

export async function evaluateAppointmentLetterEligibility(employeeId: string): Promise<EligibilityResult> {
  const blockers: EligibilityBlocker[] = [];
  const warnings: EligibilityBlocker[] = [];

  const [empRows] = await db.execute<RowDataPacket[]>(
    `SELECT e.id, e.employee_code, e.branch_id, e.date_of_joining,
            COALESCE(NULLIF(TRIM(e.full_name), ''), TRIM(CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')))) AS full_name,
            b.branch_name, COALESCE(b.address, '') AS branch_address,
            d.designation_name,
            (SELECT ab.candidate_id FROM ats_onboarding_bridge ab WHERE ab.employee_id = e.id LIMIT 1) AS candidate_id
       FROM employees e
       LEFT JOIN branch_master b ON b.id = e.branch_id
       LEFT JOIN designation_master d ON d.id = e.designation_id
      WHERE e.id = ? LIMIT 1`,
    [employeeId],
  ).catch(() => [[]] as unknown as [RowDataPacket[]]);

  const emp = (empRows as RowDataPacket[])[0];
  if (!emp) {
    return {
      employeeId, employeeCode: null, employeeName: null, eligible: false,
      blockers: [{ code: "employee_not_found", reason: "No such employee.", severity: "critical" }],
      warnings: [], alreadyIssued: false, existingLetterNumber: null,
    };
  }

  // ── already issued ────────────────────────────────────────────────────────
  const [issued] = await db.execute<RowDataPacket[]>(
    `SELECT letter_number FROM appointment_letter_issue
      WHERE employee_id = ? AND status <> 'revoked'
      ORDER BY issued_at DESC LIMIT 1`,
    [employeeId],
  ).catch(() => [[]] as unknown as [RowDataPacket[]]);
  const existing = (issued as RowDataPacket[])[0];

  // ── BGV ───────────────────────────────────────────────────────────────────
  const candidateId = emp.candidate_id ? String(emp.candidate_id) : null;
  if (!candidateId) {
    warnings.push({
      code: "no_candidate_link",
      reason: "This employee has no linked candidate record, so BGV cannot be checked automatically.",
      severity: "warning",
    });
  } else {
    const [bgv] = await db.execute<RowDataPacket[]>(
      `SELECT overall_status, is_auto_approved,
              aadhaar_status, pan_status, digilocker_status, bank_status,
              education_status, address_status, employment_status, criminal_status
         FROM candidate_bgv_report WHERE candidate_id = ? LIMIT 1`,
      [candidateId],
    ).catch(() => [[]] as unknown as [RowDataPacket[]]);
    const report = (bgv as RowDataPacket[])[0];
    if (!report) {
      blockers.push({ code: "bgv_not_started", reason: "Background verification has not been run.", severity: "critical" });
    } else {
      const status = String(report.overall_status ?? "");
      if (status !== "clear") {
        // Name the categories, not just the verdict. "in_progress" sent HR to the
        // BGV report to work out which of seven checks was holding the letter —
        // and the answer is usually education or address, which have no automated
        // provider and so sit at 'not_run' until somebody marks them by hand.
        const outstanding = await outstandingBgvCategories(candidateId, report);
        blockers.push({
          code: "bgv_not_clear",
          reason:
            `Background verification is "${status || "pending"}", not clear.` +
            (outstanding.length ? ` Outstanding: ${outstanding.join(", ")}.` : ""),
          severity: "critical",
        });
      } else if (Number(report.is_auto_approved) === 1) {
        // A report auto-approved by the system is not a report anyone checked.
        blockers.push({
          code: "bgv_auto_approved",
          reason: "The BGV report was auto-approved and has not been reviewed by HR.",
          severity: "critical",
        });
      }
    }
  }

  // ── joining documents ─────────────────────────────────────────────────────
  const placeholders = TERMINAL_DOCUMENT_STATUSES.map(() => "?").join(",");
  const [docs] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS mandatory_total,
            SUM(CASE WHEN status IN (${placeholders}) THEN 1 ELSE 0 END) AS mandatory_done,
            GROUP_CONCAT(CASE WHEN status NOT IN (${placeholders}) THEN document_name END SEPARATOR ', ') AS pending_names
       FROM employee_joining_document_checklist
      WHERE employee_id = ? AND mandatory = 1
        AND document_code NOT IN (${EPF_DOCUMENT_CODES.map(() => "?").join(",")})`,
    [...TERMINAL_DOCUMENT_STATUSES, ...TERMINAL_DOCUMENT_STATUSES, employeeId, ...EPF_DOCUMENT_CODES],
  ).catch(() => [[]] as unknown as [RowDataPacket[]]);
  const d = (docs as RowDataPacket[])[0];
  const total = Number(d?.mandatory_total ?? 0);
  const done = Number(d?.mandatory_done ?? 0);

  if (total === 0) {
    blockers.push({
      code: "no_joining_documents",
      reason: "No joining-document checklist exists for this employee.",
      severity: "critical",
    });
  } else if (done < total) {
    blockers.push({
      code: "joining_documents_incomplete",
      reason: `${total - done} of ${total} mandatory joining documents are still outstanding: ${d?.pending_names ?? "unnamed"}.`,
      severity: "critical",
    });
  }

  // ── joining kit e-sign ────────────────────────────────────────────────────
  // Distinct from (and in addition to) joining_documents_incomplete above: that check
  // only asks whether every mandatory row reached a terminal status, one of which is
  // 'verified' — a status a document can reach without the candidate ever having
  // e-signed anything (e.g. HR marking an uploaded copy verified). Appointment letter
  // issuance requires that the candidate has actually e-signed (or, for the HR-gated
  // wet-signature path, been verified as wet-signed) at least their joining kit — not
  // merely that paperwork is "complete" some other way. Only checked when the employee
  // has any joining-document checklist rows at all; no_joining_documents above already
  // covers the case where none exist.
  if (total > 0) {
    const [esignRows] = await db.execute<RowDataPacket[]>(
      // EPF excluded here too, for the same reason as above and to keep the two
      // gates consistent: an employee whose only signed document was an EPF form
      // has not signed their joining kit, which is what this check is asking.
      `SELECT COUNT(*) AS signed_count
         FROM employee_joining_document_checklist
        WHERE employee_id = ? AND mandatory = 1
          AND document_code NOT IN (${EPF_DOCUMENT_CODES.map(() => "?").join(",")})
          AND status IN ('esign_completed', 'signed_verified', 'wet_signed_uploaded')`,
      [employeeId, ...EPF_DOCUMENT_CODES],
    ).catch(() => [[]] as unknown as [RowDataPacket[]]);
    const signedCount = Number((esignRows as RowDataPacket[])[0]?.signed_count ?? 0);
    if (signedCount === 0) {
      blockers.push({
        code: "joining_kit_not_esigned",
        reason: "The candidate has not e-signed (or had a wet signature verified on) any joining kit document yet.",
        severity: "critical",
      });
    }
  }

  // ── branch address (letterhead) ───────────────────────────────────────────
  if (!emp.branch_id) {
    blockers.push({
      code: "branch_not_assigned",
      reason: "No branch is assigned, so the issuing office cannot be printed on the letter.",
      severity: "critical",
    });
  } else if (!String(emp.branch_address ?? "").trim()) {
    blockers.push({
      code: "branch_address_missing",
      reason: `Branch "${emp.branch_name ?? ""}" has no address on record. Add its Full Address in Organisation Masters.`,
      severity: "critical",
    });
  }

  // ── salary ────────────────────────────────────────────────────────────────
  const [sal] = await db.execute<RowDataPacket[]>(
    `SELECT
       (SELECT COUNT(*) FROM salary_component_assignments WHERE employee_id = ? AND status = 'active') AS sca,
       (SELECT COUNT(*) FROM legacy_payslip_snapshot WHERE employee_id = ?) AS legacy`,
    [employeeId, employeeId],
  ).catch(() => [[]] as unknown as [RowDataPacket[]]);
  const s = (sal as RowDataPacket[])[0];
  if (Number(s?.sca ?? 0) === 0 && Number(s?.legacy ?? 0) === 0) {
    blockers.push({
      code: "salary_not_assigned",
      reason: "No salary is assigned, so the letter's remuneration table cannot be produced.",
      severity: "critical",
    });
  }

  // ── printable identity ────────────────────────────────────────────────────
  const name = String(emp.full_name ?? "").replace(/\s+/g, " ").trim();
  if (name.length < 3) {
    blockers.push({
      code: "employee_name_incomplete",
      reason: `The name on record is "${name}", which cannot be printed on a letter.`,
      severity: "critical",
    });
  } else if (name.split(" ").filter(Boolean).length === 1) {
    // Not a blocker: a single legal name is normal. HR confirms rather than
    // being stopped.
    warnings.push({
      code: "name_possibly_incomplete",
      reason: `The name on record is a single word ("${name}"). Confirm it is complete before issuing.`,
      severity: "warning",
    });
  }
  if (!emp.date_of_joining) {
    blockers.push({
      code: "no_date_of_joining",
      reason: "No date of joining is recorded.",
      severity: "critical",
    });
  }
  if (!emp.designation_name) {
    warnings.push({
      code: "no_designation",
      reason: "No designation is recorded; the letter will not state one.",
      severity: "warning",
    });
  }

  return {
    employeeId,
    employeeCode: emp.employee_code ? String(emp.employee_code) : null,
    employeeName: name || null,
    eligible: blockers.length === 0,
    blockers,
    warnings,
    alreadyIssued: Boolean(existing),
    existingLetterNumber: existing ? String(existing.letter_number) : null,
  };
}

/**
 * Everyone Payroll HR could issue to, with the reasons they cannot.
 *
 * Used to require a mandatory=1 checklist row just to appear in this query at
 * all, so an employee with zero mandatory checklist rows was invisible here —
 * not "blocked", simply never returned — even though evaluateAppointmentLetterEligibility()
 * above correctly reports a no_joining_documents blocker for that exact case.
 * That let the list and single-employee endpoints disagree. Every id below still
 * goes through the same per-employee eligibility evaluation, so removing the
 * pre-filter makes them agree by construction instead of duplicating the logic.
 *
 * Legacy (db_bill-migrated) employees are excluded outright — same rationale as
 * the joining-documents tracker and IT provisioning queue: they were never real
 * onboarding work items.
 */
export type AppointmentLetterQueueFilters = {
  /**
   * A WHERE fragment on e.branch_id straight out of buildScopeWhereClause() —
   * "1=1" for an org-wide user, "1=0" for one whose roles carry no scope row at
   * all. Left undefined the queue is org-wide, so every caller that serves a
   * request must pass it.
   */
  scopeSql?: string;
  scopeParams?: unknown[];
  /** Employee name or code. Applied in SQL, i.e. before the LIMIT. */
  search?: string | null;
};

/** The name as it is displayed everywhere else in this module. */
const EMPLOYEE_DISPLAY_NAME_SQL =
  `COALESCE(NULLIF(TRIM(e.full_name), ''), TRIM(CONCAT(e.first_name, ' ', COALESCE(e.last_name, ''))))`;

/**
 * % and _ are wildcards to LIKE, so an unescaped search box is a way to match
 * rows the searcher did not ask for — "%" alone would return the whole branch.
 */
export function appointmentLetterSearchTerm(raw: string): string {
  return `%${raw.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

export async function listAppointmentLetterQueue(
  limit = 200,
  filters: AppointmentLetterQueueFilters = {},
): Promise<EligibilityResult[]> {
  const conds: string[] = [
    "e.active_status = 1",
    "e.legacy_emp_id IS NULL",
    `NOT EXISTS (SELECT 1 FROM appointment_letter_issue i
                   WHERE i.employee_id = e.id AND i.status <> 'revoked')`,
    // Branch RBAC. Applied in the id query rather than by filtering the results,
    // so an out-of-branch employee never reaches the per-employee evaluation
    // below — that evaluation reads salary and document records.
    `(${filters.scopeSql ?? "1=1"})`,
  ];
  const params: unknown[] = [...(filters.scopeParams ?? [])];

  // The search runs in SQL, not over the returned page: the queue is capped at
  // `limit` rows ordered by joining date, so a client-side filter could never
  // find anyone past that cap.
  const search = String(filters.search ?? "").trim();
  if (search) {
    conds.push(`(${EMPLOYEE_DISPLAY_NAME_SQL} LIKE ? OR e.employee_code LIKE ?)`);
    params.push(appointmentLetterSearchTerm(search), appointmentLetterSearchTerm(search));
  }

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT e.id
       FROM employees e
      WHERE ${conds.join("\n        AND ")}
      ORDER BY e.date_of_joining DESC
      LIMIT ${Number(limit) || 200}`,
    params,
  ).catch(() => [[]] as unknown as [RowDataPacket[]]);

  const out: EligibilityResult[] = [];
  for (const r of rows as RowDataPacket[]) {
    out.push(await evaluateAppointmentLetterEligibility(String(r.id)));
  }
  return out;
}
