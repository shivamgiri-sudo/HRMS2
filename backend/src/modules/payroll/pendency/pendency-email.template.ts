export interface PendencyEmailInput {
  name: string;
  heading: string;
  intro: string;
  /** What exactly is missing, one line each. */
  items: string[];
  ctaLabel: string;
  ctaUrl: string;
  /** Short extra instructions shown under the button (where to click, what format). */
  hint?: string;
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Shared shell for the pendency follow-ups. Always carries a button AND the bare URL in
 * both the HTML and text parts: the button for people who can click it, the printed URL
 * for mail clients that strip links or people reading on another device.
 */
export function buildPendencyEmail(input: PendencyEmailInput): { html: string; text: string } {
  const items = input.items.map((i) => `<li style="margin:4px 0">${esc(i)}</li>`).join('');
  const html =
    `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:560px;color:#111827">` +
    `<p style="font-size:16px;margin:0 0 12px"><strong>${esc(input.heading)}</strong></p>` +
    `<p style="font-size:14px;margin:0 0 12px">Hello ${esc(input.name)},</p>` +
    `<p style="font-size:14px;margin:0 0 12px">${esc(input.intro)}</p>` +
    `<ul style="font-size:14px;margin:0 0 16px;padding-left:20px">${items}</ul>` +
    `<p style="margin:0 0 8px"><a href="${esc(input.ctaUrl)}" ` +
    `style="display:inline-block;background:#073f78;color:#ffffff;text-decoration:none;padding:10px 20px;` +
    `border-radius:6px;font-size:14px;font-weight:600">${esc(input.ctaLabel)}</a></p>` +
    (input.hint ? `<p style="font-size:13px;color:#374151;margin:8px 0">${esc(input.hint)}</p>` : '') +
    `<p style="font-size:12px;color:#6b7280;margin:8px 0">If the button does not work, copy this link into your browser: ` +
    `<span style="word-break:break-all">${esc(input.ctaUrl)}</span><br>You may be asked to sign in first; after signing in you will be taken straight to this page.</p>` +
    `<p style="font-size:12px;color:#6b7280;margin:16px 0 0">MAS Callnet HRMS — this is an automated reminder. If you have already done this, please ignore it.</p>` +
    `</div>`;
  const text =
    `${input.heading}\n\nHello ${input.name},\n\n${input.intro}\n\n` +
    input.items.map((i) => `- ${i}`).join('\n') +
    `\n\n${input.ctaLabel}: ${input.ctaUrl}\n` +
    (input.hint ? `\n${input.hint}\n` : '') +
    `\nYou may be asked to sign in first; afterwards you will be taken straight to this page.\n`;
  return { html, text };
}
