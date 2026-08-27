import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

/**
 * Every path that changes a reporting manager must record effective-dated history.
 *
 * This is a coverage guard, not a unit test. Manager attribution is only as good as its
 * weakest writer: one UPDATE that skips recordManagerChange() silently reverts attrition and
 * shrinkage to the old "attribute everything to today's pointer" behaviour for whoever it
 * touches — and does so invisibly, because the figures still render, just wrong.
 *
 * When this fails, the fix is to call recordManagerChange() in the new writer, NOT to add the
 * file to an exemption list. There is deliberately no exemption list.
 *
 * The seven writers known on 2026-08-27, all now covered:
 *   employees/employee.service.ts               admin profile edit
 *   employees/rm-change.routes.ts               RM change request approval
 *   bulk-upload/reporting-manager-bulk.service  bulk reassignment (highest volume)
 *   exit/exit.service.ts                        departing manager orphans their team
 *   mobility/mobility.service.ts                reporting transfer + 2 cost-centre cascades
 */

const SRC = join(process.cwd(), "src");

/** Every .ts file under src/, excluding tests. */
function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "__tests__" || entry === "node_modules") continue;
      sourceFiles(full, acc);
    } else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) {
      acc.push(full);
    }
  }
  return acc;
}

/**
 * A WRITE to employees.reporting_manager_id.
 *
 * Anchored on `UPDATE employees` for two reasons, both learned by running it:
 *
 *  1. The obvious pattern `reporting_manager_id = ?` also matches every
 *     `WHERE reporting_manager_id = ?`, and there are dozens of those. A read is not a write,
 *     and a guard that flags 30 innocent files gets muted rather than fixed.
 *  2. `ats.onboarding.service.ts` writes reporting_manager_id on ats_payroll_hr_validation
 *     and ats_employment_offer — an OFFER's proposed manager, not a live reporting line.
 *     Nothing has been managed yet, so there is no history to record.
 *
 * The bounded gap keeps the table name and the column inside one statement: a backtick ends a
 * template literal, and 400 characters spans any real SET-list here without bridging into a
 * following statement.
 *
 * The second alternation catches dynamically assembled SQL. employee.service.ts builds its
 * statement as `UPDATE employees SET ${sets.join(", ")}` and pushes the column separately, so
 * the literal `UPDATE employees` never sits near `reporting_manager_id` and the first pattern
 * cannot see it. A detector that silently misses the busiest writer is worse than no detector,
 * which is exactly what the anti-rot assertion below caught.
 *
 * The dynamic alternation matches reporting_manager_id ONLY. A `push()` carries no table
 * name, and process_id / branch_id appear on dozens of tables — job_requisition, ijp, org,
 * holiday_work and more — so including them there flagged ten innocent files. Static
 * `UPDATE employees` writes of process_id and branch_id are still caught by the first
 * alternation, which IS table-anchored; and employee.service.ts, the one file that assembles
 * all three dynamically, is already matched through its reporting_manager_id push.
 *
 * That alternation requires the column BARE — `push("reporting_manager_id = ?")` — because a
 * scope builder pushes it aliased, `conds.push("e.reporting_manager_id = ?")`, and that is a
 * WHERE filter, not an assignment. Six scope and analytics files were flagged before this
 * distinction was added.
 *
 * SCOPE: manager, process AND branch. An employee's effective supervision is all three —
 * the process manager and branch head own the outcome alongside the named manager — so a
 * process or branch move opens a new supervisory period even when reporting_manager_id is
 * untouched. Recording only the manager would leave those moves invisible and keep charging
 * the old process for somebody who has left it.
 *
 * KNOWN GAP: this covers UPDATE only. Employee CREATION also establishes a first manager
 * (employee-creation-orchestrator, ATS conversion), which should open the first period rather
 * than wait for the first change. Deliberately out of scope here and stated rather than
 * silently missing.
 */
const WRITES_MANAGER =
  /(UPDATE\s+employees\b[^;`]{0,400}?(reporting_manager_id|process_id|branch_id)\s*=)|(push\(\s*["`']reporting_manager_id\s*=)/is;

/** The file records history, or is the module that implements it. */
const RECORDS_HISTORY = /recordManagerChange|manager-attribution\.service/;

describe("reporting-manager writers record effective-dated history", () => {
  const offenders: string[] = [];

  for (const file of sourceFiles(SRC)) {
    const text = readFileSync(file, "utf8");
    if (!WRITES_MANAGER.test(text)) continue;
    if (RECORDS_HISTORY.test(text)) continue;
    offenders.push(file.replace(SRC, "src").replace(/\\/g, "/"));
  }

  it("has no writer that changes a manager without recording it", () => {
    expect(
      offenders,
      `These files change employees.reporting_manager_id without calling recordManagerChange().\n` +
      `Every such write must append an effective-dated row, or attrition and shrinkage silently\n` +
      `re-attribute that employee's entire history to whoever holds the pointer today:\n  ` +
      offenders.join("\n  "),
    ).toEqual([]);
  });

  it("still finds the known writers — the detector itself must not rot", () => {
    // If this drops to zero the regex has stopped matching and the guard above passes vacuously.
    const writers = sourceFiles(SRC).filter((f) => WRITES_MANAGER.test(readFileSync(f, "utf8")));
    expect(writers.length).toBeGreaterThanOrEqual(5);
  });
});
