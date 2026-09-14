/**
 * Blood group normalisation.
 *
 * `employees.blood_group` is a free-text VARCHAR that, until the Profile editor was
 * switched to a dropdown, accepted whatever an employee typed. Live data on 2026-09-03
 * held 'B+ve', 'O +', a bare 'A' and one row reading 'SAMBHLI' (a place name), plus
 * 28,502 rows carrying the literal string 'NA' from the legacy import.
 *
 * 'NA' is the important one: it is *not* a blood group, it is the legacy system's way of
 * saying "not recorded". Stored as-is it reaches the employee ID card, which then prints
 * "Blood Group : NA" — the field looked mapped while carrying no information. Every write
 * path funnels through here so an unrecognisable value becomes NULL ("—" on the card,
 * honestly blank) rather than a fake reading.
 */

export const BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"] as const;

export type BloodGroup = (typeof BLOOD_GROUPS)[number];

/**
 * Returns one of the eight canonical groups, or null when the input carries no usable
 * information. Tolerates the shapes seen in live data: lowercase, embedded spaces, and
 * the 've' / 've'-style suffixes ('B+ve', 'O positive', 'A NEG').
 */
export function normalizeBloodGroup(raw: unknown): BloodGroup | null {
  if (raw === null || raw === undefined) return null;

  let s = String(raw).toUpperCase();
  // Strip everything that is not a letter or a sign, so 'O +', 'b+ve' and 'AB - ve'
  // all collapse to a comparable token.
  s = s.replace(/\s+/g, "");
  if (!s) return null;

  // Spelled-out signs, before the non-alphanumeric strip removes the words' punctuation.
  s = s.replace(/POSITIVE|POSTIVE|POS(?![A-Z])/g, "+").replace(/NEGATIVE|NEGTIVE|NEG(?![A-Z])/g, "-");
  // 'B+VE' / 'B+VE.' — the trailing 'VE' is noise once the sign is present.
  s = s.replace(/VE\b|VE$/g, "");
  s = s.replace(/[^A-Z+-]/g, "");

  const m = /^(AB|A|B|O)([+-])$/.exec(s);
  if (!m) return null;
  return `${m[1]}${m[2]}` as BloodGroup;
}
