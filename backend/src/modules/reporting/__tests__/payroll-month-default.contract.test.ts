import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { resolvePayrollMonth, __resetPayrollMonthCache } from "../payroll-month.js";

const ROOT = process.cwd();
const R = "src/modules/reporting";
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const strip = (s: string) => s.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

/**
 * Payroll is closed monthly and always in arrears, so for most of any month there is no run
 * for "this month" yet. Every payroll and statutory report defaulted to `new Date()`, so
 * opening one from the report library filtered on a month with no run and drew an empty grid —
 * indistinguishable from "payroll ran and produced nothing". Measured on 2026-08-08: sixteen
 * reachable payroll reports returned nothing with no parameters and full data for 2026-07.
 *
 * The correction is narrow on purpose. A report whose month selects ATTENDANCE days must keep
 * defaulting to today, because attendance_daily_record has rows through today — overtime-summary
 * and leave-lwp-reconciliation both drive off attendance and merely LEFT JOIN a payroll run, and
 * rewinding them would be the same bug in the opposite direction.
 *
 * So the rule this pins is: default by DRIVING TABLE, not by whether the SQL mentions run_month.
 */

const PAYROLL_TABLES = ["salary_prep_line", "salary_prep_run", "legacy_payslip_snapshot"];

interface Block { name: string; body: string; file: string }

function blocks(): Block[] {
  const out: Block[] = [];
  for (const file of ["report-suite.routes.ts", "report-suite-highrisk.routes.ts"]) {
    const src = read(`${R}/${file}`);
    // The high-risk router is one handler per route, not a switch.
    if (file.includes("highrisk")) {
      for (const part of src.split(/(?=reportSuiteHighRiskRouter\.get\()/)) {
        const m = /reportSuiteHighRiskRouter\.get\("\/([a-z0-9-]+)"/.exec(part);
        if (m) out.push({ name: m[1], body: part, file });
      }
      continue;
    }
    for (const part of src.split(/(?=\n {4}case ")/)) {
      const m = /^\n {4}case "([a-z0-9-]+)"/.exec(part);
      if (m) out.push({ name: m[1], body: part, file });
    }
  }
  for (const file of readdirSync(resolve(ROOT, `${R}/executors`)).filter(f => f.endsWith(".executor.ts"))) {
    const src = read(`${R}/executors/${file}`);
    for (const part of src.split(/(?=\nexport async function )/)) {
      const m = /^\nexport async function (\w+)\(/.exec(part);
      if (m) out.push({ name: m[1], body: part, file });
    }
  }
  return out;
}

/**
 * SQL bodies shared between more than one serving layer, so a block that references one can be
 * resolved to the table it really reads.
 */
const SHARED_BODIES: Record<string, string> = {
  PAYROLL_REGISTER_BODY: read(`${R}/executors/payroll.executor.ts`),
  PAYROLL_VARIANCE_BODY: read(`${R}/executors/payroll.executor.ts`),
  PAYSLIP_STATUS_BODY: read(`${R}/executors/payroll.executor.ts`),
};

/**
 * The driving table for a block, following shared SQL constants.
 *
 * payroll-register's SELECT now lives in PAYROLL_REGISTER_BODY so the screen and the download
 * cannot drift apart again — which means its own block contains no literal FROM. Reading only
 * the block would find no driving table and quietly exempt it from this check: the failure mode
 * where a guard keeps passing while the thing it guards moves out from under it.
 */
const drivingTable = (body: string) => {
  let text = strip(body);
  for (const [name, source] of Object.entries(SHARED_BODIES)) {
    if (!text.includes(name)) continue;
    const at = source.indexOf(`export const ${name}`);
    if (at !== -1) text += "\n" + strip(source.slice(at, at + 6000));
  }
  return (/\bFROM\s+`?([a-z_][a-z0-9_]*)`?/i.exec(text)?.[1] ?? "").toLowerCase();
};

describe("payroll month default", () => {
  const all = blocks().filter(b => /monthParam\(|resolvePayrollMonth\(/.test(strip(b.body)));

  /**
   * arrear-payment-register reads legacy_payslip_snapshot, where the month filter is optional
   * and the unfiltered view is the useful one: there are 20 rows carrying a non-zero arrear in
   * the entire table's history, across several months. Defaulting it to a single month would
   * empty a report that currently works. Its explicit-month path still resolves normally.
   */
  const EXEMPT = new Set(["arrearPaymentRegister"]);

  it("every payroll-driven report resolves its month from payroll, not from today", () => {
    const offenders = all
      .filter(b => PAYROLL_TABLES.includes(drivingTable(b.body)))
      .filter(b => !EXEMPT.has(b.name))
      .filter(b => !/resolvePayrollMonth\(/.test(strip(b.body)))
      .map(b => `${b.name} (${b.file}, FROM ${drivingTable(b.body)})`);
    expect(
      offenders,
      "these read a payroll table but default their month to the current calendar month, " +
        "so they render empty until that month's payroll run exists:\n" + offenders.join("\n"),
    ).toEqual([]);
  });

  it("reports driven by attendance or employees still default to today", () => {
    // The guard against over-applying the fix. arrear-payment-register is exempt: it reads
    // legacy_payslip_snapshot, whose month filter is optional, and its unfiltered view shows
    // all 20 arrear rows there have ever been — pinning it to one month would empty it.
    const wrong = all
      .filter(b => !PAYROLL_TABLES.includes(drivingTable(b.body)))
      .filter(b => /resolvePayrollMonth\(/.test(strip(b.body)))
      .map(b => `${b.name} (${b.file}, FROM ${drivingTable(b.body)})`);
    expect(
      wrong,
      "these do not read a payroll table, so a payroll month would rewind them:\n" + wrong.join("\n"),
    ).toEqual([]);
  });

  it("an explicit month is honoured exactly, including one with no payroll", () => {
    // Rewriting a requested 2026-08 into 2026-07 because August looks empty would be worse
    // than the empty result: the user asked a question and would be shown another month's
    // answer under their heading.
    __resetPayrollMonthCache();
    return Promise.all([
      expect(resolvePayrollMonth("2026-08")).resolves.toBe("2026-08"),
      expect(resolvePayrollMonth("2026-07")).resolves.toBe("2026-07"),
      expect(resolvePayrollMonth("1999-01")).resolves.toBe("1999-01"),
    ]);
  });

  it("rejects a malformed month rather than passing it into SQL", async () => {
    __resetPayrollMonthCache();
    // Falls through to the lookup instead of binding "garbage" / "2026-13" as a run_month.
    for (const bad of ["garbage", "2026-1", "26-01", "", "2026-07-01"]) {
      const got = await resolvePayrollMonth(bad);
      expect(got, `${JSON.stringify(bad)} must not be used as a month`).toMatch(/^\d{4}-\d{2}$/);
      expect(got).not.toBe(bad);
    }
  });
});
