// Person names are stored uppercase — the same "normalize on every write path"
// convention already used for PAN/IFSC (see fieldOwnership.ts: "Format-validated
// and uppercased on every write path"). Applied here, not in a Zod .transform(),
// because that's the existing pattern for PAN/IFSC in this codebase: uppercased
// at each INSERT/UPDATE call site, not centrally in validation. Scope: person
// names only (employee/candidate first/last/full name, and person-shaped
// secondary fields like father_name, nominee_name, emergency_contact_name) —
// never branch/process/department/company names, which keep whatever case was
// entered.
//
// Collapses internal whitespace and trims before upper-casing, so "  Ramesh   Kumar "
// stores as "RAMESH KUMAR", not "  RAMESH   KUMAR ". Empty/whitespace-only input
// and null/undefined all normalize to null, so an optional name column (father_name,
// nominee_name, ...) gets NULL rather than an empty string when nothing was entered.

export function toStoredName(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const normalized = String(value).replace(/\s+/g, " ").trim();
  return normalized.length ? normalized.toUpperCase() : null;
}

/**
 * Same normalization, for a column that is NOT NULL / always expected to have
 * a value (e.g. an employee's own first_name) — returns "" instead of null so
 * callers writing into a NOT NULL column don't need an extra `?? ""`.
 */
export function toStoredNameRequired(value: unknown): string {
  return toStoredName(value) ?? "";
}
