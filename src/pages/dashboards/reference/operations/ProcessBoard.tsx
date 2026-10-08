import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { ChartEmpty, Panel, TONE, type InsightTable } from "../../kit";
import { barWidth, processRag } from "./operationsModel";

const ragBorder = { green: "border-emerald-200", amber: "border-amber-300", red: "border-rose-300", slate: "border-slate-200" } as const;

function Meter({ label, value, tone, max = 100 }: { label: string; value: number | null | undefined; tone: keyof typeof TONE; max?: number }) {
  return (
    <div>
      <div className="flex items-baseline justify-between text-[10px] font-semibold uppercase tracking-wide text-slate-400"><span>{label}</span><span className="kit-num text-[12px] font-bold normal-case text-slate-800">{typeof value === "number" ? `${value.toLocaleString("en-IN", { maximumFractionDigits: 1 })}%` : "—"}</span></div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className={cn("h-full rounded-full transition-[width] duration-700", TONE[tone].solid)} style={{ width: `${barWidth(value, max)}%` }} /></div>
    </div>
  );
}

/** Control-tower cards: one per process with fill / attendance / shrinkage meters and a RAG edge; each card drills into that process. */
export function ProcessBoard({ table, loading }: { table?: InsightTable; loading?: boolean }) {
  const rows = table?.rows ?? [];
  return (
    <Panel title="Process control board" subtitle="30-day window to the latest complete processed day; click a card for its teams" href={table?.href ?? "/operations-dashboard?by=process"} hrefLabel="All processes">
      {loading && !table ? <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 6 }, (_, i) => <div key={i} className="kit-shimmer h-36 rounded-2xl" />)}</div>
        : table?.unavailable || !rows.length ? <ChartEmpty text={table?.unavailable ?? "No process in scope"} /> : (
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {rows.slice(0, 9).map((r, i) => {
              const fill = typeof r.fill === "number" ? r.fill : null;
              const att = typeof r.att === "number" ? r.att : null;
              const shr = typeof r.shr === "number" ? r.shr : null;
              const rag = processRag({ fill, att, shr });
              return (
                <li key={i}>
                  <Link to={r.href ?? "/operations-dashboard"} className={cn("kit-lift block rounded-2xl border-2 bg-white p-3.5", ragBorder[rag])}>
                    <div className="flex items-start justify-between gap-2">
                      <p className="truncate text-[13px] font-bold text-slate-900">{String(r.name)}</p>
                      <span className="kit-num shrink-0 rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-bold text-slate-600">{typeof r.hc === "number" ? `${r.hc} HC` : "—"}</span>
                    </div>
                    <div className="mt-3 space-y-2">
                      <Meter label="Mandate fill" value={fill} max={120} tone={fill === null ? "slate" : fill >= 95 ? "green" : fill >= 85 ? "amber" : "red"} />
                      <Meter label="Attendance" value={att} tone={att === null ? "slate" : att >= 90 ? "green" : att >= 80 ? "amber" : "red"} />
                      <Meter label="Shrinkage" value={shr} max={50} tone={shr === null ? "slate" : shr <= 15 ? "green" : shr <= 25 ? "amber" : "red"} />
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
