/**
 * Profile extraction (pure): turns Meta form answers (normalised field name -> answer) into the skill facts the
 * matcher needs. A fact is set only when the answer is clear; anything ambiguous stays null (unknown, never guessed).
 */
export interface LeadProfile {
  gender: "male" | "female" | "other" | null;
  languages: string[] | null;
  certifications: string[] | null;
  typingWpm: number | null;
  englishLevel: "basic" | "intermediate" | "advanced" | null;
  salaryExpectation: number | null;
}

export const EMPTY_PROFILE: LeadProfile = { gender: null, languages: null, certifications: null, typingWpm: null, englishLevel: null, salaryExpectation: null };

const YES = /^(yes|y|haan|ha|han|yess|yas|ok|okay|sure|ji|true|1)\b/i;
const NO = /^(no|n|nahi|nahin|na|false|0)\b/i;
const LANGS = ["english", "hindi", "marathi", "gujarati", "punjabi", "bengali", "tamil", "telugu", "kannada", "malayalam", "odia", "urdu", "assamese"];
// Field names are normalised with "_" (a word character), so word boundaries are spelled as "not a letter".
const CERTS: Record<string, RegExp> = { DRA: /(^|[^a-z])dra([^a-z]|$)/i, IRDA: /irda|insurance.*certif/i, NCFM: /ncfm/i, NSE: /(^|[^a-z])nse([^a-z]|$)/i, AMFI: /amfi|(^|[^a-z])arn([^a-z]|$)/i, NISM: /nism/i };

export function parseSalary(v: string): number | null {
  const s = v.toLowerCase().replace(/,/g, "");
  const m = s.match(/(\d+(?:\.\d+)?)\s*(k|thousand|lpa|lakh|lac|l)?/);
  if (!m) return null;
  let n = Number(m[1]);
  const unit = m[2] ?? "";
  if (unit === "k" || unit === "thousand") n *= 1000;
  else if (["lpa", "lakh", "lac", "l"].includes(unit)) n = Math.round((n * 100000) / 12);
  else if (n < 100) return null; // "25" alone is ambiguous
  return n >= 3000 && n <= 500000 ? Math.round(n) : null;
}

export function extractProfile(fields: Record<string, string>): LeadProfile {
  const p: LeadProfile = { ...EMPTY_PROFILE };
  const langs = new Set<string>();
  const certs = new Set<string>();
  let langAsked = false, certAsked = false;
  for (const [rawKey, rawVal] of Object.entries(fields)) {
    const k = rawKey.toLowerCase();
    const v = String(rawVal ?? "").trim();
    if (!v) continue;
    if (/gender|^sex$/.test(k)) {
      const g = v.toLowerCase();
      p.gender = /^(m|male|man|purush)\b/.test(g) ? "male" : /^(f|female|woman|mahila)\b/.test(g) ? "female" : /other|non.?binary/.test(g) ? "other" : p.gender;
    }
    if (/language|bhasha|speak|fluent/.test(k)) {
      langAsked = true;
      const named = LANGS.filter((l) => k.includes(l));
      if (named.length && YES.test(v)) named.forEach((l) => langs.add(l));
      else if (!named.length) LANGS.filter((l) => v.toLowerCase().includes(l)).forEach((l) => langs.add(l));
    }
    for (const [code, re] of Object.entries(CERTS)) {
      if (re.test(k)) { certAsked = true; if (YES.test(v) || re.test(v)) certs.add(code); }
      else if (/certif/.test(k) && re.test(v)) { certAsked = true; certs.add(code); }
    }
    if (/typing|wpm/.test(k)) { const m = v.match(/(\d+)/); if (m) p.typingWpm = Math.min(200, Number(m[1])); }
    if (/english/.test(k) && /(written|writ|level|skill)/.test(k)) {
      const l = v.toLowerCase();
      p.englishLevel = /advanced|fluent|excellent/.test(l) ? "advanced" : /intermediate|good|average/.test(l) ? "intermediate" : /basic|poor|beginner/.test(l) ? "basic" : p.englishLevel;
    }
    if (/salary|ctc|expect.*(pay|package)/.test(k)) p.salaryExpectation = parseSalary(v) ?? p.salaryExpectation;
    if (/english/.test(k) && !/(written|level)/.test(k) && YES.test(v)) { langAsked = true; langs.add("english"); }
    if (NO.test(v) && /certif/.test(k)) certAsked = true;
  }
  if (langs.size) p.languages = [...langs];
  else if (langAsked) p.languages = [];
  if (certs.size) p.certifications = [...certs];
  else if (certAsked) p.certifications = [];
  return p;
}
