/**
 * Input rules for "resend to a different email address".
 *
 * Kept free of any database or mail dependency so the same rules are cheap to
 * test exhaustively. The address goes into an SMTP `To:` header and receives a
 * link to a letter carrying the employee's salary, so the rules are deliberately
 * stricter than a generic "looks like an email" check.
 */
import { isPlausibleEmail } from "../../shared/email-domains.js";

export const MAX_CUSTOM_RECIPIENTS = 3;
export const MIN_REASON_LENGTH = 8;
export const MAX_REASON_LENGTH = 500;
export const MAX_EMAIL_LENGTH = 254;
const MAX_LOCAL_PART = 64;

// Dot-atom local part + LDH domain labels with at least one dot. Quoted local
// parts, IP-literal domains and comments are legal RFC 5322 but are never what
// HR means and are exactly the shapes used to smuggle a second address.
const EMAIL_SHAPE =
  /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
// Checked on the RAW value: trim() would silently strip a trailing CR/LF and let
// a header-injection attempt through as if it were clean.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\x00-\x1f\x7f\u2028\u2029]/;

export class ResendInputError extends Error {
  readonly statusCode = 400;
  constructor(message: string) {
    super(message);
    this.name = "ResendInputError";
  }
}

export type CustomResendRequest = { recipients: string[]; reason: string };

/** Lowercased/trimmed address, or a ResendInputError naming the bad value's position. */
export function normaliseRecipient(raw: unknown, index: number): string {
  const label = `Email address ${index + 1}`;
  if (typeof raw !== "string") throw new ResendInputError(`${label} must be text.`);
  if (CONTROL_CHARS.test(raw)) throw new ResendInputError(`${label} contains invalid characters.`);
  const email = raw.trim().toLowerCase();
  if (!email) throw new ResendInputError(`${label} is empty.`);
  if (email.length > MAX_EMAIL_LENGTH) throw new ResendInputError(`${label} is longer than ${MAX_EMAIL_LENGTH} characters.`);
  const local = email.split("@")[0] ?? "";
  if (!isPlausibleEmail(email) || !EMAIL_SHAPE.test(email) || local.length > MAX_LOCAL_PART) {
    throw new ResendInputError(`"${email}" is not a valid email address.`);
  }
  return email;
}

/**
 * Parse the optional resend body.
 *
 * Returns null for the classic one-click resend (no `recipients` key at all), so
 * that path is untouched. Any `recipients` key — even an empty array — opts into
 * the custom path and is validated in full.
 */
export function parseResendRequest(body: unknown): CustomResendRequest | null {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return null;
  const b = body as Record<string, unknown>;
  if (b.recipients === undefined || b.recipients === null) return null;

  if (!Array.isArray(b.recipients)) throw new ResendInputError("recipients must be a list of email addresses.");
  if (b.recipients.length < 1) throw new ResendInputError("Provide at least one email address.");
  if (b.recipients.length > MAX_CUSTOM_RECIPIENTS) {
    throw new ResendInputError(`You can send to at most ${MAX_CUSTOM_RECIPIENTS} email addresses at a time.`);
  }
  const recipients = b.recipients.map((r, i) => normaliseRecipient(r, i));
  const seen = new Set<string>();
  for (const r of recipients) {
    if (seen.has(r)) throw new ResendInputError(`"${r}" is listed more than once.`);
    seen.add(r);
  }

  const reason = typeof b.reason === "string" ? b.reason.trim() : "";
  if (reason.length < MIN_REASON_LENGTH) {
    throw new ResendInputError(`A reason of at least ${MIN_REASON_LENGTH} characters is required when sending to a different email address.`);
  }
  if (reason.length > MAX_REASON_LENGTH) {
    throw new ResendInputError(`The reason must be ${MAX_REASON_LENGTH} characters or fewer.`);
  }
  return { recipients, reason };
}

/** `j***@g***.com` — hides the mailbox and the domain name, keeps the TLD. */
export function maskEmailAddress(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 1) return "***@***";
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const dot = domain.lastIndexOf(".");
  const host = dot > 0 ? domain.slice(0, dot) : domain;
  const tld = dot > 0 ? domain.slice(dot) : "";
  return `${local[0]}***@${host[0] ?? "*"}***${tld}`;
}
