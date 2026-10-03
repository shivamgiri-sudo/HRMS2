import { describe, it, expect } from "vitest";
import { deriveInsights } from "../sbiCardInsights";
import type { SbiCollections, SbiDimRow } from "../sbiCardTypes";

const dim = (o: Partial<SbiDimRow>): SbiDimRow => ({
  key: "1", accounts: 100, exposure: 1_000_000, worked: 95, untouched: 5, coveragePct: 95, attemptsPerAccount: 2.5, ptpAccounts: 15, ptpPct: 15.8,
  overduePtp: 2, exhausted: 10, dnc: 1, ...o,
});
const ops = (o: Partial<SbiCollections["headline"]> = {}, delq: SbiDimRow[] = [dim({})]): SbiCollections => ({
  snapshotDate: "2026-09-25",
  headline: {
    accounts: 1000, exposure: 10_000_000, worked: 960, untouched: 40, untouchedExposure: 500_000, coveragePct: 96, attemptsTotal: 2400, attemptsPerAccount: 2.4,
    attemptsPerWorked: 2.5, ptpAccounts: 150, ptpPct: 15.6, ptpExposure: 1_500_000, overduePtp: 30, overduePtpExposure: 400_000, ptpDueSoon: 10,
    callbacksOverdue: 12, callbacksUpcoming: 20, exhausted: 160, exhaustedExposure: 2_000_000, dnc: 20, dncExposure: 300_000,
    dncDialled: 0, dncDialledAttempts: 0, stalePayers: 0, stalePayersExposure: 0, dpiAccrued: 0, ...o,
  },
  position: [], compliance: { windowLabel: "08:00-18:55", window: { attempts: 0, outside: 0, outsidePct: 0, before: 0, after: 0 }, redialedAfterExclusion: { accounts: 0, attempts: 0, byCode: [] }, welfare: { suicideThreat: { accounts: 0, exposure: 0 }, deceased: { accounts: 0, exposure: 0 }, dispute: { accounts: 0, exposure: 0 }, refusal: { accounts: 0, exposure: 0 } }, intent: { settlement: { accounts: 0, exposure: 0 }, hardship: { accounts: 0, exposure: 0 }, languageBarrier: { accounts: 0, exposure: 0 }, paidAlready: { accounts: 0, exposure: 0 } }, unlisted: { attempts: 0, pct: 0, codes: [] } }, contactability: { attempts: 0, noConversation: 0, noConversationPct: 0, stuck: { accounts: 0, exposure: 0 }, voicemailRepeat: { accounts: 0, exposure: 0 }, wrongNumber: { accounts: 0, exposure: 0 }, byDate: [], clientContact: { attempts: 0, pct: 0, notCounted: { attempts: 0, pct: 0, codes: [] } }, evidence: { hourDeadP: 0.01, hourPtpP: 0.01, agentPtpP: 0.01 }, agentSpread: null }, dispositions: [], lastAction: [], attemptDepth: [],
  byHour: [{ hour: 9, attempts: 200, ptp: 14, ptpPct: 7, noConversationPct: 60 }, { hour: 10, attempts: 200, ptp: 20, ptpPct: 10, noConversationPct: 55 }, { hour: 11, attempts: 200, ptp: 16, ptpPct: 8, noConversationPct: 58 }],
  agents: [], dimensionSignal: Object.fromEntries(["cd","tier","nrr","recencyBand","balanceBand","delq","region","productClass","accountClass","cibilBand","vintageBand","callTable","billingCycle","customerType"].map((k) => [k, { ptpP: 0.01, coverageP: 0.01 }])) as never, dimensions: { cd: [], program: [], flow: [], tier: [], nrr: [], recencyBand: [], balanceBand: [], delq, region: [], productClass: [], accountClass: [], cibilBand: [], vintageBand: [], callTable: [], billingCycle: [], customerType: [] },
  worklists: { untouched: [], overduePtp: [{ accountNo: "ACC1", delq: "5", region: "EAST", totalDue: 90_000, attempts: 3, lastActionCode: "PTP", due: "2026-09-20" }], overdueCallbacks: [] },
});

describe("critical insights", () => {
  it("ranks critical findings first and quantifies them in money", () => {
    const list = deriveInsights(ops(), null);
    expect(list[0]!.level).toBe("critical");
    const lapsed = list.find((i) => i.id === "lapsed-ptp")!;
    expect(lapsed.metric).toBe("₹4.0 L");
    expect(lapsed.action).toContain("ACC1");
    const levels = list.map((i) => i.level);
    expect(levels).toEqual([...levels].sort((a, b) => ["critical", "warning", "info", "good"].indexOf(a) - ["critical", "warning", "info", "good"].indexOf(b)));
  });
  it("raises a compliance insight when do-not-call accounts were dialled", () => {
    const list = deriveInsights(ops({ dnc: 29, dncDialled: 27, dncDialledAttempts: 61 }), null);
    const d = list.find((i) => i.id === "dnc-dialled")!;
    expect(d.level).toBe("critical");
    expect(d.title).toContain("27 of 29");
  });
  it("turns contactability facts into insights and stays silent when there are none", () => {
    const base = ops();
    expect(deriveInsights(base, null, 20).some((i) => i.id === "stuck" || i.id === "taper")).toBe(false);
    const k = { attempts: 1000, noConversation: 620, noConversationPct: 62, stuck: { accounts: 52, exposure: 600_000 }, voicemailRepeat: { accounts: 65, exposure: 700_000 }, wrongNumber: { accounts: 75, exposure: 900_000 },
      byDate: [{ date: "2026-09-20", attempts: 500, noConversationPct: 60 }, { date: "2026-09-22", attempts: 450, noConversationPct: 60 }, { date: "2026-09-25", attempts: 200, noConversationPct: 60 }],
      clientContact: { attempts: 0, pct: 0, notCounted: { attempts: 0, pct: 0, codes: [] } },
      evidence: { hourDeadP: 0.01, hourPtpP: 0.01, agentPtpP: 0.01 }, agentSpread: { agents: 39, p25: 4, median: 6.6, p75: 9, best: { agentId: "1", ptpPct: 14 }, worst: { agentId: "2", ptpPct: 0 } } };
    const ids = deriveInsights({ ...base, contactability: k }, null, 30).map((i) => i.id);
    for (const id of ["no-conversation", "stuck", "wrong-number", "taper", "agent-spread"]) expect(ids).toContain(id);
  });
  it("does not present noise as an insight", () => {
    const base = ops({}, [dim({ key: "8", ptpPct: 6, exposure: 2_000_000 })]);
    const noisy = { ...base,
      dimensionSignal: Object.fromEntries(Object.keys(base.dimensionSignal).map((k) => [k, { ptpP: 0.6, coverageP: 0.6 }])) as never,
      contactability: { ...base.contactability, evidence: { hourDeadP: 0.57, hourPtpP: 0.11, agentPtpP: 0.8 },
        agentSpread: { agents: 39, p25: 4, median: 6.6, p75: 9, best: { agentId: "1", ptpPct: 14 }, worst: { agentId: "2", ptpPct: 0 } } } };
    const ids = deriveInsights(noisy, null, 30).map((i) => i.id);
    for (const id of ["weak-bucket", "hours", "agent-spread", "coverage-gap"]) expect(ids).not.toContain(id);
    expect(ids).toContain("no-signal");
  });
  it("flags calls outside the permitted window, re-dials after exclusion, and high-intent customers", () => {
    const base = ops();
    const withC = { ...base, compliance: { ...base.compliance,
      window: { attempts: 2486, outside: 244, outsidePct: 9.8, before: 0, after: 244 },
      redialedAfterExclusion: { accounts: 289, attempts: 562, byCode: [{ code: "DS", label: "Deceased Customer", accounts: 28 }, { code: "PTP", label: "Promise To Pay", accounts: 60 }] },
      intent: { ...base.compliance.intent, settlement: { accounts: 20, exposure: 300_000 }, hardship: { accounts: 31, exposure: 450_000 }, languageBarrier: { accounts: 54, exposure: 700_000 } },
      unlisted: { attempts: 671, pct: 27, codes: [{ code: "VOML", attempts: 441 }] } } };
    const list = deriveInsights(withC, null, 30);
    const byId = Object.fromEntries(list.map((i) => [i.id, i]));
    expect(byId["call-window"]!.level).toBe("critical");
    expect(byId["call-window"]!.title).toContain("08:00-18:55");
    expect(byId["redial-after-exclusion"]!.level).toBe("critical"); // includes a deceased-customer case
    expect(byId["intent"]!.title).toContain("51 customers");
    expect(byId["language"]).toBeTruthy();
    expect(byId["unlisted-dispositions"]).toBeTruthy();
  });
  it("explains the gap between conversations and what the client\'s MIS counts as a contact", () => {
    const base = ops();
    const withK = { ...base, contactability: { ...base.contactability, clientContact: { attempts: 460, pct: 18.5, notCounted: { attempts: 331, pct: 13.3, codes: [{ code: "DISP", label: "Dispute", attempts: 102 }, { code: "LB", label: "Language Barrier", attempts: 54 }] } } } };
    const i = deriveInsights(withK, null, 30).find((x) => x.id === "contact-definition")!;
    expect(i.title).toContain("13.3%");
    expect(i.detail).toContain("PTP, PAD, OTP, DS, RTP and CBL");
  });
  it("flags a penetration shortfall against the client's target, with the hours it needs", () => {
    const cap = { target: 3, targetFromClient: true, rows: [{ table: "CD3_HB", accounts: 1000, attempts: 2000, penetration: 2, requiredDials: 3000, shortfallDials: 1000, status: "behind" as const }],
      total: { accounts: 1000, attempts: 2000, penetration: 2, requiredDials: 3000, shortfallDials: 1000, behindTables: 1 },
      capacity: { dph: 10, loginHours: 100, extraHoursToCloseGap: 100, requiredHoursAtTarget: 300 }, downtime: { events: 1, agentHoursLost: 143, dialsLost: 1430 } };
    const i = deriveInsights(ops(), null, 30, cap).find((x) => x.id === "penetration")!;
    expect(i.level).toBe("critical");                    // a full dial below target
    expect(i.detail).toContain("100 more login hours");
    expect(i.action).toContain("143 agent-hours");
    expect(deriveInsights(ops(), null, 30, { ...cap, total: { ...cap.total, penetration: 3.1, shortfallDials: 0 } }).some((x) => x.id === "penetration")).toBe(false);
  });
  it("flags high-balance accounts being worked by the low-balance team, and a roster that is out of date", () => {
    const team = { hasRoster: true, rosterSize: 139, byTeam: [], byLeader: [], apr: { agents: 19, matched: 0 }, evidence: { leaderPtpP: null },
      alignment: { high: { attempts: 400, byHighbal: 260, byLowbal: 120, byOther: 20, lowbalPct: 30 }, low: { attempts: 100, byLowbal: 90, byHighbal: 10, byOther: 0, highbalPct: 10 } },
      unmapped: { agents: 7, attempts: 60, pct: 12 } };
    const ids = deriveInsights(ops(), null, 30, null, team).map((i) => i.id);
    expect(ids).toContain("misrouted-high-balance");
    expect(ids).toContain("roster-gap");
    const quiet = { ...team, alignment: { ...team.alignment, high: { ...team.alignment.high, byLowbal: 10, lowbalPct: 2.5 } }, unmapped: { agents: 0, attempts: 0, pct: 0 } };
    expect(deriveInsights(ops(), null, 30, null, quiet).some((i) => i.id === "misrouted-high-balance" || i.id === "roster-gap")).toBe(false);
  });
  it("names the best and worst team leader only when the gap is statistically real", () => {
    const base = { hasRoster: true, rosterSize: 10, byTeam: [], apr: { agents: 0, matched: 0 }, alignment: { high: { attempts: 0, byHighbal: 0, byLowbal: 0, byOther: 0, lowbalPct: 0 }, low: { attempts: 0, byLowbal: 0, byHighbal: 0, byOther: 0, highbalPct: 0 } }, unmapped: { agents: 0, attempts: 0, pct: 0 } };
    const g = (key: string, attempts: number, ptp: number) => ({ key, teams: [], agents: 5, activeAgents: 5, attempts, accountsTouched: 10, ptp, ptpPct: Math.round((ptp / attempts) * 1000) / 10, deadPct: 50, aprMatched: 0, loginHours: null, utilisationPct: null, pausePct: null, callsPerLoginHour: null });
    const byLeader = [g("Sourabh", 200, 30), g("Ankit", 200, 8)];
    expect(deriveInsights(ops(), null, 30, null, { ...base, byLeader, evidence: { leaderPtpP: 0.0004 } }).find((i) => i.id === "leader-spread")!.title).toContain("Sourabh 15.0% to Ankit 4.0%");
    expect(deriveInsights(ops(), null, 30, null, { ...base, byLeader, evidence: { leaderPtpP: 0.4 } }).some((i) => i.id === "leader-spread")).toBe(false);
  });
  it("calls out the hour with the best PTP yield", () => {
    const hours = deriveInsights(ops(), null).find((i) => i.id === "hours")!;
    expect(hours.title).toContain("10:00");
    expect(hours.action).toContain("09:00");
  });
  it("names a material bucket that converts far below overall, and ignores small ones", () => {
    const list = deriveInsights(ops({}, [dim({ key: "8", ptpPct: 6, exposure: 2_000_000 }), dim({ key: "9", ptpPct: 2, exposure: 100_000 })]), null);
    const weak = list.find((i) => i.id === "weak-bucket")!;
    expect(weak.title).toContain("Bucket 8");
  });
  it("is quiet when there is nothing to say and never fabricates for an empty file", () => {
    expect(deriveInsights(ops({ accounts: 0 }), null)).toEqual([]);
    const calm = deriveInsights(ops({ overduePtp: 0, untouched: 0, exhausted: 0, callbacksOverdue: 0, coveragePct: 99 }, [dim({})]), null);
    expect(calm.every((i) => i.level === "good" || i.level === "info")).toBe(true);
  });
  it("adds floor findings from agent time", () => {
    const time = {
      agents: [{ employeeId: "M1", name: "Asha", days: 1, calls: 10, loginHours: 9, talkHours: 1, dispoHours: 0.2, waitHours: 5, pauseHours: 2, utilisationPct: 13, occupancyPct: 20, pausePct: 22, waitPct: 55, achtSec: 100, callsPerLoginHour: 1, firstLogin: null, lastLogout: null, flags: ["Low utilisation"] }],
      summary: { agents: 1, days: 1, calls: 10, loginHours: 9, utilisationPct: 13, occupancyPct: 20, pausePct: 22, waitPct: 55, achtSec: 100, callsPerLoginHour: 1, flagged: 1 },
      pauseCodes: [], daily: [],
    };
    const ids = deriveInsights(ops(), time, 20).map((i) => i.id);
    expect(ids).toContain("idle");
    expect(ids).toContain("agents");
  });
});
