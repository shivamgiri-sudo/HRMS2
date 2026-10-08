import { describe, expect, it } from "vitest";

import {
  buildPublicTokenAuditValue,
  hashIdentifier,
  maskAadhaar,
  maskPan,
  maskUan,
  sanitizeEpfAuditRecord,
  verifyLuckpayWebhookSecret,
} from "../src/modules/employees/employeeCompliancePrivacy.js";

describe("EPF masking helpers", () => {
  it("masks Aadhaar, PAN, and UAN without leaking raw identifiers", () => {
    expect(maskAadhaar("123456789012")).toBe("XXXX-XXXX-9012");
    expect(maskPan("ABCDE1234F")).toBe("ABCDE****F");
    expect(maskUan("123456789012")).toBe("XXXXXXXX9012");
  });

  it("hashes identifiers deterministically", () => {
    const first = hashIdentifier("EMP-123");
    const second = hashIdentifier("EMP-123");
    expect(first).toHaveLength(64);
    expect(first).toBe(second);
  });

  it("sanitizes audit records and keeps public token references redacted", () => {
    const sanitized = sanitizeEpfAuditRecord({
      aadhaar_number: "123456789012",
      pan_number: "ABCDE1234F",
      uan_number: "123456789012",
      consent_token: "public-token-value",
      nested: { aadhaar_number: "123456789012" },
    });

    const serialized = JSON.stringify(sanitized);
    expect(serialized).not.toContain("123456789012");
    expect(serialized).not.toContain("ABCDE1234F");
    expect(serialized).not.toContain("public-token-value");
    expect(String((sanitized as Record<string, unknown>).aadhaar_number ?? "")).toContain("XXXX");
  });
});

describe("Luckpay webhook secret helper", () => {
  it("accepts the configured shared secret and rejects missing or mismatched values", () => {
    expect(verifyLuckpayWebhookSecret("shared-secret", "shared-secret")).toBe(true);
    expect(verifyLuckpayWebhookSecret(undefined, "shared-secret")).toBe(false);
    expect(verifyLuckpayWebhookSecret("bad-secret", "shared-secret")).toBe(false);
  });
});

describe("Public token audit helper", () => {
  it("marks issuance without storing the token value", () => {
    expect(buildPublicTokenAuditValue()).toEqual({ publicTokenIssued: true });
  });
});
