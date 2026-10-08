/**
 * Deciding what a shared PAN, Aadhaar or bank account actually means.
 *
 * The duplicate check matched a hash against every other candidate record and
 * raised a critical alert on any hit. It never asked whether the two records
 * describe the same person, so a rejoining employee — or anyone who applied
 * twice — looked identical to identity theft. That was harmless while alerts
 * only sat in a table, and stopped being harmless the moment an open critical
 * alert began refusing employee creation.
 *
 * The discriminator is identity, not employment status. Filtering out rejected
 * or ex-employee records would be the wrong fix: a departed employee's PAN
 * appearing on a *different* person is one of the more likely places to find
 * real fraud. The only question worth asking is whether the two records are the
 * same human being.
 *
 * Name comparison reuses the Indian-aware matcher written for the bank check,
 * so a rejoiner recorded once as "RAJESH KUMAR" and later as "RAJESH KUMAR
 * SINGH" is recognised as himself.
 */
import { classifyNameMatch } from "./indian-name-match.js";

export interface DuplicateParty {
  fullName?: string | null;
  dateOfBirth?: string | Date | null;
}

export interface DuplicateIdentityVerdict {
  samePerson: boolean;
  alertType: "REPEAT_APPLICANT" | "DUPLICATE_IDENTITY";
  severity: "low" | "critical";
  /** Whether this should stop the candidate becoming an employee. */
  blocking: boolean;
  reason: string;
}

/** YYYY-MM-DD, or null when there is nothing usable to compare. */
function birthDate(value: DuplicateParty["dateOfBirth"]): string | null {
  if (!value) return null;
  const text = value instanceof Date ? value.toISOString() : String(value);
  const match = text.match(/\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : null;
}

export function classifyDuplicateIdentity(
  candidate: DuplicateParty,
  existing: DuplicateParty,
): DuplicateIdentityVerdict {
  const fraud = (reason: string): DuplicateIdentityVerdict => ({
    samePerson: false, alertType: "DUPLICATE_IDENTITY", severity: "critical", blocking: true, reason,
  });

  const nameMatch = classifyNameMatch(candidate.fullName, existing.fullName);
  if (nameMatch.tier === "unknown") {
    return fraud("the other record has no name to compare, so the same person cannot be established");
  }
  if (nameMatch.suspicious) {
    return fraud(`the identifier is shared with a different person: ${nameMatch.reason}`);
  }

  // Names agree. A date of birth is the strongest available cross-check,
  // because relatives sharing a name is exactly how this looks when it is real
  // — but a government identifier belongs to one person, so a genuine
  // difference in birth date outweighs the matching name.
  const candidateDob = birthDate(candidate.dateOfBirth);
  const existingDob = birthDate(existing.dateOfBirth);
  if (candidateDob && existingDob && candidateDob !== existingDob) {
    return fraud(
      `the name matches but the dates of birth differ (${candidateDob} vs ${existingDob}), `
      + "which is what a relative using someone else's identifier looks like",
    );
  }

  return {
    samePerson: true,
    alertType: "REPEAT_APPLICANT",
    severity: "low",
    blocking: false,
    reason: candidateDob && existingDob
      ? "the same person has applied before or is rejoining — name and date of birth both match"
      : "the same person has applied before or is rejoining — the names match and no date of birth is recorded to check against",
  };
}
