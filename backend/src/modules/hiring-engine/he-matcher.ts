/**
 * Rule-based lead -> requisition fit score (0-100) with human-readable reasons. Unknown lead values
 * never disqualify (same principle as lead-screener): they are listed in `unknown` and score neutral,
 * so a thin telecalling row can still be offered a role. Hard fails (age/education/night shift) zero
 * the score so a lead rejected for ABC is only re-offered where it actually fits.
 */
import { haversineKm } from "./he-eta.js";

export interface MatchLead {
  age?: number | null;
  educationRank?: number | null; // lead-screener ladder: 1=<10th 2=10th 3=12th 4=diploma 5=graduate 6=PG
  experienceYears?: number | null;
  nightShiftOk?: boolean | null;
  lat?: number | null;
  lng?: number | null;
  pastProcesses?: string[]; // processes the lead cleared a round for before
  gender?: "male" | "female" | "other" | null;
  languages?: string[] | null; // null = never asked; [] = asked, none confirmed
  certifications?: string[] | null;
  typingWpm?: number | null;
  englishLevel?: "basic" | "intermediate" | "advanced" | null;
  salaryExpectation?: number | null; // monthly INR
}

export interface MatchRequisition {
  ageMin?: number | null;
  ageMax?: number | null;
  minEducationRank?: number | null;
  minExperienceYears?: number | null;
  nightShift?: boolean | null;
  branchLat?: number | null;
  branchLng?: number | null;
  maxDistanceKm?: number | null;
  processName?: string | null;
  gender?: "male" | "female" | null; // null/any = no requirement
  languages?: string[] | null;
  certifications?: string[] | null;
  minTypingWpm?: number | null;
  englishLevel?: "basic" | "intermediate" | "advanced" | null;
  salaryMax?: number | null; // monthly INR
}

export interface MatchResult {
  score: number;
  eligible: boolean;
  reasons: string[];
  unknown: string[];
  distanceKm: number | null;
  /** Share of this JD's requirements we actually know about the lead (0..1). Thin records rank below proven fits. */
  confidence: number;
  /** Ordering key: fit score weighted by confidence. */
  rankScore: number;
}

const ENG = { basic: 1, intermediate: 2, advanced: 3 } as const;

export function scoreLead(lead: MatchLead, req: MatchRequisition): MatchResult {
  const reasons: string[] = [];
  const unknown: string[] = [];
  let score = 50;
  let eligible = true;

  if (req.ageMin != null || req.ageMax != null) {
    if (lead.age == null) unknown.push("age");
    else if ((req.ageMin != null && lead.age < req.ageMin) || (req.ageMax != null && lead.age > req.ageMax)) {
      eligible = false;
      reasons.push(`age ${lead.age} outside ${req.ageMin ?? "-"}-${req.ageMax ?? "-"}`);
    } else score += 10;
  }
  if (req.minEducationRank != null) {
    if (lead.educationRank == null) unknown.push("education");
    else if (lead.educationRank < req.minEducationRank) {
      eligible = false;
      reasons.push("education below requirement");
    } else score += 10;
  }
  if (req.minExperienceYears != null && req.minExperienceYears > 0) {
    if (lead.experienceYears == null) unknown.push("experience");
    else if (lead.experienceYears >= req.minExperienceYears) score += 10;
    else score -= 10; // soft: freshers are still trainable
  }
  if (req.nightShift === true) {
    if (lead.nightShiftOk == null) unknown.push("night_shift");
    else if (!lead.nightShiftOk) {
      eligible = false;
      reasons.push("night shift not acceptable");
    } else score += 5;
  }

  let distanceKm: number | null = null;
  if (lead.lat != null && lead.lng != null && req.branchLat != null && req.branchLng != null) {
    distanceKm = Math.round(haversineKm(lead.lat, lead.lng, req.branchLat, req.branchLng) * 10) / 10;
    const max = req.maxDistanceKm ?? 25;
    if (distanceKm > max) {
      score -= 25;
      reasons.push(`${distanceKm} km away`);
    } else score += distanceKm <= 8 ? 15 : 5;
  } else unknown.push("distance");

  if (req.processName && lead.pastProcesses?.some((p) => p.toLowerCase() === req.processName!.toLowerCase())) {
    score += 10;
    reasons.push("cleared a round for this process before");
  }

  if (req.gender) {
    if (!lead.gender) unknown.push("gender");
    else if (lead.gender !== req.gender) { eligible = false; reasons.push(`JD asks for ${req.gender} candidates`); }
  }
  if (req.languages?.length) {
    if (lead.languages == null) unknown.push("languages");
    else {
      const missing = req.languages.filter((l) => !lead.languages!.includes(l.toLowerCase()));
      if (missing.length) { eligible = false; reasons.push(`language not confirmed: ${missing.join(", ")}`); }
      else score += 10;
    }
  }
  if (req.certifications?.length) {
    if (lead.certifications == null) unknown.push("certifications");
    else {
      const missing = req.certifications.filter((c) => !lead.certifications!.includes(c.toUpperCase()));
      // Soft: certifications like DRA can be obtained during training, so it lowers the rank instead of excluding.
      if (missing.length) { score -= 15; reasons.push(`needs ${missing.join(", ")}`); } else { score += 10; reasons.push("has required certification"); }
    }
  }
  if (req.minTypingWpm) {
    if (lead.typingWpm == null) unknown.push("typing");
    else if (lead.typingWpm >= req.minTypingWpm) score += 5;
    else { score -= 10; reasons.push(`typing ${lead.typingWpm} wpm < ${req.minTypingWpm}`); }
  }
  if (req.englishLevel) {
    if (!lead.englishLevel) unknown.push("english");
    else if (ENG[lead.englishLevel] >= ENG[req.englishLevel]) score += 5;
    else { score -= 10; reasons.push(`english ${lead.englishLevel}, JD wants ${req.englishLevel}`); }
  }
  if (req.salaryMax && lead.salaryExpectation) {
    if (lead.salaryExpectation > req.salaryMax * 1.15) { score -= 15; reasons.push(`expects ${lead.salaryExpectation}, JD max ${req.salaryMax}`); }
    else score += 5;
  }

  const asked = [req.ageMin != null || req.ageMax != null, req.minEducationRank != null, (req.minExperienceYears ?? 0) > 0, req.nightShift === true,
    true /* distance */, !!req.gender, !!req.languages?.length, !!req.certifications?.length, !!req.minTypingWpm, !!req.englishLevel].filter(Boolean).length;
  const confidence = asked ? Math.max(0, Math.round(((asked - unknown.length) / asked) * 100) / 100) : 1;
  if (!eligible) score = 0;
  const finalScore = Math.max(0, Math.min(100, score));
  return { score: finalScore, eligible, reasons, unknown, distanceKm, confidence, rankScore: Math.round(finalScore * (0.6 + 0.4 * confidence) * 10) / 10 };
}

/** Best open requisitions for one lead, strongest first, ineligible dropped. */
export function rankRequisitions<R extends MatchRequisition & { id: string }>(
  lead: MatchLead,
  reqs: R[],
  limit = 3,
): Array<{ req: R; result: MatchResult }> {
  return reqs
    .map((req) => ({ req, result: scoreLead(lead, req) }))
    .filter((x) => x.result.eligible)
    .sort((a, b) => b.result.rankScore - a.result.rankScore)
    .slice(0, limit);
}
