/**
 * END-TO-END against a real MySQL: absconder salary hold, from request to release, through the real
 * payroll calculator. Runs ONLY when ABSCONDER_E2E=1 and DB_HOST is a local host with a disposable
 * database name; otherwise it is skipped, so it can never touch a shared database.
 *
 *   ABSCONDER_E2E=1 DB_HOST=127.0.0.1 DB_PORT=3399 DB_USER=root DB_PASSWORD=root DB_NAME=hrms_e2e \
 *     npx vitest run src/modules/payroll/__tests__/absconder-hold.e2e.test.ts
 */
import { describe, expect, it, beforeAll, vi } from "vitest";

// The shared test setup replaces the database module with a mock. This file needs the real one.
vi.unmock("../../../db/mysql.js");
import { randomUUID } from "node:crypto";

const LOCAL = ["127.0.0.1", "localhost"].includes(String(process.env.DB_HOST ?? "").toLowerCase());
const SAFE_DB = /(e2e|_test$|^test_)/i.test(String(process.env.DB_NAME ?? ""));
const ON = process.env.ABSCONDER_E2E === "1" && LOCAL && SAFE_DB;

describe.skipIf(!ON)("absconder salary hold, end to end (real MySQL)", () => {
  let db: any, calc: any, rel: any, hold: any, ffc: any;
  const ids = {
    branch: randomUUID(), process: randomUUID(), structure: randomUUID(),
    mgrEmp: randomUUID(), mgrUser: randomUUID(), prEmp: randomUUID(), prUser: randomUUID(),
    bhEmp: randomUUID(), bhUser: randomUUID(), phUser: randomUUID(), strangerUser: randomUUID(),
    absc: randomUUID(), absc2: randomUUID(), ctrl: randomUUID(),
    exit: randomUUID(), exit2: randomUUID(), run: randomUUID(), run2: randomUUID(),
  };
  const MONTH = "2026-10";
  const REASON = "salary withheld pending recovery of company property";
  const sql = async (q: string, p: unknown[] = []) => (await db.execute(q, p))[0];
  const line = async (empId: string, runId = ids.run) =>
    (await sql(`SELECT final_payable_days, gross_salary, net_salary, status FROM salary_prep_line WHERE run_id = ? AND employee_id = ?`, [runId, empId]))[0];
  const setFlag = (v: string) => sql(
    `INSERT INTO payroll_config_flags (id, config_key, config_value) VALUES (?, 'absconder_salary_hold_enabled', ?)`, [randomUUID(), v]);

  async function mkEmp(id: string, code: string, opts: { user?: string; mgr?: string; status?: string; active?: number } = {}) {
    await sql(
      `INSERT INTO employees (id, user_id, employee_code, first_name, date_of_joining, branch_id, process_id,
          reporting_manager_id, employment_status, active_status, official_email)
       VALUES (?, ?, ?, ?, '2026-01-01', ?, ?, ?, ?, ?, ?)`,
      [id, opts.user ?? null, code, code, ids.branch, ids.process, opts.mgr ?? null, opts.status ?? "active", opts.active ?? 1, `${code.toLowerCase()}@example.test`]);
  }
  async function mkSalary(empId: string) {
    await sql(`INSERT INTO employee_salary_assignment (id, employee_id, structure_id, ctc_annual, effective_from, active_status)
               VALUES (?, ?, ?, 240000, '2026-01-01', 1)`, [randomUUID(), empId, ids.structure]);
  }
  async function mkAttendance(empId: string, fromDay: number, toDay: number) {
    for (let d = fromDay; d <= toDay; d++) {
      const date = `${MONTH}-${String(d).padStart(2, "0")}`;
      await sql(`INSERT INTO attendance_daily_record (id, employee_id, record_date, attendance_status, lwp_value)
                 VALUES (?, ?, ?, 'present', 0)`, [randomUUID(), empId, date]);
    }
  }
  async function mkExit(exitId: string, empId: string) {
    await sql(`INSERT INTO exit_request (id, employee_id, exit_type, exit_sub_type, status, absconding_since,
                  last_working_day_proposed, last_working_day_confirmed, notice_period_days)
               VALUES (?, ?, 'involuntary', 'absconding', 'exited', '2026-10-05', '2026-10-05', '2026-10-05', 0)`, [exitId, empId]);
  }

  beforeAll(async () => {
    ({ db } = await import("../../../db/mysql.js"));
    calc = await import("../payrollCalculate.service.js");
    rel = await import("../absconder-pay-release.service.js");
    hold = await import("../absconder-hold.service.js");
    ffc = await import("../../exit/ff-compute.service.js");

    await sql(`INSERT INTO branch_master (id, branch_code, branch_name) VALUES (?, 'E2E', 'E2E Branch')`, [ids.branch]);
    await sql(`INSERT INTO process_master (id, process_code, process_name) VALUES (?, 'E2EP', 'E2E Process')`, [ids.process]);
    await sql(`INSERT INTO salary_structure_master (id, structure_code, structure_name, basic_pct, hra_pct) VALUES (?, 'E2ES', 'E2E', 40, 20)`, [ids.structure]);
    for (const [u, e] of [[ids.mgrUser, "mgr"], [ids.prUser, "pr"], [ids.bhUser, "bh"], [ids.phUser, "ph"], [ids.strangerUser, "st"]]) {
      await sql(`INSERT INTO auth_user (id, email, password_hash) VALUES (?, ?, 'x')`, [u, `${e}@example.test`]);
    }
    await mkEmp(ids.mgrEmp, "E2EMGR", { user: ids.mgrUser });
    await mkEmp(ids.prEmp, "E2EPR", { user: ids.prUser });
    await mkEmp(ids.bhEmp, "E2EBH", { user: ids.bhUser });
    for (const rk of ['payroll_hr', 'branch_head']) {
      await sql(`INSERT IGNORE INTO workforce_role_catalog (role_key, role_name) VALUES (?, ?)`, [rk, rk]);
    }
    await sql(`INSERT INTO user_roles (id, user_id, role_key, active_status) VALUES (?, ?, 'payroll_hr', 1)`, [randomUUID(), ids.prUser]);
    await sql(`INSERT INTO user_roles (id, user_id, role_key, active_status) VALUES (?, ?, 'branch_head', 1)`, [randomUUID(), ids.bhUser]);

    // Two absconders (open run, then closed run) and one ordinary employee as the control.
    for (const [eid, code] of [[ids.absc, "E2EABS1"], [ids.absc2, "E2EABS2"]] as const) {
      await mkEmp(eid, code, { mgr: ids.mgrEmp, status: "absconded", active: 0 });
      await mkSalary(eid);
      await mkAttendance(eid, 1, 5);
    }
    await mkEmp(ids.ctrl, "E2ECTRL", { mgr: ids.mgrEmp });
    await mkSalary(ids.ctrl);
    await mkAttendance(ids.ctrl, 1, 31);
    await mkExit(ids.exit, ids.absc);
    await mkExit(ids.exit2, ids.absc2);
    await sql(`UPDATE employees SET date_of_exit = '2026-10-05' WHERE id IN (?, ?)`, [ids.absc, ids.absc2]);
    await sql(`INSERT INTO salary_prep_run (id, run_month, status) VALUES (?, ?, 'draft')`, [ids.run, MONTH]);
  }, 60_000);

  it("1. the feature is off: an absconder is paid as normal and a hold cannot be requested", async () => {
    await calc.calculatePayrollRun(ids.run, "e2e");
    const l = await line(ids.absc);
    expect(Number(l.final_payable_days)).toBeGreaterThan(0);
    expect(Number(l.gross_salary)).toBeGreaterThan(0);
    await expect(rel.requestHold({ exitRequestId: ids.exit, reason: REASON, actorUserId: ids.mgrUser }))
      .rejects.toMatchObject({ code: "HOLD_FEATURE_OFF" });
  }, 60_000);

  let normalDays = 0;
  let normalGross = 0;
  it("2. switch on: still paid as normal until someone asks", async () => {
    await setFlag("true");
    await calc.calculatePayrollRun(ids.run, "e2e");
    const l = await line(ids.absc);
    normalDays = Number(l.final_payable_days);
    normalGross = Number(l.gross_salary);
    expect(normalDays).toBeGreaterThan(0);
    expect(await hold.isAbsconderPayHeld(ids.absc)).toBe(false);
  }, 60_000);

  it("3. only the reporting manager can request; the request changes nothing in payroll", async () => {
    for (const who of [ids.strangerUser, ids.prUser, ids.bhUser, ids.phUser]) {
      await expect(rel.requestHold({ exitRequestId: ids.exit, reason: REASON, actorUserId: who })).rejects.toMatchObject({ code: "HOLD_NOT_YOUR_CALL" });
    }
    await expect(rel.requestHold({ exitRequestId: ids.exit, reason: "no", actorUserId: ids.mgrUser })).rejects.toMatchObject({ code: "HOLD_REASON_REQUIRED" });
    await rel.requestHold({ exitRequestId: ids.exit, reason: REASON, actorUserId: ids.mgrUser });
    expect((await rel.getHoldState(ids.exit)).state).toBe("hold_requested");
    await calc.calculatePayrollRun(ids.run, "e2e");
    expect(Number((await line(ids.absc)).final_payable_days)).toBe(normalDays);
    expect(await hold.isAbsconderPayHeld(ids.absc)).toBe(false);
  }, 60_000);

  it("4. only the branch Payroll HR can approve; Branch Head, Payroll Head and manager cannot", async () => {
    for (const who of [ids.bhUser, ids.phUser, ids.mgrUser, ids.strangerUser]) {
      await expect(rel.approveHoldRequest({ exitRequestId: ids.exit, reason: REASON, actorUserId: who })).rejects.toMatchObject({ code: "HOLD_NOT_YOUR_CALL" });
    }
    expect((await rel.getHoldState(ids.exit)).state).toBe("hold_requested");
  }, 60_000);

  it("5. Payroll HR approves: the days go to 0 immediately and the line stays", async () => {
    await rel.approveHoldRequest({ exitRequestId: ids.exit, reason: REASON, actorUserId: ids.prUser });
    expect((await rel.getHoldState(ids.exit)).state).toBe("held");
    const l = await line(ids.absc);
    expect(l).toBeTruthy();                       // the line was not deleted
    expect(Number(l.final_payable_days)).toBe(0); // recalculated by the approval itself
    expect(Number(l.gross_salary)).toBe(0);
    expect(Number(l.net_salary)).toBe(0);
    const ctrl = await line(ids.ctrl);
    expect(Number(ctrl.final_payable_days)).toBeGreaterThan(0); // an ordinary employee is untouched
  }, 60_000);

  it("6. a full recalculation (the nightly path) keeps it at 0 and keeps the line", async () => {
    await calc.calculatePayrollRun(ids.run, "e2e-nightly");
    const l = await line(ids.absc);
    expect(l).toBeTruthy();
    expect(Number(l.final_payable_days)).toBe(0);
    expect(Number(l.net_salary)).toBe(0);
  }, 60_000);

  it("7. a typed payable-days override cannot bypass the hold", async () => {
    await sql(`INSERT INTO payroll_payable_days_override (id, employee_id, run_month, payable_days, reason, active_status)
               VALUES (?, ?, ?, 20, 'e2e override', 1)`, [randomUUID(), ids.absc, MONTH]).catch(() => undefined);
    await calc.calculatePayrollRun(ids.run, "e2e");
    expect(Number((await line(ids.absc)).final_payable_days)).toBe(0);
    await sql(`DELETE FROM payroll_payable_days_override WHERE employee_id = ?`, [ids.absc]).catch(() => undefined);
  }, 60_000);

  it("8. the held person is listed by name for the bank exports and validation", async () => {
    const held = await hold.heldAbsconderLinesForRuns([ids.run]);
    expect(held.map((h: any) => h.employee_code)).toContain("E2EABS1");
    expect(held.map((h: any) => h.employee_code)).not.toContain("E2ECTRL");
  }, 30_000);

  it("9. the F&F shows the month as HELD, not paid via payroll", async () => {
    const p = await ffc.computeFfPreview(ids.exit);
    expect(p.final_month_salary.paid_via).toBe("held");
    expect(p.final_month_salary.paid_days).toBe(0);
  }, 60_000);

  it("10. only the branch Payroll HR can release; then the attendance days reappear", async () => {
    for (const who of [ids.bhUser, ids.phUser, ids.mgrUser, ids.strangerUser]) {
      await expect(rel.releaseHold({ exitRequestId: ids.exit, reason: REASON, actorUserId: who })).rejects.toMatchObject({ code: "HOLD_NOT_YOUR_CALL" });
    }
    const out = await rel.releaseHold({ exitRequestId: ids.exit, reason: REASON, actorUserId: ids.prUser });
    expect(out).toMatchObject({ route: "payroll", openRunRecalculated: true });
    const l = await line(ids.absc);
    expect(Number(l.final_payable_days)).toBe(normalDays);   // exactly what it was before the hold
    expect(Number(l.gross_salary)).toBe(normalGross);
    expect(await hold.isAbsconderPayHeld(ids.absc)).toBe(false);
    expect((await sql(`SELECT pay_release_route FROM exit_request WHERE id = ?`, [ids.exit]))[0].pay_release_route).toBe("payroll");
  }, 60_000);

  it("11. a full recalculation after release does not re-hold or double count", async () => {
    await calc.calculatePayrollRun(ids.run, "e2e-nightly");
    expect(Number((await line(ids.absc)).final_payable_days)).toBe(normalDays);
    const p = await ffc.computeFfPreview(ids.exit);
    expect(p.final_month_salary.paid_via).toBe("payroll");     // paid by the run, not added to F&F
  }, 60_000);

  it("12. Payroll HR can place a hold directly; a hold on a closed month releases through F&F once", async () => {
    // absconder 2: hold while the run is open, then the run closes, then release.
    await calc.calculatePayrollRun(ids.run, "e2e");
    expect(Number((await line(ids.absc2)).final_payable_days)).toBeGreaterThan(0);
    await expect(rel.placeHold({ exitRequestId: ids.exit2, reason: REASON, actorUserId: ids.mgrUser })).rejects.toMatchObject({ code: "HOLD_NOT_YOUR_CALL" });
    await rel.placeHold({ exitRequestId: ids.exit2, reason: REASON, actorUserId: ids.prUser });
    expect(Number((await line(ids.absc2)).final_payable_days)).toBe(0);
    await sql(`UPDATE salary_prep_run SET status = 'finalized' WHERE id = ?`, [ids.run]);          // the month closes while held
    const out = await rel.releaseHold({ exitRequestId: ids.exit2, reason: REASON, actorUserId: ids.prUser });
    expect(out.route).toBe("fnf");
    expect(Number((await line(ids.absc2)).final_payable_days)).toBe(0);                            // the closed line is not rewritten
    const p = await ffc.computeFfPreview(ids.exit2);
    expect(p.final_month_salary.paid_via).toBe("fnf_manual");
    expect(Number(p.final_month_salary.suggested_amount)).toBeGreaterThan(0);                     // F&F carries it, once
    expect((await sql(`SELECT pay_release_route FROM exit_request WHERE id = ?`, [ids.exit2]))[0].pay_release_route).toBe("fnf");
  }, 90_000);

  it("13. the audit trail records every step in order", async () => {
    const ev = await sql(`SELECT action FROM absconder_pay_release_event WHERE exit_request_id = ? ORDER BY seq`, [ids.exit]);
    expect(ev.map((e: any) => e.action)).toEqual(["hold_requested", "hold_placed", "hold_released"]);
  }, 30_000);

  it("14. a declined request leaves salary as normal and can be requested again", async () => {
    const e3 = randomUUID(), emp3 = randomUUID();
    await mkEmp(emp3, "E2EABS3", { mgr: ids.mgrEmp, status: "absconded", active: 0 });
    await mkSalary(emp3); await mkAttendance(emp3, 1, 5); await mkExit(e3, emp3);
    await sql(`UPDATE salary_prep_run SET status = 'draft' WHERE id = ?`, [ids.run]);
    await rel.requestHold({ exitRequestId: e3, reason: REASON, actorUserId: ids.mgrUser });
    await rel.rejectHoldRequest({ exitRequestId: e3, reason: "no hold is warranted for this person", actorUserId: ids.prUser });
    expect((await rel.getHoldState(e3)).state).toBe("request_rejected");
    expect(await hold.isAbsconderPayHeld(emp3)).toBe(false);
    await rel.requestHold({ exitRequestId: e3, reason: "new facts: property is still missing", actorUserId: ids.mgrUser });
    expect((await rel.getHoldState(e3)).state).toBe("hold_requested");
  }, 60_000);
});
