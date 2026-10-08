import { describe, expect, it } from "vitest";
import { adapterKeyFor, windowFor, SUPPORTED_PROCESS_CODES } from "../business-datapoints.service.js";

describe("business datapoints window", () => {
  const now = new Date(2026, 8, 30); // Wed 30 Sep 2026
  it("today / week / month / trend windows", () => {
    expect(windowFor("today", now)).toMatchObject({ from: "2026-09-30", to: "2026-09-30" });
    expect(windowFor("wtd", now)).toMatchObject({ from: "2026-09-28", to: "2026-09-30" }); // Monday
    expect(windowFor("mtd", now)).toMatchObject({ from: "2026-09-01", to: "2026-09-30" });
    expect(windowFor("trend", now)).toMatchObject({ from: "2026-09-01", to: "2026-09-30", label: "Last 30 days" });
  });
  it("week starts on Monday even when today is Sunday", () => {
    expect(windowFor("wtd", new Date(2026, 8, 27)).from).toBe("2026-09-21");
  });
  it("resolves an adapter by code, and Satya Retail by name", () => {
    expect(adapterKeyFor("GNC", "GNC")).toBe("GNC");
    expect(adapterKeyFor("X_1", "Satya E-Com Services Limited")).toBe("SATYA_RETAIL");
    expect(adapterKeyFor("X_1", "Godfrey Philips")).toBeNull();
    expect(adapterKeyFor(null, null)).toBeNull();
  });
  it("names the supported processes", () => {
    expect([...SUPPORTED_PROCESS_CODES]).toEqual(["BELLA_VITA", "BLA_BLI_BLU", "NEEMANS", "GNC", "HOUSING_OWNER", "HOUSING_PREMIUM", "CLOVIA", "BIRLANU", "DALMIA_CEMENT", "APPRICIATE_WEALTH", "ERESOLUTION", "DU_DIGITAL", "EXICOM", "VIEGA", "SATYA_RETAIL"]);
  });
});
