/**
 * Refusals that the person on the other end is meant to read.
 *
 * `errorHandler.ts` forwards `error.message` to the client only when the error carries a
 * `statusCode`. Anything thrown bare is classified as an unexpected 500 and, in production, has
 * its message REPLACED with "An unexpected server error occurred. Please quote reference <hex> if
 * you contact HR." Every business rule in this module — wrong stage, maker-checker, locked period,
 * missing reason, exhausted budget — was thrown bare, so all of them reached users as an anonymous
 * reference id that needed a server log to decode.
 *
 * Two consequences, both observed on production 2026-08-17:
 *   - A reviewer pressing Reject on their own top-up got reference 538f315d instead of being told
 *     a different reviewer must act.
 *   - BudgetLinkedGrnForm decides whether to offer its "Request a budget increase" shortcut by
 *     testing `/exceeds (the )?available budget/i` against the error message. Masked, that regex
 *     could never match, so the shortcut — and the deep-link that is the only reason
 *     BudgetTopupPanel accepts a preset line id — never appeared for anyone.
 *
 * Status meanings used across the budget services:
 *   400 — the caller sent something invalid and can correct it
 *   403 — the caller holds no role valid for this action or stage
 *   404 — the row does not exist
 *   409 — the row exists, but its current state forbids the action (stage, status, lock, maker,
 *         or an amount that would breach a ceiling)
 *
 * A genuinely unexpected fault must still be thrown bare, so it is masked and logged as a 500.
 * This helper is for decisions, not for faults.
 */
export function refuse(status: number, code: string, message: string) {
  return Object.assign(new Error(message), { statusCode: status, code });
}
