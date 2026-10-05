/**
 * Candidate intake mapping (pure): any source file or feed (job website, portal export, vendor list, walk-in sheet)
 * -> one normalised row. Header aliases are the same idea as the Source-of-Truth sheet's Column_Mapping_Master.
 */
import { normalizeMobile10 } from "./he-phone.js";

export const INTAKE_SOURCES = ["walkin", "meta", "calling", "website", "portal", "referral", "vendor", "other"] as const;
export type IntakeSource = (typeof INTAKE_SOURCES)[number];
export const INTAKE_MAX_ROWS = 5000;

const ALIASES: Record<string, string[]> = {
  mobile: ["mobile", "mobile number", "mobile no", "phone", "phone number", "contact", "contact number", "candidate mobile", "whatsapp", "whatsapp number"],
  name: ["name", "candidate name", "full name", "fullname"],
  email: ["email", "email id", "e-mail", "mail", "email address"],
  age: ["age"],
  education: ["education", "qualification", "highest qualification", "education qualification"],
  experience: ["experience", "experience years", "total experience", "exp"],
  city: ["city", "location", "current location", "area", "locality"],
  pincode: ["pincode", "pin code", "pin", "zip"],
  gender: ["gender", "sex"],
  process: ["process", "process name", "applied for", "role applied", "position", "job title"],
  consent: ["consent", "whatsapp consent", "opt in", "optin", "agreed to contact"],
};
const norm = (h: string) => h.toLowerCase().replace(/[_\-.]+/g, " ").replace(/\s+/g, " ").trim();

export interface IntakeRow { rowNo: number; ok: boolean; reason?: string; mobile10?: string; name?: string | null; email?: string | null; age?: number | null; education?: string | null; experienceYears?: number | null; city?: string | null; pincode?: string | null; gender?: string | null; process?: string | null; consent?: boolean }

export function mapIntakeRows(rows: Array<Record<string, unknown>>): { rows: IntakeRow[]; missingColumns: string[]; tooMany: boolean } {
  if (rows.length > INTAKE_MAX_ROWS) return { rows: [], missingColumns: [], tooMany: true };
  const headers = rows.length ? Object.keys(rows[0]) : [];
  const col: Record<string, string | undefined> = {};
  for (const [field, names] of Object.entries(ALIASES)) col[field] = headers.find((h) => names.includes(norm(h)));
  if (!col.mobile) return { rows: [], missingColumns: ["mobile"], tooMany: false };
  const seen = new Set<string>();
  const out = rows.map((r, i): IntakeRow => {
    const get = (f: string) => { const c = col[f]; const v = c ? r[c] : undefined; const s = v == null ? "" : String(v).trim(); return s || null; };
    const m = normalizeMobile10(get("mobile") ?? "");
    if (!m) return { rowNo: i + 2, ok: false, reason: "invalid_mobile" };
    if (seen.has(m)) return { rowNo: i + 2, ok: false, reason: "duplicate_in_file", mobile10: m };
    seen.add(m);
    const age = Number(get("age")); const exp = Number(String(get("experience") ?? "").replace(/[^0-9.]/g, ""));
    const c = (get("consent") ?? "").toLowerCase();
    return {
      rowNo: i + 2, ok: true, mobile10: m, name: get("name"), email: get("email"), age: Number.isFinite(age) && age >= 15 && age <= 70 ? Math.round(age) : null,
      education: get("education"), experienceYears: get("experience") != null && Number.isFinite(exp) && exp <= 40 ? exp : null,
      city: get("city"), pincode: (get("pincode") ?? "").replace(/\D/g, "").slice(0, 6) || null, gender: get("gender"), process: get("process"),
      consent: /^(y|yes|true|1|agreed|haan)$/.test(c),
    };
  });
  return { rows: out, missingColumns: [], tooMany: false };
}
