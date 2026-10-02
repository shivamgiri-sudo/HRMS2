import { describe, it, expect } from "vitest";
import { awFacts, bbChatFacts, clChatFacts, clEmailFacts, clOutboundFacts, satyaAllocFacts, satyaCallFacts, sbiFacts } from "../kpi-upload-feeds.service.js";

const D = "2026-09-20";

describe("sbiFacts", () => {
  it("builds calls, contacts, contact rate, PTP, PAD and amount for an agent", () => {
    const f = sbiFacts({ employee_id: " mas12345 ", calls: 100, contacts: 40, ptp: 10, pad: 4, amt_collected: "1234.567" }, D);
    const by = Object.fromEntries(f.map((x) => [x.metricCode, x]));
    expect(by.COLLECTION_CALLS.value).toBe(100);
    expect(by.COLLECTION_CONTACTS.value).toBe(40);
    expect(by.COLLECTION_CONTACT_RATE).toMatchObject({ value: 40, numerator: 40, denominator: 100 });
    expect(by.COLLECTION_PTP.value).toBe(10);
    expect(by.COLLECTION_PAD.value).toBe(4);
    expect(by.COLLECTION_AMOUNT.value).toBe(1234.57);
    expect(f.every((x) => x.employeeCode === "MAS12345" && x.date === D)).toBe(true);
  });
  it("does not invent a contact rate when there were no calls, and skips unknown columns", () => {
    const f = sbiFacts({ employee_id: "MAS1", calls: 0, contacts: 0, ptp: null, pad: null, amt_collected: null }, D);
    expect(f.map((x) => x.metricCode).sort()).toEqual(["COLLECTION_CALLS", "COLLECTION_CONTACTS"]);
  });
  it("ignores a row with no agent", () => {
    expect(sbiFacts({ employee_id: "  ", calls: 5 }, D)).toEqual([]);
  });
});

describe("bbChatFacts", () => {
  it("builds tickets, resolved % and first-response minutes", () => {
    const f = bbChatFacts({ emp_id: "MAS9", tickets: 20, resolved: 15, avg_frt: 1.236 }, D);
    expect(f.find((x) => x.metricCode === "CHAT_TICKETS")?.value).toBe(20);
    expect(f.find((x) => x.metricCode === "CHAT_RESOLVED_PCT")).toMatchObject({ value: 75, numerator: 15, denominator: 20 });
    expect(f.find((x) => x.metricCode === "CHAT_FRT_MIN")?.value).toBe(1.24);
  });
  it("omits first-response time when the agent had no value, and never emits a zero-ticket row", () => {
    expect(bbChatFacts({ emp_id: "MAS9", tickets: 3, resolved: 3, avg_frt: null }, D).map((x) => x.metricCode)).toEqual(["CHAT_TICKETS", "CHAT_RESOLVED_PCT"]);
    expect(bbChatFacts({ emp_id: "MAS9", tickets: 0, resolved: 0, avg_frt: 1 }, D)).toEqual([]);
    expect(bbChatFacts({ emp_id: "", tickets: 5, resolved: 1, avg_frt: 1 }, D)).toEqual([]);
  });
});

describe("clEmailFacts", () => {
  it("builds assigned and closure %, capped at 100", () => {
    const f = clEmailFacts({ emp_id: "mas7", assigned: 10, closed: 8 }, D);
    expect(f.find((x) => x.metricCode === "EMAIL_ASSIGNED")?.value).toBe(10);
    expect(f.find((x) => x.metricCode === "EMAIL_CLOSURE_PCT")?.value).toBe(80);
    expect(clEmailFacts({ emp_id: "mas7", assigned: 5, closed: 9 }, D).find((x) => x.metricCode === "EMAIL_CLOSURE_PCT")?.value).toBe(100);
  });
  it("produces nothing for an agent with no assigned mail (no fabricated 0%)", () => {
    expect(clEmailFacts({ emp_id: "mas7", assigned: 0, closed: 0 }, D)).toEqual([]);
  });
});

describe("satya feeds", () => {
  it("allocation: allocated, connected, orders and conversion", () => {
    const f = satyaAllocFacts({ emp_id: "mas1", allocated: 30, connected: 20, orders: 5 }, D);
    const by = Object.fromEntries(f.map((x) => [x.metricCode, x.value]));
    expect(by).toMatchObject({ SATYA_ALLOCATED: 30, SATYA_CONNECTED: 20, SATYA_ORDERS: 5, SATYA_CONVERSION_PCT: 25 });
  });
  it("no conversion when nothing connected; nothing for an empty allocation", () => {
    expect(satyaAllocFacts({ emp_id: "m", allocated: 5, connected: 0, orders: 0 }, D).map((x) => x.metricCode)).not.toContain("SATYA_CONVERSION_PCT");
    expect(satyaAllocFacts({ emp_id: "m", allocated: 0 }, D)).toEqual([]);
  });
  it("calls: one fact per agent with calls", () => {
    expect(satyaCallFacts({ emp_id: "m1", calls: 12 }, D)).toEqual([expect.objectContaining({ metricCode: "SATYA_CALLS", value: 12 })]);
    expect(satyaCallFacts({ emp_id: "m1", calls: 0 }, D)).toEqual([]);
  });
});

describe("appreciate wealth feed", () => {
  it("calls, connected, connect %, talk per connected call and login hours", () => {
    const f = awFacts({ emp_id: "mas5", calls: 100, connected: 40, talk_s: 4000, login_s: 28800 }, D);
    const by = Object.fromEntries(f.map((x) => [x.metricCode, x.value]));
    expect(by).toMatchObject({ AW_CALLS: 100, AW_CONNECTED: 40, AW_CONNECT_PCT: 40, AW_AVG_TALK_SEC: 100, AW_LOGIN_HOURS: 8 });
  });
  it("omits talk and login when absent; skips an agent with no calls", () => {
    expect(awFacts({ emp_id: "m", calls: 10, connected: 0, talk_s: null, login_s: 0 }, D).map((x) => x.metricCode)).toEqual(["AW_CALLS", "AW_CONNECTED", "AW_CONNECT_PCT"]);
    expect(awFacts({ emp_id: "m", calls: 0 }, D)).toEqual([]);
  });
});

describe("clovia chat and outbound feeds", () => {
  it("chat: count always, rating and wait only when present", () => {
    expect(clChatFacts({ emp_id: "m", chats: 10, avg_rating: 4.5, avg_wait_s: 12.345 }, D).map((x) => [x.metricCode, x.value])).toEqual([["CL_CHATS", 10], ["CL_CHAT_RATING", 4.5], ["CL_CHAT_WAIT_SEC", 12.35]]);
    expect(clChatFacts({ emp_id: "m", chats: 3, avg_rating: null, avg_wait_s: null }, D).map((x) => x.metricCode)).toEqual(["CL_CHATS"]);
    expect(clChatFacts({ emp_id: "m", chats: 0 }, D)).toEqual([]);
  });
  it("outbound: dials, connected, connect % (capped) and avg talk of connected dials", () => {
    const by = Object.fromEntries(clOutboundFacts({ emp_id: "m", dials: 50, connected: 20, avg_talk_s: 90 }, D).map((x) => [x.metricCode, x.value]));
    expect(by).toMatchObject({ CL_OB_DIALS: 50, CL_OB_CONNECTED: 20, CL_OB_CONNECT_PCT: 40, CL_OB_AVG_TALK_SEC: 90 });
    expect(clOutboundFacts({ emp_id: "m", dials: 4, connected: 9 }, D).find((x) => x.metricCode === "CL_OB_CONNECT_PCT")?.value).toBe(100);
    expect(clOutboundFacts({ emp_id: "m", dials: 0 }, D)).toEqual([]);
  });
});
