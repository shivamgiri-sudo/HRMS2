// Proof that the Plan section cannot write: the REAL Plan 3 stream pass runs (dry run) against a recording database mock.
import { beforeEach, describe, expect, it, vi } from "vitest";

const execute = vi.hoisted(() => vi.fn());
const getConnection = vi.hoisted(() => vi.fn());
vi.mock("../../../db/mysql.js", () => ({ db: { execute, query: execute, getConnection } }));
vi.mock("../../../logger.js", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock("../he-readiness.service.js", () => ({ getRequisitionReadiness: async () => ({ requisitionId: "r1", code: "REQ-1", branch: "Pune", ok: true, problems: [] }) }));

import { clearDrivePlanCache, getDrivePlan } from "../he-drive-plan.service.js";

const stream = { id: "s1", requisition_id: "r1", branch_name: "Pune", source_type: "meta_live", origin_id: "c1", origin_label: "Campaign", open_from: "2026-10-15", open_days: 3,
  daily_invites: 50, status: "open", closed_reason: null, created_by: null, created_at: "2026-10-01 10:00:00", version: 1 };

beforeEach(() => {
  vi.clearAllMocks();
  clearDrivePlanCache();
  execute.mockImplementation(async (sql: string) => {
    const q = String(sql);
    if (q.includes("FROM job_requisition WHERE id = ?")) return [[{ id: "r1", requisition_code: "REQ-1", branch_name: "Pune", approval_status: "approved", active_status: 1, requested_headcount: 10, fulfilled_headcount: 2 }]];
    if (q.includes("FROM job_requisition WHERE id")) return [[{ requisition_code: "REQ-1", branch_name: "Pune", requested_headcount: 10, fulfilled_headcount: 2 }]];
    if (q.includes("FROM requisition_stream s") && q.includes("LEFT JOIN job_requisition")) return [[{ ...stream, approval_status: "approved", active_status: 1, requested_headcount: 10, fulfilled_headcount: 2, jr_id: "r1" }]];
    if (q.includes("FROM requisition_stream WHERE")) return [[stream]];
    if (q.includes("requisition_stream_day") || q.includes("requisition_stream_exception")) return [[]];
    if (q.includes("COUNT(*) AS n FROM requisition_stream_match")) return [[{ n: 0 }]];
    if (q.includes("he_lead_campaign")) return [[{ n: 80 }]];
    if (q.includes("COUNT(")) return [[{ n: 0 }]];
    return [[]];
  });
});

describe("getDrivePlan is read-only end to end", () => {
  it("runs the real dry-run pass and issues only SELECT statements, no lock, no transaction connection", async () => {
    const r = await getDrivePlan({ requisitionId: "r1", from: "2026-10-15", days: 2 }, { all: true } as never, new Date("2026-10-14T06:00:00Z"));
    expect(r).not.toBeNull();
    const text = r!.checklist.items.find((i) => i.kind === "will_plan")?.text ?? "";
    expect(text).toMatch(/^Tonight the evening pass will create the drive and line up 50 people/);
    const all = execute.mock.calls.map((c) => String(c[0]));
    expect(all.length).toBeGreaterThan(5);
    for (const q of all) {
      expect(q.trim()).toMatch(/^SELECT/i);
      expect(q).not.toMatch(/\b(INSERT|UPDATE|DELETE|REPLACE|GET_LOCK|RELEASE_LOCK|ALTER|CREATE|DROP)\b/i);
    }
    expect(getConnection).not.toHaveBeenCalled();
  });
});
