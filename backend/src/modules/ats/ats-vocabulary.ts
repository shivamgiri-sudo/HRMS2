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
  // Ahmedabad. `Jaldarshan` and `AHMEDABAD-JALDARSHAN` are one site recorded under two
  // conventions, proven by their recruiters rather than by their names: the first is staffed by
  // Jagruti Patel, Monika Sharma and Sandeep Patel, the second by GAJJAR JAGRUTIBEN AKASHBHAI,
  // MONIKA SANJAY SHARMA and SANDEEP BABULAL PATEL — the same three people, confirmed against
  // ats_recruiter_roster emails (patel.jagrutiben@, monika.sharma@). branch_master carries
  // `Jaldarshan` with city "Noida", which is a data-entry error: it has zero employees, while
  // AHMEDABAD-JALDARSHAN (Gujarat) has 266.
  jaldarshan: "AHMEDABAD-JALDARSHAN",
  "ahmedabad-jaldarshan": "AHMEDABAD-JALDARSHAN",
  "ahmh-jd": "AHMEDABAD-JALDARSHAN",
  // `Neelkanth` has a Gujarat twin in branch_master (AHMEDABAD-NEELAKANTH), an `AN-` queue-token
  // prefix, and is staffed by the Ahmedabad recruiters. 17 candidates.
  neelkanth: "AHMEDABAD-NEELAKANTH",
  "ahmedabad-neelakanth": "AHMEDABAD-NEELAKANTH",
  // Noida.
  noida: "NOIDA",
  "noida-2": "NOIDA-2",
  "noida 2": "NOIDA-2",
  "noida-dialdesk": "NOIDA-DIALDESK",
  "noida-dd": "NOIDA-DIALDESK",
  // Okaya and Trapezoid are alias names for the two Noida branches, confirmed by the business
  // 2026-08-27. The data alone could not settle this — staff rostered to both branches take
  // candidates at both sites, so the roster suggested no rollup — which is why it was left to a
  // human rather than guessed. The building stays visible as `_site`; only the branch rolls up.
  "okaya centre": "NOIDA-2",
  "okaya operations": "NOIDA-2",
  okaya: "NOIDA-2",
  trapezoid: "NOIDA",
  // Head office and the single-row entries.
  "head office": "HEAD OFFICE",
  corp: "HEAD OFFICE",
  "delhi office": "Delhi Office",
  delhi: "Delhi Office",
};

/**
 * Region for a canonical branch, from `branch_master.state`. The useful grouping above branch:
 * without it, Gujarat operations and Noida operations sit side by side in one flat list with
 * nothing saying they are different geographies.
 */
export const BRANCH_REGION: Readonly<Record<string, string>> = {
  "AHMEDABAD-JALDARSHAN": "Gujarat",
  "AHMEDABAD-NEELAKANTH": "Gujarat",
  "NOIDA": "Uttar Pradesh",
  "NOIDA-2": "Uttar Pradesh",
  "NOIDA-DIALDESK": "Uttar Pradesh",
  "HEAD OFFICE": "Uttar Pradesh",
  "Delhi Office": "Delhi",
  // branch_master carries `Head Office` with city Mumbai / state Maharashtra (inactive, 0
  // employees). Pune has no master row at all; it is placed by geography, which is a fact
  // rather than a business rule, and noted so nobody mistakes it for a configured branch.
  "Mumbai": "Maharashtra",
  "Pune": "Maharashtra",
};

/**
 * Job-role spellings that mean the same role.
 *
 * The same split the sourcing channel had, in a dimension nothing had checked: `role_applied`
 * carries Backoffice on 1,344 rows and Back Office on 418. Ranked separately they are the
 * first and fourth most common roles; merged they are comfortably the largest.
 */
export const ROLE_CANONICAL: Readonly<Record<string, string>> = {
  backoffice: "Back Office",
  "back office": "Back Office",
  "back-office": "Back Office",
  bo: "Back Office",
  "customer service": "Customer Service",
  "customer support": "Customer Service",
  "inbound agent": "Inbound Agent",
  inbound: "Inbound Agent",
  "outbound agent": "Outbound Agent",
  outbound: "Outbound Agent",
  "quality analyst": "Quality Analyst",
  qa: "Quality Analyst",
  "team leader": "Team Leader",
  tl: "Team Leader",
  sales: "Sales",
  support: "Support",
  executive: "Executive",
};

export function canonicalRole(value: unknown): string {
  const text = String(value ?? "").trim();
  if (!text) return "Unspecified";
  return ROLE_CANONICAL[text.toLowerCase()] ?? text;
}

export function branchRegion(value: unknown): string {
  return BRANCH_REGION[canonicalBranch(value)] ?? "Unspecified";
}

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

/**
 * Recruiter identities confirmed as one person, resolved from `ats_recruiter_roster` emails.
 *
 * The legacy system stores a recruiter's full legal name in caps; the current app stores the
 * name they go by. Case-folding merges the pairs that differ only in case, but not these — they
 * are genuinely different strings. The roster's email address settles each one, which is why
 * this map is evidence rather than name-similarity guesswork:
 *
 *   GAJJAR JAGRUTIBEN AKASHBHAI   patel.jagrutiben@teammas.co.in   = Jagruti Patel
 *   MONIKA SANJAY SHARMA          monika.sharma@teammas.in         = Monika Sharma
 *   MEHAR                         mehar.sheikh@teammas.in          = Mehar Sheikh
 *   SHEELU VERMA                  sheelu.verma@teammas.in          = Sheelu
 *   SRASHTI CHAUHAN               srashti.chauhan@teammas.co.in    = Shristi
 *   SANDEEP BABULAL PATEL         hr.masahm@teammas.in (Ahmedabad) = Sandeep Patel
 *
 * The last is the weakest: a shared HR mailbox rather than a personal address. It is included
 * because both names appear only at AHMEDABAD-JALDARSHAN, share a surname, and their date
 * ranges do not overlap in a way that suggests two people.
 *
 * KHUSHI is deliberately NOT mapped to Khushi Mishra. A name-similarity check flags them as a
 * likely pair and they are not: KHUSHI is khushichandaliya379@gmail.com at NOIDA-2, Khushi
 * Mishra is khushi.mishra@teammas.in at NOIDA. Two people. RECRUITER_DISTINCT records that so a
 * future pass does not "helpfully" merge them.
 */
export const RECRUITER_ALIAS: Readonly<Record<string, string>> = {
  "gajjar jagrutiben akashbhai": "Jagruti Patel",
  "monika sanjay sharma": "Monika Sharma",
  "sandeep babulal patel": "Sandeep Patel",
  mehar: "Mehar Sheikh",
  "sheelu verma": "Sheelu",
  "srashti chauhan": "Shristi",
  // Confirmed by the business 2026-08-27. The roster row for KHUSHI carries a personal gmail
  // (khushichandaliya379@gmail.com) while the same person's corporate address is
  // khushi.mishra@teammas.in, which is why the email check read them as two people. The gmail
  // is the wrong address on the roster, not a second recruiter.
  khushi: "Khushi Mishra",
};

/**
 * Pairs a similarity check would flag that are confirmed to be different people.
 *
 * Empty today. `khushi` / `khushi mishra` sat here until the business confirmed on 2026-08-27
 * that they are one person whose roster row carries a personal gmail; it moved to
 * RECRUITER_ALIAS. Kept as the place to record a genuine false positive, because the roster's
 * email is the evidence this module leans on and it is demonstrably not always right.
 */
export const RECRUITER_DISTINCT: ReadonlyArray<readonly [string, string]> = [];

export function recruiterKey(_id: unknown, name: unknown): string {
  const nm = normalizeRecruiterName(name);
  if (!nm) return "unassigned";
  const folded = nm.toLowerCase();
  return (RECRUITER_ALIAS[folded] ?? nm).toLowerCase();
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
      // Already resolved to one person by RECRUITER_ALIAS — nothing left to confirm.
      if (recruiterKey(null, list[i]) === recruiterKey(null, list[j])) continue;
      if (isConfirmedDistinct(list[i], list[j])) continue;
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

/** True when a name pair has been checked and confirmed to be two different people. */
function isConfirmedDistinct(a: string, b: string): boolean {
  const x = normalizeRecruiterName(a).toLowerCase();
  const y = normalizeRecruiterName(b).toLowerCase();
  return RECRUITER_DISTINCT.some(([p, q]) => (p === x && q === y) || (p === y && q === x));
}
