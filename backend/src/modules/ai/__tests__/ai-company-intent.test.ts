import { describe, expect, it } from 'vitest';
import { detectCompanyIntent } from '../ai-company-knowledge.service.js';

/**
 * Routing a question to a company intent means answering it from a fixed set of
 * approved facts. Getting that wrong does not fabricate anything, but it answers
 * a question nobody asked — "how many employees does MAS Callnet have in
 * Mumbai?" came back as the company overview and leadership, because the
 * overview pattern matched the company's own name.
 */

describe('questions that genuinely ask about the company', () => {
  it.each([
    ['tell me about MAS Callnet', 'overview'],
    ['about the company', 'overview'],
    ['company profile', 'overview'],
    ['what is the mission', 'overview'],
    ['who is the CEO', 'leadership'],
    ['who are the founders', 'leadership'],
    ['where are the offices', 'locations'],
    ['office kaha hai', 'locations'],
    ['what are the branch heads', 'branch_heads'],
    ['contact details please', 'contact'],
    ['how do I contact support', 'contact'],
    ['are there any openings', 'careers'],
    ['what services does MAS offer', 'services'],
    ['what is BPO', 'services'],
  ])('routes %s to %s', (question, intent) => {
    expect(detectCompanyIntent(question)).toBe(intent);
  });
});

describe('questions that only mention the company', () => {
  // These must fall through so the provider can answer from context, or say it
  // cannot — rather than being served an overview they did not ask for.
  it.each([
    'how many employees does MAS Callnet have in Mumbai?',
    'is MAS Callnet open on Sunday?',
    'when did MAS Callnet last revise the shift allowance?',
    'does MAS Callnet run a night shift in Ahmedabad?',
    'what is the notice period at MAS Callnet',
  ])('does not force %s into a company intent', (question) => {
    expect(detectCompanyIntent(question)).toBe('unknown');
  });
});

describe('words that used to be over-eager', () => {
  it('does not treat every mention of contact as a request for company contact details', () => {
    expect(detectCompanyIntent('who should I contact about my leave?')).toBe('unknown');
  });

  it('does not treat every mention of service as a services question', () => {
    expect(detectCompanyIntent('my service request is pending')).toBe('unknown');
  });

  it('does not route an email address question to locations', () => {
    expect(detectCompanyIntent('what is my email address')).toBe('unknown');
  });
});
