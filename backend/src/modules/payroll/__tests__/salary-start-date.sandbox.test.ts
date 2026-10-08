import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

/**
 * Salary start date against a REAL MySQL - opt-in, never runs in the normal suite.
 *
 * The unit tests fake the database. This one exercises the real SQL, the real CHECK constraint
 * (migration 1884), the real enum on employee_payroll_head_review_history (1880 enum re-apply) and the real
 * Payroll Head service functions, so a typo in a column name or a constraint that refuses the
 * sanctioned write cannot hide behind a mock.
 *
 * Run it against a throwaway local MySQL that has the mas_hrms tables and migrations 1883/1884 and the history-enum widening (1880_payroll_head_review_history_action_enum_reapply)
 * applied (see SALARY_DATE_SANDBOX_PORT); it refuses to run against anything but 127.0.0.1:
 *
 *   SALARY_DATE_SANDBOX_PORT=3399 npx vitest run src/modules/payroll/__tests__/salary-start-date.sandbox.test.ts
 */

const PORT = Number(process.env.SALARY_DATE_SANDBOX_PORT ?? 0);
const enabled = PORT > 0;

vi.mock("../../../db/mysql.js", async () => {
  const mysql = await import("mysql2/promise");
  const port = Number(process.env.SALARY_DATE_SANDBOX_PORT ?? 0);
  // Lazy: createPool does not connect until first use, so the skipped suite never touches a socket.
  const pool = mysql.createPool({
    host: "127.0.0.1",
    port: port || 3399,
    user: "root",
    database: "mas_hrms",
    timezone: "+05:30",
    dateStrings: true,
    decimalNumbers: true,
    connectionLimit: 4,
  });
  return { db: pool };
});
// The Payroll Head service pulls these in for unrelated screens; none is used by the date paths.
vi.mock("../../employees/employee-bgv.service.js", () => ({
  getEmployeeBgvStatus: vi.fn(),
}));
vi.mock("../bank-payment-readiness.service.js", () => ({
  buildBankReadinessReport: vi.fn(),
}));
vi.mock("../../payroll-masters/payrollMasters.service.js", () => ({
  createPackage: vi.fn(),
  getPackageById: vi.fn(),
}));
vi.mock("../../inbox/inbox.service.js", () => ({
  inboxService: { createItem: vi.fn() },
}));
vi.mock("../../../shared/scopeAccess.js", () => ({
  hasAnyRole: vi.fn(),
  buildScopeWhereClause: vi.fn(),
}));

import { db } from "../../../db/mysql.js";
import {
  applySalaryStartDate,
  checkSalaryStartDate,
  findSalaryStartDateMismatches,
  getSalaryStartDateConsistency,
  isSalaryStartDateGateEnforced,
  setSalaryStartDate,
} from "../salary-start-date.service.js";
import {
  approveOfferedPackage,
  updateAssignmentEffectiveDate,
  updateSalaryStartDate,
} from "../../payroll-head-review/payroll-head-review.service.js";

const PH_ROLES = ["payroll_head"] as const;
const ADMIN_ROLES = ["admin"] as const;
const PH_USER = "00000000-0000-4000-8000-0000000000aa";

let seq = 0;
// A per-run token keeps ids and employee codes unique, so the suite can be re-run against the same sandbox.
const RUN = Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, "0");
const uuid = (n: number) =>
  `${RUN}00-0000-4000-8000-${String(n).padStart(12, "0")}`;

interface Seed {
  emp: string;
  cand: string;
  review: string;
  asg: string;
  code: string;
}

/** One approved-or-pending HRMS-onboarded employee with every stored copy of the date on `date`. */
async function seed(opts: {
  doj: string;
  date: string;
  review?: string;
  branch?: string;
}): Promise<Seed> {
  seq += 1;
  const s: Seed = {
    emp: uuid(1000 + seq),
    cand: uuid(2000 + seq),
    review: uuid(3000 + seq),
    asg: uuid(4000 + seq),
    code: `SBX${RUN}${String(seq).padStart(3, "0")}`,
  };
  await db.execute(
    `INSERT INTO employees (id, employee_code, first_name, date_of_joining, salary_start_date, candidate_id, branch_id)
     VALUES (?, ?, 'Sandbox', ?, ?, ?, ?)`,
    [s.emp, s.code, opts.doj, opts.date, s.cand, opts.branch ?? uuid(9)],
  );
  await db.execute(
    `INSERT INTO ats_payroll_hr_validation (id, candidate_id, employment_type, gross_salary, joining_date, salary_start_date)
     VALUES (?, ?, 'onroll', 1000, ?, ?)`,
    [uuid(5000 + seq), s.cand, opts.doj, opts.date],
  );
  await db.execute(
    `INSERT INTO employee_payroll_head_review (id, employee_id, candidate_id, status, package_effective_from)
     VALUES (?, ?, ?, ?, ?)`,
    [s.review, s.emp, s.cand, opts.review ?? "approved", opts.date],
  );
  await db.execute(
    `INSERT INTO employee_salary_assignment (id, employee_id, ctc_annual, effective_from, active_status) VALUES (?, ?, 240000, ?, 1)`,
    [s.asg, s.emp, opts.date],
  );
  await db.execute(
    `INSERT INTO salary_component_assignments (id, employee_id, effective_date, status) VALUES (?, ?, ?, 'active')`,
    [uuid(6000 + seq), s.emp, opts.date],
  );
  return s;
}

async function row(sql: string, params: unknown[]) {
  const [rows] = await db.execute(sql, params as never[]);
  return (rows as Array<Record<string, unknown>>)[0];
}
const employeeDates = (emp: string) =>
  row(
    `SELECT salary_start_date AS d FROM employees WHERE id = ?`,
    [emp],
  );

describe.skipIf(!enabled)("salary start date against a real MySQL", () => {
  beforeAll(async () => {
    // Refuse to run against anything that is not the local throwaway server.
    const host = await row("SELECT @@hostname AS h, @@port AS p", []);
    expect(Number(host.p)).toBe(PORT);
  });

  beforeEach(async () => {
    await db.execute(
      `DELETE FROM salary_prep_run WHERE run_month LIKE '2030-%'`,
      [],
    );
  });

  afterAll(async () => {
    await (db as unknown as { end: () => Promise<void> }).end();
  });

  describe("migration 1884: the database itself", () => {
    it("no longer refuses a salary start before joining at the database (the service enforces it)", async () => {
      const s = await seed({ doj: "2030-03-10", date: "2030-03-10" });
      await db.execute(`UPDATE employees SET salary_start_date = '2030-03-01' WHERE id = ?`, [s.emp]);
      expect((await employeeDates(s.emp)).d).toBe("2030-03-01");
    });

    it("accepts the widened history actions (1880 enum re-apply)", async () => {
      const s = await seed({ doj: "2030-03-10", date: "2030-03-10" });
      for (const action of [
        "salary_start_date_updated",
        "assignment_effective_date_updated",
        "salary_date_revision_approved",
        "salary_date_revision_rejected",
      ]) {
        await db.execute(
          `INSERT INTO employee_payroll_head_review_history (id, employee_id, review_id, action, actor_user_id) VALUES (UUID(), ?, ?, ?, ?)`,
          [s.emp, s.review, action, PH_USER],
        );
      }
      const n = await row(
        `SELECT COUNT(*) AS n FROM employee_payroll_head_review_history WHERE employee_id = ?`,
        [s.emp],
      );
      expect(Number(n.n)).toBe(4);
    });
  });

  describe("applySalaryStartDate on real tables", () => {
    it("carries Payroll Head's backdated date to every copy, and audits it", async () => {
      const s = await seed({ doj: "2030-03-10", date: "2030-03-10" });
      const result = await setSalaryStartDate({
        employeeId: s.emp,
        newDate: "2030-03-01",
        actorUserId: PH_USER,
        source: "payroll_head_change_start_date",
        authority: "payroll_head",
        allowBackdate: true,
        reason: "Trainee started 1 March",
        today: "2030-03-05",
      });
      expect(result).toMatchObject({
        changed: true,
        preJoining: true,
        beforeToday: true,
        oldDate: "2030-03-10",
      });
      expect(await employeeDates(s.emp)).toEqual({ d: "2030-03-01" });
      expect(
        (
          await row(
            `SELECT salary_start_date AS d FROM ats_payroll_hr_validation WHERE candidate_id = ?`,
            [s.cand],
          )
        ).d,
      ).toBe("2030-03-01");
      expect(
        (
          await row(
            `SELECT package_effective_from AS d FROM employee_payroll_head_review WHERE id = ?`,
            [s.review],
          )
        ).d,
      ).toBe("2030-03-01");
      expect(
        (
          await row(
            `SELECT effective_from AS d FROM employee_salary_assignment WHERE id = ?`,
            [s.asg],
          )
        ).d,
      ).toBe("2030-03-01");
      expect(
        (
          await row(
            `SELECT effective_date AS d FROM salary_component_assignments WHERE employee_id = ?`,
            [s.emp],
          )
        ).d,
      ).toBe("2030-03-01");
      const audit = await row(
        `SELECT * FROM employee_salary_start_date_audit WHERE employee_id = ?`,
        [s.emp],
      );
      expect(audit).toMatchObject({
        old_date: "2030-03-10",
        new_date: "2030-03-01",
        pre_joining: 1,
        reason: "Trainee started 1 March",
      });
    });

    it("rolls back EVERY copy when one write is refused (standard authority, before joining)", async () => {
      const s = await seed({ doj: "2030-03-10", date: "2030-03-10", review: "pending_review" });
      await expect(
        setSalaryStartDate({
          employeeId: s.emp,
          newDate: "2030-03-01",
          actorUserId: PH_USER,
          source: "employee_edit",
          authority: "standard",
          today: "2030-02-20",
        }),
      ).rejects.toMatchObject({ code: "SALARY_START_BEFORE_JOINING" });
      expect(await employeeDates(s.emp)).toEqual({ d: "2030-03-10" });
      expect(
        (
          await row(
            `SELECT COUNT(*) AS n FROM employee_salary_start_date_audit WHERE employee_id = ?`,
            [s.emp],
          )
        ).n,
      ).toBe(0);
    });

    it("refuses a change that reaches into a finalized payroll month", async () => {
      const s = await seed({ doj: "2030-03-10", date: "2030-03-10" });
      await db.execute(
        `INSERT INTO salary_prep_run (id, run_month, status) VALUES (UUID(), '2030-03', 'FINALIZED')`,
        [],
      );
      await expect(
        setSalaryStartDate({
          employeeId: s.emp,
          newDate: "2030-03-15",
          actorUserId: PH_USER,
          source: "payroll_head_change_start_date",
          authority: "payroll_head",
          allowBackdate: true,
          today: "2030-03-01",
        }),
      ).rejects.toMatchObject({
        statusCode: 409,
        code: "PAYROLL_MONTH_CLOSED",
      });
      expect((await employeeDates(s.emp)).d).toBe("2030-03-10");
    });

    it("does not let Payroll HR change an approved employee's date, but lets a reviewer", async () => {
      const s = await seed({ doj: "2030-03-10", date: "2030-03-10" });
      await expect(
        setSalaryStartDate({
          employeeId: s.emp,
          newDate: "2030-03-20",
          actorUserId: PH_USER,
          source: "joining_control_room",
          authority: "standard",
          today: "2030-03-01",
        }),
      ).rejects.toMatchObject({
        statusCode: 403,
        code: "SALARY_DATE_OWNED_BY_PAYROLL_HEAD",
      });
      await expect(
        setSalaryStartDate({
          employeeId: s.emp,
          newDate: "2030-03-20",
          actorUserId: PH_USER,
          source: "revision_request_approved",
          authority: "payroll_head",
          today: "2030-03-01",
        }),
      ).resolves.toMatchObject({ changed: true });
    });
  });

  describe("increments are not stale start dates", () => {
    it("an employee with a Salary Change Center change keeps its increment date on the assignment, is not reported, and is not called inconsistent", async () => {
      // Start date 10 Mar; a salary change moved the (single) assignment row to 1 Apr, as the Salary Change Center does.
      const s = await seed({ doj: "2030-03-10", date: "2030-03-10" });
      await db.execute(`UPDATE employee_salary_assignment SET effective_from = '2030-04-01' WHERE id = ?`, [s.asg]);
      await db.execute(
        `INSERT INTO employee_salary_change_log (id, employee_id, new_salary_component_assignment_id, requested_by_user_id, requested_by_name, actor_user_id, reason, new_ctc, effective_date)
         VALUES (UUID(), ?, UUID(), ?, 'Sandbox', ?, 'increment', 300000, '2030-04-01')`,
        [s.emp, PH_USER, PH_USER],
      );

      expect(await findSalaryStartDateMismatches(db as never, "e.id = ?", [s.emp])).toHaveLength(0);
      expect((await getSalaryStartDateConsistency(db, s.emp)).consistent).toBe(true);

      // Re-saving the start date must not pull the increment back to it.
      await setSalaryStartDate({
        employeeId: s.emp, newDate: "2030-03-14", actorUserId: PH_USER, source: "payroll_head_change_start_date",
        authority: "payroll_head", allowBackdate: true, today: "2030-03-01",
      });
      expect((await row(`SELECT effective_from AS d FROM employee_salary_assignment WHERE id = ?`, [s.asg])).d).toBe("2030-04-01");
      expect((await employeeDates(s.emp)).d).toBe("2030-03-14");
    });

    it("without a salary change on record, an unexplained assignment date is a stale start date that re-saving repairs", async () => {
      const s = await seed({ doj: "2030-03-10", date: "2030-03-10" });
      await db.execute(`UPDATE employee_salary_assignment SET effective_from = '2030-03-25' WHERE id = ?`, [s.asg]);
      const before = await findSalaryStartDateMismatches(db as never, "e.id = ?", [s.emp]);
      expect(before[0]?.reasons).toContain("NO_ASSIGNMENT_ON_START_DATE");

      await setSalaryStartDate({
        employeeId: s.emp, newDate: "2030-03-10", actorUserId: PH_USER, source: "repair",
        authority: "payroll_head", allowBackdate: true, today: "2030-03-01",
      });
      expect((await row(`SELECT effective_from AS d FROM employee_salary_assignment WHERE id = ?`, [s.asg])).d).toBe("2030-03-10");
      expect(await findSalaryStartDateMismatches(db as never, "e.id = ?", [s.emp])).toHaveLength(0);
    });
  });

  describe("checkSalaryStartDate on a real database", () => {
    it("writes nothing and leaves no lock behind, whether it passes or refuses", async () => {
      const s = await seed({ doj: "2030-03-10", date: "2030-03-10" });
      await expect(
        checkSalaryStartDate({
          employeeId: s.emp, newDate: "2030-03-15", actorUserId: PH_USER, source: "payroll_head_create_and_assign_package",
          authority: "payroll_head", allowBackdate: true, today: "2030-03-01",
        }),
      ).resolves.toBeUndefined();
      await expect(
        checkSalaryStartDate({
          employeeId: s.emp, newDate: "2030-03-01", actorUserId: PH_USER, source: "payroll_head_create_and_assign_package",
          authority: "payroll_head", allowBackdate: true, today: "2030-03-05",
        }),
      ).rejects.toMatchObject({ code: "REASON_REQUIRED" });
      expect(await employeeDates(s.emp)).toEqual({ d: "2030-03-10" });
      expect((await row(`SELECT COUNT(*) AS n FROM employee_salary_start_date_audit WHERE employee_id = ?`, [s.emp])).n).toBe(0);
      // Row locks are released: a normal write goes straight through.
      await db.execute(`UPDATE employees SET first_name = 'Lock free' WHERE id = ?`, [s.emp]);
    });
  });

  describe("reconciliation query", () => {
    it("finds an employee whose payroll date drifted from Payroll Head's, and stops finding it once repaired", async () => {
      // The live defect: assignment / package / validation carry Payroll Head's 1 March, employees carries joining.
      const s = await seed({ doj: "2030-03-10", date: "2030-03-01" });
      await db.execute(
        `UPDATE employees SET salary_start_date = '2030-03-10' WHERE id = ?`,
        [s.emp],
      );

      const before = await findSalaryStartDateMismatches(
        db as never,
        "e.id = ?",
        [s.emp],
      );
      expect(before).toHaveLength(1);
      expect(before[0].reasons).toEqual(
        expect.arrayContaining([
          "VALIDATION_DATE_DIFFERS",
          "PACKAGE_DATE_DIFFERS",
        ]),
      );
      expect(before[0]).toMatchObject({
        employee_code: s.code,
        payroll_date: "2030-03-10",
        validation_date: "2030-03-01",
        assignment_date: "2030-03-01",
      });
      expect((await getSalaryStartDateConsistency(db, s.emp)).consistent).toBe(
        false,
      );

      // Re-saving Payroll Head's own date repairs every copy (this is what the repair script does).
      await setSalaryStartDate({
        employeeId: s.emp,
        newDate: "2030-03-01",
        actorUserId: PH_USER,
        source: "repair",
        authority: "payroll_head",
        allowBackdate: true,
        reason: "Repair: aligned to Payroll Head date",
        today: "2030-03-05",
      });

      expect(
        await findSalaryStartDateMismatches(db as never, "e.id = ?", [s.emp]),
      ).toHaveLength(0);
      expect((await getSalaryStartDateConsistency(db, s.emp)).consistent).toBe(
        true,
      );
      expect(await employeeDates(s.emp)).toEqual({ d: "2030-03-01" });
    });

    it("flags two active assignments and an approved pre-joining date that has no audit row", async () => {
      const s = await seed({ doj: "2030-03-10", date: "2030-03-10" });
      await db.execute(
        `INSERT INTO employee_salary_assignment (id, employee_id, ctc_annual, effective_from, active_status) VALUES (UUID(), ?, 240000, '2030-03-10', 1)`,
        [s.emp],
      );
      const rows = await findSalaryStartDateMismatches(
        db as never,
        "e.id = ?",
        [s.emp],
      );
      expect(rows[0].reasons).toContain("MULTIPLE_ACTIVE_ASSIGNMENTS");
    });

    it("the payroll gate switch is off by default (warning) and reads true only when set", async () => {
      expect(await isSalaryStartDateGateEnforced()).toBe(false);
      await db.execute(
        `UPDATE payroll_config_flags SET config_value = 'true' WHERE config_key = 'salary_start_date_gate_enforced'`,
        [],
      );
      expect(await isSalaryStartDateGateEnforced()).toBe(true);
      await db.execute(
        `UPDATE payroll_config_flags SET config_value = 'false' WHERE config_key = 'salary_start_date_gate_enforced'`,
        [],
      );
    });
  });

  describe("Payroll Head service functions on real tables", () => {
    it("updateSalaryStartDate: on-time date changes every copy and writes the (now valid) history row", async () => {
      const s = await seed({
        doj: "2030-03-10",
        date: "2030-03-10",
        review: "pending_review",
      });
      const out = await updateSalaryStartDate(
        s.emp,
        "2030-03-14",
        PH_USER,
        PH_ROLES,
      );
      expect(out).toMatchObject({
        salary_start_date: "2030-03-14",
        changed: true,
      });
      const dates = await employeeDates(s.emp);
      expect(dates).toEqual({ d: "2030-03-14" });
      expect(
        (
          await row(
            `SELECT effective_from AS d FROM employee_salary_assignment WHERE id = ?`,
            [s.asg],
          )
        ).d,
      ).toBe("2030-03-14");
      const h = await row(
        `SELECT action FROM employee_payroll_head_review_history WHERE employee_id = ? ORDER BY created_at DESC LIMIT 1`,
        [s.emp],
      );
      expect(h.action).toBe("salary_start_date_updated");
    });

    it("updateSalaryStartDate: a backdated date needs a reason for payroll_head, and admin is refused outright", async () => {
      const s = await seed({
        doj: "2030-03-10",
        date: "2030-03-10",
        review: "pending_review",
      });
      // "today" here is the real clock (2026), so every 2030 date is in the future: use a pre-joining
      // date to trigger the rule deterministically.
      await expect(
        updateSalaryStartDate(s.emp, "2030-03-01", PH_USER, PH_ROLES),
      ).rejects.toMatchObject({ code: "REASON_REQUIRED" });
      await expect(
        updateSalaryStartDate(
          s.emp,
          "2030-03-01",
          PH_USER,
          ADMIN_ROLES,
          "needs backdating",
        ),
      ).rejects.toMatchObject({
        code: "SALARY_START_BEFORE_JOINING",
      });
      expect((await employeeDates(s.emp)).d).toBe("2030-03-10");

      await updateSalaryStartDate(
        s.emp,
        "2030-03-01",
        PH_USER,
        PH_ROLES,
        "Trainee started 1 March",
      );
      expect(await employeeDates(s.emp)).toEqual({ d: "2030-03-01" });
    });

    it("updateAssignmentEffectiveDate: the previously-broken history write now commits, and every copy moves", async () => {
      const s = await seed({ doj: "2030-03-10", date: "2030-03-10" });
      const out = await updateAssignmentEffectiveDate(
        s.emp,
        "2030-03-18",
        PH_USER,
        "Corrected after HR call",
        PH_ROLES,
      );
      expect(out).toMatchObject({
        effective_from: "2030-03-18",
        salary_start_date: "2030-03-18",
      });
      expect((await employeeDates(s.emp)).d).toBe("2030-03-18");
      const active = await db.execute(
        `SELECT effective_from FROM employee_salary_assignment WHERE employee_id = ? AND active_status = 1`,
        [s.emp],
      );
      expect(
        (active[0] as Array<{ effective_from: string }>).map(
          (r) => r.effective_from,
        ),
      ).toEqual(["2030-03-18"]);
      const h = await row(
        `SELECT action FROM employee_payroll_head_review_history WHERE employee_id = ? ORDER BY created_at DESC LIMIT 1`,
        [s.emp],
      );
      expect(h.action).toBe("assignment_effective_date_updated");
      expect((await getSalaryStartDateConsistency(db, s.emp)).consistent).toBe(
        true,
      );
    });

    it("approveOfferedPackage: package, review, assignment and employees all land on the chosen date in one transaction", async () => {
      const s = await seed({
        doj: "2030-03-10",
        date: "2030-03-10",
        review: "pending_review",
      });
      await db.execute(
        `INSERT INTO ats_employment_offer (id, onboarding_request_id, candidate_id, date_of_joining, offered_ctc, created_by)
         VALUES (UUID(), UUID(), ?, '2030-03-10', 240000, ?)`,
        [s.cand, PH_USER],
      );
      const out = await approveOfferedPackage(
        s.emp,
        "2030-03-12",
        PH_USER,
        PH_ROLES,
      );
      expect(out.salary_date).toMatchObject({
        salary_start_date: "2030-03-12",
      });
      expect((await employeeDates(s.emp)).d).toBe("2030-03-12");
      expect(
        (
          await row(
            `SELECT package_effective_from AS d FROM employee_payroll_head_review WHERE id = ?`,
            [s.review],
          )
        ).d,
      ).toBe("2030-03-12");
      expect(
        (
          await row(
            `SELECT effective_from AS d FROM employee_salary_assignment WHERE id = ?`,
            [s.asg],
          )
        ).d,
      ).toBe("2030-03-12");
      // The package the approval just wrote (approval_reference = the review id) carries the chosen date.
      const activeSca = await row(
        `SELECT effective_date AS d FROM salary_component_assignments WHERE employee_id = ? AND approval_reference = ?`,
        [s.emp, s.review],
      );
      expect(activeSca.d).toBe("2030-03-12");
    });

    it("approveOfferedPackage rolls the package back when the date is refused (no half-written approval)", async () => {
      const s = await seed({
        doj: "2030-03-10",
        date: "2030-03-10",
        review: "pending_review",
      });
      await db.execute(
        `INSERT INTO ats_employment_offer (id, onboarding_request_id, candidate_id, date_of_joining, offered_ctc, created_by)
         VALUES (UUID(), UUID(), ?, '2030-03-10', 240000, ?)`,
        [s.cand, PH_USER],
      );
      const scaBefore = await row(
        `SELECT COUNT(*) AS n FROM salary_component_assignments WHERE employee_id = ?`,
        [s.emp],
      );
      await expect(
        approveOfferedPackage(s.emp, "2030-03-01", PH_USER, PH_ROLES),
      ).rejects.toMatchObject({ code: "REASON_REQUIRED" });
      const scaAfter = await row(
        `SELECT COUNT(*) AS n FROM salary_component_assignments WHERE employee_id = ?`,
        [s.emp],
      );
      expect(scaAfter.n).toBe(scaBefore.n);
      expect((await employeeDates(s.emp)).d).toBe("2030-03-10");
      expect(
        (
          await row(
            `SELECT package_accepted AS a FROM employee_payroll_head_review WHERE id = ?`,
            [s.review],
          )
        ).a,
      ).toBe(0);
    });
  });
});
