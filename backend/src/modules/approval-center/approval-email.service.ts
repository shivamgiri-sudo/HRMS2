import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { env } from "../../config/env.js";
import { authService } from "../auth/auth.service.js";
import { emailService } from "../communication/email.service.js";
import { createLoopback } from "./loopback.js";
import { listPendingApprovals } from "./approval-center.service.js";
import { createActionLink } from "./email-action.service.js";
import { renderApprovalCard, renderApprovalEmail, renderApprovalText } from "./email-render.js";
import type { ApprovalItem } from "./types.js";

const MAX_CARDS = 25;

const viewUrl = (item: ApprovalItem) => `${env.FRONTEND_URL.replace(/\/+$/, "")}${item.viewPath}`;

async function pendingFor(userId: string): Promise<ApprovalItem[]> {
  const jwt = await authService.mintScopedAccessToken(userId, 300);
  if (!jwt) return [];
  const ctx = createLoopback(userId, `Bearer ${jwt}`);
  return (await listPendingApprovals(ctx, { fresh: true })).items;
}

async function cardsFor(userId: string, items: ApprovalItem[]) {
  const links: Array<string | null> = [];
  for (const it of items) links.push(it.viewOnly || (it.noApprove && it.noReject) ? null : await createActionLink(userId, it));
  return { links, html: items.map((it, i) => renderApprovalCard(it, links[i], viewUrl(it))), text: renderApprovalText(items, links) };
}

/**
 * Block appended to a notification email for ONE approver: the full request (every component) plus one-click
 * Approve / Decline. `entityId` narrows to the request the email is about; without it, up to 3 matching items.
 * Returns null when the person has nothing of those kinds waiting (the email then goes out unchanged).
 */
export async function buildApprovalBlock(
  userId: string,
  opts: { kinds: string[]; entityId?: string },
): Promise<{ html: string; text: string } | null> {
  try {
    let items = (await pendingFor(userId)).filter((i) => opts.kinds.includes(i.kind));
    if (opts.entityId) {
      const exact = items.filter((i) => i.id === opts.entityId || i.uid.endsWith(`:${opts.entityId}`));
      if (exact.length) items = exact;
    }
    items = items.slice(0, 3);
    if (!items.length) return null;
    const { html, text } = await cardsFor(userId, items);
    return { html: `<div style="margin-top:18px">${html.join("")}</div>`, text: `\n\n${text}` };
  } catch (e) {
    console.warn("[approval-email] could not build approval block:", (e as Error).message);
    return null;
  }
}

export async function sendApprovalDigest(userId: string, email: string, name?: string): Promise<number> {
  const all = await pendingFor(userId);
  if (!all.length) return 0;
  const items = all.slice(0, MAX_CARDS);
  const { html, text } = await cardsFor(userId, items);
  const more = all.length - items.length;
  const body = renderApprovalEmail(
    `${all.length} approval${all.length === 1 ? "" : "s"} waiting for you`,
    `${name ? `Hi ${name}, ` : ""}these requests need your decision. Review the details and approve or decline straight from this email.`,
    [...html, ...(more > 0 ? [`<p style="font-size:13px;color:#4b5563">…and ${more} more. Open HRMS to see them all.</p>`] : [])],
    "You get this because these requests are waiting on you in MAS Callnet HRMS. Approve / Decline links are personal, single-use and expire in 72 hours.",
  );
  await emailService.send({
    to: email,
    subject: `Action needed: ${all.length} approval${all.length === 1 ? "" : "s"} waiting — MAS Callnet HRMS`,
    html: body,
    text: text + (more > 0 ? `\n…and ${more} more in HRMS.` : ""),
  });
  return all.length;
}

/** Roles that can ever be an approver; keeps the daily run off the ~everyone-else accounts. */
const APPROVER_ROLES = [
  "super_admin", "admin", "hr", "hr_admin", "hr_head", "ho_hr", "hr_manager", "manager", "assistant_manager", "process_manager",
  "team_leader", "branch_head", "wfm", "branch_wfm", "ho_wfm", "payroll_head", "payroll_hr", "payroll", "finance_head",
  "accounts_head", "finance", "ceo", "branch_admin", "security_head", "recruitment_hr",
];

export async function runApprovalDigest(): Promise<{ users: number; emailed: number; items: number }> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT DISTINCT au.id, au.email, e.full_name
       FROM user_roles ur
       JOIN auth_user au ON au.id = ur.user_id
       LEFT JOIN employees e ON e.user_id = au.id
      WHERE ur.active_status = 1 AND ur.role_key IN (${APPROVER_ROLES.map(() => "?").join(",")})
        AND COALESCE(au.is_blocked, 0) = 0 AND au.email IS NOT NULL AND au.email <> ''`,
    APPROVER_ROLES,
  );
  let emailed = 0;
  let items = 0;
  // Gentle concurrency: each user's list fans out to ~50 internal calls.
  const queue = [...(rows as any[])];
  const worker = async () => {
    for (let r = queue.shift(); r; r = queue.shift()) {
      try {
        const n = await sendApprovalDigest(r.id, r.email, r.full_name ? String(r.full_name).split(" ")[0] : undefined);
        if (n > 0) { emailed++; items += n; }
      } catch (e) {
        console.warn(`[approval-digest] ${r.email}:`, (e as Error).message);
      }
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  return { users: rows.length, emailed, items };
}
