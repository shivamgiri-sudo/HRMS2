import { buildScopeWhere } from "../../../../../shared/dashboardScope.js";
import { excludeEmployeeShapedCandidatesSql } from "../../../../ats/ats-reporting-scope.js";
import { one, empScope } from "../../helpers.js";
import type { InsightAction, InsightContext } from "../../types.js";
import { PENDENCY_CUTOFF_DATE, int, lit, memoized, queueSeverity } from "./shared.js";

/**
 * Every queue HR can act on. Each returns an InsightAction with count, oldest age (days) and the
 * number past its SLA, and an href to the page where the item is actioned. A queue whose source
 * cannot be measured returns count null + `unavailable`, never a confident 0.
 *
 * SLA conventions (stated in each hint so the number is auditable): HR/manager decisions are overdue
 * after 2 days, document / e-sign / BGV chasers after 3 days. Anything raised before the pendency
 * cutoff is legacy backlog and is reported in the hint, not in the count.
 */
const CUTOFF = lit(PENDENCY_CUTOFF_DATE);
const DEAD = `LOWER(COALESCE(cand.status, '')) IN ('rejected', 'no show', 'inactive')`;
const age = (today: string, col: string) => `DATEDIFF(${lit(today)}, DATE(${col}))`;

function action(a: Omit<InsightAction, "severity"> & { severity?: InsightAction["severity"]; overdueBasis?: number | null }): InsightAction {
  const { overdueBasis, ...rest } = a;
  return { severity: queueSeverity(rest.count, overdueBasis ?? rest.overdue ?? null), ...rest };
}

/** Leave filed with HR/branch-head escalation, and attendance regularisation at the HR stage. */
export const leaveAndAttendanceQueues = memoized("q.leaveAtt", async (ctx: InsightContext): Promise<InsightAction[]> => {
  const t = ctx.today;
  const sc = empScope(ctx);
  const raised = `COALESCE(lr.applied_at, lr.created_at)`;
  const leave = await one(
    `SELECT COUNT(*) AS n,
            MAX(${age(t, raised)}) AS oldest,
            COALESCE(SUM(${age(t, raised)} > 2 OR lr.from_date < ${lit(t)}), 0) AS overdue,
            COALESCE(SUM(lr.requires_branch_head_approval = 1), 0) AS branch_head,
            COALESCE(SUM(lr.from_date < ${lit(t)}), 0) AS started
       FROM leave_request lr
       JOIN employees e ON e.id = lr.employee_id AND e.active_status = 1
      WHERE lr.status = 'pending' AND lr.legacy_leave_id IS NULL AND ${raised} >= ${CUTOFF}${sc.sql}`,
    sc.params,
  );
  const hrStage = `(ar.status = 'manager_approved' OR (ar.status = 'escalated' AND ar.escalated_to = 'hr'))`;
  const reg = await one(
    `SELECT COALESCE(SUM(${hrStage}), 0) AS hr_n,
            MAX(CASE WHEN ${hrStage} THEN ${age(t, "ar.created_at")} END) AS hr_oldest,
            COALESCE(SUM(${hrStage} AND ${age(t, "ar.created_at")} > 2), 0) AS hr_overdue,
            COALESCE(SUM(ar.status = 'pending'), 0) AS mgr_n,
            MAX(CASE WHEN ar.status = 'pending' THEN ${age(t, "ar.created_at")} END) AS mgr_oldest,
            COALESCE(SUM(ar.status = 'pending' AND ${age(t, "ar.created_at")} > 3), 0) AS mgr_overdue
       FROM attendance_regularization ar
       JOIN employees e ON e.id = ar.employee_id
      WHERE ar.status IN ('pending', 'manager_approved', 'escalated') AND ar.created_at >= ${CUTOFF}${sc.sql}`,
    sc.params,
  );
  return [
    action({
      id: "leave-pending", label: "Leave requests awaiting approval", group: "Attendance & leave", href: "/leaves",
      count: int(leave?.n), oldestDays: leave?.oldest == null ? null : int(leave.oldest), overdue: int(leave?.overdue),
      hint: `${int(leave?.branch_head)} need branch head · ${int(leave?.started)} already started · overdue = filed over 2d ago or leave began`,
    }),
    action({
      id: "regularisation-hr", label: "Attendance regularisation at HR stage", group: "Attendance & leave", href: "/attendance-regularization",
      count: int(reg?.hr_n), oldestDays: reg?.hr_oldest == null ? null : int(reg.hr_oldest), overdue: int(reg?.hr_overdue),
      hint: "manager-approved or escalated to HR · overdue after 2d",
    }),
    action({
      id: "regularisation-manager", label: "Regularisation stuck with managers", group: "Attendance & leave", href: "/attendance-regularization",
      count: int(reg?.mgr_n), oldestDays: reg?.mgr_oldest == null ? null : int(reg.mgr_oldest), overdue: int(reg?.mgr_overdue),
      hint: "not yet reviewed by the manager · overdue after 3d",
      severity: int(reg?.mgr_overdue) > 0 ? "high" : "normal",
    }),
  ];
});

/** Resignations in review, exits landing this week, and clearance tasks that gate full & final. */
export const exitQueues = memoized("q.exit", async (ctx: InsightContext): Promise<InsightAction[]> => {
  const t = ctx.today;
  const sc = empScope(ctx);
  const review = `er.status IN ('submitted', 'manager_review', 'hr_review', 'admin_review')`;
  const notice = `er.status IN ('accepted', 'notice_serving')`;
  const lwd = `COALESCE(er.lwd_override, er.last_working_day_confirmed, er.last_working_day_proposed)`;
  const submitted = `COALESCE(er.submitted_at, er.created_at)`;
  const ex = await one(
    `SELECT COALESCE(SUM(${review}), 0) AS review_n,
            MAX(CASE WHEN ${review} THEN ${age(t, submitted)} END) AS review_oldest,
            COALESCE(SUM(${review} AND ${age(t, submitted)} > 2), 0) AS review_overdue,
            COALESCE(SUM(er.status = 'hr_review'), 0) AS at_hr,
            COALESCE(SUM(er.status IN ('submitted', 'manager_review')), 0) AS at_manager,
            COALESCE(SUM(${notice}), 0) AS notice_n,
            COALESCE(SUM(${notice} AND ${lwd} BETWEEN ${lit(t)} AND DATE_ADD(${lit(t)}, INTERVAL 7 DAY)), 0) AS lwd7,
            COALESCE(SUM(${notice} AND ${lwd} < ${lit(t)}), 0) AS lwd_past
       FROM exit_request er
       JOIN employees e ON e.id = er.employee_id
      WHERE er.status IN ('submitted', 'manager_review', 'hr_review', 'admin_review', 'accepted', 'notice_serving')${sc.sql}`,
    sc.params,
  );
  const clr = await one(
    `SELECT COALESCE(SUM(t.clearance_area = 'hr'), 0) AS hr_n,
            COUNT(*) AS all_n,
            COUNT(DISTINCT t.exit_request_id) AS exits,
            MAX(CASE WHEN t.clearance_area = 'hr' THEN ${age(t, "t.created_at")} END) AS hr_oldest,
            COALESCE(SUM(t.clearance_area = 'hr' AND t.due_date < ${lit(t)}), 0) AS hr_overdue
       FROM exit_clearance_task t
       JOIN exit_request er ON er.id = t.exit_request_id AND er.status NOT IN ('revoked', 'withdrawn', 'rejected', 'draft')
       JOIN employees e ON e.id = t.employee_id
      WHERE t.status IN ('pending', 'in_progress', 'blocked')${sc.sql}`,
    sc.params,
  );
  return [
    action({
      id: "exit-review", label: "Resignations in review", group: "Exits", href: "/exit/command-center",
      count: int(ex?.review_n), oldestDays: ex?.review_oldest == null ? null : int(ex.review_oldest), overdue: int(ex?.review_overdue),
      hint: `${int(ex?.at_manager)} at manager · ${int(ex?.at_hr)} at HR · overdue after 2d (auto-accept window is 48h)`,
    }),
    action({
      id: "exit-lwd-week", label: "Last working day within 7 days", group: "Exits", href: "/exit/command-center",
      count: int(ex?.lwd7), oldestDays: null, overdue: int(ex?.lwd_past), severity: int(ex?.lwd_past) > 0 ? "high" : int(ex?.lwd7) > 0 ? "normal" : "info",
      hint: `${int(ex?.notice_n)} serving notice · ${int(ex?.lwd_past)} past their last day and still not exited`,
    }),
    action({
      id: "exit-clearance-hr", label: "HR exit-clearance tasks open", group: "Exits", href: "/exit/command-center",
      count: int(clr?.hr_n), oldestDays: clr?.hr_oldest == null ? null : int(clr.hr_oldest), overdue: int(clr?.hr_overdue),
      hint: `${int(clr?.all_n)} open tasks across ${int(clr?.exits)} exits (all areas) block full & final`,
      overdueBasis: int(clr?.hr_overdue),
    }),
  ];
});

/** Candidate-keyed queues scope through the candidate's applied-for branch/process, like the metric services. */
function candScope(ctx: InsightContext, branchCol: string) {
  return buildScopeWhere(ctx.scope, branchCol, "pm.id");
}

/** Onboarding review, BGV decisions, appointment-letter and joining-document e-sign. */
export const onboardingQueues = memoized("q.onboarding", async (ctx: InsightContext): Promise<InsightAction[]> => {
  const t = ctx.today;
  const genuine = excludeEmployeeShapedCandidatesSql("cand");
  const reqScope = candScope(ctx, "bm.id");
  const hrOwned = `r.status IN ('profile_submitted', 'hr_review', 'hr_pushback')`;
  const upd = `COALESCE(r.updated_at, r.created_at)`;
  const onb = await one(
    `SELECT COALESCE(SUM(${hrOwned}), 0) AS n,
            MAX(CASE WHEN ${hrOwned} THEN ${age(t, upd)} END) AS oldest,
            COALESCE(SUM(${hrOwned} AND ${age(t, upd)} > 2), 0) AS overdue,
            COALESCE(SUM(r.status = 'hr_pushback'), 0) AS pushback,
            COALESCE(SUM(r.status = 'pending'), 0) AS awaiting_candidate,
            COALESCE(SUM(r.status = 'offer_submitted'), 0) AS offer_stage
       FROM ats_onboarding_request r
       JOIN ats_candidate cand ON cand.id = r.candidate_id
       LEFT JOIN branch_master bm ON bm.id = r.branch_id
       LEFT JOIN process_master pm ON pm.process_name = cand.applied_for_process
      WHERE ${genuine} AND NOT (${DEAD}) AND r.created_at >= ${CUTOFF} AND ${reqScope.sql}`,
    reqScope.params,
  );
  const bgvScope = candScope(ctx, "bm.id");
  const bgv = await one(
    `SELECT COUNT(DISTINCT c.candidate_id) AS n,
            MAX(${age(t, "c.created_at")}) AS oldest,
            COUNT(DISTINCT CASE WHEN ${age(t, "c.created_at")} > 3 THEN c.candidate_id END) AS overdue,
            COUNT(DISTINCT CASE WHEN c.status IN ('mismatch', 'failed') THEN c.candidate_id END) AS hard_fail
       FROM candidate_bgv_check c
       JOIN ats_candidate cand ON cand.id = c.candidate_id
       LEFT JOIN branch_master bm ON bm.branch_name = cand.applied_for_branch
       LEFT JOIN process_master pm ON pm.process_name = cand.applied_for_process
      WHERE c.status IN ('manual_review', 'mismatch', 'failed') AND ${genuine} AND NOT (${DEAD})
        AND c.created_at >= ${CUTOFF} AND ${bgvScope.sql}`,
    bgvScope.params,
  );
  const sc = empScope(ctx);
  const appt = await one(
    `SELECT COUNT(*) AS n, MAX(${age(t, "alr.created_at")}) AS oldest,
            COALESCE(SUM(${age(t, "alr.created_at")} > 3), 0) AS overdue,
            COALESCE(SUM(alr.current_state = 'candidate_esign_pending' OR alr.candidate_esign_status = 'pending'), 0) AS candidate_side,
            COALESCE(SUM(alr.current_state = 'company_sign_pending' OR alr.company_sign_status = 'pending'), 0) AS company_side,
            COALESCE(SUM(alr.current_state = 'override_requested'), 0) AS override_req
       FROM appointment_letter_request alr
       LEFT JOIN employees e ON e.id = alr.employee_id
      WHERE (alr.current_state IN ('candidate_esign_pending', 'company_sign_pending', 'override_requested')
             OR alr.candidate_esign_status = 'pending' OR alr.company_sign_status = 'pending')
        AND alr.created_at >= ${CUTOFF}${sc.sql}`,
    sc.params,
  );
  const jd = await one(
    `SELECT COUNT(DISTINCT c.employee_id) AS n, COUNT(*) AS docs, MAX(${age(t, "c.created_at")}) AS oldest,
            COUNT(DISTINCT CASE WHEN c.due_at < NOW() THEN c.employee_id END) AS overdue
       FROM employee_joining_document_checklist c
       JOIN employees e ON e.id = c.employee_id
      WHERE c.action_type = 'esign' AND c.status IN ('pending_candidate_esign', 'esign_initiated')
        AND c.created_at >= ${CUTOFF}${sc.sql}`,
    sc.params,
  );
  return [
    action({
      id: "onboarding-hr-review", label: "Onboarding profiles awaiting HR review", group: "Hiring & onboarding", href: "/ats/onboarding-requests",
      count: int(onb?.n), oldestDays: onb?.oldest == null ? null : int(onb.oldest), overdue: int(onb?.overdue),
      hint: `${int(onb?.pushback)} sent back · ${int(onb?.awaiting_candidate)} awaiting the candidate · ${int(onb?.offer_stage)} at offer stage · overdue after 2d`,
    }),
    action({
      id: "bgv-decision", label: "BGV needs an HR decision", group: "Hiring & onboarding", href: "/ats/bgv",
      count: int(bgv?.n), oldestDays: bgv?.oldest == null ? null : int(bgv.oldest), overdue: int(bgv?.overdue),
      hint: `candidates with a check in manual review, mismatch or failed (${int(bgv?.hard_fail)} hard fails) · overdue after 3d`,
    }),
    action({
      id: "appointment-esign", label: "Appointment letters pending e-sign", group: "Hiring & onboarding", href: "/provisioning/appointment-letter",
      count: int(appt?.n), oldestDays: appt?.oldest == null ? null : int(appt.oldest), overdue: int(appt?.overdue),
      hint: `${int(appt?.candidate_side)} awaiting candidate · ${int(appt?.company_side)} awaiting company signatory · ${int(appt?.override_req)} override requests`,
    }),
    action({
      id: "joining-doc-esign", label: "Employees with joining documents awaiting e-sign", group: "Hiring & onboarding", href: "/ats/joining-documents-tracker",
      count: int(jd?.n), oldestDays: jd?.oldest == null ? null : int(jd.oldest), overdue: int(jd?.overdue),
      hint: `${int(jd?.docs)} documents in total · overdue = past the checklist due date`,
    }),
  ];
});

/** Document verification, helpdesk, salary revisions. */
export const miscQueues = memoized("q.misc", async (ctx: InsightContext): Promise<InsightAction[]> => {
  const t = ctx.today;
  const sc = empScope(ctx);
  const docs = await one(
    `SELECT COUNT(DISTINCT d.employee_id) AS n, COUNT(*) AS docs, MAX(${age(t, "d.created_at")}) AS oldest,
            COUNT(DISTINCT CASE WHEN ${age(t, "d.created_at")} > 3 THEN d.employee_id END) AS overdue
       FROM employee_documents d
       JOIN employees e ON e.id = d.employee_id AND e.active_status = 1
      WHERE d.verified = 0 AND d.created_at >= ${CUTOFF}${sc.sql}`,
    sc.params,
  );
  const hd = await one(
    `SELECT COUNT(*) AS n, MAX(${age(t, "h.created_at")}) AS oldest,
            COALESCE(SUM(h.sla_breached = 1 OR (h.sla_due_at IS NOT NULL AND h.sla_due_at < NOW())), 0) AS overdue,
            COALESCE(SUM(h.status = 'pending_info'), 0) AS pending_info
       FROM helpdesk_ticket h
       LEFT JOIN employees e ON e.id = h.employee_id
      WHERE h.status IN ('open', 'in_progress', 'pending_info', 'on_hold')${sc.sql}`,
    sc.params,
  );
  const sal = await one(
    `SELECT COALESCE(SUM(s.status = 'submitted'), 0) AS to_validate,
            COALESCE(SUM(s.status = 'hr_validated'), 0) AS with_finance,
            MAX(CASE WHEN s.status = 'submitted' THEN ${age(t, "s.created_at")} END) AS oldest,
            COALESCE(SUM(s.status = 'submitted' AND ${age(t, "s.created_at")} > 2), 0) AS overdue
       FROM salary_increment_request s
       JOIN employees e ON e.id = s.employee_id
      WHERE s.status IN ('submitted', 'hr_validated')${sc.sql}`,
    sc.params,
  );
  return [
    action({
      id: "doc-verification", label: "Employees with documents awaiting verification", group: "Compliance", href: "/document-verification",
      count: int(docs?.n), oldestDays: docs?.oldest == null ? null : int(docs.oldest), overdue: int(docs?.overdue),
      hint: `${int(docs?.docs)} documents uploaded since 25 Aug · overdue after 3d`,
    }),
    action({
      id: "helpdesk-open", label: "Helpdesk tickets open", group: "Employee support", href: "/helpdesk",
      count: int(hd?.n), oldestDays: hd?.oldest == null ? null : int(hd.oldest), overdue: int(hd?.overdue),
      hint: `${int(hd?.pending_info)} waiting on the employee · overdue = SLA breached`,
    }),
    action({
      id: "salary-validate", label: "Salary revisions to validate", group: "Compensation", href: "/salary-revision",
      count: int(sal?.to_validate), oldestDays: sal?.oldest == null ? null : int(sal.oldest), overdue: int(sal?.overdue),
      hint: `${int(sal?.with_finance)} already with finance · overdue after 2d`,
    }),
  ];
});
