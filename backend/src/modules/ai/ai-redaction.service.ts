/**
 * AI Redaction Service
 * Masks sensitive PII before sending to AI providers
 * PeopleOS AI Enhancement Phase 1
 */

import type { PiiCategory, PiiDetectionResult } from './ai-provider.types.js';

// Regex patterns for PII detection
const AADHAAR_PATTERN = /\b\d{4}\s?\d{4}\s?\d{4}\b/g;
const PAN_PATTERN = /\b[A-Z]{5}\d{4}[A-Z]\b/g;
const MOBILE_PATTERN = /\b[6-9]\d{9}\b/g;
const EMAIL_PATTERN = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;
const BANK_ACCOUNT_PATTERN = /\b\d{9,18}\b/g;
const IFSC_PATTERN = /\b[A-Z]{4}0[A-Z0-9]{6}\b/g;
const UAN_PATTERN = /\b\d{12}\b/g;

// RegExp.test() on a /g pattern advances lastIndex and resumes from there on the
// next call, so detection flip-flops when the same pattern is reused. Detection
// uses these stateless copies; the /g originals stay for replace().
function detects(pattern: RegExp, value: string): boolean {
  return new RegExp(pattern.source, pattern.flags.replace('g', '')).test(value);
}

class AiRedactionService {
  /**
   * Mask Aadhaar number (show last 4 digits only)
   */
  maskAadhaar(value: string): string {
    return value.replace(AADHAAR_PATTERN, (match) => {
      const digits = match.replace(/\s/g, '');
      return `****-****-${digits.slice(-4)}`;
    });
  }

  /**
   * Mask PAN number (show first and last character only)
   */
  maskPan(value: string): string {
    return value.replace(PAN_PATTERN, (match) => {
      return `${match[0]}****${match.slice(-1)}`;
    });
  }

  /**
   * Mask mobile number (show last 4 digits only)
   */
  maskMobile(value: string): string {
    return value.replace(MOBILE_PATTERN, (match) => {
      return `******${match.slice(-4)}`;
    });
  }

  /**
   * Mask email (show first 2 chars and domain only)
   */
  maskEmail(value: string): string {
    return value.replace(EMAIL_PATTERN, (match) => {
      const [local, domain] = match.split('@');
      if (!local || !domain) return '****@****.***';
      return `${local.slice(0, 2)}****@${domain}`;
    });
  }

  /**
   * Mask bank account number (show last 4 digits only)
   */
  maskBankAccount(value: string): string {
    return value.replace(BANK_ACCOUNT_PATTERN, (match) => {
      if (match.length < 9) return match; // Too short, likely not bank account
      return `****${match.slice(-4)}`;
    });
  }

  /**
   * Mask IFSC code (show first 4 chars only)
   */
  maskIfsc(value: string): string {
    return value.replace(IFSC_PATTERN, (match) => {
      return `${match.slice(0, 4)}******`;
    });
  }

  /**
   * Mask UAN (show last 4 digits only)
   */
  maskUan(value: string): string {
    return value.replace(UAN_PATTERN, (match) => {
      return `********${match.slice(-4)}`;
    });
  }

  /**
   * Mask employee code (show last 3 chars only)
   */
  maskEmployeeCode(code: string): string {
    if (!code || code.length < 4) return '***';
    return `EMP****${code.slice(-3)}`;
  }

  /**
   * Mask candidate code (show last 3 chars only)
   */
  maskCandidateCode(code: string): string {
    if (!code || code.length < 4) return '***';
    return `CAND****${code.slice(-3)}`;
  }

  /**
   * Detect PII in text and return categories found
   */
  detectPii(value: string): PiiDetectionResult {
    if (!value || typeof value !== 'string') {
      return {
        hasPii: false,
        categories: [],
        redactedValue: value,
        sensitiveFields: [],
      };
    }

    const categories: PiiCategory[] = [];
    const sensitiveFields: string[] = [];

    if (detects(AADHAAR_PATTERN, value)) {
      categories.push('statutory_sensitive');
      sensitiveFields.push('aadhaar');
    }
    if (detects(PAN_PATTERN, value)) {
      categories.push('statutory_sensitive');
      sensitiveFields.push('pan');
    }
    if (detects(MOBILE_PATTERN, value)) {
      categories.push('personal_identity');
      sensitiveFields.push('mobile');
    }
    if (detects(EMAIL_PATTERN, value)) {
      categories.push('personal_identity');
      sensitiveFields.push('email');
    }
    if (detects(BANK_ACCOUNT_PATTERN, value)) {
      categories.push('bank_sensitive');
      sensitiveFields.push('bank_account');
    }
    if (detects(IFSC_PATTERN, value)) {
      categories.push('bank_sensitive');
      sensitiveFields.push('ifsc');
    }
    if (detects(UAN_PATTERN, value)) {
      categories.push('statutory_sensitive');
      sensitiveFields.push('uan');
    }

    let redactedValue = value;
    if (categories.length > 0) {
      redactedValue = this.redactAll(value);
    }

    return {
      hasPii: categories.length > 0,
      categories: Array.from(new Set(categories)),
      redactedValue,
      sensitiveFields,
    };
  }

  /**
   * Redact all known PII patterns from text
   */
  redactAll(value: string): string {
    if (!value || typeof value !== 'string') return value;

    let redacted = value;
    redacted = this.maskAadhaar(redacted);
    redacted = this.maskPan(redacted);
    redacted = this.maskMobile(redacted);
    redacted = this.maskEmail(redacted);
    redacted = this.maskBankAccount(redacted);
    redacted = this.maskIfsc(redacted);
    redacted = this.maskUan(redacted);

    return redacted;
  }

  /**
   * Redact PII from object (deep)
   */
  redactObject(obj: Record<string, unknown>): Record<string, unknown> {
    if (!obj || typeof obj !== 'object') return obj;

    const redacted: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(obj)) {
      redacted[key] = this.redactValue(value);
    }

    return redacted;
  }

  /**
   * Redact any value, whatever its nesting. Objects nested inside arrays used to
   * be passed through untouched, so context built as a list of records (company
   * facts, employee rows) reached the provider with raw PII in it.
   */
  private redactValue(value: unknown): unknown {
    if (value === null || value === undefined) return value;
    if (typeof value === 'string') return this.redactAll(value);
    if (Array.isArray(value)) return value.map((item) => this.redactValue(item));
    if (typeof value === 'object') {
      return this.redactObject(value as Record<string, unknown>);
    }
    return value;
  }

  /**
   * Check if field name indicates sensitive data
   */
  isSensitiveFieldName(fieldName: string): boolean {
    const lowerField = fieldName.toLowerCase();
    const sensitivePatterns = [
      'aadhaar',
      'aadhar',
      'pan',
      'password',
      'pwd',
      'secret',
      'token',
      'api_key',
      'apikey',
      'salary',
      'ctc',
      'basic_pay',
      'gross_salary',
      'net_salary',
      'bank_account',
      'account_number',
      'ifsc',
      'uan',
      'esic',
      'pf_number',
      'mobile',
      'phone',
      'personal_email',
      'date_of_birth',
      'dob',
      'address',
      'medical',
      'health',
      'tax',
      'tds',
      'credit_card',
      'debit_card',
    ];

    return sensitivePatterns.some((pattern) => lowerField.includes(pattern));
  }

  /**
   * Remove sensitive fields from object
   */
  removeSensitiveFields(
    obj: Record<string, unknown>
  ): { cleaned: Record<string, unknown>; removed: string[] } {
    if (!obj || typeof obj !== 'object') {
      return { cleaned: obj, removed: [] };
    }

    const cleaned: Record<string, unknown> = {};
    const removed: string[] = [];

    for (const [key, value] of Object.entries(obj)) {
      if (this.isSensitiveFieldName(key)) {
        removed.push(key);
        continue;
      }

      if (value === null || value === undefined) {
        cleaned[key] = value;
      } else if (Array.isArray(value)) {
        // For arrays, check if items are objects and recursively clean
        cleaned[key] = value.map((item) => {
          if (item && typeof item === 'object') {
            const result = this.removeSensitiveFields(item as Record<string, unknown>);
            removed.push(...result.removed.map((r) => `${key}[].${r}`));
            return result.cleaned;
          }
          return item;
        });
      } else if (typeof value === 'object') {
        const result = this.removeSensitiveFields(value as Record<string, unknown>);
        removed.push(...result.removed.map((r) => `${key}.${r}`));
        cleaned[key] = result.cleaned;
      } else {
        cleaned[key] = value;
      }
    }

    return { cleaned, removed };
  }
}

export const aiRedactionService = new AiRedactionService();
