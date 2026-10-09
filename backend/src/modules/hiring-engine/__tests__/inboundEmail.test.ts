import { beforeEach, describe, expect, it, vi } from "vitest";

type Msg = { uid: number; messageId: string | null; inReplyTo: string | null; references: string[]; from: string | null; to: string[]; subject: string; text: string; autoSubmitted: string | null };
const h = vi.hoisted(() => ({
  sqls: [] as Array<{ sql: string; p: unknown[] }>,
  cursor: null as null | { uid_validity: number; last_uid: number },
  outbound: new Map<string, string>(),
  leadsByEmail: new Map<string, Array<{ id: string; mobile10: string }>>(),
  seenMsgIds: new Set<string>(),
  responses: [] as Array<Record<string, unknown>>,
  tokens: new Map<string, unknown>(),
}));
vi.mock("../../../db/mysql.js", () => ({
  db: {
    execute: vi.fn(async (sql: string, p: unknown[] = []) => {
      h.sqls.push({ sql, p });
      if (sql.includes("FROM inbound_email_cursor")) return [h.cursor ? [h.cursor] : []];
      if (sql.includes("FROM he_message WHERE provider_message_id IN")) return [(p as string[]).filter((x) => h.outbound.has(x)).map((x) => ({ lead_id: h.outbound.get(x), mobile10: "9876543210" }))];
      if (sql.includes("AS mobile10 FROM (")) return [h.leadsByEmail.get(String(p[0])) ?? []];
      if (sql.includes("FROM he_match m JOIN he_lead l ON l.id = m.lead_id WHERE m.id = ?")) return [[{ lead_id: "L1", mobile10: "9876543210" }]];
      if (sql.startsWith("INSERT INTO he_message")) {
        const id = String(p[6]);
        if (h.seenMsgIds.has(id)) throw Object.assign(new Error("dup"), { code: "ER_DUP_ENTRY" });
        h.seenMsgIds.add(id); return [{ affectedRows: 1 }];
      }
      return [{ affectedRows: 1 }];
    }),
  },
}));
vi.mock("../candidate-response.service.js", () => ({
  recordResponseSafe: vi.fn(async (r: Record<string, unknown>) => {
    if (h.responses.some((x) => x.sourceRef === r.sourceRef)) return { id: 1, created: false, dedupeOf: null, conflict: false };
    h.responses.push(r); return { id: h.responses.length, created: true, dedupeOf: null, conflict: false };
  }),
}));
vi.mock("../walkin-invite.service.js", () => ({ resolveAnswerToken: vi.fn(async (t: string) => h.tokens.get(t) ?? { kind: "invalid" }) }));

import { inboundEmailConfig, pollInboundEmail } from "../inbound-email.service.js";

const live = { INBOUND_EMAIL_MODE: "live", INBOUND_EMAIL_IMAP_HOST: "imap.x", INBOUND_EMAIL_IMAP_USER: "u", INBOUND_EMAIL_IMAP_PASS: "p" } as NodeJS.ProcessEnv;
const msg = (o: Partial<Msg>): Msg => ({ uid: 1, messageId: "<m1@x>", inReplyTo: null, references: [], from: "asha@x.in", to: ["hr@x.in"], subject: "Re: Walk-in interview", text: "Yes I will come", autoSubmitted: null, ...o });
function client(msgs: Msg[], box = { uidValidity: 7, uidNext: 500 }) {
  const c = { open: vi.fn(async () => box), fetchSince: vi.fn(async (uid: number) => msgs.filter((m) => m.uid > uid)), close: vi.fn(async () => undefined) };
  return { c, connect: vi.fn(async () => c) };
}
const now = new Date("2026-10-08T06:00:00Z");
const cursorWrites = () => h.sqls.filter((s) => s.sql.startsWith("INSERT INTO inbound_email_cursor"));

beforeEach(() => {
  h.sqls = []; h.cursor = { uid_validity: 7, last_uid: 0 }; h.outbound = new Map(); h.leadsByEmail = new Map(); h.seenMsgIds = new Set(); h.responses = []; h.tokens = new Map();
});

describe("inbound email", () => {
  it("config: off unless the mode is set; defaults INBOX / 993 / secure", () => {
    expect(inboundEmailConfig({} as NodeJS.ProcessEnv).mode).toBe("off");
    expect(inboundEmailConfig(live)).toMatchObject({ mode: "live", host: "imap.x", port: 993, secure: true, mailbox: "INBOX" });
    expect(inboundEmailConfig({ ...live, INBOUND_EMAIL_IMAP_HOST: "" }).mode).toBe("off");
  });

  it("off: no connection and not even a query", async () => {
    const { connect } = client([msg({})]);
    expect(await pollInboundEmail(now, { connect }, {} as NodeJS.ProcessEnv)).toMatchObject({ read: 0 });
    expect(connect).not.toHaveBeenCalled();
    expect(h.sqls).toHaveLength(0);
  });

  it("matches by the answer token in the reply first", async () => {
    h.tokens.set("a".repeat(32), { kind: "match", matchId: "M1" });
    const { connect } = client([msg({ text: `ok\n\nOn Thu wrote:\n> https://x/w/${"a".repeat(32)}?a=yes` , from: "someone@else.in" })]);
    const r = await pollInboundEmail(now, { connect }, live);
    expect(r).toMatchObject({ read: 1, matched: 1, recorded: 1 });
    expect(h.responses[0]).toMatchObject({ channel: "email", mode: "text", status: "needs_review", matchId: "M1", mobile10: "9876543210", sourceKind: "inbound_email", sourceRef: "<m1@x>" });
  });

  it("then by the plus-address token, then In-Reply-To, then the sender address (exactly one person)", async () => {
    h.tokens.set("b".repeat(32), { kind: "invite", invite: { id: "I1", mobile10: "9876500000", lead_id: null, meta_lead_id: "ML1" } });
    h.outbound.set("<out-1@x>", "L2");
    h.leadsByEmail.set("asha@x.in", [{ id: "L3", mobile10: "9876511111" }]);
    h.leadsByEmail.set("two@x.in", [{ id: "L4", mobile10: "9876522222" }, { id: "L5", mobile10: "9876533333" }]);
    const { connect } = client([
      msg({ uid: 1, messageId: "<a@x>", to: [`replies+${"b".repeat(32)}@x.in`], from: "x@y.in" }),
      msg({ uid: 2, messageId: "<b@x>", inReplyTo: "<out-1@x>", from: "x@y.in" }),
      msg({ uid: 3, messageId: "<c@x>" }),
      msg({ uid: 4, messageId: "<d@x>", from: "two@x.in" }),
    ]);
    const r = await pollInboundEmail(now, { connect }, live);
    expect(r).toMatchObject({ read: 4, matched: 3, recorded: 3, skipped: { unknown_sender: 1 } });
    expect(h.responses.map((x) => [x.inviteId ?? null, x.leadId ?? null, x.mobile10])).toEqual([["I1", null, "9876500000"], [null, "L2", "9876543210"], [null, "L3", "9876511111"]]);
    // the rule is kept: token / thread are verified; a match by the From header only is an unverified sender
    expect(h.responses.map((x) => x.sourceKind)).toEqual(["inbound_email", "email_thread", "email_sender"]);
  });

  it("I-4c: one poison message (a failing write) is skipped and the cursor still moves past it", async () => {
    h.leadsByEmail.set("asha@x.in", [{ id: "L3", mobile10: "9876511111" }]);
    const { db } = await import("../../../db/mysql.js");
    const orig = vi.mocked(db.execute).getMockImplementation()!;
    vi.mocked(db.execute).mockImplementation((async (sql: string, p: unknown[] = []) => {
      if (sql.startsWith("INSERT INTO he_message") && String(p[6]).includes("poison")) throw Object.assign(new Error("Incorrect string value"), { code: "ER_TRUNCATED_WRONG_VALUE_FOR_FIELD" });
      return orig(sql, p);
    }) as never);
    const { connect } = client([msg({ uid: 3, messageId: "<poison@x>" }), msg({ uid: 4, messageId: "<ok@x>" })]);
    const r = await pollInboundEmail(now, { connect }, live);
    vi.mocked(db.execute).mockImplementation(orig as never);
    expect(r).toMatchObject({ read: 2, recorded: 1, skipped: { error: 1 } });
    expect(cursorWrites().at(-1)!.p).toEqual(["INBOX", 7, 4]);
  });

  it("I-4c: a Message-ID longer than the column (120) is truncated, never rejected", async () => {
    h.leadsByEmail.set("asha@x.in", [{ id: "L3", mobile10: "9876511111" }]);
    const long = `<${"x".repeat(300)}@x>`;
    const { connect } = client([msg({ messageId: long })]);
    await pollInboundEmail(now, { connect }, live);
    const ins = h.sqls.find((s) => s.sql.startsWith("INSERT INTO he_message"))!;
    expect(String(ins.p[6]).length).toBe(120);
  });

  it("I-4a: a message the client marked too large is skipped (never parsed) and the cursor moves past it", async () => {
    h.leadsByEmail.set("asha@x.in", [{ id: "L3", mobile10: "9876511111" }]);
    const { connect } = client([msg({ uid: 6, tooLarge: true } as Partial<Msg>)]);
    const r = await pollInboundEmail(now, { connect }, live);
    expect(r).toMatchObject({ read: 1, matched: 0, skipped: { too_large: 1 } });
    expect(cursorWrites().at(-1)!.p).toEqual(["INBOX", 7, 6]);
  });

  it("unknown sender is skipped and nothing is stored", async () => {
    const { connect } = client([msg({ from: "nobody@x.in" })]);
    const r = await pollInboundEmail(now, { connect }, live);
    expect(r.skipped).toEqual({ unknown_sender: 1 });
    expect(h.responses).toHaveLength(0);
    expect(h.sqls.some((s) => s.sql.startsWith("INSERT INTO he_message"))).toBe(false);
  });

  it("auto-replies and bounces are skipped", async () => {
    h.leadsByEmail.set("asha@x.in", [{ id: "L3", mobile10: "9876511111" }]);
    const { connect } = client([msg({ uid: 1, autoSubmitted: "auto-replied" }), msg({ uid: 2, from: "MAILER-DAEMON@x.in" }), msg({ uid: 3, subject: "Out of Office: Re: Walk-in" })]);
    const r = await pollInboundEmail(now, { connect }, live);
    expect(r).toMatchObject({ read: 3, recorded: 0, skipped: { auto_reply: 3 } });
  });

  it("the suggestion comes from the top part only; the stored body is capped", async () => {
    h.leadsByEmail.set("asha@x.in", [{ id: "L3", mobile10: "9876511111" }]);
    const { connect } = client([msg({ text: `${"Cannot come sorry. ".repeat(200)}\n> Yes, I will come` })]);
    await pollInboundEmail(now, { connect }, live);
    expect(h.responses[0]).toMatchObject({ answer: "decline", suggested: { answer: "decline", confidence: 0.9 } });
    const ins = h.sqls.find((s) => s.sql.startsWith("INSERT INTO he_message"))!;
    expect(String(ins.p[5]).length).toBeLessThanOrEqual(2000);
    expect(String(ins.p[5])).not.toContain("Yes, I will come");
  });

  it("a duplicate Message-ID records one response", async () => {
    h.leadsByEmail.set("asha@x.in", [{ id: "L3", mobile10: "9876511111" }]);
    const { connect } = client([msg({ uid: 1 }), msg({ uid: 2 })]);
    await pollInboundEmail(now, { connect }, live);
    expect(h.responses).toHaveLength(1);
  });

  it("live advances the cursor; dry_run writes nothing and leaves it", async () => {
    h.leadsByEmail.set("asha@x.in", [{ id: "L3", mobile10: "9876511111" }]);
    const a = client([msg({ uid: 5 }), msg({ uid: 9, messageId: "<m9@x>" })]);
    await pollInboundEmail(now, { connect: a.connect }, live);
    expect(cursorWrites().at(-1)!.p).toEqual(["INBOX", 7, 9]);
    h.sqls = []; h.responses = [];
    const b = client([msg({ uid: 12, messageId: "<m12@x>" })]);
    const r = await pollInboundEmail(now, { connect: b.connect }, { ...live, INBOUND_EMAIL_MODE: "dry_run" });
    expect(r).toMatchObject({ read: 1, matched: 1, recorded: 0 });
    expect(h.sqls.filter((s) => /^(INSERT|UPDATE)/.test(s.sql))).toHaveLength(0);
    expect(h.responses).toHaveLength(0);
  });

  it("UIDVALIDITY change → starts again from the newest 200", async () => {
    h.cursor = { uid_validity: 6, last_uid: 450 };
    const { c, connect } = client([], { uidValidity: 7, uidNext: 1000 });
    await pollInboundEmail(now, { connect }, live);
    expect(c.fetchSince).toHaveBeenCalledWith(799, 200);
  });
});
