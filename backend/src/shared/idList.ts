/**
 * Multi-select filter values for the Roster Command Center.
 *
 * The console sends several branches / processes as ONE query value: comma-separated ids
 * (`?branchId=a,b`). A single id is just a list of one, so every existing caller keeps working.
 */
const NOT_ASKED = new Set(["", "all", "__all__", "undefined", "null"]);

/** "a,b" | ["a,b"] | "a" -> ["a","b"]; blanks, "all" placeholders and duplicates dropped. */
export function parseIdList(raw: unknown): string[] {
  const parts = (Array.isArray(raw) ? raw : [raw])
    .flatMap((v) => (typeof v === "string" ? v.split(",") : []))
    .map((s) => s.trim())
    .filter((s) => !NOT_ASKED.has(s.toLowerCase()));
  return [...new Set(parts)];
}

/** `col = ?` for one id, `col IN (?,?)` for several. Caller guarantees ids is non-empty. */
export function idCondition(col: string, ids: readonly string[]): { sql: string; params: string[] } {
  return ids.length === 1
    ? { sql: `${col} = ?`, params: [ids[0]] }
    : { sql: `${col} IN (${ids.map(() => "?").join(",")})`, params: [...ids] };
}
