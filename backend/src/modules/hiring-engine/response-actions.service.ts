/**
 * HR actions on responses: confirm / cannot come / another time by hand after an off-system call, classify a free-text reply waiting
 * in the review queue (optionally applying it), or ignore it. Every applied answer goes through the same path as a candidate's own tap
 * (recordInviteAnswer on a match, answerInviteToken on an invite), recorded as channel hr / mode manual with the actor.
 * Scope: the requisition's branch must be the caller's (org-wide roles see all); anything outside scope is "not found".
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { writeAuditLog } from "../../shared/auditLog.js";
import type { BranchScope } from "../meta-campaign/meta-access.js";
import { recordInviteAnswer, type InviteAnswer } from "./he-ingest.service.js";
import { normalizeMobile10 } from "./he-phone.js";
import type { ResponseAnswer } from "./response-normalise.js";
import { inviteLinkFor, resolveAnswerToken, type WalkinInviteRow } from "./walkin-invite.service.js";
import { answerInviteToken } from "./walkin-invite-answer.service.js";

export class ResponseActionError extends Error {
  constructor(public status: 400 | 404 | 409, message: string) { super(message); }
}

export type ManualAnswer = "confirm" | "decline" | "reschedule";
export type ManualVia = "phone_call" | "walk_in_desk" | "other";
const TAP: Record<ManualAnswer, InviteAnswer> = { confirm: "yes", decline: "no", reschedule: "later" };
const ANSWERS: readonly string[] = ["confirm", "decline", "reschedule", "question", "unsubscribe", "no_answer", "on_my_way", "wrong_person", "other"];
const VIA: readonly string[] = ["phone_call", "walk_in_desk", "other"];

export interface ManualInput {
  actor: string; mobile10?: string; leadId?: string; metaLeadId?: string; requisitionId: string;
  answer: ManualAnswer; note: string; via: ManualVia; at?: Date;
}

const inScope = (scope: BranchScope, branch: unknown) => scope.all || (!!scope.branchName && String(branch ?? "") === scope.branchName);

async function requisitionBranch(requisitionId: string): Promise<string | null> {
  const [r] = await db.execute<RowDataPacket[]>("SELECT id, branch_name FROM job_requisition WHERE id = ? LIMIT 1", [requisitionId]);
  return r[0] ? String(r[0].branch_name ?? "") : null;
}

async function mobileFor(a: Pick<ManualInput, "mobile10" | "leadId" | "metaLeadId">): Promise<string | null> {
  if (a.mobile10) return normalizeMobile10(a.mobile10);
  if (a.leadId) { const [r] = await db.execute<RowDataPacket[]>("SELECT mobile10 FROM he_lead WHERE id = ? LIMIT 1", [a.leadId]); return normalizeMobile10(r[0]?.mobile10); }
  if (a.metaLeadId) { const [r] = await db.execute<RowDataPacket[]>("SELECT parsed_phone FROM meta_lead_raw WHERE id = ? LIMIT 1", [a.metaLeadId]); return normalizeMobile10(r[0]?.parsed_phone); }
  return null;
}

/** Answer through the invite path (no match yet): the invite token is resolved again so an invite that booked meanwhile answers as its match. */
async function answerViaInvite(invite: WalkinInviteRow | null, matchId: string | null, tap: InviteAnswer, o: { actor: string; note: string; at: Date }) {
  if (matchId) return { matchId, ...(await recordInviteAnswer(matchId, tap, { channel: "hr", actor: o.actor, note: o.note })) };
  if (!invite) throw new ResponseActionError(409, "There is nothing to apply this answer to");
  const r = await answerInviteToken(invite, tap, { now: o.at, channel: "hr", actor: o.actor, note: o.note });
  return { matchId: null, state: r.state, responseId: r.responseId };
}

export async function manualResponse(a: ManualInput, scope: BranchScope): Promise<{ responseId: number; matchId: string | null; state: string }> {
  if (!(a.answer in TAP)) throw new ResponseActionError(400, "Pick confirm, cannot come or another time");
  if (!VIA.includes(a.via)) throw new ResponseActionError(400, "Say how the candidate answered");
  const note = String(a.note ?? "").trim();
  if (note.length < 3 || note.length > 300) throw new ResponseActionError(400, "A note of 3 to 300 characters is required");
  const branch = await requisitionBranch(a.requisitionId);
  if (branch == null || !inScope(scope, branch)) throw new ResponseActionError(404, "Requisition not found");
  const mobile10 = await mobileFor(a);
  if (!mobile10) throw new ResponseActionError(400, "A valid 10-digit mobile is required");
  const at = a.at ?? new Date();
  const fullNote = `${a.via}: ${note}`;
  const [m] = await db.execute<RowDataPacket[]>(
    "SELECT m.id FROM he_match m JOIN he_lead l ON l.id = m.lead_id WHERE l.mobile10 = ? AND m.requisition_id = ? LIMIT 1", [mobile10, a.requisitionId]);
  if (m[0]) {
    const r = await recordInviteAnswer(String(m[0].id), TAP[a.answer], { channel: "hr", actor: a.actor, note: fullNote });
    return { responseId: r?.responseId ?? 0, matchId: String(m[0].id), state: r?.state ?? "" };
  }
  const link = await inviteLinkFor({ mobile10, requisitionId: a.requisitionId, leadId: a.leadId ?? null, metaLeadId: a.metaLeadId ?? null, sourcePath: "manual", now: at });
  const t = await resolveAnswerToken(link.token);
  const r = await answerViaInvite(t.kind === "invite" ? t.invite : null, t.kind === "match" ? t.matchId : null, TAP[a.answer], { actor: a.actor, note: fullNote, at });
  return { responseId: r.responseId ?? 0, matchId: r.matchId, state: r.state ?? "" };
}

async function loadForAction(responseId: number, scope: BranchScope): Promise<RowDataPacket> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT cr.id, cr.status, cr.handled_at, cr.match_id, cr.invite_id, cr.mobile10, cr.requisition_id, cr.answer, cr.suggested_answer, jr.branch_name
       FROM candidate_response cr LEFT JOIN job_requisition jr ON jr.id = cr.requisition_id WHERE cr.id = ? LIMIT 1`, [responseId]);
  const r = rows[0];
  if (!r || !inScope(scope, r.branch_name)) throw new ResponseActionError(404, "Reply not found");
  if (r.handled_at != null || r.status !== "needs_review") throw new ResponseActionError(409, "This reply was already handled");
  return r;
}

/** Claim the row for this HR user (one classify / ignore wins when two people click at once). */
async function claim(responseId: number, actor: string, status: string): Promise<void> {
  const [u] = await db.execute<RowDataPacket[]>(
    "UPDATE candidate_response SET handled_by = ?, handled_at = NOW(), status = ? WHERE id = ? AND handled_at IS NULL AND status = 'needs_review'",
    [actor.slice(0, 60), status, responseId]);
  if (Number((u as unknown as { affectedRows?: number }).affectedRows ?? 0) !== 1) throw new ResponseActionError(409, "This reply was already handled");
}

export async function classifyResponse(a: { actor: string; responseId: number; answer: ResponseAnswer; apply: boolean }, scope: BranchScope): Promise<{ status: string; state?: string }> {
  if (!ANSWERS.includes(a.answer)) throw new ResponseActionError(400, "Unknown answer");
  const r = await loadForAction(a.responseId, scope);
  const applies = a.apply && (a.answer === "confirm" || a.answer === "decline" || a.answer === "reschedule");
  await claim(a.responseId, a.actor, "recorded");
  if (!applies) {
    await db.execute("UPDATE candidate_response SET status = ?, answer = ?, suggested_answer = COALESCE(suggested_answer, answer) WHERE id = ?", ["recorded", a.answer, a.responseId]);
    return { status: "recorded" };
  }
  let invite: WalkinInviteRow | null = null;
  if (!r.match_id && r.invite_id) {
    const [w] = await db.execute<RowDataPacket[]>("SELECT * FROM walkin_invite WHERE id = ? LIMIT 1", [r.invite_id]);
    invite = (w[0] as WalkinInviteRow | undefined) ?? null;
  }
  const out = await answerViaInvite(invite, r.match_id ? String(r.match_id) : invite?.match_id ?? null, TAP[a.answer as ManualAnswer], { actor: a.actor, note: `classified response ${a.responseId}`, at: new Date() });
  await db.execute("UPDATE candidate_response SET status = ?, answer = ?, suggested_answer = COALESCE(suggested_answer, answer) WHERE id = ?", ["applied", a.answer, a.responseId]);
  return { status: "applied", state: out.state };
}

export async function ignoreResponse(a: { actor: string; responseId: number; reason: string }, scope: BranchScope): Promise<void> {
  const reason = String(a.reason ?? "").trim();
  if (reason.length < 2 || reason.length > 200) throw new ResponseActionError(400, "Say why (2 to 200 characters)");
  await loadForAction(a.responseId, scope);
  await claim(a.responseId, a.actor, "ignored");
  await writeAuditLog({ actor_user_id: a.actor, action_type: "he_response_ignored", module_key: "hiring_engine", entity_type: "candidate_response", entity_id: String(a.responseId), reason });
}
