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
import axios from "axios";

// Must run before the module imports below: config/env.ts parses process.env at import time,
// and assertLuckpayEnabled() throws "Luckpay provider is disabled." (503) before any transport
// logic runs. LUCKPAY_PROVIDER_ENABLED defaults to "false" and .env.test sets no LUCKPAY keys,
// so without this every test here failed on the config gate and never reached the binary
// decoding it exists to verify.
//
// Same block, and the same reason, as tests/luckpay.status.test.ts — which is why that file
// passes and this one did not. Scoped to this file rather than .env.test on purpose: enabling
// the provider globally would change the environment for all 536 test files, and env.ts:287
// treats LUCKPAY_PROVIDER_ENABLED=true without LUCKPAY_WEBHOOK_SECRET as FATAL, so the secret
// below is required, not decorative.
//
// Credentials fall through to these values because the global db mock in tests/setup.ts
// returns no org_settings rows; luckpay.config.ts resolves org_settings first, env second.
vi.hoisted(() => {
  process.env.LUCKPAY_PROVIDER_ENABLED = "true";
  process.env.LUCKPAY_ENV = "production";
  process.env.LUCKPAY_BASIC_TOKEN = process.env.LUCKPAY_BASIC_TOKEN || "test-basic-token";
  process.env.LUCKPAY_CLIENT_ID = process.env.LUCKPAY_CLIENT_ID || "TESTCLIENT";
  process.env.LUCKPAY_WEBHOOK_SECRET = process.env.LUCKPAY_WEBHOOK_SECRET || "test-webhook-secret";
});

import { luckpayClient } from "../src/modules/integrations/luckpay/luckpay.client.js";
import { resetLuckpayTokenCache } from "../src/modules/integrations/luckpay/luckpay.transport.js";

/**
 * config/env.ts parses process.env through zod ONCE, at import time, and exports the
 * frozen result. Assigning process.env.LUCKPAY_* from beforeEach therefore changes
 * nothing: the module graph — including this file's imports above — is already loaded
 * by the time any hook runs.
 *
 * So these tests passed only on a machine whose .env happened to define the Luckpay
 * credentials, and failed everywhere clean. `.env.test` is not tracked (only
 * .env.test.example), so CI could never satisfy them: downloadESignDocument resolves
 * through digilockerConfig(), which calls assertLuckpayEnabled + assertLuckpayCredentials
 * and threw "Luckpay provider is disabled." before a single byte was exercised.
 *
 * Mocking the env module supplies those values at import time. vi.mock is scoped to this
 * file, so no other Luckpay suite is affected. The DB path is not involved — tests/setup.ts
 * stubs db.execute to return empty, so resolveLuckpayConfig falls through to env for
 * baseUrl, basicToken, clientId and enabled.
 */
vi.mock("../src/config/env.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/config/env.js")>();
  return {
    ...actual,
    env: {
      ...actual.env,
      LUCKPAY_PROVIDER_ENABLED: true,
      LUCKPAY_BASE_URL: "https://api-banking.luckpay.in/apibanking/api/v1",
      LUCKPAY_BASIC_TOKEN: "test-token",
      LUCKPAY_CLIENT_ID: "test-client",
    },
  };
});

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
