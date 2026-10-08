/**
 * Pieces shared by every walk-in invitation email (Hiring Engine invite, legacy Meta Notify / Notify All / sync, qualified follow-up
 * pipeline), so all of them carry the same Yes / Another time / Cannot come buttons to the same /w/<token> page. Pure.
 * The buttons only open the page; the answer is recorded on a second tap there (mail scanners pre-open links).
 */
export type AnswerKey = "yes" | "later" | "no";

/** Answer-page tokens: 128-bit hex. The all-zero token is the sample-email demo page (nothing is ever written for it). */
export const TOKEN_RE = /^[a-f0-9]{32}$/;
export const DEMO_TOKEN = "0".repeat(32);

export const escHtml = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const BUTTON: Record<AnswerKey, { label: string; bg: string; fg: string; border: string; text: string }> = {
  yes: { label: "Yes, I will come", bg: "#15803d", fg: "#ffffff", border: "#15803d", text: "Yes" },
  later: { label: "Need another time", bg: "#ffffff", fg: "#1e3a8a", border: "#94a3b8", text: "Another time" },
  no: { label: "Cannot come", bg: "#ffffff", fg: "#b91c1c", border: "#fecaca", text: "Cannot come" },
};
const ALL: AnswerKey[] = ["yes", "later", "no"];

/** HE_PUBLIC_BASE_URL, else FRONTEND_URL, else the production host; no trailing slash. */
export function publicBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const pick = (k: string) => (env[k]?.trim() ? env[k]!.trim() : null);
  return (pick("HE_PUBLIC_BASE_URL") ?? pick("FRONTEND_URL") ?? "https://mcnhrms.teammas.in").replace(/\/$/, "");
}

export const answerUrlFor = (token: string, env?: NodeJS.ProcessEnv) => `${publicBaseUrl(env)}/w/${token}`;

/** The "Will you come?" block, exactly as the Hiring Engine invite email has always rendered it (a table row, leading newline included). */
export function answerButtonsHtml(answerUrl: string, keys: AnswerKey[] = ALL): string {
  const btn = (k: AnswerKey) => {
    const b = BUTTON[k];
    return `<a href="${escHtml(`${answerUrl}?a=${k}`)}" style="display:inline-block;background:${b.bg};color:${b.fg};border:1px solid ${b.border};padding:14px 18px;border-radius:8px;font-weight:bold;font-size:16px;text-decoration:none;margin:0 0 10px;display:block;text-align:center">${b.label}</a>`;
  };
  return `
<tr><td style="padding:8px 28px 4px"><p style="margin:0 0 8px;font-size:15px;font-weight:bold;color:#0f172a">Will you come?</p>
${keys.map(btn).join("")}
<p style="margin:6px 0 0;font-size:12px;color:#64748b">One tap tells the branch to expect you, or frees your slot for someone else.</p></td></tr>`;
}

/** Plain-text line of the same answers (leading newline included, as in the invite email text part). */
export function answerButtonsText(answerUrl: string, keys: AnswerKey[] = ALL): string {
  return `\nWill you come? ${keys.map((k) => `${BUTTON[k].text}: ${answerUrl}?a=${k}`).join(" | ")}`;
}

/** Small grey "Stop messages" link (a table row) to the answer page with ?a=stop; the page asks once more before recording. */
export function stopLinkHtml(answerUrl: string): string {
  return `<tr><td style="padding:6px 28px 0;font-size:12px;color:#94a3b8">Do not want messages about this job? <a href="${escHtml(`${answerUrl}?a=stop`)}" style="color:#64748b">Stop messages</a></td></tr>`;
}

export const stopLinkText = (answerUrl: string) => `Stop messages: ${answerUrl}?a=stop`;
