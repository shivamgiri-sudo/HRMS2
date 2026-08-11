/**
 * PAN ciphertext + blind-index helpers for every writer that can create new plaintext PAN.
 *
 * Originally the two legacy sync handlers only. The `employee_statutory_info` writers now use
 * these too — the HR-entry route and the employee-creation orchestrator — which is why the
 * `context` argument exists: it labels the caller in the dev-key warning. The name still says
 * "ForSync" because renaming it would churn two handlers and their tests for no behavioural gain.
 *
 * employees.pan_number_encrypted was backfilled for all 23,341 existing rows, but the two
 * legacy sync handlers are the only writers that can create NEW plaintext PAN. If they
 * kept writing only the plaintext column, every employee synced after the backfill would
 * arrive unencrypted and coverage would rot from day one.
 *
 * Both handlers write BOTH columns for now. That is deliberate: the plaintext column is
 * still the live read path (~10 readers, mostly presence checks), so dropping the
 * plaintext write here would make freshly synced employees look like they have no PAN at
 * all. Once the readers move to the encrypted column, the plaintext write is removed and
 * the column cleared — in that order.
 *
 * Lives in shared/ rather than in one of the handlers because the two must not drift:
 * their ON DUPLICATE KEY semantics already differ (employee-sync-handler fills only when
 * empty, employee-master-sync-handler overwrites unconditionally), and the ciphertext must
 * follow whichever rule its own file uses for the plaintext. Keeping the encryption itself
 * identical is what stops that difference becoming two different encryption behaviours.
 */
import { blindIndex, encryptField, isUsingDevBlindIndexKey, isUsingDevEncryptionKey } from "./fieldEncryption.js";

let devKeyWarned = false;
let devBlindKeyWarned = false;

/**
 * Ciphertext for a PAN arriving from legacy, or null when there is nothing to encrypt.
 *
 * Refuses to encrypt under the all-zeros dev key. Writing dev-key ciphertext into a shared
 * database produces rows production can never decrypt, and nothing looks broken at the
 * time — so it returns null and warns once, leaving the plaintext write to stand alone.
 */
export function encryptPanForSync(value: string | null | undefined, context = "sync"): string | null {
  const plain = value ? String(value).trim() : "";
  if (!plain) return null;

  if (isUsingDevEncryptionKey()) {
    if (!devKeyWarned) {
      devKeyWarned = true;
      console.warn(
        `[${context}] FIELD_ENCRYPTION_KEY is the all-zeros dev key — writing plaintext PAN only, no ciphertext. ` +
        `Ciphertext written under this key would be undecryptable in production.`
      );
    }
    return null;
  }

  return encryptField(plain, 1);
}

/**
 * Blind index for a PAN, or null when there is nothing to index.
 *
 * Sibling of encryptPanForSync and here for the same anti-drift reason: the writers of
 * employee_statutory_info.pan_number must produce the SAME index for the same value as
 * scripts/statutory-identifier-encrypt-backfill.ts does, or a row written by a route and a
 * row written by the backfill would never match each other in a lookup. That script
 * normalises with String(value).trim() and nothing else — no upper-casing — so this does
 * exactly that and must keep doing exactly that.
 *
 * Refuses under the dev blind-index key. An index built with the wrong key is not
 * detectably wrong: every lookup simply returns no rows, so the duplicate-employee guard
 * would read that as "no duplicate exists" and pass everything.
 */
export function blindIndexPan(value: string | null | undefined, context = "sync"): string | null {
  const plain = value ? String(value).trim() : "";
  if (!plain) return null;

  if (isUsingDevBlindIndexKey()) {
    if (!devBlindKeyWarned) {
      devBlindKeyWarned = true;
      console.warn(
        `[${context}] FIELD_BLIND_INDEX_KEY is the dev key — writing no blind index. ` +
        `An index written under this key matches nothing at lookup time and reports no error.`
      );
    }
    return null;
  }

  return blindIndex(plain);
}

/** Test seam: the warn-once latch is module state, which would leak between test cases. */
export function __resetDevKeyWarningForTests(): void {
  devKeyWarned = false;
  devBlindKeyWarned = false;
}
