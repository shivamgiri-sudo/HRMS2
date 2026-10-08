/**
 * A requisition row in matcher shape, as the drive line-up has always built it (pure, no JD document).
 * Moved verbatim from he-drive.service.ts so the selection criteria compiler can reuse it without the DB layer.
 */
import { eduRank } from "../meta-campaign/lead-screener.service.js";
import { parseJdText } from "./he-jd-parse.js";
import { industriesForProcess, type MatchRequisition } from "./he-matcher.js";

export interface MatchReqRow {
  id: string; branch_name: string; process_name: string | null; designation_name: string;
  requested_headcount: number; fulfilled_headcount: number; approval_status: string; active_status: number;
  meta_target_age_min: number | null; meta_target_age_max: number | null; meta_target_radius_km: number | null;
  education_requirement: string | null; experience_min_years: number | null; night_shift_required: number;
  salary_max?: number | null; meta_screening_config?: unknown; skills_required?: string | null;
  blat: number | null; blng: number | null; bcity?: string | null; bstate?: string | null;
}

/** JD requirements beyond age/education: gender, languages, certifications, typing, written English (MetaScreeningConfig). */
function screeningOf(raw: unknown): Pick<MatchRequisition, "gender" | "languages" | "certifications" | "minTypingWpm" | "englishLevel"> {
  let c: Record<string, unknown> = {};
  try { c = (typeof raw === "string" ? JSON.parse(raw) : raw) as Record<string, unknown> ?? {}; } catch { c = {}; }
  const g = c.gender === "male" || c.gender === "female" ? c.gender : null;
  const langs = Array.isArray(c.language_requirements) ? (c.language_requirements as Array<{ language?: string }>).map((l) => String(l.language ?? "").toLowerCase()).filter(Boolean) : [];
  const certs = Array.isArray(c.certifications) ? (c.certifications as unknown[]).map((x) => String(x).toUpperCase()).filter(Boolean) : [];
  const wpm = Number(c.min_typing_speed_wpm);
  const eng = c.written_english_level;
  return {
    gender: g as "male" | "female" | null, languages: langs.length ? langs : null, certifications: certs.length ? certs : null,
    minTypingWpm: Number.isFinite(wpm) && wpm > 0 ? wpm : null,
    englishLevel: eng === "basic" || eng === "intermediate" || eng === "advanced" ? eng : null,
  };
}

export function legacyMatchRequisition(r: MatchReqRow): MatchRequisition & { id: string } {
  const edu = r.education_requirement ? eduRank(r.education_requirement) : 0;
  return {
    id: r.id,
    ageMin: r.meta_target_age_min, ageMax: r.meta_target_age_max,
    minEducationRank: edu > 0 ? edu : null,
    minExperienceYears: r.experience_min_years,
    nightShift: Boolean(r.night_shift_required),
    branchLat: r.blat, branchLng: r.blng, maxDistanceKm: r.meta_target_radius_km,
    processName: r.process_name,
    salaryMax: r.salary_max != null && Number(r.salary_max) > 0 ? Number(r.salary_max) : null,
    branchCity: r.bcity ?? null, branchState: r.bstate ?? null, goodIndustries: industriesForProcess(r.process_name),
    ...withJdText(screeningOf(r.meta_screening_config), r),
  };
}

/** Configured screening wins; anything left empty is filled from the requisition's free-text skills/education. */
function withJdText(cfg: ReturnType<typeof screeningOf>, r: MatchReqRow): ReturnType<typeof screeningOf> & Pick<MatchRequisition, "nightShift" | "minExperienceYears" | "streams" | "minEducationRank"> {
  const jd = parseJdText(`${r.skills_required ?? ""}. ${r.education_requirement ?? ""}`);
  return {
    gender: cfg.gender ?? jd.gender,
    languages: cfg.languages ?? (jd.languages.length ? jd.languages : null),
    certifications: cfg.certifications ?? (jd.certifications.length ? jd.certifications : null),
    minTypingWpm: cfg.minTypingWpm ?? jd.minTypingWpm,
    englishLevel: cfg.englishLevel ?? jd.englishLevel,
    streams: jd.streams.length ? jd.streams : null,
    ...(r.night_shift_required ? {} : jd.nightShift ? { nightShift: true } : {}),
    ...(r.experience_min_years == null && jd.minExperienceYears != null ? { minExperienceYears: jd.minExperienceYears } : {}),
    ...(!r.education_requirement && jd.minEducationRank ? { minEducationRank: jd.minEducationRank } : {}),
  };
}

