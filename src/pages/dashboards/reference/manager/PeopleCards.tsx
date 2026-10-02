import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { ChartEmpty, Panel, TONE, type InsightTable } from "../../kit";
import { riskTone } from "./managerModel";

/** Retention-risk watchlist as cards - the person, a score badge and the reasons behind it. */
export function PeopleCards({ table, loading }: { table?: InsightTable; loading?: boolean }) {
  const rows = table?.rows ?? [];
  return (
    <Panel title="Attrition-risk watchlist" subtitle="Indicator from absence, lateness, notice, quality - not a prediction" href="/my-team" hrefLabel="My team">
      {loading && !table ? <div className="kit-shimmer h-40 rounded-xl" /> : table?.unavailable || !rows.length ? <ChartEmpty text={table?.unavailable ?? "Nobody in your team is flagged"} /> : (
        <ul className="grid gap-2.5 sm:grid-cols-2">
          {rows.slice(0, 6).map((r, i) => {
            const score = typeof r.score === "number" ? r.score : null;
            const t = TONE[riskTone(score)];
            return (
              <li key={i}>
                <Link to="/my-team" className="kit-lift flex items-start gap-3 rounded-xl border border-slate-200 p-3">
                  <span className={cn("kit-num flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-[16px] font-black", t.soft, t.text)}>{score ?? "-"}</span>
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-semibold text-slate-900">{String(r.name)}</p>
                    <p className="mt-0.5 line-clamp-2 text-[11px] leading-4 text-slate-500">{String(r.why || "Multiple weak signals")}</p>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
