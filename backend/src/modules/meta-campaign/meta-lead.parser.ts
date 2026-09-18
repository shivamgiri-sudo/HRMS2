/**
 * Maps a META Lead Gen form response onto the fields we screen on.
 *
 * The exact question set of the live Lead Gen form is still unconfirmed (Open Question 5 in the
 * plan), so this parser is deliberately tolerant rather than exact: it matches on a set of known
 * aliases per field and normalises whatever it finds. Two consequences worth understanding:
 *
 *   - An unrecognised question is not an error. It is simply left unparsed, and the raw payload is
 *     still stored in meta_lead_raw.raw_payload so the lead can be re-parsed once the real form
 *     schema is known, without going back to the Graph API (which only serves leads for 90 days).
 *   - A field we cannot parse reads as `null`, and lead-screener.service.ts treats an unknown
 *     value as NOT a disqualification. Failing to parse must never look like failing to qualify.
 *
 * META itself normalises its standard questions to snake_case names like `full_name`,
 * `phone_number`, `email`, `city`. Custom questions come through with the advertiser's own
 * wording, which is why the matcher falls back to substring tests on a normalised label.
 */

import type { MetaLeadDetail, MetaLeadFieldData } from './meta-campaign.types.js';

export interface ParsedLead {
  name: string | null;
  phone: string | null;
  email: string | null;
  age: number | null;
  location: string | null;
  education: string | null;
  experienceYears: number | null;
}

function normaliseKey(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

/**
 * Strip the type prefix from a META object id.
 *
 * The live lead export (the Google Sheet the marketing team currently works from, 9,170 rows as of
 * 2026-09-18) carries every id prefixed by type:
 *
 *     id          l:1735112467564611
 *     ad_id       ag:120250939177070749
 *     adset_id    as:120250939176210749
 *     campaign_id c:120250938721530749
 *     form_id     f:27936517096019427
 *     phone       p:+919102188692
 *
 * The Graph API webhook itself sends BARE numeric ids, so both spellings will reach us depending on
 * whether a row arrives live or is backfilled from that export. Storing one and matching the other
 * silently routes a lead to no requisition at all — it would land with requisition_id NULL and
 * screening_result 'pending', looking like an unlinked form rather than a bug. Normalising on both
 * write and read is what makes the two sources interchangeable.
 */
export function normaliseMetaId(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  // Only strip a KNOWN short alphabetic prefix. A blind /^[a-z]+:/ would also mangle a value that
  // legitimately contains a colon.
  const m = trimmed.match(/^(l|ag|as|c|f|p|act)\s*:\s*(.+)$/i);
  return (m?.[2] ?? trimmed).trim();
}

/** Build a lookup of normalised question name -> first non-empty answer. */
function toAnswerMap(fieldData: MetaLeadFieldData[] | undefined): Map<string, string> {
  const map = new Map<string, string>();
  for (const f of fieldData ?? []) {
    const key = normaliseKey(f.name ?? f.field_name ?? '');
    if (!key) continue;
    const value = (f.values ?? []).find((v) => typeof v === 'string' && v.trim() !== '');
    if (value) map.set(key, value.trim());
  }
  return map;
}

/**
 * Exact-key match across all aliases first, then a substring pass — exact wins so `age` never
 * matches `marriage_status`.
 *
 * `excludeKeys` exists because the substring pass is otherwise actively wrong for short aliases.
 * The alias `name` is a substring of `first_name`, so on a form that asks first/last name
 * separately, the full-name lookup matched `first_name` and returned "Sunil" for someone called
 * Sunil Kumar — the surname was silently dropped, and the composed first+last fallback never ran
 * because the ?? had already been satisfied. Caught by test, not in review.
 */
function pick(map: Map<string, string>, aliases: string[], excludeKeys: string[] = []): string | null {
  for (const alias of aliases) {
    const hit = map.get(alias);
    if (hit) return hit;
  }
  for (const alias of aliases) {
    for (const [key, value] of map) {
      if (excludeKeys.includes(key)) continue;
      if (key.includes(alias)) return value;
    }
  }
  return null;
}

/** Keys that must never satisfy a loose `name` substring match. */
const NAME_PART_KEYS = ['first_name', 'given_name', 'last_name', 'surname', 'family_name', 'middle_name'];

/**
 * Normalise an Indian mobile number to bare 10 digits where possible.
 *
 * META returns phone numbers in E.164-ish form with the country code and often a `+`. The WA
 * provider and ATS both store bare numbers, and `validateRecipient` on the WhatsApp providers
 * accepts either, so stripping to a canonical form here keeps meta_lead_raw.parsed_phone
 * comparable against ats_candidate rows for dedup.
 */
export function normalisePhone(raw: string | null): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) return digits;
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) return digits.slice(1);
  if (digits.length === 13 && digits.startsWith('091')) return digits.slice(3);
  return digits.length >= 7 ? digits : null;
}

/**
 * Derive age from whatever the form asked.
 *
 * Handles a direct age answer, an age BAND ("25-30" -> 25, taking the lower bound so screening
 * errs toward the stricter reading), and a date of birth in either DD/MM/YYYY or ISO form. The
 * DD/MM vs MM/DD ambiguity is resolved as DD/MM: this is an Indian recruitment form, and treating
 * 03/12/1998 as 3 December is correct here even though JS Date would read it as 12 March.
 */
export function deriveAge(ageRaw: string | null, dobRaw: string | null): number | null {
  if (ageRaw) {
    const band = ageRaw.match(/(\d{1,2})\s*[-–to]+\s*(\d{1,2})/i);
    if (band?.[1]) {
      const low = Number(band[1]);
      if (low >= 14 && low <= 80) return low;
    }
    const single = ageRaw.match(/\d{1,2}/);
    if (single) {
      const n = Number(single[0]);
      if (n >= 14 && n <= 80) return n;
    }
  }

  if (dobRaw) {
    const dob = parseFlexibleDate(dobRaw);
    if (dob) {
      const now = new Date();
      let age = now.getFullYear() - dob.getFullYear();
      const monthDelta = now.getMonth() - dob.getMonth();
      if (monthDelta < 0 || (monthDelta === 0 && now.getDate() < dob.getDate())) age -= 1;
      if (age >= 14 && age <= 80) return age;
    }
  }

  return null;
}

function parseFlexibleDate(raw: string): Date | null {
  const trimmed = raw.trim();

  const iso = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso?.[1] && iso[2] && iso[3]) {
    return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  }

  const dmy = trimmed.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/);
  if (dmy?.[1] && dmy[2] && dmy[3]) {
    const day = Number(dmy[1]);
    const month = Number(dmy[2]);
    let year = Number(dmy[3]);
    if (year < 100) year += year > 30 ? 1900 : 2000;
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return new Date(year, month - 1, day);
    }
  }

  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Years of experience, as a LOWER bound.
 *
 * Always the lower bound of whatever range the answer describes, because screening compares against
 * a minimum: reading a band optimistically would qualify people who do not meet it.
 *
 * The live form's real answer set is an enum, not free text — measured from the current lead export:
 * `fresher`, `under_1`, `1_2`, `over_4`. Those need explicit handling, and `under_1` is why:
 * the generic "first number in the string" fallback read it as **1**, which is the opposite of its
 * meaning and would pass a candidate with under a year against a "minimum 1 year" requirement. It
 * now reads as 0.
 *
 * Free-text forms ("3.5 years", "3-5 yrs", "18 months") are still supported, since the form's
 * question set is the marketing team's to change and has already been revised once (form name ends
 * "v2").
 */
export function deriveExperienceYears(raw: string | null): number | null {
  if (!raw) return null;
  const lower = raw.toLowerCase().trim();
  if (/fresher|no experience|none|nil|^0$/.test(lower)) return 0;

  // Enum forms first — these must win over the numeric fallback below.
  // under_1 / below_1 / less_than_2  -> 0, the lower bound of "less than N".
  const under = lower.match(/^(?:under|below|less[_\s-]?than|upto|up[_\s-]?to)[_\s-]*(\d{1,2})/);
  if (under) return 0;

  // over_4 / above_4 / 4_plus / 4+  -> 4.
  const over = lower.match(/^(?:over|above|more[_\s-]?than)[_\s-]*(\d{1,2}(?:\.\d)?)/);
  if (over?.[1]) return Number(over[1]);
  const plus = lower.match(/^(\d{1,2}(?:\.\d)?)\s*(?:\+|_?plus)/);
  if (plus?.[1]) return Number(plus[1]);

  const months = lower.match(/(\d{1,3})\s*(month|months|mahine|माह)/);
  if (months?.[1]) return Math.round((Number(months[1]) / 12) * 10) / 10;

  // Underscore is a range separator in the enum form (`1_2`), alongside the usual dash / "to".
  const bandLow = lower.match(/^(\d{1,2}(?:\.\d)?)\s*(?:[-–_]|to)\s*(\d{1,2}(?:\.\d)?)/);
  if (bandLow?.[1]) return Number(bandLow[1]);

  const single = lower.match(/(\d{1,2}(?:\.\d)?)/);
  if (single?.[1]) {
    const n = Number(single[1]);
    if (n >= 0 && n <= 50) return n;
  }
  return null;
}

export function parseLead(detail: MetaLeadDetail): ParsedLead {
  const map = toAnswerMap(detail.field_data);

  const fullName = pick(map, ['full_name', 'name', 'candidate_name', 'your_name', 'naam'], NAME_PART_KEYS);
  const first = pick(map, ['first_name', 'given_name']);
  const last = pick(map, ['last_name', 'surname', 'family_name']);
  const name = fullName ?? ([first, last].filter(Boolean).join(' ').trim() || null);

  const email = pick(map, ['email', 'email_address', 'e_mail']);

  return {
    name: name || null,
    phone: normalisePhone(pick(map, ['phone_number', 'phone', 'mobile', 'mobile_number', 'contact_number', 'whatsapp_number'])),
    email: email && email.includes('@') ? email.toLowerCase() : null,
    age: deriveAge(
      pick(map, ['age', 'your_age', 'umar']),
      pick(map, ['date_of_birth', 'dob', 'birth_date', 'birthday'])
    ),
    // `can_travel_noida` is included as a location signal because it is the only geography question
    // the live form asks — there is no city/pincode field at all. Its values are yes / no /
    // can_relocate, so this is a willingness answer rather than a place; it is recorded for the
    // recruiter to read, and deliberately NOT screened on, since "no" to one branch does not
    // disqualify someone from a requisition at another.
    location: pick(map, [
      'city', 'location', 'your_city', 'area', 'town', 'district', 'pin_code', 'pincode',
      'can_travel_noida', 'can_travel', 'willing_to_relocate',
    ]),
    education: pick(map, ['education', 'education_level', 'qualification', 'highest_qualification', 'educational_qualification']),
    experienceYears: deriveExperienceYears(
      pick(map, ['experience', 'work_experience', 'years_of_experience', 'total_experience'])
    ),
  };
}
