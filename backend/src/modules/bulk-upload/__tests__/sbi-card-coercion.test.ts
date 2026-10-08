import { describe, it, expect } from "vitest";
import {
  numOrNull, intOrNull, parseSbiDate, parseSbiTime, parseSeconds, parseDowntimeMinutes, dateFromCallTable, cleanTeam, cleanId,
} from "../sbi-card-import-helpers.js";
import { isRollupCampaign } from "../sbi-card-schema.js";
import { dialerMisSpec, agentMisSpec, agentTimeSpec, accountFileSpec, downtimeSpec, penEstimationSpec } from "../sbi-card-bulk.service.js";
import { canonicalizeRow } from "../dalmia-import-helpers.js";

const ctx = { processId: "p", batchId: "b", userId: "u" };
const run = (spec: typeof dialerMisSpec, row: Record<string, unknown>) => spec.mapRow(canonicalizeRow(row, spec.headers), 1, ctx);

describe("cell coercion", () => {
  it("treats '-', blanks and Excel errors as null", () => {
    expect(numOrNull("-")).toBeNull();
    expect(numOrNull("#DIV/0!")).toBeNull();
    expect(numOrNull("")).toBeNull();
    expect(intOrNull("1,344")).toBe(1344);
    expect(intOrNull(2.6)).toBe(3);
  });
  it("reads dates, including the workbook's 1900 day-counter as invalid", () => {
    expect(parseSbiDate("2026-08-01")).toBe("2026-08-01");
    expect(parseSbiDate(new Date(Date.UTC(2026, 7, 1)))).toBe("2026-08-01");
    expect(parseSbiDate("Average")).toBeNull();
    expect(parseSbiDate(new Date(Date.UTC(1900, 0, 11)))).toBeNull(); // blank day counter
    expect(parseSbiDate("1/1/00")).toBeNull(); // the same counter as a two-digit-year string must not become 2000-01-01
  });
  it("reads clock times, leakage seconds and downtime durations", () => {
    expect(parseSbiTime("9:00:46")).toBe("09:00:46");
    expect(parseSbiTime("-")).toBeNull();
    expect(parseSeconds("0:00:46")).toBe(46);
    expect(parseDowntimeMinutes("4:20")).toBe(260);
    expect(parseDowntimeMinutes("0:15")).toBe(15);
    expect(parseDowntimeMinutes(45)).toBe(45);
  });
  it("reads the day off a call table name", () => {
    expect(dateFromCallTable("AL_MUM_CD3_HB_19082026")).toBe("2026-08-19");
    expect(dateFromCallTable("GRAND TOTAL")).toBeNull();
  });
  it("cleans team 0 placeholders and identifiers", () => {
    expect(cleanTeam(0)).toBeNull();
    expect(cleanTeam("HIGHBAL")).toBe("HIGHBAL");
    expect(cleanId("600264364.0")).toBe("600264364");
    expect(cleanId("4.1E+15")).toBeNull();
  });
  it("flags rollup sheets", () => {
    for (const n of ["Master", "Overall Low Bal", "Overall without PTP ", "Overall with PTP"]) expect(isRollupCampaign(n)).toBe(true);
    for (const n of ["EL_DEL_CD2_SBI_7_8_", "EL_DEL_CD2_PTP_", "ELEVATE_CD3_NTH_HB"]) expect(isRollupCampaign(n)).toBe(false);
  });
});

describe("row mappers", () => {
  it("dialer: maps a campaign row, flags rollups, skips footer/blank rows, needs Campaign", () => {
    const r = run(dialerMisSpec, { Date: "2026-08-01", Campaign: "EL_DEL_CD2_SBI_7_8_", " Total Accounts": 493, Dials: 1943, Answers: 145, PTP: 7, "TOTAL Contacts": "15", OTP: "-" });
    expect("values" in r && r.values.slice(0, 3)).toEqual(["2026-08-01", "EL_DEL_CD2_SBI_7_8_", 0]);
    const master = run(dialerMisSpec, { Date: "2026-08-01", Campaign: "Master", Dials: 9947 });
    expect("values" in master && master.values[2]).toBe(1);
    expect(run(dialerMisSpec, { Date: "Total", Dials: 1 })).toEqual({ skip: true });
    expect(run(dialerMisSpec, { Date: "2026-08-02", Campaign: "X" })).toEqual({ skip: true });
    // Regression: real sheet's empty campaign-day has only a stray "0" in VOML (formula column) -> still an empty day.
    expect(run(dialerMisSpec, { Date: "2-Aug-26", Campaign: "EL_DEL_CD1_STH_PTP_", VOML: "0", "Cur_Bal": "-" })).toEqual({ skip: true });
    expect("error" in run(dialerMisSpec, { Date: "2026-08-01", Dials: 5 })).toBe(true);
    // 41 numeric columns + date, campaign, is_rollup + 3 audit = insert columns minus id/process_id
    expect(("values" in r && r.values.length) + 2).toBe(dialerMisSpec.columns.length);
  });
  it("agent: identity required, blank formula rows skipped, '-' amounts null, team 0 null", () => {
    const r = run(agentMisSpec, { "Employee ID": 600264364, Name: "Sarita", TEAM: 0, Date: "2026-08-01", Calls: 164, "Amt collected": "-", "Leakage Of Day": "0:00:46", "First Login Time": "9:00:46" });
    expect("values" in r).toBe(true);
    if ("values" in r) { expect(r.values[1]).toBe("600264364"); expect(r.values[4]).toBeNull(); expect(r.values[9]).toBe(46); }
    expect(run(agentMisSpec, {})).toEqual({ skip: true });
    expect("error" in run(agentMisSpec, { "Employee ID": 1 })).toBe(true);
    expect(("values" in r && r.values.length) + 2).toBe(agentMisSpec.columns.length);
  });
  it("account file: natural key account_no, keeps only mobile digits, rejects rounded account numbers", () => {
    const r = run(accountFileSpec, { ACCOUNT_NO: "4000000000000001", "Report Date": "2026-08-19", MOBILE_NO: "+91 98765-43210", EMBO_NAME: "Dropped" });
    expect("values" in r && r.values.slice(0, 2)).toEqual(["2026-08-19", "4000000000000001"]);
    expect("values" in r && r.values).not.toContain("Dropped");
    expect("error" in run(accountFileSpec, { ACCOUNT_NO: "4.00E+15" })).toBe(true);
    expect(("values" in r && r.values.length) + 2).toBe(accountFileSpec.columns.length);
  });
  it("downtime: h:mm minutes, falls back to up - start", () => {
    const r = run(downtimeSpec, { Date: "2026-08-09", "Start Time": "14:30", "Up Time": "18:50", "Downtime Minutes": "4:20", Site: "ELEVATE" });
    expect("values" in r && r.values[4]).toBe(260);
    const f = run(downtimeSpec, { Date: "2026-08-09", "Start Time": "16:15", "Up Time": "16:30" });
    expect("values" in f && f.values[4]).toBe(15);
    expect(("values" in r && r.values.length) + 2).toBe(downtimeSpec.columns.length);
  });
  it("pen estimation: date from call table, skips blank and GRAND TOTAL rows", () => {
    const r = run(penEstimationSpec, { "CALL TABLES": "AL_MUM_CD3_HB_19082026", Download: 1318, Penetration: 3 });
    expect("values" in r && r.values.slice(0, 2)).toEqual(["2026-08-19", "AL_MUM_CD3_HB_19082026"]);
    expect(run(penEstimationSpec, { Penetration: 3 })).toEqual({ skip: true });
    expect(run(penEstimationSpec, { "CALL TABLES": "GRAND TOTAL", Download: 2353 })).toEqual({ skip: true });
    expect(("values" in r && r.values.length) + 2).toBe(penEstimationSpec.columns.length);
  });
});

describe("account file collections-ops columns", () => {
  const base = { ACCOUNT_NO: "ACC1", "Report Date": "2026-09-25", DELQ1: 2, CD: 2, NRR: "r", DONOTCALL: "Y", ACCOUNTS_CLASS: "PTP",
    CALL1_DT: "2026-09-20 19:36:00", DISP1_C: "voml", AGENT1_ID: 1030, CALL2_DT: "", DISP2_C: "", CALLBACK_DT: "2026-09-28 11:00:00" };
  it("keeps one value per column and stores attempts as time + code + agent id", () => {
    const res = run(accountFileSpec, base);
    if (!("values" in res)) throw new Error("expected values");
    expect(res.values.length).toBe(accountFileSpec.columns.length - 2); // id and process_id are added by the runner
    expect(res.values).toContain("2026-09-20 19:36:00");
    expect(res.values).toContain("VOML");
    expect(res.values).toContain("1030");
    expect(res.values).toContain("2026-09-28 11:00:00");
  });
  it("never stores a dialled phone number", () => {
    const res = run(accountFileSpec, { ...base, CALL1_PHONE: "9451922761", ADDITIONAL_PHONE_1: "9427778680", EMBO_NAME: "Customer 00001" });
    if (!("values" in res)) throw new Error("expected values");
    const flat = JSON.stringify(res.values);
    expect(flat).not.toContain("9451922761");
    expect(flat).not.toContain("9427778680");
    expect(flat).not.toContain("Customer 00001");
  });
});

describe("agent time (APR) importer", () => {
  const agent = { USER: "VIKAS KUMAR OJHA", ID: "MAS62973", "Report Date": "2026-09-28", CALLS: "59", "TIME CLOCK": "0:00:00", "LOGIN TIME": "8:59:30",
    WAIT: "2:14:27", TALK: "3:07:03", DISPO: "0:21:21", PAUSE: "3:16:39", DEAD: "0:00:11", CUSTOMER: "3:06:52", Login: "10:04:03", Logout: "19:03:41",
    ACHT: "212", DISMX: "0:47:12", LAGGED: "0:00:00", LB: "0:37:40", LOGIN: "0:18:30", MB: "0:00:00", QB: "0:00:00", TB: "0:15:43", WB: "0:00:00" };
  it("reads durations as seconds, clocks as times, and tells Login (clock) from LOGIN (pause code)", () => {
    const res = run(agentTimeSpec, agent);
    if (!("values" in res)) throw new Error("expected values");
    expect(res.values.length).toBe(agentTimeSpec.columns.length - 2);
    expect(res.values.slice(0, 4)).toEqual(["2026-09-28", "MAS62973", "VIKAS KUMAR OJHA", 59]);
    expect(res.values).toContain(32370);   // LOGIN TIME 8:59:30
    expect(res.values).toContain(212);     // ACHT is plain seconds
    expect(res.values).toContain("10:04:03");
    expect(res.values).toContain(1110);    // LOGIN pause code 0:18:30
  });
  it("skips the TOTALS footer and blank rows, errors on a missing day", () => {
    expect(run(agentTimeSpec, { USER: "TOTALS", ID: "19", CALLS: "1884" })).toEqual({ skip: true });
    expect(run(agentTimeSpec, { USER: "", ID: "" })).toEqual({ skip: true });
    expect("error" in run(agentTimeSpec, { ...agent, "Report Date": "" })).toBe(true);
  });
});
