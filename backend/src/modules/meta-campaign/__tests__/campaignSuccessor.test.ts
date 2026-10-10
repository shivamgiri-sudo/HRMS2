import { describe, expect, it } from "vitest";
import { autoSuccessorOn, pickSuccessor, sequenceOf, type Candidate } from "../campaign-successor.service.js";

const cur = { designation: "EXECUTIVE", branch: "NOIDA-2", process: "P1" };
const c = (o: Partial<Candidate>): Candidate => ({ id: "x", designation: "EXECUTIVE", branch: "NOIDA-2", process: "P1", validity: "2026-10-30", seatsLeft: 10, linked: false, ...o });

describe("pickSuccessor", () => {
  it("returns null when nothing qualifies", () => {
    expect(pickSuccessor(cur, [], "2026-10-09")).toBeNull();
    expect(pickSuccessor(cur, [c({ seatsLeft: 0 })], "2026-10-09")).toBeNull();
    expect(pickSuccessor(cur, [c({ designation: "MANAGER" })], "2026-10-09")).toBeNull();
    expect(pickSuccessor(cur, [c({ validity: "2026-10-01" })], "2026-10-09")).toBeNull();
    expect(pickSuccessor(cur, [c({ branch: "MUMBAI" })], "2026-10-09")).toBeNull();
  });
  it("accepts the same branch family (NOIDA-2 ~ NOIDA)", () => {
    expect(pickSuccessor(cur, [c({ id: "a", branch: "NOIDA" })], "2026-10-09")?.id).toBe("a");
  });
  it("same branch + same process first, then same branch + another process, then linked, then seats", () => {
    expect(pickSuccessor(cur, [c({ id: "other", process: "P2", seatsLeft: 99 }), c({ id: "same", process: "P1", seatsLeft: 1 })], "2026-10-09")?.id).toBe("same");
    expect(pickSuccessor(cur, [c({ id: "fam", branch: "NOIDA", process: "P1", linked: true }), c({ id: "otherproc", process: "P2" })], "2026-10-09")?.id).toBe("otherproc");
    expect(pickSuccessor(cur, [c({ id: "a", branch: "NOIDA", seatsLeft: 99 }), c({ id: "b", branch: "NOIDA", linked: true, seatsLeft: 1 })], "2026-10-09")?.id).toBe("b");
    expect(pickSuccessor(cur, [c({ id: "a", seatsLeft: 5 }), c({ id: "b", seatsLeft: 9 })], "2026-10-09")?.id).toBe("b");
  });
  it("another process is acceptable (second priority) when it is the only one in the branch", () => {
    expect(pickSuccessor(cur, [c({ id: "x", process: "P9" })], "2026-10-09")?.id).toBe("x");
  });
  it("an open-ended requisition (no validity) is allowed", () => {
    expect(pickSuccessor(cur, [c({ id: "a", validity: null })], "2026-10-09")?.id).toBe("a");
  });
});

describe("deadline then sequence", () => {
  it("reads the sequence from the code", () => {
    expect(sequenceOf("NOIDA-Onfido-23")).toBe(23);
    expect(sequenceOf("REQ-2609-K7BK")).toBe(Number.POSITIVE_INFINITY);
    expect(sequenceOf(undefined)).toBe(Number.POSITIVE_INFINITY);
  });
  it("picks the latest deadline inside the tier", () => {
    const r = pickSuccessor(cur, [c({ id: "22", code: "NOIDA-Onfido-22", validity: "2026-10-15" }), c({ id: "24", code: "NOIDA-Onfido-24", validity: "2026-10-23" }), c({ id: "23", code: "NOIDA-Onfido-23", validity: "2026-10-19" })], "2026-10-10");
    expect(r?.id).toBe("24");
  });
  it("on a deadline tie takes the next (lower) sequence number", () => {
    const r = pickSuccessor(cur, [c({ id: "24", code: "NOIDA-Onfido-24", validity: "2026-10-23" }), c({ id: "23", code: "NOIDA-Onfido-23", validity: "2026-10-23" })], "2026-10-10");
    expect(r?.id).toBe("23");
  });
  it("same process wins over a later deadline of another process", () => {
    const r = pickSuccessor(cur, [c({ id: "other", process: "P2", validity: "2026-12-01" }), c({ id: "same", process: "P1", validity: "2026-10-15" })], "2026-10-10");
    expect(r?.id).toBe("same");
  });
});

describe("autoSuccessorOn", () => {
  it("is off unless the env names the campaign or says all", () => {
    expect(autoSuccessorOn("c1", {})).toBe(false);
    expect(autoSuccessorOn("c1", { META_AUTO_SUCCESSOR: "off" })).toBe(false);
    expect(autoSuccessorOn("c1", { META_AUTO_SUCCESSOR: "all" })).toBe(true);
    expect(autoSuccessorOn("c1", { META_AUTO_SUCCESSOR: "c9, c1" })).toBe(true);
    expect(autoSuccessorOn("c1", { META_AUTO_SUCCESSOR: "c9" })).toBe(false);
  });
});
