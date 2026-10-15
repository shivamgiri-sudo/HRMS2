import nodemailer from "nodemailer";
// Pooling options live on SMTPPool, not SMTPTransport — `pool: true` selects a different
// transport implementation inside nodemailer, and its option type differs accordingly.
import type SMTPPool from "nodemailer/lib/smtp-pool/index.js";
import { env } from "../../config/env.js";
import { smtpRateLimitPerMinute, withSmtpRetry } from "./smtp-retry.js";

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
  /** Threading: the Message-Id this mail answers, and the thread's references. */
  inReplyTo?: string;
  references?: string[];
  subject: string;
  html: string;
  text?: string;
  attachments?: EmailAttachment[];
  /**
   * Which mailbox pool sends this. Default is the shared HRMS account. "careers" is the pool of
   * Careers mailboxes (CAREERS_SMTP_ACCOUNTS) used for candidate-facing hiring mail, so that
   * volume stops sharing - and exhausting - the staff/HRMS account's daily Gmail limit.
   */
  pool?: "careers";
};

/** Thrown without touching SMTP while a mailbox is known to be over its daily sending limit. */
export class EmailQuotaError extends Error {
  readonly code = "EMAIL_QUOTA";
  constructor(message = "Daily email sending limit reached; send deferred") { super(message); }
}

/** Gmail "550-5.4.5 Daily user sending limit exceeded". Permanent for the day, not a bad address. */
export function isDailyLimitError(error: unknown): boolean {
  const msg = String((error as { message?: unknown } | null)?.message ?? error ?? "");
  const rc = Number((error as { responseCode?: unknown } | null)?.responseCode);
  return /5\.4\.5|daily user sending (limit|quota)|sending limit exceeded/i.test(msg) || (rc === 550 && /limit/i.test(msg));
}

/** How long a mailbox is left alone after Gmail reports its daily limit (it resets on a rolling window). */
const QUOTA_BLOCK_MS = Math.max(5, Number(process.env.SMTP_QUOTA_BLOCK_MINUTES) || 60) * 60_000;

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

function createTransporter(account?: { host: string; port: number; user: string; pass: string }) {
  const port = account?.port ?? env.SMTP_PORT;
  const isSecurePort = port === 465;
  const options: SMTPPool.Options = {
    host: account?.host ?? env.SMTP_HOST,
    port,
    secure: isSecurePort,
    // Port 25/587 non-SSL: force STARTTLS before credentials are sent.
    // Without this flag a misconfigured pool can attempt AUTH on a plain connection
    // and receive 535 even when the server supports STARTTLS.
    ...(!isSecurePort ? { requireTLS: true, tls: { rejectUnauthorized: false } } : {}),
    // Pooled. Previously a fresh transport — and therefore a fresh TCP + TLS handshake —
    // was created for every single message; auth-launch.routes.ts:281 loops up to 500
    // sends in a row. Bounded so a burst cannot exhaust the provider's connection limit.
    pool: true,
    maxConnections: 3,
    maxMessages: 100,
    // Throttle: a burst is queued by the pool instead of tripping Gmail's 421 limiter.
    rateDelta: 60_000,
    rateLimit: smtpRateLimitPerMinute(),
  };

  const user = account?.user ?? env.SMTP_USER;
  const pass = account ? account.pass : smtpPassword();
  if (user && pass) options.auth = { user, pass };

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
  for (const a of careersAccounts) { try { a.transporter?.close(); } catch { /* closed */ } a.transporter = null; a.blockedUntil = 0; }
  careersAccounts = [];
  careersLoaded = false;
  defaultBlockedUntil = 0;
}

let defaultBlockedUntil = 0;

type CareersAccount = { user: string; pass: string; transporter: ReturnType<typeof createTransporter> | null; blockedUntil: number };
let careersAccounts: CareersAccount[] = [];
let careersLoaded = false;
let careersCursor = 0;

/**
 * CAREERS_SMTP_ACCOUNTS = "a@x.com,b@x.com" (each entry "user" or "user|password"); CAREERS_SMTP_PASS is the
 * shared password for entries that carry none. Host/port default to the main SMTP settings.
 */
function loadCareersAccounts(): CareersAccount[] {
  if (careersLoaded) return careersAccounts;
  careersLoaded = true;
  const shared = String(process.env.CAREERS_SMTP_PASS || "").replace(/\s+/g, "");
  careersAccounts = String(process.env.CAREERS_SMTP_ACCOUNTS || "")
    .split(",").map((x) => x.trim()).filter(Boolean)
    .map((entry) => {
      const [user, pw] = entry.split("|");
      return { user: user!.trim(), pass: (pw ?? shared).replace(/\s+/g, ""), transporter: null, blockedUntil: 0 };
    })
    .filter((a) => a.user && a.pass);
  return careersAccounts;
}

function careersConfig() {
  return {
    host: String(process.env.CAREERS_SMTP_HOST || env.SMTP_HOST),
    port: Number(process.env.CAREERS_SMTP_PORT) || env.SMTP_PORT,
    fromName: String(process.env.CAREERS_SMTP_FROM_NAME || "MAS Careers").replace(/"/g, ""),
  };
}

/** Next careers mailbox that is not over its limit (round robin), or null when none is usable. */
function pickCareersAccount(): CareersAccount | null {
  const list = loadCareersAccounts();
  const now = Date.now();
  for (let i = 0; i < list.length; i++) {
    const a = list[(careersCursor + i) % list.length]!;
    if (a.blockedUntil <= now) { careersCursor = (careersCursor + i + 1) % list.length; return a; }
  }
  return null;
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

  /** True when some mailbox is configured for the pool (the default account backs an unconfigured careers pool). */
  hasTransport(pool?: "careers"): boolean {
    return (pool === "careers" && loadCareersAccounts().length > 0) || this.isConfigured();
  },

  /** True when the pool a caller would use has a mailbox that is not over its daily limit. */
  canSend(pool?: "careers"): boolean {
    if (pool === "careers" && loadCareersAccounts().length) return loadCareersAccounts().some((a) => a.blockedUntil <= Date.now());
    return this.isConfigured() && defaultBlockedUntil <= Date.now();
  },

  async send(input: EmailSendInput): Promise<{ messageId?: string }> {
    const careers = input.pool === "careers" && loadCareersAccounts().length > 0;
    if (!careers && !this.isConfigured()) {
      throw new Error("SMTP is not configured. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS and SMTP_FROM.");
    }

    assertNoLocalhostLinks(input);

    // A mailbox over its daily limit is skipped without an SMTP attempt: retrying only burns login
    // attempts (Gmail answers "454 Too many login attempts") and marks rows failed for good.
    const message = {
      to: input.to,
      ...(input.cc ? { cc: input.cc } : {}),
      ...(input.bcc ? { bcc: input.bcc } : {}),
      ...(input.replyTo ? { replyTo: input.replyTo } : {}),
      ...(input.inReplyTo ? { inReplyTo: input.inReplyTo } : {}),
      ...(input.references?.length ? { references: input.references } : {}),
      subject: input.subject,
      html: input.html,
      text: input.text,
      attachments: input.attachments,
    };

    if (!careers) {
      if (defaultBlockedUntil > Date.now()) throw new EmailQuotaError();
      try {
        const result = await withSmtpRetry(() => getTransporter().sendMail({ from: fromAddress(), ...message }));
        return { messageId: result.messageId };
      } catch (err) {
        if (isDailyLimitError(err)) {
          defaultBlockedUntil = Date.now() + QUOTA_BLOCK_MS;
          throw new EmailQuotaError(String((err as Error).message));
        }
        throw err;
      }
    }

    // Careers pool: round robin; a mailbox that reports its limit is parked and the next one is tried.
    for (;;) {
      const account = pickCareersAccount();
      if (!account) throw new EmailQuotaError("All careers mailboxes are at their daily sending limit");
      const transporter = (account.transporter ??= createTransporter({ ...careersConfig(), user: account.user, pass: account.pass }));
      try {
        const result = await withSmtpRetry(() => transporter.sendMail({ from: `"${careersConfig().fromName}" <${account.user}>`, ...message }));
        return { messageId: result.messageId };
      } catch (err) {
        if (!isDailyLimitError(err)) throw err;
        account.blockedUntil = Date.now() + QUOTA_BLOCK_MS;
      }
    }
  },
};
