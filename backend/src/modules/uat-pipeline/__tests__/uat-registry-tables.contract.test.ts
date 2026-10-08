/**
 * Every `tables` pattern in the capability registry must match a real table.
 *
 * WHY THIS TEST EXISTS
 *   Capability detection is the union of three signals — path, table and keyword. The table
 *   signal is what catches a request that names `leave_balance` but trips no protected path.
 *   A pattern naming a table that does not exist is SILENTLY DEAD: nothing errors, the
 *   capability simply never fires on that signal, and the request is under-classified.
 *
 *   On 2026-08-08 a read-only query against the live 892-table `mas_hrms` found 23 such dead
 *   patterns across 10 of the 15 capabilities. The cause was consistent and would repeat:
 *   HRMS2 prefixes tables by MODULE, so the natural-looking `payslip*`, `interview_*`,
 *   `punch_*` and `users` match nothing, while `salary_payslip`, `ats_interview_submission`,
 *   `cosec_punch_sync` (3,039,163 rows) and `auth_user` are what exist. Some concepts —
 *   comp-off, overtime, LMS courses — have no table at all, because they are rows in another
 *   table or live in the separately deployed `mcn_lms` database.
 *
 *   This is the same defect class as the reporting module's broken column references: a name
 *   that looks right, was never checked against the real schema, and fails by finding nothing.
 *
 * WHY IT USES THE SNAPSHOT AND NOT THE DATABASE
 *   `backend/sql/schema-snapshot.json` is committed and is what the existing
 *   schema-column-refs guard reads. A test that needed a live connection could not run in CI,
 *   and a check that only runs when someone remembers to run it is not a check.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadCapabilityRegistry } from "../capability-registry.js";
import { matchTablePattern } from "../control-plane.js";

const here = dirname(fileURLToPath(import.meta.url));
const snapshot = JSON.parse(
  readFileSync(join(here, "..", "..", "..", "..", "sql", "schema-snapshot.json"), "utf8")
) as { tables: Record<string, unknown> | string[] };

const tableNames: string[] = Array.isArray(snapshot.tables)
  ? snapshot.tables
  : Object.keys(snapshot.tables);

const registry = loadCapabilityRegistry();

/**
 * Patterns verified against the LIVE database but absent from the committed snapshot.
 *
 * The snapshot is a point-in-time artifact and lags the schema: on 2026-08-08 it held 883
 * tables while `mas_hrms` had 892. `imprest_allocation`, `imprest_allocation_sequence` and
 * `imprest_manager` exist live and were added after the snapshot was generated, so
 * `imprest_*` is correct and failing on it would be the test being wrong, not the registry.
 *
 * This list is for that case ONLY — a pattern with live evidence recorded beside it. It is
 * not a place to silence a genuinely dead pattern; the whole point of the test is that a
 * name matching nothing anywhere gets caught. Anything added here without a verified table
 * name and a date is a bug being hidden.
 */
const VERIFIED_LIVE_NOT_IN_SNAPSHOT: Record<string, string> = {
  "imprest_*":
    "imprest_allocation, imprest_allocation_sequence, imprest_manager — confirmed on " +
    "192.168.10.6/mas_hrms 2026-08-08; snapshot had 883 tables to the schema's 892",
};

describe("the exception list stays honest", () => {
  it("only excuses patterns that are still declared by some capability", () => {
    // A stale exception is worse than none: it silently excuses a pattern nobody uses, and
    // the next person reads it as evidence that something was checked.
    const declared = new Set(registry.capabilities.flatMap((c) => c.tables ?? []));
    for (const pattern of Object.keys(VERIFIED_LIVE_NOT_IN_SNAPSHOT)) {
      expect(declared, `${pattern} is excused but no capability declares it`).toContain(pattern);
    }
  });

  it("records live evidence for each exception", () => {
    for (const [pattern, evidence] of Object.entries(VERIFIED_LIVE_NOT_IN_SNAPSHOT)) {
      expect(evidence.length, `${pattern} needs a real table name and a date`).toBeGreaterThan(30);
      expect(evidence, `${pattern} must name the tables it matched`).toMatch(/\d{4}-\d{2}-\d{2}/);
    }
  });

  it("stays small — a growing list means the snapshot needs regenerating", () => {
    expect(Object.keys(VERIFIED_LIVE_NOT_IN_SNAPSHOT).length).toBeLessThanOrEqual(3);
  });
});

describe("the schema snapshot is usable", () => {
  it("lists the tables the pipeline actually reads", () => {
    expect(tableNames.length).toBeGreaterThan(500);
    for (const t of ["employees", "page_catalog", "notification_event_config"]) {
      expect(tableNames, `${t} must be in the snapshot`).toContain(t);
    }
  });
});

describe("every capability table pattern matches something real", () => {
  const withTables = registry.capabilities.filter((c) => (c.tables ?? []).length > 0);

  it("covers the capabilities that carry policy weight", () => {
    // A capability at REVIEW or above with no table signal at all is relying entirely on
    // paths and keywords, which is a weaker position than intended.
    for (const cap of registry.capabilities) {
      if (["DENY", "HIGH_REVIEW", "REVIEW"].includes(cap.class)) {
        expect(
          (cap.tables ?? []).length,
          `${cap.key} is ${cap.class} but declares no table patterns`
        ).toBeGreaterThan(0);
      }
    }
  });

  it.each(withTables.map((c) => [c.key, c] as const))(
    "%s — no dead patterns",
    (_key, cap) => {
      const dead = (cap.tables ?? [])
        .filter((pattern) => !tableNames.some((t) => matchTablePattern(pattern, t)))
        .filter((pattern) => !VERIFIED_LIVE_NOT_IN_SNAPSHOT[pattern]);
      expect(
        dead,
        `${cap.key} has pattern(s) matching no table in the schema snapshot. ` +
          `HRMS2 prefixes tables by module — check the real name before inventing one, and ` +
          `delete the pattern outright if the concept has no table.`
      ).toEqual([]);
    }
  );
});

describe("widening a pattern must not swallow another domain", () => {
  /** Worst class claiming a table, by the same rule the scanner uses. */
  const RANK = { TRIVIAL: 0, STANDARD: 1, REVIEW: 2, HIGH_REVIEW: 3, DENY: 4 } as const;

  function classFor(table: string): { cls: keyof typeof RANK | null; keys: string[] } {
    let cls: keyof typeof RANK | null = null;
    const keys: string[] = [];
    for (const cap of registry.capabilities) {
      if ((cap.tables ?? []).some((p) => matchTablePattern(p, table))) {
        keys.push(cap.key);
        if (!cls || RANK[cap.class] > RANK[cls]) cls = cap.class;
      }
    }
    return { cls, keys };
  }

  it("keeps roster and shift tables at HIGH_REVIEW, not DENY", () => {
    // A bare `wfm_*` on attendance_classification (DENY) pulled the entire roster domain —
    // wfm_roster_assignment alone is 386,712 rows — out of the automated path. Roster is
    // HIGH_REVIEW by design: a WFM owner approves it, a human does not have to write it.
    for (const t of [
      "wfm_roster_assignment",
      "wfm_shift_master",
      "wfm_shift_template",
      "wfm_roster_plan",
    ]) {
      if (!tableNames.includes(t)) continue;
      const { cls, keys } = classFor(t);
      expect(cls, `${t} classified ${cls} by [${keys.join(",")}]`).not.toBe("DENY");
    }
  });

  it("still classifies punch and attendance-session tables as DENY", () => {
    // These feed payroll, so they are correctly the strictest class.
    for (const t of ["cosec_punch_sync", "wfm_attendance_session"]) {
      if (!tableNames.includes(t)) continue;
      expect(classFor(t).cls, `${t} must remain DENY`).toBe("DENY");
    }
  });

  it("classifies payroll-affecting employee tables as DENY, not merely HIGH_REVIEW", () => {
    // Loans and deductions change net pay, so employee_master's HIGH_REVIEW is not enough.
    for (const t of ["employee_loans", "employee_deductions_log"]) {
      if (!tableNames.includes(t)) continue;
      expect(classFor(t).cls, `${t} affects net pay`).toBe("DENY");
    }
  });

  it("does not classify the whole schema as DENY", () => {
    // The registry is deliberately over-broad, but if everything is DENY then nothing is
    // eligible for any automated path and the two-dimensional model has collapsed to one.
    const deny = tableNames.filter((t) => classFor(t).cls === "DENY").length;
    expect(deny / tableNames.length, `${deny}/${tableNames.length} tables are DENY`).toBeLessThan(
      0.5
    );
  });
});
