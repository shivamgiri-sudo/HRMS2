/**
 * Pure logic behind OcDataTable (sort, search, CSV) -- kept free of React so it is unit
 * tested directly. Mirrors the behaviour of Process Performance V2's useSortableRows
 * (asc -> desc -> off, blanks always last) and adds search and a safe CSV export.
 */

export type OcSortDir = "asc" | "desc";
export type OcSortState = { key: string; dir: OcSortDir } | null;
export type OcCell = string | number | null | undefined;

const isBlank = (v: OcCell): boolean =>
  v === null || v === undefined || (typeof v === "string" && v.trim() === "");

const collator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

function compare(a: OcCell, b: OcCell): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return collator.compare(String(a), String(b));
}

/** Stable sort; blanks always sort last regardless of direction. Never mutates its input. */
export function sortRows<T>(
  rows: readonly T[],
  accessor: (row: T) => OcCell,
  dir: OcSortDir,
): T[] {
  const sign = dir === "asc" ? 1 : -1;
  return rows
    .map((row, index) => ({ row, index, value: accessor(row) }))
    .sort((x, y) => {
      const xb = isBlank(x.value);
      const yb = isBlank(y.value);
      if (xb || yb) return xb === yb ? x.index - y.index : xb ? 1 : -1;
      return sign * compare(x.value, y.value) || x.index - y.index;
    })
    .map((x) => x.row);
}

export function nextSort(current: OcSortState, key: string): OcSortState {
  if (!current || current.key !== key) return { key, dir: "asc" };
  return current.dir === "asc" ? { key, dir: "desc" } : null;
}

export function filterRows<T>(
  rows: readonly T[],
  accessors: readonly ((row: T) => OcCell)[],
  query: string,
): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...rows];
  return rows.filter((row) =>
    accessors.some((get) => {
      const v = get(row);
      return !isBlank(v) && String(v).toLowerCase().includes(q);
    }),
  );
}

function csvCell(value: OcCell): string {
  if (isBlank(value)) return "";
  let text = String(value);
  // A text cell starting with = + - @ would be run as a formula by Excel; genuine numbers are left alone.
  if (typeof value === "string" && /^[=+\-@]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv<T>(
  columns: readonly { header: string; accessor: (row: T) => OcCell }[],
  rows: readonly T[],
): string {
  const head = columns.map((c) => csvCell(c.header)).join(",");
  const body = rows.map((row) =>
    columns.map((c) => csvCell(c.accessor(row))).join(","),
  );
  return [head, ...body].join("\r\n");
}
