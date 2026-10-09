import { describe, expect, it, vi } from "vitest";
import { mailboxFrom, MAX_MESSAGE_BYTES, type ImapLike } from "../inbound-email.imap.js";

describe("IMAP mailbox: size cap before parsing (I-4a)", () => {
  it("reads sizes first, never downloads or parses a message over 2 MB, and marks it too large", async () => {
    const fetchOne = vi.fn(async (uid: string) => ({ uid: Number(uid), source: Buffer.from(`m${uid}`) }));
    const client: ImapLike = {
      mailboxOpen: vi.fn(async () => ({ uidValidity: 7, uidNext: 10 })),
      fetch: async function* () { yield { uid: 5, size: 1000 }; yield { uid: 6, size: MAX_MESSAGE_BYTES + 1 }; yield { uid: 7, size: 2000 }; },
      fetchOne: fetchOne as never, logout: vi.fn(async () => undefined),
    };
    const parse = vi.fn(async (src: unknown, o?: Record<string, unknown>) => ({ messageId: `<${String(src)}@x>`, subject: "Re", text: "yes", from: { value: [{ address: "a@x.in" }] }, headers: new Map(), opts: o }));
    const mb = mailboxFrom(client, parse as never, { mailbox: "INBOX" });
    const msgs = await mb.fetchSince(4, 200);
    expect(msgs.map((m) => [m.uid, !!m.tooLarge])).toEqual([[5, false], [6, true], [7, false]]);
    expect(fetchOne.mock.calls.map((c) => c[0])).toEqual(["5", "7"]);
    expect(parse).toHaveBeenCalledTimes(2);
    expect(parse.mock.calls[0][1]).toMatchObject({ skipTextToHtml: true, skipImageLinks: true });
  });
});
