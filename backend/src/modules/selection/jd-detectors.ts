// The phrase detectors behind jd-suggestions.ts. Pure. Each reads one clause and returns hits (a rule key, a value from the text
// and the span that matched), unparsed notes (recognised but not a rule we can suggest) or "understood, nothing to do".
import { CERT_FIELD_PATTERNS } from "../meta-campaign/lead-screener.service.js";
import type { RuleKey, RuleMode } from "./selection-types.js";

export interface Hit {
  key: RuleKey; value: Record<string, unknown>; start: number; end: number; confidence: "high" | "medium" | "low";
  /** Fixed mode (e.g. "freshers welcome" decides "no requirement"); otherwise the modality words decide. */
  mode?: RuleMode; why?: string; needs?: "wpm" | "years"; note?: string;
}
export type DetectorOut = Hit | { reason: string } | { ignore: true };
interface Ctx { field: string; branchCity: string }
type Detector = (seg: string, ctx: Ctx) => DetectorOut[];

const all = (re: RegExp, s: string) => [...s.matchAll(new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`))];
const hit = (key: RuleKey, value: Record<string, unknown>, m: RegExpMatchArray, confidence: Hit["confidence"], extra: Partial<Hit> = {}): Hit =>
  ({ key, value, start: m.index!, end: m.index! + m[0].length, confidence, ...extra });
const overlaps = (a: { start: number; end: number }, b: { start: number; end: number }) => a.start < b.end && b.start < a.end;
const num = (s: string | undefined) => (s === undefined ? null : Number(s));

// ── education ────────────────────────────────────────────────────────────────────────────────
const EDU: Array<[RegExp, string, Hit["confidence"]]> = [
  [/\b(?:post[\s-]?grad(?:uate|uation)?|pg|mba|masters?|m\.com|m\.sc)\b/i, "Post Graduate", "high"],
  [/(?<!post[\s-])\b(?:grad(?:uate|uation|uated|uates)?|bachelor'?s?(?:\s+degree)?|b\.\s?com|bcom|b\.\s?sc|bsc|b\.a\.?|bba|bca|b\.?\s?tech)\b/i, "Graduate", "high"],
  [/(?<!post[\s-])\b(?:ug|under[\s-]?graduate|degree)\b/i, "Graduate", "medium"],
  [/\b(?:diploma|iti)\b/i, "Diploma", "high"],
  [/(?:\b12\s?th|\btwelfth|\bxii(?:th)?|\bhsc|\bhigher\s+secondary|\+2)(?:\s+pass(?:ed)?)?\b/i, "12th", "high"],
  [/\b(?:10\s?th|tenth|matric(?:ulation)?|ssc|sslc)(?:\s+pass(?:ed)?)?\b/i, "10th", "high"],
];
const education: Detector = (seg) => {
  const out: Hit[] = [];
  for (const [re, level, c] of EDU) for (const m of all(re, seg)) {
    const h = hit("education_min", { level }, m, c);
    if (!out.some((o) => overlaps(o, h))) out.push(h);
  }
  return out;
};

// ── typing, English, languages ───────────────────────────────────────────────────────────────
const TYPING_N = /\btyping\b[^\d\n]{0,25}?(\d{2,3})\s*\+?\s*(?:wpm\b|w\.p\.m\.?|words(?:\s+per\s+min(?:ute)?)?)?|(\d{2,3})\s*\+?\s*wpm\b(?:\s+typing)?/i;
const TYPING = /\b(?:(?:good|fast|decent|excellent|basic|average|strong|quick)\s+)?typing(?:\s+(?:speed|skills?))?(?:\s+(?:achi|acchi|achha|accha|fast|good))?\b/i;
const typing: Detector = (seg) => {
  const n = seg.match(TYPING_N);
  if (n) {
    const wpm = Number(n[1] ?? n[2]);
    if (wpm < 10 || wpm > 120) return [{ reason: `Typing speed ${wpm} wpm is outside 10 to 120` }];
    return [hit("typing", { wpm }, n, "high")];
  }
  const m = seg.match(TYPING);
  return m ? [hit("typing", { wpm: null }, m, "medium", { needs: "wpm" })] : [];
};

const ENG_LEVEL: Record<string, "basic" | "intermediate" | "advanced"> = {
  fluent: "advanced", excellent: "advanced", strong: "advanced", proficient: "advanced", good: "intermediate", decent: "intermediate",
  average: "basic", basic: "basic", comfortable: "basic", working: "basic",
};
const ENG = /\b(fluent|excellent|strong|good|average|basic|comfortable|working|decent|proficient)\s+(?:(?:with|in|at)\s+)?(?:spoken\s+|written\s+|verbal\s+)?english\b|\benglish\s+(?:should\s+be\s+|is\s+|must\s+be\s+)?(fluent|excellent|good|basic|average)\b/i;
const english: Detector = (seg) => {
  const m = seg.match(ENG);
  return m ? [hit("english", { level: ENG_LEVEL[(m[1] ?? m[2]).toLowerCase()] }, m, "medium")] : [];
};
const LANG = /\b(hindi|english|gujarati|marathi|tamil|telugu|kannada|malayalam|bengali|bangla|punjabi|odia|oriya|urdu)\b/i;
const languages: Detector = (seg) => {
  const eng = seg.match(ENG);
  const engSpan = eng ? { start: eng.index!, end: eng.index! + eng[0].length } : null;
  const ms = all(LANG, seg).filter((m) => !engSpan || !overlaps(engSpan, { start: m.index!, end: m.index! + m[0].length }));
  if (!ms.length) return [];
  const names = [...new Set(ms.map((m) => { const l = m[1].toLowerCase(); const c = l === "bangla" ? "bengali" : l === "oriya" ? "odia" : l; return c[0].toUpperCase() + c.slice(1); }))];
  const first = ms[0], last = ms[ms.length - 1];
  return [{ key: "languages", value: { languages: names }, start: first.index!, end: last.index! + last[0].length, confidence: "medium" }];
};

// ── experience and age ───────────────────────────────────────────────────────────────────────
const FRESH_BOTH = /\bfreshers?\s*(?:or|and|\/|&)\s*experienced\b|\bexperienced\s*(?:or|and|\/|&)\s*freshers?\b/i;
const FRESH_OK = /\bfreshers?\s+(?:are\s+|can\s+|also\s+)?(?:welcome|apply|ok|okay|allowed|eligible)\b/i;
const FRESH = /\b(?:only\s+)?freshers?(?:\s+only)?\b/i;
const EXP_RANGE = /(\d{1,2}(?:\.\d)?)\s*(?:-|to|–)\s*(\d{1,2}(?:\.\d)?)\s*\+?\s*(?:years?|yrs?)\s*(?:of\s+)?(?:exp(?:erience)?|work)\b|\bexp(?:erience)?\s*(?:of|:|-)?\s*(\d{1,2})\s*(?:-|to|–)\s*(\d{1,2})\s*(?:years?|yrs?)/i;
const EXP_MIN = /(?:(?:minimum|min\.?|at\s*least|atleast)\s+)?(\d{1,2}(?:\.\d)?)\s*\+?\s*(?:years?|yrs?)\s*(?:of\s+)?(?:exp(?:erience)?|work)\b|\bexp(?:erience)?\s*(?:of|:|-)?\s*(?:minimum\s+|min\s+)?(\d{1,2})\s*\+?\s*(?:years?|yrs?)/i;
const EXPERIENCED = /\bexperienced\b/i;
const experience: Detector = (seg) => {
  const both = seg.match(FRESH_BOTH) ?? seg.match(FRESH_OK);
  if (both) return [hit("experience", {}, both, "high", { mode: "off", why: "freshers are welcome" })];
  const f = seg.match(FRESH);
  if (f) {
    return /only/i.test(f[0]) ? [hit("experience", { min: null, max: 0 }, f, "high")]
      : [hit("experience", {}, f, "medium", { mode: "off", why: "freshers named without \"only\"" })];
  }
  const r = seg.match(EXP_RANGE);
  if (r) {
    const lo = Number(r[1] ?? r[3]), hi = Number(r[2] ?? r[4]);
    if (lo > hi || hi > 40) return [{ reason: `Experience ${lo} to ${hi} years is not a valid range` }];
    return [hit("experience", { min: lo, max: hi }, r, "high")];
  }
  const m = seg.match(EXP_MIN);
  if (m) {
    const lo = Number(m[1] ?? m[2]);
    return lo > 40 ? [{ reason: `Experience ${lo} years is out of range` }] : [hit("experience", { min: lo, max: null }, m, "high")];
  }
  const e = seg.match(EXPERIENCED);
  return e ? [hit("experience", { min: null, max: null }, e, "medium", { needs: "years" })] : [];
};

const AGE_WORD = "(?:age|umar|umr|aayu)";
const AGE_RANGE = new RegExp(`\\b${AGE_WORD}\\b\\s*(?:limit|criteria|group|bracket)?\\s*[:\\-]?\\s*(?:between\\s+)?(\\d{2})\\s*(?:-|to|–|se|and)\\s*(\\d{2})(?:\\s*(?:years?|yrs?|saal))?|(\\d{2})\\s*(?:-|to|–)\\s*(\\d{2})\\s*(?:years?|yrs?)\\s*(?:of\\s+)?(?:age|old)\\b`, "i");
const AGE_BOUND = new RegExp(`\\b${AGE_WORD}\\b\\s*(?:limit|criteria)?\\s*[:\\-]?\\s*(below|under|less\\s+than|upto|up\\s+to|max(?:imum)?|within|above|over|more\\s+than|min(?:imum)?|at\\s+least)\\s*(\\d{2})(?:\\s*(?:years?|yrs?))?`, "i");
const AGE_PRE = new RegExp(`\\b(max(?:imum)?|upper|min(?:imum)?|lower)\\s+${AGE_WORD}(?:\\s+limit)?\\s*[:\\-]?\\s*(\\d{2})`, "i");
const AGE_ONE = new RegExp(`\\b${AGE_WORD}\\b\\s*(?:limit|criteria|criterion)?\\s*[:\\-]?\\s*(\\d{2})(?:\\s*(?:years?|yrs?|saal))?`, "i");
const ageOk = (n: number | null) => n === null || (n >= 14 && n <= 70);
const age: Detector = (seg) => {
  const pack = (min: number | null, max: number | null, m: RegExpMatchArray, c: Hit["confidence"], note?: string): DetectorOut[] =>
    (ageOk(min) && ageOk(max) && (min === null || max === null || min <= max) ? [hit("age", { min, max }, m, c, note ? { note } : {})] : [{ reason: "The age in the text is not a valid band" }]);
  const r = seg.match(AGE_RANGE);
  if (r) return pack(num(r[1] ?? r[3]), num(r[2] ?? r[4]), r, "high");
  const b = seg.match(AGE_BOUND);
  if (b) {
    const w = b[1].toLowerCase().replace(/\s+/g, " "), n = Number(b[2]);
    if (/below|under|less than/.test(w)) return pack(null, n - 1, b, "high", `"${b[1]} ${n}" read as up to ${n - 1}`);
    if (/upto|up to|max|within/.test(w)) return pack(null, n, b, "high");
    if (/more than/.test(w)) return pack(n + 1, null, b, "high", `"more than ${n}" read as at least ${n + 1}`);
    return pack(n, null, b, "high");
  }
  const p = seg.match(AGE_PRE);
  if (p) return /max|upper/i.test(p[1]) ? pack(null, Number(p[2]), p, "high") : pack(Number(p[2]), null, p, "high");
  const o = seg.match(AGE_ONE);
  return o ? pack(null, Number(o[1]), o, "low", `A single age (${o[1]}) is read as "up to ${o[1]}"`) : [];
};

// ── shifts ───────────────────────────────────────────────────────────────────────────────────
const DAY_NIGHT = /\bday\s*(?:and|\/|&|or)\s*night\b|\bnight\s*(?:and|\/|&|or)\s*day\b/i;
const ROTATIONAL = /\b(?:rotational|rotating|24\s*[*x×/]\s*7)\b([^.,;\n]{0,25}?)\bshifts?\b/i;
const NIGHT = /\bnight(?:\s*shifts?)?\b|\bus\s+shifts?\b|\bgraveyard\s+shifts?\b|\braat\s+(?:ki\s+)?shifts?\b/i;
const DAY = /\b(?:day|general|morning|din\s+ki)\s*shifts?\b|^\s*(?:day|general|morning)\s*$/i;
const shifts: Detector = (seg) => {
  const dn = seg.match(DAY_NIGHT);
  if (dn) return [hit("rotational_shift", {}, dn, "low", { note: "Day and night read as rotational shifts" })];
  const out: Hit[] = [];
  const r = seg.match(ROTATIONAL);
  if (r && !/week|off/i.test(r[1])) out.push(hit("rotational_shift", {}, r, "high"));
  const n = seg.match(NIGHT);
  if (n) out.push(hit("night_shift", {}, n, /us\s|raat/i.test(n[0]) ? "medium" : "high"));
  const d = seg.match(DAY);
  if (d && !n) out.push(hit("night_shift", { shift: "Day" }, d, "high", { mode: "off", why: "the text says day shift" }));
  return out;
};

// ── where people live ────────────────────────────────────────────────────────────────────────
const CITIES = ["Greater Noida", "Noida", "New Delhi", "Delhi NCR", "Delhi", "NCR", "Gurugram", "Gurgaon", "Ghaziabad", "Faridabad", "Ahmedabad", "Gandhinagar",
  "Navi Mumbai", "Mumbai", "Thane", "Pune", "Bengaluru", "Bangalore", "Hyderabad", "Chennai", "Kolkata", "Jaipur", "Lucknow", "Kanpur", "Indore", "Bhopal",
  "Chandigarh", "Mohali", "Surat", "Vadodara", "Rajkot", "Nagpur", "Patna", "Ranchi", "Dehradun", "Meerut"];
const CANON: Record<string, string> = { gurgaon: "Gurugram", bangalore: "Bengaluru", ncr: "Delhi NCR" };
const CITY_RE = new RegExp(`\\b(${CITIES.map((c) => c.replace(/\s+/g, "\\s+")).join("|")})\\b`, "gi");
const LIVES = /\b(from|residing|resident|residents|local|locals|nearby|near|stay|staying|live|living|belong(?:s|ing)?)\b/i;
const JOB_AT = /\b(location|office|work\s+from|based|posting|job\s+in|site|branch|relocate|travel)\b/i;
const location: Detector = (seg, ctx) => {
  const ms = [...seg.matchAll(CITY_RE)];
  if (!ms.length) return [];
  const names = [...new Set(ms.map((m) => { const k = m[1].toLowerCase().replace(/\s+/g, " "); return CANON[k] ?? CITIES.find((c) => c.toLowerCase() === k)!; }))];
  const own = (c: string) => !!ctx.branchCity && c.toLowerCase().includes(ctx.branchCity.toLowerCase());
  if (LIVES.test(seg)) {
    const first = ms[0], last = ms[ms.length - 1];
    return [{ key: "location_cities", value: { cities: names }, start: first.index!, end: last.index! + last[0].length, confidence: "medium" }];
  }
  const other = names.filter((c) => !own(c));
  if (!other.length) return [{ ignore: true }];
  return [{ reason: JOB_AT.test(seg) ? `The job location is not the branch city (${ctx.branchCity || "unknown"})` : "A city is named without saying whether people must live there" }];
};

// ── certificates, notice, skills keywords, gender, marital status ────────────────────────────
const CERT = /\b(dra|irdai?|ncfm|nse|amfi|nism)\b(?:\s*[-:]?\s*(?:certificates?|certification|certified|cert\.?|exam|qualified))?/gi;
const OTHER_CERT = /\b([A-Z]{2,6})\s+(?:certificates?|certification|certified)\b/g;
const certificate: Detector = (seg) => {
  const ms = [...seg.matchAll(CERT)];
  const out: DetectorOut[] = [];
  if (ms.length) {
    const codes = [...new Set(ms.map((m) => (m[1].toUpperCase() === "IRDAI" ? "IRDA" : m[1].toUpperCase())))].filter((c) => CERT_FIELD_PATTERNS[c]);
    const first = ms[0], last = ms[ms.length - 1];
    if (codes.length) out.push({ key: "certificate", value: { codes }, start: first.index!, end: last.index! + last[0].length, confidence: "high" });
  }
  for (const m of seg.matchAll(OTHER_CERT)) if (!CERT_FIELD_PATTERNS[m[1]] && m[1] !== "IRDAI") out.push({ reason: `${m[1]} is not a certificate the screening can check` });
  return out;
};

const NOTICE_NOW = /\bimmediate(?:ly)?\s+(?:joiners?|joining|join(?:ee)?s?|starters?)\b|\bjoin\s+immediately\b/i;
const NOTICE_N = /\b(?:notice(?:\s+period)?|join(?:ing)?\s+within)\s*(?:of\s+|:\s*)?(?:max(?:imum)?\s+|upto\s+|up\s+to\s+|within\s+)?(\d{1,2})\s*days?\b/i;
const notice: Detector = (seg) => {
  const n = seg.match(NOTICE_N);
  if (n) return [hit("notice_period", { maxDays: Number(n[1]) }, n, "high")];
  const m = seg.match(NOTICE_NOW);
  return m ? [hit("notice_period", { maxDays: 0 }, m, "medium")] : [];
};

const KEYWORDS: Array<[RegExp, string]> = [
  [/\b(?:hardcore\s+)?(?:sales?|selling|tele[\s-]?sales|tele[\s-]?calling)\s+(?:background|experience|exp|skills?|orientation|oriented|profile)\b/i, "Sales"],
  [/\b(?:(?:good|excellent|strong|average|basic|effective|fluent)\s+)?comm(?:unication)?s?\.?\s+skills?\b/i, "Communication"],
  [/\b(?:(?:basic|good)\s+)?computer\s+(?:knowledge|skills?|basics|literate|literacy|operations?)\b|\bms[\s-]?(?:office|excel)\b/i, "Computer basics"],
  [/\bbpo\b|\bcall\s+cent(?:er|re)\b|\bkpo\b/i, "BPO"],
  [/\bnon[\s-]?voice\b/i, "Non-voice"],
  [/(?<!non[\s-])(?<!non)\bvoice\b/i, "Voice process"],
];
/** A clause that is only one of the keywords (e.g. the "Sales" line an accepted suggestion added): nothing to report. */
export const KEYWORD_ONLY = /^\s*(?:sales|communication|computer basics|bpo|non-voice|voice process)\s*$/i;
const keywords: Detector = (seg, ctx) => {
  const out: Hit[] = [];
  for (const [re, keyword] of KEYWORDS) {
    const m = seg.match(re);
    if (m) out.push(hit("skills", { keyword }, m, ctx.field === "business_justification" ? "low" : "medium"));
  }
  return out;
};

const GENDER = /\b(female|male|girls?|boys?|ladies|gents|women|men)\b/i;
const MARITAL = /\b(married|unmarried|marital|spouse)\b/i;
const people: Detector = (seg) => [
  ...(GENDER.test(seg) ? [{ reason: "Gender is set only where the client contract requires it (criteria editor)" }] : []),
  ...(MARITAL.test(seg) ? [{ reason: "Marital status is not a selection rule" }] : []),
];

const DETECTORS: Detector[] = [education, typing, english, languages, experience, age, shifts, location, certificate, notice, keywords, people];

/** All detector output of one clause, hits in reading order. */
export function detect(seg: string, ctx: Ctx): DetectorOut[] {
  const out = DETECTORS.flatMap((d) => d(seg, ctx));
  return [...out.filter((o) => !("key" in o)), ...(out.filter((o): o is Hit => "key" in o).sort((a, b) => a.start - b.start || a.end - b.end))];
}
