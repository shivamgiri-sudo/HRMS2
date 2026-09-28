/**
 * HR "Resend link" to a DIFFERENT email address.
 *
 * The letter carries salary, so the custom path is stricter than the one-click
 * resend: reason required, rate-limited, audited in full, and the registered
 * address is told. The one-click path (no body) must be untouched — its own
 * tests live in appointmentLetterResend.contract.test.ts and still run.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "crypto";

const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");

type Call = { sql: string; params: unknown[] };
const calls: Call[] = [];
const audits: Array<{ action: string; detail: Record<string, unknown> }> = [];
let letter: Record<string, unknown> | undefined;
let recentResends = 0;
let auditRows: Array<Record<string, unknown>> = [];

vi.mock("../../../db/mysql.js", () => ({
  db: {
    execute: vi.fn(async (sql: string, params: unknown[] = []) => {
      const text = String(sql).replace(/\s+/g, " ");
      calls.push({ sql: text, params });
      if (text.includes("FROM appointment_letter_issue i LEFT JOIN employees e")) return [letter ? [letter] : []];
      if (text.includes("COUNT(*) AS n FROM appointment_letter_issue_audit")) return [[{ n: recentResends }]];
      if (text.includes("FROM appointment_letter_issue_audit")) return [auditRows];
      if (text.includes("FROM auth_user")) return [[{ id: "hr-1", email: "hr@teammas.in" }]];
      return [{ affectedRows: 1 }];
    }),
  },
}));
vi.mock("../../../config/env.js", () => ({ env: { FRONTEND_URL: "https://hrms.test/" } }));
vi.mock("../appointmentLetterAudit.js", () => ({
  auditAppointmentLetter: vi.fn(async (_i: string | null, action: string, _a: string | null, detail: Record<string, unknown>) => {
    audits.push({ action, detail });
  }),
}));
vi.mock("../appointmentLetterEsign.service.js", () => ({ syncAppointmentEsignForIssue: vi.fn() }));
vi.mock("../appointmentLetterIssue.service.js", () => ({
  buildAppointmentLetterEmailHtml: (d: { acceptUrl: string }) => `<a href="${d.acceptUrl}">accept</a>`,
}));
const send = vi.fn();
vi.mock("../../communication/email.service.js", () => ({ emailService: { send: (...a: unknown[]) => send(...a) } }));

const { resendAppointmentAcceptLink, getAppointmentResendOptions } = await import("../appointmentLetterResend.service.js");

const baseLetter = () => ({
  id: "issue-1", letter_number: "MCN-AL-2026-000123", employee_code: "MAS1", employee_name: "HARSH TALWAR",
  designation: "EXECUTIVE", date_of_joining: new Date("2025-09-25T18:30:00Z"),
  signed_file_path: "C:/definitely/not/here.pdf", status: "issued", revoked_at: null,
  employee_esign_status: "sent", accept_token_hash: "oldhash",
  personal_email: "harsh@example.com", official_email: "harsh@mas.in",
  process_name: "P1", reporting_manager_name: "Boss",
});
const hashWrites = () => calls.filter((c) => c.sql.startsWith("UPDATE appointment_letter_issue SET accept_token_hash"));
const custom = (recipients: string[], reason = "Employee lost access to inbox") => ({ recipients, reason });
const linkMails = () => send.mock.calls.filter((c) => String(c[0].subject).startsWith("Reminder:"));
const noticeMails = () => send.mock.calls.filter((c) => String(c[0].subject).startsWith("Security notice"));

beforeEach(() => {
  calls.length = 0; audits.length = 0; send.mockReset(); send.mockResolvedValue({});
  recentResends = 0; auditRows = [];
  letter = baseLetter();
});

describe("resendAppointmentAcceptLink — custom recipients", () => {
  it("emails ONLY the given address with the link, never the on-file ones", async () => {
    const out = await resendAppointmentAcceptLink({ issueId: "issue-1", actorUserId: "hr-1", custom: custom(["new.person@gmail.com"]) });
    expect(out).toMatchObject({ resent: true, emailedTo: ["new.person@gmail.com"], letterNumber: "MCN-AL-2026-000123" });
    expect(out.sentAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(linkMails().map((c) => c[0].to)).toEqual(["new.person@gmail.com"]);
    expect(String(linkMails()[0][0].html)).toContain("/employee/appointment-letter/");
    expect(out.message).toContain("n***@g***.com");
    expect(out.message).not.toContain("new.person@gmail.com");
  });

  it("mints a new token so the old inbox loses access", async () => {
    await resendAppointmentAcceptLink({ issueId: "issue-1", actorUserId: "hr-1", custom: custom(["new@gmail.com"]) });
    const stored = hashWrites()[0].params[0] as string;
    expect(stored).toMatch(/^[0-9a-f]{64}$/);
    expect(stored).not.toBe("oldhash");
    const token = String(linkMails()[0][0].html).match(/employee\/appointment-letter\/([0-9a-f]{48})/)![1];
    expect(sha256(token)).toBe(stored);
  });

  it("never rotates the verification token", async () => {
    await resendAppointmentAcceptLink({ issueId: "issue-1", actorUserId: "hr-1", custom: custom(["new@gmail.com"]) });
    expect(calls.some((c) => c.sql.includes("verify_token_hash") && c.sql.startsWith("UPDATE"))).toBe(false);
  });

  it("audits LINK_RESENT with full addresses, per-address onFile flags and the reason", async () => {
    await resendAppointmentAcceptLink({
      issueId: "issue-1", actorUserId: "hr-1",
      custom: custom(["new@gmail.com", "harsh@example.com"], "Employee gave a new address"),
    });
    const audit = audits.find((a) => a.action === "LINK_RESENT")!;
    expect(audit.detail).toMatchObject({
      emailedTo: ["new@gmail.com", "harsh@example.com"],
      customRecipients: true,
      reason: "Employee gave a new address",
      onFile: [{ address: "new@gmail.com", onFile: false }, { address: "harsh@example.com", onFile: true }],
    });
  });

  it("tells the registered addresses, with a masked recipient and no link or salary", async () => {
    await resendAppointmentAcceptLink({ issueId: "issue-1", actorUserId: "hr-1", custom: custom(["jane@gmail.com"]) });
    expect(noticeMails().map((c) => c[0].to).sort()).toEqual(["harsh@example.com", "harsh@mas.in"]);
    const html = String(noticeMails()[0][0].html);
    expect(html).toContain("j***@g***.com");
    expect(html).not.toContain("jane@gmail.com");
    expect(html).not.toMatch(/employee\/appointment-letter|http|salary|CTC/i);
    expect(noticeMails()[0][0].attachments).toBeUndefined();
  });

  it("does not send a notice to an on-file address that itself received the link", async () => {
    await resendAppointmentAcceptLink({ issueId: "issue-1", actorUserId: "hr-1", custom: custom(["harsh@mas.in"]) });
    expect(noticeMails().map((c) => c[0].to)).toEqual(["harsh@example.com"]);
  });

  it("works when the employee has no address on file, and sends no notice", async () => {
    letter = { ...baseLetter(), personal_email: null, official_email: null };
    const out = await resendAppointmentAcceptLink({ issueId: "issue-1", actorUserId: "hr-1", custom: custom(["new@gmail.com"]) });
    expect(out.resent).toBe(true);
    expect(noticeMails()).toHaveLength(0);
  });

  it("a failing security notice never fails the resend or rolls the link back", async () => {
    send.mockImplementation(async (m: { subject: string }) => {
      if (m.subject.startsWith("Security notice")) throw new Error("notice smtp down");
      return {};
    });
    const out = await resendAppointmentAcceptLink({ issueId: "issue-1", actorUserId: "hr-1", custom: custom(["new@gmail.com"]) });
    expect(out.resent).toBe(true);
    expect(hashWrites()).toHaveLength(1);
    expect(audits.find((a) => a.action === "LINK_RESENT")!.detail.registeredAddressNotified).toBe(false);
  });

  it.each([
    ["revoked status", { status: "revoked" }],
    ["revoked_at", { revoked_at: new Date() }],
    ["signed", { employee_esign_status: "signed" }],
    ["completed", { employee_esign_status: "completed" }],
  ])("refuses a letter that is %s, without minting or mailing", async (_l, patch) => {
    letter = { ...baseLetter(), ...patch };
    const out = await resendAppointmentAcceptLink({ issueId: "issue-1", actorUserId: "hr-1", custom: custom(["new@gmail.com"]) });
    expect(out.resent).toBe(false);
    expect(out.status).toBeUndefined(); // route answers 409
    expect(out.message).toMatch(/revoked|accepted/);
    expect(hashWrites()).toHaveLength(0);
    expect(send).not.toHaveBeenCalled();
  });

  it("rate-limits at 5 resends per rolling hour with 429 and touches nothing", async () => {
    recentResends = 5;
    const out = await resendAppointmentAcceptLink({ issueId: "issue-1", actorUserId: "hr-1", custom: custom(["new@gmail.com"]) });
    expect(out).toMatchObject({ resent: false, status: 429, message: expect.stringMatching(/last hour/i) });
    expect(hashWrites()).toHaveLength(0);
    expect(send).not.toHaveBeenCalled();
    expect(calls.find((c) => c.sql.includes("INTERVAL 1 HOUR"))?.params).toEqual(["issue-1"]);
  });

  it("allows the 5th resend (4 already in the hour)", async () => {
    recentResends = 4;
    const out = await resendAppointmentAcceptLink({ issueId: "issue-1", actorUserId: "hr-1", custom: custom(["new@gmail.com"]) });
    expect(out.resent).toBe(true);
  });

  it("if the link email fails, restores the previous link and audits the failure with the reason", async () => {
    send.mockRejectedValue(new Error("smtp down"));
    const out = await resendAppointmentAcceptLink({ issueId: "issue-1", actorUserId: "hr-1", custom: custom(["new@gmail.com"]) });
    expect(out.resent).toBe(false);
    expect(hashWrites()[1].params[0]).toBe("oldhash");
    expect(audits.find((a) => a.action === "LINK_RESEND_EMAIL_FAILED")!.detail).toMatchObject({ reason: "Employee lost access to inbox" });
    expect(noticeMails()).toHaveLength(0);
  });
});

describe("resendAppointmentAcceptLink — default path is unchanged", () => {
  it("does not rate-limit, send a notice, or add audit fields", async () => {
    recentResends = 99;
    const out = await resendAppointmentAcceptLink({ issueId: "issue-1", actorUserId: "hr-1" });
    expect(out).toMatchObject({ resent: true, emailedTo: ["harsh@example.com", "harsh@mas.in"] });
    expect(noticeMails()).toHaveLength(0);
    expect(calls.some((c) => c.sql.includes("COUNT(*)"))).toBe(false);
    expect(audits.find((a) => a.action === "LINK_RESENT")!.detail).toEqual({ emailedTo: ["harsh@example.com", "harsh@mas.in"] });
  });

  it("an explicit null custom is the same as none", async () => {
    const out = await resendAppointmentAcceptLink({ issueId: "issue-1", actorUserId: "hr-1", custom: null });
    expect(send.mock.calls.map((c) => c[0].to)).toEqual(["harsh@example.com", "harsh@mas.in"]);
    expect(out.resent).toBe(true);
  });
});

describe("getAppointmentResendOptions", () => {
  it("returns masked on-file addresses and a masked, attributed history", async () => {
    auditRows = [
      { id: "a1", action: "LINK_RESENT", actor_user_id: "hr-1", acted_at: new Date("2026-09-24T10:00:00Z"),
        detail_json: JSON.stringify({ emailedTo: ["jane@gmail.com"], customRecipients: true, reason: "Lost inbox access" }) },
      { id: "a2", action: "LINK_RESENT", actor_user_id: null, acted_at: new Date("2026-09-23T10:00:00Z"),
        detail_json: { emailedTo: ["harsh@example.com"] } },
    ];
    const out = await getAppointmentResendOptions("issue-1");
    expect(out.onFile).toEqual([
      { kind: "personal", masked: "h***@e***.com" },
      { kind: "official", masked: "h***@m***.in" },
    ]);
    expect(out.history[0]).toMatchObject({ outcome: "sent", custom: true, recipients: ["j***@g***.com"], reason: "Lost inbox access", actor: "hr@teammas.in" });
    expect(out.history[1]).toMatchObject({ custom: false, reason: null, actor: null });
    expect(JSON.stringify(out)).not.toContain("jane@gmail.com");
    expect(JSON.stringify(out)).not.toContain("harsh@example.com");
  });

  it("404s an unknown letter", async () => {
    letter = undefined;
    await expect(getAppointmentResendOptions("nope")).rejects.toMatchObject({ statusCode: 404 });
  });
});
