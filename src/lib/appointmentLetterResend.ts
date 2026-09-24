/**
 * Validation for the "Resend appointment letter" dialog.
 *
 * Mirrors the server's rules (backend/src/modules/letters/appointmentLetterResendRecipients.ts)
 * so HR sees a problem before the request goes out. The server still re-checks
 * everything — this is only there to give an inline message.
 */
export const MAX_CUSTOM_RECIPIENTS = 3;
export const MIN_REASON_LENGTH = 8;
export const MAX_REASON_LENGTH = 500;
const MAX_EMAIL_LENGTH = 254;

const EMAIL_SHAPE =
  /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

export type ResendMode = "onfile" | "custom";
export type ResendFormState = { mode: ResendMode; addresses: string[]; reason: string };
export type ResendValidation = {
  valid: boolean;
  /** Normalised addresses to send; empty for the one-click on-file option. */
  recipients: string[];
  /** One entry per input row: a message, or null when that row is fine. */
  addressErrors: Array<string | null>;
  reasonError: string | null;
};

export const normaliseAddress = (v: string): string => v.trim().toLowerCase();

/** A problem with a single typed address, or null. Blank is not judged here. */
export function addressProblem(raw: string): string | null {
  const email = normaliseAddress(raw);
  if (!email) return null;
  if (email.length > MAX_EMAIL_LENGTH) return `Must be ${MAX_EMAIL_LENGTH} characters or fewer.`;
  if (!EMAIL_SHAPE.test(email) || (email.split("@")[0]?.length ?? 0) > 64) return "Enter a valid email address.";
  return null;
}

export function validateResendForm(state: ResendFormState): ResendValidation {
  if (state.mode === "onfile") {
    return { valid: true, recipients: [], addressErrors: [], reasonError: null };
  }

  const seen = new Set<string>();
  const addressErrors = state.addresses.map((raw, i): string | null => {
    const email = normaliseAddress(raw);
    // Extra rows may be left blank; the first row is the one that must be filled.
    if (!email) return i === 0 ? "Enter an email address." : null;
    const problem = addressProblem(raw);
    if (problem) return problem;
    if (seen.has(email)) return "This address is already listed.";
    seen.add(email);
    return null;
  });

  const reason = state.reason.trim();
  const reasonError =
    reason.length < MIN_REASON_LENGTH ? `Give a reason of at least ${MIN_REASON_LENGTH} characters.`
    : reason.length > MAX_REASON_LENGTH ? `Keep the reason under ${MAX_REASON_LENGTH} characters.`
    : null;

  const recipients = state.addresses.map(normaliseAddress).filter(Boolean);
  const valid = addressErrors.every((e) => e === null) && recipients.length >= 1 && reasonError === null;
  return { valid, recipients: valid ? recipients : [], addressErrors, reasonError };
}
