/**
 * PAN ciphertext helper for the legacy sync writers.
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
import { encryptField, isUsingDevEncryptionKey } from "./fieldEncryption.js";

let devKeyWarned = false;

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

/** Test seam: the warn-once latch is module state, which would leak between test cases. */
export function __resetDevKeyWarningForTests(): void {
  devKeyWarned = false;
}
