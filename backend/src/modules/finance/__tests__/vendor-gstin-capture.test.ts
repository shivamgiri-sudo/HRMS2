import { describe, expect, it } from "vitest";
import { decideGstinCapture } from "../vendor-gstin-capture.js";

// 27AAPFU0939F1ZV is the sample GSTIN used in the GST council's own documentation (valid check digit).
const VALID = "27AAPFU0939F1ZV";
const SAME_PAN = "AAPFU0939F";

describe("decideGstinCapture", () => {
  it("saves a valid GSTIN when the vendor has none", () => {
    const d = decideGstinCapture({
      grnGstin: ` ${VALID.toLowerCase()} `,
      vendorGstin: null,
      vendorPan: null,
    });
    expect(d).toEqual({ save: true, gstin: VALID, stateCode: "27" });
  });

  it("treats NA and blank placeholders on the vendor as 'none on file'", () => {
    expect(
      decideGstinCapture({
        grnGstin: VALID,
        vendorGstin: "NA",
        vendorPan: null,
      }).save,
    ).toBe(true);
    expect(
      decideGstinCapture({
        grnGstin: VALID,
        vendorGstin: "  ",
        vendorPan: null,
      }).save,
    ).toBe(true);
  });

  it("never overwrites a GSTIN already on file", () => {
    expect(
      decideGstinCapture({
        grnGstin: VALID,
        vendorGstin: "29ABCDE1234F1Z5",
        vendorPan: null,
      }),
    ).toEqual({ save: false, reason: "vendor_has_gstin" });
  });

  it("ignores a blank or placeholder GSTIN on the GRN", () => {
    expect(
      decideGstinCapture({
        grnGstin: "NA",
        vendorGstin: null,
        vendorPan: null,
      }),
    ).toEqual({ save: false, reason: "no_gstin" });
    expect(
      decideGstinCapture({ grnGstin: "", vendorGstin: null, vendorPan: null }),
    ).toEqual({ save: false, reason: "no_gstin" });
  });

  it("rejects a GSTIN with a wrong check digit", () => {
    const typo = VALID.slice(0, 14) + "W";
    expect(
      decideGstinCapture({
        grnGstin: typo,
        vendorGstin: null,
        vendorPan: null,
      }),
    ).toEqual({ save: false, reason: "invalid" });
  });

  it("rejects a GSTIN whose PAN part does not match the vendor's PAN", () => {
    expect(
      decideGstinCapture({
        grnGstin: VALID,
        vendorGstin: null,
        vendorPan: "ABCDE1234F",
      }),
    ).toEqual({ save: false, reason: "pan_mismatch" });
    expect(
      decideGstinCapture({
        grnGstin: VALID,
        vendorGstin: null,
        vendorPan: SAME_PAN,
      }).save,
    ).toBe(true);
  });
});
