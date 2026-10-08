// Pure model of the bulk criteria edit across a campaign's requisitions (S17): the patch from HR's choices, the server's dry-run
// diff grouped per requisition, and whether the change can be confirmed.
import type { BulkRow, CriteriaPatch } from "./selectionTypes";

export interface BulkChoice { educationRequirement: string; ageMin: string; ageMax: string; nightShift: "" | "yes" | "no"; cities: string; enrolment: "" | "off" | "hr_approves"; replaceFilled: boolean }
export const emptyChoice = (): BulkChoice => ({ educationRequirement: "", ageMin: "", ageMax: "", nightShift: "", cities: "", enrolment: "", replaceFilled: false });

const n = (s: string) => (s.trim() && Number.isFinite(Number(s)) ? Number(s) : null);
export function bulkPatch(c: BulkChoice): CriteriaPatch {
  const p: CriteriaPatch = {};
  if (c.educationRequirement) p.educationRequirement = c.educationRequirement;
  if (n(c.ageMin) !== null) p.ageMin = n(c.ageMin);
  if (n(c.ageMax) !== null) p.ageMax = n(c.ageMax);
  if (c.nightShift) p.nightShiftRequired = c.nightShift === "yes" ? 1 : 0;
  const cities = c.cities.split(",").map((x) => x.trim()).filter(Boolean);
  if (cities.length) p.targetLocations = cities;
  if (c.enrolment) p.selectionRules = { schema: 1, rules: {}, enrolment: { mode: c.enrolment, standingApprovalDays: 7 } };
  return p;
}

export const FIELD_LABEL: Record<string, string> = {
  education_requirement: "Minimum qualification", meta_target_age_min: "Age from", meta_target_age_max: "Age up to", experience_min_years: "Experience from",
  experience_max_years: "Experience up to", meta_target_locations: "Cities", meta_target_radius_km: "Radius km", shift_requirement: "Shift", night_shift_required: "Night shift",
  rotational_shift: "Rotational shifts", skills_required: "Skills", meta_screening_config: "Meta screening", selection_rules: "Rule settings",
};
export function valueText(v: unknown): string {
  if (v === null || v === undefined || v === "") return "not set";
  if (Array.isArray(v)) return v.join(", ");
  if (typeof v === "object") return "changed settings";
  return String(v);
}

export interface DiffItem { id: string; code: string; changes: Array<{ field: string; from: string; to: string }>; kept: Array<{ field: string; from: string; to: string }>; errors: string[]; warnings: string[]; nothing: boolean }
export function diffView(rows: BulkRow[], codes: Record<string, string>): { items: DiffItem[]; counts: { changing: number; kept: number; withErrors: number } } {
  const items = rows.map((r) => {
    const fmt = (d: BulkRow["diff"][number]) => ({ field: FIELD_LABEL[d.field] ?? d.field, from: valueText(d.from), to: valueText(d.to) });
    const changes = r.diff.filter((d) => !d.skipped).map(fmt);
    return { id: r.requisitionId, code: codes[r.requisitionId] ?? r.requisitionId, changes, kept: r.diff.filter((d) => d.skipped).map(fmt),
      errors: r.issues.filter((i) => i.level === "error").map((i) => i.text), warnings: r.issues.filter((i) => i.level === "warning").map((i) => i.text), nothing: changes.length === 0 };
  });
  return { items, counts: { changing: items.filter((i) => !i.nothing).length, kept: items.reduce((k, i) => k + i.kept.length, 0), withErrors: items.filter((i) => i.errors.length).length } };
}

export function canConfirm(rows: BulkRow[], excluded: ReadonlySet<string>, o: { reason: string; anyApproved: boolean; codes?: Record<string, string> }): { ok: boolean; why: string | null } {
  const inc = rows.filter((r) => !excluded.has(r.requisitionId));
  const bad = inc.filter((r) => r.issues.some((i) => i.level === "error"));
  if (bad.length) return { ok: false, why: `Fix or leave out ${bad.map((r) => o.codes?.[r.requisitionId] ?? r.requisitionId).join(", ")}` };
  if (!inc.some((r) => r.diff.some((d) => !d.skipped))) return { ok: false, why: "Nothing would change" };
  if (o.anyApproved && !o.reason.trim()) return { ok: false, why: "A reason is required: approved requisitions are included" };
  return { ok: true, why: null };
}
