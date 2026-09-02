import { beforeEach, describe, expect, it, vi } from "vitest";

const { dbExecute } = vi.hoisted(() => ({ dbExecute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute: dbExecute } }));

import { getMyWorkItems } from "../work-inbox.service.js";

/**
 * action-item-registry.ts declares ~22 inbox types. Only 13 are ever written by an INSERT,
 * and the everyday approval queues are among the missing: LEAVE_APPROVAL_PENDING,
 * FF_CLEARANCE_PENDING and BGV_PENDING were advertised as supported while nothing produced
 * them.
 *
 * Each is derived from its source table rather than produced into work_item — no backfill
 * for the items already waiting, and no way to go stale once the source row is actioned.
 *
 * Two registry types are deliberately NOT derived: REGULARIZATION_PENDING (0 pending in
 * production) and RESIGNATION_PENDING_REVIEW (0 pending). Deriving an empty queue adds a
 * query per inbox load and surfaces nothing.
 */
describe("work inbox derived approval queues", () => {
  beforeEach(() => {
    dbExecute.mockReset();
    dbExecute.mockResolvedValue([[], []]);
  });

  async function capture(userId: string, role: string) {
    await getMyWorkItems(userId, role);
    const [sql, params] = dbExecute.mock.calls[0];
    const raw = String(sql);
    return {
      /**
       * Comments stripped. A negative assertion otherwise matches the comment explaining
       * why something was wrong, so the test turns on prose rather than on the query.
       */
      code: raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n]*/g, ""),
      params: params as unknown[],
    };
  }

  it("derives all three queues from their source tables", async () => {
    const { code } = await capture("user-1", "hr");
    expect(code).toContain("FROM leave_request lr");
    expect(code).toContain("FROM exit_clearance_task t");
    expect(code).toContain("FROM candidate_bgv_check b");
    for (const type of ["LEAVE_APPROVAL_PENDING", "FF_CLEARANCE_PENDING", "BGV_PENDING"]) {
      expect(code).toContain(`'${type}' AS item_type`);
    }
  });

  it("routes exit clearance by the table's own ownership, inventing no fallback", async () => {
    // owner_role is populated on all 16 pending rows; owner_user_id is NULL on every one but
    // is honoured first so per-person assignment works the moment it starts being set.
    const { code } = await capture("user-1", "hr");
    expect(code).toContain("(t.owner_user_id = ? OR t.owner_role = ?)");
  });

  it("carries the real due date for exit clearance", async () => {
    // Unlike leave, this table has a due_date, so these items can genuinely be overdue
    // rather than only aged.
    const { code } = await capture("user-1", "hr");
    expect(code).toContain("t.due_date AS due_at");
  });

  it("surfaces only BGV checks a person can act on", async () => {
    // not_started and queued are waiting on the provider, not a human.
    const { code } = await capture("user-1", "hr");
    expect(code).toContain("IN ('manual_review', 'mismatch')");
    expect(code).not.toContain("'not_started'");
    expect(code).not.toContain("'queued'");
  });

  it("keeps BGV checks whose candidate record is missing", async () => {
    // 17 of the 58 have no surviving ats_candidate row. An INNER JOIN would hide exactly
    // the checks whose data is already damaged.
    const { code } = await capture("user-1", "hr");
    expect(code).toContain("LEFT JOIN ats_candidate c ON c.id = b.candidate_id");
    expect(code).toContain("CONCAT('candidate ', b.candidate_id)");
  });

  it("binds every branch's parameters in order", async () => {
    // work_item(userId, role), work_inbox_item(userId), leave(userId, role),
    // exit clearance(userId, role), bgv(role), grn(role, role), budget(role, role).
    // Misalignment scopes the inbox to the wrong person silently rather than raising.
    const { params } = await capture("user-7", "manager");
    expect(params).toEqual([
      "user-7", "manager",
      "user-7",
      "user-7", "manager",
      "user-7", "manager",
      "manager",
      "manager", "manager",
      "manager", "manager",
    ]);
  });

  it("namespaces every derived id so none can collide with a work_item id", async () => {
    const { code } = await capture("user-1", "hr");
    expect(code).toContain("CONCAT('leave:', lr.id) AS id");
    expect(code).toContain("CONCAT('exitclr:', t.id) AS id");
    expect(code).toContain("CONCAT('bgv:', b.id) AS id");
    expect(code).toContain("CONCAT('grn:', g.id) AS id");
    expect(code).toContain("CONCAT('budget:', fb.id) AS id");
  });

  it("keeps the two original sources and unions five derived queues, seven branches total", async () => {
    const { code } = await capture("user-1", "hr");
    expect(code).toContain("FROM work_item wi");
    expect(code).toContain("FROM work_inbox_item wii");
    expect(code.match(/UNION ALL/g)?.length).toBe(6);
  });

  it("derives GRN and Branch Budget approvals, staged by the caller's role", async () => {
    const { code } = await capture("user-1", "finance_head");
    expect(code).toContain("FROM grn_request g");
    expect(code).toContain("FROM finance_budget_header fb");
    expect(code).toContain("'GRN_APPROVAL_PENDING' AS item_type");
    expect(code).toContain("'BUDGET_APPROVAL_PENDING' AS item_type");
    expect(code).toContain("g.status = 'submitted' AND ? IN ('branch_head', 'super_admin')");
    expect(code).toContain("g.status = 'branch_head_approved' AND ? IN ('finance_head', 'super_admin')");
    expect(code).toContain("fb.status = 'submitted' AND ? IN ('branch_head', 'finance_head', 'super_admin')");
    expect(code).toContain("fb.status = 'branch_head_approved' AND ? IN ('finance_head', 'super_admin')");
  });
});
