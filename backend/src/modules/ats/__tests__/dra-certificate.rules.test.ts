import { describe, it, expect } from "vitest";
import {
  findDetailDisagreement, validateEnteredDetails,
  parseDraCertificateText, parseIndianDate, nameSimilarity, evaluateDraCertificate, isDraCostCentre,
} from "../dra-certificate.rules.js";

const SAMPLE = `INDIAN INSTITUTE OF BANKING & FINANCE
Certificate Examination for Debt Recovery Agent (DRA)
This is to certify that Mr. RAVIKAR MISHRA having Membership No. DRA/12345678 has passed
the examination. Certificate Serial No: IIBF-DRA-998877
Certificate Date: 14/03/2024   Valid up to: 13-03-2029
Security Code: A1B2C3D4`;

const base = { today: "2026-10-08", profileName: "Ravikar Mishra", textLength: 400 };

describe("parseIndianDate", () => {
  it("parses numeric and month-name dates, rejects impossible ones", () => {
    expect(parseIndianDate("14/03/2024")).toBe("2024-03-14");
    expect(parseIndianDate("14-Mar-2024")).toBe("2024-03-14");
    expect(parseIndianDate("5 March 2024")).toBe("2024-03-05");
    expect(parseIndianDate("14/03/24")).toBe("2024-03-14");
    expect(parseIndianDate("31/02/2024")).toBeNull();
    expect(parseIndianDate("garbage")).toBeNull();
  });
});

describe("parseDraCertificateText", () => {
  it("reads the four IIBF details, name and validity", () => {
    const p = parseDraCertificateText(SAMPLE);
    expect(p.looksLikeDra).toBe(true);
    expect(p.name).toBe("RAVIKAR MISHRA");
    expect(p.registrationNo).toBe("DRA/12345678");
    expect(p.serialNo).toBe("IIBF-DRA-998877");
    expect(p.securityCode).toBe("A1B2C3D4");
    expect(p.certificateDate).toBe("2024-03-14");
    expect(p.validUntil).toBe("2029-03-13");
  });
  it("does not call an unrelated document a DRA certificate", () => {
    expect(parseDraCertificateText("Electricity bill for the month of March").looksLikeDra).toBe(false);
  });
});

describe("nameSimilarity", () => {
  it("is order-insensitive and tolerant of an initial", () => {
    expect(nameSimilarity("RAVIKAR MISHRA", "Mishra Ravikar")).toBe(1);
    expect(nameSimilarity("R MISHRA", "Ravikar Mishra")).toBe(1);
    expect(nameSimilarity("Amit Kumar", "Ravikar Mishra")).toBe(0);
  });
});

describe("evaluateDraCertificate", () => {
  const ok = parseDraCertificateText(SAMPLE);
  it("never auto-verifies: a clean certificate is pending with autoChecksPassed", () => {
    const r = evaluateDraCertificate({ ...base, parsed: ok });
    expect(r.status).toBe("pending");
    expect(r.autoChecksPassed).toBe(true);
  });
  it("flags expired", () => {
    const r = evaluateDraCertificate({ ...base, parsed: { ...ok, validUntil: "2026-01-01" } });
    expect(r.status).toBe("expired");
    expect(r.autoChecksPassed).toBe(false);
  });
  it("flags a different name as mismatch", () => {
    expect(evaluateDraCertificate({ ...base, parsed: ok, profileName: "Amit Kumar" }).status).toBe("mismatch");
  });
  it("flags a number already used by another candidate", () => {
    expect(evaluateDraCertificate({ ...base, parsed: ok, duplicateOf: "MAS1" }).status).toBe("mismatch");
  });
  it("flags a photo that does not match the selfie, but ignores 'no face'", () => {
    expect(evaluateDraCertificate({ ...base, parsed: ok, face: { status: "completed", matched: false, score: 20 } }).status).toBe("mismatch");
    expect(evaluateDraCertificate({ ...base, parsed: ok, face: { status: "no_face_detected", matched: false, score: 0 } }).autoChecksPassed).toBe(true);
  });
  it("marks a non-DRA document invalid and an unreadable one pending", () => {
    expect(evaluateDraCertificate({ ...base, parsed: parseDraCertificateText("Electricity bill ".repeat(10)) }).status).toBe("invalid");
    expect(evaluateDraCertificate({ ...base, parsed: ok, textLength: 3 }).status).toBe("pending");
  });
  it("stays pending (not passed) and names what could not be read", () => {
    const r = evaluateDraCertificate({ ...base, parsed: { ...ok, securityCode: null } });
    expect(r.status).toBe("pending");
    expect(r.autoChecksPassed).toBe(false);
    expect(r.reason).toMatch(/security code/);
  });
});

describe("isDraCostCentre", () => {
  it("applies to the SBI cost centre only", () => {
    expect(isDraCostCentre("BSS/OB/AHMH-JD/1050")).toBe(true);
    expect(isDraCostCentre(" bss/ob/ahmh-jd/1050 ")).toBe(true);
    expect(isDraCostCentre("BSS/OB/AHMH-JD/474")).toBe(false);
    expect(isDraCostCentre(null)).toBe(false);
  });
});

describe("candidate-typed details", () => {
  const read = { registrationNo: "DRA/12345678", serialNo: "IIBF-DRA-998877", securityCode: "A1B2C3D4", certificateDate: "2024-03-14" };
  it("agree regardless of spacing, case and punctuation", () => {
    expect(findDetailDisagreement({ ...read, registrationNo: "dra 12345678", securityCode: "a1b2 c3d4" }, read)).toBeNull();
  });
  it("name every field that differs", () => {
    const r = findDetailDisagreement({ ...read, serialNo: "IIBF-DRA-000000", certificateDate: "2023-01-01" }, read);
    expect(r).toMatch(/serial no\./);
    expect(r).toMatch(/certificate date/);
  });
  it("skip fields the OCR could not read", () => {
    expect(findDetailDisagreement(read, { ...read, securityCode: null })).toBeNull();
  });
  it("turns a disagreement into a mismatch", () => {
    const ok = parseDraCertificateText(SAMPLE);
    expect(evaluateDraCertificate({ ...base, parsed: ok, disagreement: "x differs" }).status).toBe("mismatch");
  });
  it("validates the typed form", () => {
    expect(validateEnteredDetails(read, "2026-10-08")).toEqual([]);
    expect(validateEnteredDetails({ ...read, securityCode: "1" }, "2026-10-08")).toHaveLength(1);
    expect(validateEnteredDetails({ ...read, certificateDate: "2030-01-01" }, "2026-10-08")[0]).toMatch(/future/);
    expect(validateEnteredDetails({}, "2026-10-08")).toHaveLength(4);
  });
});
