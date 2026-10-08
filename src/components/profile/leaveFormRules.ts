/**
 * Does the remaining-balance check apply to the selected leave type?
 *
 * Unpaid leave has no entitlement to run out of. The form only recognised the special
 * "Unpaid Leave" type created by the form itself, so the real "Leave Without Pay" type (paid_leave
 * = 0) was gated on its balance row — which is 0 — and nobody could ever submit it.
 * A missing `isPaid` (unknown) keeps the old behaviour: gated.
 */
export function isBalanceGated(isSpecialUnpaid: boolean, isPaid: boolean | null | undefined): boolean {
  return !isSpecialUnpaid && isPaid !== false;
}
