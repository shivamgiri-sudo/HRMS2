import { describe, expect, it } from "vitest";
import { INSIGHT_DEFAULTS, evaluateInsights, type InsightFacts, type InsightThresholds, type RateFact } from "../he-drive-insights.js";
import { emptyFunnelFacts, peakHour, reasonLabel, type FunnelCampaignFact, type FunnelJourney } from "../he-drive-insights-funnel.js";
import { zeroStages } from "../he-drive-analytics.js";
import type { SourceType } from "../qualified-followup.types.js";

const t: InsightThresholds = { ...INSIGHT_DEFAULTS };
const R = (n = 0, hits = 0): RateFact => ({ n, hits });
const per = <T>(make: () => T): Record<SourceType, T> => ({ meta_live: make(), meta_old: make(), he: make() });
const J = (o: Partial<FunnelJourney> = {}): FunnelJourney => ({ leads: 0, fills: 0, screened: 0, qualified: 0, contacted: 0, invited: 0, replied: 0, confirmed: 0, arrived: 0, ...o });
const camp = (o: Partial<FunnelCampaignFact> = {}): FunnelCampaignFact => ({
  key: "c1", name: "K7BK night", requisitionId: "r1", code: "REQ-1", branch: "NOIDA-2", sourceType: "meta_live",
  leads: 0, fills: 0, screened: 0, qualified: 0, contacted: 0, invited: 0, confirmed: 0, arrived: 0, blockers: [], ...o,
});
const facts = (fn: (f: InsightFacts & { funnel: NonNullable<InsightFacts["funnel"]> }) => void): InsightFacts => {
  const f = {
    today: "2026-10-08", windowDays: 14,
    types: per(() => ({ current: zeroStages(), previous: zeroStages(), noShow: 0, declined: 0 })),
    tomorrow: [], contact: per(() => ({ inside: R(), outside: R() })),
    reminders: per(() => ({ confirmed: 0, missing: 0, withReminder: R(), withoutReminder: R() })),
    distance: per(() => ({ near: R(), far: R() })),
    channel: per(() => ({ qualified: 0, unreached: 0, reachedArrivalRate: 0, waFailedByCode: {}, waDelivered: 0, waUnread: 0 })),
    language: per(() => ({ hi: R(), other: R() })),
    slots: [], streams: [], sources: [], weekdays: [],
    funnel: emptyFunnelFacts(),
  };
  fn(f);
  return f;
};
const ofRule = (f: InsightFacts, rule: string, th = t) => evaluateInsights(f, th).filter((i) => i.rule === rule);
const noBad = (v: unknown) => { const j = JSON.stringify(v); expect(j).not.toContain("NaN"); expect(j).not.toContain("Infinity"); expect(j).not.toContain("undefined"); };
const ev = (i: { evidence: Array<{ label: string; value: string }> }, label: string) => i.evidence.find((e) => e.label === label)?.value;

describe("funnel facts: absent or empty", () => {
  it("no funnel facts (older callers) and empty funnel facts add nothing", () => {
    const f = facts(() => undefined);
    expect(evaluateInsights(f, t)).toEqual([]);
    const { funnel, ...old } = f; void funnel;
    expect(evaluateInsights(old as InsightFacts, t)).toEqual([]);
  });
  it("every new threshold is an insight.* default the owner can tune", () => {
    for (const k of ["insight.stalled_critical", "insight.contact_confirm_gap", "insight.no_show_max", "insight.low_qual_share", "insight.best_campaign_lift",
      "insight.branch_share", "insight.cost_join_lift", "insight.cost_min_joins"]) expect(INSIGHT_DEFAULTS).toHaveProperty(k);
  });
});

describe("stalled_leads (qualified leads nobody contacted)", () => {
  it("names the campaign, the count, the server's blocker and a concrete owner action", () => {
    const f = facts((x) => { x.funnel.campaigns = [camp({ leads: 91, fills: 91, screened: 91, qualified: 78,
      blockers: [{ code: "requisition_closed", text: "REQ-1: requisition is closed, so outreach refuses its leads" }, { code: "no_bmi_link", text: "REQ-1 has no BookMyInterview link" }] })]; });
    const [i] = ofRule(f, "stalled_leads");
    expect(i).toMatchObject({ severity: "critical", sourceType: "meta_live", requisitionId: "r1", action: { type: "open_section", section: "live" } });
    expect(i.title).toBe("K7BK night: 78 qualified Live Meta leads have had no contact");
    expect(ev(i, "Qualified at screening")).toBe("78");
    expect(ev(i, "Contacted")).toBe("0");
    expect(i.suggestion).toContain("requisition is closed");
    expect(i.ownerAction).toContain("relink");
    expect(i.effect).toMatchObject({ unit: "people", value: 78 });
    noBad(i);
  });
  it("a few stalled leads warn; no blocker known says to check the outreach log", () => {
    const [i] = ofRule(facts((x) => { x.funnel.campaigns = [camp({ sourceType: "meta_old", qualified: 3, leads: 3 })]; }), "stalled_leads");
    expect(i.severity).toBe("warn");
    expect(i.action).toEqual({ type: "open_section", section: "old" });
    expect(i.ownerAction).toContain("Hiring Engine");
  });
  it("does not fire once anyone was contacted, or with nobody qualified", () => {
    expect(ofRule(facts((x) => { x.funnel.campaigns = [camp({ qualified: 40, contacted: 1 }), camp({ key: "c2", qualified: 0 })]; }), "stalled_leads")).toEqual([]);
  });
});

describe("contact_confirm (contacted to confirmed against the other drives)", () => {
  it("fires when a drive confirms far fewer of the people it contacts than the best other drive, with both samples stated", () => {
    const f = facts((x) => { x.funnel.journey = { meta_live: J(), meta_old: J({ contacted: 257, confirmed: 18 }), he: J({ contacted: 112, confirmed: 30 }) }; });
    const [i] = ofRule(f, "contact_confirm");
    expect(i).toMatchObject({ sourceType: "meta_old", severity: "warn", action: { type: "open_followup" } });
    expect(ev(i, "Contacted to confirmed now")).toBe("7%");
    expect(ev(i, "Hiring Engine contacted to confirmed")).toBe("27%");
    expect(ev(i, "People contacted")).toBe("257");
    expect(i.ownerAction).toBeTruthy();
    noBad(i);
  });
  it("stays quiet when either sample is under insight.min_sample", () => {
    const f = facts((x) => { x.funnel.journey = { meta_live: J({ contacted: 19, confirmed: 0 }), meta_old: J(), he: J({ contacted: 100, confirmed: 60 }) }; });
    expect(ofRule(f, "contact_confirm")).toEqual([]);
  });
});

describe("no_show_leak (confirmed people who do not come)", () => {
  const g = () => Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
  it("uses resolved people only (arrived + no-show), and carries the best reply and arrival hours when they have a sample", () => {
    const f = facts((x) => {
      x.types.meta_old = { current: { ...zeroStages(), arrived: 3 }, previous: zeroStages(), noShow: 190, declined: 0 };
      x.funnel.replyPeak.meta_old = { hour: 11, n: 9, total: 25 };
      x.funnel.arrivalPeak.meta_old = { hour: 10, n: 2, total: 3 };
    });
    const [i] = ofRule(f, "no_show_leak");
    expect(i).toMatchObject({ sourceType: "meta_old", severity: "critical", action: { type: "open_followup" } });
    expect(ev(i, "No-show rate")).toBe("98%");
    expect(ev(i, "People with a result (arrived or no-show)")).toBe("193");
    expect(ev(i, "Most replies arrive at")).toBe("11:00 IST (9 of 25)");
    expect(ev(i, "Arrival times recorded")).toBe("3, too few to name a best hour");
    expect(i.suggestion).toContain("11:00");
    noBad(i);
    void g;
  });
  it("does not fire under the threshold or under the minimum sample", () => {
    expect(ofRule(facts((x) => { x.types.he = { current: { ...zeroStages(), arrived: 15 }, previous: zeroStages(), noShow: 10, declined: 0 }; }), "no_show_leak")).toEqual([]);
    expect(ofRule(facts((x) => { x.types.he = { current: { ...zeroStages(), arrived: 0 }, previous: zeroStages(), noShow: 19, declined: 0 }; }), "no_show_leak")).toEqual([]);
  });
});

describe("low_qualification (many fills, few pass screening)", () => {
  it("names the top disqualify reasons when the server read them", () => {
    const f = facts((x) => { x.funnel.campaigns = [camp({ name: "Ahmedabad", leads: 60, fills: 60, screened: 60, qualified: 10, contacted: 10,
      disqualify: [{ reason: "DRA certification required but candidate answered", n: 40 }, { reason: "Age", n: 10 }] })]; });
    const [i] = ofRule(f, "low_qualification");
    expect(i).toMatchObject({ severity: "warn", sourceType: "meta_live", requisitionId: "r1" });
    expect(ev(i, "Passed screening")).toBe("17%");
    expect(ev(i, "Screened")).toBe("60");
    expect(ev(i, "Top reason")).toBe("DRA certification required but candidate answered (40)");
    expect(ev(i, "Second reason")).toBe("Age (10)");
    expect(i.ownerAction).toContain("screening");
    noBad(i);
  });
  it("needs insight.min_sample screened fills", () => {
    expect(ofRule(facts((x) => { x.funnel.campaigns = [camp({ screened: 19, qualified: 0 })]; }), "low_qualification")).toEqual([]);
  });
});

describe("best_campaign (where to push budget)", () => {
  it("names the campaign that turns leads into confirmations best, and warns when its requisition has no open seat", () => {
    const f = facts((x) => {
      x.funnel.campaigns = [camp({ key: "a", name: "Ahmedabad", sourceType: "meta_old", leads: 165, confirmed: 11 }), camp({ key: "b", name: "DZCV", requisitionId: "r2", code: "REQ-2", sourceType: "meta_old", leads: 116, confirmed: 5 }),
        camp({ key: "c", name: "6GFX", requisitionId: "r3", code: "REQ-3", sourceType: "meta_old", leads: 32, confirmed: 0 })];
      x.funnel.openSeats = [{ requisitionId: "r1", code: "REQ-1", branch: "AHMEDABAD", open: 32 }];
    });
    const [i] = ofRule(f, "best_campaign");
    expect(i).toMatchObject({ severity: "info", requisitionId: "r1" });
    expect(i.title).toBe("Ahmedabad confirms the most leads per lead of any campaign");
    expect(ev(i, "Ahmedabad leads to confirmed")).toBe("7%");
    expect(ev(i, "Other campaigns leads to confirmed")).toBe("3%");
    expect(i.suggestion).toContain("32 open seats");
    noBad(i);
  });
  it("needs two campaigns with insight.min_sample leads", () => {
    expect(ofRule(facts((x) => { x.funnel.campaigns = [camp({ leads: 100, confirmed: 20 }), camp({ key: "b", leads: 19, confirmed: 0 })]; }), "best_campaign")).toEqual([]);
  });
});

describe("branch_concentration", () => {
  it("fires when one branch holds most of a drive's leads while other branches have open seats", () => {
    const f = facts((x) => {
      x.sources = [{ requisitionId: "r1", code: "REQ-1", byType: { meta_live: { leads: 90, joined: 0, invited: 0 } } }, { requisitionId: "r2", code: "REQ-2", byType: { meta_live: { leads: 5, joined: 0, invited: 0 } } }];
      x.funnel.openSeats = [{ requisitionId: "r1", code: "REQ-1", branch: "NOIDA-2", open: 2 }, { requisitionId: "r2", code: "REQ-2", branch: "AHMEDABAD", open: 32 }];
    });
    const [i] = ofRule(f, "branch_concentration");
    expect(i).toMatchObject({ severity: "info", sourceType: "meta_live" });
    expect(ev(i, "NOIDA-2 share of leads")).toBe("95%");
    expect(ev(i, "Open seats elsewhere")).toBe("32");
    expect(i.suggestion).toContain("AHMEDABAD");
    noBad(i);
  });
  it("stays quiet with one branch, no open seats elsewhere, or under the minimum sample", () => {
    const one = facts((x) => { x.sources = [{ requisitionId: "r1", code: "REQ-1", byType: { he: { leads: 90, joined: 0, invited: 0 } } }]; x.funnel.openSeats = [{ requisitionId: "r1", code: "REQ-1", branch: "P", open: 5 }]; });
    expect(ofRule(one, "branch_concentration")).toEqual([]);
  });
});

describe("cost_per_join", () => {
  it("names the cheapest drive per join only with insight.cost_min_joins joins on both sides", () => {
    const f = facts((x) => { x.funnel.cost = { meta_live: { perJoin: 1200, joined: 6 }, meta_old: { perJoin: 300, joined: 8 }, he: { perJoin: 900, joined: 2 } }; });
    const [i] = ofRule(f, "cost_per_join");
    expect(i).toMatchObject({ severity: "info", sourceType: "meta_old" });
    expect(ev(i, "Old Meta data cost per join")).toBe("Rs 300");
    expect(ev(i, "Live Meta cost per join")).toBe("Rs 1200");
    expect(ofRule(facts((x) => { x.funnel.cost = { meta_live: { perJoin: 1200, joined: 4 }, meta_old: { perJoin: 300, joined: 8 }, he: { perJoin: null, joined: 0 } }; }), "cost_per_join")).toEqual([]);
  });
});

describe("helpers", () => {
  it("peakHour sums weekdays per hour and reports the busiest hour with the total", () => {
    const g = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
    g[0][11] = 3; g[3][11] = 2; g[2][15] = 4;
    expect(peakHour(g)).toEqual({ hour: 11, n: 5, total: 9 });
    expect(peakHour(undefined)).toEqual({ hour: 0, n: 0, total: 0 });
  });
  it("reasonLabel keeps the rule text and drops candidate answers and numbers", () => {
    expect(reasonLabel("Age 17 below minimum 18")).toBe("Age");
    expect(reasonLabel("DRA certification required but candidate answered: \"No\"")).toBe("DRA certification required but candidate answered");
    expect(reasonLabel("Custom rule failed: Willing to work night shifts (expected a yes answer)")).toBe("Custom rule failed: Willing to work night shifts (expected a yes answer)");
    expect(reasonLabel(null)).toBe("Not recorded");
  });
});
