/**
 * Sharing a PAN with yourself is not fraud.
 *
 * The duplicate check matched a PAN or Aadhaar hash against every other
 * candidate record and raised a critical alert on any hit, with no filter on
 * status and no test of whether the two records describe the same person. That
 * was tolerable while the alert only sat in a table. It stopped being tolerable
 * when an open critical alert began refusing employee creation: a rejoiner, or
 * anyone who simply applied twice, is now blocked by a control aimed at
 * identity theft.
 *
 * The right discriminator is identity, not employment status. A rejected or
 * ex-employee record whose PAN turns up on a *different* person is still fraud
 * — arguably the most likely place to find it. The question is only ever
 * whether the two records are the same human being.
 *
 * Name comparison uses the same Indian-aware matcher as the bank check, so
 * "RAJESH KUMAR" rejoining as "RAJESH KUMAR SINGH" is recognised as himself
 * rather than flagged.
 */
import { describe, it, expect } from "vitest";
import { classifyDuplicateIdentity } from "../duplicate-identity.js";

describe("classifyDuplicateIdentity", () => {
  it("treats a rejoiner as a repeat applicant, not fraud", () => {
    const result = classifyDuplicateIdentity(
      { fullName: "RAJESH KUMAR", dateOfBirth: "1990-04-12" },
      { fullName: "RAJESH KUMAR", dateOfBirth: "1990-04-12" },
    );
    expect(result.samePerson).toBe(true);
    expect(result.alertType).toBe("REPEAT_APPLICANT");
    expect(result.severity).toBe("low");
    expect(result.blocking).toBe(false);
  });

  it("recognises the same person through an ordinary name variance", () => {
    // The record from a previous stint often carries a fuller name.
    const result = classifyDuplicateIdentity(
      { fullName: "RAJESH KUMAR", dateOfBirth: "1990-04-12" },
      { fullName: "RAJESH KUMAR SINGH", dateOfBirth: "1990-04-12" },
    );
    expect(result.samePerson).toBe(true);
    expect(result.blocking).toBe(false);
  });

  it("still catches one PAN used by two different people", () => {
    // This is the case the control exists for, and the shape of the live data:
    // SRASHTI CHAUHAN's PAN matched a record named SHivam Shiv Giri.
    const result = classifyDuplicateIdentity(
      { fullName: "SRASHTI CHAUHAN", dateOfBirth: "1995-01-01" },
      { fullName: "SHIVAM SHIV GIRI", dateOfBirth: "1992-02-02" },
    );
    expect(result.samePerson).toBe(false);
    expect(result.alertType).toBe("DUPLICATE_IDENTITY");
    expect(result.severity).toBe("critical");
    expect(result.blocking).toBe(true);
  });

  it("a matching name with a clearly different date of birth is not the same person", () => {
    // Fathers and sons share names. A PAN is issued to one human being.
    const result = classifyDuplicateIdentity(
      { fullName: "RAJESH KUMAR", dateOfBirth: "1990-04-12" },
      { fullName: "RAJESH KUMAR", dateOfBirth: "1968-09-30" },
    );
    expect(result.samePerson).toBe(false);
    expect(result.blocking).toBe(true);
  });

  it("accepts a matching name when neither record has a usable date of birth", () => {
    // Absent data must not manufacture a fraud signal; the name is all there is.
    const result = classifyDuplicateIdentity(
      { fullName: "RAJESH KUMAR", dateOfBirth: null },
      { fullName: "RAJESH KUMAR", dateOfBirth: null },
    );
    expect(result.samePerson).toBe(true);
    expect(result.blocking).toBe(false);
  });

  it("blocks when the other record has no name to compare", () => {
    // We cannot conclude it is the same person, and the safe failure for a
    // shared government identifier is a human look.
    const result = classifyDuplicateIdentity(
      { fullName: "RAJESH KUMAR", dateOfBirth: "1990-04-12" },
      { fullName: "", dateOfBirth: null },
    );
    expect(result.samePerson).toBe(false);
    expect(result.blocking).toBe(true);
  });

  it("does not let a shared common surname pass as the same person", () => {
    const result = classifyDuplicateIdentity(
      { fullName: "SURESH KUMAR", dateOfBirth: "1990-04-12" },
      { fullName: "RAJESH KUMAR", dateOfBirth: "1990-04-12" },
    );
    expect(result.samePerson).toBe(false);
    expect(result.blocking).toBe(true);
  });

  it("explains itself, since a reviewer has to act on the result", () => {
    const rejoiner = classifyDuplicateIdentity(
      { fullName: "RAJESH KUMAR", dateOfBirth: "1990-04-12" },
      { fullName: "RAJESH KUMAR", dateOfBirth: "1990-04-12" },
    );
    expect(rejoiner.reason.toLowerCase()).toMatch(/same person|rejoin|applied before/);
  });
});
