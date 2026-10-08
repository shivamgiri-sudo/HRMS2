import { beforeEach, describe, expect, it, vi } from "vitest";

const execute = vi.hoisted(() => vi.fn());
const readResponseStats = vi.hoisted(() => vi.fn());
vi.mock("../he-read-limit.js", () => ({ limitedDb: { execute } }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));
vi.mock("../../../logger.js", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock("../he-response-stats.service.js", async (orig) => ({ ...(await orig<object>()), readResponseStats }));
vi.mock("../he-source-attribution.service.js", () => ({ loadLiveFrom: async () => "2026-10-08" }));

import { decodeCursor, driveConfirmed, encodeCursor, listResponses, responseQueue, responseSummary } from "../response-read.service.js";

const ALL = { all: true } as const;
const PUNE = { all: false, branchName: "PUNE" } as const;
const NOBRANCH = { all: false, branchName: null } as const;
type Handler = (q: string, p: unknown[]) => unknown[] | undefined;
let handler: Handler;
const sqls = () => execute.mock.calls.map(([q, p]) => ({ q: String(q), p: (p ?? []) as unknown[] }));
const row = (o: Record<string, unknown> = {}) => ({
  id: 7, occurred_at: "2026-10-08 10:00:00", channel: "whatsapp", mode: "text", answer: "question", status: "needs_review", suggested_answer: "confirm", confidence: "0.600",
  mobile10: "9876543210", lead_id: "L1", match_id: "M1", invite_id: null, requisition_id: "R1", drive_type: "meta_live", drive_id: "D1", slot_at: "2026-10-09 10:30:00",
  handled_by: "system", handled_at: null, conflict: 0, dedupe_of: null, raw_text: "Call me on 9876543210 or a@b.in please, what is the salary?",
  requisition_code: "REQ-1", campaign_name: "AHM Sales", drive_date: "2026-10-09", full_name: "Asha Kumari Verma", ...o,
});

beforeEach(() => {
  execute.mockReset(); readResponseStats.mockReset();
  handler = () => undefined;
  execute.mockImplementation(async (q: string, p: unknown[] = []) => [handler(String(q), p) ?? []]);
});

describe("cursor", () => {
  it("round-trips and rejects garbage", () => {
    const c = encodeCursor("2026-10-08 10:00:00", 42);
    expect(decodeCursor(c)).toEqual({ at: "2026-10-08 10:00:00", id: 42 });
    expect(decodeCursor("not-a-cursor")).toBeNull();
    expect(decodeCursor(Buffer.from("2026-10-08 10:00:00|x' OR 1").toString("base64url"))).toBeNull();
  });
});

describe("listResponses", () => {
  it("every filter is a bound equality (no LIKE), with the window bounds and the branch scope", async () => {
    await listResponses({ from: "2026-10-01", to: "2026-10-08", campaignId: "C1", requisitionId: "R1", driveId: "D1", driveType: "meta_live", channel: "whatsapp", answer: "confirm", status: "applied", mobile10: "9876543210", limit: 50 }, PUNE);
    const { q, p } = sqls().find((s) => s.q.includes("FROM candidate_response cr"))!;
    expect(q).not.toMatch(/LIKE/i);
    for (const c of ["cr.campaign_id = ?", "cr.requisition_id = ?", "cr.drive_id = ?", "cr.drive_type = ?", "cr.channel = ?", "cr.answer = ?", "cr.status = ?", "cr.mobile10 = ?", "jr.branch_name = ?"]) expect(q).toContain(c);
    expect(q).toContain("cr.occurred_at >= ? AND cr.occurred_at < ?");
    expect(q).toContain("ORDER BY cr.occurred_at DESC, cr.id DESC LIMIT 51");
    expect(p).toEqual(["2026-10-01 00:00:00", "2026-10-09 00:00:00", "C1", "R1", "D1", "meta_live", "whatsapp", "confirm", "applied", "9876543210", "PUNE"]);
  });
  it("an org-wide caller has no branch filter; a branch user without a branch reads nothing", async () => {
    await listResponses({ from: "2026-10-01", to: "2026-10-08" }, ALL);
    expect(sqls()[0].q).not.toContain("jr.branch_name = ?");
    execute.mockClear();
    expect(await listResponses({ from: "2026-10-01", to: "2026-10-08" }, NOBRANCH)).toEqual({ rows: [], nextCursor: null });
    expect(execute).not.toHaveBeenCalled();
  });
  it("masks the person: first name + initial, last four digits; text preview scrubbed and capped; no 10-digit run anywhere", async () => {
    handler = (q) => (q.includes("FROM candidate_response cr") ? [row()] : undefined);
    const r = await listResponses({ from: "2026-10-01", to: "2026-10-08" }, ALL);
    expect(r.rows[0].person).toEqual({ name: "Asha V.", mobileMasked: "xxxxxx3210" });
    expect(r.rows[0].textPreview).toContain("what is the salary?");
    expect(r.rows[0].textPreview.length).toBeLessThanOrEqual(140);
    expect(JSON.stringify(r)).not.toMatch(/\d{10}/);
    expect(JSON.stringify(r)).not.toContain("a@b.in");
    expect(r.rows[0]).toMatchObject({ id: 7, channel: "whatsapp", answer: "question", suggested: "confirm", confidence: 0.6, requisitionCode: "REQ-1", campaignName: "AHM Sales", driveType: "meta_live", driveDate: "2026-10-09", handledBy: "system", conflict: false, dedupeOf: null, matchId: "M1", leadId: "L1" });
  });
  it("keyset paging: one extra row gives the next cursor; the cursor continues strictly after it", async () => {
    handler = (q) => (q.includes("FROM candidate_response cr") ? [row({ id: 9, occurred_at: "2026-10-08 12:00:00" }), row({ id: 8, occurred_at: "2026-10-08 11:00:00" }), row({ id: 7 })] : undefined);
    const r = await listResponses({ from: "2026-10-01", to: "2026-10-08", limit: 2 }, ALL);
    expect(r.rows.map((x) => x.id)).toEqual([9, 8]);
    expect(decodeCursor(r.nextCursor!)).toEqual({ at: "2026-10-08 11:00:00", id: 8 });
    execute.mockClear();
    await listResponses({ from: "2026-10-01", to: "2026-10-08", limit: 2, cursor: r.nextCursor }, ALL);
    const { q, p } = sqls()[0];
    expect(q).toContain("(cr.occurred_at < ? OR (cr.occurred_at = ? AND cr.id < ?))");
    expect(p.slice(-3)).toEqual(["2026-10-08 11:00:00", "2026-10-08 11:00:00", 8]);
  });
  it("a missing ledger (migration 2141 not applied) reads as no rows", async () => {
    execute.mockRejectedValueOnce(Object.assign(new Error("x"), { code: "ER_NO_SUCH_TABLE" }));
    expect(await listResponses({ from: "2026-10-01", to: "2026-10-08" }, ALL)).toEqual({ rows: [], nextCursor: null });
  });
});

describe("responseQueue", () => {
  it("needs_review rows oldest first, scoped, with counts by age", async () => {
    handler = (q) => (q.includes("COUNT(*)") ? [{ total: 5, under1h: 1, h1to4: 1, h4to24: 2, over24h: 1, oldest: "2026-10-06 09:00:00" }] : q.includes("FROM candidate_response cr") ? [row()] : undefined);
    const r = await responseQueue(PUNE, new Date("2026-10-08T06:30:00Z"));
    const list = sqls().find((s) => s.q.includes("ORDER BY"))!;
    expect(list.q).toContain("cr.status = 'needs_review'");
    expect(list.q).toContain("ORDER BY cr.occurred_at ASC, cr.id ASC LIMIT 100");
    expect(list.q).toContain("jr.branch_name = ?");
    const counts = sqls().find((s) => s.q.includes("COUNT(*)"))!;
    expect(counts.p.slice(0, 3)).toEqual(["2026-10-08 11:00:00", "2026-10-08 08:00:00", "2026-10-07 12:00:00"]);
    expect(r.counts).toEqual({ total: 5, under1h: 1, h1to4: 1, h4to24: 2, over24h: 1 });
    expect(r.oldestAt).toBe("2026-10-06 09:00:00");
    expect(r.rows).toHaveLength(1);
    expect(JSON.stringify(r)).not.toMatch(/\d{10}/);
  });
});

describe("responseSummary", () => {
  it("responses, confirms and people per channel; response rate per channel summed over drive types", async () => {
    handler = (q) => {
      if (q.includes("GROUP BY cr.channel")) return [{ channel: "whatsapp", responses: 4, confirms: 2, people: 3 }, { channel: "web", responses: 1, confirms: 1, people: 1 }];
      if (q.includes("SELECT DISTINCT cr.requisition_id")) return [{ requisition_id: "R1" }];
      if (q.includes("GROUP BY cr.drive_id")) return [{ drive_id: "D1", drive_date: "2026-10-09", branch_name: "PUNE", requisition_code: "REQ-1", responses: 5, confirms: 3 }];
      return undefined;
    };
    const z = { contacted: 0, responded: 0 };
    readResponseStats.mockResolvedValue({ confirmedByChannel: {}, responseRate: {
      meta_live: { email: { contacted: 4, responded: 1 }, whatsapp: { contacted: 10, responded: 3 }, voice_bot: z },
      meta_old: { email: z, whatsapp: { contacted: 2, responded: 1 }, voice_bot: z }, he: { email: z, whatsapp: z, voice_bot: { contacted: 3, responded: 0 } } } });
    const r = await responseSummary({ from: "2026-10-01", to: "2026-10-08" }, ALL);
    expect(r.byChannel.whatsapp).toEqual({ responses: 4, confirms: 2, people: 3 });
    expect(r.byChannel.email).toEqual({ responses: 0, confirms: 0, people: 0 });
    expect(r.byChannel.web).toEqual({ responses: 1, confirms: 1, people: 1 });
    expect(r.rateByChannel.whatsapp).toEqual({ contacted: 12, responded: 4, rate: 4 / 12 });
    expect(r.rateByChannel.voice_bot).toEqual({ contacted: 3, responded: 0, rate: 0 });
    expect(r.rateByType.meta_live.email).toEqual({ contacted: 4, responded: 1, rate: 0.25 });
    expect(r.rateByChannel.email.rate).toBe(0.25);
    expect(readResponseStats.mock.calls[0][0]).toEqual(["R1"]);
    expect(r.byDrive[0]).toEqual({ driveId: "D1", driveDate: "2026-10-09", branch: "PUNE", requisitionCode: "REQ-1", responses: 5, confirms: 3 });
  });
  it("no contact on a channel: rate null, never NaN", async () => {
    readResponseStats.mockResolvedValue(null);
    const r = await responseSummary({ from: "2026-10-01", to: "2026-10-08" }, ALL);
    expect(r.rateByChannel.email).toEqual({ contacted: 0, responded: 0, rate: null });
  });
});

describe("driveConfirmed", () => {
  const drive = { id: "D1", drive_date: "2026-10-09", branch_name: "PUNE", status: "active", requisition_code: "REQ-1", designation_name: "Agent", slot_start: "10:00:00", slot_end: "17:30:00" };
  const m = (o: Record<string, unknown>) => ({ id: "M1", lead_id: "L1", state: "confirmed", slot_at: "2026-10-09 10:30:00", confirmed_at: "2026-10-08 09:00:00", confirmed_via: "web", confirmed_response_id: 11, full_name: "Ravi Shankar", mobile10: "9123456789", arrived_at: null, ...o });
  it("outside the caller's branch (or unknown) is null", async () => {
    handler = (q) => (q.includes("FROM he_drive d JOIN job_requisition jr") ? [{ ...drive, branch_name: "DELHI" }] : undefined);
    expect(await driveConfirmed("D1", PUNE)).toBeNull();
    handler = () => undefined;
    expect(await driveConfirmed("D1", ALL)).toBeNull();
  });
  it("lists confirmed people by slot with the stamped channel, other channels, conflict and arrival; mobiles masked", async () => {
    handler = (q) => {
      if (q.includes("FROM he_drive d JOIN job_requisition jr")) return [drive];
      if (q.includes("FROM he_match m JOIN he_lead l")) return [m({}), m({ id: "M2", lead_id: "L2", state: "arrived", arrived_at: "2026-10-09 10:20:00", confirmed_via: "whatsapp", full_name: "Neha" }),
        m({ id: "M3", lead_id: "L3", state: "declined", confirmed_via: "voice_bot", full_name: "Om Prakash" })];
      if (q.includes("FROM candidate_response cr WHERE cr.match_id IN")) return [
        { match_id: "M1", channel: "web", answer: "confirm", conflict: 0 }, { match_id: "M1", channel: "whatsapp", answer: "confirm", conflict: 0 },
        { match_id: "M3", channel: "whatsapp", answer: "decline", conflict: 1 }];
      return undefined;
    };
    const r = (await driveConfirmed("D1", PUNE))!;
    expect(r.drive).toMatchObject({ id: "D1", date: "2026-10-09", branch: "PUNE", requisitionCode: "REQ-1", role: "Agent" });
    expect(r.rows.map((x) => [x.matchId, x.confirmedVia, x.otherChannels, x.conflict, x.state])).toEqual([
      ["M1", "web", ["whatsapp"], false, "confirmed"], ["M2", "whatsapp", [], false, "arrived"], ["M3", "voice_bot", [], true, "declined"]]);
    expect(r.rows[1].arrivedAt).toBe("2026-10-09 10:20:00");
    expect(r.rows[0]).toMatchObject({ name: "Ravi S.", mobileMasked: "xxxxxx6789", leadId: "L1" });
    expect(r.counts).toEqual({ total: 3, confirmed: 1, arrived: 1, noShow: 0, conflicts: 1 });
    expect(JSON.stringify(r)).not.toMatch(/\d{10}/);
    const q = sqls().find((s) => s.q.includes("FROM he_match m JOIN he_lead l"))!.q;
    expect(q).toContain("WHERE m.drive_id = ?");
  });
  it("before migration 2140 the list falls back to the confirmed states only", async () => {
    let first = true;
    handler = (q) => {
      if (q.includes("FROM he_drive d JOIN job_requisition jr")) return [drive];
      if (q.includes("FROM he_match m JOIN he_lead l")) {
        if (first && q.includes("confirmed_via")) { first = false; throw Object.assign(new Error("x"), { code: "ER_BAD_FIELD_ERROR" }); }
        return [m({ confirmed_at: null, confirmed_via: null })];
      }
      return undefined;
    };
    const r = (await driveConfirmed("D1", ALL))!;
    expect(r.rows[0]).toMatchObject({ matchId: "M1", confirmedVia: null });
  });
});
