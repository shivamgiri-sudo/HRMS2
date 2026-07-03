import { createHash } from "crypto";

function normalizeString(value: unknown) {
  return String(value ?? "").trim();
}

function digitsOnly(value: unknown) {
  return normalizeString(value).replace(/\D/g, "");
}

function sanitizeNestedValue(key: string, value: unknown): unknown {
  const normalizedKey = key.toLowerCase();
  if (value == null) return value;

  if (
    normalizedKey.includes("aadhaar") ||
    normalizedKey.includes("aadhar") ||
    normalizedKey.includes("pan") ||
    normalizedKey.includes("uan")
  ) {
    if (normalizedKey.includes("hash")) {
      return value;
    }
    if (normalizedKey.includes("aadhaar") || normalizedKey.includes("aadhar")) {
      return maskAadhaar(value);
    }
    if (normalizedKey.includes("pan")) {
      return maskPan(value);
    }
    if (normalizedKey.includes("uan")) {
      return maskUan(value);
    }
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeRecord(item));
  }
  if (value && typeof value === "object") {
    return sanitizeRecord(value);
  }

  return value;
}

function sanitizeRecord(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }
  const input = value as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(input)) {
    output[key] = sanitizeNestedValue(key, nested);
  }
  return output;
}

export function hashIdentifier(value: unknown) {
  const normalized = normalizeString(value).toUpperCase();
  return normalized ? createHash("sha256").update(normalized).digest("hex") : null;
}

export function maskAadhaar(value: unknown) {
  const digits = digitsOnly(value);
  if (!digits) return null;
  return `XXXX-XXXX-${digits.slice(-4)}`;
}

export function maskPan(value: unknown) {
  const pan = normalizeString(value).toUpperCase();
  if (!pan) return null;
  const firstFive = pan.slice(0, 5).padEnd(5, "X");
  const lastChar = pan.slice(-1) || "X";
  return `${firstFive}****${lastChar}`;
}

export function maskUan(value: unknown) {
  const digits = digitsOnly(value);
  if (!digits) return null;
  return `${"X".repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}`;
}

export function sanitizeEpfAuditRecord(value: Record<string, unknown>) {
  const sanitized = sanitizeRecord(value) as Record<string, unknown>;
  const aadhaarValue = sanitized.aadhaar_number ?? sanitized.aadhaar_masked ?? null;
  const panValue = sanitized.pan_number ?? sanitized.pan_masked ?? null;
  const uanValue = sanitized.uan_number ?? sanitized.uan_masked ?? null;
  const publicTokenValue = sanitized.publicToken ?? sanitized.public_token ?? null;
  const consentTokenValue = sanitized.consent_token ?? null;

  return {
    ...sanitized,
    aadhaar_number: maskAadhaar(aadhaarValue as string | null | undefined),
    aadhaar_masked: maskAadhaar(aadhaarValue as string | null | undefined),
    pan_number: maskPan(panValue as string | null | undefined),
    pan_masked: maskPan(panValue as string | null | undefined),
    uan_number: maskUan(uanValue as string | null | undefined),
    uan_masked: maskUan(uanValue as string | null | undefined),
    publicToken: publicTokenValue ? "[redacted]" : null,
    public_token: publicTokenValue ? "[redacted]" : null,
    consent_token: consentTokenValue ? "[redacted]" : null,
  };
}

export function buildPublicTokenAuditValue() {
  return { publicTokenIssued: true };
}

export function verifyLuckpayWebhookSecret(providedSecret: string | null | undefined, configuredSecret: string | null | undefined) {
  const expected = normalizeString(configuredSecret);
  if (!expected) return false;
  return normalizeString(providedSecret) === expected;
}
