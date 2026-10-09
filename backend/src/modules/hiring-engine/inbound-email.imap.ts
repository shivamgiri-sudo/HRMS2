/**
 * The real mailbox client for the inbound email poller (imapflow + mailparser). Loaded only when INBOUND_EMAIL_MODE is set, so the
 * app runs without the two packages; installing them is part of switching the poller on (owner decision O2). Messages are read with
 * BODY.PEEK semantics (imapflow fetch without marking seen), so nothing in the mailbox changes.
 */
import type { InboundEmailConfig, InboundMessage, MailboxClient } from "./inbound-email.service.js";

type Loose = Record<string, unknown> & { [k: string]: unknown };
// Package names held in variables so the build does not need the packages installed.
const IMAPFLOW = "imapflow";
const MAILPARSER = "mailparser";

const addrList = (v: unknown): string[] => {
  const a = (v as { value?: Array<{ address?: string }> } | undefined)?.value ?? [];
  return a.map((x) => String(x.address ?? "")).filter(Boolean);
};

/** Messages over this size are never downloaded or parsed (skipped as too_large; the cursor moves past them). */
export const MAX_MESSAGE_BYTES = 2 * 1024 * 1024;

export interface ImapLike {
  mailboxOpen(name: string, o: { readOnly: boolean }): Promise<{ uidValidity: bigint | number; uidNext: number }>;
  fetch(range: string, q: Loose, o: { uid: boolean }): AsyncIterable<{ uid: number; size?: number; source?: Buffer }>;
  fetchOne(seq: string, q: Loose, o: { uid: boolean }): Promise<{ uid: number; source: Buffer } | false>;
  logout(): Promise<void>;
}
type Parser = (src: unknown, o?: Loose) => Promise<Loose>;

/** The mailbox over an imapflow-like client: sizes first (no bodies), then each message under the cap alone, parsed without HTML work. */
export function mailboxFrom(client: ImapLike, simpleParser: Parser, c: Pick<InboundEmailConfig, "mailbox">, maxBytes = MAX_MESSAGE_BYTES): MailboxClient {
  return {
    async open() {
      const box = await client.mailboxOpen(c.mailbox, { readOnly: true });
      return { uidValidity: Number(box.uidValidity), uidNext: Number(box.uidNext) };
    },
    async fetchSince(uid: number, max: number): Promise<InboundMessage[]> {
      const heads: Array<{ uid: number; size: number }> = [];
      for await (const m of client.fetch(`${uid + 1}:*`, { uid: true, size: true }, { uid: true })) if (m.uid > uid) heads.push({ uid: m.uid, size: Number(m.size ?? 0) });
      const out: InboundMessage[] = [];
      for (const h of heads.sort((a, b) => a.uid - b.uid).slice(0, max)) {
        if (h.size > maxBytes) {
          out.push({ uid: h.uid, messageId: null, inReplyTo: null, references: [], from: null, to: [], subject: "", text: "", autoSubmitted: null, tooLarge: true });
          continue;
        }
        const m = await client.fetchOne(String(h.uid), { uid: true, source: true }, { uid: true });
        if (!m || !m.source) continue;
        // Attachments are not used (only the text part is read); the size cap bounds what the parser holds.
        const p = await simpleParser(m.source, { skipImageLinks: true, skipTextToHtml: true, skipTextLinks: true });
        const headers = p.headers as Map<string, unknown> | undefined;
        const refs = p.references;
        out.push({
          uid: h.uid, messageId: (p.messageId as string | undefined) ?? null, inReplyTo: (p.inReplyTo as string | undefined) ?? null,
          references: Array.isArray(refs) ? refs.map(String) : refs ? [String(refs)] : [],
          from: addrList(p.from)[0] ?? null, to: [...addrList(p.to), ...addrList(p.cc)], subject: String(p.subject ?? ""),
          text: String(p.text ?? ""), autoSubmitted: headers?.get("auto-submitted") ? String(headers.get("auto-submitted")) : null,
        });
      }
      return out;
    },
    async close() { await client.logout(); },
  };
}

export async function connectImap(c: InboundEmailConfig): Promise<MailboxClient> {
  const { ImapFlow } = (await import(IMAPFLOW)) as { ImapFlow: new (o: Loose) => Loose };
  const { simpleParser } = (await import(MAILPARSER)) as { simpleParser: Parser };
  const client = new ImapFlow({ host: c.host, port: c.port, secure: c.secure, auth: { user: c.user, pass: c.pass }, logger: false }) as unknown as ImapLike & { connect(): Promise<void> };
  await client.connect();
  return mailboxFrom(client, simpleParser, c);
}
