/**
 * Penny drop that came back manual_review and was then accepted by HR on the BGV report (candidate_bgv_check
 * bank = verified) is done. Both the summary count and the drill-down list must treat it as done, or the
 * joiner stays listed as "waiting for manual bank review" after the review (live 2026-10-17: 5 joiners).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { dbExecute } = vi.hoisted(() => ({ dbExecute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute: dbExecute } }));

import * as svc from "../ops-control-tower.service.js";

const B = "b0000000-0000-0000-0000-000000000001";
let sqls: string[] = [];

beforeEach(() => {
  sqls = [];
  dbExecute.mockReset();
  dbExecute.mockImplementation(async (sql: string) => {
    sqls.push(sql);
    return [sql.includes("FROM branch_master") ? [{ id: B, branch_name: "NOIDA" }] : []];
  });
});

async function sqlOf(fn: () => Promise<unknown>): Promise<string> {
  sqls = [];
  await fn();
  return sqls.filter((q) => !q.includes("FROM branch_master")).join("\n");
}

describe("HR-accepted bank check counts as penny drop done", () => {
  it("the evidence is a verified, non-mock bank check on the joiner's own candidate", () => {
    const sql = svc.HR_ACCEPTED_BANK_CHECK_SQL;
    expect(sql).toContain("pb4.employee_id = e.id");
    expect(sql).toContain("bk.check_type = 'bank'");
    expect(sql).toContain("bk.status = 'verified'");
    expect(sql).toContain("NOT LIKE '%mock%'");
    // manual_review / mismatch must stay pending
    expect(sql).not.toContain("manual_review");
  });

  it("summary count excludes HR-accepted joiners", async () => {
    const sql = await sqlOf(() => svc.getPennyDropMissingBlock());
    expect(sql).toContain(`AND NOT (`);
    expect(sql).toContain(svc.HR_ACCEPTED_BANK_CHECK_SQL);
  });

  it("drill-down list excludes HR-accepted joiners, so the number and the list agree", async () => {
    const sql = await sqlOf(() => svc.getPennyDropMissingDetail(B));
    expect(sql).toContain(svc.HR_ACCEPTED_BANK_CHECK_SQL);
  });
});
