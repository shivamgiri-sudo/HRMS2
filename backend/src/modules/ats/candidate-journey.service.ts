/**
 * One candidate's complete journey, assembled from the tables that already
 * record it.
 *
 * Nothing here is new data. Every phase below is already written somewhere —
 * 1727 stage-log rows, 1169 interview submissions, 1165 queue tokens, 218 BGV
 * checks in production — but no endpoint ever joined them, so a branch head
 * could see a name and a salary and nothing about how the person got there.
 *
 * Each source is queried independently and guarded twice: once against
 * information_schema, so a table or column missing in one environment is
 * reported in `gaps` rather than throwing, and once in a try/catch, so an
 * unexpected failure loses that source instead of the whole journey. A journey
 * that silently omits a phase is worse than one that says which phase it could
 * not read — the reader cannot tell the difference between "this never
 * happened" and "this failed to load".
 *
 * Deliberately NOT reusing getJoiningControlRoomCandidate: it selects
 * r.candidate_id, r.assigned_to, r.completed_at and r.sla_due from
 * it_provisioning_request (joining-control-room.service.ts:212-220), and none of
 * those columns exist — that table has employee_id, assigned_user_id,
 * actioned_at and sla_due_at. That query throws today.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

export type JourneyPhase =
  | "APPLICATION" | "INTERVIEW" | "OFFER" | "PAYROLL"
  | "BRANCH_HEAD" | "BGV" | "EMPLOYEE" | "JOINING_DOCS" | "PROVISIONING";

export const JOURNEY_PHASES: JourneyPhase[] = [
  "APPLICATION", "INTERVIEW", "OFFER", "PAYROLL",
  "BRANCH_HEAD", "BGV", "EMPLOYEE", "JOINING_DOCS", "PROVISIONING",
];

export type JourneyEvent = {
  phase: JourneyPhase;
  activity_type: string;
  status: string | null;
  occurred_at: string | null;
  actor_name: string | null;
  source_table: string;
  source_record_id: string | null;
  detail: string | null;
};

export type JourneyResult = {
  candidate: Record<string, unknown> | null;
  employee: { id: string; employee_code: string | null } | null;
  phaseSummary: Array<{ phase: JourneyPhase; state: "done" | "in_progress" | "not_reached"; at: string | null }>;
  events: JourneyEvent[];
  /** Sources that could not be read, so the UI can say so rather than imply absence. */
  gaps: string[];
};

/** Tables present in this database, resolved once per request. */
async function presentTables(names: string[]): Promise<Set<string>> {
  if (names.length === 0) return new Set();
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT TABLE_NAME FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME IN (${names.map(() => "?").join(",")})`,
    names,
  ).catch(() => [[]] as unknown as [RowDataPacket[]]);
  return new Set(rows.map((r) => String(r.TABLE_NAME)));
}

const iso = (v: unknown): string | null =>
  v ? new Date(String(v)).toISOString() : null;

const txt = (v: unknown): string | null => {
  const s = String(v ?? "").trim();
  return s ? s : null;
};

export async function getCandidateFullJourney(candidateId: string): Promise<JourneyResult> {
  const events: JourneyEvent[] = [];
  const gaps: string[] = [];

  const tables = await presentTables([
    "ats_candidate", "ats_queue_token", "ats_candidate_stage_log", "ats_interview_submission",
    "ats_employment_offer", "ats_offer_approval", "ats_payroll_hr_validation",
    "ats_branch_head_approval", "candidate_bgv_check", "candidate_bgv_report",
    "ats_onboarding_bridge", "employee_joining_document_checklist", "it_provisioning_request",
  ]);

  /** Run one source; a failure costs that source only. */
  const source = async (label: string, table: string, fn: () => Promise<void>) => {
    if (!tables.has(table)) { gaps.push(`${label} (table ${table} not present)`); return; }
    try { await fn(); } catch (e) {
      gaps.push(`${label} (${e instanceof Error ? e.message : String(e)})`);
    }
  };

  // ── candidate header ───────────────────────────────────────────────────
  const [candRows] = await db.execute<RowDataPacket[]>(
    `SELECT c.id, c.candidate_code, c.full_name, c.mobile, c.email,
            c.applied_for_branch, c.branch_display_name, c.applied_for_process,
            c.current_stage, c.status, c.final_decision, c.sourcing_channel,
            c.created_at, c.employee_code,
            b.branch_name
       FROM ats_candidate c
       LEFT JOIN branch_master b
              ON b.id = c.applied_for_branch
              OR b.branch_name = c.applied_for_branch
              OR b.branch_code = c.applied_for_branch
      WHERE c.id = ? LIMIT 1`,
    [candidateId],
  ).catch(() => [[]] as unknown as [RowDataPacket[]]);
  const candidate = candRows[0] ?? null;

  // ── APPLICATION ────────────────────────────────────────────────────────
  if (candidate) {
    events.push({
      phase: "APPLICATION", activity_type: "Applied",
      status: txt(candidate.status), occurred_at: iso(candidate.created_at),
      actor_name: txt(candidate.sourcing_channel), source_table: "ats_candidate",
      source_record_id: String(candidate.id),
      detail: txt(candidate.applied_for_process),
    });
  }

  await source("Walk-in queue", "ats_queue_token", async () => {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT id, token_number, arrival_time, called_at, interview_started_at,
              interview_completed_at, queue_status, branch_name
         FROM ats_queue_token WHERE candidate_id = ? ORDER BY arrival_time`,
      [candidateId],
    );
    for (const r of rows) {
      const id = String(r.id);
      if (r.arrival_time) events.push({ phase: "APPLICATION", activity_type: "Arrived at branch",
        status: txt(r.queue_status), occurred_at: iso(r.arrival_time), actor_name: txt(r.branch_name),
        source_table: "ats_queue_token", source_record_id: id, detail: txt(r.token_number) });
      if (r.called_at) events.push({ phase: "INTERVIEW", activity_type: "Called for interview",
        status: null, occurred_at: iso(r.called_at), actor_name: null,
        source_table: "ats_queue_token", source_record_id: id, detail: null });
    }
  });

  // ── INTERVIEW ──────────────────────────────────────────────────────────
  await source("Stage history", "ats_candidate_stage_log", async () => {
    // updated_by holds an employees.id from some writers and an auth user id
    // from others, so both have to be tried — but as TWO joins, never as
    // `ON e.id = s.updated_by OR e.user_id = s.updated_by`.
    //
    // Speed: an OR across two columns disqualifies both indexes. EXPLAIN
    // degraded to type=ALL over all 57,498 employees, once per stage-log row —
    // 8,087 ms for one candidate, most of the ~10 s the drawer took to open.
    // Split across PRIMARY and idx_emp_user it returns in 12 ms.
    //
    // Correctness: the OR also FANNED OUT. 69 of the 1,746 stage rows with an
    // actor match an employees.id AND a different employee's user_id, so the
    // join emitted the same event twice under two different names. The dedupe
    // at the bottom of this file collapsed them by source_record_id, keeping
    // whichever row MySQL happened to return first — the duplicate was
    // invisible, but which name won was luck.
    //
    // user_id is preferred deliberately. In every observed collision the
    // id-match is a defunct seed row (ADMIN001, active_status=0) whose primary
    // key equals the real person's auth user id, while the user_id match is
    // their live record (MAS47814, active). Preferring user_id names the person
    // who acted and preserves what the drawer shows today.
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT s.id, s.from_stage, s.to_stage, s.stage_date, s.created_at, s.remarks,
              COALESCE(e_user.full_name, e_id.full_name) AS actor_name
         FROM ats_candidate_stage_log s
         LEFT JOIN employees e_user ON e_user.user_id = s.updated_by
         LEFT JOIN employees e_id   ON e_id.id = s.updated_by
        WHERE s.candidate_id = ?
        ORDER BY COALESCE(s.stage_date, s.created_at)`,
      [candidateId],
    );
    for (const r of rows) {
      events.push({
        phase: "INTERVIEW",
        activity_type: `Stage: ${txt(r.from_stage) ?? "?"} → ${txt(r.to_stage) ?? "?"}`,
        status: txt(r.to_stage), occurred_at: iso(r.stage_date ?? r.created_at),
        actor_name: txt(r.actor_name), source_table: "ats_candidate_stage_log",
        source_record_id: String(r.id), detail: txt(r.remarks),
      });
    }
  });

  // ats_interview_submission is the real interview record — 1169 rows against
  // 3 in ats_interview_result.
  await source("Interview rounds", "ats_interview_submission", async () => {
    const [rows] = await db.execute<RowDataPacket[]>(
      // Two joins, not an OR — see the note on the stage-history query above.
      // This one cost 1,057 ms as a single OR-join.
      `SELECT i.id, i.submitted_at, i.walkin_end_stage, i.final_decision,
              i.round1_result, i.round2_result, i.round3_result,
              i.interviewed_for_process, i.recruiter_code,
              COALESCE(e_user.full_name, e_id.full_name) AS actor_name
         FROM ats_interview_submission i
         LEFT JOIN employees e_user ON e_user.user_id = i.recruiter_user_id
         LEFT JOIN employees e_id   ON e_id.id = i.recruiter_user_id
        WHERE i.candidate_id = ? ORDER BY i.submitted_at`,
      [candidateId],
    );
    for (const r of rows) {
      const rounds = [
        ["Round 1", r.round1_result], ["Round 2", r.round2_result], ["Round 3", r.round3_result],
      ].filter(([, v]) => txt(v)).map(([k, v]) => `${k}: ${txt(v)}`).join(" · ");
      events.push({
        phase: "INTERVIEW", activity_type: "Interview submitted",
        status: txt(r.final_decision) ?? txt(r.walkin_end_stage),
        occurred_at: iso(r.submitted_at),
        actor_name: txt(r.actor_name) ?? txt(r.recruiter_code),
        source_table: "ats_interview_submission", source_record_id: String(r.id),
        detail: rounds || txt(r.interviewed_for_process),
      });
    }
  });

  // ── OFFER ──────────────────────────────────────────────────────────────
  await source("Offer", "ats_employment_offer", async () => {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT id, status, gross, offered_ctc, date_of_joining, submitted_at, created_at, approved_at
         FROM ats_employment_offer WHERE candidate_id = ? ORDER BY created_at`,
      [candidateId],
    );
    for (const r of rows) {
      events.push({
        phase: "OFFER", activity_type: "Offer raised", status: txt(r.status),
        occurred_at: iso(r.submitted_at ?? r.created_at), actor_name: null,
        source_table: "ats_employment_offer", source_record_id: String(r.id),
        detail: r.gross ? `Gross ${r.gross}${r.date_of_joining ? ` · DOJ ${String(r.date_of_joining).slice(0, 10)}` : ""}` : null,
      });
    }
  });

  await source("Offer decisions", "ats_offer_approval", async () => {
    const [rows] = await db.execute<RowDataPacket[]>(
      // Two joins, not an OR — see the note on the stage-history query above.
      // approver_id is written from req.authUser.id (ats.onboarding.routes.ts),
      // so the user_id match is the intended one and is tried first.
      `SELECT a.id, a.action, a.remarks, a.action_at,
              COALESCE(e_user.full_name, e_id.full_name) AS actor_name
         FROM ats_offer_approval a
         JOIN ats_employment_offer o ON o.id = a.offer_id
         LEFT JOIN employees e_user ON e_user.user_id = a.approver_id
         LEFT JOIN employees e_id   ON e_id.id = a.approver_id
        WHERE o.candidate_id = ? ORDER BY a.action_at`,
      [candidateId],
    );
    for (const r of rows) {
      events.push({
        phase: "BRANCH_HEAD", activity_type: `Offer ${txt(r.action)}`,
        status: txt(r.action), occurred_at: iso(r.action_at),
        actor_name: txt(r.actor_name), source_table: "ats_offer_approval",
        source_record_id: String(r.id), detail: txt(r.remarks),
      });
    }
  });

  // ── PAYROLL ────────────────────────────────────────────────────────────
  await source("Payroll validation", "ats_payroll_hr_validation", async () => {
    const [rows] = await db.execute<RowDataPacket[]>(
      // Two joins, not an OR. Both sides target employees.id here, but the OR
      // still made the key unusable — 1,102 ms for one candidate. validated_by
      // is preferred over payroll_hr_id, the order the OR resolved in.
      `SELECT p.id, p.validation_status, p.gross_salary, p.joining_date,
              p.validated_at, p.created_at,
              COALESCE(e_val.full_name, e_hr.full_name) AS actor_name
         FROM ats_payroll_hr_validation p
         LEFT JOIN employees e_val ON e_val.id = p.validated_by
         LEFT JOIN employees e_hr  ON e_hr.id = p.payroll_hr_id
        WHERE p.candidate_id = ? ORDER BY COALESCE(p.validated_at, p.created_at)`,
      [candidateId],
    );
    for (const r of rows) {
      events.push({
        phase: "PAYROLL", activity_type: "Salary validated by Payroll HR",
        status: txt(r.validation_status), occurred_at: iso(r.validated_at ?? r.created_at),
        actor_name: txt(r.actor_name), source_table: "ats_payroll_hr_validation",
        source_record_id: String(r.id),
        detail: r.gross_salary ? `Gross ${r.gross_salary}` : null,
      });
    }
  });

  // ── BRANCH HEAD (the approval table) ───────────────────────────────────
  await source("Branch head decision", "ats_branch_head_approval", async () => {
    // Reached via payroll_validation_id: production's migration 141 has no
    // candidate_id on this table.
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT b.id, b.approval_status, b.remarks, b.approved_at, b.notified_at,
              e.full_name AS actor_name
         FROM ats_branch_head_approval b
         JOIN ats_payroll_hr_validation p ON p.id = b.payroll_validation_id
         LEFT JOIN employees e ON e.id = b.branch_head_id
        WHERE p.candidate_id = ?`,
      [candidateId],
    );
    for (const r of rows) {
      const id = String(r.id);
      if (r.notified_at) events.push({ phase: "BRANCH_HEAD", activity_type: "Sent to Branch Head",
        status: "pending", occurred_at: iso(r.notified_at), actor_name: null,
        source_table: "ats_branch_head_approval", source_record_id: id, detail: null });
      if (r.approved_at && String(r.approval_status) !== "pending") {
        events.push({ phase: "BRANCH_HEAD", activity_type: `Branch Head ${txt(r.approval_status)}`,
          status: txt(r.approval_status), occurred_at: iso(r.approved_at),
          actor_name: txt(r.actor_name), source_table: "ats_branch_head_approval",
          source_record_id: id, detail: txt(r.remarks) });
      }
    }
  });

  // ── BGV ────────────────────────────────────────────────────────────────
  await source("BGV checks", "candidate_bgv_check", async () => {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT id, check_type, status, provider_key, verified_at, created_at
         FROM candidate_bgv_check WHERE candidate_id = ?
        ORDER BY COALESCE(verified_at, created_at)`,
      [candidateId],
    );
    for (const r of rows) {
      events.push({
        phase: "BGV", activity_type: `BGV: ${txt(r.check_type) ?? "check"}`,
        status: txt(r.status), occurred_at: iso(r.verified_at ?? r.created_at),
        actor_name: txt(r.provider_key), source_table: "candidate_bgv_check",
        source_record_id: String(r.id), detail: null,
      });
    }
  });

  await source("BGV report", "candidate_bgv_report", async () => {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT id, overall_status, bgv_score, completed_at, created_at
         FROM candidate_bgv_report WHERE candidate_id = ?`,
      [candidateId],
    );
    for (const r of rows) {
      events.push({
        phase: "BGV", activity_type: "BGV report",
        status: txt(r.overall_status), occurred_at: iso(r.completed_at ?? r.created_at),
        actor_name: null, source_table: "candidate_bgv_report", source_record_id: String(r.id),
        detail: r.bgv_score != null ? `Score ${r.bgv_score}` : null,
      });
    }
  });

  // ── EMPLOYEE ───────────────────────────────────────────────────────────
  let employee: JourneyResult["employee"] = null;
  await source("Employee record", "ats_onboarding_bridge", async () => {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT ob.id, ob.employee_id, ob.bridge_date, ob.joining_date, ob.created_at,
              COALESCE(e.employee_code, ob.employee_code) AS employee_code
         FROM ats_onboarding_bridge ob
         LEFT JOIN employees e ON e.id = ob.employee_id
        WHERE ob.candidate_id = ? ORDER BY ob.created_at DESC`,
      [candidateId],
    );
    for (const r of rows) {
      if (r.employee_id && !employee) {
        employee = { id: String(r.employee_id), employee_code: txt(r.employee_code) };
      }
      // A bridge row exists from the moment onboarding starts; the employee is
      // only real once employee_id is set. Saying "Employee record created"
      // for a bridge with no employee contradicts the header, which correctly
      // reports none.
      events.push({
        phase: r.employee_id ? "EMPLOYEE" : "OFFER",
        activity_type: r.employee_id ? "Employee record created" : "Onboarding started",
        status: txt(r.employee_code), occurred_at: iso(r.bridge_date ?? r.created_at),
        actor_name: null, source_table: "ats_onboarding_bridge", source_record_id: String(r.id),
        detail: r.joining_date ? `Joining ${String(r.joining_date).slice(0, 10)}` : null,
      });
    }
  });

  // ── JOINING DOCUMENTS ──────────────────────────────────────────────────
  // This table carries candidate_id directly, so it does not depend on the
  // employee bridge having been created.
  await source("Joining documents", "employee_joining_document_checklist", async () => {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT id, document_name, document_code, status, mandatory, completed_at, updated_at, created_at
         FROM employee_joining_document_checklist
        WHERE candidate_id = ? OR (? IS NOT NULL AND employee_id = ?)
        ORDER BY COALESCE(completed_at, updated_at, created_at)`,
      [candidateId, employee?.id ?? null, employee?.id ?? null],
    );
    for (const r of rows) {
      events.push({
        phase: "JOINING_DOCS", activity_type: txt(r.document_name) ?? txt(r.document_code) ?? "Document",
        status: txt(r.status), occurred_at: iso(r.completed_at ?? r.updated_at ?? r.created_at),
        actor_name: null, source_table: "employee_joining_document_checklist",
        source_record_id: String(r.id), detail: Number(r.mandatory) === 1 ? "Mandatory" : null,
      });
    }
  });

  // ── PROVISIONING ───────────────────────────────────────────────────────
  // Keyed on employee_id only. This table has no candidate_id.
  // `employee` is only ever assigned inside the closure above, which TypeScript's
  // control-flow analysis cannot see — it still believes the value is null. The
  // cast restores the declared type.
  const emp = employee as { id: string; employee_code: string | null } | null;
  if (emp?.id) {
    await source("Provisioning tasks", "it_provisioning_request", async () => {
      const [rows] = await db.execute<RowDataPacket[]>(
        // Two joins, not an OR — see the note on the stage-history query above.
        `SELECT r.id, r.task_code, r.assigned_role, r.status, r.requested_at, r.actioned_at,
                COALESCE(e_user.full_name, e_id.full_name) AS actor_name
           FROM it_provisioning_request r
           LEFT JOIN employees e_user ON e_user.user_id = r.actioned_by
           LEFT JOIN employees e_id   ON e_id.id = r.actioned_by
          WHERE r.employee_id = ? ORDER BY r.requested_at`,
        [emp.id],
      );
      for (const r of rows) {
        events.push({
          phase: "PROVISIONING", activity_type: txt(r.task_code) ?? "Provisioning task",
          status: txt(r.status), occurred_at: iso(r.actioned_at ?? r.requested_at),
          actor_name: txt(r.actor_name) ?? txt(r.assigned_role),
          source_table: "it_provisioning_request", source_record_id: String(r.id), detail: null,
        });
      }
    });
  } else {
    gaps.push("Provisioning tasks (no employee record yet)");
  }

  // ── PAYROLL HEAD SALARY ASSIGNMENT ────────────────────────────────────
  // Shows the final salary confirmed by Payroll Head, with full component
  // breakdown (Basic / HRA / Conveyance / Special / Gross / Net). Branch Head
  // approves the OFFER salary; Payroll Head can revise it independently. BH
  // needs to see what was FINALLY assigned — not just what they approved.
  if (emp?.id) {
    await source("Payroll Head salary review", "employee_payroll_head_review", async () => {
      const [reviewRows] = await db.execute<RowDataPacket[]>(
        `SELECT phr.status, phr.reviewed_at, phr.package_effective_from,
                phr.rejection_category, phr.rejection_reason_code, phr.rejection_remarks,
                sca.basic, sca.hra, sca.conveyance, sca.special_allowance, sca.gross,
                sca.net_estimate, sca.effective_date,
                spm.name AS package_name, spm.band_code,
                COALESCE(ra.full_name, ra.email) AS reviewed_by_name
           FROM employee_payroll_head_review phr
           LEFT JOIN salary_component_assignments sca
                  ON sca.employee_id = phr.employee_id AND sca.status = 'active'
           LEFT JOIN salary_package_master spm ON spm.id = phr.salary_package_id
           LEFT JOIN auth_user ra ON ra.id = phr.reviewed_by
          WHERE phr.employee_id = ?
          ORDER BY COALESCE(phr.reviewed_at, phr.created_at) DESC
          LIMIT 1`,
        [emp.id],
      ).catch(() => [[]] as unknown as [RowDataPacket[]]);

      const r = reviewRows[0];
      if (!r) return;

      if (r.status === 'approved' && r.gross) {
        const fmt = (n: unknown) => n != null ? `₹${Math.round(Number(n)).toLocaleString('en-IN')}` : null;
        const components = [
          r.basic          ? `Basic ${fmt(r.basic)}`          : null,
          r.hra            ? `HRA ${fmt(r.hra)}`               : null,
          r.conveyance     ? `Conv ${fmt(r.conveyance)}`       : null,
          r.special_allowance ? `Special ${fmt(r.special_allowance)}` : null,
          `Gross ${fmt(r.gross)}`,
          r.net_estimate   ? `Net ${fmt(r.net_estimate)}`      : null,
        ].filter(Boolean).join(' · ');

        events.push({
          phase: "EMPLOYEE",
          activity_type: "Salary confirmed by Payroll Head",
          status: r.package_name ? `${r.package_name}${r.band_code ? ` (Band ${r.band_code})` : ''}` : "Approved",
          occurred_at: iso(r.reviewed_at),
          actor_name: txt(r.reviewed_by_name),
          source_table: "employee_payroll_head_review",
          source_record_id: emp.id,
          detail: `${components}${r.effective_date ? ` · Effective ${String(r.effective_date).slice(0, 10)}` : ''}`,
        });
      } else if (r.status === 'rejected') {
        events.push({
          phase: "EMPLOYEE",
          activity_type: "Salary review rejected by Payroll Head",
          status: `${r.rejection_category ?? ''} / ${r.rejection_reason_code ?? ''}`.replace(/^\s*\/\s*/, ''),
          occurred_at: iso(r.reviewed_at),
          actor_name: txt(r.reviewed_by_name),
          source_table: "employee_payroll_head_review",
          source_record_id: emp.id,
          detail: txt(r.rejection_remarks),
        });
      } else {
        events.push({
          phase: "EMPLOYEE",
          activity_type: "Salary review pending (Payroll Head)",
          status: "PENDING REVIEW",
          occurred_at: null,
          actor_name: null,
          source_table: "employee_payroll_head_review",
          source_record_id: emp.id,
          detail: "Employee is excluded from payroll until Payroll Head approves.",
        });
      }
    });
  }

  // ── order, dedupe, summarise ───────────────────────────────────────────
  const seen = new Set<string>();
  const ordered = events
    .filter((e) => {
      const key = `${e.source_table}:${e.source_record_id}:${e.activity_type}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => {
      // Undated events sort last rather than to 1970.
      if (!a.occurred_at && !b.occurred_at) return 0;
      if (!a.occurred_at) return 1;
      if (!b.occurred_at) return -1;
      return a.occurred_at.localeCompare(b.occurred_at);
    });

  const phaseSummary = JOURNEY_PHASES.map((phase) => {
    const inPhase = ordered.filter((e) => e.phase === phase);
    const last = inPhase[inPhase.length - 1] ?? null;
    return {
      phase,
      state: (inPhase.length === 0 ? "not_reached" : "done") as "done" | "in_progress" | "not_reached",
      at: last?.occurred_at ?? null,
    };
  });

  return { candidate, employee, phaseSummary, events: ordered, gaps };
}
