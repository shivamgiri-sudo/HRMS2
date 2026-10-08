// The requisition criteria columns: load one row, map DB <-> RequisitionCriteriaRow, compare and snapshot. Reads only.
import type { RowDataPacket } from "mysql2";
import type { RequisitionCriteriaRow } from "./compile-criteria.js";
import { canonicalJson } from "./compile-criteria.js";
import type { CriteriaPatch } from "./templates.js";

type Exec = (sql: string, params?: unknown[]) => Promise<[unknown, unknown]>;

/** Criteria columns HR may change through the criteria API (S-O2). Order = audit/diff order. */
export const CRITERIA_COLUMNS = [
  "education_requirement", "skills_required", "experience_min_years", "experience_max_years", "meta_target_age_min", "meta_target_age_max",
  "meta_target_locations", "meta_target_radius_km", "shift_requirement", "night_shift_required", "rotational_shift", "meta_screening_config", "selection_rules",
] as const;
export type CriteriaColumn = (typeof CRITERIA_COLUMNS)[number];

export const PATCH_TO_COLUMN: Record<Exclude<keyof CriteriaPatch, never>, CriteriaColumn> = {
  educationRequirement: "education_requirement", skillsRequired: "skills_required", experienceMinYears: "experience_min_years", experienceMaxYears: "experience_max_years",
  ageMin: "meta_target_age_min", ageMax: "meta_target_age_max", targetLocations: "meta_target_locations", radiusKm: "meta_target_radius_km",
  shiftRequirement: "shift_requirement", nightShiftRequired: "night_shift_required", rotationalShift: "rotational_shift", screeningConfig: "meta_screening_config", selectionRules: "selection_rules",
};
export const COLUMN_TO_PATCH = Object.fromEntries(Object.entries(PATCH_TO_COLUMN).map(([k, v]) => [v, k])) as Record<CriteriaColumn, keyof CriteriaPatch>;
const JSON_COLUMNS = new Set<CriteriaColumn>(["meta_target_locations", "meta_screening_config", "selection_rules"]);
const NUMBER_COLUMNS = new Set<CriteriaColumn>(["experience_min_years", "experience_max_years", "meta_target_age_min", "meta_target_age_max", "meta_target_radius_km", "night_shift_required", "rotational_shift"]);

export const LOAD_ROW_SQL = `SELECT jr.id, jr.requisition_code, jr.branch_name, jr.process_name, jr.education_requirement, jr.skills_required,
       jr.experience_min_years, jr.experience_max_years, jr.meta_target_age_min, jr.meta_target_age_max, jr.meta_target_locations, jr.meta_target_radius_km,
       jr.shift_requirement, jr.night_shift_required, jr.rotational_shift, jr.salary_min, jr.salary_max, jr.preferred_sources,
       jr.meta_screening_config, jr.selection_rules, jr.approval_status,
       bm.city AS bcity, bm.state AS bstate, bm.latitude AS blat, bm.longitude AS blng
  FROM job_requisition jr LEFT JOIN branch_master bm ON bm.branch_name = jr.branch_name AND bm.active_status = 1
 WHERE jr.id = ? LIMIT 1`;

const parseJson = (v: unknown): unknown => {
  if (typeof v !== "string") return v ?? null;
  try { return JSON.parse(v); } catch { return null; }
};
const num = (v: unknown): number | null => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

/** A column value in comparable form: numbers as numbers, JSON parsed, blank text as null. */
export function normColumn(c: CriteriaColumn, v: unknown): unknown {
  if (JSON_COLUMNS.has(c)) {
    const j = parseJson(v);
    return j === null || (Array.isArray(j) && j.length === 0) ? null : j;
  }
  if (NUMBER_COLUMNS.has(c)) return num(v);
  if (v === null || v === undefined) return null;
  const s = String(v);
  return s.trim() ? s : null;
}

export type DbRow = Record<string, unknown>;

export async function loadDbRow(exec: Exec, id: string, forUpdate = false): Promise<DbRow | null> {
  const [rows] = await exec(forUpdate ? `${LOAD_ROW_SQL} FOR UPDATE` : LOAD_ROW_SQL, [id]);
  return ((rows as RowDataPacket[])[0] as DbRow | undefined) ?? null;
}

export function toCriteriaRow(d: DbRow): RequisitionCriteriaRow {
  return {
    id: String(d.id), code: String(d.requisition_code ?? ""), branchName: String(d.branch_name ?? ""), branchCity: (d.bcity as string) ?? null, branchState: (d.bstate as string) ?? null,
    branchLat: num(d.blat), branchLng: num(d.blng), processName: (d.process_name as string) ?? null,
    educationRequirement: normColumn("education_requirement", d.education_requirement) as string | null,
    skillsRequired: normColumn("skills_required", d.skills_required) as string | null,
    experienceMinYears: num(d.experience_min_years), experienceMaxYears: num(d.experience_max_years),
    ageMin: num(d.meta_target_age_min), ageMax: num(d.meta_target_age_max),
    targetLocations: normColumn("meta_target_locations", d.meta_target_locations) as string[] | null, radiusKm: num(d.meta_target_radius_km),
    shiftRequirement: normColumn("shift_requirement", d.shift_requirement) as string | null,
    nightShiftRequired: num(d.night_shift_required) ?? 0, rotationalShift: num(d.rotational_shift) ?? 0,
    salaryMin: num(d.salary_min), salaryMax: num(d.salary_max), preferredSources: parseJson(d.preferred_sources) as string[] | null,
    screeningConfig: parseJson(d.meta_screening_config) as RequisitionCriteriaRow["screeningConfig"],
    selectionRules: parseJson(d.selection_rules) as RequisitionCriteriaRow["selectionRules"],
    approvalStatus: (d.approval_status as string) ?? null,
  };
}

export function columnValue(r: RequisitionCriteriaRow, c: CriteriaColumn): unknown {
  return normColumn(c, (r as unknown as Record<string, unknown>)[COLUMN_TO_PATCH[c]]);
}

/** Every criteria column of a row, for version snapshots and diffs. */
export function snapshotColumns(r: RequisitionCriteriaRow): Record<CriteriaColumn, unknown> {
  return Object.fromEntries(CRITERIA_COLUMNS.map((c) => [c, columnValue(r, c)])) as Record<CriteriaColumn, unknown>;
}

export function diffColumns(before: Partial<Record<CriteriaColumn, unknown>>, after: Record<CriteriaColumn, unknown>): Array<{ field: CriteriaColumn; from: unknown; to: unknown }> {
  return CRITERIA_COLUMNS.filter((c) => canonicalJson(before[c] ?? null) !== canonicalJson(after[c] ?? null)).map((c) => ({ field: c, from: before[c] ?? null, to: after[c] ?? null }));
}

/** Bind value for an UPDATE: JSON columns stringified, booleans 1/0. */
export function bindColumn(c: CriteriaColumn, v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (JSON_COLUMNS.has(c)) return JSON.stringify(v);
  if (c === "night_shift_required" || c === "rotational_shift") return v ? 1 : 0;
  return v;
}
