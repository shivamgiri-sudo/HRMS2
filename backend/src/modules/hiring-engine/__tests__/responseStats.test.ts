import { beforeEach, describe, expect, it, vi } from "vitest";

const execute = vi.hoisted(() => vi.fn());
vi.mock("../he-read-limit.js", () => ({ limitedDb: { execute } }));

import { PersonFacts } from "../he-person-facts.service.js";
import { contactedSql, confirmedSql, rateChannelOf, readResponseStats, respondedSql } from "../he-response-stats.service.js";

const W = { from: "2026-10-01", to: "2026-10-14" };
type Rows = Record<string, unknown>[];
let rows: { confirmed: Rows; contacted: Rows; called: Rows; invited: Rows | Error; responded: Rows | Error; stampMissing: boolean };
const facts: Record<string, { pm: number; fl: number }> = { L1: { pm: 1, fl: 1 }, L2: { pm: 1, fl: 0 }, L3: { pm: 0, fl: 0 } };
const missing = (code: string) => Object.assign(new Error("missing"), { code });

beforeEach(() => {
  rows = { confirmed: [], contacted: [], called: [], invited: [], responded: [], stampMissing: false };
  execute.mockReset();
  execute.mockImplementation(async (sql: string, params: unknown[]) => {
    const q = String(sql);
    if (q.includes("FROM he_lead l LEFT JOIN meta_lead_raw lf")) return [(params as string[]).filter((id) => facts[id]).map((id) => ({ id, ...facts[id] }))];
    if (q.includes("AS via")) {
      if (rows.stampMissing && q.includes("m.confirmed_via")) throw missing("ER_BAD_FIELD_ERROR");
      return [rows.confirmed];
    }
    if (q.includes("FROM he_message hm")) return [rows.contacted];
    if (q.includes("FROM he_call hc")) return [rows.called];
    if (q.includes("FROM walkin_invite wi")) { if (rows.invited instanceof Error) throw rows.invited; return [rows.invited]; }
    if (q.includes("FROM candidate_response cr")) { if (rows.responded instanceof Error) throw rows.responded; return [rows.responded]; }
    return [[]];
  });
});

describe("confirmed by channel", () => {
  it("types each confirmed match by the shared rule and counts it under its stamped channel; no stamp is unknown", async () => {
    rows.confirmed = [
      { tl: "L1", tm: 1, tr: 1, via: "whatsapp", n: 2 }, { tl: "L2", tm: 1, tr: 1, via: "unknown", n: 1 }, { tl: "L3", tm: 0, tr: 1, via: "hr", n: 1 },
    ];
    const s = await readResponseStats(["R1"], W, new PersonFacts("2026-10-08"));
    expect(s.confirmedByChannel.meta_live.whatsapp).toBe(2);
    expect(s.confirmedByChannel.meta_old.unknown).toBe(1);
    expect(s.confirmedByChannel.he.hr).toBe(1);
    expect(s.confirmedByChannel.he.email).toBe(0);
  });
  it("before migration 2140 (no confirmed_via column) every confirmed match is unknown", async () => {
    rows.stampMissing = true;
    rows.confirmed = [{ tl: "L3", tm: 0, tr: 0, via: "unknown", n: 3 }];
    const s = await readResponseStats(["R1"], W, new PersonFacts("2026-10-08"));
    expect(s.confirmedByChannel.he.unknown).toBe(3);
    const sqls = execute.mock.calls.map(([q]) => String(q)).filter((q) => q.includes("AS via"));
    expect(sqls.some((q) => !q.includes("confirmed_via") && q.includes("'unknown' AS via"))).toBe(true);
  });
  it("the statement starts from the window's drives (requisition ids, drive date), confirmed by stamp or state", () => {
    const q = confirmedSql("2026-10-08", 2, true)(true);
    expect(q).toContain("FROM he_drive d");
    expect(q).toContain("d.requisition_id IN (?,?) AND d.drive_date BETWEEN ? AND ?");
    expect(q).toContain("m.confirmed_at IS NOT NULL OR m.state IN ('confirmed','arrived','no_show')");
  });
});

describe("response rate per channel and drive type", () => {
  it("contacted people per type and channel; responded = those of them who answered on that channel", async () => {
    rows.contacted = [
      { tl: "L1", tm: 1, tr: 1, ch: "email", mob: "9000000001" }, { tl: "L1", tm: 1, tr: 1, ch: "whatsapp", mob: "9000000001" },
      { tl: "L3", tm: 0, tr: 1, ch: "whatsapp", mob: "9000000003" },
    ];
    rows.called = [{ tl: "L3", tm: 0, tr: 1, mob: "9000000003" }];
    rows.invited = [{ t: "meta_old", mob: "9000000002" }];
    rows.responded = [
      { ch: "web", mob: "9000000001" }, { ch: "email", mob: "9000000002" }, { ch: "whatsapp", mob: "9000000009" }, { ch: "call_file", mob: "9000000003" },
    ];
    const s = await readResponseStats(["R1"], W, new PersonFacts("2026-10-08"));
    expect(s.responseRate.meta_live.email).toEqual({ contacted: 1, responded: 1 }); // a web tap on the email's button
    expect(s.responseRate.meta_live.whatsapp).toEqual({ contacted: 1, responded: 0 });
    expect(s.responseRate.meta_old.email).toEqual({ contacted: 1, responded: 1 }); // invite without a match
    expect(s.responseRate.he.whatsapp).toEqual({ contacted: 1, responded: 0 }); // the answer came from someone not contacted
    expect(s.responseRate.he.voice_bot).toEqual({ contacted: 1, responded: 1 }); // calling-file result counts for voice
  });
  it("responded never exceeds contacted", async () => {
    rows.responded = [{ ch: "whatsapp", mob: "9000000001" }];
    const s = await readResponseStats(["R1"], W, new PersonFacts("2026-10-08"));
    for (const t of ["meta_live", "meta_old", "he"] as const) for (const c of ["email", "whatsapp", "voice_bot"] as const) {
      expect(s.responseRate[t][c].responded).toBeLessThanOrEqual(s.responseRate[t][c].contacted);
    }
  });
  it("tables of 2140 / 2141 not deployed yet read as no rows", async () => {
    rows.invited = missing("ER_NO_SUCH_TABLE"); rows.responded = missing("ER_NO_SUCH_TABLE");
    const s = await readResponseStats(["R1"], W, new PersonFacts("2026-10-08"));
    expect(s.responseRate.he.email).toEqual({ contacted: 0, responded: 0 });
  });
  it("no requisitions: zeros and no statement", async () => {
    const s = await readResponseStats([], W, new PersonFacts("2026-10-08"));
    expect(s.confirmedByChannel.meta_live.whatsapp).toBe(0);
    expect(execute).not.toHaveBeenCalled();
  });
  it("statements are keyed by requisition and time, IST window bounds", async () => {
    await readResponseStats(["R1"], W, new PersonFacts("2026-10-08"));
    const call = execute.mock.calls.find(([q]) => String(q).includes("FROM he_message hm"))!;
    expect(String(call[0])).toContain("hm.requisition_id IN (?) AND hm.created_at >= ? AND hm.created_at < ?");
    expect(call[1]).toEqual(["R1", "2026-10-01 00:00:00", "2026-10-15 00:00:00"]);
    expect(respondedSql(1)).toContain("cr.requisition_id IN (?) AND cr.occurred_at >= ? AND cr.occurred_at < ? AND cr.answer <> 'no_answer'");
    expect(contactedSql("2026-10-08", 1)(false)).not.toContain("requisition_stream");
  });
  it("channel mapping", () => {
    expect(["email", "web", "whatsapp", "voice_bot", "call_file", "hr", "x"].map(rateChannelOf)).toEqual(["email", "email", "whatsapp", "voice_bot", "voice_bot", null, null]);
  });
});
