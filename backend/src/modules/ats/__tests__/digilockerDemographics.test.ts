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

describe("a tokenized/masked response is discarded, not partially trusted", () => {
  // Real production capture (Deepak Gupta, CND-MTTRXJRC, candidate_id
  // 16914743-c353-46c7-b373-6ca823b05bde, 2026-09-11 08:30:43): a second
  // DIGILOCKER_STATUS call for the same transaction, 2 seconds after a clean
  // one, came back with name/dob/id_number/address all replaced by
  // provider-side masked tokens instead of the real values.
  const TOKENIZED_RESPONSE = {
    data: {
      documentList: [
        {
          dob: "7QN3Hr7vaY8hGWxB18uDF_XXwPYQ5Hlx4nEntpHffd2xpIN9Uuc",
          name: "noBqoCQGhVW-_ex-QSexAUnmgYkoFCgksXilA4Zfq7YfrkirpiRo9A",
          gender: "M",
          id_number: "9xJ2KtIZi-vKd1FVX8KUJkvSd3pKUcuwcPKhdrr9bVjFxCRSwozy0A",
          document_type: "AADHAAR",
        },
      ],
      current_address_details: {
        state: "Delhi",
        address: "K84ts_cafkc1oSEdKRP4BTAu-0w8SUHfnOc9OCX91b2CfEyWJ7HsK7ltbCHZuEQd1iVaWKKa2CRmmR1m",
        pincode: "110008",
        district_or_city: "Central Delhi",
        locality_or_post_office: "Baba Farid Puri",
      },
    },
  };

  it("returns empty demographics rather than writing a scrambled name", () => {
    const r = extractDigilockerDemographics(TOKENIZED_RESPONSE);
    expect(r.fullName).toBeNull();
    expect(r.dateOfBirth).toBeNull();
    expect(r.currentAddress).toBeNull();
  });

  it("still reads a real name that happens to be long, since it has whitespace", () => {
    const r = extractDigilockerDemographics({
      data: { documentList: [{ name: "Venkata Naga Sai Ramakrishna Prasad", document_type: "AADHAAR" }] },
    });
    expect(r.fullName).toBe("Venkata Naga Sai Ramakrishna Prasad");
  });
});
