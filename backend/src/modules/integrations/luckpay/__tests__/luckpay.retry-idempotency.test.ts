import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Luckpay's business endpoints each carry a clientTransactionId that the vendor
 * records on first receipt. Retrying one after a 5xx therefore comes back as
 * "Transaction ID <uuid> already exists" (HTTP 409) — a live penny drop failed
 * exactly that way — and the first request may already have been billed.
 *
 * Only /auth/token is safe to repeat: no transaction id, it just mints a token.
 */

const post = vi.fn();
vi.mock("axios", () => ({ default: { post: (...a: unknown[]) => post(...a) } }));

const cfg = {
  baseUrl: "https://provider.test/api/v1",
  authUrl: "https://provider.test/api/v1/auth/token",
  basicToken: "dGVzdDp0ZXN0",
  clientId: "TEST01",
  timeoutMs: 5000,
};

function serverError(status: number) {
  return Object.assign(new Error(`Request failed with status code ${status}`), {
    response: { status, data: { message: "upstream blip" } },
  });
}

const tokenOk = { data: { data: { token: "access-token-value", expiresIn: 600 } } };

let transport: typeof import("../luckpay.transport.js");

beforeEach(async () => {
  post.mockReset();
  vi.resetModules();
  transport = await import("../luckpay.transport.js");
  transport.clearLuckpayTokenCache?.();
});

describe("luckpay retry idempotency", () => {
  it("retries the token endpoint on a 5xx — repeating it is harmless", async () => {
    post.mockRejectedValueOnce(serverError(503)).mockResolvedValueOnce(tokenOk);

    const token = await transport.getLuckpayAccessToken(cfg as never);

    expect(token).toBe("access-token-value");
    expect(post, "token call should have been retried once").toHaveBeenCalledTimes(2);
  });

  it("does NOT retry a business POST on a 5xx — a resend duplicates the transaction", async () => {
    post.mockResolvedValueOnce(tokenOk);           // auth
    post.mockRejectedValueOnce(serverError(502));  // business call fails once

    await expect(
      transport.luckpayPostJson(cfg as never, "/verifyPennyDrop", { clientTransactionId: "txn-1" }),
    ).rejects.toThrow();

    // 1 auth + exactly 1 business attempt. A second attempt would reach the
    // vendor with the same clientTransactionId and return "already exists".
    expect(post, "business call must be attempted exactly once").toHaveBeenCalledTimes(2);
    const businessCalls = post.mock.calls.filter(([url]) => String(url).includes("/verifyPennyDrop"));
    expect(businessCalls).toHaveLength(1);
  });

  it("does NOT retry a multipart business POST either (eSign upload)", async () => {
    post.mockResolvedValueOnce(tokenOk);
    post.mockRejectedValueOnce(serverError(500));

    await expect(
      transport.luckpayPostMultipart(cfg as never, "/eSignWithURL", {
        file: { buffer: Buffer.from("x"), filename: "d.pdf", contentType: "application/pdf" },
        request: { clientTransactionId: "txn-2" },
      } as never),
    ).rejects.toThrow();

    const businessCalls = post.mock.calls.filter(([url]) => String(url).includes("/eSignWithURL"));
    expect(businessCalls).toHaveLength(1);
  });
});
