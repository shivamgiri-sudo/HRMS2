import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AssessmentLinkView } from '@/components/requisition/AssessmentLinkEditor';
import { canEditAssessmentLink, isAssessmentLinkDirty, validateAssessmentLink } from '@/components/requisition/assessmentLink.model';

const base = { inputId: 'al-1', value: '', savedValue: null, canEdit: true, status: 'idle' as const, message: null, onChange: () => {}, onSave: () => {} };

describe('assessment link model', () => {
  it('validates like the backend', () => {
    expect(validateAssessmentLink('')).toBeNull();
    expect(validateAssessmentLink('  ')).toBeNull();
    expect(validateAssessmentLink('https://bmi.example.com/a?x=1')).toBeNull();
    for (const bad of ['http://x.com', 'javascript:alert(1)', 'data:text/html,x', 'x.com/a', 'https://x.com/a b', 'https://' + 'a'.repeat(500)]) {
      expect(validateAssessmentLink(bad), bad).not.toBeNull();
    }
  });
  it('edit only for approved requisitions and requisition editor roles', () => {
    expect(canEditAssessmentLink('hr', 'approved')).toBe(true);
    expect(canEditAssessmentLink('hr', 'closed')).toBe(false);
    expect(canEditAssessmentLink('employee', 'approved')).toBe(false);
    expect(canEditAssessmentLink(undefined, 'approved')).toBe(false);
  });
  it('dirty ignores surrounding whitespace and null vs empty', () => {
    expect(isAssessmentLinkDirty(null, '')).toBe(false);
    expect(isAssessmentLinkDirty('https://a.com', ' https://a.com ')).toBe(false);
    expect(isAssessmentLinkDirty('https://a.com', 'https://b.com')).toBe(true);
  });
});

describe('AssessmentLinkView markup', () => {
  it('has a labelled 44px input, a save button disabled until changed, and a polite status region', () => {
    const html = renderToStaticMarkup(<AssessmentLinkView {...base} />);
    expect(html).toContain('<label for="al-1"');
    expect(html).toContain('id="al-1"');
    expect(html).toContain('min-h-[44px]');
    expect(html).toContain('focus-visible:ring-2');
    expect(html).toMatch(/<button[^>]*\sdisabled=""/);
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
  });
  it('enables save when dirty', () => {
    const html = renderToStaticMarkup(<AssessmentLinkView {...base} value="https://a.com" />);
    expect(html).not.toMatch(/<button[^>]*\sdisabled=""/);
    expect(html).toContain('Save link');
  });
  it('shows saving, success and error text with icons, not colour alone', () => {
    expect(renderToStaticMarkup(<AssessmentLinkView {...base} value="https://a.com" status="saving" />)).toContain('Saving');
    expect(renderToStaticMarkup(<AssessmentLinkView {...base} status="saved" message="Link saved" />)).toContain('Link saved');
    const err = renderToStaticMarkup(<AssessmentLinkView {...base} status="error" message="Link must start with https://" />);
    expect(err).toContain('Error: Link must start with https://');
    expect(err).toContain('aria-invalid="true"');
  });
  it('read-only roles see the link as text with no input or button', () => {
    const html = renderToStaticMarkup(<AssessmentLinkView {...base} canEdit={false} savedValue="https://a.com/t" />);
    expect(html).toContain('https://a.com/t');
    expect(html).not.toContain('<input');
    expect(html).not.toContain('<button');
    expect(renderToStaticMarkup(<AssessmentLinkView {...base} canEdit={false} />)).toContain('No link set');
  });
});
