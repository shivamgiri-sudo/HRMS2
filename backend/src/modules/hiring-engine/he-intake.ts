/**
 * Candidate intake mapping (pure): any portal export or sheet (WorkIndia, Naukri, Apna, Indeed, Shine, foundit,
 * LinkedIn, vendor lists, walk-in / calling sheets, job website feed) -> one normalised row per person.
 *
 * Every portal names the same fact differently ("Mobile No.", "Contact Number", "Phone (Primary)", "Candidate's
 * Mobile"), so a column is recognised three ways, strongest first:
 *   1. a mapping HR confirmed earlier for this exact header layout (saved by header signature),
 *   2. header aliases + word-level fuzzy match against a field catalogue,
 *   3. the data itself (a column of 10-digit numbers is a phone, values with "@" are emails, dates of birth, ...).
 * Same idea as the Source-of-Truth sheet's Column_Mapping_Master, but self-learning.
 */
import { createHash } from "node:crypto";
import { normalizeMobile10 } from "./he-phone.js";

export const INTAKE_SOURCES = ["walkin", "meta", "calling", "website", "portal", "workindia", "naukri", "apna", "indeed", "shine", "foundit", "linkedin", "referral", "vendor", "other"] as const;
export type IntakeSource = (typeof INTAKE_SOURCES)[number];
export const INTAKE_MAX_ROWS = 5000;

export const FIELDS = [
  "mobile", "altMobile", "name", "firstName", "lastName", "email", "age", "dob", "gender", "education", "experience", "experienceMonths",
  "city", "state", "pincode", "process", "skills", "languages", "expectedSalary", "currentSalary", "consent", "appliedOn",
] as const;
export type Field = (typeof FIELDS)[number];

export const FIELD_LABEL: Record<Field, string> = {
  mobile: "Mobile", altMobile: "Alternate mobile", name: "Full name", firstName: "First name", lastName: "Last name", email: "Email",
  age: "Age", dob: "Date of birth", gender: "Gender", education: "Education", experience: "Experience (years)", experienceMonths: "Experience (months)",
  city: "City / location", state: "State", pincode: "Pincode", process: "Job / role applied", skills: "Skills", languages: "Languages",
  expectedSalary: "Expected salary", currentSalary: "Current salary", consent: "WhatsApp consent", appliedOn: "Applied on",
};

/** Normalised header -> words. "Candidate's Mobile No." -> "candidate s mobile no" */
export const normHeader = (h: string) => String(h ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();

const ALIASES: Record<Field, string[]> = {
  mobile: ["mobile", "mobile number", "mobile no", "mob no", "mob", "phone", "phone number", "phone no", "contact", "contact number", "contact no",
    "candidate mobile", "candidate phone", "candidate contact", "whatsapp", "whatsapp number", "whatsapp no", "primary phone", "primary mobile",
    "phone primary", "mobile primary", "cell", "cell phone", "telephone", "number", "applicant phone", "applicant mobile", "registered mobile"],
  altMobile: ["alternate mobile", "alternate number", "alternate phone", "alt mobile", "alt phone", "secondary phone", "secondary mobile", "other phone",
    "phone 2", "mobile 2", "phone secondary", "alternative number", "emergency contact"],
  name: ["name", "candidate name", "full name", "fullname", "applicant name", "candidate", "applicant", "jobseeker name", "job seeker name", "candidate full name", "student name"],
  firstName: ["first name", "firstname", "given name", "fname"],
  lastName: ["last name", "lastname", "surname", "family name", "lname"],
  email: ["email", "email id", "e mail", "mail", "email address", "mail id", "e mail id", "candidate email", "applicant email", "email address primary"],
  age: ["age", "age years", "age yrs", "candidate age"],
  dob: ["dob", "date of birth", "birth date", "birthdate", "d o b"],
  gender: ["gender", "sex", "candidate gender"],
  education: ["education", "qualification", "highest qualification", "education qualification", "highest education", "degree", "ug", "ug degree",
    "graduation", "course", "educational qualification", "education level", "highest degree", "qualification level"],
  experience: ["experience", "experience years", "experience yrs", "total experience", "exp", "work experience", "total exp", "years of experience",
    "experience in years", "total experience years", "overall experience", "relevant experience"],
  experienceMonths: ["experience months", "experience in months", "total experience months", "exp months", "months of experience"],
  city: ["city", "location", "current location", "area", "locality", "current city", "preferred location", "candidate location", "address city", "town", "district", "job location preference"],
  state: ["state", "current state", "region"],
  pincode: ["pincode", "pin code", "pin", "zip", "zip code", "postal code", "postcode"],
  process: ["process", "process name", "applied for", "role applied", "position", "job title", "job role", "role", "job", "job name", "designation",
    "applied job", "job applied", "job post", "vacancy", "profile", "department", "interested role", "job category", "category"],
  skills: ["skills", "key skills", "skill", "skill set", "skillset", "it skills", "keywords"],
  languages: ["languages", "language", "languages known", "language known", "spoken languages", "english speaking", "communication", "english level", "english fluency"],
  expectedSalary: ["expected salary", "expected ctc", "salary expectation", "expected pay", "desired salary", "expected monthly salary", "expected package", "salary expected"],
  currentSalary: ["current salary", "current ctc", "salary", "ctc", "last salary", "present salary", "current monthly salary", "annual salary"],
  consent: ["consent", "whatsapp consent", "opt in", "optin", "agreed to contact", "whatsapp opt in", "contact consent", "permission to contact"],
  appliedOn: ["applied on", "applied date", "date applied", "application date", "applied at", "created at", "created date", "date", "timestamp", "submission date", "lead date"],
};

/** Words that mean a column is NOT what its other words suggest ("Recruiter Mobile" is not the candidate's phone). */
const NEGATIVE = /\b(recruiter|hr|employer|company|manager|reference|referee|referrer|father|mother|guardian|spouse|interviewer|owner|agent|caller)\b/;

export interface ColumnGuess { header: string; field: Field | null; confidence: number; reason: string }
export type Mapping = Partial<Record<Field, string>>;

function headerScore(h: string, field: Field): number {
  const n = normHeader(h);
  if (!n) return 0;
  if (NEGATIVE.test(n) && ["mobile", "altMobile", "name", "email"].includes(field)) return 0;
  let best = 0;
  for (const a of ALIASES[field]) {
    if (n === a) return 100;
    const aw = a.split(" "), nw = n.split(" ");
    if (aw.every((w) => nw.includes(w))) best = Math.max(best, 70 + Math.min(20, aw.length * 5) - Math.max(0, nw.length - aw.length) * 3);
  }
  return best;
}

// ---- data sniffing ---------------------------------------------------------------------------------------------
const share = (vals: string[], pred: (v: string) => boolean) => { const v = vals.filter((x) => x.trim() !== ""); return v.length ? v.filter(pred).length / v.length : 0; };
const isPhone = (v: string) => normalizeMobile10(v) != null;
const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(v.trim());
const isGender = (v: string) => /^(m|f|male|female|other|man|woman|transgender)$/i.test(v.trim());
const isPin = (v: string) => /^[1-9]\d{5}$/.test(v.replace(/\s/g, ""));

function dataField(vals: string[]): { field: Field; score: number } | null {
  if (share(vals, isEmail) >= 0.6) return { field: "email", score: 75 };
  if (share(vals, isPhone) >= 0.7 && share(vals, (v) => /[a-z]/i.test(v)) < 0.1) return { field: "mobile", score: 65 };
  if (share(vals, isGender) >= 0.8) return { field: "gender", score: 65 };
  if (share(vals, isPin) >= 0.8) return { field: "pincode", score: 60 };
  return null;
}

/** Detect which column holds which field. Each field goes to its best column; each column feeds at most one field. */
export function detectColumns(rows: Array<Record<string, unknown>>, saved?: Mapping | null): { guesses: ColumnGuess[]; mapping: Mapping; signature: string } {
  const headers = rows.length ? Object.keys(rows[0]) : [];
  const signature = headerSignature(headers);
  const sample = rows.slice(0, 200);
  const values = (h: string) => sample.map((r) => (r[h] == null ? "" : String(r[h])));
  const mapping: Mapping = {};
  const used = new Set<string>();
  const guess = new Map<string, ColumnGuess>();
  if (saved) {
    for (const [f, h] of Object.entries(saved) as Array<[Field, string]>) {
      if (h && headers.includes(h) && !used.has(h)) { mapping[f] = h; used.add(h); guess.set(h, { header: h, field: f, confidence: 100, reason: "saved mapping" }); }
    }
  }
  // A layout HR already confirmed is used exactly as confirmed: columns they chose to ignore stay ignored.
  if (saved && Object.keys(mapping).length && mapping.mobile) {
    const guesses = headers.map((h) => guess.get(h) ?? { header: h, field: null, confidence: 100, reason: "ignored in the saved mapping" });
    return { guesses, mapping, signature };
  }
  // Candidate pairs (field, header, score), strongest first.
  const pairs: Array<{ f: Field; h: string; s: number; why: string }> = [];
  for (const h of headers) {
    if (used.has(h)) continue;
    for (const f of FIELDS) { const s = headerScore(h, f); if (s > 0) pairs.push({ f, h, s, why: "header" }); }
    const d = dataField(values(h));
    if (d && !NEGATIVE.test(normHeader(h))) pairs.push({ f: d.field, h, s: d.score, why: "data" });
  }
  pairs.sort((a, b) => b.s - a.s);
  for (const p of pairs) {
    if (mapping[p.f] || used.has(p.h) || p.s < 55) continue;
    // A second phone-looking column becomes the alternate number rather than being dropped.
    if (p.f === "mobile" && mapping.mobile) continue;
    mapping[p.f] = p.h; used.add(p.h);
    guess.set(p.h, { header: p.h, field: p.f, confidence: p.s, reason: p.why === "data" ? "recognised from the values" : "recognised from the header" });
  }
  if (!mapping.altMobile) {
    for (const h of headers) {
      if (used.has(h) || NEGATIVE.test(normHeader(h))) continue;
      if (share(values(h), isPhone) >= 0.5) { mapping.altMobile = h; used.add(h); guess.set(h, { header: h, field: "altMobile", confidence: 55, reason: "second phone column" }); break; }
    }
  }
  const guesses = headers.map((h) => guess.get(h) ?? { header: h, field: null, confidence: 0, reason: "not used" });
  return { guesses, mapping, signature };
}

export function headerSignature(headers: string[]): string {
  return createHash("sha1").update(headers.map(normHeader).filter(Boolean).sort().join("|")).digest("hex");
}

// ---- value parsing ---------------------------------------------------------------------------------------------
export function parseExperienceYears(raw: string | null, monthsHint = false): number | null {
  if (!raw) return null;
  const s = raw.toLowerCase().trim();
  if (/fresher|no experience|^nil$|^none$/.test(s)) return 0;
  // A range ("1-2 years") counts as its lower bound: never overstate experience.
  const rng = s.match(/^(\d+(?:\.\d+)?)\s*(?:-|to)\s*\d+(?:\.\d+)?\s*(y|yr|yrs|year|years|m|mo|month|months)?\b/);
  if (rng) { const v = Number(rng[1]); const mo = /^m/.test(rng[2] ?? (monthsHint ? "m" : "")); return Math.round((mo ? v / 12 : v) * 10) / 10; }
  const y = s.match(/(\d+(?:\.\d+)?)\s*(?:y|yr|yrs|year|years)\b/);
  const m = s.match(/(\d+(?:\.\d+)?)\s*(?:m|mo|mon|month|months)\b/);
  if (y || m) return Math.round(((y ? Number(y[1]) : 0) + (m ? Number(m[1]) / 12 : 0)) * 10) / 10;
  const range = s.match(/(\d+(?:\.\d+)?)\s*(?:-|to)\s*(\d+(?:\.\d+)?)/);
  const n = range ? Number(range[1]) : Number(s.replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(n) || s.replace(/[^0-9.]/g, "") === "") return null;
  const years = monthsHint ? n / 12 : n;
  return years >= 0 && years <= 45 ? Math.round(years * 10) / 10 : null;
}

export function parseAgeFromDob(raw: string | null, now = new Date()): number | null {
  if (!raw) return null;
  const s = raw.trim();
  let d: Date | null = null;
  const dmy = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  const ymd = s.match(/^(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})/);
  if (dmy) d = new Date(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1]));
  else if (ymd) d = new Date(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3]));
  else if (/^\d{5}$/.test(s)) d = new Date(Date.UTC(1899, 11, 30) + Number(s) * 86_400_000); // Excel serial
  if (!d || Number.isNaN(d.getTime())) return null;
  const age = Math.floor((now.getTime() - d.getTime()) / (365.25 * 86_400_000));
  return age >= 15 && age <= 70 ? age : null;
}

export function parseMoney(raw: string | null): number | null {
  if (!raw) return null;
  const s = raw.toLowerCase().replace(/,/g, "");
  const m = s.match(/(\d+(?:\.\d+)?)\s*(k|thousand|lpa|lakh|lakhs|lac|l)?/);
  if (!m) return null;
  let n = Number(m[1]);
  const u = m[2] ?? "";
  if (u === "k" || u === "thousand") n *= 1000;
  else if (["lpa", "lakh", "lakhs", "lac", "l"].includes(u)) n = (n * 100000) / 12;
  else if (n >= 100000) n /= 12; // an annual figure written in full
  else if (n < 1000) return null;
  return n >= 3000 && n <= 500000 ? Math.round(n) : null;
}

const LANGS = ["english", "hindi", "marathi", "gujarati", "punjabi", "bengali", "tamil", "telugu", "kannada", "malayalam", "odia", "urdu", "assamese"];

export interface IntakeRow {
  rowNo: number; ok: boolean; reason?: string; mobile10?: string; altMobile10?: string | null; name?: string | null; email?: string | null;
  age?: number | null; education?: string | null; experienceYears?: number | null; city?: string | null; pincode?: string | null;
  gender?: "male" | "female" | "other" | null; process?: string | null; skills?: string | null; languages?: string[] | null;
  expectedSalary?: number | null; consent?: boolean;
}

export function mapIntakeRows(rows: Array<Record<string, unknown>>, mappingIn?: Mapping | null): { rows: IntakeRow[]; missingColumns: string[]; tooMany: boolean; mapping: Mapping } {
  if (rows.length > INTAKE_MAX_ROWS) return { rows: [], missingColumns: [], tooMany: true, mapping: {} };
  const mapping = mappingIn && mappingIn.mobile ? mappingIn : detectColumns(rows, mappingIn ?? null).mapping;
  if (!mapping.mobile) return { rows: [], missingColumns: ["mobile"], tooMany: false, mapping };
  const seen = new Set<string>();
  const out = rows.map((r, i): IntakeRow => {
    const get = (f: Field) => { const c = mapping[f]; const v = c ? r[c] : undefined; const s = v == null ? "" : String(v).trim(); return s || null; };
    // Some portals put two numbers in one cell ("98xxxxxx01 / 98xxxxxx02").
    const phones = (get("mobile") ?? "").split(/[\/,;|]| or /i).map((p) => normalizeMobile10(p)).filter((p): p is string => Boolean(p));
    const m = phones[0] ?? null;
    if (!m) return { rowNo: i + 2, ok: false, reason: "invalid_mobile" };
    if (seen.has(m)) return { rowNo: i + 2, ok: false, reason: "duplicate_in_file", mobile10: m };
    seen.add(m);
    const alt = normalizeMobile10(get("altMobile") ?? "") ?? phones[1] ?? null;
    const name = get("name") ?? ([get("firstName"), get("lastName")].filter(Boolean).join(" ") || null);
    const ageNum = Number(get("age"));
    const age = Number.isFinite(ageNum) && ageNum >= 15 && ageNum <= 70 ? Math.round(ageNum) : parseAgeFromDob(get("dob"));
    const exp = get("experienceMonths") ? parseExperienceYears(get("experienceMonths"), true) : parseExperienceYears(get("experience"), /month/i.test(mapping.experience ?? ""));
    const g = (get("gender") ?? "").toLowerCase();
    const langText = `${get("languages") ?? ""} ${get("skills") ?? ""}`.toLowerCase();
    const langs = LANGS.filter((l) => langText.includes(l));
    const c = (get("consent") ?? "").toLowerCase();
    return {
      rowNo: i + 2, ok: true, mobile10: m, altMobile10: alt && alt !== m ? alt : null, name, email: get("email"), age,
      education: get("education"), experienceYears: exp, city: get("city") ?? get("state"), pincode: (get("pincode") ?? "").replace(/\D/g, "").slice(0, 6) || null,
      gender: /^(m|male|man)$/.test(g) ? "male" : /^(f|female|woman)$/.test(g) ? "female" : g ? "other" : null,
      process: get("process"), skills: get("skills"), languages: langs.length ? langs : get("languages") ? [] : null,
      expectedSalary: parseMoney(get("expectedSalary")), consent: /^(y|yes|true|1|agreed|haan|opted in)$/.test(c),
    };
  });
  return { rows: out, missingColumns: [], tooMany: false, mapping };
}
