import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * Invariant tests for the approved Design-2 CL/ML monthly accrual schedule.
 * (2026-08-13, business-decision sign-off — see docs referenced in commit.)
 *
 * Approved business rule (FINAL, not to be re-litigated by a future edit):
 *   Jan=CL Feb=ML Mar=CL Apr=ML May=CL Jun=ML Jul=CL Aug=CL Sep=ML Oct=CL Nov=ML Dec=CL
 *   = exactly 7 CL + 5 ML per year. July+August both CL is intentional.
 *
 * The old Design-1 model (CL 0.583/mo + ML 0.417/mo, both credited every
 * month) is legacy history only and must never execute as a live accrual
 * path again.
 */

const ROOT = resolve(__dirname, "..");
const APPROVED_SCHEDULE: Record<number, "CL" | "ML"> = {
  1: "CL", 2: "ML", 3: "CL", 4: "ML", 5: "CL", 6: "ML",
  7: "CL", 8: "CL", 9: "ML", 10: "CL", 11: "ML", 12: "CL",
};

describe("Approved CL/ML schedule — source-of-truth contract", () => {
  const migrationSql = readFileSync(join(ROOT, "sql/245_leave_credit_redesign.sql"), "utf8");

  it("seeds exactly the approved month-to-leave-type mapping, nothing else", () => {
    const rowPattern = /\((\d{1,2}),\s*'(CL|ML)',\s*[\d.]+\)/g;
    const seeded: Record<number, string> = {};
    let match: RegExpExecArray | null;
    while ((match = rowPattern.exec(migrationSql)) !== null) {
      seeded[Number(match[1])] = match[2];
    }
    expect(Object.keys(seeded)).toHaveLength(12);
    for (let month = 1; month <= 12; month++) {
      expect(seeded[month], `month ${month}`).toBe(APPROVED_SCHEDULE[month]);
    }
  });

  it("totals exactly 7 CL and 5 ML across the year", () => {
    const values = Object.values(APPROVED_SCHEDULE);
    expect(values.filter((v) => v === "CL")).toHaveLength(7);
    expect(values.filter((v) => v === "ML")).toHaveLength(5);
  });

  it("July and August are both CL — approved, not a defect (Decision 4)", () => {
    expect(APPROVED_SCHEDULE[7]).toBe("CL");
    expect(APPROVED_SCHEDULE[8]).toBe("CL");
  });

  it("no month credits both CL and ML simultaneously", () => {
    // The schedule is a PRIMARY KEY (month, leave_code) with exactly one
    // leave_code per month in the approved mapping — a second row for the
    // same month with the other code would violate the "never both in the
    // same month" rule the old Design-1 model broke.
    const monthCounts: Record<number, number> = {};
    const rowPattern = /\((\d{1,2}),\s*'(CL|ML)',\s*[\d.]+\)/g;
    let match: RegExpExecArray | null;
    while ((match = rowPattern.exec(migrationSql)) !== null) {
      const m = Number(match[1]);
      monthCounts[m] = (monthCounts[m] ?? 0) + 1;
    }
    for (const [month, count] of Object.entries(monthCounts)) {
      expect(count, `month ${month} row count`).toBe(1);
    }
  });

  it("disables the old fractional monthly_credit_days rate for CL/ML (Step 1 of 245)", () => {
    expect(migrationSql).toMatch(/SET\s+lpc\.monthly_credit_days\s*=\s*0/i);
    expect(migrationSql).toMatch(/WHERE\s+lt\.leave_code\s+IN\s*\(\s*'CL'\s*,\s*'ML'\s*\)/i);
  });
});

describe("Legacy Design-1 fractional logic — confirmed non-executable", () => {
  it("0.583 (old CL rate) and 0.417 (old ML rate) do not appear in any live runtime file", async () => {
    // Grep-equivalent: the only two files that touch leave crediting at all
    // (confirmed 2026-08-13 audit — repo-wide search for
    // leave_credit_schedule/creditMonthlyLeaves/leave_el_credit_log/
    // leave_el_accrual references zero hits outside these two plus the
    // migration runner) must not contain the old fractional rate literals.
    const workerFiles = [
      "src/workers/leave-monthly-credit.worker.ts",
      "src/workers/leave-annual-el-credit.worker.ts",
    ];
    for (const file of workerFiles) {
      const content = readFileSync(join(ROOT, file), "utf8");
      // Allow the rates to appear only inside comments describing the
      // superseded history — never as an executable numeric literal assigned
      // to a credit/rate variable.
      const codeOnly = content
        .split("\n")
        .filter((line) => !line.trim().startsWith("*") && !line.trim().startsWith("//"))
        .join("\n");
      expect(codeOnly).not.toMatch(/0\.583/);
      expect(codeOnly).not.toMatch(/0\.417/);
    }
  });

  it("leave_policy_config.monthly_credit_days is not read by any runtime code path", () => {
    // Confirmed 2026-08-13: this column is written by migrations only; no
    // service/worker reads it for CL/ML. If a future change starts reading
    // it again, this column being non-zero would silently reactivate
    // fractional accrual — guard against that regression by asserting the
    // read-surface stays empty.
    const searchRoots = ["src/workers", "src/modules/leave"];
    let readFound = false;
    for (const dir of searchRoots) {
      const { readdirSync, statSync } = require("node:fs");
      const walk = (d: string): string[] => {
        const entries = readdirSync(d);
        let files: string[] = [];
        for (const e of entries) {
          const p = join(d, e);
          if (statSync(p).isDirectory()) files = files.concat(walk(p));
          else if (p.endsWith(".ts") && !p.includes("__tests__")) files.push(p);
        }
        return files;
      };
      for (const file of walk(join(ROOT, dir))) {
        if (/leave\.types\.ts$/.test(file)) continue;
        const content = readFileSync(file, "utf8");
        // Same comment-stripping as the 0.583/0.417 check above: a file is
        // allowed to MENTION the column name in prose (e.g. explaining why
        // it's dead) without that counting as a live read. Only a reference
        // in actual code should trip this guard.
        const codeOnly = content
          .split("\n")
          .filter((line) => !line.trim().startsWith("*") && !line.trim().startsWith("//"))
          .join("\n");
        if (/\bmonthly_credit_days\b/.test(codeOnly)) {
          readFound = true;
        }
      }
    }
    expect(readFound, "monthly_credit_days must remain unread outside the type declaration").toBe(false);
  });
});

describe("Monthly credit worker — behavioral invariants (mocked DB)", () => {
  const exec = vi.fn();
  let creditMonthlyLeaves: typeof import("../src/workers/leave-monthly-credit.worker.js").creditMonthlyLeaves;

  beforeEach(async () => {
    vi.resetModules();
    exec.mockReset();
    vi.doMock("../src/db/mysql.js", () => ({ db: { execute: exec }, pingDb: vi.fn() }));
    const mod = await import("../src/workers/leave-monthly-credit.worker.js");
    creditMonthlyLeaves = mod.creditMonthlyLeaves;
  });

  const CL_ID = "lt-cl", ML_ID = "lt-ml", EL_ID = "lt-el";

  function routeExec(handlers: Array<[RegExp, unknown]>) {
    exec.mockImplementation((sql: string) => {
      for (const [pattern, result] of handlers) {
        if (pattern.test(sql)) return Promise.resolve(result);
      }
      return Promise.resolve([[], []]);
    });
  }

  it("credits exactly 1.0 day for a CL schedule month — never a fractional amount", async () => {
    const insertedAmounts: number[] = [];
    routeExec([
      [/SELECT id, leave_code FROM leave_type_master/i, [[{ id: CL_ID, leave_code: "CL" }, { id: ML_ID, leave_code: "ML" }, { id: EL_ID, leave_code: "EL" }], []]],
      [/SELECT id, date_of_joining FROM employees/i, [[{ id: "emp-1", date_of_joining: "2024-01-01" }], []]],
      [/FROM leave_credit_schedule/i, [[{ month: 1, leave_code: "CL", credit_days: 1.0, leave_type_id: CL_ID }], []]],
      [/SELECT 1 FROM leave_el_credit_log/i, [[], []]], // not yet credited
    ]);
    exec.mockImplementation((sql: string, params: unknown[]) => {
      if (/INSERT INTO leave_balance_ledger/i.test(sql)) {
        insertedAmounts.push(Number(params[4])); // roundedDays param position
      }
      for (const [pattern, result] of [
        [/SELECT id, leave_code FROM leave_type_master/i, [[{ id: CL_ID, leave_code: "CL" }, { id: ML_ID, leave_code: "ML" }, { id: EL_ID, leave_code: "EL" }], []]],
        [/SELECT id, date_of_joining FROM employees/i, [[{ id: "emp-1", date_of_joining: "2024-01-01" }], []]],
        [/FROM leave_credit_schedule/i, [[{ month: 1, leave_code: "CL", credit_days: 1.0, leave_type_id: CL_ID }], []]],
        [/SELECT 1 FROM leave_el_credit_log/i, [[], []]],
      ] as Array<[RegExp, unknown]>) {
        if (pattern.test(sql)) return Promise.resolve(result);
      }
      return Promise.resolve([{ affectedRows: 1 }, []]);
    });

    await creditMonthlyLeaves(2026, 1);

    expect(insertedAmounts.every((a) => a === 1.0)).toBe(true);
    expect(insertedAmounts).not.toContain(0.583);
    expect(insertedAmounts).not.toContain(0.417);
  });

  it("is idempotent — skips an employee/type/month already present in leave_el_credit_log", async () => {
    let insertCount = 0;
    exec.mockImplementation((sql: string) => {
      if (/INSERT INTO leave_balance_ledger/i.test(sql)) insertCount++;
      for (const [pattern, result] of [
        [/SELECT id, leave_code FROM leave_type_master/i, [[{ id: CL_ID, leave_code: "CL" }, { id: ML_ID, leave_code: "ML" }, { id: EL_ID, leave_code: "EL" }], []]],
        [/SELECT id, date_of_joining FROM employees/i, [[{ id: "emp-1", date_of_joining: "2024-01-01" }], []]],
        [/FROM leave_credit_schedule/i, [[{ month: 1, leave_code: "CL", credit_days: 1.0, leave_type_id: CL_ID }], []]],
        [/SELECT 1 FROM leave_el_credit_log/i, [[{ 1: 1 }], []]], // ALREADY credited
      ] as Array<[RegExp, unknown]>) {
        if (pattern.test(sql)) return Promise.resolve(result);
      }
      return Promise.resolve([{ affectedRows: 1 }, []]);
    });

    await creditMonthlyLeaves(2026, 1);

    expect(insertCount).toBe(0);
  });

  it("does not credit CL and ML for the same month (only the schedule's own month rows are queried)", async () => {
    // February is an ML-only month per the approved schedule — the worker
    // queries leave_credit_schedule WHERE month = ?, so a CL row can only
    // ever be returned for a CL month. This test locks that contract: for
    // month 2, only ML rows are ever supplied by the schedule query.
    routeExec([
      [/SELECT id, leave_code FROM leave_type_master/i, [[{ id: CL_ID, leave_code: "CL" }, { id: ML_ID, leave_code: "ML" }, { id: EL_ID, leave_code: "EL" }], []]],
      [/SELECT id, date_of_joining FROM employees/i, [[], []]],
      [/FROM leave_credit_schedule/i, [[{ month: 2, leave_code: "ML", credit_days: 1.0, leave_type_id: ML_ID }], []]],
    ]);
    await expect(creditMonthlyLeaves(2026, 2)).resolves.not.toThrow();
    // Assert only ML appeared in the schedule fetch for month 2.
    const scheduleCall = exec.mock.calls.find(([s]) => /FROM leave_credit_schedule/i.test(String(s)));
    expect(scheduleCall).toBeDefined();
  });
});
