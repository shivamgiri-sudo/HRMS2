/** Validation for job_requisition.bmi_assessment_url, the per-requisition assessment link sent in invites. */
export const BMI_LINK_MAX_LENGTH = 500;

export type BmiLinkResult = { ok: true; value: string | null } | { ok: false; message: string };

export function normalizeBmiLink(raw: unknown): BmiLinkResult {
  if (raw === null || raw === undefined) return { ok: true, value: null };
  if (typeof raw !== "string") return { ok: false, message: "Assessment link must be text" };
  const value = raw.trim();
  if (value === "") return { ok: true, value: null };
  if (value.length > BMI_LINK_MAX_LENGTH) {
    return { ok: false, message: `Assessment link must be at most ${BMI_LINK_MAX_LENGTH} characters` };
  }
  // Printable ASCII only: rejects spaces, control and zero-width chars; non-ASCII hosts must be punycode.
  if (/[^\x21-\x7e]/.test(value)) {
    return { ok: false, message: "Assessment link must use plain ASCII characters without spaces (use punycode for non-English domains)" };
  }
  if (!/^https:\/\//.test(value)) return { ok: false, message: "Assessment link must start with https://" };
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, message: "Assessment link must be a valid https URL" };
  }
  if (url.protocol !== "https:" || !url.hostname) {
    return { ok: false, message: "Assessment link must be a valid https URL" };
  }
  if (url.username || url.password) {
    return { ok: false, message: "Assessment link must not contain a username or password" };
  }
  return { ok: true, value };
}
