import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StreamRow } from "../requisition-stream.service.js";

/** D-1 stream pass (he-stream-plan.service), its hook in planNextDay and the engine's stream-aware re-line-up. */
const h = vi.hoisted(() => ({
  calls: [] as Array<[string, unknown[]]>,
  lockCalls: [] as string[],
  st: {
    ownedFails: false, owned: [] as string[],
    req: null as Record<string, unknown> | null,
    drives: {} as Record<string, { id: string; status: string }>,
    already: {} as Record<string, number>,
    origin: true, lockGot: 1 as number | null, releaseFails: false,
    topDrive: null as Record<string, unknown> | null,
    fed: [] as string[], planReqs: [] as string[],
  },
  streams: [] as StreamRow[],
  autoClose: vi.fn(async (_d: string, _dry: boolean) => [] as Array<{ streamId: string; requisitionId: string; reason: "window_ended" }>),
  createDrive: vi.fn(async (i: { requisitionId: string; driveDate: string }) => ({ id: `new-${i.driveDate}`, invites: 30, targetShows: 6, capacity: 30 })),
  setDriveStatus: vi.fn(async () => undefined),
  suggestMatches: vi.fn(async () => 2),
  lineUp: vi.fn(async (_d: string, o: { limit?: number; followupStream?: { streamId: string } | null }) => ({
    suggested: o.limit ?? 0, blockedByReason: {}, considered: 0, leadIds: Array.from({ length: o.limit ?? 0 }, (_, i) => `${o.followupStream?.streamId}-L${i}`),
  })),
  bridge: vi.fn(async () => ({ poolRows: 0, linked: 0 })),
  destroy: vi.fn(), release: vi.fn(),
}));

vi.mock("../../../db/mysql.js", () => ({
  db: {
    execute: vi.fn(async (sql: string, params: unknown[] = []) => {
      const q = sql.replace(/\s+/g, " ").trim();
      h.calls.push([q, params]);
      const st = h.st;
      if (q.startsWith("SELECT DISTINCT requisition_id FROM requisition_stream")) { if (st.ownedFails) throw Object.assign(new Error("boom"), { code: "ER_LOCK_WAIT_TIMEOUT" }); return [st.owned.map((requisition_id) => ({ requisition_id }))]; }
      if (q.includes("FROM requisition_stream_plan WHERE drive_id IN")) return [st.fed.map((drive_id) => ({ drive_id }))];
      if (q.includes("FROM job_requisition WHERE id = ?")) return [st.req ? [st.req] : []];
      if (q.includes("FROM he_drive WHERE requisition_id = ? AND branch_name = ? AND drive_date = ?")) { const d = st.drives[String(params[2])]; return [d ? [d] : []]; }
      if (q.includes("FROM he_drive WHERE requisition_id = ? AND drive_date = ?")) return [[]];
      if (q.includes("COUNT(*) AS n FROM requisition_stream_match")) return [[{ n: st.already[String(params[0])] ?? 0 }]];
      if (q.includes("FROM he_drive WHERE id = ? AND source_kind <> 'pool'")) return [st.origin ? [{ source_kind: "campaign", source_ids: ["c-old"], max_lead_age_days: 90 }] : []];
      if (q.includes("FROM he_drive WHERE id = ? LIMIT 1")) return [st.topDrive ? [st.topDrive] : []];
      if (q.startsWith("INSERT IGNORE INTO requisition_stream_match")) return [{ affectedRows: params.length - 3 }];
      if (q.startsWith("INSERT") || q.startsWith("UPDATE") || q.startsWith("DELETE")) return [{ affectedRows: 1 }];
      if (q.includes("COUNT(*) AS n FROM he_template")) return [[{ n: 1 }]];
      if (q.includes("SELECT id FROM he_drive WHERE status = 'active' AND auto_send = 1")) return [[{ id: "fed" }, { id: "legacy" }]];
      return [[]];
    }),
    getConnection: vi.fn(async () => ({
      execute: vi.fn(async (sql: string) => {
        h.lockCalls.push(sql);
        if (sql.includes("GET_LOCK")) return [[{ got: h.st.lockGot }]];
        if (h.st.releaseFails) throw new Error("gone");
        return [[{ released: 1 }]];
      }),
      release: h.release, destroy: h.destroy,
    })),
  },
}));
vi.mock("../../../logger.js", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock("../requisition-stream.service.js", async (orig) => ({
  ...(await orig<typeof import("../requisition-stream.service.js")>()),
  loadActiveStreams: vi.fn(async (o: { requisitionId?: string } = {}) => h.streams.filter((s) => !o.requisitionId || s.requisitionId === o.requisitionId)),
  autoCloseStreams: h.autoClose,
}));
vi.mock("../he-readiness.service.js", () => ({ getRequisitionReadiness: vi.fn(async () => null) }));
vi.mock("../he-drive.service.js", () => ({ createDrive: h.createDrive, setDriveStatus: h.setDriveStatus, suggestMatches: h.suggestMatches, lineUpCandidates: h.lineUp, reserveSlot: vi.fn(async () => "slot") }));
vi.mock("../he-meta-bridge.service.js", () => ({ bridgeMetaLeads: h.bridge, sweepOwnedCampaigns: vi.fn(async () => ({ poolRows: 0, linked: 0 })), bridgeAllMetaLeads: vi.fn(async () => ({ poolRows: 0, linked: 0 })) }));
vi.mock("../he-policy.service.js", () => ({
  // 6 walk-ins at 20 % show-up and no outreach floor: 30 invites a day
  getDailyPlan: vi.fn(async () => ({ walkInsPerDay: 6, minOutreachPerDay: 0, showRatePct: 20, slotStart: "10:00", slotEnd: "17:30", slotMinutes: 30 })),
  getPlanMetaOnly: vi.fn(async () => false), getPlanRequisitions: vi.fn(async () => h.st.planReqs), whatsappRequiresOptIn: vi.fn(async () => false),
}));
vi.mock("../he-lead.service.js", () => ({ addEvent: vi.fn(), setLeadStatus: vi.fn() }));
vi.mock("../he-insight.service.js", () => ({ recomputeInsight: vi.fn() }));
vi.mock("../he-send.service.js", () => ({ sendTemplateToLead: vi.fn(async () => ({ status: "sent" })), sendsPaused: () => false }));
vi.mock("../he-email.service.js", () => ({ emailConfigured: () => true, sendInviteEmail: vi.fn(async () => ({ status: "sent" })), INVITE_EMAIL_KEY: "he_walkin_invite_email" }));
vi.mock("../he-voice.service.js", () => ({ placeVoiceCall: vi.fn() }));
vi.mock("../he-bulk-call.service.js", () => ({ runBulkCallJobs: vi.fn(async () => null) }));
vi.mock("../he-reroute.service.js", () => ({ offerOtherRoles: vi.fn(async () => null) }));
vi.mock("../he-followup-email.service.js", () => ({ sendFollowUpEmail: vi.fn(async () => ({ status: "skipped" })) }));

import { planStreamsForDay, streamCaps, streamDriveIds, topUpStreamDrive } from "../he-stream-plan.service.js";
import { planNextDay } from "../he-plan.service.js";
import { runEngineTick } from "../he-engine.service.js";

const stream = (id: string, over: Partial<StreamRow> = {}): StreamRow => ({
  id, requisitionId: "r1", branchName: "Noida", sourceType: "he", originId: "pool", originLabel: id, openFrom: "2026-10-08", openDays: 3,
  dailyInvites: null, status: "open", closedReason: null, createdBy: null, createdAt: "2026-10-07 10:00:00", add: [], skip: [], ...over,
});
const three = () => [
  stream("s1", { sourceType: "meta_live", originId: "c9", dailyInvites: 10, createdAt: "2026-10-07 09:00:00" }),
  stream("s2", { sourceType: "meta_old", originId: "d-old", createdAt: "2026-10-07 09:30:00" }),
  stream("s3", { sourceType: "he", originId: "pool", createdAt: "2026-10-07 10:00:00" }),
];
const openReq = { id: "r1", requisition_code: "REQ-1", approval_status: "approved", active_status: 1, requested_headcount: 10, fulfilled_headcount: 2 };
const sqls = () => h.calls.map(([q]) => q);
const credits = () => sqls().filter((q) => q.startsWith("INSERT IGNORE INTO requisition_stream_match"));
const writes = () => sqls().filter((q) => /^(INSERT|UPDATE|DELETE)/.test(q));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-07T18:00:00+05:30"));
  h.calls.length = 0; h.lockCalls.length = 0;
  h.st = { ownedFails: false, owned: [], req: { ...openReq }, drives: {}, already: {}, origin: true, lockGot: 1, releaseFails: false, topDrive: null, fed: [], planReqs: [] };
  h.streams = [];
  for (const f of [h.autoClose, h.createDrive, h.setDriveStatus, h.suggestMatches, h.lineUp, h.bridge, h.destroy, h.release]) f.mockClear();
});
afterEach(() => { vi.useRealTimers(); });

describe("streamCaps", () => {
  it("NULL streams share the plan default equally, rounded up, at least 1", () => {
    expect(Object.fromEntries(streamCaps([{ id: "a", dailyInvites: null }, { id: "b", dailyInvites: null }], 30))).toEqual({ a: 15, b: 15 });
    expect(Object.fromEntries(streamCaps([{ id: "a", dailyInvites: 10 }, { id: "b", dailyInvites: null }, { id: "c", dailyInvites: null }], 30))).toEqual({ a: 10, b: 15, c: 15 });
    expect(Object.fromEntries(streamCaps([{ id: "a", dailyInvites: null }], 0))).toEqual({ a: 1 });
    expect(Object.fromEntries(streamCaps([{ id: "a", dailyInvites: null }, { id: "b", dailyInvites: null }], 31))).toEqual({ a: 16, b: 16 });
  });
});

describe("planStreamsForDay", () => {
  it("creates the day's drive once and lines up each stream in creation order to its cap, crediting first touch", async () => {
    h.streams = three();
    const r = await planStreamsForDay({ date: "2026-10-08", dryRun: false });
    expect(h.createDrive).toHaveBeenCalledTimes(1);
    expect(h.createDrive.mock.calls[0][0]).toMatchObject({ requisitionId: "r1", driveDate: "2026-10-08", autoSend: true, audience: { kind: "pool", label: "Streams" }, slotCapacity: 2, showRatePct: 20, targetShows: 8 });
    expect(h.setDriveStatus).toHaveBeenCalledWith("new-2026-10-08", "active");
    // every stream is marked on the drive before it goes active
    const firstPlanRow = sqls().findIndex((q) => q.startsWith("INSERT INTO requisition_stream_plan"));
    expect(firstPlanRow).toBeGreaterThan(-1);
    expect(h.lineUp.mock.calls.map(([d, o]) => [d, o.limit, (o as { followupStream: { streamId: string } }).followupStream.streamId])).toEqual([["new-2026-10-08", 10, "s1"], ["new-2026-10-08", 15, "s2"], ["new-2026-10-08", 15, "s3"]]);
    for (const [, o] of h.lineUp.mock.calls) expect(o).toMatchObject({ excludeOnDrive: true, keepOtherSuggestions: true });
    expect((h.lineUp.mock.calls[0][1] as { audience: unknown }).audience).toEqual({ source_kind: "campaign", source_ids: ["c9"], max_lead_age_days: null });
    expect((h.lineUp.mock.calls[1][1] as { audience: unknown }).audience).toEqual({ source_kind: "campaign", source_ids: ["c-old"], max_lead_age_days: 90 });
    expect((h.lineUp.mock.calls[2][1] as { audience: unknown }).audience).toEqual({ source_kind: "pool", source_ids: null, max_lead_age_days: null });
    expect(credits()).toHaveLength(3);
    expect(h.bridge).toHaveBeenCalledTimes(1);
    expect(h.bridge).toHaveBeenCalledWith({ campaignIds: ["c9"], onlyUnlinked: true });
    expect(r.plans).toHaveLength(1);
    expect(r.plans[0]).toMatchObject({ requisitionId: "r1", code: "REQ-1", drive: "created", driveId: "new-2026-10-08" });
    expect(r.plans[0].streams.map((l) => [l.streamId, l.cap, l.alreadyLined, l.lined])).toEqual([["s1", 10, 0, 10], ["s2", 15, 0, 15], ["s3", 15, 0, 15]]);
    // the lock is taken per requisition and released
    expect(h.lockCalls[0]).toContain("GET_LOCK(?, 0)");
    expect(h.lockCalls.some((q) => q.includes("RELEASE_LOCK"))).toBe(true);
    expect(h.release).toHaveBeenCalledTimes(1);
    // auto-close runs first, as of today
    expect(h.autoClose).toHaveBeenCalledWith("2026-10-07", false);
    expect(h.autoClose.mock.invocationCallOrder[0]).toBeLessThan(h.createDrive.mock.invocationCallOrder[0]);
  });

  it("run again the same day with every cap reached: drive exists, no line-up, no INSERT (Review Focus 2)", async () => {
    h.streams = three();
    h.st.drives["2026-10-08"] = { id: "dx", status: "active" };
    h.st.already = { s1: 10, s2: 15, s3: 15 };
    const r = await planStreamsForDay({ date: "2026-10-08", dryRun: false });
    expect(h.createDrive).not.toHaveBeenCalled();
    expect(h.lineUp).not.toHaveBeenCalled();
    expect(sqls().some((q) => q.startsWith("INSERT"))).toBe(false);
    expect(r.plans[0]).toMatchObject({ drive: "exists", driveId: "dx" });
    expect(r.plans[0].streams.every((l) => l.lined === 0)).toBe(true);
  });

  it("an existing drive is reused untouched and only topped up to the cap", async () => {
    h.streams = [stream("s3", { dailyInvites: 5 })];
    h.st.drives["2026-10-08"] = { id: "dx", status: "draft" };
    h.st.already = { s3: 3 };
    const r = await planStreamsForDay({ date: "2026-10-08", dryRun: false });
    expect(h.lineUp.mock.calls[0][1]).toMatchObject({ limit: 2 });
    expect(h.setDriveStatus).not.toHaveBeenCalled();
    expect(sqls().some((q) => q.startsWith("UPDATE he_drive"))).toBe(false);
    expect(r.plans[0].streams[0]).toMatchObject({ alreadyLined: 3, lined: 2 });
    const plan = h.calls.find(([q]) => q.startsWith("INSERT INTO requisition_stream_plan"))!;
    expect(plan[1]).toEqual(["s3", "2026-10-08", "dx", 5]);
  });

  it("extension after the evening pass: Plan now for tomorrow creates the drive once; a second call creates nothing and lines nobody new", async () => {
    // window ended today (07 Oct), then extended by 1: now covers 08 Oct
    h.streams = [stream("s3", { openFrom: "2026-10-07", openDays: 2, dailyInvites: 4 })];
    const first = await planStreamsForDay({ date: "2026-10-08", requisitionId: "r1", dryRun: false });
    expect(first.plans[0]).toMatchObject({ drive: "created" });
    expect(h.createDrive).toHaveBeenCalledTimes(1);
    expect(h.lineUp).toHaveBeenCalledTimes(1);
    h.st.drives["2026-10-08"] = { id: "new-2026-10-08", status: "active" };
    h.st.already = { s3: 4 };
    h.calls.length = 0;
    const second = await planStreamsForDay({ date: "2026-10-08", requisitionId: "r1", dryRun: false });
    expect(second.plans[0]).toMatchObject({ drive: "exists" });
    expect(h.createDrive).toHaveBeenCalledTimes(1);
    expect(h.lineUp).toHaveBeenCalledTimes(1);
    expect(credits()).toHaveLength(0);
  });

  it("a filled requisition: no drive, skipped with the reason, auto-close ran first, no UPDATE he_drive (Review Focus 5)", async () => {
    h.streams = three();
    h.st.req = { ...openReq, fulfilled_headcount: 10 };
    const r = await planStreamsForDay({ date: "2026-10-08", dryRun: false });
    expect(h.autoClose).toHaveBeenCalledTimes(1);
    expect(h.createDrive).not.toHaveBeenCalled();
    expect(r.plans[0]).toMatchObject({ drive: "skipped", reason: "requisition is closed or filled" });
    expect(sqls().some((q) => q.startsWith("UPDATE he_drive"))).toBe(false);
  });

  it("streams auto-close just closed are not planned", async () => {
    h.streams = three();
    h.autoClose.mockResolvedValueOnce([{ streamId: "s1", requisitionId: "r1", reason: "window_ended" }]);
    const r = await planStreamsForDay({ date: "2026-10-08", dryRun: false });
    expect(r.closed).toHaveLength(1);
    expect(r.plans[0].streams.map((l) => [l.streamId, l.cap])).toEqual([["s2", 15], ["s3", 15]]);
  });

  it("the drive HR closed for the day is never reopened", async () => {
    h.streams = three();
    h.st.drives["2026-10-08"] = { id: "dc", status: "closed" };
    const r = await planStreamsForDay({ date: "2026-10-08", dryRun: false });
    expect(r.plans[0]).toMatchObject({ drive: "skipped", reason: "the drive for this day was closed" });
    expect(h.createDrive).not.toHaveBeenCalled();
    expect(h.lineUp).not.toHaveBeenCalled();
    expect(writes()).toEqual([]);
  });

  it("a busy lock skips the requisition", async () => {
    h.streams = three();
    h.st.lockGot = 0;
    const r = await planStreamsForDay({ date: "2026-10-08", dryRun: false });
    expect(r.plans[0]).toMatchObject({ drive: "skipped", reason: "planning already running" });
    expect(h.createDrive).not.toHaveBeenCalled();
    expect(h.lockCalls.some((q) => q.includes("RELEASE_LOCK"))).toBe(false);
    expect(h.release).toHaveBeenCalledTimes(1);
  });

  it("a failed lock release destroys the connection instead of returning it to the pool", async () => {
    h.streams = [stream("s3")];
    h.st.releaseFails = true;
    const r = await planStreamsForDay({ date: "2026-10-08", dryRun: false });
    expect(r.plans[0].drive).toBe("created");
    expect(h.destroy).toHaveBeenCalledTimes(1);
    expect(h.release).not.toHaveBeenCalled();
  });

  it("dry run writes nothing, takes no lock and reports each cap as would-line", async () => {
    h.streams = three();
    const r = await planStreamsForDay({ date: "2026-10-08", dryRun: true });
    expect(writes()).toEqual([]);
    expect(h.lockCalls).toEqual([]);
    expect(sqls().some((q) => q.includes("GET_LOCK"))).toBe(false);
    expect(h.createDrive).not.toHaveBeenCalled();
    expect(h.lineUp).not.toHaveBeenCalled();
    expect(h.bridge).not.toHaveBeenCalled();
    expect(h.autoClose).toHaveBeenCalledWith("2026-10-07", true);
    expect(r.plans[0].drive).toBe("would_create");
    expect(r.plans[0].streams.map((l) => l.wouldLine)).toEqual([10, 15, 15]);
  });

  it("a meta_old stream whose origin launch is gone is skipped; the next stream still lines up", async () => {
    h.streams = three();
    h.st.origin = false;
    const r = await planStreamsForDay({ date: "2026-10-08", dryRun: false });
    expect(r.plans[0].streams[1]).toMatchObject({ streamId: "s2", lined: 0, skipped: "origin launch not found" });
    expect(h.lineUp.mock.calls.map(([, o]) => (o as { followupStream: { streamId: string } }).followupStream.streamId)).toEqual(["s1", "s3"]);
  });

  it("a throw inside one stream skips that line only", async () => {
    h.streams = three();
    h.lineUp.mockRejectedValueOnce(new Error("Drive not found for 9876543210"));
    const r = await planStreamsForDay({ date: "2026-10-08", dryRun: false });
    expect(r.plans[0].streams[0].skipped).toBe("Drive not found for #");
    expect(r.plans[0].streams[2].lined).toBe(15);
  });

  it("never throws: a failing stream read comes back as failed", async () => {
    const svc = await import("../requisition-stream.service.js");
    vi.mocked(svc.loadActiveStreams).mockRejectedValueOnce(new Error("db down"));
    const r = await planStreamsForDay({ date: "2026-10-08", dryRun: false });
    expect(r).toEqual({ plans: [], closed: [], failed: "db down" });
  });

  it("two streams competing for one candidate: the earlier stream credits first, the later INSERT IGNORE cannot take it", async () => {
    h.streams = [stream("s1", { dailyInvites: 1, createdAt: "2026-10-07 09:00:00" }), stream("s2", { dailyInvites: 1, createdAt: "2026-10-07 09:30:00" })];
    await planStreamsForDay({ date: "2026-10-08", dryRun: false });
    const c = h.calls.filter(([q]) => q.startsWith("INSERT IGNORE INTO requisition_stream_match"));
    expect(c.map(([, p]) => p[0])).toEqual(["s1", "s2"]);
    expect(c[0][0]).toContain("SELECT m.id, ?, ? FROM he_match m WHERE m.drive_id = ? AND m.lead_id IN (?)");
  });
});

describe("planNextDay with streams", () => {
  it("a stream-owned requisition is left to the stream pass; the legacy loop skips it", async () => {
    h.streams = [stream("s3")];
    h.st.owned = ["r1"];
    h.st.planReqs = ["r1"];
    const r = await planNextDay({ date: "2026-10-08" });
    expect(r.days).toEqual([]);
    expect(sqls().some((q) => q.includes("FROM he_drive WHERE requisition_id = ? AND drive_date = ?"))).toBe(false);
    expect(r.streams).toHaveLength(1);
    expect(r.streams[0]).toMatchObject({ requisitionId: "r1", drive: "created" });
    expect(r.streamsClosed).toEqual([]);
  });

  it("when the stream ownership read fails: the legacy plan runs as before, streams is [], no throw", async () => {
    h.streams = [stream("s3")];
    h.st.ownedFails = true;
    h.st.planReqs = ["r1"];
    const r = await planNextDay({ date: "2026-10-08" });
    expect(r.days).toEqual([{ requisitionId: "r1", code: "REQ-1", role: "", branch: "", date: "2026-10-08", invitesWanted: 30, lined: 2, status: "created", driveId: "new-2026-10-08" }]);
    expect(r.streams).toEqual([]);
    expect(r.streamsClosed).toEqual([]);
    expect(h.lineUp).not.toHaveBeenCalled();
  });

  it("Saturday's evening pass also plans an added Sunday, then Monday (Review Focus 1)", async () => {
    vi.setSystemTime(new Date("2026-10-10T18:00:00+05:30"));
    h.streams = [stream("s3", { openFrom: "2026-10-10", openDays: 3, add: ["2026-10-11"] })];
    h.st.owned = ["r1"];
    const r = await planNextDay();
    expect(r.date).toBe("2026-10-12");
    expect(r.streams.map((p) => p.date)).toEqual(["2026-10-11", "2026-10-12"]);
    expect(h.createDrive.mock.calls.map(([i]) => i.driveDate)).toEqual(["2026-10-11", "2026-10-12"]);
  });

  it("Saturday's pass without the Sunday exception plans only Monday", async () => {
    vi.setSystemTime(new Date("2026-10-10T18:00:00+05:30"));
    h.streams = [stream("s3", { openFrom: "2026-10-10", openDays: 3 })];
    h.st.owned = ["r1"];
    const r = await planNextDay();
    expect(r.streams.map((p) => p.date)).toEqual(["2026-10-12"]);
  });

  it("an explicit date plans only that date", async () => {
    vi.setSystemTime(new Date("2026-10-10T18:00:00+05:30"));
    h.streams = [stream("s3", { openFrom: "2026-10-10", openDays: 3, add: ["2026-10-11"] })];
    h.st.owned = ["r1"];
    const r = await planNextDay({ date: "2026-10-12" });
    expect(r.streams.map((p) => p.date)).toEqual(["2026-10-12"]);
  });
});

describe("topUpStreamDrive", () => {
  it("a drive whose only stream closed mid-day is not topped up and nothing is deleted (Review Focus 4)", async () => {
    h.st.topDrive = { id: "dx", requisition_id: "r1", drive_date: "2026-10-08", status: "active" };
    h.streams = []; // the stream is closed now, so it is no longer active
    expect(await topUpStreamDrive("dx")).toBe(0);
    expect(h.lineUp).not.toHaveBeenCalled();
    expect(sqls().some((q) => q.startsWith("DELETE"))).toBe(false);
  });

  it("a paused stream is not topped up", async () => {
    h.st.topDrive = { id: "dx", requisition_id: "r1", drive_date: "2026-10-08", status: "active" };
    h.streams = [stream("s3", { status: "paused" })];
    expect(await topUpStreamDrive("dx")).toBe(0);
    expect(h.lineUp).not.toHaveBeenCalled();
  });

  it("past or closed drives return 0", async () => {
    h.streams = [stream("s3")];
    h.st.topDrive = { id: "dx", requisition_id: "r1", drive_date: "2026-10-06", status: "active" };
    expect(await topUpStreamDrive("dx")).toBe(0);
    h.st.topDrive = { id: "dx", requisition_id: "r1", drive_date: "2026-10-08", status: "closed" };
    expect(await topUpStreamDrive("dx")).toBe(0);
    expect(h.lineUp).not.toHaveBeenCalled();
  });

  it("tops up an open stream to its cap on the existing drive and never creates one", async () => {
    h.st.topDrive = { id: "dx", requisition_id: "r1", drive_date: "2026-10-08", status: "active" };
    h.st.drives["2026-10-08"] = { id: "dx", status: "active" };
    h.streams = [stream("s3", { dailyInvites: 6 })];
    h.st.already = { s3: 4 };
    expect(await topUpStreamDrive("dx")).toBe(2);
    expect(h.createDrive).not.toHaveBeenCalled();
  });
});

describe("streamDriveIds", () => {
  it("makes no query for an empty list", async () => {
    expect(await streamDriveIds([])).toEqual(new Set());
    expect(h.calls).toEqual([]);
  });
});

describe("engine re-line-up", () => {
  it("a stream-fed drive is topped up per stream; any other drive gets suggestMatches exactly as before", async () => {
    vi.setSystemTime(new Date("2026-10-08T11:00:00+05:30"));
    h.st.fed = ["fed"];
    h.st.topDrive = { id: "fed", requisition_id: "r1", drive_date: "2026-10-08", status: "active" };
    h.st.drives["2026-10-08"] = { id: "fed", status: "active" };
    h.streams = [stream("s3", { dailyInvites: 3 })];
    await runEngineTick({ dryRun: false });
    expect(h.suggestMatches.mock.calls).toEqual([["legacy"]]);
    expect(h.lineUp).toHaveBeenCalledTimes(1);
    expect(h.lineUp.mock.calls[0][0]).toBe("fed");
    expect(h.createDrive).not.toHaveBeenCalled();
  });
});
