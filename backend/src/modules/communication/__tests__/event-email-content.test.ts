import { describe, expect, it } from 'vitest';
import { renderEventEmail, formatValue, EVENT_COPY } from '../event-email-content.js';
import { fallbackBody } from '../notification.deliverer.js';

describe('renderEventEmail', () => {
  it('prints every payload fact, not just the first 12', () => {
    const data: Record<string, unknown> = {};
    for (let i = 0; i < 20; i++) data[`field_${i}`] = `v${i}`;
    const out = renderEventEmail('unknown_event', data, 'https://x.test');
    expect(out.html).toContain('v19');
  });

  it('formats dates, money and booleans instead of printing raw values', () => {
    expect(formatValue('sla_due_at', '2026-10-14T12:00:00.000Z')).toMatch(/14 Oct 2026/);
    expect(formatValue('net_payable', '48,210')).toBe('₹48,210');
    expect(formatValue('attendance_pct_mtd', 92.5)).toBe('92.5%');
    expect(formatValue('unassigned', true)).toBe('Yes');
    expect(formatValue('reason', '')).toBeNull();
  });

  it('writes an intro, a button and an absolute link for a known event', () => {
    const out = renderEventEmail('leave_submitted', {
      employee_name: 'A', employee_code: 'M1', leave_type: 'EL', action_url: '/leave/1',
    }, 'https://hrms.test');
    expect(out.html).toContain('waiting for your decision');
    expect(out.html).toContain('href="https://hrms.test/leave/1"');
    expect(out.subject).toContain('Leave request — A (M1)');
  });

  it('drops tokens whose value is missing rather than printing blanks', () => {
    const out = renderEventEmail('leave_submitted', { employee_name: 'A' }, 'https://x.test');
    expect(out.subject).toBe('MAS Callnet HRMS — Leave request — A');
  });

  it('escapes HTML in values', () => {
    const out = renderEventEmail('x', { reason: '<script>alert(1)</script>' }, 'https://x.test');
    expect(out.html).not.toContain('<script>');
  });

  it('no longer apologises about a missing template', () => {
    expect(fallbackBody('leave_submitted', { employee_name: 'A' }).html).not.toMatch(/no template/i);
  });

  it('has copy for every event the code emits', () => {
    for (const e of ['leave_submitted', 'roster_published', 'payslip_ready', 'grn_submitted', 'noc_declined', 'exit_ff_approved', 'provisioning_overdue']) {
      expect(EVENT_COPY[e]).toBeDefined();
    }
  });
});
