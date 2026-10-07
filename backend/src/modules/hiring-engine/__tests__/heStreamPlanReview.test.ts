import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StreamRow } from "../requisition-stream.service.js";

/** Group 6-7 review fixes of the D-1 stream pass: per-drive credits, follow-up heal, drive key and activation guards, legacy fallbacks. Same harness as heStreamPlan.test.ts. */
type Match = { id: string; drive: string };
type Credit = { stream: string; drive: string };
const h = vi.hoisted(() => {
  const o = {
    calls: [] as Array<[string, unknown[]]>,
    lockCalls: [] as string[],
    st: {} as {
      ownedFails: boolean; owned: string[]; req: Record<string, unknown> | null;
      drives: Record<string, Record<string, unknown>>; origin: boolean; lockGot: number | null; releaseFails: boolean;
      topDrive: Record<string, unknown> | null; fed: string[]; planReqs: string[];
      plannedReqs: string[]; plannedFails: boolean; afterCreate: Record<string, unknown> | null; missingFollowup: string[];
      // in-memory he_match (one row per lead) and requisition_stream_match (one row per match id)
      matches: Map<string, Match>; credits: Map<string, Credit>; pools: Record<string, string[]>; counter: number;
    },
    streams: [] as StreamRow[],
    autoClose: vi.fn(async (_d: string, _dry: boolean) => [] as Array<{ streamId: string; requisitionId: string; reason: "window_ended" }>),
    createDrive: vi.fn(async (i: { requisitionId: string; driveDate: string }) => ({ id: `new-${i.driveDate}`, invites: 30, targetShows: 6, capacity: 30 })),
    setDriveStatus: vi.fn(async (_id: string, _s: string) => undefined),
    suggestMatches: vi.fn(async () => 2),
    lineUp: vi.fn(async (_d: string, _o: { limit?: number; followupStream?: { streamId: string } | null; excludeOnDrive?: boolean }) => ({ suggested: 0, blockedByReason: {}, considered: 0, leadIds: [] as string[] })),
    bridge: vi.fn(async () => ({ poolRows: 0, linked: 0 })),
    enqueue: vi.fn(async () => ({ enqueued: 0, exists: 0, handedOver: 0 })),
    destroy: vi.fn(), release: vi.fn(),
  };
  // A line-up writes he_match rows: a lead already matched for this requisition is re-pointed to this drive (unique lead + requisition).
  o.lineUp.mockImplementation(async (driveId, opts) => {
    const sid = opts.followupStream?.streamId ?? "?";
    const onDrive = (l: string) => o.st.matches.get(l)?.drive === driveId;
    const pool = o.st.pools[sid] ?? Array.from({ length: opts.limit ?? 0 }, () => `${sid}-L${o.st.counter++}`);
    const picks = pool.filter((l) => !(opts.excludeOnDrive && onDrive(l))).slice(0, opts.limit ?? 0);
    for (const l of picks) o.st.matches.set(l, { id: o.st.matches.get(l)?.id ?? `m-${l}`, drive: driveId });
    return { suggested: picks.length, blockedByReason: {}, considered: picks.length, leadIds: picks };
  });
  return o;
});
const matchById = (id: string) => [...h.st.matches.values()].find((m) => m.id === id);
/** n people on `drive` credited to `stream` (as an earlier pass would have left them). */
function seed(stream: string, drive: string, n: number, prefix = `seed-${stream}-${drive}`) {
  for (let i = 0; i < n; i++) { const l = `${prefix}-${i}`; h.st.matches.set(l, { id: `m-${l}`, drive }); h.st.credits.set(`m-${l}`, { stream, drive }); }
}

vi.mock("../../../db/mysql.js", () => ({
  db: {
    execute: vi.fn(async (sql: string, params: unknown[] = []) => {
      const q = sql.replace(/\s+/g, " ").trim();
      h.calls.push([q, params]);
      const st = h.st;
      if (q.startsWith("SELECT DISTINCT requisition_id FROM requisition_stream")) { if (st.ownedFails) throw Object.assign(new Error("boom"), { code: "ER_LOCK_WAIT_TIMEOUT" }); return [st.owned.map((requisition_id) => ({ requisition_id }))]; }
      if (q.startsWith("SELECT DISTINCT s.requisition_id FROM requisition_stream_plan")) { if (st.plannedFails) throw new Error("boom"); return [st.plannedReqs.map((requisition_id) => ({ requisition_id }))]; }
      if (q.includes("FROM requisition_stream_plan WHERE drive_id IN")) return [st.fed.map((drive_id) => ({ drive_id }))];
      if (q.includes("FROM requisition_stream_plan WHERE drive_id = ?")) return [st.fed.includes(String(params[0])) ? [{ hit: 1 }] : []];
      if (q.includes("FROM job_requisition WHERE id = ?")) return [st.req ? [st.req] : []];
      if (q.includes("FROM he_drive WHERE requisition_id = ? AND branch_name = ? AND drive_date = ?")) { const d = st.drives[String(params[2])]; return [d ? [d] : []]; }
      if (q.includes("FROM he_drive WHERE requisition_id = ? AND drive_date = ?")) return [[]];
      if (q.startsWith("SELECT status, run_label")) return [[st.afterCreate ?? { status: "draft", run_label: "Streams", source_kind: "pool", created_by: null }]];
      if (q.includes("COUNT(*) AS n FROM requisition_stream_match")) {
        const [sid, a, b] = params.map(String);
        const n = [...st.credits.entries()].filter(([mid, c]) => c.stream === sid && (params.length === 3 ? c.drive === a && matchById(mid)?.drive === b : matchById(mid)?.drive === a)).length;
        return [[{ n }]];
      }
      if (q.includes("FROM requisition_stream_match sm JOIN he_match m") && q.includes("qualified_followup")) return [st.missingFollowup.map((lead_id) => ({ lead_id }))];
      if (q.includes("FROM he_drive WHERE id = ? AND source_kind <> 'pool'")) return [st.origin ? [{ source_kind: "campaign", source_ids: ["c-old"], max_lead_age_days: 90 }] : []];
      if (q.includes("FROM he_drive WHERE id = ? LIMIT 1")) return [st.topDrive ? [st.topDrive] : []];
      if (/^INSERT (IGNORE )?INTO requisition_stream_match/.test(q)) {
        const [sid, drive, onDrive, ...leads] = params.map(String);
        let n = 0;
        for (const l of leads) {
          const m = st.matches.get(l);
          if (!m || m.drive !== onDrive) continue;
          const cur = st.credits.get(m.id);
          if (!cur) { st.credits.set(m.id, { stream: sid, drive }); n++; }
          else if (q.includes("ON DUPLICATE KEY UPDATE") && cur.drive !== drive) { st.credits.set(m.id, { stream: sid, drive }); n += 2; }
        }
        return [{ affectedRows: n }];
      }
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
vi.mock("../qualified-followup.service.js", async (orig) => ({ ...(await orig<typeof import("../qualified-followup.service.js")>()), enqueueMatchedFollowups: h.enqueue }));
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

import { planStreamsForDay, topUpStreamDrive } from "../he-stream-plan.service.js";
import { planNextDay } from "../he-plan.service.js";

const stream = (id: string, over: Partial<StreamRow> = {}): StreamRow => ({
  id, requisitionId: "r1", branchName: "Noida", sourceType: "he", originId: "pool", originLabel: id, openFrom: "2026-10-08", openDays: 3,
  dailyInvites: null, status: "open", closedReason: null, createdBy: null, createdAt: "2026-10-07 10:00:00", add: [], skip: [], ...over,
});
const three = () => [
  stream("s1", { sourceType: "meta_live", originId: "c9", dailyInvites: 10, createdAt: "2026-10-07 09:00:00" }),
  stream("s2", { sourceType: "meta_old", originId: "d-old", createdAt: "2026-10-07 09:30:00" }),
  stream("s3", { sourceType: "he", originId: "pool", createdAt: "2026-10-07 10:00:00" }),
];
const openReq = { id: "r1", requisition_code: "REQ-1", branch_name: "Noida", approval_status: "approved", active_status: 1, requested_headcount: 10, fulfilled_headcount: 2 };
const sqls = () => h.calls.map(([q]) => q);
const credits = () => sqls().filter((q) => q.startsWith("INSERT INTO requisition_stream_match"));
const writes = () => sqls().filter((q) => /^(INSERT|UPDATE|DELETE)/.test(q));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-07T18:00:00+05:30"));
  h.calls.length = 0; h.lockCalls.length = 0;
  h.st = { ownedFails: false, owned: [], req: { ...openReq }, drives: {}, origin: true, lockGot: 1, releaseFails: false, topDrive: null, fed: [], planReqs: [],
    plannedReqs: [], plannedFails: false, afterCreate: null, missingFollowup: [], matches: new Map(), credits: new Map(), pools: {}, counter: 0 };
  h.streams = [];
  for (const f of [h.autoClose, h.createDrive, h.setDriveStatus, h.suggestMatches, h.lineUp, h.bridge, h.enqueue, h.destroy, h.release]) f.mockClear();
  vi.unstubAllEnvs();
});
afterEach(() => { vi.useRealTimers(); });

describe("group 6-7 review fixes", () => {
  it("I1: a person re-pointed from an earlier drive, credited to a now-closed stream, counts toward the stream that lined them today", async () => {
    h.st.matches.set("P", { id: "m-P", drive: "dold" });
    h.st.credits.set("m-P", { stream: "sA", drive: "dold" });
    h.st.pools = { sB: ["P", "Q"] };
    h.streams = [stream("sB", { dailyInvites: 1 })];
    const r = await planStreamsForDay({ date: "2026-10-08", dryRun: false });
    expect(r.plans[0].streams[0]).toMatchObject({ alreadyLined: 0, lined: 1 });
    expect(h.st.credits.get("m-P")).toEqual({ stream: "sB", drive: "new-2026-10-08" });
    const [sql] = h.calls.find(([q]) => q.startsWith("INSERT INTO requisition_stream_match"))!;
    // table-qualified: the SELECT reads he_match, which also has drive_id (an unqualified name is ambiguous on MySQL)
    expect(sql).toContain("ON DUPLICATE KEY UPDATE stream_id = IF(requisition_stream_match.drive_id <=> VALUES(drive_id), requisition_stream_match.stream_id, VALUES(stream_id)), drive_id = VALUES(drive_id)");
    const [cnt, cp] = h.calls.find(([q]) => q.includes("COUNT(*) AS n FROM requisition_stream_match"))!;
    expect(cnt).toContain("sm.stream_id = ? AND sm.drive_id = ? AND m.drive_id = ?");
    expect(cp).toEqual(["sB", "new-2026-10-08", "new-2026-10-08"]);
    // the next pass sees the cap reached and lines nobody
    h.st.drives["2026-10-08"] = { id: "new-2026-10-08", status: "active" };
    h.lineUp.mockClear();
    await planStreamsForDay({ date: "2026-10-08", dryRun: false });
    expect(h.lineUp).not.toHaveBeenCalled();
  });

  it("I1: cap holds across repeated top-ups when every person found was credited to another stream on an earlier drive", async () => {
    for (const l of ["P1", "P2", "P3", "P4", "P5", "P6"]) { h.st.matches.set(l, { id: `m-${l}`, drive: "dold" }); h.st.credits.set(`m-${l}`, { stream: "sA", drive: "dold" }); }
    h.st.pools = { sB: ["P1", "P2", "P3", "P4", "P5", "P6"] };
    h.streams = [stream("sB", { dailyInvites: 2 })];
    h.st.drives["2026-10-08"] = { id: "dx", status: "active" };
    h.st.topDrive = { id: "dx", requisition_id: "r1", drive_date: "2026-10-08", status: "active" };
    let total = 0;
    for (let i = 0; i < 3; i++) total += await topUpStreamDrive("dx");
    expect(total).toBe(2);
    expect([...h.st.matches.values()].filter((m) => m.drive === "dx")).toHaveLength(2);
  });

  it("I1: two streams on the same drive keep first touch (the earlier stream keeps a person already credited for that drive)", async () => {
    h.st.pools = { s1: ["A", "B"], s2: ["A", "C"] };
    h.streams = [stream("s1", { dailyInvites: 2, createdAt: "2026-10-07 09:00:00" }), stream("s2", { dailyInvites: 2, createdAt: "2026-10-07 09:30:00" })];
    // simulate a race: s2's line-up does not exclude A although A is on the drive
    h.lineUp.mockImplementationOnce(async (d, o) => { h.st.matches.set("A", { id: "m-A", drive: d }); h.st.matches.set("B", { id: "m-B", drive: d }); return { suggested: 2, blockedByReason: {}, considered: 2, leadIds: ["A", "B"] }; });
    h.lineUp.mockImplementationOnce(async (d, o) => { h.st.matches.set("A", { id: "m-A", drive: d }); h.st.matches.set("C", { id: "m-C", drive: d }); return { suggested: 2, blockedByReason: {}, considered: 2, leadIds: ["A", "C"] }; });
    const r = await planStreamsForDay({ date: "2026-10-08", dryRun: false });
    expect(h.st.credits.get("m-A")).toEqual({ stream: "s1", drive: "new-2026-10-08" });
    expect(r.plans[0].streams.map((l) => l.lined)).toEqual([2, 1]);
  });

  it("I2: a stream-credited person on the drive without a follow-up row is enqueued again (before the line-up)", async () => {
    vi.stubEnv("QUAL_FOLLOWUP_MODE", "dry_run");
    h.streams = [stream("s3", { dailyInvites: 2 })];
    h.st.drives["2026-10-08"] = { id: "dx", status: "active", run_label: null, source_kind: "pool", created_by: null };
    seed("s3", "dx", 2);
    h.st.missingFollowup = ["seed-s3-dx-1"];
    await planStreamsForDay({ date: "2026-10-08", dryRun: false });
    expect(h.enqueue).toHaveBeenCalledTimes(1);
    expect(h.enqueue.mock.calls[0]).toEqual([{ id: "dx", requisitionId: "r1", sourceKind: "pool", runLabel: null, driveDate: "2026-10-08" }, ["seed-s3-dx-1"],
      { streamId: "s3", sourceType: "he", originId: "pool", originLabel: "s3" }]);
  });

  it("I2: with the pipeline off the heal makes no query", async () => {
    h.streams = [stream("s3", { dailyInvites: 2 })];
    h.st.drives["2026-10-08"] = { id: "dx", status: "active" };
    seed("s3", "dx", 2);
    await planStreamsForDay({ date: "2026-10-08", dryRun: false });
    expect(sqls().some((q) => q.includes("qualified_followup"))).toBe(false);
    expect(h.enqueue).not.toHaveBeenCalled();
  });

  it("M2: the drive is looked up under the requisition's CURRENT branch, the key createDrive uses", async () => {
    h.st.req = { ...openReq, branch_name: "Noida Sec 62" };
    h.streams = [stream("s3", { branchName: "Noida Old" })];
    const r = await planStreamsForDay({ date: "2026-10-08", dryRun: false });
    const [, p] = h.calls.find(([q]) => q.includes("FROM he_drive WHERE requisition_id = ? AND branch_name = ? AND drive_date = ?"))!;
    expect(p).toEqual(["r1", "Noida Sec 62", "2026-10-08"]);
    expect(r.plans[0].branch).toBe("Noida Sec 62");
  });

  it("M2: after createDrive a drive that is not a fresh Streams draft (HR's, or HR-controlled) is never activated", async () => {
    h.streams = [stream("s3")];
    h.st.afterCreate = { status: "draft", run_label: null, source_kind: "pool", created_by: "u1" };
    const r = await planStreamsForDay({ date: "2026-10-08", dryRun: false });
    expect(h.setDriveStatus).not.toHaveBeenCalled();
    expect(r.plans[0].drive).toBe("exists");
    h.setDriveStatus.mockClear(); h.st.afterCreate = { status: "paused", run_label: "Streams", source_kind: "pool", created_by: null };
    const p = await planStreamsForDay({ date: "2026-10-09", dryRun: false });
    expect(h.setDriveStatus).not.toHaveBeenCalled();
    expect(p.plans[0].drive).toBe("exists");
  });

  it("M9: activation failing after createDrive is reported; the next pass activates its own stream-fed draft, never an HR draft", async () => {
    h.streams = [stream("s3")];
    h.setDriveStatus.mockRejectedValueOnce(new Error("lock wait"));
    const r = await planStreamsForDay({ date: "2026-10-08", dryRun: false });
    expect(r.plans[0]).toMatchObject({ drive: "created", driveId: "new-2026-10-08", reason: "drive created but not activated: lock wait" });
    h.setDriveStatus.mockClear();
    h.st.drives["2026-10-08"] = { id: "new-2026-10-08", status: "draft", run_label: "Streams", source_kind: "pool", created_by: null };
    h.st.fed = ["new-2026-10-08"];
    await planStreamsForDay({ date: "2026-10-08", dryRun: false });
    expect(h.setDriveStatus).toHaveBeenCalledWith("new-2026-10-08", "active");
    h.setDriveStatus.mockClear();
    h.st.drives["2026-10-09"] = { id: "hr", status: "draft", run_label: null, source_kind: "pool", created_by: "u1" };
    h.st.fed = ["new-2026-10-08", "hr"];
    await planStreamsForDay({ date: "2026-10-09", dryRun: false });
    expect(h.setDriveStatus).not.toHaveBeenCalled();
    // and dry run never activates
    await planStreamsForDay({ date: "2026-10-08", dryRun: true });
    expect(h.setDriveStatus).not.toHaveBeenCalled();
  });
});

describe("planNextDay ownership fallbacks (M1)", () => {
  it("ownership read failed: a requisition the stream pass already planned for the day is left out of the legacy loop", async () => {
    h.st.ownedFails = true;
    h.st.planReqs = ["r1", "r2"];
    h.st.plannedReqs = ["r1"];
    const r = await planNextDay({ date: "2026-10-08" });
    expect(r.days.map((d) => d.requisitionId)).toEqual(["r2"]);
  });

  it("ownership and plan-row reads both failed: every requisition is treated as stream-owned (legacy loop skipped)", async () => {
    h.st.ownedFails = true; h.st.plannedFails = true;
    h.st.planReqs = ["r1"];
    const r = await planNextDay({ date: "2026-10-08" });
    expect(r.days).toEqual([]);
    expect(h.createDrive).not.toHaveBeenCalled();
  });

  it("a planned requisition is skipped by the legacy loop even when ownership was read (its streams closed after planning)", async () => {
    h.st.planReqs = ["r1"];
    h.st.plannedReqs = ["r1"];
    const r = await planNextDay({ date: "2026-10-08" });
    expect(r.days).toEqual([]);
  });
});
