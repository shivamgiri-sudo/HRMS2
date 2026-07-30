import { describe, it, expect } from "vitest";
import { luckpayAuthHeader } from "../src/modules/integrations/luckpay/luckpay.transport.js";

/**
 * Regression guard for the Luckpay business-endpoint Authorization header.
 *
 * Sending the RAW client id ("LPM14") made the gateway's base64 decode fail, so
 * every PAN / penny-drop / UAN / DigiLocker call was rejected with
 *   401 VAL_EXT_001 "Invalid Base64 encoding"
 * even though /auth/token succeeded and the payload was valid. Verified against
 * the live provider: raw id -> VAL_EXT_001; base64(id) -> ID_001 (payload
 * validation), i.e. authentication passed.
 */
describe("luckpayAuthHeader", () => {
  it("base64-encodes a raw client id", () => {
    expect(luckpayAuthHeader("LPM14")).toBe("TFBNMTQ=");
  });

  it("matches the vendor documentation sample", () => {
    // Docs show `Authorization: TFBNNA==` for client id LPM4.
    expect(luckpayAuthHeader("LPM4")).toBe("TFBNNA==");
    expect(Buffer.from("TFBNNA==", "base64").toString("utf8")).toBe("LPM4");
  });

  it("never emits a raw client id — the exact bug that broke every call", () => {
    expect(luckpayAuthHeader("LPM14")).not.toBe("LPM14");
  });

  it("passes through a value an operator already pasted in base64 form", () => {
    expect(luckpayAuthHeader("TFBNMTQ=")).toBe("TFBNMTQ=");
  });

  it("strips whitespace before encoding", () => {
    expect(luckpayAuthHeader("  LPM14 \n")).toBe("TFBNMTQ=");
  });

  it("produces a decodable header for arbitrary client ids", () => {
    for (const id of ["LPM14", "LPM4", "ABC123", "X"]) {
      expect(Buffer.from(luckpayAuthHeader(id), "base64").toString("utf8")).toBe(id);
    }
  });
});
