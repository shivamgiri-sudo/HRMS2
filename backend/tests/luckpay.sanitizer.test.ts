import { describe, expect, it } from "vitest";

import { generateClientTransactionId, sanitizePayload } from "../src/modules/integrations/luckpay/luckpay.client.js";

describe("Luckpay payload sanitization", () => {
  it("masks secret fields recursively and keeps safe references", () => {
    const payload = {
      accessToken: "token-secret-123",
      Authorization: "Bearer abcdef",
      X_Access_Token: "x-access-secret",
      nested: {
        aadhaar: "123456789012",
        pan: "ABCDE1234F",
        bank_account: "1234567890123456",
        file_path: "/tmp/luckpay.pdf",
        contactPhone: "9876543210",
        idNumber: "ABCDE1234F",
        identifier: "100200300400",
        referenceId: "ref-123",
        children: [{ otp: "123456" }],
      },
    };

    const sanitized = sanitizePayload(payload);
    const serialized = JSON.stringify(sanitized);

    expect(serialized).not.toContain("token-secret-123");
    expect(serialized).not.toContain("abcdef");
    expect(serialized).not.toContain("123456789012");
    expect(serialized).not.toContain("ABCDE1234F");
    expect(serialized).not.toContain("100200300400");
    expect(serialized).not.toContain("/tmp/luckpay.pdf");
    expect(serialized).toContain("ref-123");
    expect(String((sanitized as Record<string, unknown>).accessToken ?? "")).toContain("...");
    expect(String((sanitized as Record<string, unknown>).Authorization ?? "")).toContain("...");
  });
});

describe("Luckpay transaction ids", () => {
  it("uses the requested prefix and produces unique ids", () => {
    const first = generateClientTransactionId();
    const second = generateClientTransactionId("esign");

    expect(first.startsWith("joining-doc-")).toBe(true);
    expect(second.startsWith("esign-")).toBe(true);
    expect(first).not.toBe(second);
  });
});
