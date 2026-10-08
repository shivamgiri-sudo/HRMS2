import { beforeEach, describe, expect, it, vi } from "vitest";

const execute = vi.hoisted(() => vi.fn());
vi.mock("../../../db/mysql.js", () => ({ db: { execute, query: execute, getConnection: vi.fn() } }));
vi.mock("../../../logger.js", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

import { listLaunches } from "../he-launch.service.js";

// prod shape: a Meta drive made by the engine's meta-only plan has source_kind 'meta' and no run_label
const metaDrive = { id: "d-meta", run_label: null, source_kind: "meta", source_ids: null, drive_date: "2026-09-21", status: "active", reinvite: 0, auto_send: 1,
  requisition_code: "RQ-1", designation_name: "Agent", branch_name: "Pune", lined: 12, invited: 5, confirmed: 2, arrived: 1, no_show: 0, declined: 0, emailed: 0, whatsapped: 0, called: 0, replied: 0 };
let sqls: Array<{ sql: string; params: unknown[] }> = [];
beforeEach(() => {
  sqls = [];
  execute.mockImplementation(async (sql: string, params: unknown[] = []) => {
    sqls.push({ sql: String(sql), params });
    return String(sql).includes("FROM he_drive d") ? [[metaDrive]] : [[]];
  });
});

describe("listLaunches", () => {
  it("returns non-pool drives including source_kind meta with no run_label", async () => {
    const rows = await listLaunches();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ driveId: "d-meta", kind: "meta", label: "", requisition: "RQ-1", lined: 12, date: "2026-09-21" });
    const main = sqls.find((s) => s.sql.includes("FROM he_drive d"))!;
    expect(main.sql).toContain("d.source_kind <> 'pool'");
    expect(main.sql).not.toContain("requisition_code = ?");
    expect(main.params).toEqual([40]);
  });
  it("filters by requisition code in SQL (so an older drive is not cut off by the latest-N limit) and lifts the limit", async () => {
    await listLaunches(100, "RQ-1");
    const main = sqls.find((s) => s.sql.includes("FROM he_drive d"))!;
    expect(main.sql).toContain("jr.requisition_code = ?");
    expect(main.params).toEqual(["RQ-1", 100]);
  });
  it("a blank filter means no filter", async () => {
    await listLaunches(40, "  ");
    expect(sqls.find((s) => s.sql.includes("FROM he_drive d"))!.params).toEqual([40]);
  });
});
