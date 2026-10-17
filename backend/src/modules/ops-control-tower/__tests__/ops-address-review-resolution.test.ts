/**
 * Address review (WFM issue 10): a candidate whose address check HR already decided on the BGV report form
 * (candidate_bgv_report.address_status passed / failed) is resolved, even though that path never updates the
 * geo-selfie row. Both the count and the list must drop them.
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

const RESOLVED_ON_REPORT =
  "NOT EXISTS (SELECT 1 FROM candidate_bgv_report rr WHERE rr.candidate_id = v.candidate_id AND rr.address_status IN ('passed','failed'))";

describe("address review queue honours a reviewer resolution on the BGV report", () => {
  it("summary excludes candidates already passed / failed on the report", async () => {
    await svc.getAddressReviewPendingBlock();
    expect(sqls.find((q) => q.includes("candidate_bgv_address_verification"))).toContain(RESOLVED_ON_REPORT);
  });
  it("list excludes them too, so the number and the list agree", async () => {
    await svc.getAddressReviewPendingDetail(B);
    expect(sqls.find((q) => q.includes("candidate_bgv_address_verification"))).toContain(RESOLVED_ON_REPORT);
  });
});
