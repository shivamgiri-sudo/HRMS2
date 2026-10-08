import { describe, expect, it } from "vitest";
import { classifyAprMinutes, parseAprNetLoginToMinutes } from "../apr-payroll-reconciliation.service.js";

describe("APR payroll reconciliation helpers", () => {
  it("parses APR Net_Login HH:MM:SS values into rounded minutes", () => {
    expect(parseAprNetLoginToMinutes("08:00:00")).toBe(480);
    expect(parseAprNetLoginToMinutes("03:59:31")).toBe(240);
    expect(parseAprNetLoginToMinutes("00:10:29")).toBe(10);
  });

  it("classifies APR minutes using payroll attendance thresholds", () => {
    expect(classifyAprMinutes(480)).toEqual({ status: "present", lwpValue: 0 });
    expect(classifyAprMinutes(240)).toEqual({ status: "half_day", lwpValue: 0.5 });
    expect(classifyAprMinutes(239)).toEqual({ status: "absent", lwpValue: 1 });
  });
});
