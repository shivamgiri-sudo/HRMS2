import type { DrillData, DrillFilters, DrillSplit } from "@/hooks/useAtsDashboards";
import type { InsightTone } from "./cc-viz";

const DOW = ["", "Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export interface DrillFinding { tone: InsightTone; title: string; body?: string; drill?: { crumb: string; extra: DrillFilters } }
type SplitKey = "branch" | "process" | "source" | "recruiter" | "stage" | "status";

/** Smallest slice worth ranking: a 100% rate on 3 candidates is noise. */
const MIN_N = (total: number) => Math.max(10, Math.round(total * 0.04));
const signed = (n: number) => `${n > 0 ? "+" : ""}${n}`;

/**
 * Plain-language findings for one drill level. `parent` is the level above (its KPIs are the baseline), `activeSplit` is the
 * dimension currently being broken down. Pure so it can be unit tested without the UI.
 */
export function buildDrillFindings(d: DrillData, parent: DrillData | null | undefined, activeSplit: SplitKey | undefined): DrillFinding[] {
  const out: DrillFinding[] = [];
  const k = d.kpis;
  if (!k.total) return out;

  if (parent && parent.kpis.total > 0 && parent.kpis.total !== k.total) {
    const share = Math.round((k.total / parent.kpis.total) * 100);
    const dSel = Math.round((k.selRate - parent.kpis.selRate) * 10) / 10;
    const dNo = Math.round((k.noShowRate - parent.kpis.noShowRate) * 10) / 10;
    out.push({ tone: "info", title: `${share}% of the level above`, body: `${k.total.toLocaleString("en-IN")} of ${parent.kpis.total.toLocaleString("en-IN")} candidates.` });
    if (Math.abs(dSel) >= 3) out.push({ tone: dSel > 0 ? "good" : "bad", title: `Selection rate ${signed(dSel)} pts vs the level above`, body: `${k.selRate}% here against ${parent.kpis.selRate}% overall.` });
    if (Math.abs(dNo) >= 3) out.push({ tone: dNo < 0 ? "good" : "warn", title: `No-show rate ${signed(dNo)} pts vs the level above`, body: `${k.noShowRate}% here against ${parent.kpis.noShowRate}%.` });
  }

  if (k.total >= 20 && k.selected === 0) out.push({ tone: "bad", title: "Nobody has been selected in this slice", body: `${k.total.toLocaleString("en-IN")} candidates, none selected. Check the reasons in the rejection breakdown.` });

  if (activeSplit) {
    const rows = (d.splits[activeSplit] ?? []) as DrillSplit[];
    const min = MIN_N(k.total);
    const ranked = rows.filter((r) => r.total >= min).sort((a, b) => b.selRate - a.selRate);
    if (ranked.length >= 2) {
      const best = ranked[0], worst = ranked[ranked.length - 1];
      if (best.selRate - worst.selRate >= 8) {
        out.push({ tone: "good", title: `Best ${activeSplit}: ${best.name} at ${best.selRate}%`, body: `${(best.selRate - k.selRate).toFixed(1)} pts above this slice (${best.total.toLocaleString("en-IN")} candidates).`, drill: { crumb: best.name, extra: { [activeSplit]: best.name } as DrillFilters } });
        out.push({ tone: "warn", title: `Weakest ${activeSplit}: ${worst.name} at ${worst.selRate}%`, body: `${(k.selRate - worst.selRate).toFixed(1)} pts below this slice (${worst.total.toLocaleString("en-IN")} candidates).`, drill: { crumb: worst.name, extra: { [activeSplit]: worst.name } as DrillFilters } });
      }
    }
    const top = rows[0];
    if (top && rows.length > 1 && top.total / k.total >= 0.5) out.push({ tone: "info", title: `${top.name} is ${Math.round((top.total / k.total) * 100)}% of the volume`, body: `One ${activeSplit} dominates this slice.`, drill: { crumb: top.name, extra: { [activeSplit]: top.name } as DrillFilters } });
  }

  // Momentum: last 7 points against the 7 before (daily trend only; a weekly trend already smooths this).
  if (!d.weekly && d.trend.length >= 14) {
    const last = d.trend.slice(-7).reduce((s, x) => s + x.total, 0), prev = d.trend.slice(-14, -7).reduce((s, x) => s + x.total, 0);
    if (prev >= 10) {
      const ch = Math.round(((last - prev) / prev) * 100);
      if (Math.abs(ch) >= 20) out.push({ tone: ch > 0 ? "info" : "warn", title: `Volume ${signed(ch)}% over the last 7 days`, body: `${last.toLocaleString("en-IN")} candidates against ${prev.toLocaleString("en-IN")} the week before.` });
    }
  }

  const wk = d.weekday.filter((w) => w.total >= MIN_N(k.total) / 2);
  if (wk.length >= 3) {
    const best = [...wk].sort((a, b) => b.selRate - a.selRate)[0], worst = [...wk].sort((a, b) => a.selRate - b.selRate)[0];
    if (best.selRate - worst.selRate >= 12) out.push({ tone: "info", title: `${DOW[best.dow]} converts best (${best.selRate}%), ${DOW[worst.dow]} worst (${worst.selRate}%)`, drill: { crumb: DOW[worst.dow], extra: { dow: worst.dow } } });
  }
  return out;
}
