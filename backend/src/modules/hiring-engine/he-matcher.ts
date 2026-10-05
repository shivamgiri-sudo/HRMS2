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
}

export interface MatchResult {
  score: number;
  eligible: boolean;
  reasons: string[];
  unknown: string[];
  distanceKm: number | null;
}

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

  if (!eligible) score = 0;
  return { score: Math.max(0, Math.min(100, score)), eligible, reasons, unknown, distanceKm };
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
    .sort((a, b) => b.result.score - a.result.score)
    .slice(0, limit);
}
