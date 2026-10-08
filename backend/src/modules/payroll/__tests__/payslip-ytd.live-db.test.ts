// Opt-in (E2E_DB=1) real-MySQL check of the payslip YTD: legacy snapshot months, salary-line-only months,
// component months, and the self-service /payslip/my/ytd route. See onboarding-link-email.live-db.test.ts
// for how to build the throwaway schema (migration replay) — plus migrations/407_legacy_payslip_snapshot.sql.
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";

const RUN = process.env.E2E_DB === "1";
vi.mock("../../../db/mysql.js", async () => await vi.importActual("../../../db/mysql.js"));
const h = vi.hoisted(() => ({ userId: "u-self", empId: "" }));
vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: any, _r: unknown, next: () => void) => { req.authUser = { id: h.userId }; next(); },
  requireWriteAccess: (_q: unknown, _r: unknown, next: () => void) => next(),
}));
vi.mock("../../../middleware/requireRole.js", () => ({ requireRole: () => (_q: unknown, _r: unknown, next: () => void) => next() }));

describe.skipIf(!RUN)("Payslip YTD — real MySQL", () => {
  let db: any; let payslipService: any; let app: express.Express;
  const emp = randomUUID(); const code = `Y${Math.floor(Math.random() * 1e8)}`;
  const runs: string[] = []; const created: string[] = [];

  const mkRun = async (month: string, status: string) => {
    const id = randomUUID();
    await db.execute("INSERT INTO salary_prep_run (id, run_month, status, branch_filter, process_filter) VALUES (?,?,?,?,?)", [id, month, status, `b-${id}`, `p-${id}`]);
    runs.push(id); return id;
  };
  const mkLine = async (runId: string, o: Record<string, number>) => {
    const id = randomUUID();
    await db.execute(
      "INSERT INTO salary_prep_line (id, run_id, employee_id, employee_code, gross_salary, total_deductions, net_salary, basic, hra, special_allowance, pf_employee, status) VALUES (?,?,?,?,?,?,?,?,?,?,?, 'calculated')",
      [id, runId, emp, code, o.gross, o.ded ?? 0, o.net ?? 0, o.basic, o.hra, o.special ?? 0, o.pf ?? 0]);
    return id;
  };

  beforeAll(async () => {
    ({ db } = await import("../../../db/mysql.js"));
    ({ payslipService } = await import("../payslip.service.js"));
    await db.execute("INSERT INTO employees (id, employee_code, first_name, last_name, date_of_joining) VALUES (?,?,?,?,CURDATE())", [emp, code, "Y", "T"]);
    h.empId = emp;
    // Apr + May 2026: legacy snapshots only (no run at all) — the "no run_id" payslips
    for (const [m, basic] of [["2026-04", 10000], ["2026-05", 10000]] as const) {
      await db.execute(
        "INSERT INTO legacy_payslip_snapshot (employee_code, employee_id, sal_date, pay_month, basic, hra, epf_employee, income_tax, special_allowance, gross_salary, net_salary) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        [code, emp, `${m}-28`, m, basic, 4000, 1200, 300, 1000, 15000, 13500]);
    }
    // Jun 2026: a finalized run with only a salary line (no component rows)
    const jun = await mkRun("2026-06", "finalized");
    await mkLine(jun, { gross: 15000, basic: 9000, hra: 3600, special: 2400, pf: 1080 });
    // Jul 2026: a finalized run WITH component rows
    const jul = await mkRun("2026-07", "finalized");
    const julLine = await mkLine(jul, { gross: 16000, basic: 9600, hra: 3840, special: 2560, pf: 1152 });
    for (const [codeC, type, amt] of [["BASIC", "earning", 9600], ["HRA", "earning", 3840], ["SPECIAL", "earning", 2560], ["PF_EMPLOYEE", "deduction", 1152]] as const) {
      await db.execute("INSERT INTO salary_prep_line_component (id, run_id, line_id, employee_id, component_code, component_name, component_type, amount, source, taxable) VALUES (UUID(),?,?,?,?,?,?,?,'auto',0)", [jul, julLine, emp, codeC, codeC, type, amt]);
    }
    // Overlap: a legacy snapshot for July as well — must be ignored (the run owns that month)
    await db.execute("INSERT INTO legacy_payslip_snapshot (employee_code, employee_id, sal_date, pay_month, basic, hra, epf_employee) VALUES (?,?,?,?,?,?,?)", [code, emp, "2026-07-31", "2026-07", 77777, 77777, 77777]);
    // A draft run in Aug: not counted (not settled)
    const aug = await mkRun("2026-08", "draft");
    await mkLine(aug, { gross: 99999, basic: 99999, hra: 0 });

    const { default: router } = await import("../payroll.routes.js").then((m: any) => ({ default: m.default ?? m.payrollRouter ?? m.router }));
    app = express(); app.use(express.json()); app.use("/api/payroll", router);
  });

  afterAll(async () => {
    await db?.execute("DELETE FROM salary_prep_line_component WHERE employee_id = ?", [emp]).catch(() => undefined);
    await db?.execute("DELETE FROM salary_prep_line WHERE employee_id = ?", [emp]).catch(() => undefined);
    for (const r of runs) await db?.execute("DELETE FROM salary_prep_run WHERE id = ?", [r]).catch(() => undefined);
    await db?.execute("DELETE FROM legacy_payslip_snapshot WHERE employee_id = ?", [emp]).catch(() => undefined);
    await db?.execute("DELETE FROM employees WHERE id = ?", [emp]).catch(() => undefined);
    await db?.end?.().catch?.(() => undefined);
  });

  it("legacy month (Apr): YTD is that month only", async () => {
    const out = await payslipService.getYtdForEmployee(emp, "2026-04");
    expect(out.ytd.BASIC).toBe(10000);
    expect(out.ytd.PF_EMPLOYEE).toBe(1200);
    expect(out.ytd.TDS).toBe(300);
  });

  it("legacy month (May): Apr + May", async () => {
    const out = await payslipService.getYtdForEmployee(emp, "2026-05");
    expect(out.ytd.BASIC).toBe(20000);
    expect(out.ytd.HRA).toBe(8000);
    expect(out.ytd_by_type.earning.SPECIAL).toBe(2000);
  });

  it("salary-line-only run (Jun): legacy Apr+May + Jun line", async () => {
    const out = await payslipService.getYtdForEmployee(emp, "2026-06");
    expect(out.ytd.BASIC).toBe(10000 + 10000 + 9000);
    expect(out.ytd.PF_EMPLOYEE).toBe(1200 + 1200 + 1080);
  });

  it("component run (Jul): components for Jul, line for Jun, snapshots for Apr/May; overlapping July snapshot ignored", async () => {
    const out = await payslipService.getYtdForEmployee(emp, "2026-07");
    expect(out.ytd.BASIC).toBe(10000 + 10000 + 9000 + 9600);
    expect(out.ytd.HRA).toBe(4000 + 4000 + 3600 + 3840);
    expect(out.ytd.PF_EMPLOYEE).toBe(1200 + 1200 + 1080 + 1152);
  });

  it("an unsettled (draft) later run does not leak into earlier slips", async () => {
    const out = await payslipService.getYtdForEmployee(emp, "2026-07");
    expect(JSON.stringify(out)).not.toContain("99999");
  });

  it("self-service route returns the same YTD for a legacy month (the case that had no run_id)", async () => {
    // getEmployeeForUser resolves the session user -> employee; stub that user mapping in the DB
    await db.execute("UPDATE employees SET user_id = ? WHERE id = ?", [h.userId, emp]).catch(() => undefined);
    const res = await request(app).get("/api/payroll/payslip/my/ytd?month=2026-05");
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.ytd.BASIC).toBe(20000);
    expect((await request(app).get("/api/payroll/payslip/my/ytd?month=bad")).status).toBe(400);
  });
});
