import { describe, expect, it } from "vitest";
import { applyUploadedValues } from "../onfido-utilization.service.js";
import { parseUploadedNumber, parseUtilizationInputBatch, parseUtilizationInputRow } from "../onfido-wfm-inputs.validation.js";

const none = {
  fixedUtilizationForecast: null, fixedUtilizationWithAdhoc: null, fixedUtilizationWithoutAdhoc: null,
  fixedUtilizationWithAdhocPct: null, fixedUtilizationWithoutAdhocPct: null, fixedPoaAnsweringPct: null, fixedEscalatedPct: null,
};

describe("import-driven Utilization values", () => {
  it("never calculates: nothing uploaded means blank", () => {
    expect(Object.values(applyUploadedValues(undefined)).every((v) => v === null)).toBe(true);
    expect(Object.values(applyUploadedValues({ ...none } as never)).every((v) => v === null)).toBe(true);
  });

  it("returns uploaded values as stored, including 0", () => {
    const out = applyUploadedValues({ ...none, fixedUtilizationForecast: 123.5, fixedEscalatedPct: 0 } as never);
    expect(out.utilizationForecast).toBe(123.5);
    expect(out.escalatedPct).toBe(0);
    expect(out.utilizationWithAdhoc).toBeNull();
  });
});

describe("uploaded number parsing", () => {
  it("accepts percent strings, decimals, integers, commas, negatives and blanks", () => {
    expect(parseUploadedNumber("85%")).toBe(85);
    expect(parseUploadedNumber("0.85")).toBe(0.85);
    expect(parseUploadedNumber("85")).toBe(85);
    expect(parseUploadedNumber("1,234")).toBe(1234);
    expect(parseUploadedNumber("35,626.99")).toBe(35626.99);
    expect(parseUploadedNumber("(12)")).toBe(-12);
    expect(parseUploadedNumber(" 7 ")).toBe(7);
    expect(parseUploadedNumber("")).toBeNull();
    expect(parseUploadedNumber("-")).toBeNull();
    expect(parseUploadedNumber("N/A")).toBeNull();
    expect(parseUploadedNumber("#DIV/0!")).toBeNull();
    expect(parseUploadedNumber(undefined)).toBeNull();
    expect(Number.isNaN(parseUploadedNumber("abc"))).toBe(true);
  });

  it("keeps decimals in count columns and percent signs in any column, blanks stay null", () => {
    const r = parseUtilizationInputRow({
      inputDate: "2026-07-01", analystQc: "2143.5", facialChecks: "", manualFarCases: "1,335",
      fixedUtilizationWithAdhoc: "114.4%", fixedUtilizationWithAdhocPct: "114.4%", fixedPoaAnsweringPct: "0.88", fixedEscalatedPct: "-",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.analystQc).toBe(2143.5);
      expect(r.value.facialChecks).toBeNull();
      expect(r.value.manualFarCases).toBe(1335);
      expect(r.value.fixedUtilizationWithAdhoc).toBe(114.4);
      expect(r.value.fixedUtilizationWithAdhocPct).toBe(114.4);
      expect(r.value.fixedPoaAnsweringPct).toBe(0.88);
      expect(r.value.fixedEscalatedPct).toBeNull();
    }
  });

  it("still rejects junk text, and a batch with it writes nothing", () => {
    expect(parseUtilizationInputRow({ inputDate: "2026-07-01", fixedEscalatedPct: "abc" }).ok).toBe(false);
    expect(parseUtilizationInputBatch([{ inputDate: "2026-07-01" }, { inputDate: "2026-07-02", adhocTime: "x" }]).ok).toBe(false);
  });
});
