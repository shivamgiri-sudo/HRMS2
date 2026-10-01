import { describe, expect, it } from "vitest";
import { canonicalReason, normaliseLeavingReason } from "../leaving-reason.js";

const cat = (s: string) => normaliseLeavingReason(s)?.category ?? null;

describe("normaliseLeavingReason (legacy LeftReason spellings seen in db_bill)", () => {
  it.each([
    ["Absconded", "absconding"], ["Abscond", "absconding"], ["Left By System as per Naresh", "absconding"],
    ["Better Opportunity", "better_opportunity"], ["better Job", "better_opportunity"], ["Batter Job", "better_opportunity"], ["got Another Option", "better_opportunity"],
    ["Family Problem", "family_reasons"], ["family issue", "family_reasons"],
    ["Health problem", "health_personal"], ["Health Issue", "health_personal"], ["Employee Expired", "health_personal"],
    ["Personal Issue", "health_personal"], ["personal reason", "health_personal"], ["personal", "health_personal"],
    ["Process Closed", "process_closure"], ["Process Close", "process_closure"], ["Process Rampdown", "process_closure"], ["process ramdown", "process_closure"],
    ["Performance Issue", "performance_action"], ["Decertified", "performance_action"], ["ZTP Error", "performance_action"], ["ZTP", "performance_action"],
    ["Asked To Leave", "termination_misconduct"], ["ask to leave", "termination_misconduct"], ["Terminated", "termination_misconduct"],
    ["Disciplinary Issue", "termination_misconduct"], ["Behavioural Issue", "termination_misconduct"], ["Client Escalation", "termination_misconduct"],
    ["Further Studies", "higher_education"], ["EXAM", "higher_education"], ["Study issue", "higher_education"],
    ["Salary Problem", "compensation"], ["salary issue", "compensation"],
    ["Shift Problem", "work_environment"], ["Denied Leave", "work_environment"],
    ["Supervisor issue", "dissatisfaction_management"],
    ["Employee Movement from Off-roll to On-roll", "internal_transfer"], ["Rejoining", "internal_transfer"],
    ["Resigned", "resignation_no_reason"], ["Resign", "resignation_no_reason"],
    ["Left by sudeep negi", "other"], ["Documents not available", "other"],
  ])("%s -> %s", (raw, expected) => { expect(cat(raw as string)).toBe(expected); });

  it("placeholders are not reasons", () => {
    for (const s of ["NA", "na", "N/A", "0", "-", "", "  ", "None", "nil"]) expect(normaliseLeavingReason(s)).toBeNull();
    expect(normaliseLeavingReason(null)).toBeNull();
    expect(normaliseLeavingReason(undefined)).toBeNull();
  });

  it("infers voluntary / involuntary from the category and leaves the rest unknown", () => {
    expect(normaliseLeavingReason("Absconded")?.exitType).toBe("involuntary");
    expect(normaliseLeavingReason("Process Closed")?.exitType).toBe("involuntary");
    expect(normaliseLeavingReason("Performance Issue")?.exitType).toBe("involuntary");
    expect(normaliseLeavingReason("Better Opportunity")?.exitType).toBe("voluntary");
    expect(normaliseLeavingReason("Family Problem")?.exitType).toBe("voluntary");
    expect(normaliseLeavingReason("Left by sudeep negi")?.exitType).toBeNull();
    expect(normaliseLeavingReason("Rejoining")?.exitType).toBeNull();
  });
});

describe("canonicalReason (exit-record reasons: coded or typed)", () => {
  it("keeps coded categories and unifies typed spellings with them", () => {
    expect(canonicalReason("better_opportunity")).toBe("better_opportunity");
    expect(canonicalReason("career_growth")).toBe("career_growth");
    expect(canonicalReason("Absconded")).toBe("absconding");
    expect(canonicalReason("absconding")).toBe("absconding");
    expect(canonicalReason("  Family issue ")).toBe("family_reasons");
    expect(canonicalReason("Left for a startup in Pune")).toBe("other");
    expect(canonicalReason("")).toBeNull();
    expect(canonicalReason(null)).toBeNull();
  });
});
