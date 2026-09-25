import type { EmployeeCandidate, MatchResult } from "./onfido-name-mapping.types.js";

/**
 * Pure matching function: no DB access, no side effects. Compares a raw name
 * string against a set of candidate employees and returns a single best match
 * (or a reason it could not produce one).
 */
export function matchNameToEmployees(rawName: string, candidates: EmployeeCandidate[]): MatchResult {
  const normalized = rawName.trim().toLowerCase();
  const exactMatches = candidates.filter((c) => c.fullName.trim().toLowerCase() === normalized);

  if (exactMatches.length === 1) {
    return { employeeId: exactMatches[0].id, confidence: 1.0, method: "exact_name" };
  }

  if (exactMatches.length > 1) {
    return { employeeId: null, confidence: 0, method: "ambiguous" };
  }

  return { employeeId: null, confidence: 0, method: "unmatched" };
}
