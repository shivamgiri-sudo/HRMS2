import { formatValue } from "../format";
import type { ForecastKpi } from "./types";
import { statusOf } from "./status";

/** Geometry of the progress bar as fractions (0..1) of its scale; pure so it can be tested. */
export function barGeometry(k: Pick<ForecastKpi, "mtd" | "projected" | "band" | "target" | "unit">) {
  const vals = [k.mtd, k.projected, k.band?.high, k.target].filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  const top = Math.max(...vals, k.unit === "percent" ? 100 : 0, 1e-9) * 1.04;
  const f = (v: number | null | undefined) => (typeof v === "number" && Number.isFinite(v) ? Math.min(1, Math.max(0, v / top)) : null);
  return { mtd: f(k.mtd), projected: f(k.projected), low: f(k.band?.low), high: f(k.band?.high), target: f(k.target) };
}

/** Progress toward the target: solid = month-to-date, lighter span = 80% band, dark tick = projected month-end, dashed line = target. The text beside it says the same. */
export function PacingBar({ k }: { k: ForecastKpi }) {
  const g = barGeometry(k); const st = statusOf(k.status);
  const pct = (n: number | null) => `${((n ?? 0) * 100).toFixed(2)}%`;
  const label = `${k.label}: ${formatValue(k.mtd, k.unit)} so far${k.projected !== null ? `, projected ${formatValue(k.projected, k.unit)}${k.band ? ` (range ${formatValue(k.band.low, k.unit)} to ${formatValue(k.band.high, k.unit)})` : ""}` : ", no projection"}${k.target !== null ? `, target ${formatValue(k.target, k.unit)}` : ", no target"}.`;
  return (
    <div role="img" aria-label={label} className="relative h-3 w-full rounded-full bg-slate-100">
      {g.low !== null && g.high !== null && <span className="absolute inset-y-0 rounded-full bg-slate-300" style={{ left: pct(g.low), width: pct(Math.max(0, g.high - g.low)) }} />}
      {g.mtd !== null && <span className={`absolute inset-y-0 left-0 rounded-full ${st.bar}`} style={{ width: pct(g.mtd) }} />}
      {g.projected !== null && <span className="absolute -inset-y-1 w-1 rounded bg-slate-900" style={{ left: `calc(${pct(g.projected)} - 2px)` }} />}
      {g.target !== null && <span className="absolute -inset-y-1.5 border-l-2 border-dashed border-slate-900" style={{ left: pct(g.target) }} />}
    </div>
  );
}
