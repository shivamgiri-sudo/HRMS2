// M7: the shape of a criteria patch (types, string lengths, array sizes, bounded JSON) is checked before anything else, so a bad
// value is a 400 with a message instead of a 500 inside validation or compilation. Content rules stay in validateCriteria / the schema.
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const numOk = (v: unknown, min: number, max: number) => v === null || v === undefined || v === "" || (Number.isFinite(Number(v)) && typeof v !== "boolean" && !Array.isArray(v) && Number(v) >= min && Number(v) <= max);
const strOk = (v: unknown, max: number) => v === null || v === undefined || (typeof v === "string" && v.length <= max);
const strList = (v: unknown, maxItems: number, maxLen: number) => v === null || v === undefined || (Array.isArray(v) && v.length <= maxItems && v.every((x) => typeof x === "string" && x.length <= maxLen));
const size = (v: unknown) => { try { return JSON.stringify(v)?.length ?? 0; } catch { return Infinity; } };

const NUMBERS: Record<string, [number, number]> = { ageMin: [0, 100], ageMax: [0, 100], experienceMinYears: [0, 60], experienceMaxYears: [0, 60], radiusKm: [0, 1000] };
const STRINGS: Record<string, number> = { educationRequirement: 200, skillsRequired: 1000, shiftRequirement: 200 };
const FLAGS = ["nightShiftRequired", "rotationalShift"];

/** null when the patch is well formed, else the message for a 400. */
export function patchShapeError(patch: Record<string, unknown>): string | null {
  if (!isObj(patch)) return "patch must be an object";
  for (const [k, [lo, hi]] of Object.entries(NUMBERS)) if (k in patch && !numOk(patch[k], lo, hi)) return `${k} must be a number from ${lo} to ${hi}`;
  for (const [k, max] of Object.entries(STRINGS)) if (k in patch && !strOk(patch[k], max)) return `${k} must be text of at most ${max} characters`;
  for (const k of FLAGS) if (k in patch && ![null, undefined, 0, 1, true, false, "0", "1"].includes(patch[k] as never)) return `${k} must be 0 or 1`;
  if ("targetLocations" in patch && !strList(patch.targetLocations, 50, 100)) return "targetLocations must be a list of at most 50 places (100 characters each)";
  if ("screeningConfig" in patch && patch.screeningConfig != null) {
    const c = patch.screeningConfig;
    if (!isObj(c)) return "screeningConfig must be an object";
    if (size(c) > 10_000) return "screeningConfig is too large (10 KB at most)";
    if (c.custom_field_rules != null && !(Array.isArray(c.custom_field_rules) && c.custom_field_rules.length <= 50 && c.custom_field_rules.every(isObj))) return "custom_field_rules must be a list of at most 50 rules";
    for (const k of ["certifications", "language_requirements"]) if (!strList(c[k], 20, 60)) return `${k} must be a list of at most 20 short codes`;
    for (const k of ["gender", "written_english_level"]) if (!strOk(c[k], 30)) return `${k} must be short text`;
    if (!numOk(c.min_typing_speed_wpm, 0, 300)) return "min_typing_speed_wpm must be a number from 0 to 300";
  }
  if ("selectionRules" in patch && patch.selectionRules != null) {
    if (!isObj(patch.selectionRules)) return "selectionRules must be an object";
    if (size(patch.selectionRules) > 20_000) return "selectionRules is too large (20 KB at most)";
  }
  return null;
}
