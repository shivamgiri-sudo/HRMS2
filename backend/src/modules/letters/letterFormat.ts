/**
 * Date formatting for letters.
 *
 * MySQL DATE columns come back as JS Date objects in the server's zone. Slicing
 * `toISOString()` renders them in UTC, which moves an Indian date back by one
 * day for anything stored at or after 18:30 IST. Verified on production:
 * employee MAS60616 has date_of_joining 2025-09-25T18:30:00Z — that is
 * 26-09-2025 in India, and the printed appointment letter says 26-09-2025, but
 * `.toISOString().slice(0,10)` yields "2025-09-25".
 *
 * A misdated appointment letter is a misdated legal instrument, so every date on
 * a letter goes through here.
 */
const IST_TZ = "Asia/Kolkata";

/** ISO yyyy-mm-dd in IST. */
export function istDate(value: unknown): string {
  if (value == null || value === "") return "";
  const d = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(d.getTime())) {
    // Already a plain string like "2025-09-26" — keep it rather than mangling it.
    const s = String(value);
    return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : "";
  }
  // en-CA gives yyyy-mm-dd.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: IST_TZ, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
}

// Spelled out rather than taken from Intl: ICU renders September as "Sept" in
// some versions and "Sep" in others, and a legal document should not change
// wording because Node was upgraded.
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Human form used in the letter body, e.g. "26 Sep 2025". */
export function istDisplayDate(value: unknown): string {
  const iso = istDate(value);
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d} ${MONTHS[Number(m) - 1]} ${y}`;
}

/** Timestamp for the signature block, e.g. "26 Sep 2025, 03:45 pm IST". */
export function istTimestamp(value: Date = new Date()): string {
  const iso = istDate(value);
  const [y, m, d] = iso.split("-");
  const t = new Intl.DateTimeFormat("en-GB", {
    timeZone: IST_TZ, hour: "2-digit", minute: "2-digit", hour12: true,
  }).format(value);
  return `${d} ${MONTHS[Number(m) - 1]} ${y}, ${t} IST`;
}

/**
 * A letter must carry a usable name. Blocks only what is unarguably unusable —
 * blank, or too short to be anyone's name.
 *
 * Deliberately does NOT try to detect a truncated name. Production holds
 * employee MAS60616 as "HARSH " while the real letter reads "HARSH TALWAR", so
 * truncation clearly happens — but a single-token name is also a perfectly
 * normal Indian legal name, and refusing those would block real hires on a
 * guess. Use isLikelyIncompleteName() for that, which flags for review rather
 * than rejecting.
 */
export function assertUsableName(name: unknown): string {
  const n = String(name ?? "").replace(/\s+/g, " ").trim();
  if (n.length < 3 || !/[A-Za-z]{3}/.test(n)) {
    throw Object.assign(
      new Error(`Employee name on record is "${String(name ?? "")}", which cannot be printed on a letter. Correct the name before issuing.`),
      { statusCode: 409, code: "employee_name_incomplete" },
    );
  }
  return n;
}

/**
 * True when a name looks like it lost part of itself — a single token, or a
 * stored value with trailing whitespace where a surname should be.
 *
 * Advisory. The issuance flow surfaces this to HR as a confirmable blocker so a
 * genuinely mononymous employee is not permanently stuck.
 */
export function isLikelyIncompleteName(name: unknown): boolean {
  const raw = String(name ?? "");
  const n = raw.replace(/\s+/g, " ").trim();
  if (!n) return true;
  const tokens = n.split(" ").filter(Boolean);
  // "HARSH " — a single token that was stored with a trailing space is the
  // signature of a surname that never made it across.
  if (tokens.length === 1 && /\s$/.test(raw)) return true;
  return tokens.length === 1;
}
