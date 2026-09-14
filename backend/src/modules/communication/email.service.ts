import nodemailer from "nodemailer";
// Pooling options live on SMTPPool, not SMTPTransport — `pool: true` selects a different
// transport implementation inside nodemailer, and its option type differs accordingly.
import type SMTPPool from "nodemailer/lib/smtp-pool/index.js";
import { env } from "../../config/env.js";

export type EmailAttachment = {
  filename: string;
  /** Path on disk (report files). Mutually exclusive with `content`. */
  path?: string;
  /** In-memory buffer (generated PDFs). Mutually exclusive with `path`. */
  content?: Buffer;
  contentType?: string;
};

export type EmailSendInput = {
  to: string;
  cc?: string;
  /**
   * Added for the notification gateway. Escalation digests and bulk notices go to more
   * than five people, and the catalogue rule is that anything above that becomes BCC so
   * recipients are not exposed to each other.
   */
  bcc?: string;
  replyTo?: string;
  subject: string;
  html: string;
  text?: string;
  attachments?: EmailAttachment[];
};

function smtpSecure(): boolean {
  const explicit = String(process.env.SMTP_SECURE || "").trim().toLowerCase();
  if (["true", "1", "yes"].includes(explicit)) return true;
  if (["false", "0", "no"].includes(explicit)) return false;
  return Number(env.SMTP_PORT) === 465;
}

function fromAddress(): string {
  const name = String(process.env.SMTP_FROM_NAME || "MAS Callnet HRMS").trim().replace(/"/g, "");
  const from = String(env.SMTP_FROM || env.SMTP_USER || "noreply@mascallnet.com").trim();
  return name ? `"${name}" <${from}>` : from;
}

function smtpPassword(): string {
  // Gmail/Google Workspace app passwords are often copied with spaces.
  // SMTP requires the continuous 16-character value.
  return String(env.SMTP_PASS || "").replace(/\s+/g, "");
}

function createTransporter() {
  const options: SMTPPool.Options = {
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: smtpSecure(),
    // Pooled. Previously a fresh transport — and therefore a fresh TCP + TLS handshake —
    // was created for every single message; auth-launch.routes.ts:281 loops up to 500
    // sends in a row. Bounded so a burst cannot exhaust the provider's connection limit.
    pool: true,
    maxConnections: 3,
    maxMessages: 100,
  };

  const pass = smtpPassword();
  if (env.SMTP_USER && pass) {
    options.auth = {
      user: env.SMTP_USER,
      pass,
    };
  }

  return nodemailer.createTransport(options);
}

/**
 * Cached transporter. Keyed on nothing — config is env-only and cannot change at runtime.
 * Reset by resetTransporter() in tests.
 */
let cachedTransporter: ReturnType<typeof createTransporter> | null = null;

function getTransporter() {
  if (!cachedTransporter) cachedTransporter = createTransporter();
  return cachedTransporter;
}

/** Drops the pooled connections. For tests and for a deliberate reconnect. */
export function resetTransporter(): void {
  try { cachedTransporter?.close(); } catch { /* already closed */ }
  cachedTransporter = null;
}

/**
 * Refuses to post a link only the sender's own machine can open.
 *
 * FRONTEND_URL is schema-defaulted to http://localhost:8080, and roughly twenty
 * call sites add their own localhost fallbacks on top. So any of them, run from a
 * developer machine, builds a working-looking link to that machine and mails it
 * to a real person — with nothing in the result to show it was wrong. On
 * 2026-08-06 an EPF review link went to an employee's personal Gmail pointing at
 * localhost:8080, and the send reported success.
 *
 * SMTP is what makes this reach someone, so this is the boundary worth guarding:
 * one check covers every current and future sender. In production FRONTEND_URL is
 * set, so it never fires. The escape hatch exists for deliberately testing a
 * template against a local server.
 */
export function assertNoLocalhostLinks(input: Pick<EmailSendInput, "to" | "html" | "text">) {
  if (String(process.env.ALLOW_LOCALHOST_EMAIL_LINKS ?? "").toLowerCase() === "true") return;
  const body = `${input.html ?? ""}${input.text ?? ""}`;
  // The host must end where it is matched, or "localhost-tools.teammas.in" —
  // a perfectly reachable host — would be rejected as loopback.
  const match = body.match(
    /https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:\d+)?(?=[/?#"'\s>]|$)/i,
  );
  if (!match) return;
  const to = Array.isArray(input.to) ? input.to.join(", ") : String(input.to ?? "");
  throw new Error(
    `Refusing to email a ${match[0]} link to ${to} — the recipient cannot open it. `
    + "Set FRONTEND_URL to the public address, or ALLOW_LOCALHOST_EMAIL_LINKS=true for a local template test.",
  );
}

export const emailService = {
  isConfigured(): boolean {
    return Boolean(env.SMTP_HOST && env.SMTP_PORT && env.SMTP_FROM && env.SMTP_USER && smtpPassword());
  },

  safeConfig() {
    return {
      configured: this.isConfigured(),
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: smtpSecure(),
      userConfigured: Boolean(env.SMTP_USER),
      passConfigured: Boolean(smtpPassword()),
      from: env.SMTP_FROM,
      fromName: process.env.SMTP_FROM_NAME || "MAS Callnet HRMS",
    };
  },

  async verify(): Promise<boolean> {
    if (!this.isConfigured()) return false;
    await getTransporter().verify();
    return true;
  },

  async send(input: EmailSendInput): Promise<{ messageId?: string }> {
    if (!this.isConfigured()) {
      throw new Error("SMTP is not configured. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS and SMTP_FROM.");
    }

    assertNoLocalhostLinks(input);

    const result = await getTransporter().sendMail({
      from: fromAddress(),
      to: input.to,
      ...(input.cc ? { cc: input.cc } : {}),
      ...(input.bcc ? { bcc: input.bcc } : {}),
      ...(input.replyTo ? { replyTo: input.replyTo } : {}),
      subject: input.subject,
      html: input.html,
      text: input.text,
      attachments: input.attachments,
    });

    return { messageId: result.messageId };
  },
};
