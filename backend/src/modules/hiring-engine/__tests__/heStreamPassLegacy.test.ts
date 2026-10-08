import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StreamRow } from "../requisition-stream.service.js";

/**
 * planStreamsForDay as it was before show-rate calibration: the exact SQL, parameters, order, collaborator calls and result for one
 * requisition with two open streams (one sharing the plan default, one with an HR-set daily quota) and no drive yet. Written on the
 * untouched code. Never update this snapshot.
 */
const h = vi.hoisted(() => ({
  calls: [] as Array<[string, unknown]>,
  credited: {} as Record<string, number>,
  createDrive: vi.fn(async (i: { requisitionId: string; driveDate: string }) => ({ id: `d-${i.requisitionId}-${i.driveDate}`, invites: 400, targetShows: 100, capacity: 400 })),
  setDriveStatus: vi.fn(async () => undefined),
  lineUp: vi.fn(async (_d: string, o: { limit?: number; followupStream?: { streamId: string } | null }) => {
    const sid = o.followupStream?.streamId ?? "?";
    const leadIds = Array.from({ length: Math.min(3, o.limit ?? 0) }, (_, i) => `${sid}-L${i}`);
    return { suggested: leadIds.length, blockedByReason: {}, considered: leadIds.length, leadIds };
  }),
  bridge: vi.fn(async () => ({ poolRows: 0, linked: 0 })),
  enqueue: vi.fn(async () => ({ enqueued: 0, exists: 0, handedOver: 0 })),
}));

const stream = (id: string, sourceType: StreamRow["sourceType"], originId: string, dailyInvites: number | null): StreamRow => ({
  id, requisitionId: "r1", branchName: "Noida", sourceType, originId, originLabel: id === "a" ? "" : "Campaign B",
  openFrom: "2026-10-12", openDays: 10, dailyInvites, status: "open", closedReason: null, createdBy: null, createdAt: "2026-10-10 10:00:00",
  add: [], skip: [], version: 1,
});
const STREAMS: StreamRow[] = [stream("a", "he", "r1", null), stream("b", "meta_live", "c1", 40)];

vi.mock("../../../db/mysql.js", () => ({
  db: {
    execute: vi.fn(async (sql: string, params: unknown[] = []) => {
      const q = sql.replace(/\s+/g, " ").trim();
      h.calls.push([q, params]);
      if (q.includes("FROM job_requisition WHERE id = ?")) return [[{ id: "r1", requisition_code: "REQ-1", branch_name: "Noida", approval_status: "approved", active_status: 1, requested_headcount: 10, fulfilled_headcount: 2 }]];
      if (q.startsWith("SELECT status, run_label")) return [[{ status: "draft", run_label: "Streams", source_kind: "pool", created_by: null }]];
      if (q.includes("COUNT(*) AS n FROM requisition_stream_match")) return [[{ n: h.credited[String(params[0])] ?? 0 }]];
      if (q.startsWith("INSERT INTO requisition_stream_match")) {
        const [sid, , , ...leads] = params.map(String);
        h.credited[sid] = (h.credited[sid] ?? 0) + leads.length;
        return [{ affectedRows: leads.length }];
      }
      if (q.startsWith("INSERT") || q.startsWith("UPDATE")) return [{ affectedRows: 1 }];
      return [[]];
    }),
    getConnection: vi.fn(async () => ({
      execute: vi.fn(async (sql: string, params: unknown[] = []) => {
        h.calls.push([`conn: ${sql}`, params]);
        return sql.includes("GET_LOCK") ? [[{ got: 1 }]] : [[{ released: 1 }]];
      }),
      release: vi.fn(), destroy: vi.fn(),
    })),
  },
}));
vi.mock("../../../logger.js", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock("../qualified-followup.service.js", () => ({ enqueueMatchedFollowups: h.enqueue }));
vi.mock("../requisition-stream.service.js", async (orig) => ({
  ...(await orig<typeof import("../requisition-stream.service.js")>()),
  loadActiveStreams: vi.fn(async (o: { requisitionId?: string } = {}) => { h.calls.push(["loadActiveStreams", o]); return STREAMS.map((s) => ({ ...s })); }),
  autoCloseStreams: vi.fn(async (d: string, dry: boolean) => { h.calls.push(["autoCloseStreams", [d.length, dry]]); return []; }),
}));
vi.mock("../he-drive.service.js", () => ({ createDrive: h.createDrive, setDriveStatus: h.setDriveStatus, lineUpCandidates: h.lineUp, suggestMatches: vi.fn() }));
vi.mock("../he-meta-bridge.service.js", () => ({ bridgeMetaLeads: h.bridge }));
vi.mock("../he-policy.service.js", () => ({
  // 100 walk-ins at 25 % over 15 slots: 400 invites a day
  getDailyPlan: vi.fn(async () => ({ walkInsPerDay: 100, minOutreachPerDay: 0, showRatePct: 25, slotStart: "10:00", slotEnd: "17:30", slotMinutes: 30 })),
}));

import { planStreamsForDay } from "../he-stream-plan.service.js";

const collaborators = () => ({
  createDrive: h.createDrive.mock.calls, setDriveStatus: h.setDriveStatus.mock.calls, lineUp: h.lineUp.mock.calls,
  bridge: h.bridge.mock.calls, enqueue: h.enqueue.mock.calls,
});

beforeEach(() => {
  delete process.env.HE_SHOWRATE_CALIBRATION;
  h.calls.length = 0;
  h.credited = {};
  for (const f of [h.createDrive, h.setDriveStatus, h.lineUp, h.bridge, h.enqueue]) f.mockClear();
});

describe("planStreamsForDay before calibration (snapshot of today's behaviour)", () => {
  it("live: creates the drive and lines up each stream to its cap", async () => {
    const r = await planStreamsForDay({ date: "2026-10-15", dryRun: false });
    expect(h.calls).toMatchSnapshot("sql");
    expect(collaborators()).toMatchSnapshot("collaborators");
    expect(r).toMatchSnapshot("result");
  });

  it("dry run", async () => {
    const r = await planStreamsForDay({ date: "2026-10-15", dryRun: true });
    expect(h.calls).toMatchSnapshot("sql");
    expect(collaborators()).toMatchSnapshot("collaborators");
    expect(r).toMatchSnapshot("result");
  });
});
