import { describe, expect, it } from "vitest";

import {
  canonicalSource,
  sourceLabel,
  canonicalSourceSql,
  canonicalBranch,
  branchRegion,
  recruiterKey,
  normalizeRecruiterName,
  suspectedDuplicateRecruiters,
  RECRUITER_ALIAS,
  SOURCE_CANONICAL,
} from "../ats-vocabulary.js";

/**
 * The dimensions this module normalises are free text written by three different systems, so
 * every rule here is a claim about production data. Each is stated with the evidence that
 * established it, because the failure mode is not a crash — it is a ranking that quietly
 * compares two halves of the same thing against each other.
 */
describe("source channel vocabulary", () => {
  it("folds the three walk-in spellings onto one channel", () => {
    // 3,556 + 428 + 1 rows, previously ranked against each other at 34.8%, 19.4% and 0%.
    for (const raw of ["WALKIN", "Walk-In", "walk-in", "walk in", "WALK_IN"]) {
      expect(canonicalSource(raw), raw).toBe("WALK_IN");
    }
    expect(sourceLabel("WALKIN")).toBe("Walk-in");
    expect(sourceLabel("Walk-In")).toBe("Walk-in");
  });

  it("maps Reference onto the master's REFERRAL code", () => {
    // ats_sourcing_channel holds REFERRAL; candidates carry Reference. The mismatch is why the
    // BMI board's channel join matched zero rows.
    expect(canonicalSource("Reference")).toBe("REFERRAL");
  });

  it("keeps an unknown spelling rather than discarding it", () => {
    expect(canonicalSource("Naukri Gulf")).toBe("NAUKRI GULF");
    expect(canonicalSource(null)).toBe("UNSPECIFIED");
  });

  it("generates SQL that agrees with the JS form", () => {
    const sql = canonicalSourceSql("c.sourcing_channel");
    for (const raw of Object.keys(SOURCE_CANONICAL)) {
      expect(sql, raw).toContain(`'${raw}'`);
      expect(sql, raw).toContain(`'${SOURCE_CANONICAL[raw]}'`);
    }
    expect(sql).toContain("'UNSPECIFIED'");
  });
});

describe("branch vocabulary", () => {
  it("merges Jaldarshan into AHMEDABAD-JALDARSHAN", () => {
    /**
     * One site, two conventions — established from the recruiters, not the names. Jaldarshan is
     * staffed by Jagruti Patel / Monika Sharma / Sandeep Patel and AHMEDABAD-JALDARSHAN by
     * GAJJAR JAGRUTIBEN AKASHBHAI / MONIKA SANJAY SHARMA / SANDEEP BABULAL PATEL, confirmed the
     * same people via ats_recruiter_roster emails. branch_master's `city: Noida` on the
     * Jaldarshan row is a data-entry error: it has 0 employees, AHMEDABAD-JALDARSHAN has 266.
     */
    expect(canonicalBranch("Jaldarshan")).toBe("AHMEDABAD-JALDARSHAN");
    expect(canonicalBranch("AHMEDABAD-JALDARSHAN")).toBe("AHMEDABAD-JALDARSHAN");
    expect(branchRegion("Jaldarshan")).toBe("Gujarat");
  });

  it("folds the Noida site aliases onto their branches", () => {
    /**
     * Okaya is NOIDA-2 and Trapezoid is NOIDA, confirmed by the business 2026-08-27. The data
     * could not settle this on its own — staff rostered to both branches take candidates at
     * both sites — so it was escalated rather than guessed. The building is still visible on
     * each row as `_site`; only the branch rolls up.
     */
    expect(canonicalBranch("Okaya Centre")).toBe("NOIDA-2");
    expect(canonicalBranch("Okaya")).toBe("NOIDA-2");
    expect(canonicalBranch("Trapezoid")).toBe("NOIDA");
    expect(branchRegion("Okaya Centre")).toBe("Uttar Pradesh");
    expect(branchRegion("Trapezoid")).toBe("Uttar Pradesh");
  });

  it("separates the two geographies by region", () => {
    expect(branchRegion("NOIDA-2")).toBe("Uttar Pradesh");
    expect(branchRegion("AHMEDABAD-NEELAKANTH")).toBe("Gujarat");
  });
});

describe("recruiter identity", () => {
  it("merges the case-variant pairs", () => {
    // MySQL's collation sees one name; a JavaScript Map does not. Five people were split.
    expect(recruiterKey(null, "SOFIYA SULTAN")).toBe(recruiterKey(null, "Sofiya Sultan"));
    expect(recruiterKey(null, "RAKHI")).toBe(recruiterKey(null, "Rakhi"));
  });

  it("merges the pairs confirmed by roster email", () => {
    const pairs: Array<[string, string]> = [
      ["MEHAR", "Mehar Sheikh"],                              // mehar.sheikh@teammas.in
      ["SHEELU VERMA", "Sheelu"],                             // sheelu.verma@teammas.in
      ["MONIKA SANJAY SHARMA", "Monika Sharma"],              // monika.sharma@teammas.in
      ["GAJJAR JAGRUTIBEN AKASHBHAI", "Jagruti Patel"],       // patel.jagrutiben@teammas.co.in
      ["SRASHTI CHAUHAN", "Shristi"],                         // srashti.chauhan@teammas.co.in
      ["SANDEEP BABULAL PATEL", "Sandeep Patel"],             // hr.masahm@, both AHMEDABAD only
    ];
    for (const [a, b] of pairs) {
      expect(recruiterKey(null, a), `${a} vs ${b}`).toBe(recruiterKey(null, b));
    }
  });

  it("merges KHUSHI into Khushi Mishra", () => {
    /**
     * The roster's email read these as two people — KHUSHI carries a personal
     * khushichandaliya379@gmail.com against khushi.mishra@teammas.in — and the business
     * confirmed on 2026-08-27 that they are one person with a wrong address on her roster row.
     *
     * Recorded because it is the counter-example to this module's own method: the roster email
     * is the strongest signal available and it is not infallible, so a merge it rejects is a
     * question for a human rather than a settled answer.
     */
    expect(recruiterKey(null, "KHUSHI")).toBe(recruiterKey(null, "Khushi Mishra"));
    expect(suspectedDuplicateRecruiters(["KHUSHI", "Khushi Mishra"])).toEqual([]);
  });

  it("strips the employee-code suffix some callers append", () => {
    // recruiter_name is written as "SRASHTI CHAUHAN · MAS61660" by one caller, which produced a
    // second leaderboard row for the same person.
    expect(normalizeRecruiterName("SRASHTI CHAUHAN · MAS61660")).toBe("SRASHTI CHAUHAN");
    expect(recruiterKey(null, "SRASHTI CHAUHAN · MAS61660")).toBe(recruiterKey(null, "Shristi"));
  });

  it("does not merge two genuinely different names", () => {
    expect(recruiterKey(null, "Aditi")).not.toBe(recruiterKey(null, "Aanya Sharma"));
    expect(recruiterKey(null, "")).toBe("unassigned");
  });

  it("every alias target is itself a stable key", () => {
    // An alias pointing at a name that is itself aliased would resolve differently depending on
    // which spelling arrived first.
    for (const target of Object.values(RECRUITER_ALIAS)) {
      expect(RECRUITER_ALIAS[target.toLowerCase()], target).toBeUndefined();
    }
  });
});
