import type { ApprovalItem } from "./types.js";

export const esc = (v: unknown): string =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));

const BTN = "display:inline-block;padding:12px 22px;border-radius:8px;font-weight:600;font-size:14px;text-decoration:none;font-family:Arial,Helvetica,sans-serif;";

/** Every component of the request, as email-safe (table + inline style) HTML. */
export function renderFieldsTable(item: ApprovalItem): string {
  const grid = item.fields.filter((f) => f.type !== "long");
  const long = item.fields.filter((f) => f.type === "long");
  const rows = grid
    .map(
      (f) =>
        `<tr><td style="padding:6px 14px 6px 0;color:#6b7280;font-size:12px;vertical-align:top;white-space:nowrap">${esc(f.label)}</td>` +
        `<td style="padding:6px 0;color:#111827;font-size:14px;${f.type === "money" ? "font-weight:700;" : ""}">${esc(f.value)}</td></tr>`,
    )
    .join("");
  const blocks = long
    .map(
      (f) =>
        `<div style="margin-top:10px;padding:10px 12px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px">` +
        `<div style="color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:.04em">${esc(f.label)}</div>` +
        `<div style="color:#111827;font-size:14px;white-space:pre-wrap;margin-top:4px">${esc(f.value)}</div></div>`,
    )
    .join("");
  return `<table role="presentation" style="border-collapse:collapse;margin-top:8px">${rows}</table>${blocks}`;
}

/** One approval card for an email: header, all details, and the Approve / Decline / View buttons. */
export function renderApprovalCard(item: ApprovalItem, link: string | null, viewUrl: string): string {
  const canAct = !!link && !item.viewOnly;
  const buttons = canAct
    ? (item.noApprove ? "" : `<a href="${esc(link)}?do=approve" style="${BTN}background:#059669;color:#ffffff">${esc(item.approveLabel ?? "Approve")}</a> `) +
      (item.noReject ? "" : `<a href="${esc(link)}?do=reject" style="${BTN}background:#ffffff;color:#b91c1c;border:1px solid #fca5a5">${esc(item.rejectLabel ?? "Decline")}</a> `)
    : "";
  return (
    `<div style="border:1px solid #e5e7eb;border-radius:12px;padding:16px;margin:0 0 14px;font-family:Arial,Helvetica,sans-serif;max-width:640px">` +
    `<div style="font-size:11px;font-weight:700;color:#4f46e5;text-transform:uppercase;letter-spacing:.05em">${esc(item.kindLabel)}${item.stage ? ` · ${esc(item.stage)}` : ""}</div>` +
    `<div style="font-size:17px;font-weight:700;color:#111827;margin-top:4px">${esc(item.title)}</div>` +
    (item.subtitle ? `<div style="font-size:13px;color:#4b5563;margin-top:2px">${esc(item.subtitle)}</div>` : "") +
    renderFieldsTable(item) +
    `<div style="margin-top:14px">${buttons}<a href="${esc(viewUrl)}" style="${BTN}background:#f3f4f6;color:#111827">View in HRMS</a></div>` +
    (canAct ? `<div style="margin-top:8px;font-size:11px;color:#6b7280">Approve / Decline opens a confirmation page — nothing is decided until you confirm there.</div>` : "") +
    `</div>`
  );
}

export function renderApprovalEmail(heading: string, intro: string, cards: string[], footer: string): string {
  return (
    `<div style="background:#f3f4f6;padding:20px 12px"><div style="max-width:660px;margin:0 auto;font-family:Arial,Helvetica,sans-serif">` +
    `<h2 style="margin:0 0 6px;font-size:20px;color:#111827">${esc(heading)}</h2>` +
    `<p style="margin:0 0 16px;color:#4b5563;font-size:14px">${esc(intro)}</p>` +
    cards.join("") +
    `<p style="font-size:11px;color:#6b7280;margin-top:16px">${esc(footer)}</p></div></div>`
  );
}

export function renderApprovalText(items: ApprovalItem[], links: Array<string | null>): string {
  return items
    .map((it, i) => {
      const lines = it.fields.map((f) => `  ${f.label}: ${f.value}`).join("\n");
      const l = links[i];
      return `${it.kindLabel} — ${it.title}\n${lines}\n${l && !it.viewOnly ? `  Approve: ${l}?do=approve\n  Decline: ${l}?do=reject\n` : ""}`;
    })
    .join("\n");
}

/* ── Standalone confirm page (public, no HRMS login) ─────────────────────────────────────────── */

const PAGE_CSS =
  "body{margin:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;color:#111827}" +
  ".w{max-width:640px;margin:0 auto;padding:20px 14px}.c{background:#fff;border:1px solid #e5e7eb;border-radius:14px;padding:18px}" +
  "button{font:600 15px Arial;border:0;border-radius:10px;padding:14px 22px;cursor:pointer;min-height:48px}" +
  ".ap{background:#059669;color:#fff}.rj{background:#fff;color:#b91c1c;border:1px solid #fca5a5}" +
  "textarea{width:100%;box-sizing:border-box;min-height:84px;border:1px solid #d1d5db;border-radius:8px;padding:10px;font:14px Arial;margin-top:6px}" +
  ".m{padding:14px;border-radius:10px;font-size:15px}.ok{background:#ecfdf5;color:#065f46}.er{background:#fef2f2;color:#991b1b}.nt{background:#f3f4f6;color:#374151}";

export function pageShell(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<meta name="robots" content="noindex"><title>${esc(title)}</title><style>${PAGE_CSS}</style></head><body><div class="w">${body}</div></body></html>`;
}

export function messagePage(kind: "ok" | "er" | "nt", heading: string, message: string, viewUrl?: string): string {
  return pageShell(
    heading,
    `<div class="c"><h2 style="margin:0 0 10px">${esc(heading)}</h2><div class="m ${kind}">${esc(message)}</div>` +
      (viewUrl ? `<p style="margin-top:14px"><a href="${esc(viewUrl)}">Open HRMS</a></p>` : "") +
      `</div>`,
  );
}

export function confirmPage(item: ApprovalItem, token: string, preselect: string, error?: string): string {
  const needsReason = item.rejectNeedsReason;
  const actions =
    (item.noApprove ? "" : `<button class="ap" type="submit" name="action" value="approve">${esc(item.approveLabel ?? "Approve")}</button> `) +
    (item.noReject ? "" : `<button class="rj" type="submit" name="action" value="reject">${esc(item.rejectLabel ?? "Decline")}</button>`);
  return pageShell(
    `${item.kindLabel} — ${item.title}`,
    `<div class="c"><div style="font-size:11px;font-weight:700;color:#4f46e5;text-transform:uppercase">${esc(item.kindLabel)}${item.stage ? ` · ${esc(item.stage)}` : ""}</div>` +
      `<h2 style="margin:4px 0">${esc(item.title)}</h2>${item.subtitle ? `<div style="color:#4b5563;font-size:14px">${esc(item.subtitle)}</div>` : ""}` +
      renderFieldsTable(item) +
      (error ? `<div class="m er" style="margin-top:12px">${esc(error)}</div>` : "") +
      `<form method="post" action="/api/public/approval-action/${esc(token)}" style="margin-top:16px">` +
      `<label for="em" style="font-size:13px;color:#374151;font-weight:600">Confirm your official email id</label>` +
      `<input id="em" name="email" type="email" required autocomplete="email" placeholder="name@company.com" style="width:100%;box-sizing:border-box;border:1px solid #d1d5db;border-radius:8px;padding:12px;font:14px Arial;margin:6px 0 14px">` +
      `<label for="r" style="font-size:13px;color:#374151">Note${needsReason ? " (required if you decline)" : " (optional)"}</label>` +
      `<textarea id="r" name="remarks" ${preselect === "reject" ? "autofocus" : ""}></textarea>` +
      `<div style="margin-top:12px;display:flex;gap:10px;flex-wrap:wrap">${actions}</div></form>` +
      `<p style="font-size:12px;color:#6b7280;margin-top:14px">This link is personal to you, works once and expires in 72 hours. Don't forward it.</p></div>`,
  );
}
