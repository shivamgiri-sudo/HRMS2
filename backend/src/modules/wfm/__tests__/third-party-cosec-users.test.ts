/**
 * COSEC ids belonging to another company are excluded, not mis-labelled.
 *
 * The biometric devices are shared with a different company whose staff carry
 * IDC-prefixed ids. They are not MAS Callnet employees and never have been, so
 * both of the old outcomes were wrong:
 *
 *   - "unmapped" reports their attendance as dropped and asks someone to link an
 *     employee_code that should not exist;
 *   - "inactive/resigned" asserts an employment relationship that never existed.
 *
 * The 2026-06-18 backfill showed exactly this: IDC60168, IDC62383 and IDC62716
 * were reported as unmapped, even though 36 other IDC ids had already been added
 * to attendance_reconciliation_cosec_exclusion by hand. A per-id list cannot keep
 * up with a roster that is not ours to manage, so the rule is by prefix.
 *
 * Verified against production before hardcoding it: zero rows in
 * employees.employee_code and zero in employee_biometric_enrollment.cosec_user_id
 * begin with IDC, so the prefix cannot collide with a real employee.
 */

import { describe, expect, it } from "vitest";
import {
  buildSourceUserMaps,
  classifySourceUser,
  conflictingExclusions,
  isThirdPartyCosecUser,
} from "../attendance-reconciliation-mapping.js";

const noEmployees = buildSourceUserMaps([], []);

describe("third-party COSEC ids", () => {
  it("recognises the IDC prefix", () => {
    for (const id of ["IDC60168", "IDC62383", "IDC62716"]) {
      expect(isThirdPartyCosecUser(id)).toBe(true);
    }
  });

  it("is case- and whitespace-insensitive, as device exports are inconsistent", () => {
    expect(isThirdPartyCosecUser("idc60168")).toBe(true);
    expect(isThirdPartyCosecUser("  IDC60168  ")).toBe(true);
  });

  it("does not swallow MAS Callnet ids", () => {
    for (const id of ["MAS52131", "MAS58767", "48673C", "Ranjeet", "Mahimapal"]) {
      expect(isThirdPartyCosecUser(id)).toBe(false);
    }
  });
});

describe("classification of a third-party id", () => {
  it("is excluded even when no employee record matches", () => {
    // Previously this returned "unmapped", which logged the attendance as dropped.
    expect(classifySourceUser("IDC60168", noEmployees)).toEqual({ kind: "excluded" });
  });

  it("is never reported as inactive or resigned", () => {
    const result = classifySourceUser("IDC62383", noEmployees);
    expect(result.kind).not.toBe("inactive");
    expect(result.kind).not.toBe("unmapped");
  });

  it("still classifies a genuinely unmapped MAS id as unmapped", () => {
    // The fix must not mask real mapping gaps — Ranjeet had 271 punches dropped
    // on 2026-06-18 and that still needs linking.
    expect(classifySourceUser("Ranjeet", noEmployees)).toEqual({ kind: "unmapped" });
  });

  it("keeps honouring the explicit exclusion table", () => {
    const maps = buildSourceUserMaps([], ["48673C"]);
    expect(classifySourceUser("48673C", maps)).toEqual({ kind: "excluded" });
  });

  it("still marks a resigned MAS employee inactive", () => {
    const maps = buildSourceUserMaps(
      [{ employee_id: "e1", employee_code: "MAS54791", cosec_user_id: "MAS54791", employment_status: "resigned" }],
      [],
    );
    expect(classifySourceUser("MAS54791", maps).kind).toBe("inactive");
  });
});

describe("an employee's id outranks the hand-maintained exclusion list", () => {
  // 2026-10-15, WFM email "APR available but punching not showing": 25 NOIDA-2 analysts sat on the
  // exclusion list while having employee rows, enrolment and biometric codes. Every punch was
  // discarded, so Cosec showed "-" beside a full APR day and shrinkage counted them absent.
  const analyst = {
    employee_id: "e63089", employee_code: "MAS63089", biometric_code: "MAS63089",
    cosec_user_id: "MAS63089", active_status: 1, employment_status: "Active",
  };

  it("classifies an excluded id that belongs to an active employee as active", () => {
    const maps = buildSourceUserMaps([analyst], ["MAS63089"]);
    expect(classifySourceUser("MAS63089", maps).kind).toBe("active");
  });

  it("matches by employee_code alone, with no enrolment row", () => {
    const maps = buildSourceUserMaps([{ employee_id: "e1", employee_code: "MAS70001", active_status: 1, employment_status: "Active" }], ["MAS70001"]);
    expect(classifySourceUser("MAS70001", maps).kind).toBe("active");
  });

  it("still reports a leaver as inactive rather than syncing them", () => {
    const maps = buildSourceUserMaps([{ ...analyst, active_status: 0, employment_status: "inactive" }], ["MAS63089"]);
    expect(classifySourceUser("MAS63089", maps).kind).toBe("inactive");
  });

  it("an exclusion with no employee behind it still excludes", () => {
    const maps = buildSourceUserMaps([analyst], ["GUEST-7"]);
    expect(classifySourceUser("GUEST-7", maps)).toEqual({ kind: "excluded" });
  });

  it("an IDC badge stays excluded even if an employee row somehow carried the id", () => {
    const maps = buildSourceUserMaps([{ employee_id: "x", employee_code: "IDC1", cosec_user_id: "IDC1", active_status: 1 }], []);
    expect(classifySourceUser("IDC1", maps)).toEqual({ kind: "excluded" });
  });

  it("conflictingExclusions lists only exclusions that point at employees", () => {
    const maps = buildSourceUserMaps([analyst], ["MAS63089", "GUEST-7", "IDC9"]);
    expect(conflictingExclusions(maps)).toEqual(["MAS63089"]);
  });
});
