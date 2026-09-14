/**
 * Log Redaction Utilities
 *
 * Provides utilities for redacting sensitive information from logs.
 * SECURITY: Prevents tokens, passwords, and PII from appearing in log output.
 */

// Patterns for sensitive data that should be redacted
const SENSITIVE_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  // JWT tokens (header.payload.signature format)
  { pattern: /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, replacement: "[REDACTED_JWT]" },

  // Bearer token in Authorization header
  { pattern: /Bearer\s+[A-Za-z0-9._-]+/gi, replacement: "Bearer [REDACTED]" },

  // Refresh tokens (UUIDs or similar)
  { pattern: /"refreshToken"\s*:\s*"[^"]+"/gi, replacement: '"refreshToken": "[REDACTED]"' },

  // Access tokens
  { pattern: /"accessToken"\s*:\s*"[^"]+"/gi, replacement: '"accessToken": "[REDACTED]"' },

  // OTP codes (6 digits)
  { pattern: /"otp"\s*:\s*"\d{6}"/gi, replacement: '"otp": "[REDACTED]"' },

  // Passwords
  { pattern: /"password"\s*:\s*"[^"]+"/gi, replacement: '"password": "[REDACTED]"' },

  // API keys
  { pattern: /"(api[_-]?key|apiKey)"\s*:\s*"[^"]+"/gi, replacement: '"$1": "[REDACTED]"' },

  // Secret keys
  { pattern: /"(secret[_-]?key|secretKey|client[_-]?secret)"\s*:\s*"[^"]+"/gi, replacement: '"$1": "[REDACTED]"' },

  // PAN numbers (Indian format: ABCDE1234F)
  { pattern: /[A-Z]{5}\d{4}[A-Z]/g, replacement: "[REDACTED_PAN]" },

  // Aadhaar numbers (12 digits, optionally spaced)
  { pattern: /\d{4}\s?\d{4}\s?\d{4}/g, replacement: "[REDACTED_AADHAAR]" },
];

/**
 * Redact sensitive information from a string.
 * Use this before logging any user input, request bodies, or response data.
 */
export function redactSensitive(input: string): string {
  let result = input;
  for (const { pattern, replacement } of SENSITIVE_PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

/**
 * Redact sensitive fields from an object (for JSON logging).
 * Returns a new object with sensitive fields replaced.
 */
export function redactObject<T extends Record<string, unknown>>(obj: T): T {
  // Normalize keys to lowercase for comparison
  const sensitiveKeys = new Set([
    "password",
    "refreshtoken",
    "accesstoken",
    "token",
    "otp",
    "api_key",
    "apikey",
    "secret",
    "secretkey",
    "client_secret",
    "clientsecret",
    "authorization",
    "pan",
    "aadhaar",
    "aadhar",
  ]);

  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    // Normalize key to lowercase for comparison
    const normalizedKey = key.toLowerCase().replace(/[-_]/g, "");
    if (sensitiveKeys.has(normalizedKey)) {
      result[key] = "[REDACTED]";
    } else if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      result[key] = redactObject(value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }

  return result as T;
}

/**
 * Create a morgan token sanitizer.
 * Wraps a morgan token function to redact sensitive data.
 */
export function sanitizeMorganToken(
  tokenFn: (req: unknown, res: unknown) => string | undefined
): (req: unknown, res: unknown) => string | undefined {
  return (req, res) => {
    const value = tokenFn(req, res);
    return value ? redactSensitive(value) : value;
  };
}

/**
 * Safe JSON stringify that redacts sensitive data.
 * Use instead of JSON.stringify when logging.
 */
export function safeStringify(obj: unknown): string {
  try {
    if (typeof obj === "object" && obj !== null) {
      return JSON.stringify(redactObject(obj as Record<string, unknown>));
    }
    return redactSensitive(String(obj));
  } catch {
    return "[STRINGIFY_ERROR]";
  }
}
