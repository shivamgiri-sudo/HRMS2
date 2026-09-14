import crypto from "crypto";

const ALGORITHM = "aes-256-cbc";
const IV_LENGTH = 16;

/**
 * Field encryption for bank account numbers and PAN.
 *
 * The key derives from BANK_ENCRYPTION_KEY, falling back to JWT_SECRET for data
 * written before a dedicated key existed. Two properties matter here, and
 * neither held before:
 *
 * 1. **No silent empty key.** This previously read
 *    `BANK_ENCRYPTION_KEY || JWT_SECRET || ""`, so a deployment missing both
 *    encrypted everything under sha256("") — a constant anyone can compute. It
 *    now throws. Unreadable data is recoverable; data encrypted under a
 *    publicly-derivable key is not.
 *
 * 2. **Rotation does not orphan history.** decrypt() tries the primary key and
 *    then each legacy key in turn, while encrypt() always uses the primary. So
 *    introducing BANK_ENCRYPTION_KEY, or rotating it, leaves existing rows
 *    readable and re-keys them on next write.
 *
 * The second point is not hypothetical. Connector credentials in
 * integration_config use a different helper with no fallback chain; when
 * ENCRYPTION_KEY was rotated between 2026-06-29 and 2026-07-13, nine connectors
 * became permanently unreadable and failed silently for over a month.
 */

function sha256(secret: string): Buffer {
  return crypto.createHash("sha256").update(secret).digest();
}

/** Primary key first, then keys kept only so older ciphertext stays readable. */
function encryptionKeys(): Buffer[] {
  const primary = process.env.BANK_ENCRYPTION_KEY?.trim();
  const legacy = process.env.JWT_SECRET?.trim();

  const secrets: string[] = [];
  if (primary) secrets.push(primary);
  if (legacy && legacy !== primary) secrets.push(legacy);

  if (secrets.length === 0) {
    throw new Error(
      "Field encryption is unconfigured: set BANK_ENCRYPTION_KEY (or JWT_SECRET). " +
        "Refusing to fall back to a key derived from an empty string.",
    );
  }
  return secrets.map(sha256);
}

export function encrypt(plaintext: string): string {
  const [primaryKey] = encryptionKeys();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, primaryKey, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return iv.toString("hex") + ":" + encrypted.toString("hex");
}

export function decrypt(ciphertext: string): string {
  const [ivHex, encHex] = ciphertext.split(":");
  if (!ivHex || !encHex) throw new Error("Invalid encrypted format");
  const iv = Buffer.from(ivHex, "hex");
  const encrypted = Buffer.from(encHex, "hex");

  let lastError: unknown;
  for (const key of encryptionKeys()) {
    try {
      const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
      return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
    } catch (error) {
      // A wrong key fails the PKCS#7 padding check. Try the next one before
      // giving up — that is the entire point of keeping legacy keys.
      lastError = error;
    }
  }
  throw new Error(
    "Unable to decrypt with any configured key. The value was encrypted under a key " +
      "that is no longer present; restore it as JWT_SECRET, or re-enter the value. " +
      `(last error: ${lastError instanceof Error ? lastError.message : String(lastError)})`,
  );
}
