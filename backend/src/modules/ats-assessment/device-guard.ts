/**
 * Device gate for the candidate assessment kiosk.
 *
 * Candidates registering in person used to be seated at a supervised desktop PC
 * to take this assessment. Once the "Start Assessment" link is just a URL,
 * nothing stopped a candidate opening it on their own phone instead — no
 * supervision, easy to look answers up or get outside help. This module is the
 * single source of truth for detecting that case, used by BOTH runtimes:
 *   - server-side (assessment.service.ts), the actual enforcement boundary;
 *   - client-side (assessment.page.ts's inlined vanilla-JS), for instant
 *     feedback before a round trip — CLIENT_DEVICE_GUARD_SNIPPET below is the
 *     same regex source spliced into that page's <script>, so the two never
 *     drift apart into two different definitions of "mobile".
 *
 * Explicit, accepted limitation: this is user-agent string matching. It stops
 * the realistic threat this was built for — a candidate using their own phone
 * as-is — not a technically determined candidate spoofing their UA (DevTools
 * device emulation, a UA-switcher extension). That is a known, deliberate
 * trade-off, not a gap to silently paper over. iPadOS Safari's default
 * "Request Desktop" UA is indistinguishable from macOS Safari by UA string
 * alone, so an iPad in that default mode is NOT blocked — also accepted, not
 * a bug (an iPad in classic mobile-Safari UA mode, which self-identifies,
 * IS blocked).
 */

/** Regex source only (not a compiled RegExp) so it can be embedded verbatim into the client-side snippet below. */
export const MOBILE_UA_PATTERN_SOURCE =
  "android|iphone|ipod|ipad|blackberry|iemobile|opera mini|windows phone|mobile|tablet|kindle|silk|playbook";

/**
 * True if the given User-Agent string looks like a phone/tablet browser.
 * Fails OPEN (returns false) on a null/empty UA — required so calls that
 * don't pass meta at all (e.g. the existing integration test suite) keep
 * working unmodified, and so a missing header never blocks a real desktop
 * candidate by accident.
 */
export function isBlockedDeviceUserAgent(userAgent: string | null | undefined): boolean {
  if (!userAgent) return false;
  return new RegExp(MOBILE_UA_PATTERN_SOURCE, "i").test(userAgent);
}

/**
 * Kill switch. Defaults to enabled — unlike ATS_IDENTITY_CHECK_ENABLED
 * elsewhere in this module (which defaults OFF because it's an optional
 * feature), this gate defaults ON because it IS the fix being shipped. Set
 * ATS_ASSESSMENT_DEVICE_GATE_ENABLED=false and restart to instantly restore
 * the old (unrestricted) behavior with no code change, if this ever
 * misfires against a real candidate.
 */
export function isDeviceGateEnabled(): boolean {
  return String(process.env.ATS_ASSESSMENT_DEVICE_GATE_ENABLED ?? "true").toLowerCase() !== "false";
}

/**
 * Candidate-facing rejection copy. Personalized when a recruiter could be
 * resolved for this candidate; a generic instruction (no fabricated contact
 * details) otherwise.
 */
export function deviceBlockMessage(recruiterName?: string | null, recruiterMobile?: string | null): string {
  const contact = recruiterName
    ? `Contact your recruiter ${recruiterName}${recruiterMobile ? ` (${recruiterMobile})` : ""} for help.`
    : "Contact the recruiter who registered you for help.";
  return `This assessment must be completed on a desktop or laptop computer, not a phone or tablet. ${contact}`;
}

/**
 * Vanilla-JS source spliced into assessment.page.ts's inline <script>.
 * Defines window-global `isBlockedDevice()` for the page's own IIFE to call.
 * Built from MOBILE_UA_PATTERN_SOURCE so the browser and the server can never
 * disagree about what counts as "mobile".
 */
export const CLIENT_DEVICE_GUARD_SNIPPET =
  `const MOBILE_UA_RE=new RegExp(${JSON.stringify(MOBILE_UA_PATTERN_SOURCE)},"i");` +
  `function isBlockedDevice(){return MOBILE_UA_RE.test(navigator.userAgent||"")}`;
