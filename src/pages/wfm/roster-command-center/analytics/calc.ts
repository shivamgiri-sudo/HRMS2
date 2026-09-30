/** Pure helpers for the Roster Analytics panel (formatting, periods, insight ordering). No React. */
import type { CostImpact, Forecast, QualityCorrelation, ShrinkageIntelligence } from "./types";

export const CORRELATION_MIN_SAMPLE = 5;

/** Indian-locale rupees, whole numbers: 1234567 -> ₹12,34,567. */
export function formatINR(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

/** Compact for tiles: ₹1.2L / ₹3.4Cr / ₹12.5K. Negative-safe. */
export function formatINRCompact(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  const a = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (a >= 1e7) return `${sign}₹${(a / 1e7).toFixed(2)}Cr`;
  if (a >= 1e5) return `${sign}₹${(a / 1e5).toFixed(2)}L`;
  if (a >= 1e3) return `${sign}₹${(a / 1e3).toFixed(1)}K`;
  return `${sign}₹${Math.round(a)}`;
}

/** YYYY-MM-DD[ HH:mm:ss] -> DD/MM/YYYY[ HH:mm]. Anything unparseable is returned as-is; null -> "—". */
export function fmtDate(s: string | null | undefined): string {
  if (!s) return "—";
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(s);
}
export function fmtDateTime(s: string | null | undefined): string {
  if (!s) return "—";
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}` : fmtDate(s);
}
/** YYYY-MM -> "Aug 2026". */
export function fmtPeriod(p: string): string {
  const m = p.match(/^(\d{4})-(\d{2})$/);
  if (!m) return p;
  return `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(m[2]) - 1]} ${m[1]}`;
}

export function localDate(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/** Monday of the current week in the LOCAL calendar (toISOString reads UTC and returns Sunday before 05:30 IST). */
export function currentWeekStart(now: Date = new Date()): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return localDate(d);
}

/** Previous calendar month YYYY-MM without setMonth(-1) overflow (31 Oct would land on 1 Oct). */
export function previousMonth(now: Date = new Date()): string {
  const y = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
  const m = now.getMonth() === 0 ? 12 : now.getMonth();
  return `${y}-${String(m).padStart(2, "0")}`;
}

/** Last N calendar months (newest first) as YYYY-MM, for the period dropdown. */
export function recentPeriods(n = 12, now: Date = new Date()): string[] {
  const out: string[] = [];
  let y = now.getFullYear();
  let m = now.getMonth() + 1;
  for (let i = 0; i < n; i++) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m -= 1;
    if (m === 0) { m = 12; y -= 1; }
  }
  return out;
}

export function shiftWeek(weekStart: string, deltaWeeks: number): string {
  const [y, m, d] = weekStart.split("-").map(Number);
  const t = new Date(y, m - 1, d + deltaWeeks * 7);
  return localDate(t);
}

// ── Correlation presentation ─────────────────────────────────────────────────

export type Tone = "green" | "amber" | "red" | "neutral";

/** Ring fill 0..100 = |r| * 100; colour by SIGNED r (positive correlation is the healthy direction). */
export function correlationView(r: number, insufficient: boolean): { ringPct: number; tone: Tone; label: string } {
  if (insufficient) return { ringPct: 0, tone: "neutral", label: "Insufficient data" };
  const tone: Tone = r >= 0.4 ? "green" : r > -0.4 ? "amber" : "red";
  const a = Math.abs(r);
  const strength = a >= 0.7 ? "Strong" : a >= 0.4 ? "Moderate" : "Weak";
  const dir = a < 0.4 ? "" : r > 0 ? " positive" : " negative";
  return { ringPct: Math.min(100, a * 100), tone, label: `${strength}${dir}` };
}

/** Shrinkage vs budget tone: over budget = red, within 20% of it = amber, else green. */
export function shrinkageTone(pct: number, budget: number): Tone {
  if (pct > budget) return "red";
  if (pct > budget * 0.8) return "amber";
  return "green";
}

/** Manager / process row badge, same cut-offs as the budget-agnostic legacy view (>15 red, >10 amber). */
export function rankTone(pct: number): Tone {
  return pct > 15 ? "red" : pct > 10 ? "amber" : "green";
}

// ── Insight strip ────────────────────────────────────────────────────────────

export type Severity = "critical" | "warning" | "info";
export const SEVERITY_ORDER: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };

export interface Insight {
  id: string;
  severity: Severity;
  text: string;
  tab: "shrinkage" | "quality" | "cost" | "forecast";
}

export function buildInsights(
  s: ShrinkageIntelligence | undefined,
  q: QualityCorrelation | undefined,
  c: CostImpact | undefined,
  f: Forecast | undefined,
): Insight[] {
  const out: Insight[] = [];
  if (s) {
    const tot = s.breakdown.total.pct;
    if (tot > s.budgetPct * 1.5) out.push({ id: "shr-crit", severity: "critical", tab: "shrinkage", text: `Shrinkage ${tot}% is ${s.varianceFromBudget}pp over the ${s.budgetPct}% budget` });
    else if (tot > s.budgetPct) out.push({ id: "shr-warn", severity: "warning", tab: "shrinkage", text: `Shrinkage ${tot}% is ${s.varianceFromBudget}pp over the ${s.budgetPct}% budget` });
    const hi = s.dayOfWeekPattern.filter((d) => d.isHighRisk);
    if (hi.length) out.push({ id: "shr-days", severity: "warning", tab: "shrinkage", text: `${hi.length} high-risk day${hi.length > 1 ? "s" : ""} this week: ${hi.map((d) => d.day.slice(0, 3)).join(", ")}` });
    if (s.trendVsPrevWeek >= 2) out.push({ id: "shr-trend", severity: "info", tab: "shrinkage", text: `Shrinkage up ${s.trendVsPrevWeek}pp vs previous week` });
  }
  if (c) {
    if (c.benchmarks.gapPct > 5) out.push({ id: "cost-gap", severity: "critical", tab: "cost", text: `Non-adherence loss ${c.benchmarks.currentShrinkage}% is ${c.benchmarks.gapPct}pp above the ${c.benchmarks.industryAvgShrinkage}% benchmark` });
    else if (c.benchmarks.gapPct > 0) out.push({ id: "cost-gap", severity: "warning", tab: "cost", text: `Non-adherence loss is ${c.benchmarks.gapPct}pp above the ${c.benchmarks.industryAvgShrinkage}% benchmark` });
  }
  if (q) {
    const bothLow = q.outliers.filter((o) => o.category === "BOTH_LOW").length;
    if (bothLow) out.push({ id: "q-both-low", severity: "warning", tab: "quality", text: `${bothLow} employee${bothLow > 1 ? "s" : ""} low on both attendance and quality` });
    if (q.insufficientData) out.push({ id: "q-data", severity: "info", tab: "quality", text: "Quality correlation needs at least 5 employees with both measures" });
  }
  if (f) {
    const n = f.nextWeek.riskDays.length;
    if (n >= 3) out.push({ id: "fc-risk", severity: "warning", tab: "forecast", text: `${n} high-risk days forecast for next week` });
    else if (n > 0) out.push({ id: "fc-risk", severity: "info", tab: "forecast", text: `${n} risk day${n > 1 ? "s" : ""} forecast for next week` });
  }
  return out.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

// ── Sorting ──────────────────────────────────────────────────────────────────

export type SortDir = "asc" | "desc";

export function sortRows<T>(rows: T[], get: (r: T) => string | number | null | undefined, dir: SortDir): T[] {
  const m = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = get(a), y = get(b);
    if (x === null || x === undefined) return y === null || y === undefined ? 0 : 1;
    if (y === null || y === undefined) return -1;
    if (typeof x === "number" && typeof y === "number") return (x - y) * m;
    return String(x).localeCompare(String(y)) * m;
  });
}

/** Percent share of `part` in `whole`, 0 when whole is 0 (no NaN). */
export function share(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0;
}
