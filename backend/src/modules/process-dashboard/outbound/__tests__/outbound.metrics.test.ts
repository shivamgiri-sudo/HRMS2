import { describe, expect, it } from "vitest";
import { agentOut, byHour, computeOutKpis, dailyOut, dispositionMix, groupOut, hourlyHeat, normalizeCalls, rankOutAgents, type OutCaps } from "../outbound.metrics.js";

const caps: OutCaps = { duration: true, talk: false, lead: true, uniqueFlag: false, campaign: true, tl: true, hour: true };
const connected = ["Connected", "Sale"];
const raw = (o: Record<string, unknown>) => ({ date: "2026-09-07", agent_code: "a1", disposition: "Connected", duration_sec: "60", lead_id: "L1", campaign: "C", tl_name: "T", hour: 10, ...o });
const mk = (rows: Array<Record<string, unknown>>, c = caps) => normalizeCalls(rows, connected, c);

describe("outbound kpis", () => {
  const { rows } = mk([
    raw({}), raw({ disposition: "No Answer", duration_sec: "0" }), raw({ lead_id: "L2", disposition: "sale", duration_sec: "120" }),
    raw({ lead_id: "L2", disposition: "Busy" }), raw({ lead_id: "L3", disposition: "Busy" }),
  ]);
  it("dials, connects, rate, leads, penetration, attempts, talk", () => {
    const k = computeOutKpis(rows, caps);
    expect(k.dials).toBe(5);
    expect(k.connects).toBe(2);
    expect(k.connectRate).toBe(40);
    expect(k.uniqueLeads).toBe(3);
    expect(k.contactPenetrationPct).toBe(66.67);
    expect(k.attemptsPerLead).toBe(1.67);
    expect(k.talkSec).toBe(180);
    expect(k.avgTalkSec).toBe(90);
  });
  it("empty input gives nulls", () => {
    const k = computeOutKpis([], caps);
    expect(k.dials).toBe(0);
    expect(k.connectRate).toBeNull();
    expect(k.uniqueLeads).toBe(0);
    expect(k.attemptsPerLead).toBeNull();
    expect(k.contactPenetrationPct).toBeNull();
    expect(k.avgTalkSec).toBeNull();
  });
  it("unique lead flag wins over distinct lead ids; unmapped lead gives null", () => {
    const c: OutCaps = { ...caps, uniqueFlag: true };
    const r = mk([raw({ unique_lead_flag: 1 }), raw({ unique_lead_flag: 0 }), raw({ unique_lead_flag: "Y" })], c).rows;
    expect(computeOutKpis(r, c).uniqueLeads).toBe(2);
    const c2: OutCaps = { ...caps, lead: false };
    const k = computeOutKpis(mk([raw({})], c2).rows, c2);
    expect(k.uniqueLeads).toBeNull();
    expect(k.contactPenetrationPct).toBeNull();
    expect(k.attemptsPerLead).toBeNull();
  });
  it("negative or bad durations are counted, not summed", () => {
    const n = mk([raw({ duration_sec: "-5" }), raw({ duration_sec: "x" }), raw({ duration_sec: "30" })]);
    expect(n.badDurations).toBe(2);
    expect(computeOutKpis(n.rows, caps).talkSec).toBe(30);
  });
  it("disposition mix, groups, hourly", () => {
    const m = dispositionMix(rows);
    expect(m[0]).toMatchObject({ disposition: "Busy", calls: 2, pct: 40 });
    expect(m.find((x) => x.disposition === "sale")!.connected).toBe(true);
    expect(groupOut(rows, caps, (r) => r.campaign)[0]).toMatchObject({ key: "C", dials: 5 });
    expect(byHour(rows)).toEqual([{ hour: 10, dials: 5, connects: 2, connectRate: 40 }]);
    const heat = hourlyHeat(rows);
    expect(heat).toEqual([{ weekday: 1, hour: 10, dials: 5, connects: 2, connectRate: 40 }]); // 2026-09-07 is a Monday
    expect(hourlyHeat(mk([raw({ hour: null })]).rows)).toEqual([]);
  });
  it("daily, agents and ranking", () => {
    const more = mk([raw({}), raw({ agent_code: "b2", date: "2026-09-08", disposition: "Busy" })]).rows;
    expect(dailyOut(more, caps).map((d) => d.date)).toEqual(["2026-09-07", "2026-09-08"]);
    const a = agentOut(more, caps);
    expect(a.map((x) => x.agent)).toEqual(["A1", "B2"]);
    expect(rankOutAgents(a, 1).top[0].agent).toBe("A1");
    expect(rankOutAgents(a, 1).top.map((x) => x.agent)).toEqual(["A1", "B2"]);
    expect(rankOutAgents(a, 1, 1).bottom[0].agent).toBe("B2");
  });
});
