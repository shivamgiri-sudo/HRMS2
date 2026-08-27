/**
 * One canonical vocabulary for the ATS dimensions that are stored as free text.
 *
 * `ats_candidate` records sourcing channel, branch and recruiter as strings typed by whoever
 * created the row, across two eras of the product and one legacy import. The result is that the
 * same real-world thing appears under several spellings, and every consumer that groups on the
 * raw value splits it. Measured on production 2026-08-27:
 *
 *   sourcing_channel  WALKIN (3,556) · Walk-In (428) · walk-in (1)   → one channel, three rows
 *   applied_for_branch Jaldarshan (486) · AHMEDABAD-JALDARSHAN (90)  → one branch, two rows
 *   recruiter_assigned_name  SOFIYA SULTAN (512) · Sofiya Sultan (519) → one person, two rows
 *
 * Two separate bugs come out of that split. The command centre ranks the halves against each
 * other (its "best converting channel" and its recruiter leaderboard are both decided by the
 * split, not by performance). And `ats_sourcing_channel`, the channel master the BMI board
 * joins to, holds none of the spellings candidates actually carry — WALK_IN/REFERRAL/NAUKRI
 * against WALKIN/Reference/Recruiter — so that INNER JOIN matches zero rows and every
 * "sourced by channel" row on the board is empty regardless of hiring activity.
 *
 * Both consumers need the same answer, so the rule lives here once, as data, with a JS form for
 * the analytics service and a SQL form for the benchmark queries. Adding a spelling means
 * editing one table, and `atsVocabulary.test.ts` asserts the two forms agree.
 *
 * Deliberately NOT a data migration: these columns are still written by the candidate web form
 * and the recruiter mobile app, which are outside this repository. Normalising on read keeps
 * those writers working and stays reversible; a one-off UPDATE would be neither.
 */

/** Canonical channel codes, matching `ats_sourcing_channel.channel_code` where one exists. */
export const SOURCE_CANONICAL: Readonly<Record<string, string>> = {
  walkin: "WALK_IN",
  "walk-in": "WALK_IN",
  "walk in": "WALK_IN",
  walk_in: "WALK_IN",
  reference: "REFERRAL",
  referral: "REFERRAL",
  recruiter: "RECRUITER",
  naukri: "NAUKRI",
  indeed: "INDEED",
  linkedin: "LINKEDIN",
  whatsapp: "WHATSAPP",
  agency: "AGENCY",
  other: "OTHER",
};

/**
 * Display labels for the canonical codes. The raw codes are storage identifiers and reading
 * `WALK_IN` in a chart legend is worse than reading `Walk-in`, so the tables carry both.
 */
export const SOURCE_LABEL: Readonly<Record<string, string>> = {
  WALK_IN: "Walk-in",
  REFERRAL: "Reference",
  RECRUITER: "Recruiter",
  NAUKRI: "Naukri",
  INDEED: "Indeed",
  LINKEDIN: "LinkedIn",
  WHATSAPP: "WhatsApp",
  AGENCY: "Agency",
  OTHER: "Other",
  UNSPECIFIED: "Unspecified",
};

/**
 * Which BMI funnel row a canonical channel belongs to. `RECRUITER` and `OTHER` map to no BMI
 * row on purpose — the board has exactly four channel rows (portal/agency/referral/walk_in) and
 * inventing a fifth bucket for them would change what the board means. They are still counted
 * in every command-centre source total.
 */
export const SOURCE_BMI_TYPE: Readonly<Record<string, string>> = {
  WALK_IN: "walk_in",
  REFERRAL: "referral",
  AGENCY: "agency",
  NAUKRI: "portal",
  INDEED: "portal",
  LINKEDIN: "portal",
};

/** Canonicalise one stored `sourcing_channel` value. Unknown spellings are preserved, upper-cased. */
export function canonicalSource(value: unknown): string {
  const text = String(value ?? "").trim();
  if (!text) return "UNSPECIFIED";
  return SOURCE_CANONICAL[text.toLowerCase()] ?? text.toUpperCase();
}

/** Human-facing label for a stored value. */
export function sourceLabel(value: unknown): string {
  const code = canonicalSource(value);
  return SOURCE_LABEL[code] ?? code;
}

/**
 * The SQL equivalent of canonicalSource(), as a CASE expression over `column`.
 *
 * Generated from the same table rather than hand-written, so the two cannot drift. The column
 * name is supplied by this module's callers and never by request input; the literals come from
 * SOURCE_CANONICAL's own keys, which are code, so there is nothing here to bind.
 */
export function canonicalSourceSql(column: string): string {
  const arms = Object.entries(SOURCE_CANONICAL)
    .map(([raw, code]) => `WHEN LOWER(TRIM(${column})) = ${quote(raw)} THEN ${quote(code)}`)
    .join("\n         ");
  return `CASE
         WHEN ${column} IS NULL OR TRIM(${column}) = '' THEN 'UNSPECIFIED'
         ${arms}
         ELSE UPPER(TRIM(${column}))
       END`;
}

/**
 * Branch spellings that mean the same site. Keys are lower-cased stored values; values are the
 * `branch_master.branch_name` they belong to.
 *
 * Only aliases confirmed against branch_master are listed. Okaya Centre, Trapezoid and
 * Neelkanth are deliberately absent: they are buildings within Noida and folding them into
 * NOIDA would destroy a distinction the recruiters actually use. They are surfaced as sites, not
 * renamed. See `_site` on the analytics rows.
 */
export const BRANCH_CANONICAL: Readonly<Record<string, string>> = {
  jaldarshan: "AHMEDABAD-JALDARSHAN",
  "ahmedabad-jaldarshan": "AHMEDABAD-JALDARSHAN",
  "ahmh-jd": "AHMEDABAD-JALDARSHAN",
  "delhi office": "Delhi Office",
  delhi: "Delhi Office",
  noida: "NOIDA",
  "noida-2": "NOIDA-2",
  "noida-dialdesk": "NOIDA-DIALDESK",
  "head office": "HEAD OFFICE",
  corp: "HEAD OFFICE",
};

export function canonicalBranch(value: unknown): string {
  const text = String(value ?? "").trim();
  if (!text) return "Unspecified";
  return BRANCH_CANONICAL[text.toLowerCase()] ?? text;
}

/**
 * The key a recruiter is grouped by: the case-folded name, deliberately NOT the foreign key.
 *
 * The obvious implementation — prefer `recruiter_assigned_id`, fall back to the name — is wrong
 * here, and measurably so: it produces 33 groups where grouping on the raw name produces 32.
 * The reason is that the id is populated on only part of a person's history. `sofiya sultan` has
 * 1,032 rows, one distinct id, and 526 rows with no id at all; the same holds for shikha maurya
 * (478 of 680 null), rakhi (250 of 627), khushi mishra (199 of 333) and huda malik (128 of 173).
 * Keying on the id therefore splits each of them into an id half and a name half — the very
 * split it was meant to repair.
 *
 * Case-folding is safe in both directions, verified against production 2026-08-27: no id carries
 * two spellings, and no case-folded name carries two ids. So folding merges the five genuine
 * case-duplicates (SOFIYA SULTAN / Sofiya Sultan and the four above) and cannot merge two
 * different people. 32 raw names become 27 recruiters.
 *
 * What this deliberately does NOT do is merge pairs like `MEHAR` / `Mehar Sheikh`,
 * `Jagruti Patel` / `GAJJAR JAGRUTIBEN AKASHBHAI` or `Shristi` / `SRASHTI CHAUHAN`. Those are
 * almost certainly the same people — a short name against a full legal name — but nothing in the
 * data says so, and inventing that mapping in code would silently merge two recruiters on a
 * guess. They are reported by suspectedDuplicateRecruiters() instead, for a human to confirm.
 */
/**
 * Strip the decoration off a stored recruiter name.
 *
 * `recruiter_name` is written by one caller as `SRASHTI CHAUHAN · MAS61660` — the display name
 * with the employee code appended — while `recruiter_assigned_name` holds the bare name. Keying
 * on one and labelling from the other is what produced two separate leaderboard rows both
 * displaying "KHUSHI MISHRA", and a "Shristi" row sitting apart from a
 * "SRASHTI CHAUHAN · MAS61660" row. Both the key and the label go through this.
 */
export function normalizeRecruiterName(raw: unknown): string {
  return String(raw ?? "")
    .replace(/\s*[·|]\s*[A-Z]{2,4}\d{3,}\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function recruiterKey(_id: unknown, name: unknown): string {
  const nm = normalizeRecruiterName(name);
  if (!nm) return "unassigned";
  return nm.toLowerCase();
}

/**
 * Recruiter names that look like the same person under two conventions, surfaced for review
 * rather than merged. Pairs where one name's tokens are a subset of the other's — `MEHAR` inside
 * `Mehar Sheikh`, `Sandeep Patel` inside `SANDEEP BABULAL PATEL` — or where the first and last
 * token match across a differing middle.
 */
export function suspectedDuplicateRecruiters(names: readonly string[]): Array<{ a: string; b: string; reason: string }> {
  const tokens = (n: string) => n.toLowerCase().split(/\s+/).filter(Boolean);
  const out: Array<{ a: string; b: string; reason: string }> = [];
  const list = [...new Set(names.map((n) => String(n ?? "").trim()).filter((n) => n && n.toLowerCase() !== "unassigned"))];
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const ta = tokens(list[i]);
      const tb = tokens(list[j]);
      if (!ta.length || !tb.length) continue;
      const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
      if (short.every((t) => long.includes(t))) {
        out.push({ a: list[i], b: list[j], reason: "one name's words are contained in the other" });
      } else if (short[0] === long[0] && short[short.length - 1] === long[long.length - 1]) {
        out.push({ a: list[i], b: list[j], reason: "same first and last name, different middle" });
      }
    }
  }
  return out;
}

/**
 * Pick the display name for a recruiter group.
 *
 * The halves of a split identity disagree on casing (`SOFIYA SULTAN` vs `Sofiya Sultan`) and one
 * of them has to win. Title-case wins over SHOUTING because the legacy import is the all-caps
 * side; among equals the longest wins, so `Mehar Sheikh` beats `MEHAR`.
 */
export function preferredRecruiterName(names: readonly string[]): string {
  const seen = names.map((n) => String(n ?? "").trim()).filter(Boolean);
  if (!seen.length) return "Unassigned";
  const score = (n: string) => (n === n.toUpperCase() ? 0 : 1);
  return [...seen].sort((a, b) => score(b) - score(a) || b.length - a.length)[0];
}

function quote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}
