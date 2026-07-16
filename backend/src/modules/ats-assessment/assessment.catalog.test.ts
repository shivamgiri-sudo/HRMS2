import { describe, expect, it } from 'vitest';
import { DEFAULT_ASSESSMENT_TEMPLATES, publicTemplate } from './assessment.catalog.js';

describe('default ATS assessment catalog', () => {
  it('contains every process and role combination', () => {
    expect(DEFAULT_ASSESSMENT_TEMPLATES).toHaveLength(15);
    const keys = new Set(DEFAULT_ASSESSMENT_TEMPLATES.map((item) => `${item.process}:${item.role}`));
    for (const process of ['inbound', 'outbound', 'backoffice', 'document', 'email']) {
      for (const role of ['executive', 'team_leader', 'quality_auditor']) {
        expect(keys.has(`${process}:${role}`)).toBe(true);
      }
    }
  });

  it('requires typing for backoffice, document, and email with exactly two attempts', () => {
    for (const template of DEFAULT_ASSESSMENT_TEMPLATES) {
      const shouldRequire = ['backoffice', 'document', 'email'].includes(template.process);
      expect(template.typing.required).toBe(shouldRequire);
      expect(template.typing.maxAttempts).toBe(2);
    }
  });

  it('never exposes correct answers, scoring keywords, or typing passage to candidates', () => {
    const safe = publicTemplate(DEFAULT_ASSESSMENT_TEMPLATES[0]);
    expect('passage' in safe.typing).toBe(false);
    for (const question of safe.questions) {
      expect('correctAnswer' in question).toBe(false);
      expect('keywords' in question).toBe(false);
      expect('explanation' in question).toBe(false);
    }
  });
});
