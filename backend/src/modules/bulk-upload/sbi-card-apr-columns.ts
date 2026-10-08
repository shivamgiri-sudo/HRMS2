import type { ColumnSpec, Resolver } from "./report-column-plan.js";
import { parseDurationSeconds } from "./dalmia-import-helpers.js";

/**
 * Column plan of the dialer "Agent Time Detail" (APR) export. Canonical names are the ones the importer reads; aliases are other
 * spellings seen across dialers / report versions. The dialer's own % columns are derived and never read.
 */
export const SBI_APR_COLUMNS: ColumnSpec[] = [
  { canonical: "ID", aliases: ["Agent ID", "Employee ID", "Emp ID", "Employee Code", "Emp Code", "User ID", "Login ID", "Agent Code"], kind: "id", required: true },
  { canonical: "Report Date", aliases: ["Date", "Report Day", "Day"] },
  { canonical: "USER", aliases: ["Agent Name", "Agent", "Name", "Employee Name", "User Name"], kind: "name" },
  { canonical: "CALLS", aliases: ["Total Calls", "Calls Handled", "Call Count", "Calls Count"] },
  { canonical: "TIME CLOCK", aliases: ["Timeclock", "Time Clock Time"] },
  { canonical: "LOGIN TIME", aliases: ["Login Duration", "Total Login Time", "Logged In Time", "Staffed Time", "Login Hours"] },
  { canonical: "WAIT", aliases: ["Wait Time", "Idle", "Idle Time", "Ready Time", "Available"] },
  { canonical: "TALK", aliases: ["Talk Time", "Talking", "Talk Duration"] },
  { canonical: "DISPO", aliases: ["Dispo Time", "Wrap", "Wrap Time", "ACW", "After Call Work", "Disposition Time"] },
  { canonical: "PAUSE", aliases: ["Pause Time", "Break", "Break Time", "Not Ready"] },
  { canonical: "DEAD", aliases: ["Dead Time", "Dead Call Time"] },
  { canonical: "CUSTOMER", aliases: ["Customer Time", "Customer Talk", "Customer Talk Time"] },
  { canonical: "Login", aliases: ["First Login", "Login Clock", "First Login Time", "Login At"] },
  { canonical: "Logout", aliases: ["Last Logout", "Logout Clock", "Last Logout Time", "Logout At"] },
  { canonical: "ACHT", aliases: ["AHT", "Avg Handle Time", "Average Handle Time", "Avg Handling Time"] },
  { canonical: "DISMX", aliases: ["Dispo Max", "Max Dispo"] },
  { canonical: "LAGGED", aliases: ["Lag", "Lagged Time"] },
  { canonical: "LB", aliases: ["Lunch Break", "Lunch"] },
  { canonical: "LOGIN", aliases: ["Login Pause", "Login Code"] },
  { canonical: "MB", aliases: ["Meeting Break", "Meeting"] },
  { canonical: "QB", aliases: ["Quality Break", "Quality"] },
  { canonical: "TB", aliases: ["Tea Break", "Tea"] },
  { canonical: "WB", aliases: ["Wash Break", "Washroom", "Wellness Break"] },
];

const clockSecs = (v: unknown): number | null => {
  const s = String(v ?? "").trim();
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(s);
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3] ?? 0) : null;
};

/**
 * "Login" (first login CLOCK, e.g. 10:04:03) and "LOGIN" (login PAUSE-CODE time, e.g. 0:18:30) look the same by name and differ only by
 * case or a dedupe suffix, and a reordered file can swap them. Tell them apart by what they do to the row:
 *   clock:  logout - value ~= LOGIN TIME (the session length), and the value sits at a plausible hour of the day;
 *   code:   a short duration that does not reconcile that way.
 */
export const aprLoginResolver: Resolver = (keys, ctx) => {
  const logoutKey = ctx.sourceOf("Logout"); const sessionKey = ctx.sourceOf("LOGIN TIME");
  const score = (k: string): number => {
    let ok = 0; let n = 0;
    for (const r of ctx.sample) {
      const v = clockSecs(r[k]); if (v === null) continue;
      const out = logoutKey ? clockSecs(r[logoutKey]) : null;
      const sess = sessionKey ? parseDurationSeconds(r[sessionKey]) : null;
      n += 1;
      if (out !== null && sess !== null && sess > 0) ok += Math.abs(out - v - sess) <= 900 ? 1 : 0;
      else if (out !== null) ok += v >= 3 * 3600 && v < out ? 1 : 0;
      else ok += v >= 3 * 3600 ? 1 : 0;
    }
    return n ? ok / n : 0;
  };
  if (ctx.sourceOf("Login")) return { assign: Object.fromEntries(keys.map((k) => [k, "LOGIN"])), note: `"${keys.join('", "')}" read as the login pause-code time (the first-login clock was matched by its own header).` };
  const ranked = keys.map((k) => ({ k, s: score(k) })).sort((a, b) => b.s - a.s);
  const assign: Record<string, string> = {};
  if (ranked.length === 1) {
    const only = ranked[0]!;
    assign[only.k] = only.s >= 0.6 ? "Login" : "LOGIN";
    return { assign, note: `One "${only.k}" column found; read as the ${only.s >= 0.6 ? "first-login clock" : "login pause-code time"} from its values.` };
  }
  const [a, b] = ranked as [{ k: string; s: number }, { k: string; s: number }];
  if (a.s - b.s < 0.2 && a.s < 0.6) {
    // Cannot tell by values: fall back to case, then to the order they appear in.
    const exact = keys.find((k) => k === "Login"); const clock = exact ?? keys[0]!;
    assign[clock] = "Login"; for (const k of keys) if (k !== clock) assign[k] = "LOGIN";
    return { assign, note: `Two login columns could not be told apart by value; used header case / order ("${clock}" as first login).` };
  }
  assign[a.k] = "Login"; assign[b.k] = "LOGIN";
  return { assign, note: `Two login columns resolved by value: "${a.k}" is the first-login clock, "${b.k}" the login pause-code time.` };
};
