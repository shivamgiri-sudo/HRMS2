/**
 * Align every stored copy of the salary start date for Payroll Head-approved employees.
 *
 * WHY. Payroll reads employees.salary_start_date; Payroll Head's assigned date lives on the salary
 * assignment, the package date and the HR validation row. Until salary-start-date.service.ts,
 * those drifted apart (live 2026-09-25: 73 of 213 HRMS-onboarded employees, 395 backdated days).
 * See src/modules/payroll/salary-start-date.service.ts for the full story.
 *
 * WHICH DATE WINS. Payroll Head's. For each mismatched employee the three Payroll Head-derived
 * copies (HR validation row, package date, active assignment) are compared:
 *   - all present ones agree            -> that date is proposed, and every other copy is aligned to it;
 *   - they disagree among themselves    -> AMBIGUOUS: reported, never written. A person decides.
 * employees.salary_start_date is never the reference here - it is the copy that went stale.
 *
 * DRY-RUN BY DEFAULT. Prints one line per employee (CSV-friendly) and writes nothing.
 *   npx tsx scripts/salary-start-date-repair.ts                 # dry run, everyone
 *   npx tsx scripts/salary-start-date-repair.ts --employee=MAS63435 --employee=MAS63436
 *   npx tsx scripts/salary-start-date-repair.ts --apply         # write (each in its own transaction)
 *
 * --apply goes through setSalaryStartDate() - the same code the Payroll Head screens use - so it
 * refuses a change that reaches into a finalized/locked/disbursed payroll month (reported, not
 * forced), applies the pre-joining flag where the date is before joining, verifies every copy
 * after writing and records each change in employee_salary_start_date_audit with source "repair".
 * An employee that fails is reported and skipped; the rest continue.
 */
import "dotenv/config";

const APPLY = process.argv.includes("--apply");
const ONLY = new Set(
  process.argv
    .filter((a) => a.startsWith("--employee="))
    .map((a) => a.slice("--employee=".length).trim())
    .filter(Boolean),
);
const REPAIR_REASON =
  "Repair: aligned all copies to the salary start date Payroll Head assigned";

interface Proposal {
  employeeId: string;
  code: string;
  name: string;
  joined: string | null;
  payroll: string | null;
  validation: string | null;
  pkg: string | null;
  assignment: string | null;
  reasons: string;
  proposed: string | null;
  verdict: "PROPOSE" | "AMBIGUOUS";
}

async function main() {
  const { db } = await import("../src/db/mysql.js");
  const { listSalaryStartDateMismatches, setSalaryStartDate } =
    await import("../src/modules/payroll/salary-start-date.service.js");

  const rows = await listSalaryStartDateMismatches(5000);
  const selected = ONLY.size
    ? rows.filter((r) => ONLY.has(r.employee_code))
    : rows;

  const proposals: Proposal[] = selected.map((r) => {
    const derived = [
      r.validation_date,
      r.package_date,
      r.assignment_date,
    ].filter((d): d is string => !!d);
    const distinct = [...new Set(derived)];
    const proposed = distinct.length === 1 ? distinct[0] : null;
    return {
      employeeId: r.employee_id,
      code: r.employee_code,
      name: r.full_name,
      joined: r.date_of_joining,
      payroll: r.payroll_date,
      validation: r.validation_date,
      pkg: r.package_date,
      assignment: r.assignment_date,
      reasons: r.reasons.join("|"),
      proposed,
      verdict: proposed ? "PROPOSE" : "AMBIGUOUS",
    };
  });

  console.log(
    `mode=${APPLY ? "APPLY" : "DRY-RUN"} mismatched=${rows.length} selected=${selected.length}`,
  );
  console.log(
    "code,name,joined,payroll_date,validation_date,package_date,assignment_date,proposed,verdict,reasons",
  );
  for (const p of proposals) {
    console.log(
      [
        p.code,
        JSON.stringify(p.name),
        p.joined,
        p.payroll,
        p.validation,
        p.pkg,
        p.assignment,
        p.proposed,
        p.verdict,
        p.reasons,
      ]
        .map((v) => v ?? "")
        .join(","),
    );
  }

  const ambiguous = proposals.filter((p) => p.verdict === "AMBIGUOUS");
  const usable = proposals.filter((p) => p.verdict === "PROPOSE" && p.proposed);
  const movesPayroll = usable.filter((p) => p.proposed !== p.payroll);
  console.log(
    `\nsummary: propose=${usable.length} (of which change employees.salary_start_date=${movesPayroll.length}) ambiguous=${ambiguous.length}`,
  );

  if (!APPLY) {
    console.log("dry run - nothing written. Re-run with --apply to write.");
    await db.end?.();
    return;
  }

  let done = 0;
  const failed: Array<{ code: string; error: string }> = [];
  for (const p of usable) {
    try {
      await setSalaryStartDate({
        employeeId: p.employeeId,
        newDate: p.proposed as string,
        actorUserId: null,
        source: "repair",
        authority: "payroll_head",
        allowBackdate: true,
        reason: REPAIR_REASON,
      });
      done += 1;
    } catch (e) {
      failed.push({
        code: p.code,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  console.log(
    `\napplied=${done} failed=${failed.length} skipped-ambiguous=${ambiguous.length}`,
  );
  for (const f of failed) console.log(`FAILED ${f.code}: ${f.error}`);
  await db.end?.();
  if (failed.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
