import { describe, it, expect } from "vitest";
import { bbChatFacts, clEmailFacts, sbiFacts } from "../kpi-upload-feeds.service.js";

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
