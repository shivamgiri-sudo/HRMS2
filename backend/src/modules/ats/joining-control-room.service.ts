import type { RowDataPacket, ResultSetHeader } from "mysql2/promise";
import { randomUUID } from "crypto";
import { db } from "../../db/mysql.js";
import { stripCryptoPlumbing } from "../../shared/cryptoColumnHygiene.js";
import { convertCandidateToEmployee } from "./ats.convert.service.js";
import { classifyEsignState } from "./esignState.js";

type JsonRecord = Record<string, unknown>;

function monthOf(dateText: string): string {
  return String(dateText || "").slice(0, 7);
}

function toDateOnly(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function readinessBlockers(row: RowDataPacket | null): string[] {
  const blockers: string[] = [];
  if (!row) return ["Candidate record is missing"];
  if (String(row.onboarding_status || "").toLowerCase() !== "approved") blockers.push("Candidate onboarding form is not HR-approved");
  if (Number(row.document_pending_count || 0) > 0) blockers.push("Mandatory/available documents are not fully verified");
  if (String(row.bgv_status || "").toLowerCase() !== "verified") blockers.push("BGV/eKYC is not verified");
  if (String(row.payroll_status || "").toLowerCase() !== "validated") blockers.push("Payroll HR details are not validated");
  if (row.salary_exception_status && String(row.salary_exception_status) !== "approved") blockers.push("Salary proposal approval is pending");
  if (!row.salary_register_id || Number(row.salary_register_locked || 0) !== 1) blockers.push("Salary register is not locked");
  if (String(row.jclr_approval_status || "").toLowerCase() !== "approved") blockers.push("BM / Branch Head JCLR approval is pending");
  if (String(row.jclr_status || "").toLowerCase() !== "ready" && String(row.jclr_status || "").toLowerCase() !== "completed") blockers.push("Payroll HR JCLR entry is not complete");
  if (String(row.statutory_status || "").toLowerCase() !== "verified") blockers.push("EPF/statutory declaration is not verified");
  if (String(row.dpdp_required_status || "").toLowerCase() !== "granted") blockers.push("Required DPDP consent is not granted");
  return blockers;
}

function nextAction(blockers: string[]): string {
  if (!blockers.length) return "Generate employee code";
  if (blockers[0].includes("onboarding")) return "HR review candidate onboarding form";
  if (blockers[0].includes("documents")) return "Review uploaded documents";
  if (blockers[0].includes("BGV")) return "Complete BGV/eKYC verification";
  if (blockers[0].includes("Payroll")) return "Complete Payroll HR details";
  if (blockers[0].includes("Salary proposal")) return "Complete salary proposal approvals";
  if (blockers[0].includes("Salary register")) return "Lock salary register";
  if (blockers[0].includes("JCLR approval")) return "BM / Branch Head JCLR approval";
  if (blockers[0].includes("JCLR entry")) return "Payroll HR complete JCLR entry";
  if (blockers[0].includes("statutory")) return "Verify EPF/statutory declaration";
  return "Resolve DPDP consent";
}

/**
 * The one SELECT behind both the queue list and every single-candidate read. `whereSql` is the only
 * thing that differs between them - `c.id = ?` for one candidate, `c.id IN (?,?,...)` for the
 * queue's page of 50 - so the two can never drift into reporting different figures for the same
 * candidate. It is a builder because the queue used to call the single-row form 50 times per page
 * load; see candidateSnapshots() below.
 */
const candidateSnapshotSql = (whereSql: string) => `SELECT
       c.id AS candidate_id,
       c.candidate_code,
       c.full_name,
       c.mobile,
       c.email,
       c.applied_for_branch,
       -- ats_candidate.applied_for_process holds a process NAME on almost every row
       -- ('Back Office', 'Outbound Agent'), but the newer intake writes a process_master
       -- UUID instead — 69 rows overall, and 6 of the 20 most recently touched candidates,
       -- i.e. exactly the ones HR is working in this screen. Those rendered as a raw
       -- 'b0afc80e-6969-11f1-adb1-00155d0ab410' in the Summary tab. All 69 resolve against
       -- process_master, so COALESCE names them and leaves the legacy text rows untouched.
       COALESCE(pm.process_name, c.applied_for_process) AS applied_for_process,
       c.created_at,
       c.current_stage,
       c.status AS candidate_status,
       COALESCE(p.profile_status, 'pending') AS onboarding_status,
       COALESCE(doc_stats.total_documents, 0) AS total_documents,
       COALESCE(doc_stats.verified_documents, 0) AS verified_documents,
       GREATEST(COALESCE(doc_stats.total_documents, 0) - COALESCE(doc_stats.verified_documents, 0), 0) AS document_pending_count,
       CASE
         WHEN COALESCE(bgv_checks.blocker_count, 0) > 0 THEN 'blocked'
         WHEN COALESCE(bgv_checks.verified_count, 0) > 0 OR bgv.verification_status = 'verified' THEN 'verified'
         ELSE COALESCE(bgv.verification_status, 'pending')
       END AS bgv_status,
       phr.id AS payroll_validation_id,
       phr.validation_status AS payroll_status,
       phr.joining_date,
       phr.salary_start_date,
       phr.salary_register_locked,
       phr.salary_register_id,
       phr.gross_salary,
       phr.employment_type,
       phr.profile,
       phr.band_grade,
       phr.employee_location,
       sep.id AS salary_exception_id,
       sep.status AS salary_exception_status,
       sep.approval_stage AS salary_approval_stage,
       sep.proposed_gross_salary,
       bha.approval_status AS jclr_approval_status,
       bha.branch_head_id AS jclr_approved_by,
       bha.approved_at AS jclr_approved_at,
       jclr.jclr_status,
       stat.declaration_status AS statutory_status,
       COALESCE(dpdp.required_status, 'pending') AS dpdp_required_status,
       sr.id AS locked_salary_register_id,
       e.employee_code,
       ob.employee_id,
       DATEDIFF(CURRENT_DATE(), DATE(COALESCE(p.submitted_at, c.created_at))) AS aging_days
     FROM ats_candidate c
     LEFT JOIN process_master pm ON pm.id = c.applied_for_process
     LEFT JOIN candidate_onboarding_profile p ON p.candidate_id = c.id
     LEFT JOIN (
       SELECT candidate_id, COUNT(*) AS total_documents,
              SUM(CASE WHEN document_status = 'verified' OR verification_status = 'verified' THEN 1 ELSE 0 END) AS verified_documents
         FROM (
           SELECT candidate_id, document_status, NULL AS verification_status FROM candidate_onboarding_document WHERE deleted_at IS NULL
           UNION ALL
           SELECT candidate_id, NULL AS document_status, verification_status FROM ats_candidate_documents
         ) d
        GROUP BY candidate_id
     ) doc_stats ON doc_stats.candidate_id = c.id
     LEFT JOIN (
       SELECT candidate_id,
              SUM(CASE WHEN status IN ('verified','waived') THEN 1 ELSE 0 END) AS verified_count,
              SUM(CASE WHEN status IN ('mismatch','failed','manual_review') THEN 1 ELSE 0 END) AS blocker_count
         FROM candidate_bgv_check
        GROUP BY candidate_id
     ) bgv_checks ON bgv_checks.candidate_id = c.id
     LEFT JOIN ats_bgv_verification bgv ON bgv.candidate_id = c.id
     LEFT JOIN ats_payroll_hr_validation phr ON phr.candidate_id = c.id
     LEFT JOIN salary_exception_proposal sep ON sep.candidate_id = c.id
     LEFT JOIN ats_branch_head_approval bha ON bha.candidate_id = c.id
     LEFT JOIN salary_register sr ON sr.candidate_id = c.id AND sr.locked_status = 1
     LEFT JOIN jclr_detail jclr ON jclr.candidate_id = c.id
     LEFT JOIN statutory_declaration stat ON stat.candidate_id = c.id
     LEFT JOIN (
       SELECT candidate_id,
              CASE
                WHEN SUM(CASE WHEN consent_status = 'withdrawn' THEN 1 ELSE 0 END) > 0 THEN 'withdrawn'
                WHEN SUM(CASE WHEN consent_status = 'granted' THEN 1 ELSE 0 END) > 0 THEN 'granted'
                ELSE 'pending'
              END AS required_status
         FROM dpdp_consent_register
        WHERE purpose_code IN ('candidate_onboarding','bgv_verification','payroll_processing','document_review')
        GROUP BY candidate_id
     ) dpdp ON dpdp.candidate_id = c.id
     LEFT JOIN ats_onboarding_bridge ob ON ob.candidate_id = c.id
     LEFT JOIN employees e ON e.id = ob.employee_id
     WHERE ${whereSql}`;

async function candidateSnapshot(candidateId: string): Promise<RowDataPacket | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `${candidateSnapshotSql("c.id = ?")} LIMIT 1`,
    [candidateId],
  );
  return rows[0] ?? null;
}

/**
 * Every candidate on one page of the queue, in ONE query.
 *
 * listJoiningControlRoomQueue used to Promise.all() candidateSnapshot() across its 50 ids. That
 * snapshot carries three uncorrelated derived tables (doc_stats, bgv_checks, dpdp) which MySQL
 * materialises in full on every execution, so the page paid for 150 aggregate scans to render 50
 * rows - measured on live data at 234 ms x 50 = ~11.7 s of database time, on top of the queue
 * query's own cost, against a 30 s client timeout. Batching by `IN` builds each derived table once:
 * the same 50 rows came back in 440 ms, identical across all 40 columns.
 *
 * Returned in the caller's id order, not the database's: the queue's ordering is decided by
 * listJoiningControlRoomQueue's ORDER BY, and `IN` does not preserve it.
 */
async function candidateSnapshots(candidateIds: string[]): Promise<RowDataPacket[]> {
  if (!candidateIds.length) return [];
  const [rows] = await db.execute<RowDataPacket[]>(
    candidateSnapshotSql(`c.id IN (${candidateIds.map(() => "?").join(",")})`),
    candidateIds,
  );
  const byId = new Map(rows.map((row) => [String(row.candidate_id), row]));
  return candidateIds.map((id) => byId.get(id)).filter(Boolean) as RowDataPacket[];
}

export async function listJoiningControlRoomQueue(search = "") {
  let searchSql = "";
  let searchParams: unknown[] = [];
  if (search.trim()) {
    searchSql = "AND (c.full_name LIKE ? OR c.mobile LIKE ? OR c.email LIKE ? OR c.candidate_code LIKE ?)";
    const like = `%${search.trim()}%`;
    searchParams = [like, like, like, like];
  }
  // The filter is interpolated into all four arms below, so its bindings repeat once per arm.
  const params: unknown[] = [
    ...searchParams, ...searchParams, ...searchParams, ...searchParams,
  ];

  // One arm per source of the candidate's sort key, in the precedence the ORDER BY used to express
  // as COALESCE(p.updated_at, phr.updated_at, jclr.updated_at, c.updated_at, c.created_at): an arm
  // claims a candidate only when every higher-precedence source is absent, so each candidate is
  // emitted exactly once, keyed exactly as before. All four `updated_at` columns are NOT NULL by
  // schema, so that COALESCE could only ever fall through on a MISSING JOIN, never on a NULL value
  // - which is what makes this decomposition equivalent rather than merely similar.
  //
  // The point of it is the ORDER BY. As one statement, ordering on a COALESCE spanning four tables
  // is indexable by nothing, so MySQL joined all ~35k candidates into a temp table and filesorted
  // it to hand back 50 rows: 26.7 s measured on live data, while the identical query WITHOUT the
  // ORDER BY returned in 18 ms. Here each arm sorts its own table's own column and stops at 50, and
  // the global top 50 is necessarily contained in the union of the per-source top 50s.
  //
  // The `c.id DESC` tie-breaker is not cosmetic. `updated_at` is second-resolution and these rows
  // arrive by bulk import, so ties are dense - the 50-row cut was measured landing inside a group
  // of three rows sharing one timestamp. Without it the old single-statement query was already free
  // to return a different 50 on each call for unchanged data; with it the page is stable and this
  // decomposition is provably identical to the old ordering rather than equal most of the time.
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT candidate_id FROM (
       ( SELECT c.id AS candidate_id, p.updated_at AS sort_key
           FROM candidate_onboarding_profile p
           JOIN ats_candidate c ON c.id = p.candidate_id
          WHERE 1=1 ${searchSql}
          ORDER BY p.updated_at DESC, c.id DESC
          LIMIT 50 )
       UNION ALL
       ( SELECT c.id AS candidate_id, phr.updated_at AS sort_key
           FROM ats_payroll_hr_validation phr
           JOIN ats_candidate c ON c.id = phr.candidate_id
          WHERE NOT EXISTS (SELECT 1 FROM candidate_onboarding_profile p WHERE p.candidate_id = c.id)
            ${searchSql}
          ORDER BY phr.updated_at DESC, c.id DESC
          LIMIT 50 )
       UNION ALL
       ( SELECT c.id AS candidate_id, jclr.updated_at AS sort_key
           FROM jclr_detail jclr
           JOIN ats_candidate c ON c.id = jclr.candidate_id
          WHERE NOT EXISTS (SELECT 1 FROM candidate_onboarding_profile p WHERE p.candidate_id = c.id)
            AND NOT EXISTS (SELECT 1 FROM ats_payroll_hr_validation phr WHERE phr.candidate_id = c.id)
            ${searchSql}
          ORDER BY jclr.updated_at DESC, c.id DESC
          LIMIT 50 )
       UNION ALL
       ( SELECT c.id AS candidate_id, c.updated_at AS sort_key
           FROM ats_candidate c
          WHERE LOWER(COALESCE(c.final_decision, c.status, c.current_stage, '')) IN ('selected','offered','joined','onboarding')
            AND NOT EXISTS (SELECT 1 FROM candidate_onboarding_profile p WHERE p.candidate_id = c.id)
            AND NOT EXISTS (SELECT 1 FROM ats_payroll_hr_validation phr WHERE phr.candidate_id = c.id)
            AND NOT EXISTS (SELECT 1 FROM jclr_detail jclr WHERE jclr.candidate_id = c.id)
            ${searchSql}
          ORDER BY c.updated_at DESC, c.id DESC
          LIMIT 50 )
     ) queue
     ORDER BY sort_key DESC, candidate_id DESC
     LIMIT 50`,
    params,
  );

  const snapshots = await candidateSnapshots(rows.map((row) => String(row.candidate_id)));
  return snapshots.map((row) => {
    const blockers = readinessBlockers(row);
    return {
      ...row,
      readiness_status: blockers.length ? "blocked" : row?.employee_code ? "employee_created" : "ready",
      blockers,
      next_action: nextAction(blockers),
    };
  });
}

export async function getJoiningControlRoomCandidate(candidateId: string) {
  const summary = await candidateSnapshot(candidateId);
  if (!summary) throw Object.assign(new Error("Candidate not found"), { statusCode: 404 });

  const [profile] = await db.execute<RowDataPacket[]>(`SELECT * FROM candidate_onboarding_profile WHERE candidate_id = ? LIMIT 1`, [candidateId]);
  const [bank] = await db.execute<RowDataPacket[]>(`SELECT * FROM candidate_onboarding_bank_detail WHERE candidate_id = ? LIMIT 1`, [candidateId]);
  const [qualifications] = await db.execute<RowDataPacket[]>(`SELECT * FROM candidate_onboarding_qualification WHERE candidate_id = ? ORDER BY created_at DESC`, [candidateId]);
  const [experience] = await db.execute<RowDataPacket[]>(`SELECT * FROM candidate_onboarding_experience WHERE candidate_id = ? ORDER BY created_at DESC`, [candidateId]);
  const [payroll] = await db.execute<RowDataPacket[]>(`SELECT * FROM ats_payroll_hr_validation WHERE candidate_id = ? LIMIT 1`, [candidateId]);
  const [salaryProposal] = await db.execute<RowDataPacket[]>(`SELECT * FROM salary_exception_proposal WHERE candidate_id = ? LIMIT 1`, [candidateId]);
  const [salarySteps] = await db.execute<RowDataPacket[]>(`SELECT * FROM salary_proposal_approval_step WHERE candidate_id = ? ORDER BY FIELD(approval_level, 'bm','operations','payroll','finance')`, [candidateId]);
  const [jclr] = await db.execute<RowDataPacket[]>(`SELECT * FROM jclr_detail WHERE candidate_id = ? LIMIT 1`, [candidateId]);
  const [statutory] = await db.execute<RowDataPacket[]>(`SELECT * FROM statutory_declaration WHERE candidate_id = ? LIMIT 1`, [candidateId]);
  const [dpdp] = await db.execute<RowDataPacket[]>(`SELECT * FROM dpdp_consent_register WHERE candidate_id = ? ORDER BY purpose_code`, [candidateId]);
  const [withdrawals] = await db.execute<RowDataPacket[]>(`SELECT * FROM dpdp_consent_withdrawal WHERE requester_id = ? AND requester_type = 'candidate' ORDER BY created_at DESC`, [candidateId]);
  const [bridge] = await db.execute<RowDataPacket[]>(`SELECT ob.*, e.employee_code, e.official_email FROM ats_onboarding_bridge ob LEFT JOIN employees e ON e.id = ob.employee_id WHERE ob.candidate_id = ? LIMIT 1`, [candidateId]);

  // Fetch employment offer (salary source of truth set in onboarding-requests)
  const [offerRows] = await db.execute<RowDataPacket[]>(
    `SELECT o.*,
            d.dept_name AS department_name, des.designation_name, cc.cost_centre_name,
            CONCAT(m.first_name, ' ', m.last_name) AS manager_name
       FROM ats_employment_offer o
       LEFT JOIN department_master d ON d.id = o.department_id
       LEFT JOIN designation_master des ON des.id = o.designation_id
       LEFT JOIN cost_centre_master cc ON cc.id = o.cost_centre
       LEFT JOIN employees m ON m.id = o.reporting_manager_id
      WHERE o.candidate_id = ?
      ORDER BY o.created_at DESC
      LIMIT 1`,
    [candidateId],
  );

  // Fetch provisioning task statuses
  const [provTasks] = await db.execute<RowDataPacket[]>(
    // Four columns here named things it_provisioning_request does not have, so the whole
    // provisioning panel of the joining control room threw and showed no tasks:
    // assigned_to -> assigned_user_id, completed_at -> actioned_at, sla_due -> sla_due_at,
    // and candidate_id, which has no equivalent at all. The table links to a candidate only
    // through ats_onboarding_bridge, so that subquery is the only real predicate.
    `SELECT r.task_code, r.status, r.assigned_user_id AS assigned_to,
            r.actioned_at AS completed_at, r.sla_due_at AS sla_due,
            CONCAT(e.first_name, ' ', e.last_name) AS assigned_to_name
       FROM it_provisioning_request r
       LEFT JOIN employees e ON e.id = r.assigned_user_id
      WHERE r.employee_id = (SELECT employee_id FROM ats_onboarding_bridge WHERE candidate_id = ? LIMIT 1)
      ORDER BY FIELD(r.task_code, 'WFM_PROCESS_ALIGNMENT', 'IT_EMAIL_DOMAIN_ASSET', 'ADMIN_BIOMETRIC_ID_CARD', 'APPOINTMENT_LETTER_ESIGN')`,
    [candidateId],
  );

  // Joining-document e-sign checklist.
  //
  // The Joining Control Room showed no e-sign state at all, while the data was sitting in
  // `employee_joining_document_checklist` the whole time — MAS63459 has 9 rows there, 6 of
  // them `esign_completed` with `signature_mode = 'aadhaar_esign_verified'`. HR had to leave
  // for /ats/joining-documents-tracker to learn whether a joiner had signed anything.
  //
  // Keyed on BOTH ids defensively. The table carries `employee_id` on all 596 live rows but
  // `candidate_id` on only 495. Measured, the employee-id arm recovers exactly 0 rows today:
  // the 101 candidate-less rows belong to 12 employees who have no `ats_onboarding_bridge`
  // row at all, so this screen cannot reach them by either key. It is kept because the
  // reverse case — a bridged joiner whose checklist rows were written without the candidate
  // link — would otherwise show a confident, wrong "0 of 0 signed", and `bridge` is already
  // loaded above so the second key costs no extra round trip.
  const bridgeEmployeeId = bridge[0]?.employee_id ? String(bridge[0].employee_id) : null;
  const [esignRows] = await db.execute<RowDataPacket[]>(
    `SELECT document_code, document_name, owner_type, action_type, status, fill_status,
            signature_mode, mandatory, due_at, completed_at, verification_status,
            employee_review_status, hr_remarks, updated_at
       FROM employee_joining_document_checklist
      WHERE candidate_id = ? OR (? IS NOT NULL AND employee_id = ?)
      ORDER BY mandatory DESC, document_name`,
    [candidateId, bridgeEmployeeId, bridgeEmployeeId],
  );

  const esignDocuments = esignRows.map((row) => ({
    document_code: String(row.document_code ?? ""),
    document_name: String(row.document_name ?? row.document_code ?? "Document"),
    owner_type: row.owner_type ?? null,
    action_type: row.action_type ?? null,
    status: row.status ?? null,
    // classifyEsignState is TOTAL — an unrecognised status buckets to not_started and is
    // logged once, never dropped. That is what keeps completed+in_progress+not_started
    // equal to the row count, so the "6 of 9 signed" headline cannot overstate itself.
    bucket: classifyEsignState(row.status as string | null),
    fill_status: row.fill_status ?? null,
    signature_mode: row.signature_mode ?? null,
    mandatory: Number(row.mandatory ?? 0) === 1,
    due_at: row.due_at ?? null,
    completed_at: row.completed_at ?? null,
    verification_status: row.verification_status ?? null,
    employee_review_status: row.employee_review_status ?? null,
    hr_remarks: row.hr_remarks ?? null,
    updated_at: row.updated_at ?? null,
  }));

  const esignSignable = esignDocuments.filter((doc) => doc.action_type === "esign");
  const esign = {
    documents: esignDocuments,
    total: esignDocuments.length,
    completed: esignDocuments.filter((doc) => doc.bucket === "completed").length,
    in_progress: esignDocuments.filter((doc) => doc.bucket === "in_progress").length,
    not_started: esignDocuments.filter((doc) => doc.bucket === "not_started").length,
    signable_total: esignSignable.length,
    signable_completed: esignSignable.filter((doc) => doc.bucket === "completed").length,
    // Kit-level state the dispatcher maintains on the bridge row; shown beside the checklist
    // so HR can tell "nothing sent yet" from "sent and unsigned" without reading nine rows.
    kit_status: bridge[0]?.joining_document_status ?? null,
    kit_completion_pct: bridge[0]?.joining_document_completion_pct ?? null,
    kit_completed_at: bridge[0]?.joining_document_completed_at ?? null,
    digilocker_status: bridge[0]?.digilocker_status ?? null,
    penny_drop_status: bridge[0]?.penny_drop_status ?? null,
  };

  const taskLabels: Record<string, string> = {
    WFM_PROCESS_ALIGNMENT: "WFM Process Alignment",
    IT_EMAIL_DOMAIN_ASSET: "IT Email, Domain & Asset",
    ADMIN_BIOMETRIC_ID_CARD: "Admin Biometric & ID Card",
    APPOINTMENT_LETTER_ESIGN: "Appointment Letter E-Sign",
  };
  const taskRoles: Record<string, string> = {
    WFM_PROCESS_ALIGNMENT: "wfm",
    IT_EMAIL_DOMAIN_ASSET: "it",
    ADMIN_BIOMETRIC_ID_CARD: "admin",
    APPOINTMENT_LETTER_ESIGN: "hr",
  };

  const blockers = readinessBlockers(summary);
  return {
    summary: {
      ...summary,
      readiness_status: blockers.length ? "blocked" : summary.employee_code ? "employee_created" : "ready",
      blockers,
      next_action: nextAction(blockers),
    },
    // profile and bank are SELECT *, so they carry the at-rest crypto columns
    // (pan_number_encrypted, *_hash, account_no_encrypted, onboarding_token_hash). This
    // router admits it, operations_manager and branch_head among others, and none of them
    // — nor anyone else — has a use for ciphertext or a lookup hash.
    onboarding: {
      profile: stripCryptoPlumbing(profile[0] ?? null),
      bank: stripCryptoPlumbing(bank[0] ?? null),
      qualifications,
      experience,
    },
    offer: offerRows[0] ?? null,
    payroll: payroll[0] ?? null,
    salaryProposal: salaryProposal[0] ?? null,
    salarySteps,
    jclr: jclr[0] ?? null,
    statutory: statutory[0] ?? null,
    dpdp,
    withdrawals,
    esign,
    employee: bridge[0] ?? null,
    provisioningTasks: provTasks.map((t) => ({
      task_code: t.task_code,
      task_label: taskLabels[t.task_code] || t.task_code,
      assigned_role: taskRoles[t.task_code] || "unknown",
      status: t.status,
      assigned_to_name: t.assigned_to_name,
      completed_at: t.completed_at,
      sla_due: t.sla_due,
    })),
  };
}

export async function savePayrollControlRoomDetails(candidateId: string, input: JsonRecord, actorId: string) {
  // JCR only updates effective dates and remarks — salary is set in onboarding-requests offer form
  const salaryStartDate = String(input.salary_start_date || "");
  const attendanceEffective = String(input.attendance_effective_from || salaryStartDate);
  const statutoryEffective = String(input.statutory_effective_from || salaryStartDate);
  const payrollMonth = String(input.payroll_month_effective || monthOf(salaryStartDate));
  const reason = String(input.salary_effective_date_reason || "");
  const joiningRemarks = String(input.joining_remarks || "");

  // Get joining date from offer (source of truth)
  const [offerRows] = await db.execute<RowDataPacket[]>(
    `SELECT date_of_joining, date_of_salary FROM ats_employment_offer WHERE candidate_id = ? ORDER BY created_at DESC LIMIT 1`,
    [candidateId],
  );
  const offer = offerRows[0];
  const joiningDate = offer?.date_of_joining ? toDateOnly(offer.date_of_joining) : null;
  const originalSalaryDate = offer?.date_of_salary ? toDateOnly(offer.date_of_salary) : joiningDate;

  // Validate salary start date if changed from original
  if (salaryStartDate && originalSalaryDate && salaryStartDate !== originalSalaryDate && !reason.trim()) {
    throw Object.assign(new Error("salary_effective_date_reason is required when salary start date differs from offer"), { statusCode: 400 });
  }

  // Check if ats_payroll_hr_validation row exists; if not, seed minimal record from offer
  const [existingRows] = await db.execute<RowDataPacket[]>(
    `SELECT id FROM ats_payroll_hr_validation WHERE candidate_id = ? LIMIT 1`,
    [candidateId],
  );

  if (!existingRows[0]) {
    // Create minimal record seeded from offer data
    const [branchRows] = await db.execute<RowDataPacket[]>(
      `SELECT COALESCE(b.id, c.applied_for_branch) AS branch_id
         FROM ats_candidate c
         LEFT JOIN branch_master b ON b.id = c.applied_for_branch OR b.branch_name = c.applied_for_branch
        WHERE c.id = ? LIMIT 1`,
      [candidateId],
    );
    const branchId = branchRows[0]?.branch_id || null;

    // INSERT ... SELECT FROM ats_employment_offer: with no offer row for this
    // candidate the SELECT returns nothing and the INSERT writes nothing — no
    // error, no row. Payroll HR fills the form, saves, is told it worked, and
    // no validation record exists. Since validation is a hard gate on employee
    // creation, the candidate then sits in the queue indefinitely with nothing
    // to show why.
    //
    // 31 of the 44 submitted candidates in production have no employment offer,
    // so this is the common case, not the edge one. affectedRows is checked
    // below and the failure is raised.
    const [seedResult] = await db.execute<ResultSetHeader>(
      `INSERT INTO ats_payroll_hr_validation
         (id, candidate_id, branch_id, payroll_hr_id, validation_status,
          employment_type, department_id, designation_id, cost_centre_id, reporting_manager_id,
          gross_salary, joining_date, salary_start_date,
          attendance_effective_from, statutory_effective_from, payroll_month_effective,
          salary_effective_date_reason, joining_remarks, validated_at)
       SELECT UUID(), ?, ?, ?, 'validated',
              o.emp_type, o.department_id, o.designation_id, o.cost_centre, o.reporting_manager_id,
              o.gross, o.date_of_joining, COALESCE(?, o.date_of_salary, o.date_of_joining),
              COALESCE(?, o.date_of_salary, o.date_of_joining),
              COALESCE(?, o.date_of_salary, o.date_of_joining),
              ?,
              ?, ?, NOW()
         FROM ats_employment_offer o
        WHERE o.candidate_id = ?
        ORDER BY o.created_at DESC
        LIMIT 1`,
      [
        candidateId, branchId, actorId,
        salaryStartDate || null,
        attendanceEffective || null,
        statutoryEffective || null,
        payrollMonth || null,
        reason || null, joiningRemarks || null,
        candidateId,
      ],
    );

    if (seedResult.affectedRows === 0) {
      throw Object.assign(
        new Error(
          "Payroll validation could not be created because this candidate has no employment offer. " +
          "Raise and approve the offer first — the validation record is seeded from it."
        ),
        { statusCode: 400 },
      );
    }
  } else {
    // Update only JCR-specific effective date fields
    await db.execute(
      `UPDATE ats_payroll_hr_validation
          SET salary_start_date = COALESCE(?, salary_start_date),
              attendance_effective_from = COALESCE(?, attendance_effective_from),
              statutory_effective_from = COALESCE(?, statutory_effective_from),
              payroll_month_effective = COALESCE(?, payroll_month_effective),
              salary_effective_date_reason = COALESCE(?, salary_effective_date_reason),
              joining_remarks = COALESCE(?, joining_remarks),
              payroll_hr_id = ?,
              validation_status = 'validated'
        WHERE candidate_id = ?`,
      [
        salaryStartDate || null,
        attendanceEffective || null,
        statutoryEffective || null,
        payrollMonth || null,
        reason || null,
        joiningRemarks || null,
        actorId,
        candidateId,
      ],
    );
  }

  return getJoiningControlRoomCandidate(candidateId);
}

export async function saveJclrDetails(candidateId: string, input: JsonRecord, actorId: string) {
  const existing = await candidateSnapshot(candidateId);
  const oldStatus = existing?.jclr_status ? String(existing.jclr_status) : null;
  if (String(existing?.jclr_approval_status || "").toLowerCase() !== "approved") {
    throw Object.assign(new Error("Payroll HR JCLR Entry is blocked until BM / Branch Head JCLR Approval is approved"), { statusCode: 409 });
  }
  await db.execute(
    `INSERT INTO jclr_detail
       (id, candidate_id, joining_location, joining_floor, work_station, system_required, headset_required,
        id_card_required, training_batch, trainer_name, induction_slot, transport_required, transport_route,
        joining_coordinator_id, jclr_status, blocker_reason, remarks, created_by, updated_by)
     VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       joining_location = VALUES(joining_location),
       joining_floor = VALUES(joining_floor),
       work_station = VALUES(work_station),
       system_required = VALUES(system_required),
       headset_required = VALUES(headset_required),
       id_card_required = VALUES(id_card_required),
       training_batch = VALUES(training_batch),
       trainer_name = VALUES(trainer_name),
       induction_slot = VALUES(induction_slot),
       transport_required = VALUES(transport_required),
       transport_route = VALUES(transport_route),
       joining_coordinator_id = VALUES(joining_coordinator_id),
       jclr_status = VALUES(jclr_status),
       blocker_reason = VALUES(blocker_reason),
       remarks = VALUES(remarks),
       updated_by = VALUES(updated_by)`,
    [
      candidateId,
      input.joining_location || null,
      input.joining_floor || null,
      input.work_station || null,
      input.system_required === false ? 0 : 1,
      input.headset_required ? 1 : 0,
      input.id_card_required === false ? 0 : 1,
      input.training_batch || null,
      input.trainer_name || null,
      input.induction_slot || null,
      input.transport_required ? 1 : 0,
      input.transport_route || null,
      input.joining_coordinator_id || null,
      input.jclr_status || "pending",
      input.blocker_reason || null,
      input.remarks || null,
      actorId,
      actorId,
    ],
  );
  await db.execute(
    `INSERT INTO jclr_audit_log (id, candidate_id, actor_id, action, old_status, new_status, payload_json)
     VALUES (UUID(), ?, ?, 'SAVE_JCLR', ?, ?, ?)`,
    [candidateId, actorId, oldStatus, input.jclr_status || "pending", JSON.stringify(input)],
  );
  return getJoiningControlRoomCandidate(candidateId);
}

export async function saveStatutoryDeclaration(candidateId: string, input: JsonRecord, actorId: string) {
  await db.execute(
    `INSERT INTO statutory_declaration
       (id, candidate_id, epf_member, uan, pf_applicable, esi_applicable, professional_tax_state,
        nominee_name, nominee_relationship, nominee_dob, declaration_status, verified_by, verified_at,
        rejection_reason, remarks, created_by, updated_by)
     VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CASE WHEN ? = 'verified' THEN NOW() ELSE NULL END, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       epf_member = VALUES(epf_member),
       uan = VALUES(uan),
       pf_applicable = VALUES(pf_applicable),
       esi_applicable = VALUES(esi_applicable),
       professional_tax_state = VALUES(professional_tax_state),
       nominee_name = VALUES(nominee_name),
       nominee_relationship = VALUES(nominee_relationship),
       nominee_dob = VALUES(nominee_dob),
       declaration_status = VALUES(declaration_status),
       verified_by = VALUES(verified_by),
       verified_at = VALUES(verified_at),
       rejection_reason = VALUES(rejection_reason),
       remarks = VALUES(remarks),
       updated_by = VALUES(updated_by)`,
    [
      candidateId,
      input.epf_member || "unknown",
      input.uan || null,
      input.pf_applicable === false ? 0 : 1,
      input.esi_applicable ? 1 : 0,
      input.professional_tax_state || null,
      input.nominee_name || null,
      input.nominee_relationship || null,
      input.nominee_dob || null,
      input.declaration_status || "pending",
      input.declaration_status === "verified" ? actorId : null,
      input.declaration_status || "pending",
      input.rejection_reason || null,
      input.remarks || null,
      actorId,
      actorId,
    ],
  );
  await db.execute(
    `INSERT INTO statutory_declaration_audit_log (id, candidate_id, actor_id, action, payload_json)
     VALUES (UUID(), ?, ?, 'SAVE_STATUTORY', ?)`,
    [candidateId, actorId, JSON.stringify(input)],
  );
  return getJoiningControlRoomCandidate(candidateId);
}

export async function upsertDpdpConsent(candidateId: string, input: JsonRecord, actorId: string) {
  const purpose = String(input.purpose_code || "candidate_onboarding");
  const status = String(input.consent_status || "granted");
  await db.execute(
    `INSERT INTO dpdp_consent_register
       (id, candidate_id, purpose_code, consent_status, consent_text_version, lawful_basis, granted_at, withdrawn_at, source, actor_id)
     VALUES (UUID(), ?, ?, ?, ?, ?, CASE WHEN ? = 'granted' THEN NOW() ELSE NULL END, CASE WHEN ? = 'withdrawn' THEN NOW() ELSE NULL END, ?, ?)
     ON DUPLICATE KEY UPDATE
       consent_status = VALUES(consent_status),
       consent_text_version = VALUES(consent_text_version),
       lawful_basis = VALUES(lawful_basis),
       granted_at = COALESCE(VALUES(granted_at), granted_at),
       withdrawn_at = VALUES(withdrawn_at),
       source = VALUES(source),
       actor_id = VALUES(actor_id),
       updated_at = NOW()`,
    [candidateId, purpose, status, input.consent_text_version || null, input.lawful_basis || "consent", status, status, input.source || "hr_control_room", actorId],
  );
  await db.execute(
    `INSERT INTO dpdp_processing_activity_log (id, candidate_id, actor_id, purpose_code, action, data_category, lawful_basis, payload_json)
     VALUES (UUID(), ?, ?, ?, 'CONSENT_UPDATE', ?, ?, ?)`,
    [candidateId, actorId, purpose, input.data_category || "candidate_onboarding", input.lawful_basis || "consent", JSON.stringify(input)],
  );
  return getJoiningControlRoomCandidate(candidateId);
}

export async function requestDpdpWithdrawal(candidateId: string, input: JsonRecord, actorId: string) {
  const purpose = String(input.purpose_code || "candidate_onboarding");
  await db.execute(
    `INSERT INTO dpdp_consent_withdrawal (id, requester_id, requester_type, withdrawal_reason, status)
     VALUES (UUID(), ?, 'candidate', ?, 'submitted')`,
    [candidateId, String(input.reason || "Withdrawal requested from HR control room")],
  );
  return getJoiningControlRoomCandidate(candidateId);
}

export async function validateReadiness(candidateId: string) {
  const summary = await candidateSnapshot(candidateId);
  const blockers = readinessBlockers(summary);
  const status = blockers.length ? "blocked" : summary?.employee_code ? "employee_created" : "ready";
  await db.execute(
    `INSERT INTO joining_control_room_snapshot
       (id, candidate_id, readiness_status, blockers_json, next_action, snapshot_json)
     VALUES (UUID(), ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       readiness_status = VALUES(readiness_status),
       blockers_json = VALUES(blockers_json),
       next_action = VALUES(next_action),
       snapshot_json = VALUES(snapshot_json),
       updated_at = NOW()`,
    [candidateId, status, JSON.stringify(blockers), nextAction(blockers), JSON.stringify(summary || {})],
  );
  return { candidate_id: candidateId, readiness_status: status, blockers, next_action: nextAction(blockers) };
}

export async function lockSalaryRegister(candidateId: string, actorId: string) {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT phr.*, sep.status AS proposal_status, sep.proposed_gross_salary
       FROM ats_payroll_hr_validation phr
       LEFT JOIN salary_exception_proposal sep ON sep.candidate_id = phr.candidate_id
      WHERE phr.candidate_id = ?
      LIMIT 1`,
    [candidateId],
  );
  const payroll = rows[0];
  if (!payroll) throw Object.assign(new Error("Payroll HR validation is required before locking salary register"), { statusCode: 409 });
  if (payroll.proposal_status && payroll.proposal_status !== "approved") {
    throw Object.assign(new Error("Salary proposal must be approved before salary register lock"), { statusCode: 409 });
  }
  const salaryEffective = toDateOnly(payroll.salary_start_date || payroll.joining_date);
  if (!salaryEffective) throw Object.assign(new Error("Salary effective date is missing"), { statusCode: 409 });
  const gross = Number(payroll.proposed_gross_salary || payroll.gross_salary || 0);
  const salaryRegisterId = randomUUID();
  await db.execute(
    `INSERT INTO salary_register
       (id, candidate_id, salary_slab_id, approved_ctc_annual, locked_status, locked_by, locked_at, created_by)
     VALUES (?, ?, ?, ?, 1, ?, NOW(), ?)
     ON DUPLICATE KEY UPDATE
       salary_slab_id = VALUES(salary_slab_id),
       approved_ctc_annual = VALUES(approved_ctc_annual),
       locked_status = 1,
       locked_by = VALUES(locked_by),
       locked_at = NOW()`,
    [
      salaryRegisterId,
      candidateId,
      payroll.salary_slab_id,
      gross,
      actorId,
      actorId,
    ],
  );
  await db.execute(
    `UPDATE ats_payroll_hr_validation
        SET salary_register_locked = 1,
            salary_register_id = (SELECT id FROM salary_register WHERE candidate_id = ? LIMIT 1)
      WHERE candidate_id = ?`,
    [candidateId, candidateId],
  );
  await db.execute(
    `INSERT INTO salary_register_audit_log (id, candidate_id, salary_register_id, actor_id, action, payload_json)
     VALUES (UUID(), ?, (SELECT id FROM salary_register WHERE candidate_id = ? LIMIT 1), ?, 'LOCK', ?)`,
    [candidateId, candidateId, actorId, JSON.stringify({ gross, salaryEffective })],
  );
  return getJoiningControlRoomCandidate(candidateId);
}

export async function approveSalaryProposal(candidateId: string, input: JsonRecord, actorId: string) {
  const level = String(input.approval_level || "bm");
  const action = String(input.action || "approved");
  const [proposalRows] = await db.execute<RowDataPacket[]>(`SELECT * FROM salary_exception_proposal WHERE candidate_id = ? LIMIT 1`, [candidateId]);
  const proposal = proposalRows[0];
  if (!proposal) throw Object.assign(new Error("Salary proposal not found"), { statusCode: 404 });
  await db.execute(
    `INSERT INTO salary_proposal_approval_step
       (id, proposal_id, candidate_id, approval_level, approver_id, status, remarks, acted_at)
     VALUES (UUID(), ?, ?, ?, ?, ?, ?, NOW())
     ON DUPLICATE KEY UPDATE
       approver_id = VALUES(approver_id),
       status = VALUES(status),
       remarks = VALUES(remarks),
       acted_at = NOW()`,
    [proposal.id, candidateId, level, actorId, action === "rejected" ? "rejected" : "approved", input.remarks || null],
  );
  const nextStage: Record<string, string> = { bm: "operations", operations: "payroll", payroll: "finance", finance: "completed" };
  const finalStatus = action === "rejected" ? "rejected" : level === "finance" ? "approved" : "pending";
  await db.execute(
    `UPDATE salary_exception_proposal
        SET status = ?, approval_stage = ?, approved_by = CASE WHEN ? = 'approved' THEN ? ELSE approved_by END,
            approved_at = CASE WHEN ? = 'approved' THEN NOW() ELSE approved_at END,
            rejection_reason = CASE WHEN ? = 'rejected' THEN ? ELSE rejection_reason END,
            updated_at = NOW()
      WHERE id = ?`,
    [finalStatus, action === "rejected" ? level : nextStage[level] || "completed", finalStatus, actorId, finalStatus, action, input.remarks || null, proposal.id],
  );
  return getJoiningControlRoomCandidate(candidateId);
}

export async function generateEmployeeCode(candidateId: string, actorId: string) {
  const readiness = await validateReadiness(candidateId);
  if (readiness.blockers.length) {
    throw Object.assign(new Error(`Employee code blocked: ${readiness.blockers.join("; ")}`), { statusCode: 409, blockers: readiness.blockers });
  }
  const result = await convertCandidateToEmployee(candidateId, actorId);
  await validateReadiness(candidateId);
  return result;
}
