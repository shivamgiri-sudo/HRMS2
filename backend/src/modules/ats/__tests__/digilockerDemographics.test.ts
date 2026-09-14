/**
 * Reading a completed DigiLocker session's demographics.
 *
 * The fixture below is a real production response (Aryan Singh, session
 * completed 2026-08-03 19:09), reduced only by eliding the base64 photo. It is
 * used verbatim because the whole point is that the shape is the provider's,
 * not ours, and a hand-written sample would only restate my assumptions.
 *
 * I had reported this data as unavailable. The stored artefact is a PDF whose
 * text sits behind a subset-font CMap, and repeated attempts to read it
 * returned nothing — from which I wrongly concluded there was nothing to read.
 * The JSON response had been stored the whole time.
 */
import { describe, it, expect } from "vitest";
import { extractDigilockerDemographics } from "../digilocker-demographics.js";

const PRODUCTION_RESPONSE = {
  code: "200",
  data: {
    type: "AADHAAR",
    image: "<base64 photo elided>",
    status: "SUCCESS",
    gatewayId: "APIB1785763760806140",
    documentList: [
      {
        dob: "15-03-2005",
        name: "Aryan Singh",
        gender: "M",
        id_number: "xxxxxxxx5960",
        document_type: "AADHAAR",
        id_proof_type: "AADHAAR",
      },
    ],
    responseMessage: "SUCCESS",
    clientTransactionId: "95e9f57e-1508-4b21-87db-3cf1c9ba7207",
    current_address_details: {
      state: "Madhya Pradesh",
      address: "242 kh mukhtiyar ganj ward no 6, mukhtiyar ganj railway crasing, satna nagar",
      pincode: "485001",
      district_or_city: "Satna",
      locality_or_post_office: "MP nagar sectar no 2 gali no 2",
    },
    permanent_address_details: {
      state: "Madhya Pradesh",
      address: "242 kh mukhtiyar ganj ward no 6, mukhtiyar ganj railway crasing, satna nagar",
      pincode: "485001",
      district_or_city: "Satna",
      locality_or_post_office: "MP nagar sectar no 2 gali no 2",
    },
  },
};

describe("extractDigilockerDemographics on a real response", () => {
  const d = extractDigilockerDemographics(PRODUCTION_RESPONSE);

  it("reads the name", () => expect(d.fullName).toBe("Aryan Singh"));

  it("converts the date of birth to the format every column here stores", () => {
    // The provider sends dd-mm-yyyy; storing that verbatim would be read as
    // a different date entirely.
    expect(d.dateOfBirth).toBe("2005-03-15");
  });

  it("normalises the single-letter gender", () => expect(d.gender).toBe("Male"));

  it("takes only the last four digits of the Aadhaar", () => {
    // The provider already masks it; nothing here should ever hold more.
    expect(d.aadhaarLast4).toBe("5960");
  });

  it("reads both addresses in full", () => {
    expect(d.currentAddress?.district).toBe("Satna");
    expect(d.currentAddress?.state).toBe("Madhya Pradesh");
    expect(d.currentAddress?.pincode).toBe("485001");
    expect(d.currentAddress?.locality).toBe("MP nagar sectar no 2 gali no 2");
    expect(d.permanentAddress?.pincode).toBe("485001");
  });

  it("works when handed the inner data object instead of the envelope", () => {
    // The response is stored in more than one place and not wrapped identically.
    expect(extractDigilockerDemographics(PRODUCTION_RESPONSE.data).fullName).toBe("Aryan Singh");
  });
});

describe("it never fails a candidate's onboarding", () => {
  for (const [label, input] of [
    ["null", null],
    ["a string", "not json"],
    ["an empty object", {}],
    ["no documentList", { data: { type: "AADHAAR" } }],
    ["an empty documentList", { data: { documentList: [] } }],
  ] as const) {
    it(`returns empty for ${label} rather than throwing`, () => {
      const r = extractDigilockerDemographics(input);
      expect(r.fullName).toBeNull();
      expect(r.currentAddress).toBeNull();
    });
  }

  it("ignores a non-Aadhaar document, which carries no address or DOB", () => {
    const r = extractDigilockerDemographics({
      data: { documentList: [{ name: "Someone", document_type: "PAN" }] },
    });
    expect(r.fullName).toBeNull();
  });

  it("survives a malformed date rather than storing a wrong one", () => {
    const r = extractDigilockerDemographics({
      data: { documentList: [{ name: "X", dob: "not-a-date", document_type: "AADHAAR" }] },
    });
    expect(r.fullName).toBe("X");
    expect(r.dateOfBirth).toBeNull();
  });
});
