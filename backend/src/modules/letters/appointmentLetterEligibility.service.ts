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
 *   BGV = a report exists, a human looked at it, and it is not adverse.
 *
 *                This used to demand overall_status = 'clear' AND
 *                is_auto_approved = 0 — reconciliation.service.ts's canonical
 *                "BGV really passed" test. Measured live on 2026-09-08, that
 *                made the whole screen inert: of 154 BGV reports in the
 *                database, **zero** satisfied it. Exactly one report reads
 *                'clear', and that one is auto-approved, which the test
 *                explicitly rejects. Nought appointment letters had ever been
 *                issued, to anybody, and this was the only reason.
 *
 *                The cause is upstream and not fixable from here:
 *                deriveOverallStatus() only returns 'clear' once education AND
 *                address are verified or waived, and neither has an automated
 *                provider — so unless somebody marks them by hand, which nobody
 *                does, BGV never derives to 'clear' for anyone.
 *
 *                Decided by the product owner on 2026-09-08: an adverse report
 *                ('refer'/'negative') and an auto-approved one still block
 *                absolutely, and a missing report still blocks. A report that a
 *                human is working through ('pending'/'in_progress') downgrades
 *                to a WARNING — it does not stop issuance, but it cannot be
 *                passed silently either: warnings require force=true plus a
 *                stated override reason, which is recorded against the letter.
 *
 *                This is a smaller relaxation than it looks, because the salary
 *                gate below independently requires a Payroll-Head-approved
 *                package, and that review is a human sign-off over this same
 *                BGV, the documents, and the bank details.
 *
 *                Note is_auto_approved now blocks at ANY status, not only at
 *                'clear'. That is not a tightening in practice — every
 *                auto-approved report was already blocked by the old
 *                status !== 'clear' test — it just names the real reason.
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
import { getApplicableChecks, deriveApplicableChecksFromRow, APPLICABLE_CHECKS_ROW_SQL } from "../ats/bgv-verification.service.js";
import { nonReactivatableSqlList } from "../exit/exitEmploymentStatus.js";

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
  /**
   * True when the joining-kit EMPLOYMENT_CONTRACT document is already signed
   * for this employee even though no row exists in appointment_letter_issue
   * (e.g. signed outside this issue flow, or migrated data) — alreadyIssued
   * above only checks appointment_letter_issue, so this is the signal that a
   * fresh "Issue" click here would be a duplicate contract, not a first one.
   */
  contractAlreadySigned: boolean;
  /** Days since `employees.created_at` — the employee ID creation SLA clock. */
  daysSinceIdCreated: number;
  /** `daysSinceIdCreated > 3`. */
  idCreationSlaBreached: boolean;
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

type DocsRow = { mandatory_total: number; mandatory_done: number; pending_names: string | null };
type SalaryRow = { status: string | null; package_accepted: number | null; salary_package_id: string | null };

/**
 * Every per-employee/per-candidate lookup `evaluateAppointmentLetterEligibility`
 * makes, pre-fetched in bulk for a whole page of the queue.
 *
 * `listAppointmentLetterQueue` used to call `evaluateAppointmentLetterEligibility`
 * once per row with no batch, which meant up to 200 employees × ~8 sequential
 * queries each (employee lookup, issued-letter lookup, contract-signed lookup,
 * BGV report, BGV applicability, joining-documents completeness, joining-kit
 * e-sign count, salary review) — 1,000+ round trips for one page load, which is
 * why `/provisioning/appointment-letter` was reported as very slow. Passing this
 * batch in lets the same per-employee decision logic run against in-memory Maps
 * instead. The single-employee eligibility endpoint still calls the function with
 * no batch, so it is unaffected and keeps querying directly.
 */
export type EligibilityBatch = {
  employees: Map<string, RowDataPacket>;
  issued: Map<string, { letter_number: string }>;
  contractSigned: Set<string>;
  bgv: Map<string, RowDataPacket>;
  applicable: Map<string, RowDataPacket | undefined>;
  docs: Map<string, DocsRow>;
  esignSignedCount: Map<string, number>;
  salary: Map<string, SalaryRow>;
};

export async function loadEligibilityBatch(employeeIds: string[]): Promise<EligibilityBatch> {
  const empty: EligibilityBatch = {
    employees: new Map(), issued: new Map(), contractSigned: new Set(),
    bgv: new Map(), applicable: new Map(), docs: new Map(),
    esignSignedCount: new Map(), salary: new Map(),
  };
  if (employeeIds.length === 0) return empty;
  const idPlaceholders = employeeIds.map(() => "?").join(",");

  const [empRows] = await db.execute<RowDataPacket[]>(
    `SELECT e.id, e.employee_code, e.branch_id, e.date_of_joining, e.created_at,
            COALESCE(NULLIF(TRIM(e.full_name), ''), TRIM(CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')))) AS full_name,
            b.branch_name, COALESCE(b.address, '') AS branch_address,
            d.designation_name,
            (SELECT ab.candidate_id FROM ats_onboarding_bridge ab WHERE ab.employee_id = e.id LIMIT 1) AS candidate_id
       FROM employees e
       LEFT JOIN branch_master b ON b.id = e.branch_id
       LEFT JOIN designation_master d ON d.id = e.designation_id
      WHERE e.id IN (${idPlaceholders})`,
    employeeIds,
  ).catch(() => [[]] as unknown as [RowDataPacket[]]);
  for (const row of empRows as RowDataPacket[]) empty.employees.set(String(row.id), row);

  const candidateIds = [...new Set(
    (empRows as RowDataPacket[]).map((r) => (r.candidate_id ? String(r.candidate_id) : null)).filter((v): v is string => v !== null),
  )];

  const [issuedRows] = await db.execute<RowDataPacket[]>(
    `SELECT employee_id, letter_number FROM appointment_letter_issue
      WHERE employee_id IN (${idPlaceholders}) AND status <> 'revoked'
      ORDER BY employee_id, issued_at DESC`,
    employeeIds,
  ).catch(() => [[]] as unknown as [RowDataPacket[]]);
  for (const row of issuedRows as RowDataPacket[]) {
    const key = String(row.employee_id);
    if (!empty.issued.has(key)) empty.issued.set(key, { letter_number: String(row.letter_number) });
  }

  const [contractRows] = await db.execute<RowDataPacket[]>(
    `SELECT DISTINCT employee_id FROM employee_joining_document_checklist
      WHERE employee_id IN (${idPlaceholders}) AND document_code = 'EMPLOYMENT_CONTRACT'
        AND status IN ('verified', 'signed_verified', 'completed', 'esign_completed', 'wet_signed_uploaded')`,
    employeeIds,
  ).catch(() => [[]] as unknown as [RowDataPacket[]]);
  for (const row of contractRows as RowDataPacket[]) empty.contractSigned.add(String(row.employee_id));

  if (candidateIds.length > 0) {
    const candPlaceholders = candidateIds.map(() => "?").join(",");
    const [bgvRows] = await db.execute<RowDataPacket[]>(
      `SELECT candidate_id, overall_status, is_auto_approved,
              aadhaar_status, pan_status, digilocker_status, bank_status,
              education_status, address_status, employment_status, criminal_status
         FROM candidate_bgv_report WHERE candidate_id IN (${candPlaceholders})`,
      candidateIds,
    ).catch(() => [[]] as unknown as [RowDataPacket[]]);
    for (const row of bgvRows as RowDataPacket[]) empty.bgv.set(String(row.candidate_id), row);

    const [applicableRows] = await db.execute<RowDataPacket[]>(
      `SELECT c.id AS candidate_id, ${APPLICABLE_CHECKS_ROW_SQL}
        WHERE c.id IN (${candPlaceholders})`,
      candidateIds,
    ).catch(() => [[]] as unknown as [RowDataPacket[]]);
    for (const row of applicableRows as RowDataPacket[]) empty.applicable.set(String(row.candidate_id), row);
  }

  const terminalPlaceholders = TERMINAL_DOCUMENT_STATUSES.map(() => "?").join(",");
  const epfPlaceholders = EPF_DOCUMENT_CODES.map(() => "?").join(",");
  const [docsRows] = await db.execute<RowDataPacket[]>(
    `SELECT employee_id,
            COUNT(*) AS mandatory_total,
            SUM(CASE WHEN status IN (${terminalPlaceholders}) THEN 1 ELSE 0 END) AS mandatory_done,
            GROUP_CONCAT(CASE WHEN status NOT IN (${terminalPlaceholders}) THEN document_name END SEPARATOR ', ') AS pending_names
       FROM employee_joining_document_checklist
      WHERE employee_id IN (${idPlaceholders}) AND mandatory = 1
        AND document_code NOT IN (${epfPlaceholders})
      GROUP BY employee_id`,
    [...TERMINAL_DOCUMENT_STATUSES, ...TERMINAL_DOCUMENT_STATUSES, ...employeeIds, ...EPF_DOCUMENT_CODES],
  ).catch(() => [[]] as unknown as [RowDataPacket[]]);
  for (const row of docsRows as RowDataPacket[]) {
    empty.docs.set(String(row.employee_id), {
      mandatory_total: Number(row.mandatory_total ?? 0),
      mandatory_done: Number(row.mandatory_done ?? 0),
      pending_names: row.pending_names ?? null,
    });
  }

  const [esignRows] = await db.execute<RowDataPacket[]>(
    `SELECT employee_id, COUNT(*) AS signed_count
       FROM employee_joining_document_checklist
      WHERE employee_id IN (${idPlaceholders}) AND mandatory = 1
        AND document_code NOT IN (${epfPlaceholders})
        AND status IN ('esign_completed', 'signed_verified', 'wet_signed_uploaded')
      GROUP BY employee_id`,
    [...employeeIds, ...EPF_DOCUMENT_CODES],
  ).catch(() => [[]] as unknown as [RowDataPacket[]]);
  for (const row of esignRows as RowDataPacket[]) empty.esignSignedCount.set(String(row.employee_id), Number(row.signed_count ?? 0));

  const [salaryRows] = await db.execute<RowDataPacket[]>(
    `SELECT employee_id, status, package_accepted, salary_package_id
       FROM employee_payroll_head_review WHERE employee_id IN (${idPlaceholders})`,
    employeeIds,
  ).catch(() => [[]] as unknown as [RowDataPacket[]]);
  for (const row of salaryRows as RowDataPacket[]) {
    empty.salary.set(String(row.employee_id), {
      status: row.status ?? null,
      package_accepted: row.package_accepted === null || row.package_accepted === undefined ? null : Number(row.package_accepted),
      salary_package_id: row.salary_package_id ?? null,
    });
  }

  return empty;
}

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
  // Wrapped in `{ row }` so "batch mode, no applicability row found" (row: undefined)
  // is distinguishable from "no batch given, run the live per-candidate query".
  preloaded?: { row: RowDataPacket | undefined },
): Promise<string[]> {
  const { includeEmployment, includeCriminal } = preloaded
    ? deriveApplicableChecksFromRow(preloaded.row)
    : await getApplicableChecks(candidateId)
      // A failure here must not cost HR the blocker itself — fall back to the
      // narrower base set rather than throwing away the whole eligibility answer.
      .catch(() => ({ includeEmployment: false, includeCriminal: false, denominator: 80 }));

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

export async function evaluateAppointmentLetterEligibility(
  employeeId: string,
  batch?: EligibilityBatch,
): Promise<EligibilityResult> {
  const blockers: EligibilityBlocker[] = [];
  const warnings: EligibilityBlocker[] = [];

  let emp: RowDataPacket | undefined = batch?.employees.get(employeeId);
  if (!batch) {
    const [empRows] = await db.execute<RowDataPacket[]>(
      `SELECT e.id, e.employee_code, e.branch_id, e.date_of_joining, e.created_at,
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
    emp = (empRows as RowDataPacket[])[0];
  }
  if (!emp) {
    return {
      employeeId, employeeCode: null, employeeName: null, eligible: false,
      blockers: [{ code: "employee_not_found", reason: "No such employee.", severity: "critical" }],
      warnings: [], alreadyIssued: false, existingLetterNumber: null, contractAlreadySigned: false,
      daysSinceIdCreated: 0, idCreationSlaBreached: false,
    };
  }

  // ── already issued ────────────────────────────────────────────────────────
  let existing: { letter_number: string } | undefined = batch?.issued.get(employeeId);
  if (!batch) {
    const [issued] = await db.execute<RowDataPacket[]>(
      `SELECT letter_number FROM appointment_letter_issue
        WHERE employee_id = ? AND status <> 'revoked'
        ORDER BY issued_at DESC LIMIT 1`,
      [employeeId],
    ).catch(() => [[]] as unknown as [RowDataPacket[]]);
    existing = (issued as RowDataPacket[])[0] as { letter_number: string } | undefined;
  }

  // ── already-signed employment contract, outside appointment_letter_issue ───
  // Catches an employee whose joining-kit EMPLOYMENT_CONTRACT was already
  // signed (through eSign or a verified wet-signed upload) but who has no
  // matching appointment_letter_issue row — alreadyIssued above would
  // otherwise report false and invite HR to issue a duplicate contract.
  let contractAlreadySigned: boolean;
  if (batch) {
    contractAlreadySigned = batch.contractSigned.has(employeeId);
  } else {
    const [contractRows] = await db.execute<RowDataPacket[]>(
      `SELECT status FROM employee_joining_document_checklist
        WHERE employee_id = ? AND document_code = 'EMPLOYMENT_CONTRACT'
          AND status IN ('verified', 'signed_verified', 'completed', 'esign_completed', 'wet_signed_uploaded')
        LIMIT 1`,
      [employeeId],
    ).catch(() => [[]] as unknown as [RowDataPacket[]]);
    contractAlreadySigned = (contractRows as RowDataPacket[]).length > 0;
  }
  // contract_already_signed warning removed: Employment Agreement signed + no appointment letter
  // yet issued is the NORMAL state for every employee on this page. The warning fired for 100%
  // of valid cases and never indicated an actual problem, so it was pure noise that blocked issuance.

  // ── BGV ───────────────────────────────────────────────────────────────────
  const candidateId = emp.candidate_id ? String(emp.candidate_id) : null;
  if (!candidateId) {
    warnings.push({
      code: "no_candidate_link",
      reason: "This employee has no linked candidate record, so BGV cannot be checked automatically.",
      severity: "warning",
    });
  } else {
    let report: RowDataPacket | undefined;
    if (batch) {
      report = batch.bgv.get(candidateId);
    } else {
      const [bgv] = await db.execute<RowDataPacket[]>(
        `SELECT overall_status, is_auto_approved,
                aadhaar_status, pan_status, digilocker_status, bank_status,
                education_status, address_status, employment_status, criminal_status
           FROM candidate_bgv_report WHERE candidate_id = ? LIMIT 1`,
        [candidateId],
      ).catch(() => [[]] as unknown as [RowDataPacket[]]);
      report = (bgv as RowDataPacket[])[0];
    }
    if (!report) {
      blockers.push({ code: "bgv_not_started", reason: "Background verification has not been run.", severity: "critical" });
    } else {
      const status = String(report.overall_status ?? "");
      if (Number(report.is_auto_approved) === 1) {
        // A report auto-approved by the system is not a report anyone checked,
        // whatever status it ended up at. Checked first, and unconditionally,
        // so a 'clear' auto-approval cannot slip through as a mere warning.
        blockers.push({
          code: "bgv_auto_approved",
          reason: "The BGV report was auto-approved and has not been reviewed by HR.",
          severity: "critical",
        });
      } else if (status === "refer" || status === "negative") {
        // An adverse finding. Never forceable: this is the one BGV outcome that
        // says something was actually found, rather than not yet looked for.
        blockers.push({
          code: "bgv_adverse",
          reason:
            `Background verification came back "${status}". An appointment letter cannot be ` +
            "issued against an adverse BGV report.",
          severity: "critical",
        });
      } else if (status !== "clear") {
        // In progress, and a human is on it. Name the categories, not just the
        // verdict: "in_progress" sent HR to the BGV report to work out which of
        // seven checks was holding the letter — and the answer is usually
        // education or address, which have no automated provider and so sit at
        // 'not_run' until somebody marks them by hand.
        //
        // A warning rather than a blocker, so issuance costs HR an explicit
        // override with a recorded reason instead of being impossible.
        const outstanding = await outstandingBgvCategories(
          candidateId,
          report,
          batch ? { row: batch.applicable.get(candidateId) } : undefined,
        );
        warnings.push({
          code: "bgv_not_clear",
          reason:
            `Background verification is "${status || "pending"}", not yet clear.` +
            (outstanding.length ? ` Outstanding: ${outstanding.join(", ")}.` : "") +
            " Confirm before issuing.",
          severity: "warning",
        });
      }
    }
  }

  // ── joining documents ─────────────────────────────────────────────────────
  let d: DocsRow | undefined = batch?.docs.get(employeeId);
  if (!batch) {
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
    const row = (docs as RowDataPacket[])[0];
    d = row ? { mandatory_total: Number(row.mandatory_total ?? 0), mandatory_done: Number(row.mandatory_done ?? 0), pending_names: row.pending_names ?? null } : undefined;
  }
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
    let signedCount: number;
    if (batch) {
      signedCount = batch.esignSignedCount.get(employeeId) ?? 0;
    } else {
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
      signedCount = Number((esignRows as RowDataPacket[])[0]?.signed_count ?? 0);
    }
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

  // ── salary: the Payroll-Head-approved package, and nothing else ───────────
  //
  // This asks the same question appointmentLetterData.service.ts asks at
  // issuance, so the queue cannot advertise someone as eligible whom issuance
  // would then refuse. It used to count rows in salary_component_assignments or
  // legacy_payslip_snapshot — neither of which involves the Payroll Head — and
  // on 2026-09-08 that was true for 264 active employees with no approved
  // review at all, 23 of them pending and one rejected.
  //
  // The statuses are read rather than counted so the reason names the actual
  // situation: "not reviewed yet" and "rejected" need opposite actions from HR.
  let review: SalaryRow | undefined = batch?.salary.get(employeeId);
  if (!batch) {
    const [sal] = await db.execute<RowDataPacket[]>(
      `SELECT r.status, r.package_accepted, r.salary_package_id
         FROM employee_payroll_head_review r
        WHERE r.employee_id = ? LIMIT 1`,
      [employeeId],
    ).catch(() => [[]] as unknown as [RowDataPacket[]]);
    const row = (sal as RowDataPacket[])[0];
    review = row ? { status: row.status ?? null, package_accepted: row.package_accepted === null || row.package_accepted === undefined ? null : Number(row.package_accepted), salary_package_id: row.salary_package_id ?? null } : undefined;
  }
  const reviewStatus = String(review?.status ?? "");

  if (!review) {
    blockers.push({
      code: "salary_not_reviewed",
      reason:
        "The Payroll Head has not reviewed this employee's salary, so there is no approved " +
        "package to print on the letter.",
      severity: "critical",
    });
  } else if (reviewStatus === "rejected") {
    blockers.push({
      code: "salary_review_rejected",
      reason: "The Payroll Head rejected this employee's salary review. Correct it and get it re-approved first.",
      severity: "critical",
    });
  } else if (reviewStatus !== "approved") {
    blockers.push({
      code: "salary_not_approved",
      reason: `The Payroll Head salary review is "${reviewStatus || "pending"}", not approved. The letter prints the approved salary.`,
      severity: "critical",
    });
  } else if (Number(review.package_accepted ?? 0) !== 1 || !review.salary_package_id) {
    blockers.push({
      code: "salary_package_missing",
      reason:
        "The Payroll Head review is approved but carries no accepted salary package, so the " +
        "letter's remuneration table cannot be produced.",
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

  const daysSinceIdCreated = emp.created_at
    ? Math.floor((Date.now() - new Date(emp.created_at).getTime()) / 86_400_000)
    : 0;

  return {
    employeeId,
    employeeCode: emp.employee_code ? String(emp.employee_code) : null,
    employeeName: name || null,
    eligible: blockers.length === 0,
    blockers,
    warnings,
    alreadyIssued: Boolean(existing),
    existingLetterNumber: existing ? String(existing.letter_number) : null,
    contractAlreadySigned,
    daysSinceIdCreated,
    idCreationSlaBreached: daysSinceIdCreated > 3,
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
    // Include preboarding employees (active_status = 0, employment_status = 'preboarding'):
    // the appointment letter is issued during onboarding, before activation fires.
    // An employee code is generated at Branch Head approval and the employee record is
    // created immediately, but active_status stays 0 until the nightly activation job
    // runs after joining date. Restricting to active_status = 1 silently hid every
    // preboarding candidate from the queue, making HR unable to issue their letter.
    "(e.active_status = 1 OR e.employment_status = 'preboarding')",
    // Guard against exited employees — the same canonical list used by the Joining
    // Documents Tracker (exitEmploymentStatus.ts). nonReactivatableSqlList() covers
    // all terminal exit statuses including legacy spellings.
    `(e.employment_status IS NULL OR e.employment_status NOT IN (${nonReactivatableSqlList()}))`,
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

  const ids = (rows as RowDataPacket[]).map((r) => String(r.id));
  // One batch of bulk `IN (...)` queries for the whole page instead of
  // evaluateAppointmentLetterEligibility's ~8 queries repeated per employee —
  // see loadEligibilityBatch's own comment for why this mattered.
  const batch = await loadEligibilityBatch(ids);
  const out: EligibilityResult[] = [];
  for (const id of ids) {
    out.push(await evaluateAppointmentLetterEligibility(id, batch));
  }
  return out;
}
