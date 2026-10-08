import { describe, it, expect, vi, beforeEach } from "vitest";

const dbExecute = vi.hoisted(() => vi.fn());
vi.mock("../../../db/mysql.js", () => ({ db: { execute: dbExecute } }));

import { listPendingManagerApplications } from "../ijp.service.js";

describe("listPendingManagerApplications", () => {
  beforeEach(() => {
    dbExecute.mockReset();
    dbExecute.mockResolvedValue([[{ id: "a1", status: "pending_manager", offer_details: null }], []]);
  });

  it("only selects pending_manager rows assigned to the caller's employee id", async () => {
    const rows = await listPendingManagerApplications("emp-9");
    const [sql, params] = dbExecute.mock.calls[0];
    expect(sql).toMatch(/a\.manager_id = \?/);
    expect(sql).toMatch(/a\.status = 'pending_manager'/);
    expect(params).toEqual(["emp-9"]);
    expect(rows.map((r) => r.id)).toEqual(["a1"]);
  });

  it("caps the page size at 200", async () => {
    await listPendingManagerApplications("emp-9", 99999);
    expect(dbExecute.mock.calls[0][0]).toMatch(/LIMIT 200 OFFSET 0/);
  });
});
