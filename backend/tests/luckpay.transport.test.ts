/**
 * Luckpay shared transport + config resolver.
 *
 * Covers the four defects the consolidation fixed:
 *  - auth URL derived from the resolved base (a mismatched LUCKPAY_AUTH_URL is ignored)
 *  - token cache keyed by baseUrl+clientId
 *  - response fields found at both the envelope and the nested `data` level
 *  - DigiLocker/eSign falling back to the core credentials (the production case)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import axios from "axios";

vi.mock("../src/db/mysql.js", () => ({
  db: { execute: vi.fn().mockResolvedValue([[], []]) },
}));

import {
  getLuckpayAccessToken,
  luckpayPostJson,
  pickLuckpayField,
  normalizeLuckpayConfig,
  resolveAuthUrl,
  resetLuckpayTokenCache,
  assertLuckpayCredentials,
  type LuckpayResponse,
} from "../src/modules/integrations/luckpay/luckpay.transport.js";
import { resolveLuckpayConfigFrom } from "../src/modules/integrations/luckpay/luckpay.config.js";

const PROD = "https://api-banking.luckpay.in/apibanking/api/v1";
const STAGING = "https://staging-api-banking.luckpay.in/apibanking/api/v1";

const cfg = (over: Partial<{ baseUrl: string; basicToken: string; clientId: string }> = {}) =>
  normalizeLuckpayConfig({
    baseUrl: over.baseUrl ?? PROD,
    basicToken: over.basicToken ?? "basic-token",
    clientId: over.clientId ?? "LPM14",
    enabled: true,
  });

const tokenResponse = (token = "access-token", expiresIn = 60) => ({
  data: { data: { token, expiresIn } },
});

beforeEach(() => {
  resetLuckpayTokenCache();
  vi.spyOn(axios, "post").mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Luckpay auth URL resolution", () => {
  it("TC-LP-01: derives the auth URL from the resolved base URL", () => {
    expect(resolveAuthUrl(cfg())).toBe(`${PROD}/auth/token`);
  });

  it("TC-LP-02: ignores LUCKPAY_AUTH_URL when it points at a different host", () => {
    // .env may legitimately still carry a staging auth URL; a production base
    // must never mint its token from it.
    const original = process.env.LUCKPAY_AUTH_URL;
    process.env.LUCKPAY_AUTH_URL = `${STAGING}/auth/token`;
    try {
      expect(resolveAuthUrl(cfg({ baseUrl: PROD }))).toBe(`${PROD}/auth/token`);
    } finally {
      if (original === undefined) delete process.env.LUCKPAY_AUTH_URL;
      else process.env.LUCKPAY_AUTH_URL = original;
    }
  });

  it("TC-LP-03: posts the auth request with an Authorization header only", async () => {
    const post = vi.spyOn(axios, "post").mockResolvedValueOnce(tokenResponse());

    await getLuckpayAccessToken(cfg());

    expect(post).toHaveBeenNthCalledWith(
      1,
      `${PROD}/auth/token`,
      undefined,
      expect.objectContaining({ headers: { Authorization: "Basic basic-token" } }),
    );
  });
});

describe("Luckpay token cache", () => {
  it("TC-LP-04: reuses a cached token for the same baseUrl + clientId", async () => {
    const post = vi.spyOn(axios, "post").mockResolvedValue(tokenResponse());

    await getLuckpayAccessToken(cfg());
    await getLuckpayAccessToken(cfg());

    expect(post).toHaveBeenCalledTimes(1);
  });

  it("TC-LP-05: mints separate tokens for different client ids", async () => {
    const post = vi.spyOn(axios, "post")
      .mockResolvedValueOnce(tokenResponse("token-a"))
      .mockResolvedValueOnce(tokenResponse("token-b"));

    const a = await getLuckpayAccessToken(cfg({ clientId: "LPM14" }));
    const b = await getLuckpayAccessToken(cfg({ clientId: "LPM153" }));

    expect(post).toHaveBeenCalledTimes(2);
    expect(a).toBe("token-a");
    expect(b).toBe("token-b");
  });

  it("TC-LP-06: resetLuckpayTokenCache forces a fresh token", async () => {
    const post = vi.spyOn(axios, "post").mockResolvedValue(tokenResponse());

    await getLuckpayAccessToken(cfg());
    resetLuckpayTokenCache();
    await getLuckpayAccessToken(cfg());

    expect(post).toHaveBeenCalledTimes(2);
  });
});

describe("Luckpay request headers", () => {
  it("TC-LP-07: sends the client id raw and the access token as Bearer", async () => {
    const post = vi.spyOn(axios, "post")
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce({ data: { status: "success" } });

    await luckpayPostJson(cfg(), "/verifyPan", { idNumber: "ABCDE1234F" });

    expect(post).toHaveBeenNthCalledWith(
      2,
      `${PROD}/verifyPan`,
      expect.objectContaining({ idNumber: "ABCDE1234F" }),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "LPM14",
          "X-Access-Token": "Bearer access-token",
        }),
      }),
    );
  });
});

describe("pickLuckpayField", () => {
  const build = (envelope: Record<string, unknown>): LuckpayResponse => {
    const inner = envelope.data;
    return {
      envelope,
      data: (inner && typeof inner === "object" && !Array.isArray(inner) ? inner : envelope) as Record<string, unknown>,
      sanitized: {},
    };
  };

  it("TC-LP-08: finds a field at the envelope top level", () => {
    expect(pickLuckpayField(build({ redirectUrl: "https://a" }), ["redirectUrl"])).toBe("https://a");
  });

  it("TC-LP-09: finds a field nested under `data`", () => {
    // The env-driven client previously only looked at the top level, so a nested
    // redirect URL silently resolved to null.
    expect(pickLuckpayField(build({ status: "ok", data: { redirectUrl: "https://b" } }), ["redirectUrl"])).toBe("https://b");
  });

  it("TC-LP-10: honours name order and skips blank values", () => {
    const r = build({ data: { redirectUrl: "   ", redirect_url: "https://c" } });
    expect(pickLuckpayField(r, ["redirectUrl", "redirect_url"])).toBe("https://c");
  });

  it("TC-LP-11: returns null when no name matches", () => {
    expect(pickLuckpayField(build({ data: {} }), ["redirectUrl"])).toBeNull();
  });
});

describe("Luckpay config resolution", () => {
  it("TC-LP-12: DigiLocker falls back to the core credentials when no override is set", () => {
    // The production shape: one account, one base URL for all five endpoints.
    const resolved = resolveLuckpayConfigFrom({
      bgv_provider: "befisc_luckpay",
      luckpay_api_url: PROD,
      luckpay_basic_token: "core-token",
      luckpay_client_id: "LPM14",
    }, "digilocker");

    expect(resolved.baseUrl).toBe(PROD);
    expect(resolved.basicToken).toBe("core-token");
    expect(resolved.clientId).toBe("LPM14");
    expect(resolved.source).toBe("db");
  });

  it("TC-LP-13: DigiLocker overrides win when configured", () => {
    const resolved = resolveLuckpayConfigFrom({
      bgv_provider: "befisc_luckpay",
      luckpay_api_url: PROD,
      luckpay_basic_token: "core-token",
      luckpay_client_id: "LPM14",
      luckpay_digilocker_base_url: STAGING,
      luckpay_digilocker_basic_token: "dl-token",
      luckpay_digilocker_client_id: "LPM153",
    }, "digilocker");

    expect(resolved.baseUrl).toBe(STAGING);
    expect(resolved.basicToken).toBe("dl-token");
    expect(resolved.clientId).toBe("LPM153");
  });

  it("TC-LP-14: core scope ignores the DigiLocker overrides", () => {
    const resolved = resolveLuckpayConfigFrom({
      bgv_provider: "befisc_luckpay",
      luckpay_api_url: PROD,
      luckpay_basic_token: "core-token",
      luckpay_client_id: "LPM14",
      luckpay_digilocker_base_url: STAGING,
    }, "core");

    expect(resolved.baseUrl).toBe(PROD);
  });

  it("TC-LP-15: strips a trailing slash and embedded whitespace from pasted credentials", () => {
    const resolved = resolveLuckpayConfigFrom({
      bgv_provider: "befisc_luckpay",
      luckpay_api_url: `${PROD}/`,
      luckpay_basic_token: "tok en\n",
      luckpay_client_id: " LPM14 ",
    }, "core");

    expect(resolved.baseUrl).toBe(PROD);
    expect(resolved.basicToken).toBe("token");
    expect(resolved.clientId).toBe("LPM14");
  });

  it("TC-LP-16: missing credentials raise a 503", () => {
    const bare = normalizeLuckpayConfig({ baseUrl: PROD, basicToken: "", clientId: "", enabled: true });
    expect(() => assertLuckpayCredentials(bare)).toThrow(/not configured/i);
    try {
      assertLuckpayCredentials(bare);
    } catch (e) {
      expect((e as { statusCode?: number }).statusCode).toBe(503);
    }
  });
});
