/**
 * Free-text email replies to invitation emails become responses for HR review (never applied automatically, owner decision O6).
 * Off until INBOUND_EMAIL_MODE and the IMAP settings are set; dry_run reads and counts only (no writes, cursor not moved).
 * A reply is tied to a person by, in order: an answer token in the reply (the /w/<token> link quoted from our email, or a
 * replies+<token>@ address), In-Reply-To / References pointing at one of our sent emails, then the sender address when it
 * belongs to exactly one person. Anything else is left in the mailbox untouched (not stored). Auto-replies and bounces are skipped.
 */
import type { RowDataPacket } from "mysql2";
import { randomUUID } from "node:crypto";
import { db } from "../../db/mysql.js";
import { logger } from "../../logger.js";
import { normaliseEmail } from "../../shared/email-domains.js";
import { recordResponseSafe } from "./candidate-response.service.js";
import { classifyReply, stripQuoted } from "./response-classifier.js";
import { resolveAnswerToken } from "./walkin-invite.service.js";

export interface InboundEmailConfig { host: string; port: number; secure: boolean; user: string; pass: string; mailbox: string; replyTo: string | null; mode: "off" | "dry_run" | "live" }
export interface InboundMessage {
  uid: number; messageId: string | null; inReplyTo: string | null; references: string[]; from: string | null; to: string[];
  subject: string; text: string; autoSubmitted: string | null;
}
/** The IMAP side, injected so the poller is testable; the real one reads with BODY.PEEK (messages stay unread). */
export interface MailboxClient {
  open(): Promise<{ uidValidity: number; uidNext: number }>;
  fetchSince(uid: number, max: number): Promise<InboundMessage[]>;
  close(): Promise<void>;
}
export interface PollDeps { connect: (c: InboundEmailConfig) => Promise<MailboxClient> }
export interface PollResult { read: number; matched: number; recorded: number; skipped: Record<string, number> }

const MAX_PER_TICK = 200;
const TOKEN_IN_TEXT = /\/w\/([a-f0-9]{32})\b/g;
const TOKEN_IN_ADDRESS = /\+([a-f0-9]{32})@/i;

export function inboundEmailConfig(env: NodeJS.ProcessEnv = process.env): InboundEmailConfig {
  const v = (k: string) => env[k]?.trim() ?? "";
  const mode = v("INBOUND_EMAIL_MODE");
  const base = {
    host: v("INBOUND_EMAIL_IMAP_HOST"), port: Number(v("INBOUND_EMAIL_IMAP_PORT")) || 993, secure: v("INBOUND_EMAIL_IMAP_SECURE") !== "false",
    user: v("INBOUND_EMAIL_IMAP_USER"), pass: v("INBOUND_EMAIL_IMAP_PASS"), mailbox: v("INBOUND_EMAIL_MAILBOX") || "INBOX", replyTo: v("INBOUND_EMAIL_REPLY_TO") || null,
  };
  const configured = !!(base.host && base.user && base.pass);
  return { ...base, mode: configured && (mode === "live" || mode === "dry_run") ? mode : "off" };
}

function isAutoReply(m: InboundMessage): boolean {
  if (m.autoSubmitted && m.autoSubmitted.toLowerCase() !== "no") return true;
  if (/mailer-daemon|postmaster|no-?reply/i.test(m.from ?? "")) return true;
  return /^(auto(matic)?[ -]?reply|out of office|undeliverable|delivery status notification|returned mail|mail delivery)/i.test(m.subject.trim());
}

interface Who { mobile10: string; leadId: string | null; matchId: string | null; inviteId: string | null; metaLeadId: string | null; rule: string }

async function byToken(m: InboundMessage): Promise<Who | null> {
  const tokens = [...`${m.subject}\n${m.text}`.matchAll(TOKEN_IN_TEXT)].map((x) => x[1]);
  for (const a of m.to) { const t = a.match(TOKEN_IN_ADDRESS)?.[1]; if (t) tokens.push(t.toLowerCase()); }
  for (const t of [...new Set(tokens)].slice(0, 5)) {
    const r = await resolveAnswerToken(t);
    if (r.kind === "match") {
      const [rows] = await db.execute<RowDataPacket[]>("SELECT l.id AS lead_id, l.mobile10 FROM he_match m JOIN he_lead l ON l.id = m.lead_id WHERE m.id = ? LIMIT 1", [r.matchId]);
      if (rows[0]) return { mobile10: String(rows[0].mobile10), leadId: String(rows[0].lead_id), matchId: r.matchId, inviteId: null, metaLeadId: null, rule: "token" };
    }
    if (r.kind === "invite") return { mobile10: r.invite.mobile10, leadId: r.invite.lead_id, matchId: null, inviteId: r.invite.id, metaLeadId: r.invite.meta_lead_id, rule: "token" };
  }
  return null;
}

async function byThread(m: InboundMessage): Promise<Who | null> {
  const ids = [m.inReplyTo, ...m.references].filter((x): x is string => !!x).slice(0, 20);
  if (!ids.length) return null;
  const all = [...new Set(ids.flatMap((x) => [x, x.replace(/^<|>$/g, "")]))];
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT lead_id, mobile10 FROM he_message WHERE provider_message_id IN (${all.map(() => "?").join(",")}) AND direction = 'out' LIMIT 1`, all);
  return rows[0] ? { mobile10: String(rows[0].mobile10), leadId: rows[0].lead_id ? String(rows[0].lead_id) : null, matchId: null, inviteId: null, metaLeadId: null, rule: "thread" } : null;
}

async function bySender(m: InboundMessage): Promise<Who | null> {
  const email = normaliseEmail(String(m.from ?? ""));
  if (!email) return null;
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT DISTINCT x.lead_id, x.mobile10 AS mobile10 FROM (
       SELECT l.id AS lead_id, l.mobile10 FROM he_lead l WHERE l.email = ?
       UNION ALL SELECT NULL, RIGHT(REGEXP_REPLACE(r.parsed_phone, '[^0-9]', ''), 10) FROM meta_lead_raw r WHERE r.parsed_email = ?
       UNION ALL SELECT qf.he_lead_id, qf.mobile10 FROM qualified_followup qf WHERE qf.email = ?) x LIMIT 5`, [email, email, email]);
  const mobiles = [...new Set(rows.map((r) => String(r.mobile10 ?? "")).filter((x) => /^[6-9]\d{9}$/.test(x)))];
  if (mobiles.length !== 1) return null;
  const lead = rows.find((r) => String(r.mobile10) === mobiles[0] && (r.lead_id ?? r.id));
  return { mobile10: mobiles[0], leadId: lead ? String(lead.lead_id ?? lead.id) : null, matchId: null, inviteId: null, metaLeadId: null, rule: "sender" };
}

export async function pollInboundEmail(now: Date, deps: Partial<PollDeps> = {}, env: NodeJS.ProcessEnv = process.env): Promise<PollResult> {
  const out: PollResult = { read: 0, matched: 0, recorded: 0, skipped: {} };
  const cfg = inboundEmailConfig(env);
  if (cfg.mode === "off" || !deps.connect) return out;
  const skip = (k: string) => { out.skipped[k] = (out.skipped[k] ?? 0) + 1; };
  const live = cfg.mode === "live";
  const client = await deps.connect(cfg);
  try {
    const box = await client.open();
    const [cur] = await db.execute<RowDataPacket[]>("SELECT uid_validity, last_uid FROM inbound_email_cursor WHERE mailbox = ? LIMIT 1", [cfg.mailbox]);
    const c = cur[0];
    const fresh = !c || Number(c.uid_validity) !== box.uidValidity;
    const start = fresh ? Math.max(0, box.uidNext - MAX_PER_TICK - 1) : Number(c.last_uid);
    const msgs = (await client.fetchSince(start, MAX_PER_TICK)).slice(0, MAX_PER_TICK);
    let maxUid = start;
    for (const m of msgs) {
      out.read++;
      maxUid = Math.max(maxUid, m.uid);
      if (isAutoReply(m)) { skip("auto_reply"); continue; }
      const who = (await byToken(m)) ?? (await byThread(m)) ?? (await bySender(m));
      if (!who) { skip("unknown_sender"); continue; }
      out.matched++;
      if (!live) continue;
      const top = stripQuoted(m.text).slice(0, 2000);
      const s = classifyReply(m.text, { channel: "email" });
      const ref = (m.messageId ?? `uid:${cfg.mailbox}:${box.uidValidity}:${m.uid}`).slice(0, 120);
      try {
        await db.execute("INSERT INTO he_message (id, lead_id, mobile10, direction, channel, body, provider_message_id, intent) VALUES (?,?,?,?,?,?,?,?)",
          [randomUUID(), who.leadId, who.mobile10, "in", "email", top, m.messageId, s.answer]);
      } catch (err) {
        if ((err as { code?: string }).code === "ER_DUP_ENTRY") { skip("duplicate"); continue; }
        throw err;
      }
      const r = await recordResponseSafe({
        occurredAt: now, channel: "email", mode: "text", answer: s.answer, suggested: { answer: s.answer, confidence: s.confidence }, status: "needs_review",
        mobile10: who.mobile10, leadId: who.leadId, matchId: who.matchId, inviteId: who.inviteId, metaLeadId: who.metaLeadId,
        sourceKind: "inbound_email", sourceRef: ref, rawText: top, applied: false,
      });
      if (r.created) out.recorded++; else skip("duplicate");
    }
    if (live && (fresh || maxUid > start)) {
      await db.execute(
        "INSERT INTO inbound_email_cursor (mailbox, uid_validity, last_uid) VALUES (?,?,?) ON DUPLICATE KEY UPDATE uid_validity = VALUES(uid_validity), last_uid = VALUES(last_uid)",
        [cfg.mailbox, box.uidValidity, maxUid]);
    }
  } finally {
    await client.close().catch((err: unknown) => logger.warn({ err: (err as Error).message }, "[inbound-email] close failed"));
  }
  return out;
}
