import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Part A.1 (2026-08-13): week-off policy hierarchy (employee preference ->
 * roster template -> process/branch/org default -> WEEK_OFF_POLICY_MISSING).
 * Covers the two new pieces directly:
 *   1. weekoff-policy.service.ts's tier 2 (template) / tier 3-5 (scope
 *      default) resolution helpers, in isolation.
 *   2. roster.governance.service.ts's advanceCycleStatus() publish gate,
 *      which must block a "published" transition when the latest generation
 *      run for the cycle recorded any WEEK_OFF_POLICY_MISSING employee, and
 *      must not interfere with any other transition or a clean run.
 * roster-generation.service.ts's per-employee tier selection (employee
 * preference wins over template wins over scope default wins over
 * unresolved) is exercised indirectly through these — a full mocked-DB run
 * of generateForCycle() is a much larger fixture than this hierarchy logic
 * needs to be pinned down correctly.
 */

vi.mock("../src/db/mysql.js", () => ({
  db: { execute: vi.fn() },
  pingDb: vi.fn(),
}));
vi.mock("../src/shared/auditLog.js", () => ({ logSensitiveAction: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../src/modules/communication/sms.helper.js", () => ({ sendSMS: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../src/modules/roster/roster.notifications.js", () => ({
  notifyRosterPublished: vi.fn().mockResolvedValue({ sent: 0 }),
}));

import { db } from "../src/db/mysql.js";
import {
  resolveWeekOffScopeDefault,
  parseRosterTemplatePattern,
  isWeekOffByTemplate,
} from "../src/modules/roster/weekoff-policy.service.js";
import { rosterGovernanceService } from "../src/modules/roster/roster.governance.service.js";

const mockExecute = db.execute as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("resolveWeekOffScopeDefault — tier 3-5 (process > branch > global)", () => {
  it("returns null when the table has no matching row at any scope (never defaults to Sunday)", async () => {
    mockExecute.mockResolvedValueOnce([[], []]);
    const result = await resolveWeekOffScopeDefault("proc-1", "branch-1");
    expect(result).toBeNull();
  });

  it("returns the resolved day and its source when a row matches", async () => {
    mockExecute.mockResolvedValueOnce([[{ default_week_off_day: 2, scope_type: "process" }], []]);
    const result = await resolveWeekOffScopeDefault("proc-1", "branch-1");
    expect(result).toEqual({ day: 2, source: "process_default" });
  });

  it("degrades to null (not a thrown error) if the table doesn't exist yet on this DB", async () => {
    mockExecute.mockRejectedValueOnce(new Error("ER_NO_SUCH_TABLE"));
    const result = await resolveWeekOffScopeDefault("proc-1", null);
    expect(result).toBeNull();
  });

  it("passes branchId=null straight through — a branchless cycle can still resolve a global row", async () => {
    mockExecute.mockResolvedValueOnce([[{ default_week_off_day: 0, scope_type: "global" }], []]);
    const result = await resolveWeekOffScopeDefault("proc-1", null);
    expect(result).toEqual({ day: 0, source: "global_default" });
    expect(mockExecute).toHaveBeenCalledWith(expect.any(String), expect.arrayContaining([null]));
  });
});

describe("roster_template pattern parsing and lookup — tier 2", () => {
  const FIVE_DAY_WEEK = {
    days: [
      { day_number: 1, is_week_off: true },
      { day_number: 2, is_week_off: false },
      { day_number: 3, is_week_off: false },
      { day_number: 4, is_week_off: false },
      { day_number: 5, is_week_off: false },
      { day_number: 6, is_week_off: false },
      { day_number: 7, is_week_off: true },
    ],
  };

  it("parses a valid pattern_json string", () => {
    const parsed = parseRosterTemplatePattern(JSON.stringify(FIVE_DAY_WEEK));
    expect(parsed?.days).toHaveLength(7);
  });

  it("accepts an already-parsed object (mysql2 auto-parses JSON columns)", () => {
    const parsed = parseRosterTemplatePattern(FIVE_DAY_WEEK);
    expect(parsed?.days).toHaveLength(7);
  });

  it("returns null for malformed JSON rather than throwing", () => {
    expect(parseRosterTemplatePattern("{not valid json")).toBeNull();
  });

  it("returns null when the parsed value has no days[] array", () => {
    expect(parseRosterTemplatePattern({ foo: "bar" })).toBeNull();
  });

  it("isWeekOffByTemplate maps 0-based cycle position to 1-based day_number", () => {
    const pattern = parseRosterTemplatePattern(FIVE_DAY_WEEK)!;
    expect(isWeekOffByTemplate(pattern, 0)).toBe(true);  // day_number 1
    expect(isWeekOffByTemplate(pattern, 1)).toBe(false); // day_number 2
    expect(isWeekOffByTemplate(pattern, 6)).toBe(true);  // day_number 7
  });

  it("isWeekOffByTemplate returns null (not false) for a position outside the pattern", () => {
    const pattern = parseRosterTemplatePattern(FIVE_DAY_WEEK)!;
    expect(isWeekOffByTemplate(pattern, 10)).toBeNull();
  });
});

describe("advanceCycleStatus — publish gate blocks on WEEK_OFF_POLICY_MISSING (Part A.1)", () => {
  const CYCLE = {
    id: "cycle-1",
    status: "reviewed",
    process_id: "proc-1",
    branch_id: null,
  };

  function mockCycleAnd(runRows: unknown[]) {
    mockExecute.mockImplementation(async (sql: unknown) => {
      const text = String(sql);
      if (/FROM weekly_roster_cycle WHERE id/i.test(text)) return [[CYCLE], []];
      if (/FROM roster_generation_run/i.test(text)) return [runRows, []];
      return [[], []]; // UPDATE, logSensitiveAction's own writes, etc.
    });
  }

  it("blocks with 409 when the latest run's error_details contains a WEEK_OFF_POLICY_MISSING entry", async () => {
    mockCycleAnd([
      { error_details: ["WEEK_OFF_POLICY_MISSING:emp:EMP001 — no employee preference, roster template, or process/branch/org default resolved a week-off day for this cycle"] },
    ]);
    await expect(
      rosterGovernanceService.advanceCycleStatus("cycle-1", "published", "user-1")
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("parses error_details as a JSON string too, not only a pre-parsed array", async () => {
    mockCycleAnd([
      { error_details: JSON.stringify(["WEEK_OFF_POLICY_MISSING:emp:EMP002 — ..."]) },
    ]);
    await expect(
      rosterGovernanceService.advanceCycleStatus("cycle-1", "published", "user-1")
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("does NOT block on an ordinary error unrelated to week-off policy", async () => {
    mockCycleAnd([
      { error_details: ["emp:EMP003 date:2026-05-21 — no shift template available"] },
    ]);
    await expect(
      rosterGovernanceService.advanceCycleStatus("cycle-1", "published", "user-1")
    ).resolves.toBeDefined();
  });

  it("does NOT block when the latest run has no error_details at all", async () => {
    mockCycleAnd([{ error_details: null }]);
    await expect(
      rosterGovernanceService.advanceCycleStatus("cycle-1", "published", "user-1")
    ).resolves.toBeDefined();
  });

  it("does NOT block when there is no generation run recorded for this cycle yet", async () => {
    mockCycleAnd([]);
    await expect(
      rosterGovernanceService.advanceCycleStatus("cycle-1", "published", "user-1")
    ).resolves.toBeDefined();
  });

  it("does not run the week-off check at all for a non-publish transition", async () => {
    mockExecute.mockImplementation(async (sql: unknown) => {
      const text = String(sql);
      if (/FROM weekly_roster_cycle WHERE id/i.test(text)) return [[{ ...CYCLE, status: "draft" }], []];
      if (/FROM roster_generation_run/i.test(text)) {
        throw new Error("should not query roster_generation_run for a non-publish transition");
      }
      return [[], []];
    });
    await expect(
      rosterGovernanceService.advanceCycleStatus("cycle-1", "submitted", "user-1")
    ).resolves.toBeDefined();
  });
});
