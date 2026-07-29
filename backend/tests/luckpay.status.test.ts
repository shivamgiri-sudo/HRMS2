/**
 * Luckpay completion-half endpoints: checkKycStatus, downloadKycDocument,
 * checkESignStatus, downloadESignDocument.
 *
 * Contracts are taken from the provider's production API documentation.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import axios from "axios";

vi.mock("../src/db/mysql.js", () => ({
  db: { execute: vi.fn().mockResolvedValue([[], []]) },
}));

import { luckpayClient } from "../src/modules/integrations/luckpay/luckpay.client.js";
import { resetLuckpayTokenCache } from "../src/modules/integrations/luckpay/luckpay.transport.js";

const BASE = "https://api-banking.luckpay.in/apibanking/api/v1";
const REF = { clientTransactionId: "CTN_5612", transactionId: "APIB178273887977XXXX" };
const token = () => ({ data: { data: { token: "access-token", expiresIn: 60 } } });

beforeEach(() => {
  resetLuckpayTokenCache();
  vi.spyOn(axios, "post").mockReset();
});
afterEach(() => vi.restoreAllMocks());

describe("checkKycStatus / checkESignStatus", () => {
  it("TC-LPS-01: posts both identifiers to the documented path", async () => {
    const post = vi.spyOn(axios, "post")
      .mockResolvedValueOnce(token())
      .mockResolvedValueOnce({ data: { status: "SUCCESS", transactionId: REF.transactionId } });

    await luckpayClient.checkKycStatus(REF);

    expect(post).toHaveBeenNthCalledWith(
      2,
      `${BASE}/checkKycStatus`,
      { clientTransactionId: "CTN_5612", transactionId: "APIB178273887977XXXX" },
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: expect.any(String),
          "X-Access-Token": "Bearer access-token",
        }),
      }),
    );
  });

  it("TC-LPS-02: maps provider success wording to completed", async () => {
    for (const s of ["SUCCESS", "Completed", "verified", "SIGNED"]) {
      resetLuckpayTokenCache();
      vi.spyOn(axios, "post").mockReset()
        .mockResolvedValueOnce(token())
        .mockResolvedValueOnce({ data: { status: s } });
      const r = await luckpayClient.checkKycStatus(REF);
      expect(r.state, `status=${s}`).toBe("completed");
    }
  });

  it("TC-LPS-03: maps failure and expiry wording", async () => {
    const cases: Array<[string, string]> = [
      ["FAILED", "failed"], ["Rejected", "failed"], ["EXPIRED", "expired"],
    ];
    for (const [provider, expected] of cases) {
      resetLuckpayTokenCache();
      vi.spyOn(axios, "post").mockReset()
        .mockResolvedValueOnce(token())
        .mockResolvedValueOnce({ data: { status: provider } });
      const r = await luckpayClient.checkESignStatus(REF);
      expect(r.state, `status=${provider}`).toBe(expected);
    }
  });

  it("TC-LPS-04: an unrecognised status stays pending, never terminal", async () => {
    // Guards against closing out a candidate's session on a status we don't know.
    vi.spyOn(axios, "post")
      .mockResolvedValueOnce(token())
      .mockResolvedValueOnce({ data: { status: "IN_PROGRESS_SOMETHING_NEW" } });

    const r = await luckpayClient.checkKycStatus(REF);
    expect(r.state).toBe("pending");
    expect(r.providerStatus).toBe("IN_PROGRESS_SOMETHING_NEW");
  });

  it("TC-LPS-05: reads status nested under data and echoes ids back", async () => {
    vi.spyOn(axios, "post")
      .mockResolvedValueOnce(token())
      .mockResolvedValueOnce({ data: { data: { kycStatus: "SUCCESS", transactionId: "APIB999", message: "KYC done" } } });

    const r = await luckpayClient.checkKycStatus(REF);
    expect(r.state).toBe("completed");
    expect(r.transactionId).toBe("APIB999");
    expect(r.clientTransactionId).toBe("CTN_5612");
    expect(r.message).toBe("KYC done");
  });
});

describe("downloadKycDocument / downloadESignDocument", () => {
  const pdf = Buffer.from("%PDF-1.4 signed agreement body padded out to clear the length floor", "utf8");

  it("TC-LPS-06: decodes an inline base64 document", async () => {
    vi.spyOn(axios, "post")
      .mockResolvedValueOnce(token())
      .mockResolvedValueOnce({ data: { document: pdf.toString("base64"), fileName: "signed.pdf", contentType: "application/pdf" } });

    const r = await luckpayClient.downloadESignDocument(REF);
    expect(r.buffer?.toString("utf8")).toBe(pdf.toString("utf8"));
    expect(r.fileName).toBe("signed.pdf");
    expect(r.url).toBeNull();
  });

  it("TC-LPS-07: strips a data: URI prefix before decoding", async () => {
    vi.spyOn(axios, "post")
      .mockResolvedValueOnce(token())
      .mockResolvedValueOnce({ data: { data: { fileBase64: `data:application/pdf;base64,${pdf.toString("base64")}` } } });

    const r = await luckpayClient.downloadKycDocument(REF);
    expect(r.buffer?.toString("utf8")).toBe(pdf.toString("utf8"));
  });

  it("TC-LPS-08: returns a URL when the provider sends a link instead of bytes", async () => {
    vi.spyOn(axios, "post")
      .mockResolvedValueOnce(token())
      .mockResolvedValueOnce({ data: { documentUrl: "https://cdn.luckpay.in/doc/abc.pdf" } });

    const r = await luckpayClient.downloadKycDocument(REF);
    expect(r.url).toBe("https://cdn.luckpay.in/doc/abc.pdf");
    expect(r.buffer).toBeNull();
  });

  it("TC-LPS-09: does not mistake a short status string for a document", async () => {
    vi.spyOn(axios, "post")
      .mockResolvedValueOnce(token())
      .mockResolvedValueOnce({ data: { status: "SUCCESS", message: "ok" } });

    const r = await luckpayClient.downloadESignDocument(REF);
    expect(r.buffer).toBeNull();
    expect(r.url).toBeNull();
  });

  it("TC-LPS-10: masks PII in the sanitized payload it returns", async () => {
    vi.spyOn(axios, "post")
      .mockResolvedValueOnce(token())
      .mockResolvedValueOnce({ data: { aadhaar: "123456789012", pan: "ABCDE1234F", status: "SUCCESS" } });

    const r = await luckpayClient.checkKycStatus(REF);
    const serialized = JSON.stringify(r.sanitized);
    expect(serialized).not.toContain("123456789012");
    expect(serialized).not.toContain("ABCDE1234F");
  });
});
