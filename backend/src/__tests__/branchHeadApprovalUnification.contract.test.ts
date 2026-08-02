/**
 * The offer-approval path must record the branch head's decision.
 *
 * `/ats/offer-approvals` is the screen in the nav menu. It calls approveOffer,
 * which called createEmployeeFromCandidate directly. That runs
 * validateSalaryLock (employee-creation-orchestrator.service.ts:572-600), which
 * requires an ats_branch_head_approval row joined via ats_payroll_hr_validation
 * with approval_status='approved'. Nothing on this path ever wrote one, so
 * every approval from that screen failed with
 * "Employee creation failed: Branch Head approval pending".
 *
 * None of this is visible to the type checker: the requirement lives in a SQL
 * predicate in another module, and the two call sites are ordinary function
 * calls. It is pinned here instead.
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const ATS = path.resolve(__dirname, "..", "modules", "ats");
const read = (f: string) => fs.readFileSync(path.join(ATS, f), "utf8");

const onboarding = read("ats.onboarding.service.ts");
const record = read("branch-head-approval.record.ts");
const routes = read("branch-head-approval.routes.ts");
const service = read("branch-head-approval.service.ts");
const journey = read("candidate-journey.service.ts");

describe("approveOffer records the branch head decision", () => {
  it("calls recordBranchHeadDecision", () => {
    expect(onboarding).toContain("recordBranchHeadDecision");
  });

  it("records BEFORE creating the employee", () => {
    // Ordering is the whole fix: validateSalaryLock runs inside
    // createEmployeeFromCandidate and reads the row this writes.
    const approveAt = onboarding.indexOf("export async function approveOffer");
    expect(approveAt).toBeGreaterThan(-1);
    const body = onboarding.slice(approveAt, approveAt + 6000);
    const recordAt = body.indexOf("recordBranchHeadDecision");
    const createAt = body.indexOf("createEmployeeFromCandidate");
    expect(recordAt).toBeGreaterThan(-1);
    expect(createAt).toBeGreaterThan(-1);
    expect(recordAt).toBeLessThan(createAt);
  });

  it("reverts its own write when employee creation fails", () => {
    // Otherwise a transient blocker leaves the offer permanently 'approved'
    // with no employee and no way for anyone to decide it again.
    expect(onboarding).toContain("revertBranchHeadDecision");
    expect(onboarding).toMatch(/decision\.recorded && !decision\.alreadyDecided/);
  });

  it("normalises the approver to an employees.id", () => {
    // The route passes an auth user id; getApprovalHistory joins employees on
    // branch_head_id, so an unresolved id shows a blank approver in history.
    expect(onboarding).toContain("resolveEmployeeIdForAuthUser");
  });

  it("rejectOffer records the decision too", () => {
    const rejectAt = onboarding.indexOf("export async function rejectOffer");
    expect(rejectAt).toBeGreaterThan(-1);
    expect(onboarding.slice(rejectAt)).toContain("recordBranchHeadDecision");
  });

  it("writes an ats_offer_approval row on approve, not only on reject", () => {
    // Before this, only the reject path wrote one, so the Approved tab would
    // have had no new entries at all.
    const inserts = onboarding.match(/INSERT INTO ats_offer_approval/g) ?? [];
    expect(inserts.length).toBeGreaterThanOrEqual(2);
  });
});

describe("recordBranchHeadDecision is safe to call twice", () => {
  it("guards the update on approval_status = 'pending'", () => {
    expect(record).toMatch(/WHERE payroll_validation_id = \? AND approval_status = 'pending'/);
  });

  it("treats zero affected rows as already decided", () => {
    expect(record).toContain("alreadyDecided");
    expect(record).toMatch(/affectedRows/);
  });

  it("never reads ats_branch_head_approval.candidate_id", () => {
    // Production built this table from migration 141, which omits that column.
    const sqlOnly = record.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    expect(sqlOnly).not.toMatch(/bha\.candidate_id|b\.candidate_id/);
  });

  it("returns rather than throws when there is no payroll validation", () => {
    // The branch head cannot create one; throwing is a dead end.
    expect(record).toMatch(/if \(!payrollValidationId\) return empty;/);
  });
});

describe("scope and roles", () => {
  it("guards /history and /journey with the scope check", () => {
    const hist = routes.indexOf("'/history/:candidateId'");
    const jour = routes.indexOf("'/journey/:candidateId'");
    expect(hist).toBeGreaterThan(-1);
    expect(jour).toBeGreaterThan(-1);
    expect(routes.slice(hist, hist + 700)).toContain("assertBranchHeadCanSeeCandidate");
    expect(routes.slice(jour, jour + 700)).toContain("assertBranchHeadCanSeeCandidate");
  });

  it("admits every role the UI grants ATS_OFFER_APPROVALS", () => {
    // hr holds that page code but was not on this router, so the page loaded
    // and every request on it 403'd.
    for (const role of ["admin", "hr", "branch_head", "payroll_hr"]) {
      expect(routes).toContain(`'${role}'`);
    }
  });

  it("distinguishes an empty scope from an empty result set", () => {
    expect(service).toContain("scopeEmpty");
  });
});

describe("history is sourced from the offers trail", () => {
  it("selects from ats_employment_offer, where the real decisions are", () => {
    // Production holds 14 ats_offer_approval rows against 3 in
    // ats_branch_head_approval; the nav-menu screen has always written to the
    // offer tables.
    const fnAt = service.indexOf("export async function listBranchHeadDecisions");
    expect(fnAt).toBeGreaterThan(-1);
    const body = service.slice(fnAt);
    expect(body).toContain("FROM ats_employment_offer o");
    expect(body).toContain("ats_offer_approval");
  });

  it("reaches the approval row via payroll_validation_id", () => {
    const fnAt = service.indexOf("export async function listBranchHeadDecisions");
    expect(service.slice(fnAt)).toContain("bha.payroll_validation_id = phv.id");
  });

  it("groups by offer so one decision cannot become several rows", () => {
    // branch_master is joined on id OR name OR code and employees on id OR
    // user_id; either can fan out. SELECT DISTINCT could not collapse the
    // result because the duplicates differed in the very column that fanned
    // out, and production returned 13 rows for 7 rejections.
    const fnAt = service.indexOf("export async function listBranchHeadDecisions");
    // Strip comments first: the code explains itself with the phrase
    // "not SELECT DISTINCT", which a naive scan would read as the bug.
    const body = service.slice(fnAt).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    expect(body).toContain("GROUP BY o.id");
    expect(body).not.toContain("SELECT DISTINCT");
  });

  it("counts with COUNT(DISTINCT o.id) so total and rows agree", () => {
    const fnAt = service.indexOf("export async function listBranchHeadDecisions");
    expect(service.slice(fnAt)).toContain("COUNT(DISTINCT o.id)");
  });

  it("orders pending rows by a column that is not null", () => {
    // approved_at became nullable in migration 1055.
    expect(service).toContain("COALESCE(bha.approved_at, bha.updated_at, bha.created_at)");
  });
});

describe("the journey never queries columns that do not exist", () => {
  it("keys provisioning on employee_id", () => {
    expect(journey).toMatch(/FROM it_provisioning_request r[\s\S]{0,400}WHERE r\.employee_id = \?/);
  });

  it("does not select the four columns joining-control-room gets wrong", () => {
    // it_provisioning_request has employee_id, assigned_user_id, actioned_at
    // and sla_due_at — not these. That is why the control-room endpoint throws.
    //
    // Scoped to the provisioning SQL only: `r` is also the loop variable for
    // every other source, so `r.completed_at` on a joining-document row is a
    // legitimate JS property read, not a column selection.
    const at = journey.indexOf("FROM it_provisioning_request");
    expect(at).toBeGreaterThan(-1);
    const sql = journey.slice(journey.lastIndexOf("`SELECT", at), journey.indexOf("`", at));
    for (const bad of ["assigned_to", "completed_at", "sla_due", "candidate_id"]) {
      expect(sql).not.toContain(bad);
    }
  });

  it("never references employee_provisioning_task, which does not exist", () => {
    expect(journey).not.toContain("employee_provisioning_task");
  });

  it("reports unreadable sources instead of silently omitting them", () => {
    expect(journey).toContain("gaps");
    expect(journey).toMatch(/gaps\.push/);
  });

  it("uses ats_interview_submission, the populated interview table", () => {
    // 1169 rows, against 3 in ats_interview_result.
    expect(journey).toContain("ats_interview_submission");
  });
});

describe("submitting the offer is the payroll validation", () => {
  it("derives the validation record when the offer is submitted", () => {
    // Payroll HR enters the salary once, on the offer. validateSalaryLock reads
    // a different table; nothing on the offer path used to write it, and the
    // page that did was deprecated without replacing the record it produced.
    expect(onboarding).toContain("deriveSalaryValidationFromOffer");
    const submitAt = onboarding.indexOf("if (submit) {");
    expect(submitAt).toBeGreaterThan(-1);
    expect(onboarding.slice(submitAt, submitAt + 1200)).toContain("deriveSalaryValidationFromOffer");
  });

  it("copies the figures from the offer rather than inventing them", () => {
    const fnAt = onboarding.indexOf("async function deriveSalaryValidationFromOffer");
    const body = onboarding.slice(fnAt, fnAt + 4000);
    expect(body).toContain("FROM ats_employment_offer o");
    for (const col of ["o.gross", "o.date_of_joining", "o.emp_type"]) {
      expect(body).toContain(col);
    }
  });

  it("refuses to write a row that would violate NOT NULL", () => {
    // gross_salary and joining_date are NOT NULL with no default.
    const fnAt = onboarding.indexOf("async function deriveSalaryValidationFromOffer");
    expect(onboarding.slice(fnAt, fnAt + 4000)).toMatch(/o\.gross == null \|\| !o\.date_of_joining/);
  });

  it("is idempotent — refreshes an existing row instead of duplicating", () => {
    const fnAt = onboarding.indexOf("async function deriveSalaryValidationFromOffer");
    const body = onboarding.slice(fnAt, fnAt + 4500);
    expect(body).toContain("UPDATE ats_payroll_hr_validation");
    expect(body).toContain("INSERT INTO ats_payroll_hr_validation");
  });

  it("does not block the offer when derivation fails", () => {
    // The offer must still reach the branch head; the queue flags the gap.
    const submitAt = onboarding.indexOf("if (submit) {");
    expect(onboarding.slice(submitAt, submitAt + 900)).toMatch(/deriveSalaryValidationFromOffer[\s\S]{0,200}\.catch\(/);
  });
});

describe("offers submitted before the fix still approve", () => {
  it("approveOffer derives the validation when it is missing", () => {
    // There is no resubmit path: NativeHROnboardingRequests.tsx:1472 hides the
    // offer form once submitted, so an existing offer could otherwise only be
    // unblocked by rejecting it first.
    const at = onboarding.indexOf("export async function approveOffer");
    const body = onboarding.slice(at, at + 3000);
    expect(body).toContain("deriveSalaryValidationFromOffer");
  });

  it("derives before recording the decision", () => {
    const at = onboarding.indexOf("export async function approveOffer");
    const body = onboarding.slice(at, at + 3000);
    expect(body.indexOf("deriveSalaryValidationFromOffer"))
      .toBeLessThan(body.indexOf("recordBranchHeadDecision"));
  });

  it("the queue flag reports whether the salary can be established", () => {
    // Not merely whether a row exists — that would warn about offers that
    // approve perfectly well.
    const at = onboarding.indexOf("export async function listPendingApprovals");
    const body = onboarding.slice(at, at + 2500);
    expect(body).toContain("o.gross IS NOT NULL AND o.date_of_joining IS NOT NULL");
  });
});

describe("the submitter can see and revise their own offer", () => {
  it("withdrawOffer only takes back an offer still pending approval", () => {
    // After Branch Head approval the decision is not the submitter's to undo,
    // and an employee may already exist.
    const at = onboarding.indexOf("export async function withdrawOffer");
    expect(at).toBeGreaterThan(-1);
    const body = onboarding.slice(at, at + 3500);
    expect(body).toMatch(/!== 'submitted'/);
    expect(body).toContain("already been approved by the Branch Head");
  });

  it("refuses to withdraw once an employee exists", () => {
    const at = onboarding.indexOf("export async function withdrawOffer");
    expect(onboarding.slice(at, at + 3500)).toContain("An employee record already exists");
  });

  it("requires a reason and records it on the journey", () => {
    // A salary that changes with no recorded explanation is exactly what an
    // audit of this flow would ask about.
    const at = onboarding.indexOf("export async function withdrawOffer");
    const body = onboarding.slice(at, at + 3500);
    expect(body).toContain("A reason is required to withdraw an offer.");
    expect(body).toContain("INSERT INTO ats_candidate_stage_log");
  });

  it("getOfferDetail resolves names, not ids", () => {
    // department_master stores dept_name, not department_name — verified
    // against the live schema, not guessed.
    const at = onboarding.indexOf("export async function getOfferDetail");
    expect(at).toBeGreaterThan(-1);
    const body = onboarding.slice(at, at + 3500);
    expect(body).toContain("dept.dept_name AS department_name");
    expect(body).toContain("cc.cost_centre_name");
    expect(body).toContain("mgr.full_name AS reporting_manager_name");
  });

  it("getOfferDetail returns the decision trail", () => {
    const at = onboarding.indexOf("export async function getOfferDetail");
    expect(onboarding.slice(at, at + 3500)).toContain("FROM ats_offer_approval a");
  });
});

describe("a failed creation cannot leave the approval standing", () => {
  it("reverts when createEmployeeFromCandidate THROWS, not only when it returns failure", () => {
    // The revert was guarded solely by !result.success. createEmployeeFromCandidate
    // throws on a SQL error, which skips that block — and did, leaving an
    // approved row with no employee behind it.
    const at = onboarding.indexOf("export async function approveOffer");
    const body = onboarding.slice(at, at + 5000);
    expect(body).toMatch(/catch \(creationErr\)/);
    expect(body).toMatch(/catch \(creationErr\)[\s\S]{0,400}revertBranchHeadDecision/);
    expect(body).toContain("throw creationErr;");
  });

  it("post-approval writes are idempotent rather than gated on alreadyDecided", () => {
    // Gating them meant a retry after a partial failure skipped them all: the
    // candidate stayed at 'payroll_validated' with an approved offer.
    // Scope to the function by its end marker rather than a character count —
    // a fixed window silently stops covering the code it is meant to check as
    // the function grows.
    const at = onboarding.indexOf("export async function approveOffer");
    const end = onboarding.indexOf("export async function", at + 10);
    const body = onboarding.slice(at, end > at ? end : undefined);
    expect(body).toContain("WHERE NOT EXISTS (SELECT 1 FROM ats_offer_approval x");
    expect(body).toContain("COALESCE(current_stage, '') <> 'offer_approved'");
    expect(body).toContain("WHERE NOT EXISTS (SELECT 1 FROM ats_candidate_stage_log x");
  });
});
