/**
 * Location fit for walk-in drives (pure). A walk-in only works if the candidate can reach the branch, so a drive
 * only shortlists people whose records place them in the branch's city/region. Regions group cities people
 * commute between (Delhi NCR); everything else matches on its own city name or the branch-name prefix.
 */
const REGIONS: string[][] = [
  ["noida", "greater noida", "delhi", "new delhi", "ghaziabad", "gurgaon", "gurugram", "faridabad", "ncr", "indirapuram", "vaishali", "tughlakabad"],
  ["ahmedabad", "gandhinagar", "sanand", "naroda", "vastral", "jaldarshan"],
  ["mumbai", "navi mumbai", "thane", "kalyan", "dombivli", "vashi", "andheri"],
  ["bangalore", "bengaluru"],
  ["kolkata", "howrah", "salt lake"],
  ["pune", "pimpri", "chinchwad"],
  ["hyderabad", "secunderabad"],
  ["chennai"],
  ["jaipur"],
  ["lucknow"],
];

const clean = (v: string | null | undefined) => String(v ?? "").toLowerCase().replace(/[^a-z ]+/g, " ").replace(/\s+/g, " ").trim();

/** Words that identify where a branch is: its city, the branch-name prefix ("AHMEDABAD-JALDARSHAN" -> ahmedabad), and its region. */
export function branchLocationTokens(branchName: string | null | undefined, city: string | null | undefined): string[] {
  const out = new Set<string>();
  const c = clean(city);
  if (c.length >= 3) out.add(c);
  const prefix = clean(String(branchName ?? "").split(/[-_/(]/)[0]);
  if (prefix.length >= 3 && !/^(branch|office|hq|head)$/.test(prefix)) out.add(prefix);
  for (const region of REGIONS) {
    if ([...out].some((t) => region.some((r) => t === r || t.includes(r) || r.includes(t)))) region.forEach((r) => out.add(r));
  }
  return [...out];
}

/** MySQL REGEXP alternation for the tokens (word-ish boundaries via non-letter or string edge). Null when nothing usable. */
export function locationRegex(tokens: string[]): string | null {
  const t = tokens.map((x) => x.replace(/[^a-z ]/g, "").trim()).filter((x) => x.length >= 3);
  if (!t.length) return null;
  return `(^|[^a-z])(${t.map((x) => x.replace(/ /g, "[ -]?")).join("|")})([^a-z]|$)`;
}

/**
 * Does this person's location evidence place them in the branch's area? Same rule the drive shortlist applies in SQL, for code that
 * ranks requisitions in memory (the "Also fits" column, other-opening offers). No location evidence = no.
 */
export function placedInBranchArea(locationText: string | null | undefined, branchName: string | null | undefined, branchCity: string | null | undefined): boolean {
  const re = locationRegex(branchLocationTokens(branchName, branchCity));
  const text = String(locationText ?? "").toLowerCase();
  return Boolean(re && text && new RegExp(re, "i").test(text));
}
