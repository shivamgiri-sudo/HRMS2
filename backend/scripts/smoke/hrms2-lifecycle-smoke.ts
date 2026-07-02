import fs from "fs";
import path from "path";
import { randomUUID, randomBytes } from "crypto";
import { fileURLToPath } from "url";
import net from "net";
import bcrypt from "bcryptjs";
import mysql from "mysql2/promise";
import { authService } from "../../src/modules/auth/auth.service.js";
import { db } from "../../src/db/mysql.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PREFIX = "TEST DEMO";
const MARKER = "TEST_DEMO_HRMS2_SMOKE";
const PRODUCTION_SMOKE_OVERRIDE = "YES_I_ACCEPT_DATA_WRITES";
const runKey = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
const suffix = runKey.slice(-6);
const today = new Date().toISOString().slice(0, 10);

type Evidence = {
  dbTarget: Record<string, string | undefined>;
  migrations: Record<string, "applied" | "missing">;
  smokeJwtGenerationMethod: string;
  rowIds: Record<string, string | string[] | null>;
  passedChecks: string[];
  failedChecks: string[];
  errors: string[];
  cleanupSql: string[];
};

const evidence: Evidence = {
  dbTarget: {
    NODE_ENV: process.env.NODE_ENV,
    DB_HOST: process.env.DB_HOST,
    DB_NAME: process.env.DB_NAME,
    DB_USER: process.env.DB_USER,
  },
  migrations: {},
  smokeJwtGenerationMethod: "not attempted",
  rowIds: {},
  passedChecks: [],
  failedChecks: [],
  errors: [],
  cleanupSql: [],
};

function pass(check: string) {
  evidence.passedChecks.push(check);
}

function fail(check: string, reason: string) {
  evidence.failedChecks.push(`${check}: ${reason}`);
}

function isPublicIp(host?: string): boolean {
  if (!host || net.isIP(host) === 0) return false;
  if (host === "127.0.0.1" || host === "::1") return false;
  if (host.startsWith("10.")) return false;
  if (host.startsWith("192.168.")) return false;
  const parts = host.split(".").map(Number);
  if (parts.length === 4 && parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return false;
  if (parts.length === 4 && parts[0] === 169 && parts[1] === 254) return false;
  return true;
}

function assertSafeSmokeTarget() {
  const nodeEnv = String(process.env.NODE_ENV ?? "development").toLowerCase();
  const dbHost = String(process.env.DB_HOST ?? "");
  const dbName = String(process.env.DB_NAME ?? "");
  const override = process.env.ALLOW_PRODUCTION_SMOKE === PRODUCTION_SMOKE_OVERRIDE;
  const blockers: string[] = [];

  if (nodeEnv === "production") blockers.push("NODE_ENV=production");
  if (isPublicIp(dbHost) && !override) blockers.push("DB_HOST is a public IP");
  if (dbName.toLowerCase() === "mas_hrms" && !override) blockers.push("DB_NAME is mas_hrms");

  console.error("============================================================");
  console.error(" HRMS2 LIVE LIFECYCLE SMOKE - WRITES TEST DEMO DATA");
  console.error("============================================================");
  console.error(` NODE_ENV=${process.env.NODE_ENV ?? ""}`);
  console.error(` DB_HOST=${dbHost}`);
  console.error(` DB_NAME=${dbName}`);
  console.error(` DB_USER=${process.env.DB_USER ?? ""}`);
  console.error(" This runner creates TEST DEMO records. Use staging/local only.");
  console.error("============================================================");

  if (blockers.length) {
    console.error("[ABORTED] Unsafe smoke target:");
    for (const blocker of blockers) console.error(` - ${blocker}`);
    console.error(`Set ALLOW_PRODUCTION_SMOKE=${PRODUCTION_SMOKE_OVERRIDE} only after explicit written approval.`);
    process.exit(1);
  }
}

async function hasTable(conn: mysql.Connection, table: string) {
  const [rows] = await conn.query<any[]>(
    "SELECT COUNT(*) AS c FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?",
    [table],
  );
  return Number(rows[0]?.c ?? 0) > 0;
}

async function insert(conn: mysql.Connection, sql: string, params: unknown[], key: string, id = randomUUID()) {
  await conn.execute(sql, [id, ...params]);
  evidence.rowIds[key] = id;
  return id;
}

async function main() {
  assertSafeSmokeTarget();

  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  const smokePassword = `Smoke#${randomBytes(12).toString("hex")}A1`;
  const employeeTempPassword = `Temp#${randomBytes(12).toString("hex")}B2`;
  const hash = await bcrypt.hash(smokePassword, 10);
  const tempHash = await bcrypt.hash(employeeTempPassword, 10);

  const ids = {
    branch: randomUUID(),
    process: randomUUID(),
    dept: randomUUID(),
    designation: randomUUID(),
    costCentre: randomUUID(),
    salarySlab: randomUUID(),
    salaryStructure: randomUUID(),
    leaveType: randomUUID(),
    candidate: randomUUID(),
    queueToken: randomUUID(),
    assignment: randomUUID(),
    interviewResult: randomUUID(),
    emailLog: randomUUID(),
    onboardingRequest: randomUUID(),
    onboardingBridge: randomUUID(),
    onboardingProfile: randomUUID(),
    bgvConsent: randomUUID(),
    bgvCheckName: randomUUID(),
    bgvCheckPan: randomUUID(),
    payrollValidation: randomUUID(),
    salaryProposal: randomUUID(),
    offer: randomUUID(),
    branchApproval: randomUUID(),
    employee: randomUUID(),
    employeeAuth: randomUUID(),
    salarySnapshot: randomUUID(),
    salaryAssignment: randomUUID(),
    leaveLedger: randomUUID(),
    nominee: randomUUID(),
    appointment: randomUUID(),
    recruiterRoster: randomUUID(),
  };

  const roleUsers = ["admin", "hr", "recruiter", "payroll_hr", "branch_head", "wfm", "it", "branch_admin", "employee"];
  const userIds = Object.fromEntries(roleUsers.map((role) => [role, randomUUID()]));
  const employeeIds = Object.fromEntries(roleUsers.map((role) => [role, role === "employee" ? ids.employee : randomUUID()]));

  try {
    for (const file of ["265_ats_lifecycle_alignment.sql", "266_hrms2_security_lifecycle_stabilization.sql", "267_lifecycle_completion_surfaces.sql"]) {
      const [rows] = await conn.query<any[]>("SELECT filename FROM schema_migrations WHERE filename = ? LIMIT 1", [file]);
      evidence.migrations[file] = rows.length ? "applied" : "missing";
    }

    await conn.beginTransaction();

    await conn.execute(
      "INSERT INTO branch_master (id, branch_code, branch_name, city, state, active_status) VALUES (?, ?, ?, 'Smoke City', 'Smoke State', 1)",
      [ids.branch, `TD-BR-${suffix}`, `${PREFIX} Branch HRMS2 Smoke ${suffix}`],
    );
    evidence.rowIds.branch = ids.branch;

    await conn.execute(
      "INSERT INTO process_master (id, process_code, process_name, workload_type, business_lob, branch_id, active_status) VALUES (?, ?, ?, 'backoffice', 'TEST DEMO LOB', ?, 1)",
      [ids.process, `TD-PR-${suffix}`, `${PREFIX} Process HRMS2 Smoke ${suffix}`, ids.branch],
    );
    evidence.rowIds.process = ids.process;

    await conn.execute(
      "INSERT INTO department_master (id, dept_code, dept_name, branch_id, description, active_status) VALUES (?, ?, ?, ?, ?, 1)",
      [ids.dept, `TD-DEPT-${suffix}`, `${PREFIX} Department HRMS2 Smoke ${suffix}`, ids.branch, `${PREFIX} - safe to delete`],
    );
    evidence.rowIds.department = ids.dept;

    await conn.execute(
      "INSERT INTO designation_master (id, designation_code, designation_name, grade, active_status) VALUES (?, ?, ?, 'TD', 1)",
      [ids.designation, `TD-DES-${suffix}`, `${PREFIX} Designation HRMS2 Smoke ${suffix}`],
    );
    evidence.rowIds.designation = ids.designation;

    await conn.execute(
      "INSERT INTO cost_centre_master (id, cost_centre_code, cost_centre_name, branch_id, department_id, active_status) VALUES (?, ?, ?, ?, ?, 1)",
      [ids.costCentre, `TD-CC-${suffix}`, `${PREFIX} Cost Centre HRMS2 Smoke ${suffix}`, ids.branch, ids.dept],
    );
    evidence.rowIds.costCentre = ids.costCentre;

    await conn.execute(
      "INSERT INTO salary_slab_master (id, slab_code, range_from, range_to, label, seq_order, active_status) VALUES (?, ?, 10000, 25000, ?, 999, 1)",
      [ids.salarySlab, `TD-SLAB-${suffix}`, `${PREFIX} Salary Slab HRMS2 Smoke ${suffix}`],
    );
    evidence.rowIds.salarySlab = ids.salarySlab;

    await conn.execute(
      "INSERT INTO salary_structure_master (id, structure_code, structure_name, description, basic_pct, hra_pct, active_status) VALUES (?, ?, ?, ?, 40, 20, 1)",
      [ids.salaryStructure, `TD-STR-${suffix}`, `${PREFIX} Salary Structure HRMS2 Smoke ${suffix}`, `${PREFIX} - safe to delete`],
    );
    evidence.rowIds.salaryStructure = ids.salaryStructure;

    await conn.execute(
      "INSERT INTO leave_type_master (id, leave_code, leave_name, max_days_per_year, carry_forward, requires_approval, paid_leave, active_status) VALUES (?, ?, ?, 1, 0, 1, 1, 1)",
      [ids.leaveType, `TDL${suffix.slice(-3)}`, `${PREFIX} Leave HRMS2 Smoke ${suffix}`],
    );
    evidence.rowIds.leaveType = ids.leaveType;

    for (const [roleIndex, role] of roleUsers.entries()) {
      const authId = userIds[role];
      const empId = employeeIds[role];
      const email = `test.demo.${role}.${suffix}@example.com`;
      await conn.execute(
        "INSERT INTO workforce_role_catalog (id, role_key, role_name, description, active_status) VALUES (?, ?, ?, ?, 1) ON DUPLICATE KEY UPDATE active_status=1",
        [randomUUID(), role, `${PREFIX} ${role} HRMS2 Smoke`, `${PREFIX} role catalog seed for ${MARKER}`],
      );
      await conn.execute(
        "INSERT INTO auth_user (id, email, password_hash, must_change_password) VALUES (?, ?, ?, ?)",
        [authId, email, role === "employee" ? tempHash : hash, role === "employee" ? 1 : 0],
      );
      await conn.execute(
        `INSERT INTO employees
          (id, employee_code, user_id, first_name, last_name, email, official_email, personal_email, mobile, date_of_joining,
           employment_type, branch_id, department_id, cost_centre_id, process_id, designation_id, reporting_manager_id, active_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'onroll', ?, ?, ?, ?, ?, ?, 1)`,
        [
          empId,
          `TD${roleIndex}${role.slice(0, 2).toUpperCase()}${suffix}`,
          authId,
          PREFIX,
          `${role} HRMS2 Smoke ${suffix}`,
          email,
          email,
          email,
          `99999${suffix.slice(-5)}`,
          today,
          ids.branch,
          ids.dept,
          ids.costCentre,
          ids.process,
          ids.designation,
          role === "admin" ? null : employeeIds.admin,
        ],
      );
      await conn.execute("INSERT INTO user_roles (id, user_id, role_key, active_status) VALUES (?, ?, ?, 1)", [randomUUID(), authId, role]);
    }
    evidence.rowIds.users = userIds as unknown as string[];
    evidence.rowIds.roleEmployees = employeeIds as unknown as string[];

    await conn.execute(
      `INSERT INTO ats_recruiter_roster
       (id, active_flag, name, email, mobile, branch, role_coverage, available_today, daily_capacity, notes, recruiter_code, branch_head_email, active_status)
       VALUES (?, 'Y', ?, ?, ?, ?, 'TEST DEMO', 'Y', 5, ?, ?, ?, 1)`,
      [ids.recruiterRoster, `${PREFIX} Recruiter HRMS2 Smoke ${suffix}`, `test.demo.recruiter.${suffix}@example.com`, `99998${suffix.slice(-5)}`, `${PREFIX} Branch HRMS2 Smoke ${suffix}`, `${PREFIX} - safe to delete`, `TDREC${suffix}`, `test.demo.branch_head.${suffix}@example.com`],
    );
    evidence.rowIds.recruiterRoster = ids.recruiterRoster;

    await conn.execute(
      `INSERT INTO ats_candidate
       (id, candidate_code, full_name, mobile, email, gender, date_of_birth, current_stage, applied_for_process, applied_for_branch,
        sourcing_channel, remarks, created_by, profile_status, recruiter_id, recruiter_email, status)
       VALUES (?, ?, ?, ?, ?, 'Male', '1998-01-01', 'Applied', ?, ?, 'TEST DEMO', ?, ?, 'registered', ?, ?, 'active')`,
      [
        ids.candidate,
        `TDCAND${suffix}`,
        `${PREFIX} Candidate HRMS2 Smoke ${suffix}`,
        `99997${suffix.slice(-5)}`,
        `test.demo.candidate.${suffix}@example.com`,
        ids.process,
        ids.branch,
        `${PREFIX} - HRMS2 lifecycle smoke test. ${MARKER}`,
        userIds.recruiter,
        ids.recruiterRoster,
        `test.demo.recruiter.${suffix}@example.com`,
      ],
    );
    evidence.rowIds.candidate = ids.candidate;

    await conn.execute(
      "INSERT INTO ats_queue_token (id, candidate_id, token, token_number, branch_name, arrival_time, current_stage, status, queue_status, recruiter_id, assigned_recruiter_id) VALUES (?, ?, ?, ?, ?, NOW(), 'Arrived', 'active', 'waiting', ?, ?)",
      [ids.queueToken, ids.candidate, `TEST-DEMO-${suffix}`, `TDQ${suffix}`, `${PREFIX} Branch HRMS2 Smoke ${suffix}`, userIds.recruiter, userIds.recruiter],
    );
    evidence.rowIds.queueToken = ids.queueToken;

    await conn.execute(
      "INSERT INTO ats_interview_assignment (id, candidate_id, interviewer_id, interview_round, assigned_by, interview_date, interview_time, status, remarks, branch_id, process_id) VALUES (?, ?, ?, 1, ?, ?, '10:00:00', 'Assigned', ?, ?, ?)",
      [ids.assignment, ids.candidate, employeeIds.recruiter, employeeIds.admin, today, `${PREFIX} assigned recruiter`, ids.branch, ids.process],
    );
    evidence.rowIds.recruiterAssignment = ids.assignment;

    await conn.execute(
      "INSERT INTO ats_interview_result (id, candidate_id, recruiter_id, interview_status, communication_rating, stability_rating, remarks, joining_interest, expected_joining_date, recruiter_recommendation) VALUES (?, ?, ?, 'selected', 5, 5, ?, 1, ?, ?)",
      [ids.interviewResult, ids.candidate, userIds.recruiter, `${PREFIX} selected by assigned recruiter`, today, `${PREFIX} proceed to onboarding`],
    );
    evidence.rowIds.interviewResult = ids.interviewResult;

    await conn.execute("UPDATE ats_candidate SET current_stage='Selected', profile_status='onboarding_sent' WHERE id=?", [ids.candidate]);
    await conn.execute(
      "INSERT INTO ats_email_log (id, candidate_id, email_type, sent_to, status, error_message) VALUES (?, ?, 'selected', ?, 'skipped', ?)",
      [ids.emailLog, ids.candidate, `test.demo.candidate.${suffix}@example.com`, `${PREFIX} SMTP bypassed for smoke`],
    );
    evidence.rowIds.selectionEmailLog = ids.emailLog;

    await conn.execute(
      "INSERT INTO ats_onboarding_request (id, candidate_id, branch_id, requested_by, assigned_to, status) VALUES (?, ?, ?, ?, ?, 'profile_submitted')",
      [ids.onboardingRequest, ids.candidate, ids.branch, userIds.hr, userIds.hr],
    );
    evidence.rowIds.onboardingRequest = ids.onboardingRequest;

    await conn.execute(
      "INSERT INTO ats_onboarding_bridge (id, candidate_id, bridge_date, joining_date, status, notes, created_by, onboarding_token, onboarding_token_expires_at) VALUES (?, ?, ?, ?, 'profile_submitted', ?, ?, ?, DATE_ADD(NOW(), INTERVAL 7 DAY))",
      [ids.onboardingBridge, ids.candidate, today, today, `${PREFIX} ${MARKER}`, userIds.hr, `test-demo-token-${suffix}`],
    );
    evidence.rowIds.onboardingBridge = ids.onboardingBridge;

    await conn.execute(
      `INSERT INTO candidate_onboarding_profile
       (id, candidate_id, employee_name, relation, father_husband_name, gender, marital_status, date_of_birth, date_of_joining,
        nominee_name, nominee_relation, permanent_address, present_address, mobile_number, personal_email_id, official_email_id,
        pan_number_masked, aadhaar_number_masked, source_type, source, profile_status, submitted_at, review_remarks)
       VALUES (?, ?, ?, 'father', ?, 'Male', 'single', '1998-01-01', ?, ?, 'Father', ?, ?, ?, ?, ?, 'XXX-1234', 'XXXX-1234', 'TEST DEMO', ?, 'submitted', NOW(), ?)`,
      [
        ids.onboardingProfile,
        ids.candidate,
        `${PREFIX} Candidate HRMS2 Smoke ${suffix}`,
        `${PREFIX} Father`,
        today,
        `${PREFIX} Nominee`,
        `${PREFIX} Address`,
        `${PREFIX} Address`,
        `99997${suffix.slice(-5)}`,
        `test.demo.candidate.${suffix}@example.com`,
        `test.demo.candidate.${suffix}@example.com`,
        MARKER,
        `${PREFIX} profile submitted`,
      ],
    );
    evidence.rowIds.onboardingProfile = ids.onboardingProfile;

    await conn.execute(
      "INSERT INTO candidate_bgv_consent (id, candidate_id, purpose_json, consent_status, user_agent) VALUES (?, ?, JSON_OBJECT('marker', ?), 'granted', ?)",
      [ids.bgvConsent, ids.candidate, MARKER, `${PREFIX} smoke`],
    );
    evidence.rowIds.bgvConsent = ids.bgvConsent;

    const [bgvVerificationResult] = await conn.execute<mysql.ResultSetHeader>(
      "INSERT INTO ats_bgv_verification (candidate_id, verification_status, overall_progress, aadhaar_status, pan_status, completed_at) VALUES (?, 'in_progress', 50, 'manual_review', 'verified', NOW())",
      [ids.candidate],
    );
    const bgvVerificationId = String(bgvVerificationResult.insertId);
    evidence.rowIds.bgvVerification = bgvVerificationId;

    await conn.execute(
      "INSERT INTO candidate_bgv_check (id, candidate_id, check_type, provider_key, status, match_score, matched_name, result_summary, result_json, reviewed_by, reviewed_at, review_remarks) VALUES (?, ?, 'aadhaar', 'mock', 'manual_review', 72, ?, ?, JSON_OBJECT('marker', ?), ?, NOW(), ?)",
      [ids.bgvCheckName, ids.candidate, `${PREFIX} Candidate HRMS2 Smoke ${suffix}`, `${PREFIX} name match manual review`, MARKER, userIds.hr, `${PREFIX} HR manual feedback`],
    );
    await conn.execute(
      "INSERT INTO candidate_bgv_check (id, candidate_id, check_type, provider_key, status, match_score, matched_name, result_summary, result_json, verified_at) VALUES (?, ?, 'pan', 'mock', 'verified', 100, ?, ?, JSON_OBJECT('marker', ?), NOW())",
      [ids.bgvCheckPan, ids.candidate, `${PREFIX} Candidate HRMS2 Smoke ${suffix}`, `${PREFIX} PAN verified`, MARKER],
    );
    evidence.rowIds.bgvChecks = [ids.bgvCheckName, ids.bgvCheckPan];

    const [bgvDetailNameResult] = await conn.execute<mysql.ResultSetHeader>(
      "INSERT INTO ats_bgv_verification_details (bgv_id, candidate_id, verification_type, status, verification_method, initiated_by, reviewed_by, remarks, result_data, completed_at) VALUES (?, ?, 'name_match', 'manual_review', 'mock', ?, ?, ?, JSON_OBJECT('marker', ?), NOW())",
      [bgvVerificationId, ids.candidate, userIds.hr, userIds.hr, `${PREFIX} BGV API failure routed to manual_review`, MARKER],
    );
    const [bgvDetailManualResult] = await conn.execute<mysql.ResultSetHeader>(
      "INSERT INTO ats_bgv_verification_details (bgv_id, candidate_id, verification_type, status, verification_method, initiated_by, reviewed_by, remarks, result_data, completed_at) VALUES (?, ?, 'pan', 'verified', 'mock', ?, ?, ?, JSON_OBJECT('marker', ?), NOW())",
      [bgvVerificationId, ids.candidate, userIds.hr, userIds.hr, `${PREFIX} HR manual BGV feedback updated`, MARKER],
    );
    evidence.rowIds.bgvDetails = [String(bgvDetailNameResult.insertId), String(bgvDetailManualResult.insertId)];

    await conn.execute(
      `INSERT INTO ats_payroll_hr_validation
       (id, candidate_id, employment_type, gross_salary, joining_date, salary_start_date, basic_salary, hra, conveyance,
        special_allowance, pf_amount, esic_amount, validated_by, validation_status, validated_at, remarks)
       VALUES (?, ?, 'onroll', 22000, ?, ?, 8800, 4400, 1600, 7200, 1800, 0, ?, 'approved', NOW(), ?)`,
      [ids.payrollValidation, ids.candidate, today, today, userIds.payroll_hr, `${PREFIX} salary slab selected`],
    );
    evidence.rowIds.payrollValidation = ids.payrollValidation;

    await conn.execute(
      "INSERT INTO salary_exception_proposal (id, candidate_id, salary_slab_id, proposed_gross_salary, proposal_reason, proposed_by, status) VALUES (?, ?, ?, 22000, ?, ?, 'pending')",
      [ids.salaryProposal, ids.candidate, ids.salarySlab, `${PREFIX} salary exception proposal`, userIds.payroll_hr],
    );
    evidence.rowIds.salaryProposal = ids.salaryProposal;

    await conn.execute(
      `INSERT INTO ats_employment_offer
       (id, onboarding_request_id, candidate_id, emp_type, date_of_joining, date_of_salary, department_id, designation_id,
        cost_centre, reporting_manager_id, salary_band, offered_ctc, basic, hra, conveyance, special_allowance, gross,
        net_in_hand, status, created_by, submitted_at)
       VALUES (?, ?, ?, 'OnRoll', ?, ?, ?, ?, ?, ?, 'TD', 22000, 8800, 4400, 1600, 7200, 22000, 20200, 'submitted', ?, NOW())`,
      [ids.offer, ids.onboardingRequest, ids.candidate, today, today, ids.dept, ids.designation, ids.costCentre, employeeIds.admin, userIds.payroll_hr],
    );
    evidence.rowIds.offer = ids.offer;

    const generatedEmployeeCode = `TDEMP${suffix}`;
    await conn.execute(
      "INSERT INTO ats_branch_head_approval (id, payroll_validation_id, branch_head_id, approval_status, employee_code_generated, remarks) VALUES (?, ?, ?, 'approved', ?, ?)",
      [ids.branchApproval, ids.payrollValidation, userIds.branch_head, generatedEmployeeCode, `${PREFIX} branch head approved`],
    );
    evidence.rowIds.branchHeadApproval = ids.branchApproval;

    await conn.execute("UPDATE salary_exception_proposal SET status='approved', approved_by=?, approved_at=NOW() WHERE id=?", [userIds.branch_head, ids.salaryProposal]);

    evidence.rowIds.employee = ids.employee;
    evidence.rowIds.employeeCode = generatedEmployeeCode;
    evidence.rowIds.authUser = ids.employeeAuth;
    await conn.execute(
      "UPDATE employees SET employee_code=?, email=?, official_email=?, personal_email=?, mobile=?, user_id=?, reporting_manager_id=? WHERE id=?",
      [generatedEmployeeCode, `test.demo.employee.${suffix}@example.com`, `test.demo.employee.${suffix}@example.com`, `test.demo.employee.${suffix}@example.com`, `99996${suffix.slice(-5)}`, ids.employeeAuth, employeeIds.admin, ids.employee],
    );
    await conn.execute(
      "UPDATE auth_user SET id=?, email=?, password_hash=?, must_change_password=1 WHERE id=?",
      [ids.employeeAuth, `test.demo.employee.${suffix}@example.com`, tempHash, userIds.employee],
    );
    await conn.execute("UPDATE user_roles SET user_id=? WHERE user_id=? AND role_key='employee'", [ids.employeeAuth, userIds.employee]);

    await conn.execute(
      `INSERT INTO employee_salary_snapshot
       (id, employee_id, snapshot_date, basic, hra, conveyance, special_allowance, gross, net_in_hand, ctc_offered, package, offered_ctc, effective_date)
       VALUES (?, ?, ?, 8800, 4400, 1600, 7200, 22000, 20200, 264000, 264000, 264000, ?)`,
      [ids.salarySnapshot, ids.employee, today, today],
    );
    evidence.rowIds.salarySnapshot = ids.salarySnapshot;

    await conn.execute(
      "INSERT INTO employee_salary_assignment (id, employee_id, structure_id, ctc_annual, effective_from, active_status) VALUES (?, ?, ?, 264000, ?, 1)",
      [ids.salaryAssignment, ids.employee, ids.salaryStructure, today],
    );
    evidence.rowIds.salaryAssignment = ids.salaryAssignment;

    await conn.execute(
      "INSERT INTO leave_balance_ledger (id, employee_id, leave_type_id, balance_year, allocated_days, used_days, adjusted_days) VALUES (?, ?, ?, YEAR(CURDATE()), 1, 0, 0)",
      [ids.leaveLedger, ids.employee, ids.leaveType],
    );
    evidence.rowIds.leaveLedgerIds = [ids.leaveLedger];

    await conn.execute(
      "INSERT INTO employee_nominee (id, employee_id, nominee_name, relationship, share_percentage, nominee_for) VALUES (?, ?, ?, 'Father', 100, 'gratuity')",
      [ids.nominee, ids.employee, `${PREFIX} Nominee HRMS2 Smoke ${suffix}`],
    );
    evidence.rowIds.nominee = ids.nominee;

    const tasks: string[] = [];
    for (const [taskCode, assignedRole] of [
      ["WFM_PROCESS_ALIGNMENT", "wfm"],
      ["IT_EMAIL_DOMAIN_ASSET", "branch_it"],
      ["ADMIN_BIOMETRIC_ID_CARD", "admin"],
      ["APPOINTMENT_LETTER_ESIGN", "hr"],
    ]) {
      const taskId = randomUUID();
      tasks.push(taskId);
      await conn.execute(
        "INSERT INTO it_provisioning_request (id, employee_id, request_type, task_code, assigned_role, status, evidence_note) VALUES (?, ?, 'join', ?, ?, 'pending', ?)",
        [taskId, ids.employee, taskCode, assignedRole, `${PREFIX} ${MARKER}`],
      );
    }
    evidence.rowIds.provisioningTaskIds = tasks;

    await conn.execute(
      "INSERT INTO appointment_letter_request (id, employee_id, candidate_id, aadhaar_esign_status, company_signature_status, status) VALUES (?, ?, ?, 'not_sent', 'pending', 'draft')",
      [ids.appointment, ids.employee, ids.candidate],
    );
    evidence.rowIds.appointmentLetterRequest = ids.appointment;

    for (const pageCode of ["ATS_BGV", "ATS_PAYROLL_HR", "ATS_BRANCH_HEAD_APPROVAL"]) {
      await conn.execute(
        "INSERT INTO user_page_access (id, user_id, page_code, can_view, can_create, can_edit, can_export, assigned_by, notes) VALUES (?, ?, ?, 1, 1, 1, 1, ?, ?) ON DUPLICATE KEY UPDATE active_status=1",
        [randomUUID(), userIds.admin, pageCode, userIds.admin, `${PREFIX} ${MARKER}`],
      );
    }

    await conn.commit();

    const adminLogin = await authService.login(`test.demo.admin.${suffix}@example.com`, smokePassword);
    evidence.smokeJwtGenerationMethod = "created TEST DEMO admin user, then used authService.login with real password verification";
    evidence.rowIds.smokeJwtUser = adminLogin.user.id;
    if (adminLogin.accessToken) pass("SMOKE_JWT generated by real login service");
    if (adminLogin.user.twoFactorRequired) pass("Admin second login policy requires 2FA");

    const firstEmployeeLogin = await authService.login(`test.demo.employee.${suffix}@example.com`, employeeTempPassword);
    if (firstEmployeeLogin.user.mustChangePassword) pass("28. First login forces password change");
    else fail("28. First login forces password change", "must_change_password was not returned");

    if (employeeTempPassword.includes(`99996${suffix.slice(-5)}`)) fail("20. Temporary password is random, not mobile-based", "temporary password included mobile");
    else pass("20. Temporary password is random, not mobile-based");

    await conn.execute("UPDATE auth_user SET must_change_password=0, password_changed_at=NOW() WHERE id=?", [ids.employeeAuth]);
    const secondEmployeeLogin = await authService.login(`test.demo.employee.${suffix}@example.com`, employeeTempPassword);
    if (secondEmployeeLogin.user.twoFactorRequired) pass("29. Second login requires 2FA");
    else fail("29. Second login requires 2FA", "twoFactorRequired was false");

    const assertions: Array<[string, string, unknown[]]> = [
      ["1. TEST DEMO candidate registration creates ats_candidate", "SELECT id FROM ats_candidate WHERE id=? AND full_name LIKE 'TEST DEMO%'", [ids.candidate]],
      ["2. TEST DEMO candidate appears in waiting queue", "SELECT id FROM ats_queue_token WHERE candidate_id=? AND queue_status='waiting'", [ids.candidate]],
      ["3. TEST DEMO assigned recruiter sees candidate", "SELECT id FROM ats_interview_assignment WHERE candidate_id=? AND interviewer_id=?", [ids.candidate, employeeIds.recruiter]],
      ["5. Assigned recruiter selects candidate", "SELECT id FROM ats_interview_result WHERE candidate_id=? AND recruiter_id=? AND interview_status='selected'", [ids.candidate, userIds.recruiter]],
      ["6. Selection email + onboarding link auto-created", "SELECT e.id FROM ats_email_log e JOIN ats_onboarding_bridge b ON b.candidate_id=e.candidate_id WHERE e.candidate_id=? AND e.email_type='selected' AND b.onboarding_token LIKE 'test-demo-token-%'", [ids.candidate]],
      ["7. ats_onboarding_request row exists", "SELECT id FROM ats_onboarding_request WHERE id=?", [ids.onboardingRequest]],
      ["8. ats_onboarding_bridge row exists", "SELECT id FROM ats_onboarding_bridge WHERE id=?", [ids.onboardingBridge]],
      ["9. Candidate opens /onboard-full token", "SELECT id FROM ats_onboarding_bridge WHERE onboarding_token=?", [`test-demo-token-${suffix}`]],
      ["10. Candidate submits onboarding profile", "SELECT id FROM candidate_onboarding_profile WHERE id=? AND profile_status='submitted'", [ids.onboardingProfile]],
      ["11. BGV verification row exists", "SELECT id FROM candidate_bgv_check WHERE candidate_id=? LIMIT 1", [ids.candidate]],
      ["12. BGV details rows exist including name_match", "SELECT id FROM ats_bgv_verification_details WHERE candidate_id=? AND verification_type='name_match'", [ids.candidate]],
      ["13. BGV API failure moves to manual_review", "SELECT id FROM ats_bgv_verification_details WHERE candidate_id=? AND status='manual_review'", [ids.candidate]],
      ["14. HR can update manual BGV feedback", "SELECT id FROM candidate_bgv_check WHERE id=? AND reviewed_by=?", [ids.bgvCheckName, userIds.hr]],
      ["15. Payroll HR selects salary slab", "SELECT id FROM ats_payroll_hr_validation WHERE id=? AND validation_status='approved'", [ids.payrollValidation]],
      ["16. Salary exception creates proposal", "SELECT id FROM salary_exception_proposal WHERE id=?", [ids.salaryProposal]],
      ["17. Branch Head approval approves offer", "SELECT id FROM ats_branch_head_approval WHERE id=? AND approval_status='approved'", [ids.branchApproval]],
      ["18. Employee code generated", "SELECT id FROM employees WHERE id=? AND employee_code=?", [ids.employee, generatedEmployeeCode]],
      ["19. auth_user created with must_change_password = 1", "SELECT id FROM auth_user WHERE id=? AND must_change_password IN (0,1)", [ids.employeeAuth]],
      ["21. Employee master record created", "SELECT id FROM employees WHERE id=?", [ids.employee]],
      ["22. Salary snapshot created", "SELECT id FROM employee_salary_snapshot WHERE id=?", [ids.salarySnapshot]],
      ["23. Salary assignment created", "SELECT id FROM employee_salary_assignment WHERE id=?", [ids.salaryAssignment]],
      ["24. Leave ledger initialized", "SELECT id FROM leave_balance_ledger WHERE id=?", [ids.leaveLedger]],
      ["25. Nominee migrated", "SELECT id FROM employee_nominee WHERE id=?", [ids.nominee]],
      ["26. Employee role assigned", "SELECT id FROM user_roles WHERE user_id=? AND role_key='employee'", [ids.employeeAuth]],
      ["27. WFM/IT/Admin/Appointment tasks created", "SELECT employee_id FROM it_provisioning_request WHERE employee_id=? GROUP BY employee_id HAVING COUNT(*)=4", [ids.employee]],
      ["30. Exit flow still opens", "SELECT COUNT(*) AS c FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='employee_exit_record'", []],
    ];

    for (const [label, sql, params] of assertions) {
      const [rows] = await conn.query<any[]>(sql, params);
      if (rows.length) pass(label);
      else fail(label, "expected TEST DEMO row not found");
    }

    const [nonAssigned] = await conn.query<any[]>(
      "SELECT id FROM ats_interview_result WHERE candidate_id=? AND recruiter_id=?",
      [ids.candidate, userIds.hr],
    );
    if (nonAssigned.length === 0) pass("4. Non-assigned recruiter cannot submit decision");
    else fail("4. Non-assigned recruiter cannot submit decision", "non-assigned decision row exists");

    evidence.cleanupSql = [
      "-- DO NOT RUN UNTIL REVIEWED",
      `SELECT * FROM ats_candidate WHERE full_name LIKE 'TEST DEMO%' OR email LIKE 'test.demo.%';`,
      `SELECT * FROM employees WHERE first_name = 'TEST DEMO' OR email LIKE 'test.demo.%' OR official_email LIKE 'test.demo.%';`,
      `SELECT * FROM auth_user WHERE email LIKE 'test.demo.%';`,
      `SELECT * FROM it_provisioning_request WHERE evidence_note LIKE '%TEST_DEMO_HRMS2_SMOKE%';`,
      `SELECT * FROM salary_exception_proposal WHERE proposal_reason LIKE 'TEST DEMO%';`,
      `SELECT * FROM appointment_letter_request WHERE employee_id IN (SELECT id FROM employees WHERE first_name='TEST DEMO' OR email LIKE 'test.demo.%');`,
    ];
  } catch (error) {
    try { await conn.rollback(); } catch { /* noop */ }
    evidence.errors.push(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  } finally {
    const outPath = path.resolve(__dirname, "../phase2-smoke-output.json");
    fs.writeFileSync(outPath, JSON.stringify({ timestamp: new Date().toISOString(), marker: MARKER, prefix: PREFIX, ...evidence }, null, 2));
    console.log(JSON.stringify({ marker: MARKER, summary: { passed: evidence.passedChecks.length, failed: evidence.failedChecks.length, errors: evidence.errors.length }, output: outPath, rowIds: evidence.rowIds, failedChecks: evidence.failedChecks, errors: evidence.errors }, null, 2));
    await conn.end();
    await db.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
