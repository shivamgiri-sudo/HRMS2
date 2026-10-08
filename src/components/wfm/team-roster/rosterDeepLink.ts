import { addDaysYmd, weekdayNumber } from "./teamRosterFormat";

/**
 * `/wfm/team-roster?tab=roster&date=YYYY-MM-DD&employee=<employeeId>` — how the Roster Requests hub
 * ("Open in roster") points at one person on one day. Anything malformed is ignored, so a bad link
 * still opens the page on its defaults.
 */
export interface RosterDeepLink { date: string | null; employeeId: string | null }

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;
const EMPLOYEE_ID = /^[A-Za-z0-9_-]{1,64}$/;

function validYmd(v: string | null): string | null {
  const m = v ? YMD.exec(v) : null;
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d ? v : null;
}

export function parseRosterDeepLink(params: URLSearchParams): RosterDeepLink {
  const emp = params.get("employee")?.trim() ?? "";
  return { date: validYmd(params.get("date")), employeeId: EMPLOYEE_ID.test(emp) ? emp : null };
}

/** Monday-to-Sunday week that contains `date` (YYYY-MM-DD). */
export function weekContaining(date: string): { from: string; to: string } {
  const from = addDaysYmd(date, -((weekdayNumber(date) + 6) % 7));
  return { from, to: addDaysYmd(from, 6) };
}
