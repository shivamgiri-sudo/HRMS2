/**
 * Luckpay completion-half endpoints: checkKycStatus, downloadKycDocument,
 * checkESignStatus, downloadESignDocument.
 *
 * Payloads below are taken verbatim from the provider's published Postman
 * collection (LP Fintech "Verification APIs"), not invented. The response shapes
 * are awkward in ways that broke the first implementation, so they are pinned
 * here:
 *   - the transaction id is `gatewayId`, not `transactionId`
 *   - eSign's data.status is "SUCCESS" both at initiate and at completion; the
 *     real state is esignDetails.agreement_status
 *   - documents are nested, and the KYC one is base64 twice over
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
const token = () => ({ data: { data: { token: "access-token", expiry: "Thu Jan 29 11:38:18 IST 2026" } } });

const PDF = Buffer.from("%PDF-1.6\nfake signed agreement body for testing purposes", "utf8");

beforeEach(() => {
  resetLuckpayTokenCache();
  vi.spyOn(axios, "post").mockReset();
});
afterEach(() => vi.restoreAllMocks());

describe("DigiLocker status (checkKycStatus)", () => {
  it("TC-LPS-01: posts both identifiers to the documented path", async () => {
    const post = vi.spyOn(axios, "post")
      .mockResolvedValueOnce(token())
      .mockResolvedValueOnce({ data: { code: "200", status: "Success", data: { details: { status: "approved" } } } });

    await luckpayClient.checkKycStatus(REF);

    expect(post).toHaveBeenNthCalledWith(
      2,
      `${BASE}/checkKycStatus`,
      { clientTransactionId: "CTN_5612", transactionId: "APIB178273887977XXXX" },
      expect.objectContaining({
        headers: expect.objectContaining({ "X-Access-Token": "Bearer access-token" }),
      }),
    );
  });

  it("TC-LPS-02: 'approved' completes; 'requested' stays pending", async () => {
    for (const [providerStatus, expected] of [["approved", "completed"], ["requested", "pending"]] as const) {
      resetLuckpayTokenCache();
      vi.spyOn(axios, "post").mockReset()
        .mockResolvedValueOnce(token())
        .mockResolvedValueOnce({ data: { code: "200", status: "Success", data: { gatewayId: "APIB1", details: { status: providerStatus } } } });
      const r = await luckpayClient.checkKycStatus(REF);
      expect(r.state, `details.status=${providerStatus}`).toBe(expected);
    }
  });

  it("TC-LPS-03: envelope status 'Success' alone must not complete a pending KYC", async () => {
    // The envelope reports whether the API call worked, not whether the
    // candidate finished. Reading it would approve every in-flight session.
    vi.spyOn(axios, "post")
      .mockResolvedValueOnce(token())
      .mockResolvedValueOnce({ data: { code: "200", status: "Success", message: "DigiLocker status checked successfully", data: { gatewayId: "APIB1", details: { status: "requested" } } } });

    const r = await luckpayClient.checkKycStatus(REF);
    expect(r.state).toBe("pending");
  });

  it("TC-LPS-04: an unrecognised status stays pending, never terminal", async () => {
    vi.spyOn(axios, "post")
      .mockResolvedValueOnce(token())
      .mockResolvedValueOnce({ data: { data: { details: { status: "SOMETHING_NEW" } } } });

    const r = await luckpayClient.checkKycStatus(REF);
    expect(r.state).toBe("pending");
    expect(r.providerStatus).toBe("SOMETHING_NEW");
  });

  it("TC-LPS-05: reads gatewayId as the transaction id", async () => {
    vi.spyOn(axios, "post")
      .mockResolvedValueOnce(token())
      .mockResolvedValueOnce({ data: { data: { clientTransactionId: "txn-1", gatewayId: "APIB1772105890443001", details: { status: "approved" } } } });

    const r = await luckpayClient.checkKycStatus(REF);
    expect(r.transactionId).toBe("APIB1772105890443001");
    expect(r.clientTransactionId).toBe("txn-1");
  });
});

describe("eSign status (checkESignStatus)", () => {
  const esignBody = (agreementStatus: string, partyStatus: string) => ({
    data: {
      code: "200",
      status: "Success",
      data: {
        clientTransactionId: "tx-12",
        gatewayId: "DID09078224141094X4Z61FOLG9NP5N",
        // Always "SUCCESS" — at initiate AND at completion.
        status: "SUCCESS",
        responseMessage: "Verification completed successful",
        esignDetails: {
          agreement_status: agreementStatus,
          file_name: "dummy_esign_agreement.pdf",
          signing_parties: [{ status: partyStatus, type: "self", signature_type: "electronic" }],
        },
      },
    },
  });

  it("TC-LPS-06: an unsigned request is NOT reported as completed", async () => {
    // data.status is "SUCCESS" here even though nobody has signed. Trusting it
    // would mark the document signed the moment it was sent out, and trigger a
    // download of a file that does not exist yet.
    vi.spyOn(axios, "post")
      .mockResolvedValueOnce(token())
      .mockResolvedValueOnce(esignBody("requested", "requested"));

    const r = await luckpayClient.checkESignStatus(REF);
    expect(r.state).toBe("pending");
    expect(r.providerStatus).toBe("requested");
  });

  it("TC-LPS-07: agreement_status 'completed' completes", async () => {
    vi.spyOn(axios, "post")
      .mockResolvedValueOnce(token())
      .mockResolvedValueOnce(esignBody("completed", "signed"));

    const r = await luckpayClient.checkESignStatus(REF);
    expect(r.state).toBe("completed");
    expect(r.transactionId).toBe("DID09078224141094X4Z61FOLG9NP5N");
  });

  it("TC-LPS-08: expiry and rejection map to terminal states", async () => {
    for (const [agreement, expected] of [["expired", "expired"], ["rejected", "failed"]] as const) {
      resetLuckpayTokenCache();
      vi.spyOn(axios, "post").mockReset()
        .mockResolvedValueOnce(token())
        .mockResolvedValueOnce(esignBody(agreement, agreement));
      const r = await luckpayClient.checkESignStatus(REF);
      expect(r.state, `agreement_status=${agreement}`).toBe(expected);
    }
  });
});

describe("initiate calls expose gatewayId for later polling", () => {
  it("TC-LPS-09: DigiLocker initiate returns gatewayId as providerReferenceId", async () => {
    vi.spyOn(axios, "post")
      .mockResolvedValueOnce(token())
      .mockResolvedValueOnce({
        data: {
          code: "200", status: "Success",
          data: { clientTransactionId: "6007980900", gatewayId: "APIB1772109515416003", status: "requested" },
        },
      });

    const r = await luckpayClient.initiateDigilockerWithUrl({
      clientTransactionId: "6007980900", customerName: "John", mobileNumber: "8907100000",
    });
    // Without this the completion half has no id to poll with and silently
    // falls back to our own clientTransactionId, which the provider rejects.
    expect(r.providerReferenceId).toBe("APIB1772109515416003");
  });
});

describe("live production payloads (captured 2026-07-29, account LPM14)", () => {
  // These bodies are copies of real responses from api-banking.luckpay.in.
  // They differ from the published Postman samples in two ways that broke the
  // first implementation: the DigiLocker link lives at
  // data.details.authorizationUrl (absent from the docs entirely), and `status`
  // carries the lifecycle ("PENDING") while `responseMessage` carries the API
  // outcome ("SUCCESS") — the reverse of the documented samples.

  it("TC-LPS-14: DigiLocker initiate returns details.authorizationUrl as the candidate link", async () => {
    vi.spyOn(axios, "post")
      .mockResolvedValueOnce(token())
      .mockResolvedValueOnce({
        data: {
          code: "200", status: "Success", message: "Verification completed successfully",
          data: {
            clientTransactionId: "4164564",
            gatewayId: "APIB1785307893997014",
            status: "PENDING",
            responseMessage: "SUCCESS",
            details: {
              status: "PENDING",
              customerIdentifier: "8934071154",
              authorizationUrl: "https://digilocker-prod.digitap.work?token=eyJhbGciOiJSUzI1NiJ9.abc",
              accessToken: { validTill: "2026-07-29T12:31:34", createdAt: "2026-07-29T12:21:34" },
            },
          },
        },
      });

    const r = await luckpayClient.initiateDigilockerWithUrl({
      clientTransactionId: "4164564", customerName: "Aman Jaiswal", mobileNumber: "8934071154",
    });

    expect(r.verificationUrl).toBe("https://digilocker-prod.digitap.work?token=eyJhbGciOiJSUzI1NiJ9.abc");
    expect(r.providerReferenceId).toBe("APIB1785307893997014");
    // responseMessage "SUCCESS" must not be mistaken for a completed session.
    expect(r.status).toBe("PENDING");
  });

  it("TC-LPS-15: eSign initiate returns data.redirect_url and gatewayId", async () => {
    vi.spyOn(axios, "post")
      .mockResolvedValueOnce(token())
      .mockResolvedValueOnce({
        data: {
          code: "200", status: "Success", message: "eSign request initiated successfully",
          data: {
            clientTransactionId: "TXN-ESIGN-4134186",
            gatewayId: "APIB1785307958630015",
            status: "PENDING",
            responseMessage: "SUCCESS",
            esignDetails: { file_name: "agreement.pdf", self_signed: false, no_of_pages: 0 },
            redirect_url: "https://api.trusthub.in/api/aadhaar-e-sign/redirect/c6fa615f-0ab7-4758-99d1-dcd3942d54a8",
          },
        },
      });

    const r = await luckpayClient.initiateEsignWithUrl({
      filePath: __filename,
      request: { clientTransactionId: "TXN-ESIGN-4134186", signedBy: "John Doe", location: "Mumbai", reason: "Signing Agreement" },
    });

    expect(r.verificationUrl).toBe("https://api.trusthub.in/api/aadhaar-e-sign/redirect/c6fa615f-0ab7-4758-99d1-dcd3942d54a8");
    expect(r.providerReferenceId).toBe("APIB1785307958630015");
  });

  it("TC-LPS-16: a PENDING eSign with no agreement_status is not treated as signed", async () => {
    // The live initiate response carries no esignDetails.agreement_status at
    // all, so the fallback chain lands on status="PENDING".
    vi.spyOn(axios, "post")
      .mockResolvedValueOnce(token())
      .mockResolvedValueOnce({
        data: {
          data: {
            gatewayId: "APIB1785307958630015", status: "PENDING", responseMessage: "SUCCESS",
            esignDetails: { file_name: "agreement.pdf", self_signed: false, no_of_pages: 0 },
          },
        },
      });

    const r = await luckpayClient.checkESignStatus(REF);
    expect(r.state).toBe("pending");
  });
});

describe("document download", () => {
  it("TC-LPS-10: eSign document reads esignDownloadDetails.file", async () => {
    vi.spyOn(axios, "post")
      .mockResolvedValueOnce(token())
      .mockResolvedValueOnce({
        data: { code: "200", status: "Success", data: { esignDownloadDetails: { file: PDF.toString("base64") } } },
      });

    const r = await luckpayClient.downloadESignDocument(REF);
    expect(r.buffer?.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("TC-LPS-11: KYC document unwraps the double-base64 JSON envelope", async () => {
    // details.file is base64 of {"file_in_base64": "<base64 pdf>", ...}
    const wrapper = Buffer.from(JSON.stringify({
      file_in_base64: PDF.toString("base64"),
      size_in_bytes: PDF.length,
      file_name: "aadhaar.pdf",
      file_type: "application/pdf",
    }), "utf8").toString("base64");

    vi.spyOn(axios, "post")
      .mockResolvedValueOnce(token())
      .mockResolvedValueOnce({ data: { code: "200", status: "Success", data: { details: { file: wrapper } } } });

    const r = await luckpayClient.downloadKycDocument(REF);
    expect(r.buffer?.subarray(0, 5).toString()).toBe("%PDF-");
    expect(r.fileName).toBe("aadhaar.pdf");
    expect(r.contentType).toBe("application/pdf");
  });

  it("TC-LPS-12: does not mistake a short status string for a document", async () => {
    vi.spyOn(axios, "post")
      .mockResolvedValueOnce(token())
      .mockResolvedValueOnce({ data: { code: "200", status: "Success", message: "ok" } });

    const r = await luckpayClient.downloadESignDocument(REF);
    expect(r.buffer).toBeNull();
    expect(r.url).toBeNull();
  });

  it("TC-LPS-13: masks PII in the sanitized payload", async () => {
    vi.spyOn(axios, "post")
      .mockResolvedValueOnce(token())
      .mockResolvedValueOnce({ data: { data: { details: { status: "approved", customerIdentifier: "8375854251" } } } });

    const r = await luckpayClient.checkKycStatus(REF);
    expect(JSON.stringify(r.sanitized)).not.toContain("8375854251");
  });
});
