/**
 * The bank's registered owner is judged against every name the candidate is
 * recorded under, not only the onboarding profile's employee_name.
 *
 * Live 2026-10-06: Luckpay confirmed "SAKSHI" for MAS63671, whose ATS record is
 * "SAKSHI", yet the check scored 0 and went to manual review because the
 * profile name differed — so she stayed in the Ops Control Tower's pending list.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../db/mysql.js", () => ({ db: { execute: vi.fn() } }));

const { clearByRecordedName, recordedIdentityNames } = await import("../bgv-verification.service.js");

const divergent = (matchedName: string | null) => ({
  status: "manual_review",
  matchScore: 0,
  matchedName,
  resultSummary: "the account belongs to someone else",
  riskFlags: ["BANK_HOLDER_NAME_DIVERGENCE"],
});

describe("recordedIdentityNames", () => {
  it("lists profile, ATS and employee-master names once each, blanks dropped", () => {
    expect(recordedIdentityNames({ employee_name: "Sakshi Rawat", full_name: "SAKSHI", employee_record_name: "SAKSHI" }))
      .toEqual(["Sakshi Rawat", "SAKSHI"]);
    expect(recordedIdentityNames({ employee_name: null, full_name: " ", employee_record_name: "KAJAL" })).toEqual(["KAJAL"]);
  });
});

describe("clearByRecordedName", () => {
  it("clears when the ATS record matches the bank's owner though the profile name does not", () => {
    const r = clearByRecordedName(divergent("SAKSHI"), ["Priya Verma", "SAKSHI"]);
    expect(r.status).toBe("verified");
    expect(r.riskFlags).toEqual([]);
    expect(r.matchScore).toBe(100);
  });

  it("leaves a third party's account in review when no recorded name matches", () => {
    const r = clearByRecordedName(divergent("RAMESH YADAV"), ["SAKSHI", "Sakshi Rawat"]);
    expect(r.status).toBe("manual_review");
    expect(r.riskFlags).toEqual(["BANK_HOLDER_NAME_DIVERGENCE"]);
  });

  it("does nothing without a bank-returned name or without a divergence flag", () => {
    expect(clearByRecordedName(divergent(null), ["SAKSHI"]).status).toBe("manual_review");
    const noName = { ...divergent("KAJAL KASHYAP"), riskFlags: ["BANK_NAME_NOT_RETURNED"] };
    expect(clearByRecordedName(noName, ["KAJAL"]).status).toBe("manual_review");
  });
});
