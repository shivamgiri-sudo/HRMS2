import { describe, expect, it } from 'vitest';
import { answerPortalHowToQuestion } from '../portal-howto.service.js';
import { PORTAL_HOWTO_CATALOG } from '../portal-howto-catalog.js';
import { CLIENT_PORTAL_BLOCKED_DATA } from '../../access/role.catalog.js';

describe('answerPortalHowToQuestion', () => {
  it('does not fire on questions without a how-to prefix', () => {
    expect(answerPortalHowToQuestion('what is my KPI score').handled).toBe(false);
  });

  it('does not fire on a how-to prefix matching no catalog entry', () => {
    expect(answerPortalHowToQuestion('how do I fly to the moon').handled).toBe(false);
  });

  it.each(PORTAL_HOWTO_CATALOG)('answers "how do I $title" with steps and the /portal route', (entry) => {
    const result = answerPortalHowToQuestion(`how do I ${entry.title.toLowerCase()}`);
    expect(result.handled).toBe(true);
    expect(result.code).toBe(entry.code);
    expect(result.route).toBe('/portal');
    expect(result.answer).toContain('1.');
  });

  it('every catalog entry has a real /portal route and at least one step', () => {
    for (const entry of PORTAL_HOWTO_CATALOG) {
      expect(entry.route).toBe('/portal');
      expect(entry.steps.length).toBeGreaterThan(0);
    }
  });

  // Hard safety check: no entry may ever describe a CLIENT_PORTAL_BLOCKED_DATA
  // topic. Sourced directly from role.catalog.ts, not re-typed, so this can
  // never silently drift from the real list.
  it('never mentions a blocked-data topic in any title or step', () => {
    const blockedPattern = new RegExp(`\\b(${CLIENT_PORTAL_BLOCKED_DATA.join('|')})\\b`, 'i');
    for (const entry of PORTAL_HOWTO_CATALOG) {
      const text = [entry.title, ...entry.steps].join(' ');
      expect(text).not.toMatch(blockedPattern);
    }
  });
});
