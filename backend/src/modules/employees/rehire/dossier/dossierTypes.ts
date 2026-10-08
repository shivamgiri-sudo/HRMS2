import type { SqlExecutor } from "../rehireFacts.js";

export type { SqlExecutor };

/** The span the dossier looks at. `months` are 'YYYY-MM', ascending; start/end are 'YYYY-MM-DD'. */
export interface DossierWindow {
  employeeId: string;
  start: string;
  end: string;
  months: string[];
}

/**
 * `monthsBack` calendar months ending in the month of `asOf`. Pure string/integer math — no Date —
 * so the day can never shift by a timezone (this codebase has a history of that bug).
 */
export function buildWindow(employeeId: string, asOf: string, monthsBack = 12): DossierWindow {
  const end = asOf.slice(0, 10);
  const [y, m] = end.slice(0, 7).split("-").map(Number) as [number, number];
  const months: string[] = [];
  for (let i = monthsBack - 1; i >= 0; i--) {
    const idx = y * 12 + (m - 1) - i;
    months.push(`${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`);
  }
  return { employeeId, start: `${months[0]}-01`, end, months };
}

/** A section either loaded or failed on its own; one bad query must not blank the whole page. */
export type SectionResult<T> = { status: "ok"; data: T } | { status: "error"; error: string };

export async function settle<T>(fn: () => Promise<T>): Promise<SectionResult<T>> {
  try {
    return { status: "ok", data: await fn() };
  } catch (e) {
    return { status: "error", error: e instanceof Error ? e.message : String(e) };
  }
}

/** mysql2 returns SUM()/DECIMAL as strings. */
export const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
export const numOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
export const round1 = (n: number): number => Math.round(n * 10 + Number.EPSILON * 10) / 10;
