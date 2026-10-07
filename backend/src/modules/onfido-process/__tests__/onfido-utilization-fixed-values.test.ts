import { describe, expect, it } from "vitest";
import { applyUploadedValues } from "../onfido-utilization.service.js";
import { parseUtilizationInputRow } from "../onfido-wfm-inputs.validation.js";

const calc = {
  utilizationForecast: 100,
  utilizationWithAdhoc: 90,
  utilizationWithoutAdhoc: 80,
  utilizationWithAdhocPct: 90,
  utilizationWithoutAdhocPct: 80,
  poaAnsweringPct: 70,
  escalatedPct: 1,
};
const none = {
  fixedUtilizationForecast: null,
  fixedUtilizationWithAdhoc: null,
  fixedUtilizationWithoutAdhoc: null,
  fixedUtilizationWithAdhocPct: null,
  fixedUtilizationWithoutAdhocPct: null,
  fixedPoaAnsweringPct: null,
  fixedEscalatedPct: null,
};

describe("uploaded static Utilization values", () => {
  it("uses the calculation when nothing was uploaded", () => {
    expect(applyUploadedValues(calc, undefined)).toEqual(calc);
    expect(applyUploadedValues(calc, { ...none } as never)).toEqual(calc);
  });

  it("lets an uploaded value win, column by column, including 0", () => {
    const out = applyUploadedValues(calc, {
      ...none,
      fixedUtilizationForecast: 123.5,
      fixedEscalatedPct: 0,
    } as never);
    expect(out.utilizationForecast).toBe(123.5);
    expect(out.escalatedPct).toBe(0);
    expect(out.utilizationWithAdhoc).toBe(90);
  });

  it("validates and accepts the calculated columns on an input row, rejecting junk", () => {
    const ok = parseUtilizationInputRow({
      inputDate: "2026-07-01",
      fixedUtilizationWithAdhocPct: "114.4",
      fixedPoaAnsweringPct: 88,
    });
    expect(ok.ok && ok.value.fixedUtilizationWithAdhocPct).toBe(114.4);
    expect(ok.ok && ok.value.fixedPoaAnsweringPct).toBe(88);
    expect(ok.ok && ok.value.fixedEscalatedPct).toBeNull();
    expect(
      parseUtilizationInputRow({
        inputDate: "2026-07-01",
        fixedEscalatedPct: "abc",
      }).ok,
    ).toBe(false);
  });
});
