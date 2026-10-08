import { describe, expect, it } from "vitest";

import { resolveBankVerificationMethod } from "../src/modules/ats/bgv-verification.service.js";

describe("resolveBankVerificationMethod", () => {
  it("stores manual review fallbacks with a schema-safe manual method", () => {
    expect(resolveBankVerificationMethod({
      status: "manual_review",
      providerKey: "luckpay",
      raw: { mode: "provider_error_fallback" },
    })).toBe("manual");
  });

  it("stores digio and infinity bank checks as penny_less", () => {
    expect(resolveBankVerificationMethod({
      status: "verified",
      providerKey: "digio",
      raw: {},
    })).toBe("penny_less");

    expect(resolveBankVerificationMethod({
      status: "verified",
      providerKey: "infinity_ai",
      raw: {},
    })).toBe("penny_less");
  });

  it("stores befisc luckpay penny-drop checks as penny_drop", () => {
    expect(resolveBankVerificationMethod({
      status: "verified",
      providerKey: "befisc_luckpay",
      raw: { verificationMode: "PENNY_DROP" },
    })).toBe("penny_drop");
  });

  it("keeps mock responses inside the mock enum bucket", () => {
    expect(resolveBankVerificationMethod({
      status: "verified",
      providerKey: "mock_bgv",
      raw: {},
    })).toBe("mock");
  });
});
