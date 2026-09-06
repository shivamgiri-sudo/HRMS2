import { describe, expect, it } from 'vitest';

import { findDeepKnowledge } from '../ai-howto.service.js';
import { KNOWLEDGE_CATALOG } from '../mira-hrms-knowledge.js';

describe('findDeepKnowledge', () => {
  it('matches PF question', () => {
    expect(findDeepKnowledge('how is PF calculated on my salary?')?.code).toBe('payroll_pf_esic');
  });

  it('matches LWP question', () => {
    expect(findDeepKnowledge('what is LWP deduction?')?.code).toBe('payroll_lwp');
  });

  it('matches roster question', () => {
    expect(findDeepKnowledge('why is my roster locked?')?.code).toBe('wfm_roster_lifecycle');
  });

  it('returns null for unrelated question', () => {
    expect(findDeepKnowledge('what is the weather today?')).toBeNull();
  });

  it('matches bulk upload error question', () => {
    expect(findDeepKnowledge('why is my bulk upload stuck?')?.code).toBe('bulk_upload_guide');
  });

  it('matches page overview question', () => {
    expect(findDeepKnowledge('where can I find my payslip?')?.code).toBe('pages_overview');
  });

  it('still routes payslip field-meaning questions to the payslip entry', () => {
    // The counterpart to the case above: "where" is navigation, but asking what a
    // section means is field semantics, and pages_overview must not swallow it.
    expect(findDeepKnowledge('what does the deduction section mean?')?.code).toBe('payroll_payslip_fields');
  });

  it('matches ESIC and gratuity questions', () => {
    expect(findDeepKnowledge('am I eligible for ESIC?')?.code).toBe('payroll_pf_esic');
    expect(findDeepKnowledge('how is gratuity calculated on resignation?')?.code).toBe('exit_fnf_stages');
  });

  it('fires on questions that are not phrased as how-to', () => {
    // No how-to trigger phrase at all — the topical alias is the whole gate.
    expect(findDeepKnowledge('my leave balance looks wrong')?.code).toBe('leave_balance_types');
  });

  it('returns null for empty input', () => {
    expect(findDeepKnowledge('')).toBeNull();
    expect(findDeepKnowledge('   ')).toBeNull();
  });

  it('has unique entry codes', () => {
    const codes = KNOWLEDGE_CATALOG.map((entry) => entry.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('has non-empty knowledge text on every entry', () => {
    for (const entry of KNOWLEDGE_CATALOG) {
      expect(entry.knowledge.trim().length, `${entry.code} has empty knowledge`).toBeGreaterThan(200);
      expect(entry.aliases.length, `${entry.code} has no aliases`).toBeGreaterThan(0);
    }
  });
});
