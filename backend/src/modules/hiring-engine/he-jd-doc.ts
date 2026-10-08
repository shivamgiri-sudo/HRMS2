/**
 * JD understanding and skill scoring (pure), ported from the BMS ("Book My Interview") screening tool and adapted to
 * HRMS: reads a JD in the MAS "JD Format" (Job Title / Location / Minimum Experience / Salary / Mandatory Skills /
 * Preferred Skills, as label lines or bullet lists) and scores a candidate's skill text against it the way BMS did:
 * mandatory 45, experience 25, location 15, salary 15, any preferred skill +5, with a rating label, strengths and gaps.
 */

export interface StructuredJd {
  title: string | null;
  location: string | null;
  employmentType: string | null;
  minExperience: number | null;
  maxExperience: number | null;
  /** Monthly INR (BMS stored LPA; HRMS works in monthly salary). */
  salaryMonthly: number | null;
  mandatorySkills: string[];
  preferredSkills: string[];
}

const matchLabelValue = (text: string, labelPattern: string): string | null => {
  const same = text.match(new RegExp(`^[ \\t]*(?:${labelPattern})[ \\t]*[:\\-]?[ \\t]+(\\S[^\\n]*)$`, "im"));
  if (same) return same[1].trim();
  const next = text.match(new RegExp(`^[ \\t]*(?:${labelPattern})[ \\t]*[:\\-]?[ \\t]*\\r?\\n[ \\t]*(\\S[^\\n]*)$`, "im"));
  return next ? next[1].trim() : null;
};

const isSectionHeading = (line: string) => /^[a-z][a-z0-9 /&()-]{1,50}:?\s*$/i.test(line.trim());
const BULLET = /^(?:[-•*●▪‣◦○]|\d+[.)])\s*/;
function listSection(lines: string[], heading: RegExp): string[] {
  const start = lines.findIndex((l) => heading.test(l.trim()));
  if (start < 0) return [];
  const items: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    if (isSectionHeading(line) && !BULLET.test(line)) break;
    const bullet = BULLET.test(line);
    const value = line.replace(BULLET, "").replace(/\.$/, "").trim();
    if (!value) continue;
    items.push(...(bullet ? value.split(/,\s*/) : value.split(",")).map((s) => s.trim()).filter(Boolean));
  }
  return items;
}
const MANDATORY = /^(?:required|mandatory|key|must[\s-]?have|primary|core|essential|technical)\s*(?:skills?|competencies|requirements?)?\s*:?$|^(?:technical\s+)?skills?(?:\s+required)?\s*:?$/i;
const PREFERRED = /^(?:preferred|good[\s-]?to[\s-]?have|nice[\s-]?to[\s-]?have|desired|desirable|secondary|additional|bonus|optional)\s*(?:skills?|competencies)?\s*:?$/i;

export function parseExperienceRange(text: string): { min: number | null; max: number | null } {
  const n = text.toLowerCase();
  if (/\b(fresher|entry[\s-]?level|no\s+experience\s+required)\b/.test(n)) return { min: 0, max: null };
  const range = n.match(/(\d+(?:\.\d+)?)\s*(?:-|to|–|—)\s*(\d+(?:\.\d+)?)\s*\+?\s*(?:years?|yrs?)/);
  if (range) return { min: Number(range[1]), max: Number(range[2]) };
  const one = n.match(/(\d+(?:\.\d+)?)\s*\+?\s*(?:years?|yrs?)/);
  if (one) return { min: Number(one[1]), max: null };
  const months = n.match(/(\d+)\s*(?:months?)/);
  if (months) return { min: Math.round((Number(months[1]) / 12) * 10) / 10, max: null };
  return { min: null, max: null };
}

/** "3 LPA" -> 25000 / month; "18,000 - 22,000" -> 22000; plain monthly numbers kept. */
export function parseJdSalaryMonthly(text: string): number | null {
  const n = text.toLowerCase().replace(/,/g, "");
  const lpa = n.match(/(\d+(?:\.\d+)?)\s*(?:-|to)?\s*(\d+(?:\.\d+)?)?\s*(lpa|lacs?|lakhs?|l\b)/);
  if (lpa) return Math.round((Number(lpa[2] ?? lpa[1]) * 100000) / 12);
  const k = n.match(/(\d+(?:\.\d+)?)\s*k\b/);
  if (k) return Math.round(Number(k[1]) * 1000);
  const range = n.match(/(\d{4,6})\s*(?:-|to)\s*(\d{4,6})/);
  if (range) return Number(range[2]);
  const plain = n.match(/(\d{4,6})/);
  return plain ? Number(plain[1]) : null;
}

function employmentType(v: string | null): string | null {
  const s = String(v ?? "").toLowerCase();
  if (/intern/.test(s)) return "Internship";
  if (/part[\s-]?time/.test(s)) return "Part Time";
  if (/contract|freelance/.test(s)) return "Contract";
  if (/full[\s-]?time/.test(s)) return "Full Time";
  return null;
}

export function parseStructuredJd(text: string): StructuredJd {
  const t = String(text ?? "");
  const lines = t.split(/\r?\n/);
  const expLabel = matchLabelValue(t, "years?\\s*of\\s*experience|work\\s*experience|min(?:imum)?\\s*experience|experience\\s*required|experience|exp");
  const exp = parseExperienceRange(expLabel ?? "");
  const salaryLabel = matchLabelValue(t, "salary|ctc|compensation|package|stipend|pay");
  const locLabel = matchLabelValue(t, "job\\s*location|work\\s*location|office\\s*location|location|based\\s*at");
  let mandatory = listSection(lines, MANDATORY);
  const preferred = listSection(lines, PREFERRED);
  if (!mandatory.length) {
    const inline = matchLabelValue(t, "key\\s*skills|must[\\s-]?have\\s*skills|skills\\s*required|required\\s*skills|mandatory\\s*skills|skills");
    if (inline) mandatory = inline.split(",").map((s) => s.trim()).filter(Boolean);
  }
  const mLower = new Set(mandatory.map((s) => s.toLowerCase()));
  return {
    title: matchLabelValue(t, "job\\s*title|position(?:\\s*title)?|role|designation") ?? null,
    location: locLabel ? locLabel.split(/[,/]/)[0].trim().slice(0, 120) : null,
    employmentType: employmentType(matchLabelValue(t, "employment\\s*type|job\\s*type")),
    minExperience: exp.min, maxExperience: exp.max,
    salaryMonthly: salaryLabel ? parseJdSalaryMonthly(salaryLabel) : null,
    mandatorySkills: [...new Set(mandatory)].slice(0, 30),
    preferredSkills: [...new Set(preferred)].filter((s) => !mLower.has(s.toLowerCase())).slice(0, 30),
  };
}

const norm = (v: string) => v.toLowerCase().replace(/[\s.\-_/]+/g, "");
/** Same skill in the words candidates and portals actually use (a JD skill matching the left side also matches the right). */
const SYNONYMS: Array<[RegExp, RegExp]> = [
  [/collection/, /collection|recovery|debt|npa|dra\b|dunning/],
  [/\bsales?\b|\bsale experience|selling/, /sale|selling|telecall|tele[\s-]?call|business development|\bbde?\b/],
  [/communication/, /communication|english|fluent|spoken|presentation/],
  [/customer (service|support|care)/, /customer (service|support|care|handling)|\bcsr?\b|\bbpo\b|call cent(er|re)|helpdesk/],
  [/data entry/, /data entry|typing|back office|backoffice/],
  [/team (handling|management|lead)/, /team (handling|management|lead|leader)|\btl\b|supervis/],
  [/(ms )?excel/, /excel|spreadsheet|ms office/],
];
/** Which skills appear in the candidate's text (substring, tolerant of spaces/punctuation; "sale experience" ~ "sales"). */
export function matchSkills(text: string, skills: string[]): string[] {
  const lower = text.toLowerCase();
  const n = norm(text);
  return skills.map((s) => s.trim()).filter((skill) => {
    if (!skill) return false;
    const sl = skill.toLowerCase();
    if (lower.includes(sl)) return true;
    if (SYNONYMS.some(([skillRe, textRe]) => skillRe.test(sl) && textRe.test(lower))) return true;
    const ns = norm(skill);
    if (ns.length > 2 && n.includes(ns)) return true;
    // multi-word skills: every meaningful word stem present ("sale experience" matches "sales executive, 2 yrs experience")
    const words = sl.split(/\s+/).filter((w) => w.length > 3).map((w) => w.slice(0, Math.max(4, w.length - 2)));
    return words.length > 1 && words.every((w) => lower.includes(w));
  });
}

export const ratingFor = (score: number) => (score >= 85 ? "Excellent Match" : score >= 70 ? "Strong Match" : score >= 55 ? "Moderate Match" : score >= 40 ? "Low Match" : "Poor Match");

export interface BmsScore { score: number; rating: string; strengths: string[]; gaps: string[]; matched: string[]; matchedPreferred: string[] }

/** BMS weighting: mandatory 45, experience 25, location 15, salary 15, preferred +5. Unknown inputs count as neutral. */
export function bmsScore(jd: StructuredJd, c: { skillsText: string | null; experienceYears: number | null; locationOk: boolean | null; salaryMonthly: number | null }): BmsScore {
  const text = c.skillsText ?? "";
  const matched = text ? matchSkills(text, jd.mandatorySkills) : [];
  const matchedPreferred = text ? matchSkills(text, jd.preferredSkills) : [];
  const mandatoryScore = !jd.mandatorySkills.length ? 1 : text ? matched.length / jd.mandatorySkills.length : 0.5;
  const minExp = jd.minExperience ?? 0;
  const expScore = c.experienceYears == null ? 0.5 : minExp > 0 ? Math.min(1, c.experienceYears / minExp) : 1;
  const locScore = c.locationOk == null ? 0.5 : c.locationOk ? 1 : 0;
  const salScore = !jd.salaryMonthly || !c.salaryMonthly ? 1 : c.salaryMonthly <= jd.salaryMonthly * 1.15 ? 1 : 0;
  const score = Math.round(Math.min(100, mandatoryScore * 45 + expScore * 25 + locScore * 15 + salScore * 15 + (matchedPreferred.length ? 5 : 0)));
  const strengths: string[] = [];
  const gaps: string[] = [];
  if (matched.length) strengths.push(`${matched.length} of ${jd.mandatorySkills.length} mandatory skills: ${matched.join(", ")}`);
  if (matchedPreferred.length) strengths.push(`preferred: ${matchedPreferred.join(", ")}`);
  if (text) for (const s of jd.mandatorySkills.filter((x) => !matched.includes(x))) gaps.push(`${s} not found`);
  if (c.experienceYears != null && minExp > 0 && c.experienceYears < minExp) gaps.push(`${c.experienceYears} yrs experience, JD asks ${minExp}`);
  if (c.locationOk === false) gaps.push("location does not match the JD");
  if (salScore === 0) gaps.push("salary expectation above the JD");
  return { score, rating: ratingFor(score), strengths, gaps, matched, matchedPreferred };
}
