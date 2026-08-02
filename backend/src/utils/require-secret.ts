/**
 * A credential must come from the environment, or the caller must fail.
 *
 * WHY THIS EXISTS
 *
 * `password: process.env.DIALER_DB_PASSWORD || '<the real password>'` reads like a
 * convenience. It is three separate problems:
 *
 *  1. The password is now in the repository, in every clone of it, and in every
 *     commit that ever touched the line. Deleting it later does not remove it
 *     from history.
 *  2. A missing environment variable stops being an error. The service connects
 *     anyway, so nobody discovers the variable was never set — until the
 *     password is rotated and something fails somewhere unrelated.
 *  3. Rotation silently un-fixes itself. Change the password everywhere and any
 *     host missing the variable quietly keeps using the old baked-in one, which
 *     is exactly the state that leaves a stale credential working.
 *
 * The same shape already bit this codebase once: `utils/encryption.ts` fell back
 * to `JWT_SECRET || ""`, so ciphertext was written under sha256("") whenever the
 * key was absent, and nothing complained until a key rotation made it visible.
 *
 * Failing loudly, lazily, at the point of use — not at import, so one
 * unconfigured integration cannot stop the whole app booting.
 */
export function requireSecret(name: string, ...fallbackNames: string[]): string {
  for (const key of [name, ...fallbackNames]) {
    const value = process.env[key];
    if (value != null && value !== "") return value;
  }

  const looked = [name, ...fallbackNames];
  throw new Error(
    `${name} is not set, so this connection cannot be made. ` +
      (fallbackNames.length ? `Checked: ${looked.join(", ")}. ` : "") +
      `Set it in backend/.env. It deliberately has no default: a hardcoded credential ` +
      `would make a missing variable invisible and would survive a password rotation.`,
  );
}
