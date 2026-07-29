import { describe, it, expect } from 'vitest';
import { aiRedactionService } from '../ai-redaction.service.js';
import { aiSafetyService } from '../ai-safety.service.js';

describe('redactObject nesting', () => {
  it('redacts strings inside objects nested in arrays', () => {
    const context = {
      company_facts: [
        { key: 'company-contact', content: 'Support email: care@teammas.co.in. Number: 9667195550.' },
      ],
    };

    const redacted = aiRedactionService.redactObject(context) as typeof context;
    const content = redacted.company_facts[0].content;

    expect(content).not.toContain('care@teammas.co.in');
    expect(content).not.toContain('9667195550');
    expect(aiRedactionService.detectPii(JSON.stringify(redacted)).hasPii).toBe(false);
  });

  it('redacts through arrays of arrays', () => {
    const redacted = aiRedactionService.redactObject({
      rows: [[{ email: 'someone@example.com' }]],
    }) as { rows: Array<Array<{ email: string }>> };

    expect(redacted.rows[0][0].email).not.toContain('someone@example.com');
  });
});

describe('detectPii statelessness', () => {
  it('returns the same verdict when called repeatedly', () => {
    const value = 'Support email: care@teammas.co.in';
    const verdicts = Array.from({ length: 6 }, () => aiRedactionService.detectPii(value).hasPii);

    expect(verdicts).toEqual([true, true, true, true, true, true]);
  });

  it('does not report PII for clean text after a positive match', () => {
    aiRedactionService.detectPii('care@teammas.co.in');

    expect(aiRedactionService.detectPii('no personal data here').hasPii).toBe(false);
  });
});

describe('company context reaches the external provider', () => {
  it('allows an external provider once approved company facts are sanitized', async () => {
    const raw = {
      company_facts: [
        { key: 'company-contact', content: 'Customer support email: care@teammas.co.in.' },
      ],
      context_type: 'generic',
    };

    const { sanitizedContext } = await aiSafetyService.sanitizeContext(raw, ['employee']);
    const check = await aiSafetyService.checkContextSafety(sanitizedContext, true);

    expect(check.allowed).toBe(true);
  });
});
