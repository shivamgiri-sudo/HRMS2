/**
 * Client-side fuzzy header mapping for bulk calling data upload.
 * Mirrors backend logic in recruiter-hiring.service.ts (canonical + HEADER_ALIASES).
 */

export const CALLING_TARGET_FIELDS = [
  "candidate_name",
  "mobile",
  "gender",
  "candidate_email",
  "education_qualification",
  "experience_level",
  "candidate_location",
  "wp_group",
  "recruiter_remarks",
] as const;

export type CallingTargetField = (typeof CALLING_TARGET_FIELDS)[number];

export const CALLING_HEADER_ALIASES: Record<CallingTargetField, string[]> = {
  candidate_name: ["Candidate Name", "Name", "Full Name", "FullName", "Candidate", "Student Name", "Applicant Name"],
  mobile: ["Mobile No.", "Mobile", "Phone", "Contact", "Phone Number", "Mobile Number", "Contact No", "Contact Number", "Phone No"],
  gender: ["Gender", "Sex"],
  candidate_email: ["Email", "Candidate Email Address", "Email ID", "Email Address", "Mail"],
  education_qualification: ["Education", "Candidate Education Qualification", "Qualification", "Edu Qualification", "Degree"],
  experience_level: ["Experience Level", "Experience", "Exp", "Work Experience", "Yrs Experience"],
  candidate_location: ["Candidate Location", "Location", "City", "Area", "Address", "Place"],
  wp_group: ["WP Groups", "WP Group", "WhatsApp Group", "WP", "Group"],
  recruiter_remarks: ["HR Recruiter Remarks", "Remarks", "Outcome", "Calling Outcome", "Feedback", "Call Status", "Status", "Call Outcome", "Result"],
};

export const CALLING_FIELD_LABELS: Record<CallingTargetField, string> = {
  candidate_name: "Candidate Name",
  mobile: "Mobile No.",
  gender: "Gender",
  candidate_email: "Email",
  education_qualification: "Education",
  experience_level: "Experience",
  candidate_location: "Location",
  wp_group: "WP Group",
  recruiter_remarks: "Calling Feedback",
};

export const REQUIRED_CALLING_FIELDS: CallingTargetField[] = ["candidate_name", "mobile"];

function canonical(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function autoMapHeaders(fileHeaders: string[]): Record<CallingTargetField, string | null> {
  const result = {} as Record<CallingTargetField, string | null>;
  const usedHeaders = new Set<string>();

  for (const field of CALLING_TARGET_FIELDS) {
    const aliases = [field, ...CALLING_HEADER_ALIASES[field]];
    let matched: string | null = null;

    for (const alias of aliases) {
      const needle = canonical(alias);
      const found = fileHeaders.find(
        (h) => !usedHeaders.has(h) && canonical(h) === needle
      );
      if (found) {
        matched = found;
        break;
      }
    }

    if (matched) {
      usedHeaders.add(matched);
    }
    result[field] = matched;
  }

  return result;
}

export function normalizeMobile(value: unknown): string | null {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length === 12 && digits.startsWith("91")) return digits.slice(-10);
  if (digits.length > 10) return digits.slice(-10);
  return digits.length === 10 ? digits : null;
}
