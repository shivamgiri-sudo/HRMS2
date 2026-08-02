/**
 * /downloadESignDocument answers with a RAW PDF body, not a JSON envelope.
 *
 * Captured from production 2026-08-01 for a document the provider reported as
 * SIGNED:
 *   HTTP 200
 *   content-type: application/pdf
 *   body: 79582 bytes, first bytes 255044462d312e37 ("%PDF-1.7")
 *
 * The client fetched this through luckpayPostJson, so axios decoded 79KB of
 * binary as UTF-8 and destroyed it. Every eSign retrieval returned zero usable
 * bytes while the signed document was sitting there, downloadable — an employee
 * completed a genuine Aadhaar eSign and HRMS stored nothing.
 *
 * The JSON envelope path still has to work, because the KYC download does use it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Must run BEFORE the imports below, which is what vi.hoisted is for.
 *
 * config/env.ts builds a frozen `env` object at module load from a zod-parsed snapshot of
 * process.env, and normalizeLuckpayConfig reads `env.LUCKPAY_PROVIDER_ENABLED` from it. Any
 * assignment in beforeEach happens long after that object exists, so the client resolved
 * enabled: false and every test in this file threw "Luckpay provider is disabled." before
 * reaching a single assertion.
 *
 * These five tests were committed alongside the fix they cover (38a39e55) and have never
 * passed — they were not in the failure baseline because the baseline predates them. Nothing
 * about the product is wrong here; the suite simply never set the switch.
 *
 * LUCKPAY_WEBHOOK_SECRET is set too: env.ts treats ENABLED=true without it as a fatal
 * misconfiguration.
 */
vi.hoisted(() => {
  process.env.LUCKPAY_PROVIDER_ENABLED = "true";
  process.env.LUCKPAY_WEBHOOK_SECRET ||= "test-webhook-secret-at-least-32-characters";
  process.env.LUCKPAY_BASE_URL ||= "https://api-banking.luckpay.in/apibanking/api/v1";
  process.env.LUCKPAY_CLIENT_ID ||= "test-client";
  process.env.LUCKPAY_BASIC_TOKEN ||= "test-token";
});

import axios from "axios";
import { luckpayClient } from "../src/modules/integrations/luckpay/luckpay.client.js";
import { resetLuckpayTokenCache } from "../src/modules/integrations/luckpay/luckpay.transport.js";

const REF = { clientTransactionId: "joining-doc-abc", transactionId: "APIB1785567457469073" };

/** A small but structurally real PDF, including high bytes that UTF-8 would mangle. */
const PDF = Buffer.concat([
  Buffer.from("%PDF-1.7\n%", "latin1"),
  Buffer.from([0x81, 0x81, 0x81, 0x81]),
  Buffer.from("\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n", "latin1"),
]);

function token() {
  return { data: { data: { access_token: "tkn", token_type: "Bearer", expires_in: 3600 } } };
}

beforeEach(() => {
  // Without this the cached token survives between tests, so the FIRST mocked
  // response gets consumed by the download call instead of the auth call and the
  // PDF mock is never reached.
  resetLuckpayTokenCache();
  process.env.LUCKPAY_BASE_URL ||= "https://api-banking.luckpay.in/apibanking/api/v1";
  process.env.LUCKPAY_CLIENT_ID ||= "test-client";
  process.env.LUCKPAY_BASIC_TOKEN ||= "test-token";
});
afterEach(() => vi.restoreAllMocks());

describe("downloadESignDocument with a raw PDF body", () => {
  it("returns the bytes intact when the provider answers application/pdf", async () => {
    vi.spyOn(axios, "post")
      .mockResolvedValueOnce(token())
      .mockResolvedValueOnce({ data: PDF, headers: { "content-type": "application/pdf" } });

    const r = await luckpayClient.downloadESignDocument(REF);

    expect(r.buffer).not.toBeNull();
    expect(r.buffer!.length).toBe(PDF.length);
    expect(r.buffer!.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    // Byte-for-byte: this is what UTF-8 decoding silently destroyed.
    expect(Buffer.compare(r.buffer!, PDF)).toBe(0);
    expect(r.contentType).toContain("pdf");
  });

  it("requests the body as bytes rather than letting axios parse it", async () => {
    const post = vi.spyOn(axios, "post")
      .mockResolvedValueOnce(token())
      .mockResolvedValueOnce({ data: PDF, headers: { "content-type": "application/pdf" } });

    await luckpayClient.downloadESignDocument(REF);

    const downloadCall = post.mock.calls.find(([url]) => String(url).includes("/downloadESignDocument"));
    expect(downloadCall, "the download endpoint must be called").toBeTruthy();
    expect((downloadCall![2] as { responseType?: string }).responseType).toBe("arraybuffer");
  });

  it("trusts the magic bytes even when the content-type header is wrong", async () => {
    vi.spyOn(axios, "post")
      .mockResolvedValueOnce(token())
      .mockResolvedValueOnce({ data: PDF, headers: { "content-type": "text/plain" } });

    const r = await luckpayClient.downloadESignDocument(REF);
    expect(r.buffer?.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });

  it("still handles the JSON envelope shape", async () => {
    // The KYC download genuinely uses this shape, so the fallback must survive.
    vi.spyOn(axios, "post")
      .mockResolvedValueOnce(token())
      .mockResolvedValueOnce({
        data: { code: "200", status: "Success", data: { esignDownloadDetails: { file: PDF.toString("base64") } } },
        headers: { "content-type": "application/json" },
      });

    const r = await luckpayClient.downloadESignDocument(REF);
    expect(r.buffer?.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });

  it("reports nothing retrieved when the body is neither a document nor usable JSON", async () => {
    vi.spyOn(axios, "post")
      .mockResolvedValueOnce(token())
      .mockResolvedValueOnce({ data: Buffer.from("not a document", "utf8"), headers: { "content-type": "text/plain" } });

    const r = await luckpayClient.downloadESignDocument(REF);
    expect(r.buffer).toBeNull();
  });
});
