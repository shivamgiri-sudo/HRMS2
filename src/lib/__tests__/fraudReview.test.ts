import { describe, expect, it } from "vitest";
import {
  alertKind,
  alertShort,
  alertTitle,
  buildPersonRows,
  buildSelfRows,
  computeVerdict,
  isBlocking,
  namesAgree,
  needsChecklist,
  waitingText,
  type IdentityComparison,
  type IdentitySnapshot,
} from "../fraudReview";

const person = (over: Partial<IdentitySnapshot> = {}): IdentitySnapshot => ({
  candidateId: "c1",
  code: "CND-1",
  displayName: "Rahul Verma",
  name: "Rahul Verma",
  dob: "2004-02-18",
  gender: "Male",
  fatherName: "Suresh Verma",
  mobileMasked: "XXXXXX3126",
  aadhaarLast4: "4821",
  panMasked: "ABCXXXX4E",
  govt: null,
  selfieDocId: null,
  hasDigilockerPhoto: false,
  employee: null,
  ...over,
});

const differentPeople = (): IdentityComparison => ({
  subject: person(),
  other: person({
    candidateId: "c2",
    name: "Priya Nair",
    dob: "2004-02-18",
    gender: "Male",
    fatherName: "Suresh Verma",
    aadhaarLast4: "4821",
    panMasked: "ABCXXXX4E",
    govt: { name: "Priya Nair", dob: "2003-09-10", gender: "Female", aadhaarLast4: "6556" },
    employee: { code: "PN-1042", name: "Priya Nair", status: "Active", joinedOn: "2026-09-11" },
  }),
  sharedMobile: true,
  sharedDevice: true,
});

describe("alert wording", () => {
  it("says what is wrong in words, not codes", () => {
    expect(alertTitle("DUPLICATE_AADHAAR", "Priya Nair")).toBe("This Aadhaar number is already used by Priya Nair");
    expect(alertTitle("DUPLICATE_AADHAAR")).toBe("This Aadhaar number is already used by someone else");
    expect(alertShort("FACE_MISMATCH")).toBe("Selfie does not match the ID photo");
  });
  it("falls back to readable words for an alert type it has not seen", () => {
    expect(alertTitle("SOMETHING_NEW")).toContain("something new");
    expect(alertKind("SOMETHING_NEW")).toBe("other");
  });
  it("classifies alert kinds", () => {
    expect(alertKind("DUPLICATE_PAN")).toBe("identity");
    expect(alertKind("FACE_MISMATCH")).toBe("face");
    expect(alertKind("CHEQUE_ACCOUNT_MISMATCH")).toBe("number");
  });
});

describe("blocking and waiting", () => {
  it("blocks only unresolved critical or high alerts", () => {
    expect(isBlocking({ status: "open", severity: "critical" })).toBe(true);
    expect(isBlocking({ status: "under_review", severity: "high" })).toBe(true);
    expect(isBlocking({ status: "open", severity: "medium" })).toBe(false);
    expect(isBlocking({ status: "resolved_false_positive", severity: "critical" })).toBe(false);
  });
  it("counts whole days", () => {
    const now = new Date("2026-09-19T12:00:00");
    expect(waitingText("2026-09-19 08:00:00", now)).toBe("today");
    expect(waitingText("2026-09-18 08:00:00", now)).toBe("1 day");
    expect(waitingText("2026-09-14 08:00:00", now)).toBe("5 days");
    expect(waitingText(null, now)).toBe("");
  });
});

describe("namesAgree", () => {
  it("tolerates initials, order and dropped middle names", () => {
    expect(namesAgree("R Verma", "Rahul Verma")).toBe(true);
    expect(namesAgree("Verma Rahul", "Rahul Kumar Verma")).toBe(true);
  });
  it("rejects names with nothing in common", () => {
    expect(namesAgree("Rahul Verma", "Priya Nair")).toBe(false);
  });
});

describe("person-vs-person verdict", () => {
  it("calls it two different people when government data contradicts the typed details", () => {
    const v = computeVerdict(differentPeople(), { kind: "identity" });
    expect(v.level).toBe("different");
    expect(v.headline).toContain("two different people");
    expect(v.reasons.some((r) => r.tone === "bad" && r.text.includes("Date of birth"))).toBe(true);
    expect(v.reasons.some((r) => r.tone === "info" && r.text.includes("mobile"))).toBe(true);
    expect(v.reasons.some((r) => r.tone === "info" && r.text.includes("same phone"))).toBe(true);
  });
  it("prefers the government value over the typed one in each row", () => {
    const rows = buildPersonRows(differentPeople());
    const dob = rows.find((r) => r.key === "dob")!;
    expect(dob.left).toEqual({ value: "18/02/2004", source: "typed" });
    expect(dob.right).toEqual({ value: "10/09/2003", source: "govt" });
    expect(dob.state).toBe("diff");
  });
  it("flags typed details that contradict a person's own government record", () => {
    const cmp = differentPeople();
    cmp.other!.aadhaarLast4 = "5556";
    const v = computeVerdict(cmp, { kind: "identity" });
    expect(v.reasons.some((r) => r.tone === "warn" && r.text.includes("ends 5556") && r.text.includes("ends 6556"))).toBe(true);
  });
  it("says probably the same person only when everything agrees and nothing contradicts", () => {
    const cmp: IdentityComparison = {
      subject: person(),
      other: person({ candidateId: "c2", name: "R. Verma" }),
      sharedMobile: true,
      sharedDevice: null,
    };
    expect(computeVerdict(cmp, { kind: "identity" }).level).toBe("same");
  });
  it("stays unsure when there is little to compare", () => {
    const cmp: IdentityComparison = {
      subject: person({ dob: null, gender: null, aadhaarLast4: null, panMasked: null }),
      other: person({ candidateId: "c2", dob: null, gender: null, aadhaarLast4: null, panMasked: null }),
      sharedMobile: null,
      sharedDevice: null,
    };
    expect(computeVerdict(cmp, { kind: "identity" }).level).toBe("unsure");
  });
  it("skips the device row when there is no device data", () => {
    const cmp = differentPeople();
    cmp.sharedDevice = null;
    expect(buildPersonRows(cmp).some((r) => r.key === "device")).toBe(false);
  });
});

describe("face and number verdicts never overstate", () => {
  it("never calls two people different on a face score alone", () => {
    expect(computeVerdict(null, { kind: "face", faceScore: 12 }).level).toBe("unsure");
    expect(computeVerdict(null, { kind: "face", faceScore: 85 }).level).toBe("same");
    expect(computeVerdict(null, { kind: "face", faceScore: null }).level).toBe("unsure");
  });
  it("treats a machine-read number mismatch as low risk only when an official check passed", () => {
    expect(computeVerdict(null, { kind: "number", numberVerifiedByProvider: true }).level).toBe("same");
    expect(computeVerdict(null, { kind: "number", numberVerifiedByProvider: false }).level).toBe("unsure");
  });
});

describe("typed vs government rows (one person)", () => {
  it("shows no data rather than an alert when there is no government record", () => {
    const rows = buildSelfRows(person());
    expect(rows.every((r) => r.state === "na")).toBe(true);
  });
  it("marks differences against the government record", () => {
    const rows = buildSelfRows(person({ govt: { name: "Rahul Verma", dob: "2003-01-01", gender: "Male", aadhaarLast4: "4821" } }));
    expect(rows.find((r) => r.key === "dob")!.state).toBe("diff");
    expect(rows.find((r) => r.key === "gender")!.state).toBe("same");
  });
});

describe("what the reviewer must confirm", () => {
  it("requires a checklist to override a 'different people' finding", () => {
    const v = computeVerdict(differentPeople(), { kind: "identity" });
    expect(needsChecklist(v, "ok")).toBe(true);
    expect(needsChecklist(v, "bad")).toBe(false);
    expect(needsChecklist(v, "info")).toBe(false);
  });
  it("does not add friction when the system is unsure", () => {
    const v = computeVerdict(null, { kind: "face", faceScore: 40 });
    expect(needsChecklist(v, "ok")).toBe(false);
  });
});
