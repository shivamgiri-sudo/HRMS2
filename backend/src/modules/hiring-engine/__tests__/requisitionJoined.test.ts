import { beforeEach, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ affected: 3, fail: false, sqls: [] as string[] }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute: vi.fn(async (sql: string) => { h.sqls.push(sql); if (h.fail) throw new Error("boom"); return [{ affectedRows: h.affected }, []]; }) } }));
vi.mock("../../../logger.js", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
import { refreshJoinedHeadcount } from "../requisition-joined.service.js";
beforeEach(() => { h.affected = 3; h.fail = false; h.sqls = []; });
describe("refreshJoinedHeadcount", () => {
  it("counts distinct employees with an employee code through both candidate paths and writes only changed rows", async () => {
    expect(await refreshJoinedHeadcount()).toBe(3);
    const sql = h.sqls[0];
    expect(sql).toContain("ats_candidate c JOIN ats_onboarding_bridge");
    expect(sql).toContain("job_requisition_candidate jrc JOIN ats_onboarding_bridge");
    expect(sql).toContain("e.employee_code IS NOT NULL");
    expect(sql).toContain("WHERE jr.joined_headcount <> COALESCE(x.n, 0)");
  });
  it("never throws", async () => { h.fail = true; expect(await refreshJoinedHeadcount()).toBe(0); });
});
