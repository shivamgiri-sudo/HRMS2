/**
 * Pure helpers for the Onfido Name Mapping HR review screen
 * (OnfidoNameMapping.tsx). Kept separate from the component so this logic can
 * be unit tested with the project's existing vitest setup — there is no
 * @testing-library/react dependency in this project yet, so component
 * rendering itself is verified by manual UAT, not an automated render test.
 */

export type RawNameRole = "tl" | "am";
export type MatchMethod = "exact_name" | "emp_code" | "unmatched" | "ambiguous";

export interface MappingListRow {
  id: string;
  rawName: string;
  rawRole: RawNameRole;
  employeeId: string | null;
  matchConfidence: number;
  matchMethod: MatchMethod;
  verifiedByHr: boolean;
  employeeName: string | null;
  employeeCode: string | null;
}

/**
 * Badge label + CSS class for a row's match method — drives the small pill shown per row.
 * className maps to this project's existing severity classes (oc-severity-high /
 * oc-severity-medium, defined in onfido-central-theme.css); there is no third
 * "good" severity tier defined there, so a clean match gets no className (renders
 * plain) rather than inventing a new CSS class this codebase doesn't have.
 */
export function matchMethodBadge(method: MatchMethod): { label: string; className: string | null } {
  switch (method) {
    case "exact_name":
      return { label: "Exact match", className: null };
    case "emp_code":
      return { label: "Code match", className: null };
    case "ambiguous":
      return { label: "Ambiguous", className: "oc-severity-medium" };
    case "unmatched":
    default:
      return { label: "Unmatched", className: "oc-severity-high" };
  }
}

/**
 * Client-side search filter for the review table: matches the raw Onfido name,
 * the matched employee's name, or their employee code, case-insensitively.
 * Kept as a pure function so the exact matching rule can be tested without
 * rendering the table.
 */
export function filterMappingRows(rows: MappingListRow[], search: string): MappingListRow[] {
  const needle = search.trim().toLowerCase();
  if (!needle) return rows;
  return rows.filter(
    (r) =>
      r.rawName.toLowerCase().includes(needle) ||
      (r.employeeName ?? "").toLowerCase().includes(needle) ||
      (r.employeeCode ?? "").toLowerCase().includes(needle),
  );
}

/** Sort order for the review table: unverified rows first (what HR needs to act on), then by role, then by name. */
export function sortMappingRows(rows: MappingListRow[]): MappingListRow[] {
  return [...rows].sort((a, b) => {
    if (a.verifiedByHr !== b.verifiedByHr) return a.verifiedByHr ? 1 : -1;
    if (a.rawRole !== b.rawRole) return a.rawRole.localeCompare(b.rawRole);
    return a.rawName.localeCompare(b.rawName);
  });
}
