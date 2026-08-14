/**
 * Age verification and the block on onboarding a minor.
 *
 * Before this, nothing enforced a minimum age anywhere. The only age logic was
 * frontend-only (OnboardingSteps1to5.tsx), used 16 rather than 18, and computed
 * a display string that was never checked before save.
 *
 * The boundary cases are the point: someone one day short of 18 must be blocked
 * and someone exactly 18 must not, and the age is judged on the JOINING date
 * rather than whenever the form was filled in.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

type Rows = Record<string, unknown>[];
const state: { bgv?: Rows; docs?: Rows; profile?: Rows; minorUpdateFails?: boolean } = {};

const dbExecute = vi.fn(async (sql: string) => {
  const s = String(sql);
  if (s.includes("candidate_bgv_check")) return [state.bgv ?? []];
  if (s.includes("candidate_onboarding_document")) return [state.docs ?? []];
  if (s.includes("FROM ats_candidate c")) return [state.profile ?? []];
  if (s.includes("UPDATE ats_candidate SET is_minor")) {
    if (state.minorUpdateFails) throw new Error("Connection lost");
    return [{ affectedRows: 1 }];
  }
  return [[]];
});
vi.mock("../../../db/mysql.js", () => ({ db: { execute: dbExecute } }));

const {
  resolveVerifiedDob, assertEmployableAge, extractDobFromText, ageOn,
  MINIMUM_EMPLOYMENT_AGE, persistMinorFlag,
} = await import("../ageVerification.service.js");

beforeEach(() => { state.bgv = []; state.docs = []; state.profile = []; state.minorUpdateFails = false; dbExecute.mockClear(); });

/** A DOB that makes someone exactly `years` old on `on`. */
const dobFor = (years: number, on = new Date()) =>
  `${on.getFullYear() - years}-${String(on.getMonth() + 1).padStart(2, "0")}-${String(on.getDate()).padStart(2, "0")}`;

describe("age arithmetic", () => {
  it("counts whole years, not fractions of 365.25", () => {
    // Millisecond division drifts across leap years and misjudges the boundary.
    expect(ageOn("2008-08-01", new Date("2026-07-31T12:00:00"))).toBe(17);
    expect(ageOn("2008-08-01", new Date("2026-08-01T12:00:00"))).toBe(18);
  });

  it("handles a 29 February birthday", () => {
    expect(ageOn("2008-02-29", new Date("2026-02-28T12:00:00"))).toBe(17);
    expect(ageOn("2008-02-29", new Date("2026-03-01T12:00:00"))).toBe(18);
  });
});

describe("the 18th-birthday boundary", () => {
  it("blocks someone one day short of 18", async () => {
    const join = new Date("2026-08-01T12:00:00");
    state.profile = [{ dob: "2008-08-02" }];
    const v = await resolveVerifiedDob("cand-1", join);
    expect(v.age).toBe(17);
    expect(v.isMinor).toBe(true);
    await expect(assertEmployableAge("cand-1", join)).rejects.toMatchObject({ code: "UNDERAGE_CANDIDATE" });
  });

  it("allows someone exactly 18 on their joining date", async () => {
    const join = new Date("2026-08-01T12:00:00");
    state.profile = [{ dob: "2008-08-01" }];
    const v = await resolveVerifiedDob("cand-1", join);
    expect(v.age).toBe(18);
    expect(v.isMinor).toBe(false);
    await expect(assertEmployableAge("cand-1", join)).resolves.toBeTruthy();
  });

  it("judges age on the JOINING date, not today", async () => {
    // Under 18 now, but 18 by the time employment starts — must not be blocked.
    state.profile = [{ dob: dobFor(18, new Date(Date.now() + 60 * 24 * 3600 * 1000)) }];
    const soon = new Date(Date.now() + 60 * 24 * 3600 * 1000);
    expect((await resolveVerifiedDob("cand-1", soon)).isMinor).toBe(false);
    expect((await resolveVerifiedDob("cand-1", new Date())).isMinor).toBe(true);
  });
});

describe("source precedence", () => {
  it("prefers the provider-verified DOB over a self-declared one", async () => {
    // A candidate could otherwise type a false year to defeat the check.
    state.bgv = [{ matched_dob: "2010-05-05" }];
    state.profile = [{ dob: "1990-01-01" }];
    const v = await resolveVerifiedDob("cand-1", new Date("2026-08-01T12:00:00"));
    expect(v.source).toBe("bgv_verified");
    expect(v.dob).toBe("2010-05-05");
    expect(v.verified).toBe(true);
    expect(v.isMinor).toBe(true);
  });

  it("falls back to OCR when there is no verified DOB", async () => {
    state.docs = [{ ocr_raw_text: "Government of India\nDOB: 15/06/2009\nMale" }];
    state.profile = [{ dob: "1990-01-01" }];
    const v = await resolveVerifiedDob("cand-1", new Date("2026-08-01T12:00:00"));
    expect(v.source).toBe("ocr_document");
    expect(v.dob).toBe("2009-06-15");
    expect(v.verified).toBe(false);
  });

  it("uses the self-declared DOB last", async () => {
    state.profile = [{ dob: "1995-03-10" }];
    const v = await resolveVerifiedDob("cand-1", new Date("2026-08-01T12:00:00"));
    expect(v.source).toBe("self_declared");
    expect(v.verified).toBe(false);
  });

  it("reports no DOB rather than guessing", async () => {
    const v = await resolveVerifiedDob("cand-1");
    expect(v.source).toBe("none");
    expect(v.dob).toBeNull();
    expect(v.isMinor).toBe(false);
    expect(v.reason).toMatch(/no date of birth/i);
  });

  it("surfaces a conflict between sources instead of hiding it", async () => {
    state.bgv = [{ matched_dob: "2000-01-01" }];
    state.profile = [{ dob: "1995-01-01" }];
    const v = await resolveVerifiedDob("cand-1", new Date("2026-08-01T12:00:00"));
    expect(v.source).toBe("bgv_verified");
    expect(v.conflicts.length).toBe(1);
    expect(v.conflicts[0].source).toBe("self_declared");
  });

  it("does not treat a one-day timezone shift as a conflict", async () => {
    state.bgv = [{ matched_dob: "2000-01-01" }];
    state.profile = [{ dob: new Date("1999-12-31T18:30:00Z") }]; // = 2000-01-01 IST
    expect((await resolveVerifiedDob("cand-1")).conflicts).toEqual([]);
  });
});

describe("reading a DOB out of OCR text", () => {
  it.each([
    ["DOB: 15/06/1998", "1998-06-15"],
    ["D.O.B 01-02-1990", "1990-02-01"],
    ["Date of Birth : 9.7.1985", "1985-07-09"],
    ["Year of Birth: 1992", "1992-01-01"],
    ["YOB 1988", "1988-01-01"],
  ])("parses %s", (text, expected) => {
    expect(extractDobFromText(text)).toBe(expected);
  });

  it("rejects dates that cannot be a working-age DOB", () => {
    // OCR routinely picks up issue dates and garbled years.
    expect(extractDobFromText("Issued 12/03/2024")).toBeNull();
    expect(extractDobFromText("DOB: 01/01/1899")).toBeNull();
    expect(extractDobFromText("no dates here at all")).toBeNull();
    expect(extractDobFromText("")).toBeNull();
  });

  it("prefers a labelled DOB over any other date on the document", () => {
    const aadhaar = "Issue Date: 12/03/2021\nName: Test\nDOB: 15/06/1998\nMale";
    expect(extractDobFromText(aadhaar)).toBe("1998-06-15");
  });
});

describe("the block itself", () => {
  it("throws in the shape the onboarding guards already use", async () => {
    state.profile = [{ dob: dobFor(15) }];
    try {
      await assertEmployableAge("cand-1");
      throw new Error("should have thrown");
    } catch (e) {
      const err = e as { statusCode?: number; code?: string; message: string };
      expect(err.statusCode).toBe(400);
      expect(err.code).toBe("UNDERAGE_CANDIDATE");
      expect(err.message).toContain(String(MINIMUM_EMPLOYMENT_AGE));
    }
  });

  it("does not block when no DOB exists — that is a data gap, not a minor", async () => {
    // Blocking on absent data would stop every candidate whose DOB was never
    // captured, which is most of them historically.
    await expect(assertEmployableAge("cand-1")).resolves.toMatchObject({ source: "none" });
  });
});

/**
 * Regression test, 2026-08-14: persistMinorFlag used to be `.catch(() => undefined)` —
 * completely silent, no logging at all. A real write failure reproduced the exact defect
 * this function exists to fix (the guardian-consent banner could never render), invisibly.
 * It now logs instead of silently discarding the error, and — the load-bearing behavior —
 * still never throws, so a write failure cannot block the rest of onboarding submission
 * over one column.
 */
describe("persistMinorFlag", () => {
  it("writes is_minor and does not throw on success", async () => {
    await expect(
      persistMinorFlag("cand-1", { isMinor: true, age: 17, source: "self_declared", dob: dobFor(17) } as any)
    ).resolves.toBeUndefined();
    expect(dbExecute).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE ats_candidate SET is_minor"),
      [1, "cand-1"],
    );
  });

  it("does not throw when the write fails — the caller must not be blocked by this", async () => {
    state.minorUpdateFails = true;
    await expect(
      persistMinorFlag("cand-1", { isMinor: false, age: 25, source: "self_declared", dob: dobFor(25) } as any)
    ).resolves.toBeUndefined();
  });
});
