import { describe, expect, it } from "vitest";
import {
  peopleCostExprs,
  peopleCostExprsForColumns,
  peopleCostSql,
  peopleCostSqlForColumns,
} from "../pnl-people-cost.js";

/**
 * The one People Cost definition (owner rule 2026-09-24):
 *   CTC paid − (other_deductions + loan_emi + advance_recovery) − lwp_deduction
 * Employee-side statutory deductions are NOT subtracted. The SQL is evaluated for real against an
 * in-memory SQLite database (node:sqlite) when available; the string-level checks always run.
 */

type Sqlite = { exec(sql: string): void; prepare(sql: string): { all(...p: unknown[]): unknown[] } };
let sqlite: Sqlite | null = null;
try {
  const mod = await import("node:sqlite" as string);
  sqlite = new mod.DatabaseSync(":memory:") as Sqlite;
} catch {
  sqlite = null;
}

const ALL_COLUMNS = new Set([
  "gross_salary", "pf_employer", "esic_employer", "gratuity",
  "other_deductions", "loan_emi", "advance_recovery", "lwp_deduction",
]);

function evalLine(expr: string): number {
  const row = sqlite!.prepare(`SELECT ${expr} AS v FROM salary_prep_line l`).all()[0] as { v: number };
  return Number(row.v);
}

describe("peopleCostSql — string level", () => {
  it("subtracts other, loan EMI, advance and LWP; never employee-side statutory", () => {
    const sql = peopleCostSql("l");
    for (const c of ["gross_salary", "pf_employer", "esic_employer", "gratuity",
      "other_deductions", "loan_emi", "advance_recovery", "lwp_deduction"]) {
      expect(sql).toContain(`COALESCE(l.${c}, 0)`);
    }
    for (const c of ["pf_employee", "esic_employee", "professional_tax", "tds"]) {
      expect(sql).not.toContain(c);
    }
  });

  it("column-aware variant equals the static one when every column exists", () => {
    expect(peopleCostSqlForColumns("l", ALL_COLUMNS)).toBe(peopleCostSql("l"));
  });

  it("column-aware variant drops missing columns to 0 and keeps the basic × 4.81% gratuity fallback", () => {
    const exprs = peopleCostExprsForColumns("spl", new Set(["gross_salary", "basic", "loan_emi"]));
    expect(exprs.pfEmployer).toBe("0");
    expect(exprs.esicEmployer).toBe("0");
    expect(exprs.gratuity).toBe("COALESCE(spl.basic, 0) * 0.0481");
    expect(exprs.otherDeduction).toBe("(COALESCE(spl.loan_emi, 0))");
    expect(exprs.leaveDeduction).toBe("0");
    expect(exprs.peopleCost).not.toContain("other_deductions");
    expect(exprs.peopleCost).not.toContain("lwp_deduction");
  });
});

describe.skipIf(!sqlite)("peopleCostSql — evaluated", () => {
  it("gross 96,626 with a 20,000 loan EMI yields 76,626 + employer statutory", () => {
    sqlite!.exec(`
      DROP TABLE IF EXISTS salary_prep_line;
      CREATE TABLE salary_prep_line (gross_salary REAL, pf_employer REAL, esic_employer REAL, gratuity REAL,
        other_deductions REAL, loan_emi REAL, advance_recovery REAL, lwp_deduction REAL,
        pf_employee REAL, professional_tax REAL, tds REAL);
      INSERT INTO salary_prep_line VALUES (96626, 1800, 0, 4648, 0, 20000, 0, 0, 1800, 200, 500);
    `);
    const e = peopleCostExprs("l");
    expect(evalLine(e.ctcPaid)).toBe(96626 + 1800 + 4648);
    expect(evalLine(e.otherDeduction)).toBe(20000);
    expect(evalLine(peopleCostSql("l"))).toBe(76626 + 1800 + 4648);
  });

  it("NULLs contribute 0 and every deduction bucket is subtracted", () => {
    sqlite!.exec(`
      DELETE FROM salary_prep_line;
      INSERT INTO salary_prep_line VALUES (50000, NULL, 750, NULL, 1000, NULL, 500, 250, NULL, NULL, NULL);
    `);
    expect(evalLine(peopleCostSql("l"))).toBe(50000 + 750 - 1000 - 500 - 250);
  });
});
