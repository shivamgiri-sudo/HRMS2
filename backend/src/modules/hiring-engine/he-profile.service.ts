/**
 * Fills he_lead_profile (skills/profile facts) for one mobile prefix, from the Meta form answers and the ATS record.
 * Read in place, written as one small row per lead; unknown stays NULL.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { extractProfile, type LeadProfile } from "./he-profile.js";
import { recordIdentities } from "./he-identity.service.js";
import { prefixLike } from "./he-master.service.js";

const BATCH = 500;
const norm = (k: string) => k.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

export function answersFromPayload(raw: unknown): Record<string, string> {
  try {
    const o = typeof raw === "string" ? JSON.parse(raw) : raw;
    const fd = (o as { field_data?: Array<{ name?: string; values?: unknown[] }> })?.field_data;
    if (!Array.isArray(fd)) return {};
    const out: Record<string, string> = {};
    for (const f of fd) if (f?.name) out[norm(String(f.name))] = (f.values ?? []).map(String).join(", ");
    return out;
  } catch { return {}; }
}

function gender(v: unknown): LeadProfile["gender"] {
  const g = String(v ?? "").toLowerCase();
  return /^m(ale)?$/.test(g) ? "male" : /^f(emale)?$/.test(g) ? "female" : g ? "other" : null;
}

export async function refreshProfilesChunk(prefix: string): Promise<{ profiles: number }> {
  const like = prefixLike(prefix);
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT l.id, mr.raw_payload, c.gender AS ats_gender, c.aadhar_number_hash AS aadhaar_hash, c.pan_number_hash AS pan_hash
       FROM he_lead l
       LEFT JOIN meta_lead_raw mr ON mr.id = l.meta_lead_id
       LEFT JOIN ats_candidate c ON c.id = l.ats_candidate_id
      WHERE l.mobile10 LIKE ? AND (l.meta_lead_id IS NOT NULL OR l.ats_candidate_id IS NOT NULL)`, [like]);
  const out: unknown[][] = [];
  for (const r of rows) {
    if (r.aadhaar_hash || r.pan_hash) await recordIdentities(r.id, { aadhaarHash: r.aadhaar_hash, panHash: r.pan_hash, source: "ats" });
    const answers = answersFromPayload(r.raw_payload);
    const p = extractProfile(answers);
    const skillsText = Object.entries(answers).map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`).join('; ').slice(0, 1000) || null;
    const g = p.gender ?? gender(r.ats_gender);
    const wpm = p.typingWpm;
    if (!g && !wpm && p.languages == null && p.certifications == null && !p.englishLevel && !p.salaryExpectation && !skillsText) continue;
    out.push([r.id, g, p.languages ? JSON.stringify(p.languages) : null, p.certifications ? JSON.stringify(p.certifications) : null, wpm, p.englishLevel, p.salaryExpectation, skillsText]);
  }
  for (let i = 0; i < out.length; i += BATCH) {
    const slice = out.slice(i, i + BATCH);
    await db.execute(
      `INSERT INTO he_lead_profile (lead_id, gender, languages, certifications, typing_wpm, english_level, salary_expectation, skills_text)
       VALUES ${slice.map(() => "(?,?,?,?,?,?,?,?)").join(",")}
       ON DUPLICATE KEY UPDATE gender = COALESCE(VALUES(gender), gender), languages = COALESCE(VALUES(languages), languages),
         certifications = COALESCE(VALUES(certifications), certifications), typing_wpm = COALESCE(VALUES(typing_wpm), typing_wpm),
         english_level = COALESCE(VALUES(english_level), english_level), salary_expectation = COALESCE(VALUES(salary_expectation), salary_expectation),
         skills_text = COALESCE(VALUES(skills_text), skills_text)`,
      slice.flat() as never[]);
  }
  return { profiles: out.length };
}

const parseList = (v: unknown): string[] | null => {
  if (v == null) return null;
  try { const a = typeof v === "string" ? JSON.parse(v) : v; return Array.isArray(a) ? a.map(String) : null; } catch { return null; }
};

/** Profile facts in matcher shape, keyed by lead id. */
export type MatchProfile = Partial<LeadProfile> & { skillsText?: string | null; educationStatus?: "completed" | "pursuing" | "dropped" | null; stream?: string | null; lastSalary?: number | null; prevIndustry?: string | null; state?: string | null };
export async function loadProfiles(leadIds: string[]): Promise<Map<string, MatchProfile>> {
  const out = new Map<string, MatchProfile>();
  for (let i = 0; i < leadIds.length; i += 1000) {
    const part = leadIds.slice(i, i + 1000);
    if (!part.length) continue;
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT lead_id, gender, languages, certifications, typing_wpm, english_level, salary_expectation, education_status, stream, last_salary, prev_industry, state, skills_text FROM he_lead_profile WHERE lead_id IN (${part.map(() => "?").join(",")})`, part);
    for (const r of rows) out.set(r.lead_id, {
      gender: r.gender ?? null, languages: parseList(r.languages), certifications: parseList(r.certifications),
      typingWpm: r.typing_wpm ?? null, englishLevel: r.english_level ?? null, salaryExpectation: r.salary_expectation ?? null,
      educationStatus: r.education_status ?? null, stream: r.stream ?? null, lastSalary: r.last_salary ?? null, prevIndustry: r.prev_industry ?? null, state: r.state ?? null, skillsText: r.skills_text ?? null,
    });
  }
  return out;
}
