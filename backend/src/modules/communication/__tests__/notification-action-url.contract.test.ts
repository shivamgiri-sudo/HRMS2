/**
 * The "Open HRMS" button has to point somewhere a mail client can reach.
 *
 * Every actionUrl in NOTIFICATION_EVENT_CATALOG is a bare path ("/profile"), and
 * nothing in the delivery path ever prefixed a host. So system_event mail shipped
 *
 *     <a href="/profile">Open HRMS</a>
 *
 * which a recipient's mail client can only resolve against its own domain. Over
 * 2026-08-05..08 that reached 10 people 1,428 times, and the candidate who
 * reported it read the dead button as a corrupted signing link.
 *
 * These tests are against the rendered artefact rather than the helper, because
 * the defect was never in a single function — it was that no layer owned making
 * the URL absolute, and each layer assumed another had.
 */
import Handlebars from 'handlebars';
import { describe, expect, it } from 'vitest';
import { builtInTemplates } from '../builtin-templates.js';

const render = (tpl: string, data: Record<string, unknown>) => Handlebars.compile(tpl)(data);

const withActionUrl = (action_url: string) => ({
  employee: { name: 'SOFIYA SULTAN' },
  notification: {
    title: 'Joining document eSign pending',
    message: 'Your Employment Agreement requires Aadhaar eSign.',
    short_message: 'eSign pending.',
    category: 'onboarding',
    action_url,
    reference: null,
  },
});

describe('system_event action_url', () => {
  const tpl = builtInTemplates.system_event;

  it('renders an absolute href a mail client can resolve', () => {
    const html = render(tpl.body_html, withActionUrl('https://mcnhrms.teammas.in/profile'));

    expect(html).toContain('href="https://mcnhrms.teammas.in/profile"');
    // The regression itself: a root-relative href in an email is unreachable.
    expect(html).not.toMatch(/href="\/[^"]*"/);
  });

  it('omits the button entirely when there is no reachable target', () => {
    // The e-sign reminder dispatches with action_url "" — only sha256(token) is
    // stored, so no signing link can be rebuilt, and a preboarding candidate has
    // no login for /profile either. An empty href renders as a button that
    // silently reloads the reader's mail client, which is worse than no button.
    const html = render(tpl.body_html, withActionUrl(''));

    expect(html).not.toContain('Open HRMS');
    expect(html).not.toContain('href=""');
    // The message still has to survive — the reminder is the whole point.
    expect(html).toContain('requires Aadhaar eSign');
  });

  it('drops the trailing link line from text, WhatsApp and SMS too', () => {
    for (const body of [tpl.body_text, tpl.whatsapp_text, tpl.sms_text!]) {
      expect(render(body, withActionUrl(''))).not.toContain('Open HRMS:');
      expect(render(body, withActionUrl('https://mcnhrms.teammas.in/profile')))
        .toContain('https://mcnhrms.teammas.in/profile');
    }
  });
});
