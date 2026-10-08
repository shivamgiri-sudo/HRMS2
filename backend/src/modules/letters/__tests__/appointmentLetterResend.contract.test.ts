/**
 * HR "Resend link" and the accept token minted at issue time.
 *
 * The raw accept token is never stored, so a resend must mint a NEW one; the
 * verification token (printed as a QR on the signed PDF) must never be touched.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "crypto";

const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");

type Call = { sql: string; params: unknown[] };
const calls: Call[] = [];
const audits: Array<{ action: string }> = [];
let letter: Record<string, unknown> | undefined;

vi.mock("../../../db/mysql.js", () => ({
  db: {
    execute: vi.fn(async (sql: string, params: unknown[] = []) => {
      const text = String(sql).replace(/\s+/g, " ");
      calls.push({ sql: text, params });
      if (text.includes("FROM appointment_letter_issue i LEFT JOIN employees e")) return [letter ? [letter] : []];
      return [{ affectedRows: 1 }];
    }),
  },
}));
vi.mock("../../../config/env.js", () => ({ env: { FRONTEND_URL: "https://hrms.test/" } }));
vi.mock("../appointmentLetterAudit.js", () => ({
  auditAppointmentLetter: vi.fn(async (_i: string | null, action: string) => { audits.push({ action }); }),
}));
vi.mock("../appointmentLetterEsign.service.js", () => ({ syncAppointmentEsignForIssue: vi.fn() }));
// The real builder is covered in the wiring test; here it just needs to carry the link through.
vi.mock("../appointmentLetterIssue.service.js", () => ({
  buildAppointmentLetterEmailHtml: (d: { acceptUrl: string; verifyUrl: string | null }) =>
    `<a href="${d.acceptUrl}">accept</a>|verify=${d.verifyUrl}`,
}));
const send = vi.fn();
vi.mock("../../communication/email.service.js", () => ({ emailService: { send: (...a: unknown[]) => send(...a) } }));

const { resendAppointmentAcceptLink } = await import("../appointmentLetterResend.service.js");

const baseLetter = () => ({
  id: "issue-1", letter_number: "MCN-AL-2026-000123", employee_code: "MAS1", employee_name: "HARSH TALWAR",
  designation: "EXECUTIVE", date_of_joining: new Date("2025-09-25T18:30:00Z"),
  signed_file_path: "C:/definitely/not/here.pdf", status: "issued", revoked_at: null,
  employee_esign_status: "sent", accept_token_hash: "oldhash",
  personal_email: "harsh@example.com", official_email: "harsh@mas.in",
  process_name: "P1", reporting_manager_name: "Boss",
});
const hashWrites = () => calls.filter((c) => c.sql.startsWith("UPDATE appointment_letter_issue SET accept_token_hash"));

beforeEach(() => {
  calls.length = 0; audits.length = 0; send.mockReset(); send.mockResolvedValue({});
  letter = baseLetter();
});

describe("resendAppointmentAcceptLink", () => {
  it("mints a fresh token, stores only its hash, and emails the new link to every address", async () => {
    const out = await resendAppointmentAcceptLink({ issueId: "issue-1", actorUserId: "hr-1" });
    expect(out).toMatchObject({ resent: true, emailedTo: ["harsh@example.com", "harsh@mas.in"] });

    const stored = hashWrites()[0].params[0] as string;
    expect(stored).toMatch(/^[0-9a-f]{64}$/);
    expect(stored).not.toBe("oldhash");

    const html = String(send.mock.calls[0][0].html);
    const token = html.match(/employee\/appointment-letter\/([0-9a-f]{48})/)![1];
    expect(sha256(token)).toBe(stored);
    expect(html).toContain("https://hrms.test/employee/appointment-letter/"); // base URL normalised, no double slash
    expect(send).toHaveBeenCalledTimes(2);
    expect(audits.map((a) => a.action)).toContain("LINK_RESENT");
  });

  it("never rotates the verification token that is printed on the signed PDF", async () => {
    await resendAppointmentAcceptLink({ issueId: "issue-1", actorUserId: "hr-1" });
    expect(calls.some((c) => c.sql.includes("verify_token_hash") && c.sql.startsWith("UPDATE"))).toBe(false);
    // ...and does not try to repeat a verification link it cannot reconstruct.
    expect(String(send.mock.calls[0][0].html)).toContain("verify=null");
  });

  it("if no email could be sent, the previous link is put back rather than left dead", async () => {
    send.mockRejectedValue(new Error("smtp down"));
    const out = await resendAppointmentAcceptLink({ issueId: "issue-1", actorUserId: "hr-1" });
    expect(out.resent).toBe(false);
    expect(out.message).toContain("smtp down");
    const writes = hashWrites();
    expect(writes).toHaveLength(2);
    expect(writes[1].params[0]).toBe("oldhash");
    expect(writes[1].params[2]).toBe(writes[0].params[0]); // only reverts if nobody minted another meanwhile
    expect(audits.map((a) => a.action)).toContain("LINK_RESEND_EMAIL_FAILED");
  });

  it.each([
    ["status", { status: "revoked" }],
    ["revoked_at", { revoked_at: new Date() }],
  ])("refuses a revoked letter (%s)", async (_l, patch) => {
    letter = { ...baseLetter(), ...patch };
    const out = await resendAppointmentAcceptLink({ issueId: "issue-1", actorUserId: "hr-1" });
    expect(out.resent).toBe(false);
    expect(send).not.toHaveBeenCalled();
    expect(hashWrites()).toHaveLength(0);
  });

  it("refuses when the employee has already accepted", async () => {
    letter = { ...baseLetter(), employee_esign_status: "signed" };
    const out = await resendAppointmentAcceptLink({ issueId: "issue-1", actorUserId: "hr-1" });
    expect(out.resent).toBe(false);
    expect(hashWrites()).toHaveLength(0);
  });

  it("refuses, without minting anything, when there is nowhere to send it", async () => {
    letter = { ...baseLetter(), personal_email: null, official_email: "" };
    const out = await resendAppointmentAcceptLink({ issueId: "issue-1", actorUserId: "hr-1" });
    expect(out).toMatchObject({ resent: false, message: expect.stringMatching(/no email/i) });
    expect(hashWrites()).toHaveLength(0);
  });

  it("404s an unknown letter", async () => {
    letter = undefined;
    await expect(resendAppointmentAcceptLink({ issueId: "nope", actorUserId: "hr-1" })).rejects.toMatchObject({ statusCode: 404 });
  });
});
