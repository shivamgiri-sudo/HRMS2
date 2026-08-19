import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

/**
 * ROSTER_PUBLISH_PENDING was a registered Work Inbox item_type with no producer anywhere
 * (delta-audit 2026-08-19). Investigation before wiring, verified against the live DB:
 *
 * - wfm_roster_plan has ZERO rows in production — the plan/approve/publish lifecycle this
 *   trigger hooks into has never actually been exercised live.
 * - Every one of the 413,386 wfm_roster_assignment rows already carries
 *   publish_status='published'. The "412,032 synthetic rows" referenced in
 *   rest-policy.service.ts's findAdjacentShifts comment is a single bulk INSERT, all rows
 *   timestamped 2026-06-11 18:23:31 (decision_source='manual'); the remaining 1,354 rows are
 *   a second bulk load, all timestamped 2026-07-15 (decision_source='bulk_upload'). Both
 *   cohorts were written directly into the table — never through createPlan()/approve() —
 *   and are already terminal (published), so they can never reach approval_status='approved'
 *   and can never fire this trigger.
 *
 * Conclusion: there is no existing backlog to grandfather, and the historical bulk data
 * cannot contaminate the trigger because the trigger fires on a state transition the bulk
 * data never passed through. Firing at recomputeCoverage/approve() specifically (not at
 * createPlan) avoids flagging an empty just-created draft as "awaiting publish".
 */

const SOURCE = readFileSync(
  resolve(__dirname, "../auto-roster-synced.service.ts"),
  "utf-8",
);

function approveBlock(): string {
  const start = SOURCE.indexOf("async approve(planId: string, actorId: string, remarks?: string) {");
  expect(start, "approve() not found").toBeGreaterThan(-1);
  const end = SOURCE.indexOf("async reject(", start);
  expect(end, "end of approve() not found").toBeGreaterThan(start);
  return SOURCE.slice(start, end);
}

describe("ROSTER_PUBLISH_PENDING wiring in auto-roster-synced.service.ts::approve()", () => {
  it("imports triggerRosterPublishPending from the shared work-inbox triggers module", () => {
    expect(SOURCE).toMatch(
      /import \{ triggerRosterPublishPending \} from "\.\.\/work-inbox\/work-inbox\.triggers\.js";/,
    );
  });

  it("calls triggerRosterPublishPending only inside approve(), after approval_status is set to 'approved'", () => {
    const block = approveBlock();
    const statusUpdateIdx = block.indexOf("approval_status = 'approved'");
    const triggerIdx = block.indexOf("triggerRosterPublishPending(");
    expect(statusUpdateIdx).toBeGreaterThan(-1);
    expect(triggerIdx).toBeGreaterThan(-1);
    expect(triggerIdx).toBeGreaterThan(statusUpdateIdx);
  });

  it("wraps the trigger call in a non-fatal try/catch so a work-item failure cannot block approval", () => {
    const block = approveBlock();
    const triggerIdx = block.indexOf("triggerRosterPublishPending(");
    const tryIdx = block.lastIndexOf("try {", triggerIdx);
    const catchIdx = block.indexOf("} catch", triggerIdx);
    expect(tryIdx).toBeGreaterThan(-1);
    expect(catchIdx).toBeGreaterThan(triggerIdx);
  });

  it("is not called from createPlan, submitForApproval, or generateDraft (fires only on the approve transition)", () => {
    const createPlanStart = SOURCE.indexOf("async createPlan(input: CreateAutoRosterPlanInput");
    const submitStart = SOURCE.indexOf("async submitForApproval(");
    const generateStart = SOURCE.indexOf("async generateDraft(planId: string, actorId: string) {");
    const approveStart = SOURCE.indexOf("async approve(planId: string, actorId: string, remarks?: string) {");

    const createPlanBlock = SOURCE.slice(createPlanStart, submitStart);
    const submitBlock = SOURCE.slice(submitStart, approveStart);
    const generateBlock = SOURCE.slice(generateStart, generateStart + 6000);

    expect(createPlanBlock).not.toMatch(/triggerRosterPublishPending/);
    expect(submitBlock).not.toMatch(/triggerRosterPublishPending/);
    expect(generateBlock).not.toMatch(/triggerRosterPublishPending/);
  });
});

describe("registers ROSTER_PUBLISH_PENDING with the expected shape", () => {
  it("matches the registry entry", async () => {
    const { resolveActionItemDef } = await import("../../work-inbox/action-item-registry.js");
    const def = resolveActionItemDef("ROSTER_PUBLISH_PENDING");
    expect(def).toBeTruthy();
    expect(def?.module).toBe("ROSTER");
    expect(def?.entityType).toBe("roster_draft");
    expect(def?.defaultAssigneeRoles).toContain("process_manager");
    expect(def?.deeplinkPattern).toBe("/wfm/roster?draftId={entityId}");
    expect(def?.requiresScope).toBe(true);
  });
});

describe("triggerRosterPublishPending", () => {
  it("creates a work item assigned to process_manager, deduped via createWorkItemIfNotExists", async () => {
    vi.resetModules();
    const dbExecute = vi.fn();
    vi.doMock("../../../db/mysql.js", () => ({ db: { execute: dbExecute } }));
    const { triggerRosterPublishPending } = await import("../../work-inbox/work-inbox.triggers.js");

    dbExecute.mockResolvedValueOnce([[]]); // no existing pending item
    dbExecute.mockResolvedValueOnce([{ insertId: 1 }]); // insert

    await triggerRosterPublishPending("plan-1", "Week 34 - Process A", "branch-9");

    const insertCall = dbExecute.mock.calls.find((c) => String(c[0]).includes("INSERT INTO work_item"));
    expect(insertCall).toBeTruthy();
    const params = insertCall![1] as any[];
    expect(params).toContain("ROSTER_PUBLISH_PENDING");
    expect(params).toContain("plan-1");
    expect(params).toContain("process_manager");
    expect(params).toContain("branch-9");

    vi.doUnmock("../../../db/mysql.js");
    vi.resetModules();
  });
});
