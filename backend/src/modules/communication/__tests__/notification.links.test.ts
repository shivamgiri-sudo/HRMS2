import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../config/env.js', () => ({ env: { FRONTEND_URL: 'https://hrms.example.com/' } }));

import { linkForEvent, resolveActionUrl, withActionLink } from '../notification.links.js';

describe('linkForEvent', () => {
  it('maps exact events', () => {
    expect(linkForEvent('payslip_ready')).toBe('/profile?tab=payslips');
    expect(linkForEvent('statutory_opt_out_submitted')).toBe('/payroll/ho-queues?tab=optout');
  });
  it('maps by prefix when there is no exact entry', () => {
    expect(linkForEvent('payroll_run_approved')).toBe('/payroll');
    expect(linkForEvent('grn_submitted')).toBe('/finance/grn');
    expect(linkForEvent('noc_completed')).toBe('/payroll/noc');
    expect(linkForEvent('exit_ff_approved')).toBe('/exit-management');
  });
  it('prefers the exact entry over the prefix', () => {
    expect(linkForEvent('exit_auto_exited')).toBe('/exit/command-center');
    expect(linkForEvent('leave_approval_overdue')).toBe('/leave-approvals');
  });
  it('returns empty for an unknown event', () => {
    expect(linkForEvent('something_new')).toBe('');
  });
});

describe('rejoin events', () => {
  it.each([
    'rejoin_requested', 'rejoin_decided', 'rejoin_pending_reminder',
    'rejoin_pending_escalation', 'rejoin_followup_attention', 'rejoin_blocked_at_joining',
  ])('%s links to the reactivation review page', (code) => {
    expect(linkForEvent(code).startsWith('/employees/reactivation')).toBe(true);
  });
});

describe('resolveActionUrl', () => {
  it('builds an absolute URL without a double slash', () => {
    expect(resolveActionUrl('payslip_ready', {})).toBe('https://hrms.example.com/profile?tab=payslips');
  });
  it('lets event data override the default', () => {
    expect(resolveActionUrl('payslip_ready', { action_url: '/payroll/payslips' })).toBe('https://hrms.example.com/payroll/payslips');
    expect(resolveActionUrl('x', { actionUrl: 'https://other.example.com/a' })).toBe('https://other.example.com/a');
  });
  it('is empty when there is nowhere to send them', () => {
    expect(resolveActionUrl('something_new', {})).toBe('');
  });
});

describe('withActionLink', () => {
  const url = 'https://hrms.example.com/leaves';
  it('appends a button and the plain URL', () => {
    const r = withActionLink('<p>Hi</p>', 'Hi', url);
    expect(r.html).toContain(`href="${url}"`);
    expect(r.text).toContain(url);
  });
  it('inserts before </body> when present', () => {
    const r = withActionLink('<html><body><p>Hi</p></body></html>', undefined, url);
    expect(r.html.indexOf(url)).toBeLessThan(r.html.indexOf('</body>'));
    expect(r.text).toBeUndefined();
  });
  it('does not duplicate a link the template already has', () => {
    const html = `<a href="${url}">go</a>`;
    expect(withActionLink(html, 't', url)).toEqual({ html, text: 't' });
  });
  it('leaves the mail alone when there is no URL', () => {
    expect(withActionLink('<p>Hi</p>', 'Hi', '')).toEqual({ html: '<p>Hi</p>', text: 'Hi' });
  });
});
