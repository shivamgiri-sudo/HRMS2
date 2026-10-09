/**
 * Answer links for every invitation email. A person who already has an he_match for the requisition answers on the match token
 * (today's /w/<token> page). Anyone else (legacy Meta Notify / Notify All / sync, pipeline Meta rows, HR manual) gets a walkin_invite
 * token: one active invite per mobile10 + requisition, reused on every re-send (slot, branch and send time refreshed).
 */
import type { RowDataPacket } from "mysql2";
import { randomBytes, randomUUID } from "node:crypto";
import { db } from "../../db/mysql.js";
import { isMissingSchemaError } from "../../db/db-error-classification.js";
import { answerUrlFor, DEMO_TOKEN, TOKEN_RE } from "./he-email-parts.js";

export type InviteSourcePath = "legacy_meta" | "legacy_meta_bulk" | "legacy_meta_sync" | "pipeline" | "manual";
export type InviteState = "sent" | "answered_yes" | "answered_later" | "declined" | "stopped" | "superseded";

export interface InviteLinkInput {
  mobile10: string; requisitionId: string; leadId?: string | null; metaLeadId?: string | null; followupId?: string | null;
  campaignId?: string | null; branchName?: string | null; slotAt?: string | null /* 'YYYY-MM-DD HH:MM:SS' IST */; sourcePath: InviteSourcePath;
  /** meta_live | meta_old | he, stamped at send by the shared attribution rule when the caller knows it. */
  driveType?: string | null;
  now: Date;
}
export interface InviteLink { kind: "match" | "invite"; token: string; answerUrl: string; matchId: string | null; inviteId: string | null }

export interface WalkinInviteRow {
  id: string; token: string; mobile10: string; requisition_id: string; lead_id: string | null; meta_lead_id: string | null; followup_id: string | null;
  campaign_id: string | null; drive_type: string | null; branch_name: string | null; slot_at: string | null; source_path: InviteSourcePath;
  state: InviteState; match_id: string | null; send_count: number;
}

export type ResolvedToken =
  | { kind: "match"; matchId: string }
  | { kind: "invite"; invite: WalkinInviteRow }
  | { kind: "demo" }
  | { kind: "invalid" };

export const newInviteToken = () => randomBytes(16).toString("hex");

/** IST wall clock of a Date, 'YYYY-MM-DD HH:MM:SS' (the DB session runs at +05:30). */
const istStamp = (d: Date) => new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 19).replace("T", " ");

async function matchFor(mobile10: string, requisitionId: string): Promise<{ id: string; token: string } | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT m.id, m.token FROM he_match m JOIN he_lead l ON l.id = m.lead_id
      WHERE l.mobile10 = ? AND m.requisition_id = ? AND m.token IS NOT NULL LIMIT 1`, [mobile10, requisitionId]);
  return rows[0] ? { id: String(rows[0].id), token: String(rows[0].token) } : null;
}

async function inviteFor(mobile10: string, requisitionId: string): Promise<WalkinInviteRow | null> {
  const [rows] = await db.execute<RowDataPacket[]>("SELECT * FROM walkin_invite WHERE mobile10 = ? AND requisition_id = ? LIMIT 1", [mobile10, requisitionId]);
  return (rows[0] as WalkinInviteRow | undefined) ?? null;
}

/**
 * The answer link for one invitation. `simulate` reads only: it returns the match token, the existing invite token, or `o.token`
 * (the token the caller will store after a successful send), else the demo token. A live call upserts the invite and keeps an
 * existing token; a declined or stopped invite keeps its state (the link still works and shows that state).
 */
export async function inviteLinkFor(i: InviteLinkInput, o: { simulate?: boolean; token?: string } = {}): Promise<InviteLink> {
  if (!/^[6-9]\d{9}$/.test(i.mobile10)) throw new Error("inviteLinkFor: mobile10 must be a 10-digit Indian mobile");
  const match = await matchFor(i.mobile10, i.requisitionId);
  if (match) return { kind: "match", token: match.token, answerUrl: answerUrlFor(match.token), matchId: match.id, inviteId: null };
  if (o.simulate) {
    const existing = await inviteFor(i.mobile10, i.requisitionId);
    const token = existing?.token ?? (o.token && TOKEN_RE.test(o.token) ? o.token : DEMO_TOKEN);
    return { kind: "invite", token, answerUrl: answerUrlFor(token), matchId: null, inviteId: null };
  }
  const token = o.token && TOKEN_RE.test(o.token) && o.token !== DEMO_TOKEN ? o.token : newInviteToken();
  const at = istStamp(i.now);
  await db.execute(
    `INSERT INTO walkin_invite (id, token, mobile10, requisition_id, lead_id, meta_lead_id, followup_id, campaign_id, drive_type, branch_name, slot_at,
                                source_path, state, first_sent_at, last_sent_at, send_count)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'sent',?,?,1)
     ON DUPLICATE KEY UPDATE
       lead_id = COALESCE(lead_id, VALUES(lead_id)), meta_lead_id = COALESCE(meta_lead_id, VALUES(meta_lead_id)),
       followup_id = COALESCE(VALUES(followup_id), followup_id), campaign_id = COALESCE(VALUES(campaign_id), campaign_id),
       drive_type = COALESCE(VALUES(drive_type), drive_type), branch_name = COALESCE(VALUES(branch_name), branch_name),
       slot_at = COALESCE(VALUES(slot_at), slot_at), last_sent_at = VALUES(last_sent_at), send_count = send_count + 1,
       state = IF(state IN ('declined','stopped'), state, 'sent')`,
    [randomUUID(), token, i.mobile10, i.requisitionId, i.leadId ?? null, i.metaLeadId ?? null, i.followupId ?? null, i.campaignId ?? null,
      i.driveType ?? null, i.branchName ?? null, i.slotAt ?? null, i.sourcePath, at, at]);
  const row = await inviteFor(i.mobile10, i.requisitionId);
  if (!row) throw new Error("inviteLinkFor: invite row missing after upsert");
  return { kind: "invite", token: row.token, answerUrl: answerUrlFor(row.token), matchId: null, inviteId: row.id };
}

/** What a /w/<token> link points at. An invite that already booked a match answers as that match from then on. */
export async function resolveAnswerToken(token: string): Promise<ResolvedToken> {
  if (!TOKEN_RE.test(token)) return { kind: "invalid" };
  if (token === DEMO_TOKEN) return { kind: "demo" };
  const [m] = await db.execute<RowDataPacket[]>("SELECT id FROM he_match WHERE token = ? LIMIT 1", [token]);
  if (m[0]) return { kind: "match", matchId: String(m[0].id) };
  // Before migration 2140 (no walkin_invite table) an unknown token is invalid, not a server error.
  const [w] = await db.execute<RowDataPacket[]>("SELECT * FROM walkin_invite WHERE token = ? LIMIT 1", [token])
    .catch((e: unknown) => { if (isMissingSchemaError(e)) return [[]] as unknown as [RowDataPacket[]]; throw e; });
  const inv = w[0] as WalkinInviteRow | undefined;
  if (!inv) return { kind: "invalid" };
  if (inv.match_id) return { kind: "match", matchId: String(inv.match_id) };
  return { kind: "invite", invite: inv };
}

export async function markInviteAnswered(inviteId: string, state: "answered_yes" | "answered_later" | "declined" | "stopped", matchId?: string | null): Promise<void> {
  await db.execute("UPDATE walkin_invite SET state = ?, answered_at = NOW(), match_id = COALESCE(?, match_id) WHERE id = ?", [state, matchId ?? null, inviteId]);
}
