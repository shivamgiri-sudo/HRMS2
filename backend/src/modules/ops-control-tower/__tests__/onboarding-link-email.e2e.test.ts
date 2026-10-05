// End-to-end (in-memory DB) check of the Ops "Email link" action: the REAL emailOnboardingLink,
// the REAL ATS email template/sender (nodemailer captured) and the REAL validateOnboardingToken that
// the candidate's browser hits. Proves the emailed link is the one the public onboarding page accepts.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const h = vi.hoisted(() => ({
  dbExecute: vi.fn(),
  sendMail: vi.fn(),
  createTransport: vi.fn(),
  env: { FRONTEND_URL: "https://hrms.test", SMTP_USER: "u", SMTP_PASS: "ab cd ef", SMTP_FROM: "hr@test", SMTP_HOST: "smtp", SMTP_PORT: "587" } as Record<string, string>,
}));
vi.mock("../../../db/mysql.js", () => ({ db: { execute: h.dbExecute, query: h.dbExecute } }));
vi.mock("../../../config/env.js", () => ({ env: h.env }));
h.createTransport.mockImplementation(() => ({ sendMail: h.sendMail }));
vi.mock("nodemailer", () => ({ default: { createTransport: (...a: unknown[]) => h.createTransport(...a) } }));
vi.mock("../../communication/providers/provider.factory.js", () => ({
  providerFactory: { getProvider: () => ({ send: vi.fn(), isConfigured: () => true }) },
}));
vi.mock("../ops-control-tower.service.js", () => ({
  allBranches: vi.fn(async () => []),
  getAccountDetailsMissingDetail: vi.fn(), getDocsPendingDetail: vi.fn(), getAppointmentLetterDetail: vi.fn(),
  getBgvPendingDetail: vi.fn(), getAddressReviewPendingDetail: vi.fn(), getDigilockerPendingDetail: vi.fn(), getEsignPendingDetail: vi.fn(), getPennyDropMissingDetail: vi.fn(),
}));

import { emailOnboardingLink } from "../ops-nudge.service.js";
import { validateOnboardingToken } from "../../ats/onboarding-full.service.js";

const NOW = new Date("2026-10-03T10:00:00Z").getTime();
let bridge: { candidate_id: string; employee_id: string; token: string | null; expires: Date | null } | null;
let cand: { email: string | null; mobile: string; status: string | null };
let emp: { full_name: string; personal_email: string | null; email: string | null; mobile: string };
let emailLog: unknown[][];

beforeEach(() => {
  h.dbExecute.mockReset(); h.sendMail.mockReset(); emailLog = [];
  h.env.SMTP_USER = "u"; h.env.SMTP_PASS = "ab cd ef";
  bridge = { candidate_id: "c1", employee_id: "e1", token: "old-token", expires: new Date(NOW + 5 * 86_400_000) };
  cand = { email: "asha@example.com", mobile: "9999999999", status: null };
  emp = { full_name: "Asha <Rao>", personal_email: "asha.personal@example.com", email: null, mobile: "9999999999" };
  h.sendMail.mockResolvedValue({});
  h.dbExecute.mockImplementation(async (sql: string, params: unknown[] = []) => {
    const q = sql.replace(/\s+/g, " ");
    if (q.includes("c.email AS cand_email")) {
      return [[{ full_name: emp.full_name, cand_email: bridge ? cand.email : null, personal_email: emp.personal_email, emp_email: emp.email }]];
    }
    if (q.includes("e.mobile AS emp_mobile")) {
      return [[{ full_name: emp.full_name, branch_id: "b1", emp_mobile: emp.mobile, candidate_id: bridge?.candidate_id ?? null,
        cand_mobile: cand.mobile, candidate_status: cand.status, onboarding_token: bridge?.token ?? null,
        onboarding_token_expires_at: bridge?.expires ?? null, days_open: 3 }]];
    }
    if (q.startsWith("UPDATE ats_onboarding_bridge SET onboarding_token")) {
      if (!bridge || bridge.candidate_id !== params[2]) return [{ affectedRows: 0 }];
      bridge.token = String(params[0]); bridge.expires = params[1] as Date;
      return [{ affectedRows: 1 }];
    }
    if (q.includes("SELECT onboarding_token_expires_at AS exp")) return [bridge ? [{ exp: bridge.expires }] : []];
    if (q.includes("SELECT candidate_id FROM ats_onboarding_bridge WHERE employee_id")) return [bridge ? [{ candidate_id: bridge.candidate_id }] : []];
    if (q.includes("INSERT IGNORE INTO ats_email_log")) { emailLog.push(params); return [{}]; }
    if (q.includes("WHERE b.onboarding_token = ?")) {
      return [bridge && bridge.token === params[0]
        ? [{ candidate_id: bridge.candidate_id, onboarding_token_expires_at: bridge.expires, id: bridge.candidate_id,
             candidate_code: "C-1", full_name: emp.full_name, email: cand.email, mobile: cand.mobile }]
        : []];
    }
    if (q.includes("candidate_onboarding_profile")) return [[]];
    throw new Error(`unexpected SQL: ${q.slice(0, 120)}`);
  });
});

const sentMail = () => h.sendMail.mock.calls[0]?.[0] as { to: string; subject: string; html: string } | undefined;
const linkIn = (html: string) => /https:\/\/hrms\.test\/onboard-full\?token=([0-9a-zA-Z-]+)/.exec(html);

describe("Ops Email link — delivery and link validity", () => {
  it("live token: emails the SAME token, and the public validator accepts it", async () => {
    const out = await emailOnboardingLink("e1", NOW);
    expect(out).toEqual({ status: "sent", sentTo: "asha@example.com" });
    const mail = sentMail()!;
    expect(mail.to).toBe("asha@example.com");
    const token = linkIn(mail.html)![1];
    expect(token).toBe("old-token");
    const profile = await validateOnboardingToken(token);
    expect(profile.candidate_id).toBe("c1");
    expect(emailLog[0]).toContain("sent");
  });

  it("expired token: re-issues a 72h token; new link validates; the old token is dead", async () => {
    bridge!.expires = new Date(NOW - 3600_000);
    const out = await emailOnboardingLink("e1", NOW);
    expect(out.status).toBe("sent");
    const html = sentMail()!.html;
    const token = linkIn(html)![1];
    expect(token).not.toBe("old-token");
    expect(token).toMatch(/^[0-9a-f-]{36}-[0-9a-f-]{36}$/);
    expect(bridge!.token).toBe(token);
    expect(bridge!.expires!.getTime()).toBe(NOW + 72 * 3600_000);
    expect(html).toContain("valid for 3 days");
    expect(html).not.toContain("valid for 15 days");
    await expect(validateOnboardingToken("old-token")).rejects.toThrow("Invalid onboarding token");
    // validator compares against the real clock; expiry sits in the real past/future relative to "now" below
    bridge!.expires = new Date(Date.now() + 72 * 3600_000);
    expect((await validateOnboardingToken(token)).candidate_id).toBe("c1");
  });

  it("a link past its expiry is rejected by the validator (410)", async () => {
    bridge!.expires = new Date(Date.now() - 1000);
    await expect(validateOnboardingToken("old-token")).rejects.toThrow("Onboarding token expired");
  });

  it("missing token (null) is minted fresh", async () => {
    bridge!.token = null; bridge!.expires = null;
    expect((await emailOnboardingLink("e1", NOW)).status).toBe("sent");
    expect(bridge!.token).toBeTruthy();
    expect(linkIn(sentMail()!.html)![1]).toBe(bridge!.token);
  });

  it("falls back to personal email, then employee email, when the candidate has none", async () => {
    cand.email = null;
    expect(await emailOnboardingLink("e1", NOW)).toEqual({ status: "sent", sentTo: "asha.personal@example.com" });
    h.sendMail.mockClear(); emp.personal_email = null; emp.email = "asha.work@example.com";
    expect(await emailOnboardingLink("e1", NOW)).toEqual({ status: "sent", sentTo: "asha.work@example.com" });
  });

  it("no usable email: nothing sent, token untouched", async () => {
    cand.email = "not-an-email"; emp.personal_email = null; emp.email = null;
    bridge!.expires = new Date(NOW - 1000);
    expect((await emailOnboardingLink("e1", NOW)).status).toBe("no_email");
    expect(h.sendMail).not.toHaveBeenCalled();
    expect(bridge!.token).toBe("old-token");
  });

  it("no onboarding record (manually created employee): no_link, nothing sent", async () => {
    bridge = null;
    expect((await emailOnboardingLink("e1", NOW)).status).toBe("no_link");
    expect(h.sendMail).not.toHaveBeenCalled();
  });

  it("candidate marked not joining: no link is issued or emailed", async () => {
    cand.status = "not_joining";
    expect((await emailOnboardingLink("e1", NOW)).status).toBe("no_link");
    expect(h.sendMail).not.toHaveBeenCalled();
  });

  it("SMTP not configured: reports failure instead of a false 'sent'", async () => {
    h.env.SMTP_USER = ""; h.env.SMTP_PASS = "";
    const out = await emailOnboardingLink("e1", NOW);
    expect(out.status).toBe("failed");
    expect(h.sendMail).not.toHaveBeenCalled();
  });

  it("SMTP rejects: reports the real error and logs a failed email", async () => {
    h.sendMail.mockRejectedValue(new Error("421 try again later"));
    const out = await emailOnboardingLink("e1", NOW);
    expect(out).toEqual({ status: "failed", error: "421 try again later" });
    expect(emailLog[0]).toContain("failed");
  });

  it("uses the shared pooled mailer: app-password spaces stripped, Gmail 421 retried, then delivered", async () => {
    h.sendMail.mockRejectedValueOnce(Object.assign(new Error("421-4.3.0 Temporary System Problem"), { responseCode: 421 }));
    const out = await emailOnboardingLink("e1", NOW);
    expect(out.status).toBe("sent");
    expect(h.sendMail).toHaveBeenCalledTimes(2);
    const opts = h.createTransport.mock.calls.map((c) => c[0] as { auth: { pass: string }; pool?: boolean }).find((o) => o.pool)!;
    expect(opts.auth.pass).toBe("abcdef");
    expect(opts.pool).toBe(true);
  }, 20_000);

  it("a permanent 5xx (bad auth) is not retried and is reported", async () => {
    h.sendMail.mockRejectedValue(Object.assign(new Error("535 5.7.8 Username and Password not accepted"), { responseCode: 535 }));
    const out = await emailOnboardingLink("e1", NOW);
    expect(out).toEqual({ status: "failed", error: "535 5.7.8 Username and Password not accepted" });
    expect(h.sendMail).toHaveBeenCalledTimes(1);
  });

  it("HTML-escapes the employee name in the email body", async () => {
    await emailOnboardingLink("e1", NOW);
    const html = sentMail()!.html;
    expect(html).toContain("Asha &lt;Rao&gt;");
    expect(html).not.toContain("Asha <Rao>");
  });

  it("the emailed path is the route the frontend actually serves", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const routes = readFileSync(resolve(here, "../../../../../src/config/routes/public.routes.tsx"), "utf8");
    expect(routes).toContain('path="/onboard-full"');
  });
});
