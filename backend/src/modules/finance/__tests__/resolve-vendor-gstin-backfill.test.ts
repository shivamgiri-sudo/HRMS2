import { describe, it, expect } from "vitest";
import { resolveVendorGstinBackfill } from "../grn-smart.service.js";

/**
 * The other half of the GRN vendor-GSTIN fix (2026-09-02): resolveCanonicalVendor
 * (grn.service.ts) only READS vendor_master.gst_number; this is what WRITES it, from a real,
 * human-confirmed GRN extraction — so a vendor's trustworthy GSTIN, once established, compounds
 * onto every future GRN for that vendor rather than being re-derived (or missed) each time.
 */
describe("resolveVendorGstinBackfill", () => {
  it("backfills when the vendor currently has no GSTIN at all", () => {
    expect(resolveVendorGstinBackfill("", "09AAACM5866H1Z6")).toBe("09AAACM5866H1Z6");
  });

  it("backfills when the vendor's current value fails the checksum — a real live example: "
    + "\"na\" is stamped on 70 vendor_master rows", () => {
    expect(resolveVendorGstinBackfill("na", "09AAACM5866H1Z6")).toBe("09AAACM5866H1Z6");
  });

  it("does not backfill an unconfirmed/malformed value onto the vendor", () => {
    expect(resolveVendorGstinBackfill("", "not-a-gstin")).toBeNull();
    expect(resolveVendorGstinBackfill("", "")).toBeNull();
  });

  it("never overwrites a vendor's ALREADY-trustworthy GSTIN with a different confirmed one — "
    + "a real discrepancy between two GRNs for the same vendor needs a human, not a silent pick", () => {
    expect(resolveVendorGstinBackfill("09AAACM5866H1Z6", "24AAACM5866H1ZE")).toBeNull();
  });

  it("is a no-op re-confirming the same value the vendor already has", () => {
    expect(resolveVendorGstinBackfill("09AAACM5866H1Z6", "09AAACM5866H1Z6")).toBeNull();
  });

  it("normalizes case/whitespace before comparing and writing", () => {
    expect(resolveVendorGstinBackfill("", " 09aaacm5866h1z6 ")).toBe("09AAACM5866H1Z6");
  });
});
