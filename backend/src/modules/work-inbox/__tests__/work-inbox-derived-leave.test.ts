import { beforeEach, describe, expect, it, vi } from "vitest";

const { dbExecute } = vi.hoisted(() => ({ dbExecute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute: dbExecute } }));

import { getMyWorkItems } from "../work-inbox.service.js";

/**
 * LEAVE_APPROVAL_PENDING is declared in action-item-registry.ts, but no INSERT anywhere in
 * the backend has ever written that item_type. Production carries 27 leave requests in
 * 'pending' that appeared in no inbox, while the type they belong to was advertised as
 * supported.
 *
 * It is derived from leave_request rather than produced into work_item: deriving needs no
 * backfill for the 27 already waiting, and cannot go stale once a request is approved.
 */
describe("work inbox derived leave approvals", () => {
  beforeEach(() => {
    dbExecute.mockReset();
    dbExecute.mockResolvedValue([[], []]);
  });

  async function capture(userId: string, role: string) {
    await getMyWorkItems(userId, role);
    const [sql, params] = dbExecute.mock.calls[0];
    const raw = String(sql);
    return {
      sql: raw,
      /**
       * Comments stripped. A negative assertion such as `not.toContain("day(s)")` otherwise
       * matches the comment explaining why that rendering was wrong, so the test would pass
       * or fail on prose rather than on the query.
       */
      code: raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n]*/g, ""),
      params: params as unknown[],
    };
  }

  it("derives pending leave from the source table, not from a producer row", async () => {
    const { code } = await capture("user-1", "hr");
    expect(code).toContain("FROM leave_request lr");
    expect(code).toContain("'LEAVE_APPROVAL_PENDING' AS item_type");
    expect(code).toContain("LOWER(COALESCE(lr.status, '')) = 'pending'");
  });

  it("routes to the reporting manager with an HR fallback", async () => {
    // Of the 27 pending, 9 have no reporting manager and only 5 of the 7 named managers
    // hold a user account — manager routing alone strands a third of the queue.
    const { code } = await capture("user-1", "hr");
    expect(code).toContain("LEFT JOIN employees mgr ON mgr.id = e.reporting_manager_id");
    expect(code).toContain("mgr.user_id = ?");
    expect(code).toContain("? IN ('hr', 'hr_head', 'admin', 'super_admin')");
  });

  it("binds the derived branch's parameters in the right order", async () => {
    // Five placeholders across the union: work_item(userId, role), work_inbox_item(userId),
    // then the derived branch (userId, role). A mismatch silently scopes the inbox to the
    // wrong person rather than raising.
    const { params } = await capture("user-7", "manager");
    expect(params).toEqual(["user-7", "manager", "user-7", "user-7", "manager"]);
  });

  it("keeps the two pre-existing sources intact", async () => {
    const { code } = await capture("user-1", "hr");
    expect(code).toContain("FROM work_item wi");
    expect(code).toContain("FROM work_inbox_item wii");
    // Three sources, so exactly two UNION ALLs.
    expect(code.match(/UNION ALL/g)?.length).toBe(2);
  });

  it("formats whole and half days without exposing the DECIMAL", async () => {
    // total_days is DECIMAL(x,2), so a plain CONCAT renders a trailing ".00".
    const { code } = await capture("user-1", "hr");
    expect(code).toContain("TRIM(TRAILING '0' FROM COALESCE(lr.total_days, 0))");
    expect(code).toContain("' day from '");
    expect(code).toContain("' days from '");
    expect(code).not.toContain("day(s)");
  });

  it("namespaces the derived id so it cannot collide with a work_item id", async () => {
    const { code } = await capture("user-1", "hr");
    expect(code).toContain("CONCAT('leave:', lr.id) AS id");
  });
});
