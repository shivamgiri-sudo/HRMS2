/**
 * Header lookup for Onfido bulk-upload rows.
 *
 * The Hub trims every header it reads from the file before it becomes a key of
 * `normalized_data`, but the `header` strings in onfido-report-configs.ts are
 * copied from a particular release of the source file — including its stray
 * spaces (" Yes/NO", " Avail% ") and typos ("Occopancy%"). An exact `data[header]`
 * lookup therefore silently read `undefined` for any column whose header drifted
 * even by a space, and the value was stored as NULL with no error. This matches
 * on the exact key first (unchanged behaviour for every file that already works),
 * then on aliases, then on a whitespace- and case-insensitive form of both.
 */

export function normalizeHeaderKey(header: string): string {
  return header.replace(/\s+/g, " ").trim().toLowerCase();
}

export type RowReader = (header: string, aliases?: readonly string[]) => unknown;

export function makeRowReader(data: Record<string, unknown>): RowReader {
  let byNormalized: Map<string, unknown> | null = null;
  const has = (key: string) => Object.prototype.hasOwnProperty.call(data, key);

  return (header, aliases = []) => {
    if (has(header)) return data[header];
    for (const alias of aliases) if (has(alias)) return data[alias];

    if (!byNormalized) {
      byNormalized = new Map();
      for (const key of Object.keys(data)) {
        const norm = normalizeHeaderKey(key);
        if (!byNormalized.has(norm)) byNormalized.set(norm, data[key]);
      }
    }
    const direct = byNormalized.get(normalizeHeaderKey(header));
    if (direct !== undefined) return direct;
    for (const alias of aliases) {
      const viaAlias = byNormalized.get(normalizeHeaderKey(alias));
      if (viaAlias !== undefined) return viaAlias;
    }
    return undefined;
  };
}
