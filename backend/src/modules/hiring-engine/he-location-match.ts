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
 * Where the person LIVES, per the records (lower-cased SQL expression; needs the aliases l = he_lead, ac = ats_candidate, mr = meta_lead_raw and
 * lp = he_lead_profile). Deliberately NOT included: the branch they applied to and their campaign's branch (those say where the JOB is, not where
 * they live: a Noida-campaign lead living in Gujarat must not count as a Noida local), and recruiter branch names.
 */
export const RESIDENCE_SQL = `LOWER(CONCAT_WS(' ', l.locality, ac.current_address, ac.address, ac.permanent_address, mr.parsed_location, lp.address, lp.state,
  (SELECT GROUP_CONCAT(a.candidate_location SEPARATOR ' ') FROM ats_recruiter_hiring_activity a WHERE a.mobile10 = l.mobile10)))`;

/** "No Noida location", "not in Delhi", "outside Noida": the city is named but ruled out. MySQL REGEXP; null when there are no tokens. */
export function negationRegex(tokens: string[]): string | null {
  const t = tokens.map((x) => x.replace(/[^a-z ]/g, "").trim()).filter((x) => x.length >= 3);
  if (!t.length) return null;
  return `(^|[^a-z])(no|not|nahi|nahin|outside|other than|except|cannot|cant)[ -]+([a-z]+[ -]+){0,2}(${t.map((x) => x.replace(/ /g, "[ -]?")).join("|")})([^a-z]|$)`;
}

/**
 * Does this person's location evidence place them in the branch's area? Same rule the drive shortlist applies in SQL, for code that
 * ranks requisitions in memory (the "Also fits" column, other-opening offers). No location evidence = no.
 */
export function placedInBranchArea(locationText: string | null | undefined, branchName: string | null | undefined, branchCity: string | null | undefined): boolean {
  const tokens = branchLocationTokens(branchName, branchCity);
  const re = locationRegex(tokens), neg = negationRegex(tokens);
  const text = String(locationText ?? "").toLowerCase();
  return Boolean(re && text && new RegExp(re, "i").test(text) && !(neg && new RegExp(neg, "i").test(text)));
}

// Places that are clearly somewhere else. Only used to REFUSE a lead whose own answer names such a place; an answer that names no known place
// (a neighbourhood, a sector, a landmark) is never refused, so a valid local lead is not lost to an unknown spelling.
const OTHER_STATES = ["gujarat", "maharashtra", "rajasthan", "punjab", "karnataka", "tamil nadu", "kerala", "west bengal", "bihar", "jharkhand", "odisha", "madhya pradesh", "telangana",
  "andhra pradesh", "assam", "chhattisgarh", "uttarakhand", "himachal", "goa", "jammu", "kashmir"];
const OTHER_CITIES = ["surat", "vadodara", "baroda", "rajkot", "bhavnagar", "indore", "bhopal", "nagpur", "nashik", "patna", "ranchi", "bhubaneswar", "chandigarh", "ludhiana", "amritsar", "kanpur", "agra",
  "varanasi", "coimbatore", "kochi", "cochin", "vizag", "visakhapatnam", "jodhpur", "udaipur", "dehradun", "guwahati", "raipur", "mysore", "mangalore", "madurai", "thiruvananthapuram", "meerut", "gwalior"];

export type LocationVerdict = "local" | "elsewhere" | "unknown";

/**
 * Where does this answer put the person relative to a branch? local = names the branch's area; elsewhere = says they are not there ("No Noida location")
 * or names a different known place (Gujarat for a Noida branch); unknown = no usable place (no text, or only a neighbourhood). Only "elsewhere" is a reason to refuse.
 */
export function locationVerdict(text: string | null | undefined, branchName: string | null | undefined, branchCity: string | null | undefined, branchState?: string | null): LocationVerdict {
  const t = String(text ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  if (!t) return "unknown";
  const own = branchLocationTokens(branchName, branchCity);
  const neg = negationRegex(own);
  if (neg && new RegExp(neg, "i").test(t)) return "elsewhere";
  const ownRe = locationRegex(own);
  if (ownRe && new RegExp(ownRe, "i").test(t)) return "local";
  const state = clean(branchState);
  const ownRegion = new Set([...own, state].filter(Boolean));
  const places = [...REGIONS.flat(), ...OTHER_STATES, ...OTHER_CITIES].filter((p) => !ownRegion.has(p) && !(state && (p === state || state.includes(p) || p.includes(state))));
  const re = locationRegex(places);
  return re && new RegExp(re, "i").test(t) ? "elsewhere" : "unknown";
}
