/**
 * A transaction reference Luckpay's banking rail will accept.
 *
 * Penny drop was failing in production with "Error processing banking request:
 * Customer Reference number is invalid". We were sending a raw `randomUUID()` —
 * 36 characters with hyphens — as `clientTransactionId`. Every reference in
 * Luckpay's documentation is far shorter: 4164564, 6000900, CTN_5612,
 * TXN456789, TXN-ESIGN-12345.
 *
 * Hyphens are not the issue; the eSign call sends TXN-ESIGN-4134186 and
 * succeeds. Length is what differs, and that fits how these APIs behave: a penny
 * drop moves real money, so the reference is carried onto the banking network,
 * where references are conventionally short.
 *
 * Deliberately scoped to the banking call. DigiLocker and eSign keep the
 * identifiers they already use successfully — this is not an invitation to
 * change references that are working.
 *
 * Our own UUID is still recorded against the check row, so a provider reference
 * can always be traced back to the full internal record.
 */

let counter = Math.floor(Math.random() * 1296);

/**
 * `<prefix>` + base-36 timestamp + a rolling counter, e.g. `PDM8K2P4X07Q`.
 *
 * The counter is what makes it safe: a branch intake can issue several penny
 * drops inside the same millisecond, and a timestamp alone would collide.
 */
export function compactProviderReference(prefix: string): string {
  counter = (counter + 1) % 1_679_616; // 36^4
  const stamp = Date.now().toString(36).toUpperCase();
  const seq = counter.toString(36).toUpperCase().padStart(4, "0");
  return `${prefix}${stamp}${seq}`;
}
