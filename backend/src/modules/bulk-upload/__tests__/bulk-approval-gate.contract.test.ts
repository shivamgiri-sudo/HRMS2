import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { normalizeDate, normalizeMonth, resolveSingleBranch, APPROVER_ROLES, UPLOADER_ROLES } from "../bulk-approval.service.js";

/**
 * Guards for the approval-gated bulk uploads (leave, attendance regularization,
 * incentive, deduction).
 *
 * The property every test here defends is the same one: an uploaded row must reach a
 * leave balance, an attendance record or a payslip ONLY through a Branch Head
 * approval, and only through the same domain engine a manual entry would use. Each
 * test below pins one way that could silently stop being true.
 */
const DIR = path.resolve(__dirname, "..");
const read = (f: string) => fs.readFileSync(path.join(DIR, f), "utf8");

/**
 * Source with comments stripped.
 *
 * The "must not reference table X" assertions below are about CODE, not prose — these
 * files explain in their header comments precisely which engine owns the write to
 * leave_balance_ledger and attendance_daily_record, and a raw substring match would
 * fail on that explanation while the code stayed correct.
 */
const readCode = (f: string) =>
  read(f)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

describe("separation of duties", () => {
  it("no role can both upload and approve", () => {
    const overlap = UPLOADER_ROLES.filter((r) => (APPROVER_ROLES as string[]).includes(r));
    expect(overlap).toEqual([]);
  });

  it("branch_head is the only approver role", () => {
    // admin is deliberately absent: several live admin holders also hold wfm, so
    // admitting admin here would quietly reopen self-approval.
    expect(APPROVER_ROLES).toEqual(["branch_head"]);
  });

  it("refuses to let the uploader approve their own batch", () => {
    const src = read("bulk-approval.service.ts");
    const fn = src.slice(src.indexOf("export async function assertCanApprove"));
    // The uploaded_by check must come BEFORE the role check, because hasAnyRole
    // short-circuits true for super_admin and would otherwise skip it entirely.
    // The role list is now per stage (rule.roles), so match the call, not the constant.
    const selfCheck = fn.indexOf("batch.uploaded_by === userId");
    const roleCheck = fn.indexOf("hasAnyRole(userId, ...rule.roles)");
    expect(selfCheck).toBeGreaterThan(-1);
    expect(roleCheck).toBeGreaterThan(-1);
    expect(selfCheck).toBeLessThan(roleCheck);
  });

  /**
   * The second stage brings a second way for one person to be both maker and checker:
   * a user can hold branch_head AND payroll_head, and would otherwise release a batch
   * at stage 1 and then finally approve their own release at stage 2. That check must
   * also sit ahead of the role test, for the same super_admin short-circuit reason.
   */
  it("refuses to let the branch approver also give final approval", () => {
    const src = read("bulk-approval.service.ts");
    const fn = src.slice(src.indexOf("export async function assertCanApprove"));
    const crossStage = fn.indexOf('stage === "payroll" && batch.branch_head_approved_by === userId');
    const roleCheck = fn.indexOf("hasAnyRole(userId, ...rule.roles)");
    expect(crossStage).toBeGreaterThan(-1);
    expect(crossStage).toBeLessThan(roleCheck);
  });

  it("a branch_head with no assignment scope sees nothing, not everything", () => {
    const src = read("bulk-approval.routes.ts");
    expect(src).toContain('return { sql: "1=0", params: [] }');
  });
});

describe("nothing applies before approval", () => {
  it("deductions are staged pending_approval, which payroll's status='active' filter excludes", () => {
    const src = read("deduction-bulk.service.ts");
    expect(src).toContain("'pending_approval', ?, ?)");
    // And approval is the only thing that flips it to active.
    expect(src).toContain("SET status = 'active', updated_at = NOW()");
    expect(src).toContain("WHERE id = ? AND status = 'pending_approval'");
  });

  it("incentive batches are staged pending_approval, not approved/applied", () => {
    const src = read("incentive-bulk.service.ts");
    // payrollCalculate pays on status IN ('approved','applied'); staging must use neither.
    expect(src).toContain("'pending_approval', 1, ?)");
    expect(src).not.toMatch(/VALUES[^;]*'approved'[^;]*\)`,\s*\[\s*id,\s*master\.id/);
  });

  it("leave approval reuses the leave engine rather than touching the ledger directly", () => {
    const src = read("leave-application-bulk.service.ts");
    expect(src).toContain("leaveService.reviewRequest(");
    // 'approved', NOT 'branch_head_approved'. This assertion used to require the
    // latter, which is what let the bug through: reviewRequest handles the two
    // statuses identically, but only 'approved' is the status the rest of the system
    // reads back. attendance-engine.service.ts resolves its approved-leave override on
    // `leave_request.status = 'approved'` and leaves the attendance day is_locked = 0,
    // so a batch approved as 'branch_head_approved' had its leave days reclassified
    // from biometric evidence on the next nightly run and payroll charged LWP.
    expect(src).toContain('status: "approved"');
    expect(src).not.toMatch(/status: "branch_head_approved"/);
    // The balance tables must never be written from here — that is the engine's job.
    const code = readCode("leave-application-bulk.service.ts");
    expect(code).not.toContain("leave_balance_ledger");
    expect(code).not.toContain("leave_balance_deduction");
  });

  it("regularization approval reuses the WFM review engine, not a direct attendance write", () => {
    const src = read("attendance-regularization-bulk.service.ts");
    expect(src).toContain("wfmService.reviewRegularization(");
    expect(readCode("attendance-regularization-bulk.service.ts")).not.toContain("attendance_daily_record");
  });
});

describe("generated columns are never named in an INSERT", () => {
  // MySQL rejects the entire INSERT if a STORED GENERATED column appears in the
  // column list. incentive_upload_batch.pay_month is generated from salary_month and
  // incentive_approval_step.actioned_by from approver_user_id — both verified live.
  const src = read("incentive-bulk.service.ts");

  it("incentive_upload_batch INSERT omits pay_month", () => {
    const stmt = src.slice(src.indexOf("INSERT INTO incentive_upload_batch"));
    const columns = stmt.slice(0, stmt.indexOf("VALUES"));
    expect(columns).toContain("salary_month");
    expect(columns).not.toContain("pay_month");
  });

  it("incentive_approval_step INSERTs omit actioned_by", () => {
    let from = 0;
    let found = 0;
    for (;;) {
      const i = src.indexOf("INSERT INTO incentive_approval_step", from);
      if (i === -1) break;
      const columns = src.slice(i, src.indexOf("VALUES", i));
      expect(columns).toContain("approver_user_id");
      expect(columns).not.toContain("actioned_by");
      found++;
      from = i + 1;
    }
    expect(found).toBe(2);
  });
});

describe("the immutability lock", () => {
  it("discard consults the lock inside the transaction, not only in preview", () => {
    const src = fs.readFileSync(
      path.resolve(DIR, "../discard/discard.service.ts"),
      "utf8",
    );
    // Two preview blockers plus two in-transaction guards.
    expect(src.match(/assertNotBulkLocked\(/g)?.length).toBe(3); // 1 definition + 2 call sites
    /*
     * Matched on the call prefix, not the full argument list. These pinned the two-arg form and
     * broke when the guard gained a third argument (viaBatchId, so a discard can tell which batch
     * it arrived through) — a stricter guard failing its own test for being stricter. What the
     * test is here to protect is that both entities are guarded inside the transaction, which the
     * prefix plus the call count above establishes.
     */
    expect(src).toContain('assertNotBulkLocked("leave_request", id');
    expect(src).toContain('assertNotBulkLocked("attendance_regularization", id');
  });

  it("the lock fails open only when the table does not exist yet", () => {
    const src = read("bulk-approval.service.ts");
    const fn = src.slice(src.indexOf("export async function getEntityLock"));
    expect(fn).toContain('if (code === "ER_NO_SUCH_TABLE") return null;');
    expect(fn).toContain("throw err;");
  });
});

describe("spreadsheet date handling", () => {
  it("accepts the ISO form the sample template ships", () => {
    expect(normalizeDate("2026-08-05")).toBe("2026-08-05");
  });

  it("accepts the DD-MM-YYYY form the template guide instructs users to type", () => {
    expect(normalizeDate("05-08-2026")).toBe("2026-08-05");
    expect(normalizeDate("5/8/2026")).toBe("2026-08-05");
  });

  it("accepts an Excel date serial, which is what a real .xlsx sends", () => {
    // 46239 = 2026-08-05 in Excel's 1900 date system (46234 is 2026-07-31).
    expect(normalizeDate("46239")).toBe("2026-08-05");
    expect(normalizeDate("46234")).toBe("2026-07-31");
  });

  it("rejects rather than guessing at anything else", () => {
    expect(normalizeDate("not a date")).toBeNull();
    expect(normalizeDate("")).toBeNull();
    expect(normalizeDate(null)).toBeNull();
  });

  it("normalises months to the VARCHAR(7) shape run_month/pay_month actually store", () => {
    expect(normalizeMonth("2026-08")).toBe("2026-08");
    expect(normalizeMonth("08-2026")).toBe("2026-08");
    expect(normalizeMonth("05-08-2026")).toBe("2026-08");
    expect(normalizeMonth("August")).toBeNull();
  });
});

describe("branch resolution", () => {
  const emp = (branch: string | null) => ({
    id: "e", employee_code: "X", branch_id: branch,
    process_id: null, first_name: null, last_name: null,
  });

  it("resolves a single-branch file to that branch", () => {
    expect(resolveSingleBranch([emp("b1"), emp("b1")]).branchId).toBe("b1");
  });

  it("refuses a cross-branch file instead of picking one arbitrarily", () => {
    const result = resolveSingleBranch([emp("b1"), emp("b2")]);
    expect(result.branchId).toBeNull();
    expect(result.error).toMatch(/2 branches/);
  });

  it("tolerates employees with no branch", () => {
    expect(resolveSingleBranch([emp(null)]).error).toBeUndefined();
  });
});
