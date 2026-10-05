import { describe, expect, it } from "vitest";
import { evaluateEligibility, isHardReject, type EligibilityFacts } from "../he-eligibility.js";

const now = new Date("2026-10-05T10:00:00Z");
const base: EligibilityFacts = {
  status: "new", finalStatus: "none", isEmployee: false, age: 24, lastAttemptDate: "2026-09-20", walkinCount: 0, lastOutcome: null,
  approaches30d: 1, exEmployee: null, requisition: { processName: "SBI Card Collections" }, rejections: [],
  alreadySelectedForRequisition: false, alreadyBookedForRequisition: false, noShowsForRequisition: 0, now,
};
const f = (o: Partial<EligibilityFacts>): EligibilityFacts => ({ ...base, ...o });

describe("eligibility gate", () => {
  it("fresh lead is eligible at priority 3", () => {
    expect(evaluateEligibility(base)).toMatchObject({ eligible: true, priority: 3, blocks: [] });
  });
  it("never shortlists joined, employees, opted out, wrong number, minors", () => {
    expect(evaluateEligibility(f({ finalStatus: "joined" })).blocks).toContain("already_joined");
    expect(evaluateEligibility(f({ isEmployee: true })).blocks).toContain("current_employee");
    expect(evaluateEligibility(f({ status: "opted_out" })).blocks).toContain("opted_out");
    expect(evaluateEligibility(f({ lastOutcome: "wrong_number" })).blocks).toContain("wrong_number");
    expect(evaluateEligibility(f({ age: 17 })).blocks).toContain("under_age");
  });
  it("blocks the same process inside 90 days, allows after, allows other processes", () => {
    const rej = (days: number, process = "SBI  Card collections", reason?: string) => ({ process, at: new Date(now.getTime() - days * 86_400_000).toISOString(), reason });
    expect(evaluateEligibility(f({ rejections: [rej(30)] })).blocks).toEqual(["rejected_in_process_cooling"]);
    expect(evaluateEligibility(f({ rejections: [rej(89)] })).eligible).toBe(false);
    expect(evaluateEligibility(f({ rejections: [rej(91)] })).eligible).toBe(true);
    expect(evaluateEligibility(f({ rejections: [rej(10, "HDFC Inbound")] })).eligible).toBe(true);
    expect(evaluateEligibility(f({ rejections: [{ process: "SBI Card Collections", at: null }] })).eligible).toBe(false);
  });
  it("hard-reject reasons block permanently", () => {
    const r = { process: "SBI Card Collections", at: "2020-01-01", reason: "Misconduct during interview" };
    expect(evaluateEligibility(f({ rejections: [r] })).blocks).toEqual(["hard_rejected_in_process"]);
    expect(isHardReject("Not enough experience")).toBe(false);
  });
  it("caps no-shows and approaches", () => {
    expect(evaluateEligibility(f({ noShowsForRequisition: 3 })).blocks).toContain("no_show_cap_here");
    expect(evaluateEligibility(f({ approaches30d: 6 })).blocks).toContain("contact_cap_30d");
  });
  it("ex-employees: clean voluntary only, always last", () => {
    expect(evaluateEligibility(f({ exEmployee: { cleanVoluntary: true } }))).toMatchObject({ eligible: true, priority: 9 });
    expect(evaluateEligibility(f({ exEmployee: { cleanVoluntary: true } })).warnings).toContain("former_employee");
    expect(evaluateEligibility(f({ exEmployee: { cleanVoluntary: false } })).blocks).toContain("ex_employee_not_eligible");
  });
  it("priority ladder", () => {
    expect(evaluateEligibility(f({ status: "confirmed" })).priority).toBe(1);
    expect(evaluateEligibility(f({ alreadyBookedForRequisition: true })).priority).toBe(1);
    expect(evaluateEligibility(f({ walkinCount: 2 })).priority).toBe(2);
    expect(evaluateEligibility(f({ lastAttemptDate: "2026-01-01" })).priority).toBe(4);
    expect(evaluateEligibility(f({ finalStatus: "rejected", walkinCount: 1 })).warnings).toContain("rejected_elsewhere");
  });
});
