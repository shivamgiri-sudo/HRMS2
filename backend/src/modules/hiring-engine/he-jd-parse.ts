/**
 * Reads a requisition's free-text "skills required" / education text into the same structured rules the screening
 * config uses, so matching works on requisitions nobody configured by hand. Only clear statements become rules.
 */
export interface JdRules {
  languages: string[];
  certifications: string[];
  minTypingWpm: number | null;
  englishLevel: "basic" | "intermediate" | "advanced" | null;
  gender: "male" | "female" | null;
  nightShift: boolean | null;
  minExperienceYears: number | null;
  streams: string[];
  /** Education level the text asks for, on the lead-screener ladder (2=10th 3=12th 5=graduate 6=PG); null if none. */
  minEducationRank: number | null;
}

const LANGS = ["english", "hindi", "marathi", "gujarati", "punjabi", "bengali", "tamil", "telugu", "kannada", "malayalam", "odia", "urdu", "assamese"];
const CERT: Record<string, RegExp> = { DRA: /(^|[^a-z])dra([^a-z]|$)/i, IRDA: /irda/i, NCFM: /ncfm/i, NISM: /nism/i, AMFI: /amfi/i };

export function parseJdText(text: string | null | undefined): JdRules {
  const t = String(text ?? "").toLowerCase();
  const r: JdRules = { languages: [], certifications: [], minTypingWpm: null, englishLevel: null, gender: null, nightShift: null, minExperienceYears: null, streams: [], minEducationRank: null };
  if (!t.trim()) return r;
  for (const l of LANGS) {
    const re = new RegExp(`(fluent|good|excellent|strong|proficient|speak|spoken|communication)[^.;,\\n]{0,30}${l}|${l}[^.;,\\n]{0,25}(fluen|speak|spoken|communication|proficien|mandatory|must|required)`);
    if (re.test(t)) r.languages.push(l);
  }
  for (const [c, re] of Object.entries(CERT)) if (re.test(t)) r.certifications.push(c);
  const wpm = t.match(/(\d{2,3})\s*(\+)?\s*(wpm|words per minute)/);
  if (wpm) r.minTypingWpm = Number(wpm[1]);
  if (/(advanced|excellent|fluent)\s+(written\s+)?english|english[^.;\n]{0,15}(advanced|excellent)/.test(t)) r.englishLevel = "advanced";
  else if (/(good|intermediate)\s+(written\s+)?english|written english/.test(t)) r.englishLevel = "intermediate";
  else if (/basic\s+english/.test(t)) r.englishLevel = "basic";
  if (/\b(female|women|ladies)\s+(only|candidates? only)|only\s+(female|women|ladies)/.test(t)) r.gender = "female";
  else if (/\b(male|men|boys)\s+(only|candidates? only)|only\s+(male|men|boys)/.test(t)) r.gender = "male";
  if (/night\s*shift|rotational\s*shift|24\s*[x*]\s*7|us\s*shift|uk\s*shift/.test(t)) r.nightShift = true;
  const exp = t.match(/(\d+(?:\.\d+)?)\s*\+?\s*(?:-\s*\d+\s*)?(?:years?|yrs?)\s*(?:of\s*)?(?:relevant\s*)?(?:experience|exp)/);
  if (exp) r.minExperienceYears = Number(exp[1]);
  else if (/fresher/.test(t)) r.minExperienceYears = 0;
  if (/post ?graduat|\bpg\b|master'?s degree|\bmba\b|\bm\.? ?com\b/.test(t)) r.minEducationRank = 6;
  else if (/graduat|bachelor|\bdegree\b|\bb\.? ?com\b|\bb\.? ?a\b|\bb\.? ?sc\b|\bbba\b|\bbca\b/.test(t)) r.minEducationRank = 5;
  else if (/12th|hsc|intermediate|higher secondary|\+2\b/.test(t)) r.minEducationRank = 3;
  else if (/10th|ssc|matric/.test(t)) r.minEducationRank = 2;
  // "Graduate preferred" makes the level optional; a "Preferred Skills" heading elsewhere in the JD does not.
  const EDU = "graduat|bachelor|degree|12th|10th|hsc|ssc|qualification|education|post ?graduat|\\bpg\\b";
  if (new RegExp(`(${EDU})[^.\\n]{0,40}(preferred|preferable|desirable|optional)|(preferred|preferable|desirable)[^.\\n:]{0,25}(${EDU})`).test(t)) r.minEducationRank = null;
  for (const [st, re] of [["commerce", /commerce|b\.? ?com\b/], ["science", /science graduate|b\.? ?sc\b/], ["it_engineering", /\bbca\b|b\.? ?tech|engineering graduate|\bit graduate/], ["management", /\bbba\b|\bmba\b/], ["arts", /arts graduate|\bb\.? ?a\b graduate/]] as const) {
    if (re.test(t)) r.streams.push(st);
  }
  return r;
}
