import { describe, it, expect } from "vitest";
import { CLIENT_CONTACT_CODES, CLIENT_PROMISE_CODES, parseCallTable, isNoConversation, isPromise, outsideCallWindow, isExcludeAfterFirstPass } from "../sbi-card-dispositions.js";
import { collectionsOps, cibilBand, vintageBand, recencyBand, balanceBand, tierOf, type AccountOpsRow } from "../sbi-card-collections-ops.calc.js";

const row = (o: Partial<AccountOpsRow> & { disps?: Array<string | null>; hours?: number[] }): AccountOpsRow => {
  const disps = o.disps ?? [];
  return {
    accountNo: "A1", delq: "2", billingCycle: "5", cibil: 700, vintage: 40, region: "EAST", productClass: "PREM", accountClass: "REGULAR",
    callTable: "T1", promo: "PR1", ntc: "N", newToCard: "N", totalDue: 1000, curBal: 5000, lastActionCode: null, lastPtpDate: null,
    callbackDt: null, dnc: "N", dialCnt: null,
    attempts: disps.map((d, i) => ({ dt: `2026-09-25 ${String((o.hours ?? [])[i] ?? 10).padStart(2, "0")}:00:00`, disp: d, agent: "1030" })),
    ...o,
  };
};
const SNAP = "2026-09-25";

describe("collections ops headline", () => {
  const rows = [
    row({ accountNo: "U1", totalDue: 5000 }),                                         // untouched, big
    row({ accountNo: "U2", totalDue: 100, dnc: "Y" }),                                // untouched DNC: excluded from worklist
    row({ accountNo: "W1", disps: ["NC"], totalDue: 200 }),
    row({ accountNo: "P1", disps: ["NC", "PTP"], lastActionCode: "PTP", lastPtpDate: "2026-09-20", totalDue: 700 }), // lapsed promise
    row({ accountNo: "P2", disps: ["PTP"], lastActionCode: "PTP", lastPtpDate: "2026-09-27", totalDue: 300 }),        // due soon
    row({ accountNo: "X1", disps: ["NC", "NC", "VOML", "WN"], totalDue: 400, callbackDt: "2026-09-22 11:00:00" }),    // exhausted + stale callback
  ];
  const o = collectionsOps(rows, SNAP);
  const h = o.headline;
  it("counts coverage and untouched with exposure", () => {
    expect(h.accounts).toBe(6);
    expect(h.worked).toBe(4);
    expect(h.untouched).toBe(2);
    expect(h.untouchedExposure).toBe(5100);
    expect(h.coveragePct).toBe(66.7);
    expect(h.exposure).toBe(6700);
  });
  it("derives PTP pipeline, lapsed promises, callbacks, exhausted and DNC", () => {
    expect(h.ptpAccounts).toBe(2);
    expect(h.ptpPct).toBe(50);           // 2 of 4 worked
    expect(h.ptpExposure).toBe(1000);
    expect(h.overduePtp).toBe(1);
    expect(h.overduePtpExposure).toBe(700);
    expect(h.ptpDueSoon).toBe(1);        // 09-27 is inside snapshot + 3 days
    expect(h.callbacksOverdue).toBe(1);
    expect(h.exhausted).toBe(1);
    expect(h.exhaustedExposure).toBe(400);
    expect(h.dnc).toBe(1);
    expect(h.attemptsTotal).toBe(8);
    expect(h.attemptsPerWorked).toBe(2);
  });
  it("keeps DNC accounts off the untouched worklist and orders worklists by exposure", () => {
    expect(o.worklists.untouched.map((w) => w.accountNo)).toEqual(["U1"]);
    expect(o.worklists.overduePtp[0]!.accountNo).toBe("P1");
    expect(o.worklists.overdueCallbacks[0]!.accountNo).toBe("X1");
  });
  it("builds disposition mix, attempt depth, hour yield and agent rows", () => {
    expect(o.dispositions[0]).toMatchObject({ code: "NC", attempts: 4 });
    expect(o.attemptDepth.find((d) => d.attempts === "0")!.accounts).toBe(2);
    expect(o.attemptDepth.find((d) => d.attempts === "4")!.accounts).toBe(1);
    expect(o.byHour).toEqual([{ hour: 10, attempts: 8, ptp: 2, ptpPct: 25, noConversationPct: 75 }]);
    expect(o.agents[0]).toMatchObject({ agentId: "1030", attempts: 8, ptp: 2 });
  });
  it("puts every account in exactly one position stage", () => {
    const pos = Object.fromEntries(o.position.map((p) => [p.stage, p]));
    expect(pos.lapsed).toMatchObject({ accounts: 1, exposure: 700 });
    expect(pos.promised).toMatchObject({ accounts: 1, exposure: 300 });
    expect(pos.exhausted).toMatchObject({ accounts: 1, exposure: 400 });
    expect(pos.untouched).toMatchObject({ accounts: 2, exposure: 5100 });
    expect(pos.inProgress).toMatchObject({ accounts: 1, exposure: 200 });
    expect(o.position.reduce((s, p) => s + p.accounts, 0)).toBe(h.accounts);
    expect(o.position.reduce((s, p) => s + p.exposure, 0)).toBe(h.exposure);
  });
  it("splits every dimension and keeps totals", () => {
    expect(o.dimensions.region[0]).toMatchObject({ key: "EAST", accounts: 6 });
    for (const rowsOfDim of Object.values(o.dimensions)) expect(rowsOfDim.reduce((s, r) => s + r.accounts, 0)).toBe(6);
  });
});

describe("edge cases and bands", () => {
  it("is all zeros, never NaN, with no rows", () => {
    const o = collectionsOps([], null);
    expect(Object.values(o.headline).every((v) => Number.isFinite(v))).toBe(true);
    expect(o.dimensions.delq).toEqual([]);
  });
  it("uses the dialer's dial count when it exceeds the call slots", () => {
    const o = collectionsOps([row({ dialCnt: 5 })], SNAP);
    expect(o.headline.worked).toBe(1);
    expect(o.headline.exhausted).toBe(1);
  });
  it("bands scores and vintage", () => {
    expect([cibilBand(null), cibilBand(599), cibilBand(600), cibilBand(749), cibilBand(750)]).toEqual(["No score", "<600", "600-649", "700-749", "750+"]);
    expect([vintageBand(30), vintageBand(31), vintageBand(91), vintageBand(null)]).toEqual(["0-30", "31-60", "90+", "Unknown"]);
  });
  it("orders score bands low to high", () => {
    const o = collectionsOps([row({ cibil: 800 }), row({ cibil: 550 }), row({ cibil: null })], SNAP);
    expect(o.dimensions.cibilBand.map((d) => d.key)).toEqual(["<600", "750+", "No score"]);
  });
});

describe("contract-shaped dimensions and compliance", () => {
  it("bands last-payment recency and balance, and reads the HB / Low tier off the call table", () => {
    expect([recencyBand("2026-09-20", SNAP), recencyBand("2026-08-20", SNAP), recencyBand("2026-07-01", SNAP), recencyBand(null, SNAP)]).toEqual(["0-15 days", "31-45 days", "60+ days", "No payment on file"]);
    expect([balanceBand(24999), balanceBand(25000), balanceBand(120000)]).toEqual(["<25k", "25k-50k", "1L+"]);
    expect([tierOf("ELEVATE_CD3_NTH_HB"), tierOf("EL_DEL_CD2_SBI_L_1_4_"), tierOf("EL_DEL_CD2_JO_"), tierOf(null)]).toEqual(["High balance (HB)", "Low balance (L)", "Standard", "Unknown"]);
  });
  it("splits by CD stage and counts do-not-call accounts that were still dialled", () => {
    const o = collectionsOps([
      row({ accountNo: "A", cd: 3, nrr: "R", callTable: "ELEVATE_CD3_NTH_HB", dnc: "Y", disps: ["NC", "NC"], lastPmtDate: "2026-07-01", curBal: 90000 }),
      row({ accountNo: "B", cd: 2, nrr: "N", dnc: "Y" }),
      row({ accountNo: "C", cd: 3, nrr: "N", disps: ["PTP"] }),
    ], SNAP);
    expect(o.dimensions.cd.map((d) => [d.key, d.accounts])).toEqual([["CD2", 1], ["CD3", 2]]);
    expect(o.dimensions.tier.find((d) => d.key === "High balance (HB)")!.accounts).toBe(1);
    expect(o.headline.dnc).toBe(2);
    expect(o.headline.dncDialled).toBe(1);
    expect(o.headline.dncDialledAttempts).toBe(2);
    expect(o.headline.stalePayers).toBe(1);
  });
});

describe("contactability", () => {
  it("finds accounts that never reached a person, wrong numbers and repeat voicemails", () => {
    const o = collectionsOps([
      row({ accountNo: "S1", disps: ["NC", "VOML", "NC"], totalDue: 800 }),
      row({ accountNo: "S2", disps: ["VOML", "VOML"], totalDue: 200 }),
      row({ accountNo: "W1", disps: ["WN", "PTP"], totalDue: 300 }),
      row({ accountNo: "OK", disps: ["PTP"], totalDue: 100 }),
    ], SNAP);
    const k = o.contactability;
    expect(k.attempts).toBe(8);
    expect(k.noConversation).toBe(6);
    expect(k.noConversationPct).toBe(75);
    expect(k.stuck).toEqual({ accounts: 1, exposure: 800 });
    expect(k.voicemailRepeat).toEqual({ accounts: 1, exposure: 200 });
    expect(k.wrongNumber).toEqual({ accounts: 1, exposure: 300 });
    expect(k.byDate).toEqual([{ date: "2026-09-25", attempts: 8, noConversationPct: 75 }]);
    expect(k.agentSpread).toBeNull(); // one agent id with fewer than 30 attempts is not a spread
  });
});

describe("evidence", () => {
  it("returns null p-values on thin data and real ones when there is volume", () => {
    expect(collectionsOps([row({ disps: ["NC"] })], SNAP).contactability.evidence.hourDeadP).toBeNull();
    const many = Array.from({ length: 300 }, (_, i) => row({ accountNo: `A${i}`, disps: [i % 2 ? "PTP" : "NC"], hours: [i % 3 === 0 ? 9 : 14], cd: (i % 3) + 1 }));
    const o = collectionsOps(many, SNAP);
    expect(typeof o.contactability.evidence.hourPtpP).toBe("number");
    expect(o.dimensionSignal.cd.ptpP === null || o.dimensionSignal.cd.ptpP >= 0).toBe(true);
  });
});

describe("client rules (SBI Card mail of 24-Sep-2026)", () => {
  it("reads the new call-table naming", () => {
    expect(parseCallTable("MAS_AHM_CD3_FAT_S_HB1_19082026")).toEqual({ site: "AHM", cd: 3, program: "FAT_S", tier: "HB1", date: "2026-08-19" });
    expect(parseCallTable("MAS_AHM_CD3_STAB_HB_19082026")).toMatchObject({ program: "STAB", tier: "HB" });
    expect(parseCallTable("MAS_AHM_CD3_PTP_HB1_19082026")).toMatchObject({ program: "PTP", tier: "HB1" });
    expect(parseCallTable("MAS_AHM_CD3_HB_19082026")).toMatchObject({ program: "Base", tier: "HB" });
    expect(parseCallTable("ELEVATE_CD3_NTH_HB")).toMatchObject({ cd: 3, tier: "HB", date: null });
    expect(tierOf("MAS_AHM_CD3_CTC_HB1_19082026")).toBe("High balance (HB1)");
  });
  it("knows the disposition plan: promises, exclusions, non-conversations", () => {
    expect(["PTP", "BCTP", "DPTP"].every(isPromise)).toBe(true);
    expect(isPromise("CBL")).toBe(false);
    expect(["NC", "NAA", "WN", "VOML"].every(isNoConversation)).toBe(true);
    expect(["PTP", "DS", "SUTH", "DISP", "WS", "WH", "PAD", "RTP", "OTP"].every(isExcludeAfterFirstPass)).toBe(true);
    expect(["NC", "CBL", "LB", "WN", "TCBL", "NAA", "VOML"].some(isExcludeAfterFirstPass)).toBe(false);
  });
  it("applies the 08:00-18:55 calling window by the minute", () => {
    expect(outsideCallWindow("2026-09-25 07:59:59")).toBe("before");
    expect(outsideCallWindow("2026-09-25 08:00:00")).toBeNull();
    expect(outsideCallWindow("2026-09-25 18:55:30")).toBeNull();
    expect(outsideCallWindow("2026-09-25 18:56:00")).toBe("after");
    expect(outsideCallWindow(null)).toBeNull();
  });
  it("counts out-of-window calls, re-dials after exclusion (by time, not slot), unlisted codes and hand-off customers", () => {
    const at = (d: string, hhmm: string) => `2026-09-25 ${hhmm}:00`;
    const mk = (accountNo: string, calls: Array<[string, string]>, totalDue = 1000) => ({
      ...row({ accountNo, totalDue }), attempts: calls.map(([t, d]) => ({ dt: at("", t), disp: d, agent: "1" })),
    });
    const o = collectionsOps([
      mk("A", [["10:00", "NC"], ["19:10", "NC"]]),                     // one late call
      mk("B", [["15:00", "NC"], ["09:00", "DS"], ["11:00", "NC"]]),    // slots out of order: DS at 09:00, then a call at 11:00 and 15:00 after it
      mk("C", [["10:00", "WS"]], 5000),
      mk("D", [["10:00", "LB"], ["10:30", "VOML"]], 700),
      mk("E", [["07:30", "PAD"]], 300),
    ], SNAP);
    const c = o.compliance;
    expect(c.window).toMatchObject({ attempts: 9, outside: 2, before: 1, after: 1 });
    expect(c.redialedAfterExclusion).toMatchObject({ accounts: 1, attempts: 2 });
    expect(c.redialedAfterExclusion.byCode[0]).toMatchObject({ code: "DS", accounts: 1 });
    expect(c.welfare.deceased.accounts).toBe(1);
    expect(c.intent.settlement).toEqual({ accounts: 1, exposure: 5000 });
    expect(c.intent.languageBarrier.accounts).toBe(1);
    expect(c.intent.paidAlready.accounts).toBe(1);
    expect(c.unlisted.codes).toEqual([{ code: "VOML", attempts: 1 }]);
    expect(o.dispositions.find((d) => d.code === "WS")).toMatchObject({ label: "Want Settlement", listed: true });
    expect(o.dispositions.find((d) => d.code === "VOML")!.listed).toBe(false);
  });
});

describe("client MIS definitions (recovered from SAMPLE_DIALER_MIS.xlsx)", () => {
  it("keeps the exact contact and promise lists the workbook totals fit", () => {
    expect([...CLIENT_CONTACT_CODES].sort()).toEqual(["CBL", "DS", "OTP", "PAD", "PTP", "RTP"]);
    expect([...CLIENT_PROMISE_CODES].sort()).toEqual(["PAD", "PTP"]);
  });
  it("splits attempts into what the MIS counts as contact and live conversations it does not", () => {
    const o = collectionsOps([row({ accountNo: "A", disps: ["PTP", "CBL", "WS", "DISP", "NC", "VOML"] })], SNAP);
    const c = o.contactability.clientContact;
    expect(c.attempts).toBe(2);
    expect(c.notCounted.codes.map((x) => x.code).sort()).toEqual(["DISP", "WS"]);
    expect(c.notCounted.attempts).toBe(2);
  });
  it("reads the Mumbai and Ahmedabad site prefixes", () => {
    expect(parseCallTable("AL_MUM_CD3_FAT_S_HB_19082026")).toMatchObject({ site: "MUM", cd: 3, program: "FAT_S", tier: "HB", date: "2026-08-19" });
    expect(parseCallTable("MAS_AHM_CD3_HB_19082026").site).toBe("AHM");
  });
});
