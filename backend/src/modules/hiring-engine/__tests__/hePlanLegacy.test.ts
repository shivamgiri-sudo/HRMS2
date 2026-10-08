import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * planNextDay for requisitions with NO stream: the exact SQL, parameters, order and result it produced before streams existed.
 * Statements that name a requisition_stream* table are filtered out (the stream pass adds them); everything else must match the
 * snapshot written on the untouched code. Never update this snapshot.
 */
const h = vi.hoisted(() => ({
  calls: [] as Array<[string, unknown[]]>,
  drives: {} as Record<string, { id: string; status: string }>,
  createDrive: vi.fn(async (i: { requisitionId: string }) => ({ id: `d-${i.requisitionId}`, invites: 400, targetShows: 100, capacity: 400 })),
  setDriveStatus: vi.fn(async () => undefined),
  suggestMatches: vi.fn(async () => 7),
  sweepOwnedCampaigns: vi.fn(async () => ({ poolRows: 0, linked: 0 })),
  bridgeAllMetaLeads: vi.fn(async () => ({ poolRows: 0, linked: 0 })),
  bridgeMetaLeads: vi.fn(async () => ({ poolRows: 0, linked: 0 })),
  metaOnly: false,
}));

const reqs: Record<string, Record<string, unknown>> = {
  r1: { id: "r1", requisition_code: "REQ-1", designation_name: "Agent", branch_name: "Noida", approval_status: "approved", active_status: 1, requested_headcount: 10, fulfilled_headcount: 2 },
  r2: { id: "r2", requisition_code: "REQ-2", designation_name: "Agent", branch_name: "Noida", approval_status: "approved", active_status: 1, requested_headcount: 5, fulfilled_headcount: 0 },
  r3: { id: "r3", requisition_code: "REQ-3", designation_name: "Caller", branch_name: "Pune", approval_status: "approved", active_status: 1, requested_headcount: 4, fulfilled_headcount: 4 },
  r4: { id: "r4", requisition_code: "REQ-4", designation_name: "Caller", branch_name: "Pune", approval_status: "approved", active_status: 1, requested_headcount: 4, fulfilled_headcount: 0 },
};

vi.mock("../../../db/mysql.js", () => ({
  db: {
    execute: vi.fn(async (sql: string, params: unknown[] = []) => {
      h.calls.push([sql.replace(/\s+/g, " ").trim(), params]);
      if (sql.includes("FROM meta_campaign c JOIN he_campaign_config")) return [[{ requisition_id: "r2", id: "c2" }, { requisition_id: "r4", id: "c4" }, { requisition_id: "r2", id: "c2b" }]];
      if (sql.includes("FROM job_requisition WHERE id = ?")) return [[reqs[String(params[0])]].filter(Boolean)];
      if (sql.includes("FROM he_drive WHERE requisition_id = ? AND drive_date = ?")) { const d = h.drives[String(params[0])]; return [d ? [d] : []]; }
      return [[]];
    }),
    getConnection: vi.fn(async () => { throw new Error("no connection in this test"); }),
  },
}));
vi.mock("../../../logger.js", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock("../he-drive.service.js", () => ({ createDrive: h.createDrive, setDriveStatus: h.setDriveStatus, suggestMatches: h.suggestMatches, lineUpCandidates: vi.fn() }));
vi.mock("../he-meta-bridge.service.js", () => ({ sweepOwnedCampaigns: h.sweepOwnedCampaigns, bridgeAllMetaLeads: h.bridgeAllMetaLeads, bridgeMetaLeads: h.bridgeMetaLeads }));
vi.mock("../he-policy.service.js", async () => {
  const { DEFAULT_DAILY_PLAN } = await import("../he-slots.js");
  return { getDailyPlan: vi.fn(async () => DEFAULT_DAILY_PLAN), getPlanMetaOnly: vi.fn(async () => h.metaOnly), getPlanRequisitions: vi.fn(async () => ["r1", "r3", "r9"]) };
});
vi.mock("../he-readiness.service.js", () => ({ getRequisitionReadiness: vi.fn(async () => null) }));

import { planNextDay } from "../he-plan.service.js";

const legacyCalls = () => h.calls.filter(([sql]) => !sql.includes("requisition_stream"));
const mockCalls = () => ({
  createDrive: h.createDrive.mock.calls, setDriveStatus: h.setDriveStatus.mock.calls, suggestMatches: h.suggestMatches.mock.calls,
  sweepOwnedCampaigns: h.sweepOwnedCampaigns.mock.calls.length, bridgeAllMetaLeads: h.bridgeAllMetaLeads.mock.calls,
});

beforeEach(() => {
  h.calls.length = 0;
  h.drives = { r2: { id: "old-r2", status: "closed" }, r4: { id: "d-r4", status: "active" } };
  h.metaOnly = false;
  for (const f of [h.createDrive, h.setDriveStatus, h.suggestMatches, h.sweepOwnedCampaigns, h.bridgeAllMetaLeads, h.bridgeMetaLeads]) f.mockClear();
});

describe("planNextDay before streams (snapshot of today's behaviour)", () => {
  it("plan list + engine-owned campaigns, live", async () => {
    const r = await planNextDay({ date: "2026-10-08" });
    expect(legacyCalls()).toMatchSnapshot("sql");
    expect(mockCalls()).toMatchSnapshot("collaborators");
    expect({ date: r.date, invitesPerDay: r.invitesPerDay, seatsPerSlot: r.seatsPerSlot, days: r.days }).toMatchSnapshot("result");
  });

  it("meta-only plan, live", async () => {
    h.metaOnly = true;
    const r = await planNextDay({ date: "2026-10-08" });
    expect(legacyCalls()).toMatchSnapshot("sql");
    expect(mockCalls()).toMatchSnapshot("collaborators");
    expect(r.days).toMatchSnapshot("days");
  });

  it("dry run", async () => {
    const r = await planNextDay({ date: "2026-10-08", dryRun: true });
    expect(legacyCalls()).toMatchSnapshot("sql");
    expect(mockCalls()).toMatchSnapshot("collaborators");
    expect(r.days).toMatchSnapshot("days");
  });

  it("a createDrive failure is reported as skipped", async () => {
    h.createDrive.mockRejectedValueOnce(new Error("Requisition has no open positions"));
    const r = await planNextDay({ date: "2026-10-08" });
    expect(legacyCalls()).toMatchSnapshot("sql");
    expect(r.days).toMatchSnapshot("days");
  });
});
