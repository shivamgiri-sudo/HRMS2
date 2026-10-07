import { createHash, randomBytes, randomUUID } from "crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { env } from "../../config/env.js";
import { authService } from "../auth/auth.service.js";
import { createLoopback } from "./loopback.js";
import { decideApproval, findAdapter } from "./approval-center.service.js";
import type { ApprovalItem } from "./types.js";

/** How long an emailed Approve / Decline link works. */
export const ACTION_LINK_TTL_HOURS = 72;

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export function actionUrl(token: string): string {
  return `${env.FRONTEND_URL.replace(/\/+$/, "")}/api/public/approval-action/${token}`;
}

/** One token per (approver, request). The raw token exists only in the email; the DB keeps its hash. */
export async function createActionLink(userId: string, item: Pick<ApprovalItem, "uid" | "kind">): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await db.execute<ResultSetHeader>(
    `INSERT INTO approval_email_action (id, token_hash, user_id, approval_uid, kind, expires_at)
     VALUES (?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ? HOUR))`,
    [randomUUID(), sha256(token), userId, item.uid, item.kind, ACTION_LINK_TTL_HOURS],
  );
  return actionUrl(token);
}

export interface ActionTokenRow {
  id: string;
  user_id: string;
  approval_uid: string;
  kind: string;
  used_at: string | null;
  used_action: string | null;
  expired: boolean;
}

export async function loadActionToken(token: string): Promise<ActionTokenRow | null> {
  if (!/^[A-Za-z0-9_-]{40,64}$/.test(token)) return null;
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, user_id, approval_uid, kind, used_at, used_action, (expires_at < NOW()) AS expired
       FROM approval_email_action WHERE token_hash = ? LIMIT 1`,
    [sha256(token)],
  );
  const r = rows[0] as any;
  return r ? { ...r, expired: Number(r.expired) === 1 } : null;
}

async function ctxFor(userId: string) {
  const jwt = await authService.mintScopedAccessToken(userId, 120);
  return jwt ? createLoopback(userId, `Bearer ${jwt}`) : null;
}

/** Fresh view of the request for the confirm page; null when it is no longer pending for this approver. */
export async function itemForToken(row: ActionTokenRow): Promise<ApprovalItem | null> {
  const adapter = findAdapter(row.kind);
  const ctx = await ctxFor(row.user_id);
  if (!adapter || !ctx) return null;
  const items = await adapter.list(ctx);
  return items.find((i) => i.uid === row.approval_uid) ?? null;
}

export type ActionOutcome =
  | { ok: true; action: "approve" | "reject" }
  | { ok: false; reason: "invalid" | "used" | "expired" | "gone" | "error"; message: string };

/**
 * Carry out the decision. The token is claimed first (atomic UPDATE) so a double click or a replay can never
 * decide twice; if the module then refuses (validation, scope, stage moved on) the claim is released so the
 * approver can retry or open the request in HRMS. The decision itself goes through the module's own endpoint
 * as that approver, so every role / scope / maker-checker rule applies exactly as in the app.
 */
export async function executeActionToken(
  token: string,
  action: "approve" | "reject",
  remarks: string,
  ip: string,
): Promise<ActionOutcome> {
  const row = await loadActionToken(token);
  if (!row) return { ok: false, reason: "invalid", message: "This link is not valid." };
  if (row.used_at) return { ok: false, reason: "used", message: "This link has already been used." };
  if (row.expired) return { ok: false, reason: "expired", message: "This link has expired. Open HRMS to decide." };

  const [claim] = await db.execute<ResultSetHeader>(
    `UPDATE approval_email_action SET used_at = NOW(), used_action = ?, used_ip = ?
      WHERE id = ? AND used_at IS NULL AND expires_at > NOW()`,
    [action, ip.slice(0, 64), row.id],
  );
  if (claim.affectedRows !== 1) return { ok: false, reason: "used", message: "This link has already been used." };

  const release = () =>
    db.execute(`UPDATE approval_email_action SET used_at = NULL, used_action = NULL, used_ip = NULL WHERE id = ?`, [row.id]).catch(() => undefined);

  try {
    const ctx = await ctxFor(row.user_id);
    if (!ctx) {
      await release();
      return { ok: false, reason: "error", message: "Your account cannot act on this right now." };
    }
    const out = await decideApproval(ctx, row.approval_uid, action, remarks);
    if (out.ok) return { ok: true, action };
    if (out.status === 409) return { ok: false, reason: "gone", message: out.message };
    await release();
    return { ok: false, reason: "error", message: out.message };
  } catch (e: any) {
    await release();
    return { ok: false, reason: "error", message: String(e?.message ?? "Action failed").slice(0, 300) };
  }
}
