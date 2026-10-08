/**
 * Runs the real resolveAppointmentLetterSalary() SQL against a throwaway MySQL.
 * Skipped unless LETTER_SANDBOX_PORT points at a sandbox holding the four
 * tables (employees, employee_payroll_head_review, salary_package_master,
 * salary_component_assignments) in a database named `lettertest`.
 */
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const port = Number(process.env.LETTER_SANDBOX_PORT ?? 0);
const pool = vi.hoisted(() => ({ current: null as unknown }));

vi.mock("../../../db/mysql.js", () => ({
  db: {
    execute: (sql: string, params?: unknown[]) =>
      (pool.current as mysql.Pool).execute(sql, params),
  },
}));

describe.skipIf(!port)("appointment letter: revised package (real MySQL)", () => {
  beforeAll(() => {
    pool.current = mysql.createPool({
      host: "127.0.0.1",
      port,
      user: "root",
      database: "lettertest",
    });
  });
  afterAll(async () => {
    await (pool.current as mysql.Pool).end();
  });

  const ctcFor = async (employeeId: string): Promise<number> => {
    const { resolveAppointmentLetterSalary } = await import(
      "../appointmentLetterData.service.js"
    );
    const salary = await resolveAppointmentLetterSalary(employeeId);
    return salary.ctc;
  };

  it("uses the revised package when it took effect before joining", async () => {
    expect(await ctcFor("E_BEFORE")).toBe(25125);
  });

  it("uses the revised package when it took effect after joining but is already in effect", async () => {
    expect(await ctcFor("E_AFTER")).toBe(25125);
  });

  it("keeps the approved package when the revision is future-dated", async () => {
    expect(await ctcFor("E_FUTURE")).toBe(15006);
  });

  it("keeps the approved package when there is no revision", async () => {
    expect(await ctcFor("E_NONE")).toBe(15006);
  });

  it("ignores a revision assigned before the Payroll Head approved", async () => {
    expect(await ctcFor("E_PRIORREV")).toBe(15006);
  });
});
