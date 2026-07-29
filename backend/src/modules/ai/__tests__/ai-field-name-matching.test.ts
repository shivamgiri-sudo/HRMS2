import { describe, expect, it } from 'vitest';
import { aiRedactionService, fieldNameMatches, fieldNameTokens } from '../ai-redaction.service.js';
import { aiSafetyService } from '../ai-safety.service.js';

describe('fieldNameTokens', () => {
  it('splits snake_case, dot paths and camelCase alike', () => {
    expect(fieldNameTokens('data_confidence.companyPublicKnowledge')).toEqual([
      'data', 'confidence', 'company', 'public', 'knowledge',
    ]);
  });
});

describe('fieldNameMatches', () => {
  it.each(['company_name', 'companyName', 'companion_id', 'expanded_view', 'data_confidence.company_public_knowledge'])(
    'does not read %s as a PAN field',
    (field) => {
      expect(fieldNameMatches(field, 'pan')).toBe(false);
    },
  );

  it.each(['pan', 'pan_number', 'panNumber', 'employee_pan'])('still matches %s', (field) => {
    expect(fieldNameMatches(field, 'pan')).toBe(true);
  });

  it('matches multi-word patterns inside longer names', () => {
    expect(fieldNameMatches('annual_basic_pay', 'basic_pay')).toBe(true);
    expect(fieldNameMatches('employee_bank_account_id', 'bank_account')).toBe(true);
  });

  it('does not match a multi-word pattern whose words are separated', () => {
    expect(fieldNameMatches('basic_monthly_pay', 'basic_pay')).toBe(false);
  });
});

describe('isSensitiveFieldName', () => {
  it('leaves company_name alone', () => {
    expect(aiRedactionService.isSensitiveFieldName('company_name')).toBe(false);
  });

  it.each(['pan_number', 'gross_salary', 'aadhaar', 'bank_account_no', 'api_key', 'date_of_birth'])(
    'still flags %s',
    (field) => {
      expect(aiRedactionService.isSensitiveFieldName(field)).toBe(true);
    },
  );
});

describe('checkContextSafety', () => {
  it('allows an external provider for an ordinary company-aware context', async () => {
    const raw = {
      company_name: 'MAS Callnet',
      context_type: 'generic',
      company_facts: [{ key: 'overview', content: 'MAS Callnet runs BPO operations across India.' }],
    };

    const { sanitizedContext } = await aiSafetyService.sanitizeContext(raw, ['employee']);
    const check = await aiSafetyService.checkContextSafety(sanitizedContext, true);

    expect(check.allowed).toBe(true);
  });

  it('still blocks a context carrying a genuinely critical field', async () => {
    const check = await aiSafetyService.checkContextSafety(
      { gross_salary: 82000, company_name: 'MAS Callnet' },
      true,
    );

    expect(check.allowed).toBe(false);
  });
});
