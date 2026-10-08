import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  sqls: [] as string[],
  params: [] as unknown[][],
  match: null as null | { id: string; token: string },
  invite: null as null | Record<string, unknown>,
  matchByToken: null as null | { id: string },
}));

vi.mock("../../../db/mysql.js", () => ({
  db: {
    execute: vi.fn(async (sql: string, p: unknown[] = []) => {
      h.sqls.push(sql);
      h.params.push(p);
      if (sql.includes("FROM he_match m JOIN he_lead l") && sql.includes("l.mobile10 = ?")) return [h.match ? [h.match] : []];
      if (sql.startsWith("INSERT INTO walkin_invite")) {
        if (!h.invite) h.invite = { id: p[0], token: p[1], state: "sent", match_id: null, send_count: 1 };
        else h.invite = { ...h.invite, send_count: Number(h.invite.send_count) + 1, state: ["declined", "stopped"].includes(String(h.invite.state)) ? h.invite.state : "sent" };
        return [{ affectedRows: 1 }];
      }
      if (sql.includes("FROM walkin_invite WHERE mobile10 = ?")) return [h.invite ? [h.invite] : []];
      if (sql.includes("SELECT id FROM he_match WHERE token = ?")) return [h.matchByToken ? [h.matchByToken] : []];
      if (sql.includes("FROM walkin_invite WHERE token = ?")) return [h.invite && h.invite.token === p[0] ? [h.invite] : []];
      return [[]];
    }),
  },
}));

import { inviteLinkFor, markInviteAnswered, resolveAnswerToken } from "../walkin-invite.service.js";
import { answerButtonsHtml, answerButtonsText, publicBaseUrl, stopLinkHtml } from "../he-email-parts.js";
import { buildInviteEmail } from "../he-email.service.js";

const now = new Date("2026-10-08T06:00:00Z");
const input = { mobile10: "9876543210", requisitionId: "R1", metaLeadId: "ML1", branchName: "NOIDA-2", slotAt: "2026-10-09 11:00:00", sourcePath: "legacy_meta" as const, now };

beforeEach(() => {
  h.sqls = []; h.params = []; h.match = null; h.invite = null; h.matchByToken = null;
  process.env.HE_PUBLIC_BASE_URL = "https://x";
});

describe("inviteLinkFor", () => {
  it("returns the match token when an he_match exists", async () => {
    h.match = { id: "M1", token: "a".repeat(32) };
    const l = await inviteLinkFor(input);
    expect(l).toEqual({ kind: "match", token: "a".repeat(32), answerUrl: `https://x/w/${"a".repeat(32)}`, matchId: "M1", inviteId: null });
    expect(h.sqls.some((s) => /INSERT|UPDATE/.test(s))).toBe(false);
  });

  it("creates one invite per mobile+requisition and reuses its token on re-send", async () => {
    const a = await inviteLinkFor(input);
    expect(a.kind).toBe("invite");
    expect(a.token).toMatch(/^[a-f0-9]{32}$/);
    const b = await inviteLinkFor({ ...input, slotAt: "2026-10-10 12:00:00" });
    expect(b.token).toBe(a.token);
    expect(b.inviteId).toBe(a.inviteId);
    const ins = h.sqls.filter((s) => s.startsWith("INSERT INTO walkin_invite"));
    expect(ins).toHaveLength(2);
    expect(ins[0]).toContain("ON DUPLICATE KEY UPDATE");
    expect(ins[0]).toContain("send_count = send_count + 1");
    expect(h.invite!.send_count).toBe(2);
  });

  it("a declined invite keeps its state on re-send", async () => {
    await inviteLinkFor(input);
    h.invite!.state = "declined";
    const l = await inviteLinkFor(input);
    expect(l.kind).toBe("invite");
    expect(h.invite!.state).toBe("declined");
    expect(h.sqls.find((s) => s.startsWith("INSERT INTO walkin_invite"))).toContain("IF(state IN ('declined','stopped'), state, 'sent')");
  });

  it("simulate writes nothing and returns the demo token", async () => {
    const l = await inviteLinkFor(input, { simulate: true });
    expect(l).toEqual({ kind: "invite", token: "0".repeat(32), answerUrl: `https://x/w/${"0".repeat(32)}`, matchId: null, inviteId: null });
    expect(h.sqls.some((s) => /INSERT|UPDATE/.test(s))).toBe(false);
  });

  it("simulate with a chosen token returns it, then the live call stores that same token", async () => {
    const t = "b".repeat(32);
    const s = await inviteLinkFor(input, { simulate: true, token: t });
    expect(s.token).toBe(t);
    const l = await inviteLinkFor(input, { token: t });
    expect(l.token).toBe(t);
    expect(h.params.find((_, i) => h.sqls[i].startsWith("INSERT INTO walkin_invite"))![1]).toBe(t);
  });

  it("simulate on an existing invite returns its token (reads only)", async () => {
    await inviteLinkFor(input);
    const tok = h.invite!.token;
    h.sqls = [];
    const s = await inviteLinkFor(input, { simulate: true, token: "c".repeat(32) });
    expect(s.token).toBe(tok);
    expect(h.sqls.some((x) => /INSERT|UPDATE/.test(x))).toBe(false);
  });

  it("rejects a mobile that is not 10 digits", async () => {
    await expect(inviteLinkFor({ ...input, mobile10: "12345" })).rejects.toThrow(/mobile/);
  });
});

describe("resolveAnswerToken", () => {
  it("bad format → invalid; demo → demo", async () => {
    expect(await resolveAnswerToken("nope")).toEqual({ kind: "invalid" });
    expect(await resolveAnswerToken("0".repeat(32))).toEqual({ kind: "demo" });
    expect(h.sqls).toHaveLength(0);
  });
  it("a match token → match", async () => {
    h.matchByToken = { id: "M9" };
    expect(await resolveAnswerToken("d".repeat(32))).toEqual({ kind: "match", matchId: "M9" });
  });
  it("invite with match_id → match; without → invite; unknown → invalid", async () => {
    h.invite = { id: "I1", token: "e".repeat(32), state: "answered_yes", match_id: "M2" };
    expect(await resolveAnswerToken("e".repeat(32))).toEqual({ kind: "match", matchId: "M2" });
    h.invite = { id: "I1", token: "e".repeat(32), state: "sent", match_id: null };
    const r = await resolveAnswerToken("e".repeat(32));
    expect(r.kind).toBe("invite");
    expect(await resolveAnswerToken("f".repeat(32))).toEqual({ kind: "invalid" });
  });
  it("markInviteAnswered stamps state, answered_at and the match", async () => {
    await markInviteAnswered("I1", "answered_yes", "M3");
    expect(h.sqls[0]).toMatch(/UPDATE walkin_invite SET state = \?, answered_at = NOW\(\), match_id = COALESCE\(\?, match_id\) WHERE id = \?/);
    expect(h.params[0]).toEqual(["answered_yes", "M3", "I1"]);
  });
});

describe("he-email-parts", () => {
  const u = "https://x.test/w/0123456789abcdef0123456789abcdef";
  const base = { name: "A", role: "R", company: "C", branch: "B", address: "", date: "D", time: "T", maps: null, docs: "Aadhaar", reference: "HE-1", contact: "" };
  it("answerButtonsHtml(url) equals the block buildInviteEmail produced", () => {
    const withB = buildInviteEmail({ ...base, answerUrl: u }).html;
    const without = buildInviteEmail({ ...base, answerUrl: null }).html;
    expect(withB).toContain(answerButtonsHtml(u));
    expect(withB.replace(answerButtonsHtml(u), "")).toBe(without);
  });
  it("answerButtonsText matches the text line", () => {
    expect(buildInviteEmail({ ...base, answerUrl: u }).text).toContain(answerButtonsText(u).trim());
  });
  it("a subset of keys renders only those buttons", () => {
    const s = answerButtonsHtml(u, ["yes", "no"]);
    expect(s).toContain("?a=yes");
    expect(s).toContain("?a=no");
    expect(s).not.toContain("?a=later");
  });
  it("stopLinkHtml points to ?a=stop", () => {
    expect(stopLinkHtml(u)).toContain(`href="${u}?a=stop"`);
    expect(stopLinkHtml(u)).toContain("Stop messages");
  });
  it("publicBaseUrl falls back in order and strips the trailing slash", () => {
    expect(publicBaseUrl({ HE_PUBLIC_BASE_URL: "https://a/" } as NodeJS.ProcessEnv)).toBe("https://a");
    expect(publicBaseUrl({ FRONTEND_URL: "https://b" } as NodeJS.ProcessEnv)).toBe("https://b");
    expect(publicBaseUrl({} as NodeJS.ProcessEnv)).toBe("https://mcnhrms.teammas.in");
  });
});
