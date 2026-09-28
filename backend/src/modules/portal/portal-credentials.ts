import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

/**
 * URL-safe slug derivation + collision handling for process_master.slug, and the
 * ProcessName_mas / ProcessName@2026 login-ID/password convention the client portal's
 * password-login flow uses.
 *
 * Both are process-scoped, not client-scoped, per the owner's explicit instruction
 * ("no client has name Payroll") — process names are the uniqueness anchor here, not
 * client names. A slug is persisted on process_master rather than derived live on every
 * request specifically so a later process rename can never silently change a URL or login
 * ID a client was already given (see migration 1814's own header for the same reasoning).
 */

/** Lowercase, ASCII-alnum + hyphen only, collapsed. "GS1 India" -> "gs1-india". */
function baseSlug(processName: string): string {
  return processName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    || "process";
}

/**
 * Returns the process's existing slug if it already has one, otherwise derives and
 * persists a new unique one. Collision-safe: appends -2, -3, ... against the real UNIQUE
 * KEY (migration 1814), retried up to 5 times before giving up loudly rather than looping
 * forever on a pathological input.
 */
export async function ensureProcessSlug(processId: string): Promise<string> {
  const [rows] = await db.execute<RowDataPacket[]>(
    "SELECT slug, process_name FROM process_master WHERE id = ? LIMIT 1",
    [processId]
  );
  const row = (rows as RowDataPacket[])[0];
  if (!row) throw new Error(`process_master row not found for id ${processId}`);
  if (row.slug) return row.slug as string;

  const base = baseSlug(row.process_name as string);
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
    try {
      await db.execute("UPDATE process_master SET slug = ? WHERE id = ?", [candidate, processId]);
      return candidate;
    } catch (err) {
      // ER_DUP_ENTRY on the UNIQUE KEY -- try the next suffix. Any other error is real.
      if ((err as { code?: string }).code !== "ER_DUP_ENTRY") throw err;
    }
  }
  throw new Error(`Could not derive a unique slug for process ${processId} after 5 attempts`);
}

/** "gs1-india" -> "Gs1India" (each hyphen-segment capitalized, hyphens removed). */
function slugToPascalCase(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((seg) => seg.charAt(0).toUpperCase() + seg.slice(1))
    .join("");
}

export interface GeneratedCredentials {
  loginId: string;
  password: string;
}

/**
 * The owner-specified convention: Login ID = ProcessName_mas, Password = ProcessName@2026.
 * Both derived from the process's persisted slug (not the live process_name), so they never
 * silently drift if the process is later renamed. login_id collisions are handled by the
 * caller retrying against client_user's own UNIQUE KEY (migration 1814), the same collision
 * pattern ensureProcessSlug uses above.
 *
 * The password is a deliberately guessable, one-time value -- see must_change_password on
 * client_user, which the login flow enforces to force a real password on first use.
 */
export function generateCredentialsFromSlug(slug: string): GeneratedCredentials {
  const name = slugToPascalCase(slug);
  const year = new Date().getFullYear();
  return {
    loginId: `${name}_mas`,
    password: `${name}@${year}`,
  };
}

/** Appends a short disambiguator (last 4 of a fresh UUID) when the base loginId collides. */
export function disambiguateLoginId(loginId: string): string {
  return `${loginId}${randomUUID().slice(0, 4)}`;
}

/**
 * Owner-specified per-process portal URL: mcnhrms.teammas.in/processname_clientportal
 * (see PortalSlugRoute.tsx, which enforces this exact "_clientportal" suffix on the
 * frontend side of the same convention). Built from the slug, not process_name, for the
 * same never-drift-on-rename reason ensureProcessSlug exists.
 */
export function portalUrlFromSlug(slug: string): string {
  return `https://mcnhrms.teammas.in/${slug}_clientportal`;
}
