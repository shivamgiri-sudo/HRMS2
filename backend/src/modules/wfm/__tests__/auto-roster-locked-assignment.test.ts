import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * generateDraft()'s pre-regeneration cleanup unconditionally deleted every non-published
 * assignment for the plan, with no check of wfm_roster_assignment_control.change_lock_status
 * — the column the schema defines specifically ('draft_editable'/'pm_change_only'/'locked')
 * so a manual per-employee override inside a draft plan survives the next "generate". A
 * manager's manual edit was silently destroyed the moment generation ran again.
 *
 * 'locked' is not currently written by any code path (confirmed by audit), so this is a
 * no-op against today's data; the fix closes the gap for when it is set, without changing
 * current behavior — hence a source-level assertion rather than a full functional mock of
 * generateDraft's many other dependencies (plan/control/prefs/shrinkage/blackout loading).
 */
describe("generateDraft preserves locked assignments on regeneration", () => {
  const source = readFileSync(resolve(__dirname, "../auto-roster-synced.service.ts"), "utf-8");

  function cleanupBlock(): string {
    const start = source.indexOf("async generateDraft(planId: string, actorId: string) {");
    expect(start, "generateDraft not found").toBeGreaterThan(-1);
    const end = source.indexOf("const processName = await getProcessName", start);
    expect(end, "end of cleanup block not found").toBeGreaterThan(start);
    return source.slice(start, end);
  }

  it("excludes locked assignments from the pre-regeneration DELETE", () => {
    const block = cleanupBlock();
    expect(block).toMatch(
      /DELETE wra FROM wfm_roster_assignment wra[\s\S]*LEFT JOIN wfm_roster_assignment_control wrac ON wrac\.assignment_id = wra\.id[\s\S]*wrac\.change_lock_status IS NULL OR wrac\.change_lock_status <> 'locked'/,
    );
  });

  it("excludes locked control rows from their own cleanup, so the lock survives", () => {
    const block = cleanupBlock();
    expect(block).toMatch(
      /DELETE FROM wfm_roster_assignment_control[\s\S]*WHERE plan_id = \? AND change_lock_status <> 'locked'/,
    );
  });

  it("still refuses to regenerate a published/locked plan outright (unchanged guard)", () => {
    const block = cleanupBlock();
    expect(block).toMatch(/\["published", "locked"\]\.includes\(String\(control\.approval_status\)\)/);
    expect(block).toMatch(/statusCode: 409/);
  });
});
