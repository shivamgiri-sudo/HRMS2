import { describe, expect, it } from "vitest";
import { addressWithCity, resolveBillingParty } from "../client-billing-party.js";

describe("resolveBillingParty", () => {
  const row = {
    company_name: "Onfido Ltd", billing_client_name: "Onfido Limited",
    service_tax_no: "09AAACM1234B1ZC", vendor_gst_no: "27aabco1234d1z5", vendor_gst_state: "Delhi", vendor_state_code: "7",
    hsn_code: null, sac_code: "998599",
    bill_to_address1: "Tower B, 5th Floor", bill_to_address2: "BKC", bill_to_city: "Mumbai", bill_to_pincode: "400051",
    ship_to_address1: null, branch_state_code: "09", branch_gstin: "09AAACM9999Z1ZZ",
  };
  it("state, place of supply and code follow the client GSTIN, not the typed fields", () => {
    const p = resolveBillingParty(row);
    expect(p).toMatchObject({ clientGstin: "27AABCO1234D1Z5", clientStateCode: "27", clientStateName: "MAHARASHTRA", placeOfSupply: "MAHARASHTRA (27)" });
    expect(p.warnings.join(" ")).toMatch(/state code 07 does not match the client GSTIN \(27\)/);
    expect(p.warnings.join(" ")).toMatch(/"Delhi" differs/);
  });
  it("our GSTIN, PAN, city / PIN appended, ship-to falls back to bill-to", () => {
    const p = resolveBillingParty(row);
    expect(p.ourGstin).toBe("09AAACM1234B1ZC");
    expect(p.pan).toBe("AAACM1234B");
    expect(p.billTo).toEqual(["Tower B, 5th Floor", "BKC", "Mumbai - 400051"]);
    expect(p.shipTo).toEqual(p.billTo);
    expect(p.clientName).toBe("Onfido Limited");
  });
  it("falls back to the branch GSTIN and the typed code when there is no client GSTIN; flags blanks", () => {
    const p = resolveBillingParty({ ...row, service_tax_no: "", vendor_gst_no: "", bill_to_address1: "", bill_to_address2: "", sac_code: "" });
    expect(p.ourGstin).toBe("09AAACM9999Z1ZZ");
    expect(p.clientStateCode).toBe("07");
    expect(p.clientStateName).toBe("DELHI");
    expect(p.warnings.join(" ")).toMatch(/Client GSTIN is not recorded/);
    expect(p.warnings.join(" ")).toMatch(/Bill To address is blank/);
    expect(p.warnings.join(" ")).toMatch(/SAC \/ HSN/);
  });
  it("does not repeat a city / PIN already written in the lines", () => {
    expect(addressWithCity(["Plot 5, Noida 201301"], "Noida", "201 301")).toEqual(["Plot 5, Noida 201301"]);
    expect(addressWithCity([], "Noida", "201301")).toEqual([]);
  });
});
