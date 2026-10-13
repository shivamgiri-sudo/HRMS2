/**
 * SCENARIO MATRIX against a real MySQL, through the real calculator and real routes. Inputs (attendance,
 * salary, advances changing while a hold is on) and outputs (the whole payroll line before / during / after,
 * the NEFT bank files downloaded over HTTP, the F&F preview, Ops Control, the audit trail).
 *
 * Skipped unless ABSCONDER_E2E=1 on a local disposable database (see absconder-hold.e2e.test.ts).
 */
import { describe, expect, it, beforeAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import request from "supertest";

vi.unmock("../../../db/mysql.js");
// The readiness cross-check reads db_bill credits (LAN-only); here it is replaced by the people the test marks READY.
vi.mock("../bank-payment-readiness.service.js", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  buildBankReadinessReport: async () => ({
    verification_source: { available: true, month: null, confirmed_credits: 0 },
    rows: ((globalThis as { __ready?: string[] }).__ready ?? []).map((employee_id) => ({ employee_id, readiness_class: "READY" })),
  }),
}));

const LOCAL = ["127.0.0.1", "localhost"].includes(String(process.env.DB_HOST ?? "").toLowerCase());
const SAFE_DB = /(e2e|_test$|^test_)/i.test(String(process.env.DB_NAME ?? ""));
const ON = process.env.ABSCONDER_E2E === "1" && LOCAL && SAFE_DB;

const MONEY = ["paid_working_days", "eligible_weekoff_days", "eligible_holiday_days", "final_payable_days", "gross_salary", "gross_before_lwp",
  "basic", "hra", "pf_employee", "pf_employer", "esic_employee", "esic_employer", "professional_tax", "tds", "total_deductions", "net_salary",
  "advance_recovery", "loan_emi", "holiday_work_extra_payout"] as const;

describe.skipIf(!ON)("absconder hold: scenario matrix (real MySQL)", () => {
  let db: any, calc: any, rel: any, hold: any, ffc: any, ops: any, app: any;
  const B = { branch: randomUUID(), branch2: randomUUID(), process: randomUUID(), structure: randomUUID() };
  const U = { mgr: randomUUID(), pr: randomUUID(), pr2: randomUUID(), bh: randomUUID(), admin: randomUUID(), skip: randomUUID(), stranger: randomUUID() };
  const E = { mgr: randomUUID(), pr: randomUUID(), pr2: randomUUID(), skip: randomUUID() };
  const REASON = "salary withheld pending recovery of company property";
  const secret = process.env.JWT_SECRET || "change-me-jwt-secret-32characters!!";
  const tok = (sub: string, email: string) => ({ Authorization: `Bearer ${jwt.sign({ sub, email, iat: Math.floor(Date.now() / 1000) }, secret, { expiresIn: "1h" })}` });
  const sql = async (q: string, p: unknown[] = []) => (await db.execute(q, p))[0];
  let seq = 0;
  const code = (p: string) => `SC${p}${String(++seq).padStart(3, "0")}`;

  const setFlag = async (v: string) => {
    await sql(`DELETE FROM payroll_config_flags WHERE config_key = 'absconder_salary_hold_enabled'`);
    await sql(`INSERT INTO payroll_config_flags (id, config_key, config_value) VALUES (?, 'absconder_salary_hold_enabled', ?)`, [randomUUID(), v]);
  };
  async function emp(opts: { code: string; mgr?: string | null; status?: string; active?: number; branch?: string; user?: string | null; ctc?: number; bank?: boolean } ) {
    const id = randomUUID();
    await sql(`INSERT INTO employees (id, user_id, employee_code, first_name, date_of_joining, branch_id, process_id, reporting_manager_id, employment_status, active_status, official_email)
               VALUES (?, ?, ?, ?, '2026-01-01', ?, ?, ?, ?, ?, ?)`,
      [id, opts.user ?? null, opts.code, opts.code, opts.branch ?? B.branch, B.process, opts.mgr ?? null, opts.status ?? "active", opts.active ?? 1, `${opts.code.toLowerCase()}@example.test`]);
    await sql(`INSERT INTO employee_salary_assignment (id, employee_id, structure_id, ctc_annual, effective_from, active_status) VALUES (?, ?, ?, ?, '2026-01-01', 1)`,
      [randomUUID(), id, B.structure, opts.ctc ?? 240000]);
    if (opts.bank) {
      await sql(`INSERT INTO employee_bank_detail (id, employee_id, account_number, ifsc_code, bank_name, is_primary, active_status) VALUES (?, ?, ?, 'HDFC0001234', 'HDFC', 1, 1)`,
        [randomUUID(), id, String(10000000 + seq * 7919)]);
    }
    return id;
  }
  const att = async (empId: string, month: string, from: number, to: number, status = "present", lwp = 0) => {
    for (let d = from; d <= to; d++) {
      await sql(`INSERT INTO attendance_daily_record (id, employee_id, record_date, attendance_status, lwp_value) VALUES (?, ?, ?, ?, ?)`,
        [randomUUID(), empId, `${month}-${String(d).padStart(2, "0")}`, status, lwp]);
    }
  };
  const exit = async (empId: string, since: string, over: Record<string, unknown> = {}) => {
    const id = randomUUID();
    await sql(`INSERT INTO exit_request (id, employee_id, exit_type, exit_sub_type, status, absconding_since, last_working_day_proposed, last_working_day_confirmed, notice_period_days)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      [id, empId, over.exit_type ?? "involuntary", over.exit_sub_type ?? "absconding", over.status ?? "exited", since, since, since]);
    await sql(`UPDATE employees SET date_of_exit = ? WHERE id = ?`, [since, empId]);
    return id;
  };
  const run = async (month: string, status = "draft") => {
    const id = randomUUID();
    await sql(`INSERT INTO salary_prep_run (id, run_month, status) VALUES (?, ?, ?)`, [id, month, status]);
    return id;
  };
  const line = async (empId: string, runId: string) => (await sql(`SELECT * FROM salary_prep_line WHERE run_id = ? AND employee_id = ?`, [runId, empId]))[0];
  const money = (l: any) => {
    if (!l) throw new Error("no salary line exists for this person in this run (the scenario is not testing what it claims)");
    return Object.fromEntries(MONEY.map((k) => [k, Number(l[k] ?? 0)]));
  };
  const zeros = Object.fromEntries(MONEY.map((k) => [k, 0]));
  const R = { mgr: (id = U.mgr) => id };

  beforeAll(async () => {
    ({ db } = await import("../../../db/mysql.js"));
    calc = await import("../payrollCalculate.service.js");
    rel = await import("../absconder-pay-release.service.js");
    hold = await import("../absconder-hold.service.js");
    ffc = await import("../../exit/ff-compute.service.js");
    ops = await import("../../ops-control-tower/ops-control-tower.service.js");
    ({ app } = await import("../../../app.js"));

    await sql(`INSERT INTO branch_master (id, branch_code, branch_name) VALUES (?, 'SCB1', 'SC Branch 1'), (?, 'SCB2', 'SC Branch 2')`, [B.branch, B.branch2]);
    await sql(`INSERT INTO process_master (id, process_code, process_name) VALUES (?, 'SCP', 'SC Process')`, [B.process]);
    await sql(`INSERT INTO salary_structure_master (id, structure_code, structure_name, basic_pct, hra_pct) VALUES (?, 'SCS', 'SC', 40, 20)`, [B.structure]);
    for (const [k, u] of Object.entries(U)) await sql(`INSERT INTO auth_user (id, email, password_hash) VALUES (?, ?, 'x')`, [u, `${k === "mgr" ? "mgr" : k}@example.test`.replace("@", "-sc@")]);
    await sql(`INSERT IGNORE INTO workforce_role_catalog (role_key, role_name) VALUES ('payroll_hr','payroll_hr'),('branch_head','branch_head'),('super_admin','super_admin'),('payroll_head','payroll_head')`);
    E.mgr = await emp({ code: "SCMGR", user: U.mgr });
    E.pr = await emp({ code: "SCPR1", user: U.pr });
    E.pr2 = await emp({ code: "SCPR2", user: U.pr2, branch: B.branch2 });
    E.skip = await emp({ code: "SCSKIP", user: U.skip });
    await sql(`UPDATE employees SET reporting_manager_id = ? WHERE id = ?`, [E.skip, E.mgr]);       // the manager's own manager
    const bhEmp = await emp({ code: "SCBH", user: U.bh });
    await sql(`INSERT INTO user_roles (id, user_id, role_key, active_status) VALUES (?, ?, 'payroll_hr', 1), (?, ?, 'payroll_hr', 1), (?, ?, 'branch_head', 1), (?, ?, 'super_admin', 1)`,
      [randomUUID(), U.pr, randomUUID(), U.pr2, randomUUID(), U.bh, randomUUID(), U.admin]);
    void bhEmp;
    await setFlag("true");
  }, 90_000);

  // ── pre-hold line vs line during hold vs line after release (the whole money picture) ─────────────────
  it("S1 a mixed month (present, half days, leave, week-offs, holidays): hold zeroes every money field, release restores them EXACTLY", async () => {
    const m = "2027-01", runId = await run(m);
    const a = await emp({ code: code("MIX"), mgr: E.mgr, status: "absconded", active: 0 });
    await att(a, m, 1, 10); await att(a, m, 11, 12, "half_day", 0.5); await att(a, m, 13, 14, "leave_approved"); await att(a, m, 15, 16, "week_off"); await att(a, m, 17, 18, "holiday");
    const x = await exit(a, `${m}-18`);
    await calc.calculatePayrollRun(runId, "t");
    const before = money(await line(a, runId));
    expect(before.final_payable_days).toBeGreaterThan(10);
    expect(before.net_salary).toBeGreaterThan(0);
    await rel.requestHold({ exitRequestId: x, reason: REASON, actorUserId: U.mgr });
    await rel.approveHoldRequest({ exitRequestId: x, reason: REASON, actorUserId: U.pr });
    const held = await line(a, runId);
    expect(money(held)).toEqual(zeros);                              // every money field is 0
    expect(Number(held.present_days)).toBeGreaterThan(0);          // the attendance facts are kept
    await calc.calculatePayrollRun(runId, "nightly");
    expect(money(await line(a, runId))).toEqual(zeros);
    await rel.releaseHold({ exitRequestId: x, reason: REASON, actorUserId: U.pr });
    expect(money(await line(a, runId))).toEqual(before);            // identical to before the hold, field for field
  }, 120_000);

  it("S2 no attendance at all: hold and release work and do not error", async () => {
    const m = "2027-02", runId = await run(m);
    const a = await emp({ code: code("NOA"), mgr: E.mgr, status: "absconded", active: 0 });
    const x = await exit(a, `${m}-03`);
    await calc.calculatePayrollRun(runId, "t");
    await rel.placeHold({ exitRequestId: x, reason: REASON, actorUserId: U.pr });
    expect(money(await line(a, runId))).toEqual(zeros);
    const out = await rel.releaseHold({ exitRequestId: x, reason: REASON, actorUserId: U.pr });
    expect(out.route).toBe("payroll");
    expect(Number((await line(a, runId))?.final_payable_days ?? 0)).toBeGreaterThanOrEqual(0);
  }, 90_000);

  it("S3 several months: open months go to 0 and come back; a closed month is untouched", async () => {
    const jan = "2027-03", feb = "2027-04", mar = "2027-05";
    const rJan = await run(jan), rFeb = await run(feb), rMar = await run(mar);
    const a = await emp({ code: code("MUL"), mgr: E.mgr, status: "absconded", active: 0 });
    await att(a, jan, 1, 30); await att(a, feb, 1, 30); await att(a, mar, 1, 5);
    const x = await exit(a, `${mar}-05`);
    for (const r of [rJan, rFeb, rMar]) await calc.calculatePayrollRun(r, "t");
    const b = { jan: money(await line(a, rJan)), feb: money(await line(a, rFeb)), mar: money(await line(a, rMar)) };
    await sql(`UPDATE salary_prep_run SET status = 'finalized' WHERE id = ?`, [rJan]);          // the earliest month is already closed and paid
    await rel.placeHold({ exitRequestId: x, reason: REASON, actorUserId: U.pr });
    expect(money(await line(a, rJan))).toEqual(b.jan);       // closed month: untouched
    expect(money(await line(a, rFeb))).toEqual(zeros);
    expect(money(await line(a, rMar))).toEqual(zeros);
    await rel.releaseHold({ exitRequestId: x, reason: REASON, actorUserId: U.pr });
    expect(money(await line(a, rFeb))).toEqual(b.feb);
    expect(money(await line(a, rMar))).toEqual(b.mar);
    expect(money(await line(a, rJan))).toEqual(b.jan);
  }, 150_000);

  it("S4 two runs for the same month (the duplicate-run case): both go to 0 and both come back", async () => {
    const m = "2027-06", r1 = await run(m), r2 = await run(m);
    const a = await emp({ code: code("DUP"), mgr: E.mgr, status: "absconded", active: 0 });
    await att(a, m, 1, 8);
    const x = await exit(a, `${m}-08`);
    await calc.calculatePayrollRun(r1, "t"); await calc.calculatePayrollRun(r2, "t");
    const b1 = money(await line(a, r1)), b2 = money(await line(a, r2));
    await rel.placeHold({ exitRequestId: x, reason: REASON, actorUserId: U.pr });
    expect(money(await line(a, r1))).toEqual(zeros); expect(money(await line(a, r2))).toEqual(zeros);
    await rel.releaseHold({ exitRequestId: x, reason: REASON, actorUserId: U.pr });
    expect(money(await line(a, r1))).toEqual(b1); expect(money(await line(a, r2))).toEqual(b2);
  }, 120_000);

  it("S5 the exit is revoked while held: the person is paid again automatically", async () => {
    const m = "2027-07", runId = await run(m);
    const a = await emp({ code: code("REV"), mgr: E.mgr, status: "absconded", active: 0 });
    await att(a, m, 1, 6);
    const x = await exit(a, `${m}-06`);
    await calc.calculatePayrollRun(runId, "t");
    const before = money(await line(a, runId));
    await rel.placeHold({ exitRequestId: x, reason: REASON, actorUserId: U.pr });
    expect(await hold.isAbsconderPayHeld(a)).toBe(true);
    await sql(`UPDATE exit_request SET status = 'revoked' WHERE id = ?`, [x]);
    expect(await hold.isAbsconderPayHeld(a)).toBe(false);
    await calc.calculatePayrollRun(runId, "nightly");
    expect(money(await line(a, runId))).toEqual(before);
  }, 90_000);

  it("S6 a NEWER non-absconding exit replaces the old one: no hold", async () => {
    const m = "2027-08", runId = await run(m);
    const a = await emp({ code: code("TWO"), mgr: E.mgr, status: "absconded", active: 0 });
    await att(a, m, 1, 6);
    const x = await exit(a, `${m}-06`);
    await calc.calculatePayrollRun(runId, "t");
    await rel.placeHold({ exitRequestId: x, reason: REASON, actorUserId: U.pr });
    await new Promise((r) => setTimeout(r, 1100));
    await sql(`INSERT INTO exit_request (id, employee_id, exit_type, exit_sub_type, status, last_working_day_proposed, last_working_day_confirmed, notice_period_days)
               VALUES (?, ?, 'voluntary', 'resignation', 'exited', ?, ?, 0)`, [randomUUID(), a, `${m}-06`, `${m}-06`]);
    expect(await hold.isAbsconderPayHeld(a)).toBe(false);
  }, 60_000);

  it("S7 a manually locked line is never rewritten by the hold; the bank file still stops it (see S16)", async () => {
    const m = "2027-09", runId = await run(m);
    const a = await emp({ code: code("LCK"), mgr: E.mgr, status: "absconded", active: 0 });
    await att(a, m, 1, 6);
    const x = await exit(a, `${m}-06`);
    await calc.calculatePayrollRun(runId, "t");
    const before = money(await line(a, runId));
    await sql(`UPDATE salary_prep_line SET manual_override_locked = 1 WHERE run_id = ? AND employee_id = ?`, [runId, a]);
    await rel.placeHold({ exitRequestId: x, reason: REASON, actorUserId: U.pr });
    expect(money(await line(a, runId))).toEqual(before);          // the calculator leaves locked rows alone, by design
    expect(await hold.isAbsconderPayHeld(a)).toBe(true);           // so the exports are what stop the money
  }, 90_000);

  it("S8 advances: a held line recovers nothing; the advance is recovered once, after release", async () => {
    const m = "2027-10", runId = await run(m);
    const a = await emp({ code: code("ADV"), mgr: E.mgr, status: "absconded", active: 0 });
    await att(a, m, 1, 20);
    const x = await exit(a, `${m}-20`);
    await sql(`INSERT INTO salary_advance_log (id, employee_id, advance_date, amount, recovery_months, recovered_amount, status) VALUES (?, ?, '2026-01-15', 1200, 4, 0, 'active')`, [randomUUID(), a]);
    await rel.placeHold({ exitRequestId: x, reason: REASON, actorUserId: U.pr });
    await calc.calculatePayrollRun(runId, "t");
    await calc.calculatePayrollRun(runId, "t");
    const adv = async () => Number((await sql(`SELECT recovered_amount FROM salary_advance_log WHERE employee_id = ?`, [a]))[0].recovered_amount);
    expect(await adv()).toBe(0);                                  // nothing recovered while held, however often it recalculates
    expect(Number((await line(a, runId)).advance_recovery)).toBe(0);
    await rel.releaseHold({ exitRequestId: x, reason: REASON, actorUserId: U.pr });
    expect(await adv()).toBe(300);                                // recovered once after release
  }, 120_000);

  it("S9 hold, release, hold again, release again: ends released with the days restored", async () => {
    const m = "2027-11", runId = await run(m);
    const a = await emp({ code: code("RPT"), mgr: E.mgr, status: "absconded", active: 0 });
    await att(a, m, 1, 9);
    const x = await exit(a, `${m}-09`);
    await calc.calculatePayrollRun(runId, "t");
    const before = money(await line(a, runId));
    await rel.placeHold({ exitRequestId: x, reason: REASON, actorUserId: U.pr });
    await rel.releaseHold({ exitRequestId: x, reason: REASON, actorUserId: U.pr });
    await rel.requestHold({ exitRequestId: x, reason: "new facts: a second laptop is missing", actorUserId: U.mgr });
    await rel.approveHoldRequest({ exitRequestId: x, reason: REASON, actorUserId: U.pr });
    expect(money(await line(a, runId))).toEqual(zeros);
    expect((await rel.getHoldState(x)).state).toBe("held");
    await rel.releaseHold({ exitRequestId: x, reason: REASON, actorUserId: U.pr });
    expect(money(await line(a, runId))).toEqual(before);
    expect((await rel.getHoldState(x)).state).toBe("released");
  }, 120_000);

  it("S10 switching the feature off while held pays the person again; switching on holds again", async () => {
    const m = "2025-12";                                          // earlier than DOJ would not apply; use a fresh month below
    const mm = "2027-12", runId = await run(mm);
    const a = await emp({ code: code("KIL"), mgr: E.mgr, status: "absconded", active: 0 });
    await att(a, mm, 1, 7);
    const x = await exit(a, `${mm}-07`);
    await calc.calculatePayrollRun(runId, "t");
    const before = money(await line(a, runId));
    await rel.placeHold({ exitRequestId: x, reason: REASON, actorUserId: U.pr });
    expect(money(await line(a, runId))).toEqual(zeros);
    await setFlag("false");
    await calc.calculatePayrollRun(runId, "t");
    expect(money(await line(a, runId))).toEqual(before);
    await setFlag("true");
    await calc.calculatePayrollRun(runId, "t");
    expect(money(await line(a, runId))).toEqual(zeros);
    void m;
  }, 120_000);

  // ── inputs that change while a hold is on ───────────────────────────────────────────────────────────────
  it("S11 INPUT: new attendance rows and a salary revision arrive while held; the line stays 0, and release uses the NEW data", async () => {
    const m = "2025-11";
    const mm = "2028-01", runId = await run(mm);
    const a = await emp({ code: code("INP"), mgr: E.mgr, status: "absconded", active: 0, ctc: 240000 });
    await att(a, mm, 1, 5);
    const x = await exit(a, `${mm}-10`);
    await calc.calculatePayrollRun(runId, "t");
    const first = money(await line(a, runId));
    await rel.placeHold({ exitRequestId: x, reason: REASON, actorUserId: U.pr });
    await att(a, mm, 6, 10);                                                        // an attendance upload lands while held
    await sql(`UPDATE employee_salary_assignment SET ctc_annual = 360000 WHERE employee_id = ?`, [a]);   // and a revision
    await calc.calculatePayrollRun(runId, "nightly");
    expect(money(await line(a, runId))).toEqual(zeros);
    await rel.releaseHold({ exitRequestId: x, reason: REASON, actorUserId: U.pr });
    const after = money(await line(a, runId));
    expect(after.final_payable_days).toBeGreaterThan(first.final_payable_days);   // 10 days, not 5
    expect(after.gross_salary).toBeGreaterThan(first.gross_salary);
    void m;
  }, 120_000);

  // ── who may do what ─────────────────────────────────────────────────────────────────────────────────────
  it("S12 a Payroll HR of ANOTHER branch, the manager's manager and a stranger cannot act", async () => {
    const m = "2028-02", runId = await run(m);
    const a = await emp({ code: code("ACL"), mgr: E.mgr, status: "absconded", active: 0 });
    await att(a, m, 1, 4);
    const x = await exit(a, `${m}-04`);
    await calc.calculatePayrollRun(runId, "t");
    for (const who of [U.pr2, U.skip, U.stranger, U.bh, U.admin]) {
      await expect(rel.requestHold({ exitRequestId: x, reason: REASON, actorUserId: who })).rejects.toMatchObject({ code: "HOLD_NOT_YOUR_CALL" });
      await expect(rel.placeHold({ exitRequestId: x, reason: REASON, actorUserId: who })).rejects.toMatchObject({ code: "HOLD_NOT_YOUR_CALL" });
    }
    expect(await hold.isAbsconderPayHeld(a)).toBe(false);
  }, 90_000);

  it("S13 two Payroll HR clicks at the same instant: exactly one wins", async () => {
    const m = "2028-03", runId = await run(m);
    const a = await emp({ code: code("RAC"), mgr: E.mgr, status: "absconded", active: 0 });
    await att(a, m, 1, 4);
    const x = await exit(a, `${m}-04`);
    await calc.calculatePayrollRun(runId, "t");
    await rel.requestHold({ exitRequestId: x, reason: REASON, actorUserId: U.mgr });
    const res = await Promise.allSettled([
      rel.approveHoldRequest({ exitRequestId: x, reason: REASON, actorUserId: U.pr }),
      rel.approveHoldRequest({ exitRequestId: x, reason: REASON, actorUserId: U.pr }),
    ]);
    expect(res.filter((r) => r.status === "fulfilled").length).toBeGreaterThanOrEqual(1);
    const ev = await sql(`SELECT action FROM absconder_pay_release_event WHERE exit_request_id = ? AND action = 'hold_placed'`, [x]);
    expect(ev.length).toBe(1);                                                      // never two placements
    expect(await hold.isAbsconderPayHeld(a)).toBe(true);
  }, 90_000);

  // ── OUTPUT FILES: the bank files, downloaded over HTTP ──────────────────────────────────────────────────
  it("S16 OUTPUT FILE: a hold placed AFTER the month closed is stopped in the NEFT file and listed by name", async () => {
    const m = "2028-04", runId = await run(m);
    const ok = await emp({ code: code("NEFTOK"), mgr: E.mgr, bank: true });
    const held = await emp({ code: code("NEFTHELD"), mgr: E.mgr, status: "absconded", active: 0, bank: true });
    const ok2 = await emp({ code: code("NEFTOK2"), mgr: E.mgr, bank: true });
    for (const e of [ok, ok2]) await att(e, m, 1, 30);
    await att(held, m, 1, 6);
    const x = await exit(held, `${m}-06`);
    await calc.calculatePayrollRun(runId, "t");
    expect(Number((await line(held, runId)).net_salary)).toBeGreaterThan(0);
    await sql(`UPDATE salary_prep_run SET status = 'finalized', validation_status = 'validated' WHERE id = ?`, [runId]);   // closed: payable, not yet paid
    await rel.placeHold({ exitRequestId: x, reason: REASON, actorUserId: U.pr });
    expect(Number((await line(held, runId)).net_salary)).toBeGreaterThan(0);                        // a closed month cannot be recalculated...
    const heldCode = (await sql(`SELECT employee_code FROM employees WHERE id = ?`, [held]))[0].employee_code;
    const okCodes = [ok, ok2].map(async (id) => (await sql(`SELECT employee_code FROM employees WHERE id = ?`, [id]))[0].employee_code);
    (globalThis as { __ready?: string[] }).__ready = [ok, ok2];
    const res = await request(app).get(`/api/payroll/runs/${runId}/neft-export`).set(tok(U.admin, "admin-sc@example.test"));
    expect(res.status).toBe(200);
    const csv: string = res.text;
    const rows = csv.split(/\r?\n/);
    const payment = rows.filter((r) => /^\d+,/.test(r));
    expect(payment.some((r) => r.includes(heldCode))).toBe(false);                                // ...so the file is what stops it
    for (const c of await Promise.all(okCodes)) expect(payment.some((r) => r.includes(c))).toBe(true);
    const total = rows.find((r) => r.startsWith("TOTAL,"))!;
    const sum = payment.reduce((n, r) => n + Number(r.split(",")[6]), 0);
    expect(Number(total.split(",")[6])).toBeCloseTo(sum, 2);                                       // the declared total excludes the held amount
    const after = csv.slice(csv.indexOf("TOTAL,"));
    expect(after).toContain(heldCode);                                                              // and the person is reported, not silently dropped
    expect(/HELD|ABSCONDER_PAY_HELD/.test(after)).toBe(true);
    // the same file by month
    const byMonth = await request(app).get(`/api/payroll/month/${m}/neft-export`).set(tok(U.admin, "admin-sc@example.test"));
    expect(byMonth.status).toBe(200);
    expect(byMonth.text.split(/\r?\n/).filter((r) => /^\d+,/.test(r)).some((r) => r.includes(heldCode))).toBe(false);
    // released: the held person is payable again (their line is still positive in the closed run) and is in the file
    await rel.releaseHold({ exitRequestId: x, reason: REASON, actorUserId: U.pr });
    (globalThis as { __ready?: string[] }).__ready = [ok, ok2, held];
    const rel2 = await request(app).get(`/api/payroll/runs/${runId}/neft-export`).set(tok(U.admin, "admin-sc@example.test"));
    expect(rel2.status).toBe(200);
    expect(rel2.text.split(/\r?\n/).filter((r) => /^\d+,/.test(r)).some((r) => r.includes(heldCode))).toBe(true);
  }, 150_000);

  // ── F&F outputs ─────────────────────────────────────────────────────────────────────────────────────────
  it("S17 OUTPUT: the F&F final-month figure follows the hold (held -> payroll after release; closed run -> F&F with an estimate)", async () => {
    const m = "2028-05", runId = await run(m);
    const a = await emp({ code: code("FNF"), mgr: E.mgr, status: "absconded", active: 0 });
    await att(a, m, 1, 8);
    const x = await exit(a, `${m}-08`);
    await calc.calculatePayrollRun(runId, "t");
    await rel.placeHold({ exitRequestId: x, reason: REASON, actorUserId: U.pr });
    let p = await ffc.computeFfPreview(x);
    expect(p.final_month_salary).toMatchObject({ paid_via: "held", paid_days: 0, net_salary: 0 });
    expect(p.attendance_check.present_days).toBe(8);
    await sql(`UPDATE salary_prep_run SET status = 'finalized' WHERE id = ?`, [runId]);
    await rel.releaseHold({ exitRequestId: x, reason: REASON, actorUserId: U.pr });
    p = await ffc.computeFfPreview(x);
    expect(p.final_month_salary.paid_via).toBe("fnf_manual");
    const est = Number(p.final_month_salary.suggested_amount);
    expect(est).toBeGreaterThan(0);
    expect(est).toBeCloseTo((20000 / 31) * 8, 0);                                                  // 8 days of a 20,000 month
  }, 120_000);

  // ── Ops Control ─────────────────────────────────────────────────────────────────────────────────────────
  it("S18 OUTPUT: Ops Control counts a pending request, then stops counting it once decided", async () => {
    const m = "2028-06", runId = await run(m);
    const a = await emp({ code: code("OPS"), mgr: E.mgr, status: "absconded", active: 0 });
    await att(a, m, 1, 4);
    const x = await exit(a, `${m}-04`);
    await calc.calculatePayrollRun(runId, "t");
    const count = async () => (await ops.getAbsconderHoldPendingBlock()).branches.find((b: any) => b.branchId === B.branch)?.count ?? 0;
    const base = await count();
    await rel.requestHold({ exitRequestId: x, reason: REASON, actorUserId: U.mgr });
    expect(await count()).toBe(base + 1);
    const detail = await ops.getAbsconderHoldPendingDetail(B.branch);
    expect(detail.some((d: any) => d.employeeId === a)).toBe(true);
    await rel.approveHoldRequest({ exitRequestId: x, reason: REASON, actorUserId: U.pr });
    expect(await count()).toBe(base);
  }, 90_000);
});
