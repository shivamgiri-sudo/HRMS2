import { describe, it, expect } from "vitest";
import { adhocList, adhocCsv, ADHOC_TYPES } from "../sbi-card-adhoc.calc.js";
import type { AccountOpsRow } from "../sbi-card-collections-ops.calc.js";

const SNAP = "2026-09-25";
const row = (o: Partial<AccountOpsRow> & { disps?: string[] }): AccountOpsRow => ({
  accountNo: "A1", delq: "4", billingCycle: "5", cibil: 700, vintage: 40, region: "NORTH", productClass: "PREM", accountClass: "REGULAR", callTable: "MAS_AHM_CD3_HB_25092026",
  promo: null, ntc: "N", newToCard: "N", totalDue: 1000, curBal: 5000, cd: 3, lastActionCode: null, lastPtpDate: null, callbackDt: null, dnc: "N", dialCnt: null,
  attempts: (o.disps ?? []).map((d, i) => ({ dt: `2026-09-25 1${i}:00:00`, disp: d, agent: "1" })), ...o,
});
const accounts = [
  row({ accountNo: "LAPSED", totalDue: 9000, disps: ["PTP"], lastActionCode: "PTP", lastPtpDate: "2026-09-20" }),
  row({ accountNo: "LAPSED-DNC", totalDue: 99000, dnc: "Y", disps: ["PTP"], lastPtpDate: "2026-09-20" }),
  row({ accountNo: "LAPSED-DISPUTE", totalDue: 88000, disps: ["PTP", "DISP"], lastPtpDate: "2026-09-20" }),
  row({ accountNo: "CALLBACK", totalDue: 3000, disps: ["CBL"], callbackDt: "2026-09-22 11:00:00" }),
  row({ accountNo: "UNTOUCHED-BIG", totalDue: 7000 }), row({ accountNo: "UNTOUCHED-SMALL", totalDue: 700 }),
  row({ accountNo: "EXH", totalDue: 4000, disps: ["NC", "VOML", "NC", "AU"] }),
  row({ accountNo: "STUCK", totalDue: 2000, disps: ["NC", "VOML", "WN"] }),
  row({ accountNo: "SETTLE", totalDue: 6000, disps: ["WS"] }), row({ accountNo: "HARD", totalDue: 5000, disps: ["WH"] }),
  row({ accountNo: "LANG", totalDue: 1500, disps: ["LB"] }), row({ accountNo: "DECEASED", totalDue: 50000, disps: ["DS"] }),
];
const ids = (t: (typeof ADHOC_TYPES)[number]) => adhocList(accounts, SNAP, t).map((r) => r.accountNo);

describe("ad-hoc call lists", () => {
  it("builds each list from the right accounts, largest amount first", () => {
    expect(ids("lapsed-promises")).toEqual(["LAPSED"]);
    expect(ids("missed-callbacks")).toEqual(["CALLBACK"]);
    expect(ids("untouched")).toEqual(["UNTOUCHED-BIG", "UNTOUCHED-SMALL"]);
    expect(ids("exhausted")).toEqual(["EXH"]);
    expect(ids("stuck")).toEqual(["STUCK"]);
    expect(ids("settlement-hardship")).toEqual(["SETTLE", "HARD"]);
    expect(ids("language")).toEqual(["LANG"]);
  });
  it("never lists do-not-call, deceased, dispute or welfare accounts on any list", () => {
    for (const t of ADHOC_TYPES) for (const bad of ["LAPSED-DNC", "LAPSED-DISPUTE", "DECEASED"]) expect(ids(t)).not.toContain(bad);
  });
  it("ranks by priority and explains each account", () => {
    const l = adhocList(accounts, SNAP, "untouched");
    expect(l.map((r) => [r.priority, r.amountDue])).toEqual([[1, 7000], [2, 700]]);
    expect(adhocList(accounts, SNAP, "lapsed-promises")[0]!.reason).toBe("Promise lapsed on 2026-09-20");
    expect(adhocList(accounts, SNAP, "settlement-hardship")[1]!.reason).toMatch(/hardship desk/);
  });
});

describe("csv", () => {
  it("has a fixed header, one line per account, and no phone number column", () => {
    const csv = adhocCsv(adhocList(accounts, SNAP, "untouched"), SNAP);
    const lines = csv.trim().split("\r\n");
    expect(lines[0]).toBe("PRIORITY,ACCOUNT_NO,CD,DELQ1,AMOUNT_DUE,CALL_TABLE,REASON,REPORT_DATE");
    expect(lines).toHaveLength(3);
    expect(lines[1]).toBe("1,UNTOUCHED-BIG,CD3,4,7000,MAS_AHM_CD3_HB_25092026,No call attempt yet,2026-09-25");
    expect(csv.toLowerCase()).not.toMatch(/phone|mobile|contact_no/);
  });
  it("quotes commas and neutralises spreadsheet formulas", () => {
    const csv = adhocCsv([{ priority: 1, accountNo: "=HYPERLINK(1)", cd: "CD3", delq: "4", amountDue: 5, callTable: "T", reason: 'say "hi", ok', }], SNAP);
    expect(csv).toContain("'=HYPERLINK(1)");
    expect(csv).toContain('"say ""hi"", ok"');
  });
});
