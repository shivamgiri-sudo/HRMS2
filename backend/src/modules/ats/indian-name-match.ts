/**
 * Deciding whether two written names belong to the same person.
 *
 * This exists because the bank fraud check is only as good as this comparison.
 * A penny drop tells us who really owns an account; comparing that name to the
 * candidate's registered identity is what catches X using Y's account. But
 * Indian names are written inconsistently enough that a naive comparison fails
 * in both directions, and the two failures are not equally costly:
 *
 *   - Too strict, and thousands of genuine joiners are flagged because the bank
 *     holds "RAJESH KUMAR SINGH" while the Aadhaar says "RAJESH KUMAR". This is
 *     the more likely harm and it lands on people who did nothing wrong.
 *   - Too loose, and the check waves through the fraud it exists to catch.
 *
 * Two regional conventions drive the design, because position-based rules break
 * on both:
 *
 *   - Gujarati names run given + father + surname, and the father's name carries
 *     a -bhai / -ben suffix that banks drop or abbreviate: "DHAVAL RAMESHBHAI
 *     PATEL" and "DHAVAL R PATEL" are one person.
 *   - South Indian names put initials FIRST, expanding to a father's or house
 *     name, so the identifying word is the last token, not the first: "S
 *     SRINIVASAN", "K V RAMESH". Telugu names often lead with the surname
 *     instead ("BELLAPPU SRINIVASA PRASAD"), and Tamil names may have no
 *     surname at all.
 *
 * So nothing here depends on token position. Names are reduced to substantive
 * WORDS and to INITIALS. Words carry identity; initials are treated as optional
 * abbreviations that can satisfy a word but never create a mismatch by being
 * absent — because they usually are absent on one side.
 *
 * The remaining trap is the shared surname. "SURESH KUMAR" and "RAJESH KUMAR"
 * overlap 50% by tokens and are plainly different people, and relatives sharing
 * a surname is exactly the shape account-sharing fraud takes. A match therefore
 * requires agreement on something distinctive, not merely on a common surname.
 *
 * Replaces four near-duplicate matchers (bgv-provider.adapter,
 * bgv-verification.service, bgv.enhanced.service, name-consistency.routes), none
 * of which handled initials, honorifics or S/O suffixes.
 */

/** Honorifics carried by ID documents and bank records alike. */
const HONORIFICS = new Set([
  "mr", "mrs", "ms", "miss", "dr", "prof", "shri", "sri", "smt", "late", "kum", "col", "capt",
]);

/**
 * Surnames common enough that sharing one is not evidence of shared identity.
 * Adding a name here makes the check stricter, not looser: it stops that token
 * from carrying a match on its own.
 */
const COMMON_SURNAMES = new Set([
  "kumar", "singh", "devi", "sharma", "khan", "das", "roy", "patel", "shah", "gupta",
  "yadav", "reddy", "rao", "nair", "mishra", "verma", "chauhan", "thakur", "jain", "bibi",
  "begum", "ali", "ahmed", "prasad", "lal", "chand", "ram", "bai", "kaur", "pillai", "menon",
]);

export type NameMatchTier =
  /** The same substantive words, allowing for order, honorifics and initials. */
  | "exact"
  /** Different spelling of one person: an initial, an extra token, a fuller form. */
  | "variant"
  /** Something overlaps, but not the part that identifies a person. */
  | "weak"
  /** Nothing meaningful in common. */
  | "none"
  /** One side is blank — no conclusion is available. */
  | "unknown";

export interface NameMatchResult {
  tier: NameMatchTier;
  /** 0-100, retained for the existing match_score column. */
  score: number;
  /** True only when the evidence points at a different person. */
  suspicious: boolean;
  reason: string;
  normalizedExpected: string;
  normalizedActual: string;
}

/**
 * Lower-cased name with honorifics, relational suffixes and the Gujarati
 * -bhai / -ben endings removed.
 *
 * Bank records frequently append the father's or husband's name — "RAJESH KUMAR
 * S/O RAMESH KUMAR". Everything from that marker onwards describes a different
 * person and must not take part in the comparison, or the relative's name would
 * count towards the match.
 */
export function normalizeIndianName(name?: string | null): string {
  let value = String(name ?? "").toLowerCase();
  value = value.replace(/\b[sdwc]\s*[\/.]?\s*o\b.*$/i, " ");
  value = value.replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim();
  if (!value) return "";
  return value
    .split(" ")
    .filter((token) => token && !HONORIFICS.has(token))
    .map(stripGujaratiSuffix)
    .filter(Boolean)
    .join(" ");
}

/**
 * "rameshbhai" -> "ramesh", "kokilaben" -> "kokila".
 *
 * Only applied when a real stem survives, so names that merely end in these
 * letters are left alone.
 */
function stripGujaratiSuffix(token: string): string {
  for (const suffix of ["bhai", "ben"]) {
    if (token.length > suffix.length + 2 && token.endsWith(suffix)) {
      return token.slice(0, -suffix.length);
    }
  }
  return token;
}

/**
 * A spelling key: the same word written the way a different clerk would spell it.
 *
 * Indian names reach us through transliteration, so one name has several correct
 * spellings and the bank, the PAN and our own record rarely agree on which.
 * Comparing the letters as typed made a single letter decisive — a candidate
 * whose bank held "CHHAPANE" against a record reading "CHHAPANEY" scored 25/100
 * and was sent to manual review, then blocked from saving his own account at all.
 *
 * Only differences that carry no sound are folded away:
 *   - doubled letters ("chhapane" / "chapane", "bhatt" / "bhat");
 *   - the long-vowel digraphs ("praveen" / "pravin", "kumaar" / "kumar");
 *   - a y written for i anywhere but the first letter ("chhapaney" / "chhapane");
 *   - a trailing vowel, which is the least stable letter in a transliterated
 *     name ("sangeeta" / "sangit").
 *
 * A letter SUBSTITUTED inside the word is deliberately left alone, because that
 * is what separates real people: "ramesh" and "rakesh" differ by one character
 * and must stay apart, which is exactly what a plain edit-distance tolerance
 * would have got wrong. The trailing-vowel rule is likewise held back on short
 * words, so "rita" and "ritu" also stay apart.
 */
export function spellingKey(word: string): string {
  let value = word
    .replace(/aa/g, "a")
    .replace(/ee/g, "i")
    .replace(/oo/g, "u")
    .replace(/ii/g, "i")
    .replace(/uu/g, "u");
  value = value.charAt(0) + value.slice(1).replace(/y/g, "i");
  value = value.replace(/(.)\1+/g, "$1");
  if (value.length >= 6) value = value.replace(/[aeiou]+$/, "");
  return value.length >= 3 ? value : word;
}

const COMMON_SURNAME_KEYS = new Set([...COMMON_SURNAMES].map(spellingKey));

const VOWELS = new Set(["a", "e", "i", "o", "u"]);

/**
 * One vowel written differently inside an otherwise identical word:
 * "mohammed" / "mohammad", "manisha" / "manesha".
 *
 * The consonants must line up exactly and only a single vowel may differ, which
 * is what keeps "ramesh" and "rakesh" — a CONSONANT apart — two different
 * people. Held to words of six letters or more so short given names ("sunil" /
 * "sanil") are still compared strictly.
 */
function vowelVariant(a: string, b: string): boolean {
  if (a.length !== b.length || a.length < 6) return false;
  let differences = 0;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] === b[i]) continue;
    if (!VOWELS.has(a[i]) || !VOWELS.has(b[i])) return false;
    if ((differences += 1) > 1) return false;
  }
  return differences === 1;
}

/** True when two substantive words are the same name, allowing for spelling. */
function sameWord(a: string, b: string): boolean {
  if (a === b) return true;
  const [keyA, keyB] = [spellingKey(a), spellingKey(b)];
  return keyA === keyB || vowelVariant(keyA, keyB);
}

/** A surname shared by millions, whichever way it is spelled. */
function isCommonSurname(word: string): boolean {
  return COMMON_SURNAMES.has(word) || COMMON_SURNAME_KEYS.has(spellingKey(word));
}

interface NameParts { words: string[]; initials: string[] }

function parts(normalized: string): NameParts {
  const tokens = normalized ? normalized.split(" ") : [];
  return {
    words: tokens.filter((t) => t.length > 1),
    initials: tokens.filter((t) => t.length === 1),
  };
}

/**
 * Initials that appear on both sides correspond to each other, not to the other
 * side's words, and must be cancelled before either side's initials are allowed
 * to stand in for a word.
 *
 * Without this, "S SRINIVASAN" and "S RAMACHANDRAN" match: the S on one side is
 * read as an abbreviation of SRINIVASAN on the other. In reality both are the
 * father's initial and the two people are unrelated — the exact false pass this
 * check exists to prevent.
 */
function freeInitials(mine: NameParts, other: NameParts): string[] {
  const pool = [...other.initials];
  const free: string[] = [];
  for (const initial of mine.initials) {
    const at = pool.indexOf(initial);
    if (at === -1) free.push(initial);
    else pool.splice(at, 1);
  }
  return free;
}

/** A word is satisfied by the same word, or by an unpaired initial standing for it. */
function wordSatisfiedBy(word: string, other: NameParts, otherFreeInitials: string[]): boolean {
  return other.words.some((candidate) => sameWord(candidate, word))
    || otherFreeInitials.some((i) => word.startsWith(i));
}

export function classifyNameMatch(expected?: string | null, actual?: string | null): NameMatchResult {
  const left = normalizeIndianName(expected);
  const right = normalizeIndianName(actual);
  const base = { normalizedExpected: left, normalizedActual: right };

  if (!left || !right) {
    return {
      ...base, tier: "unknown", score: 0, suspicious: false,
      reason: "one side has no usable name, so no conclusion can be drawn",
    };
  }

  const a = parts(left);
  const b = parts(right);

  if (!a.words.length || !b.words.length) {
    return {
      ...base, tier: "unknown", score: 0, suspicious: false,
      reason: "one side is initials only, which cannot identify a person",
    };
  }

  if ([...a.words].sort().join(" ") === [...b.words].sort().join(" ")) {
    return { ...base, tier: "exact", score: 100, suspicious: false, reason: "same substantive words" };
  }

  // The same words, spelled the way another clerk would spell them.
  if ([...a.words].map(spellingKey).sort().join(" ") === [...b.words].map(spellingKey).sort().join(" ")) {
    return {
      ...base, tier: "variant", score: 90, suspicious: false,
      reason: "same substantive words, differing only in transliterated spelling",
    };
  }

  const aFree = freeInitials(a, b);
  const bFree = freeInitials(b, a);

  // Look in both directions. "R KUMAR" against "RAJESH KUMAR" only agrees on a
  // common surname when read one way; read the other way, R stands for RAJESH,
  // and that is the distinctive agreement that makes them the same person.
  const matchedWords = [
    ...a.words.filter((word) => wordSatisfiedBy(word, b, bFree)),
    ...b.words.filter((word) => wordSatisfiedBy(word, a, aFree)),
  ];
  // Counted one side at a time. Deduplicating the combined list only worked while
  // a match meant an identical string: once two spellings of one word can match,
  // they are two entries in a set and the score ran over 100.
  const score = Math.round((
    Math.max(
      a.words.filter((word) => wordSatisfiedBy(word, b, bFree)).length,
      b.words.filter((word) => wordSatisfiedBy(word, a, aFree)).length,
    ) / Math.max(a.words.length, b.words.length)
  ) * 100);

  if (!matchedWords.length) {
    return { ...base, tier: "none", score: 0, suspicious: true, reason: "no substantive word in common" };
  }

  // Agreement has to rest on something more distinctive than a surname millions
  // of unrelated people share.
  const distinctive = matchedWords.some((word) => !isCommonSurname(word));
  if (!distinctive) {
    return {
      ...base, tier: "weak", score, suspicious: true,
      reason: "the names agree only on a common surname",
    };
  }

  // One name being a fuller or abbreviated form of the other is the ordinary
  // shape of this variance: an added house name, a dropped father's name, an
  // abbreviated middle name.
  const [shorter, longer, longerFree] = a.words.length <= b.words.length ? [a, b, bFree] : [b, a, aFree];
  if (shorter.words.every((word) => wordSatisfiedBy(word, longer, longerFree))) {
    return {
      ...base, tier: "variant", score: Math.max(score, 75), suspicious: false,
      reason: "every substantive word of the shorter name appears in the longer, including a distinctive one",
    };
  }

  return {
    ...base, tier: "weak", score, suspicious: true,
    reason: "the names share a distinctive word but each carries words the other does not",
  };
}
