import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * WS3 D4: the evening (17:00-20:00 IST) and on-arrival shortlist worker. Preview runs only (never approves or enrols), idempotent
 * (one evening run per requisition x source x IST day), a per-campaign switch that is off by default, an advisory lock, a bounded
 * number of runs per tick and a facts-cache refresh before the runs.
 */
const h = vi.hoisted(() => ({
  sqls: [] as Array<{ sql: string; p: unknown[] }>,
  lock: 1,
  links: [] as Array<{ campaign_id: string; requisition_id: string }>,
  eveningDone: new Set<string>(),
  lastMetaRun: null as null | { last: string | null; recent: number },
  arrivals: [] as string[],
}));
const { exec, conn } = vi.hoisted(() => {
  const exec = async (sql: string, p: unknown[] = []) => {
    const q = sql.replace(/\s+/g, " ").trim();
    h.sqls.push({ sql: q, p });
    if (q.startsWith("SELECT GET_LOCK")) return [[{ got: h.lock }]];
    if (q.startsWith("SELECT RELEASE_LOCK")) return [[{}]];
    if (q.startsWith("SELECT mcr.campaign_id, mcr.requisition_id FROM meta_campaign_requisition mcr")) return [h.links];
    if (q.startsWith("SELECT 1 AS hit FROM shortlist_run WHERE requisition_id = ? AND source_kind = ? AND evening_date = ?")) return [h.eveningDone.has(`${p[0]}:${p[1]}:${p[2]}`) ? [{ hit: 1 }] : []];
    if (q.startsWith("SELECT MAX(created_at) AS last")) return [[h.lastMetaRun ?? { last: null, recent: 0 }]];
    if (q.startsWith("SELECT r.id FROM meta_lead_raw r")) return [h.arrivals.map((id) => ({ id }))];
    return [[]];
  };
  const conn = { execute: vi.fn(exec), release: vi.fn() };
  return { exec, conn };
});
vi.mock("../../../db/mysql.js", () => ({ db: { execute: vi.fn(exec), getConnection: vi.fn(async () => conn) } }));
vi.mock("../../../logger.js", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

import { autoPreviewCampaigns, inEveningWindow, MAX_RUNS_PER_TICK, resetShortlistPreviewState, runShortlistPreviewTick, startShortlistPreviewWorker, stopShortlistPreviewWorker } from "../shortlist-preview.worker.js";

const ist = (s: string) => new Date(`${s}+05:30`);
const ON = { SHORTLIST_AUTO_PREVIEW: "all" } as NodeJS.ProcessEnv;
const deps = () => ({
  runShortlist: vi.fn(async (a: Record<string, unknown>) => {
    if (a.trigger === "evening") {
      const k = `${a.requisitionId}:${a.sourceKind}:${a.eveningDate}`;
      if (h.eveningDone.has(k)) throw Object.assign(new Error("Duplicate entry"), { code: "ER_DUP_ENTRY" });
      h.eveningDone.add(k);
    }
    return { runId: "run", stored: 3, capped: 0 };
  }),
  notOpen: vi.fn(async (id: string) => (id === "RCLOSED" ? "requisition is closed" : null)),
  refreshFactCache: vi.fn(async () => ({ chunks: 1 })),
  cacheMetaLeadFacts: vi.fn(async (ids: string[]) => ids.length),
});

beforeEach(() => {
  h.sqls = []; h.lock = 1; h.eveningDone = new Set(); h.lastMetaRun = null; h.arrivals = [];
  h.links = [{ campaign_id: "C1", requisition_id: "R1" }, { campaign_id: "C1", requisition_id: "RCLOSED" }];
  conn.execute.mockClear(); conn.release.mockClear(); resetShortlistPreviewState();
});

describe("switch and window", () => {
  it("off by default; all; or a list of campaign ids", () => {
    expect(autoPreviewCampaigns({} as NodeJS.ProcessEnv)).toBe("off");
    expect(autoPreviewCampaigns({ SHORTLIST_AUTO_PREVIEW: "off" } as NodeJS.ProcessEnv)).toBe("off");
    expect(autoPreviewCampaigns(ON)).toBe("all");
    expect(autoPreviewCampaigns({ SHORTLIST_AUTO_PREVIEW: "C1, C2" } as NodeJS.ProcessEnv)).toEqual(["C1", "C2"]);
  });
  it("evening is 17:00 <= IST < 20:00, whatever the server zone", () => {
    expect(inEveningWindow(ist("2026-10-09T16:59:59"))).toBe(false);
    expect(inEveningWindow(ist("2026-10-09T17:00:00"))).toBe(true);
    expect(inEveningWindow(ist("2026-10-09T19:59:59"))).toBe(true);
    expect(inEveningWindow(ist("2026-10-09T20:00:00"))).toBe(false);
  });
  it("switch off: no statement, no timer", async () => {
    const d = deps();
    expect(await runShortlistPreviewTick({ now: ist("2026-10-09T18:00:00"), env: {} as NodeJS.ProcessEnv, deps: d })).toMatchObject({ skipped: "off" });
    expect(h.sqls).toEqual([]);
    const prev = process.env.SHORTLIST_AUTO_PREVIEW;
    delete process.env.SHORTLIST_AUTO_PREVIEW;
    const spy = vi.spyOn(global, "setInterval");
    startShortlistPreviewWorker();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
    stopShortlistPreviewWorker();
    if (prev !== undefined) process.env.SHORTLIST_AUTO_PREVIEW = prev;
  });
  it("another process holds the lock: nothing runs", async () => {
    h.lock = 0;
    const d = deps();
    expect(await runShortlistPreviewTick({ now: ist("2026-10-09T18:00:00"), env: ON, deps: d })).toMatchObject({ skipped: "locked" });
    expect(d.runShortlist).not.toHaveBeenCalled();
    expect(conn.release).toHaveBeenCalled();
  });
});

describe("evening runs", () => {
  it("one preview run per open requisition x source, after a facts-cache refresh; closed requisitions skipped; a second tick is a no-op", async () => {
    const d = deps();
    const r1 = await runShortlistPreviewTick({ now: ist("2026-10-09T17:05:00"), env: ON, deps: d });
    expect(d.refreshFactCache.mock.calls.map((c) => (c[0] as { sourceKind: string }).sourceKind)).toEqual(["meta_live", "meta_old", "he"]);
    expect((d.refreshFactCache.mock.calls[0][0] as { maxChunks: number }).maxChunks).toBeGreaterThan(0);
    expect(d.runShortlist.mock.calls.map((c) => [c[0].requisitionId, c[0].sourceKind, c[0].trigger, c[0].eveningDate, c[0].createdBy])).toEqual([
      ["R1", "meta_live", "evening", "2026-10-09", null], ["R1", "meta_old", "evening", "2026-10-09", null], ["R1", "he", "evening", "2026-10-09", null]]);
    expect(r1).toMatchObject({ evening: { runs: 3, exists: 0 }, closed: 1 });
    const r2 = await runShortlistPreviewTick({ now: ist("2026-10-09T17:10:00"), env: ON, deps: d });
    expect(r2).toMatchObject({ evening: { runs: 0, exists: 3 } });
    expect(d.runShortlist).toHaveBeenCalledTimes(3);
    expect(d.refreshFactCache).toHaveBeenCalledTimes(3); // once per IST day per source
  });
  it("before 17:00 and from 20:00: no evening run", async () => {
    const d = deps();
    await runShortlistPreviewTick({ now: ist("2026-10-09T16:55:00"), env: ON, deps: d });
    await runShortlistPreviewTick({ now: ist("2026-10-09T20:00:00"), env: ON, deps: d });
    expect(d.runShortlist).not.toHaveBeenCalled();
  });
  it("a race with another process (duplicate evening key) counts as done, never a second run", async () => {
    const d = deps();
    d.runShortlist.mockRejectedValueOnce(Object.assign(new Error("Duplicate entry 'R1-meta_live-2026-10-09' for key 'uq_slr_evening'"), { code: "ER_DUP_ENTRY" }));
    const r = await runShortlistPreviewTick({ now: ist("2026-10-09T18:00:00"), env: ON, deps: d });
    expect(r).toMatchObject({ evening: { runs: 2, exists: 1 } });
  });
  it("bounded: at most MAX_RUNS_PER_TICK runs a tick; the rest wait for the next tick", async () => {
    h.links = Array.from({ length: 5 }, (_, i) => ({ campaign_id: "C1", requisition_id: `R${i}` }));
    const d = deps();
    await runShortlistPreviewTick({ now: ist("2026-10-09T18:00:00"), env: ON, deps: d });
    expect(d.runShortlist).toHaveBeenCalledTimes(MAX_RUNS_PER_TICK);
    await runShortlistPreviewTick({ now: ist("2026-10-09T18:05:00"), env: ON, deps: d });
    expect(d.runShortlist).toHaveBeenCalledTimes(Math.min(15, 2 * MAX_RUNS_PER_TICK));
  });
  it("a campaign list: only its requisitions", async () => {
    const d = deps();
    await runShortlistPreviewTick({ now: ist("2026-10-09T18:00:00"), env: { SHORTLIST_AUTO_PREVIEW: "C9" } as NodeJS.ProcessEnv, deps: d });
    const sel = h.sqls.find((s) => s.sql.startsWith("SELECT mcr.campaign_id"))!;
    expect(sel.sql).toContain("WHERE mcr.campaign_id IN (?)");
    expect(sel.p).toEqual(["C9"]);
  });
});

describe("arrival runs", () => {
  it("new qualified Live Meta arrivals since the last run: their facts are cached, then one meta_live preview run", async () => {
    h.arrivals = ["M1", "M2"];
    h.lastMetaRun = { last: "2026-10-09 10:00:00", recent: 0 };
    const d = deps();
    const r = await runShortlistPreviewTick({ now: ist("2026-10-09T11:00:00"), env: ON, deps: d });
    expect(d.cacheMetaLeadFacts).toHaveBeenCalledWith(["M1", "M2"], expect.any(Date));
    expect(d.runShortlist.mock.calls.map((c) => [c[0].requisitionId, c[0].sourceKind, c[0].trigger])).toEqual([["R1", "meta_live", "arrival"]]);
    expect(r).toMatchObject({ arrival: { runs: 1, people: 2 } });
  });
  it("debounced: a meta_live run in the last 30 minutes waits; no arrivals, no run", async () => {
    h.arrivals = ["M1"];
    h.lastMetaRun = { last: "2026-10-09 10:50:00", recent: 1 };
    const d = deps();
    await runShortlistPreviewTick({ now: ist("2026-10-09T11:00:00"), env: ON, deps: d });
    h.arrivals = []; h.lastMetaRun = { last: "2026-10-09 09:00:00", recent: 0 };
    await runShortlistPreviewTick({ now: ist("2026-10-09T11:05:00"), env: ON, deps: d });
    expect(d.runShortlist).not.toHaveBeenCalled();
  });
  it("preview only: the worker never approves, enrols or writes a follow-up row", async () => {
    h.arrivals = ["M1"];
    const d = deps();
    await runShortlistPreviewTick({ now: ist("2026-10-09T18:00:00"), env: ON, deps: d });
    expect(h.sqls.filter((s) => /^(INSERT|UPDATE|DELETE)/.test(s.sql))).toEqual([]);
    expect(Object.keys(d)).not.toContain("enrolApproved");
  });
});
