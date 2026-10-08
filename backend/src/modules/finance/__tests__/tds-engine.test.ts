import { describe, expect, it } from "vitest";
import {
  computeExpectedTds,
  deducteeTypeFromPan,
  financialYearOf,
  hasValidPan,
  type TdsSection,
} from "../tds-engine.js";

const C194: TdsSection = {
  sectionCode: "194C",
  rateIndividual: 1,
  rateOther: 2,
  rateNoPan: 20,
  singleLimit: 30000,
  annualLimit: 100000,
};
const RENT: TdsSection = {
  sectionCode: "194I_LB",
  rateIndividual: 10,
  rateOther: 10,
  rateNoPan: 20,
  singleLimit: null,
  annualLimit: 600000,
};
const PM: TdsSection = {
  sectionCode: "194I_PM",
  rateIndividual: 2,
  rateOther: 2,
  rateNoPan: 20,
  singleLimit: null,
  annualLimit: 600000,
};
const COMPANY_PAN = "AABCT1234F";
const PERSON_PAN = "ABCPK1234F";

describe("deducteeTypeFromPan", () => {
  it("reads the 4th letter", () => {
    expect(deducteeTypeFromPan(COMPANY_PAN)).toBe("other");
    expect(deducteeTypeFromPan(PERSON_PAN)).toBe("individual");
    expect(deducteeTypeFromPan("AAAHB1234C")).toBe("individual");
  });
  it("treats a missing or malformed PAN as unknown", () => {
    expect(deducteeTypeFromPan(null)).toBe("unknown");
    expect(deducteeTypeFromPan("")).toBe("unknown");
    expect(deducteeTypeFromPan("NOTAPAN")).toBe("unknown");
    expect(hasValidPan(" aabct1234f ")).toBe(true);
  });
});

describe("financialYearOf", () => {
  it("rolls on 1 April", () => {
    expect(financialYearOf("2026-03-31")).toBe("2025-26");
    expect(financialYearOf("2026-04-01")).toBe("2026-27");
    expect(financialYearOf("2026-10-06")).toBe("2026-27");
  });
});

describe("computeExpectedTds", () => {
  it("no section means no TDS", () => {
    const r = computeExpectedTds({
      section: null,
      pan: COMPANY_PAN,
      baseAmount: 100000,
      ytdBase: 0,
    });
    expect(r.applicable).toBe(false);
    expect(r.expectedTds).toBe(0);
  });

  it("contractor: 2% for a company, 1% for an individual, on the amount before GST", () => {
    expect(
      computeExpectedTds({
        section: C194,
        pan: COMPANY_PAN,
        baseAmount: 50000,
        ytdBase: 0,
      }).expectedTds,
    ).toBe(1000);
    expect(
      computeExpectedTds({
        section: C194,
        pan: PERSON_PAN,
        baseAmount: 50000,
        ytdBase: 0,
      }).expectedTds,
    ).toBe(500);
  });

  it("contractor: a payment of 30,000 or less is not deducted unless the year's total crosses 1,00,000", () => {
    const small = computeExpectedTds({
      section: C194,
      pan: COMPANY_PAN,
      baseAmount: 25000,
      ytdBase: 10000,
    });
    expect(small.applicable).toBe(false);
    const crossing = computeExpectedTds({
      section: C194,
      pan: COMPANY_PAN,
      baseAmount: 25000,
      ytdBase: 90000,
    });
    expect(crossing.applicable).toBe(true);
    // catch-up: 2% on everything paid in the year (90,000 + 25,000)
    expect(crossing.deductionBase).toBe(115000);
    expect(crossing.expectedTds).toBe(2300);
  });

  it("after the year has already crossed the limit, each payment is deducted on its own amount", () => {
    const r = computeExpectedTds({
      section: C194,
      pan: COMPANY_PAN,
      baseAmount: 20000,
      ytdBase: 150000,
    });
    expect(r.deductionBase).toBe(20000);
    expect(r.expectedTds).toBe(400);
  });

  it("rent at 10% only once the year's rent passes 6,00,000", () => {
    expect(
      computeExpectedTds({
        section: RENT,
        pan: COMPANY_PAN,
        baseAmount: 100000,
        ytdBase: 400000,
      }).applicable,
    ).toBe(false);
    const r = computeExpectedTds({
      section: RENT,
      pan: COMPANY_PAN,
      baseAmount: 100000,
      ytdBase: 550000,
    });
    expect(r.applicable).toBe(true);
    expect(r.deductionBase).toBe(650000);
    expect(r.expectedTds).toBe(65000);
  });

  it("equipment hire is 2%", () => {
    const r = computeExpectedTds({
      section: PM,
      pan: COMPANY_PAN,
      baseAmount: 700000,
      ytdBase: 0,
    });
    expect(r.expectedTds).toBe(14000);
  });

  it("no valid PAN raises the rate to 20% when that is higher", () => {
    const r = computeExpectedTds({
      section: C194,
      pan: null,
      baseAmount: 50000,
      ytdBase: 0,
    });
    expect(r.rate).toBe(20);
    expect(r.expectedTds).toBe(10000);
    expect(r.reason).toMatch(/no valid PAN/i);
  });

  it("nothing before GST means nothing to deduct", () => {
    expect(
      computeExpectedTds({
        section: C194,
        pan: COMPANY_PAN,
        baseAmount: 0,
        ytdBase: 0,
      }).applicable,
    ).toBe(false);
  });
});
