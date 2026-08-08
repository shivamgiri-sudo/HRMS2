import { describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";

/**
 * modules/payroll-compliance/payrollCalculate.service.ts is not the payroll
 * engine, and calling it must fail immediately.
 *
 * It is a second, complete implementation of payroll calculation, left behind
 * when the compliance pack was integrated as a parallel module instead of being
 * merged into the existing engine. The live path is calculatePayrollRun /
 * calculatePayrollRunScoped in modules/payroll/payrollCalculate.service.ts, used
 * by payroll.routes.ts, payroll-nightly-recalc.worker.ts and the
 * targeted-recalculation service.
 *
 * It is dangerous because it looks right: same function name, same signature, a
 * plausible body. An import resolving to this file rather than the live one would
 * compile and run and produce figures. What it lacks is every correction the live
 * engine has since gained — most seriously any cap on payable days. It takes
 * working days straight from the attendance record count, with no
 * MIN(..., daysInMonth), no week-off eligibility, no holiday resolution and no
 * leave reversal, so an employee could be paid for more days than the month has.
 *
 * Kept rather than deleted, per the repository rule against removing existing
 * code. These tests hold the quarantine in place.
 */

const MODULE_PATH = "src/modules/payroll-compliance/payrollCalculate.service.ts";
const SOURCE = readFileSync(resolve(process.cwd(), MODULE_PATH), "utf8");

vi.mock("../../../db/mysql.js", () => ({ db: { execute: vi.fn() } }));

// Imported statically, once. This module pulls a heavy dependency graph, and
// importing it inside each test made them exceed the 5s timeout under parallel
// load — passing in isolation and failing in a full run, which is the worst shape
// of flake to leave behind.
import { calculatePayrollRun } from "../payrollCalculate.service.js";

describe("the dead payroll engine refuses to run", () => {
  it("throws before touching the database", async () => {
    await expect(calculatePayrollRun("any-run", "any-user")).rejects.toThrow(
      /not the payroll engine/i,
    );
  });

  it("names the engine that should have been used", async () => {
    // A refusal that does not say what to call instead just becomes a puzzle.
    await expect(calculatePayrollRun("any-run", "any-user")).rejects.toThrow(
      /modules\/payroll\/payrollCalculate\.service\.ts/,
    );
  });

  it("says why, so the refusal is not mistaken for a bug to work around", async () => {
    await expect(calculatePayrollRun("any-run", "any-user")).rejects.toThrow(
      /payable-days cap/i,
    );
  });

  it("guards before any query, not partway through", () => {
    const fnStart = SOURCE.indexOf("export async function calculatePayrollRun(");
    const throwAt = SOURCE.indexOf("throw new Error(", fnStart);
    const firstQueryAt = SOURCE.indexOf("db.execute", fnStart);
    expect(throwAt).toBeGreaterThan(-1);
    expect(firstQueryAt).toBeGreaterThan(-1);
    expect(throwAt, "the guard must precede the first query").toBeLessThan(firstQueryAt);
  });
});

describe("nothing imports it", () => {
  it("has no importer anywhere in src", () => {
    // The throw is a backstop. This is the actual invariant: if something starts
    // importing it, that is the moment to look, not when payroll figures go wrong.
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        if (entry === "node_modules" || entry === "dist") continue;
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) { walk(full); continue; }
        if (!full.endsWith(".ts")) continue;
        if (full.includes("payroll-compliance")) continue; // itself, and its own tests
        const text = readFileSync(full, "utf8");
        // An import statement, not a mention in prose or a test reading it as text.
        if (/from\s+["'][^"']*payroll-compliance\/payrollCalculate[^"']*["']/.test(text)) {
          offenders.push(full);
        }
      }
    };
    walk(resolve(process.cwd(), "src"));
    expect(
      offenders,
      "something now imports the dead payroll engine — it has no payable-days cap",
    ).toEqual([]);
  }, 30_000);
});
