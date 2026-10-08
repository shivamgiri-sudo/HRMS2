/** Timing heatmap (weekday x hour, IST) of replies or arrivals for one drive type; cells print their counts, the peak is called out in text. */
import { useState } from "react";
import type { DriveAnalytics, SourceType } from "../driveCommandTypes";
import { SOURCE_TYPES, TYPE_LABEL } from "../driveCommandModel";
import { SEQ_RAMP, sequentialStep } from "../chartTheme";
import ChartFrame, { Note, Segmented } from "./ChartFrame";
import { cellInk, defaultType, hourText, timingView } from "./summaryView";

type Kind = "replies" | "arrivals";
const KINDS: ReadonlyArray<{ id: Kind; label: string }> = [{ id: "replies", label: "Replies" }, { id: "arrivals", label: "Arrivals" }];
const TYPES = SOURCE_TYPES.map((t) => ({ id: t, label: TYPE_LABEL[t] }));

/** The first type (fixed order) with any activity of this kind, else the first type present. */
function busiestDefault(a: DriveAnalytics, kind: Kind): SourceType {
  return SOURCE_TYPES.find((t) => timingView(a, kind, t).total > 0) ?? defaultType(a);
}

export default function TimingHeatmap({ analytics, initialType, initialKind = "replies" }: { analytics: DriveAnalytics; initialType?: SourceType; initialKind?: Kind }) {
  const [kind, setKind] = useState<Kind>(initialKind);
  const [type, setType] = useState<SourceType>(() => initialType ?? busiestDefault(analytics, initialKind));
  const v = timingView(analytics, kind, type);
  const allEmpty = SOURCE_TYPES.every((t) => KINDS.every((k) => timingView(analytics, k.id, t).total === 0));
  return (
    <ChartFrame
      title="When people reply and arrive"
      subtitle="Counts by weekday and hour of the day (IST). Darker blue means more."
      table={v.table} empty={allEmpty} aria={v.aria} kind="grid"
      controls={!allEmpty && (
        <div className="flex flex-wrap gap-2">
          <Segmented<Kind> label="Show" options={KINDS} value={kind} onChange={setKind} />
          <Segmented<SourceType> label="Drive type" options={TYPES} value={type} onChange={setType} />
        </div>
      )}
      note={(
        <div className="space-y-1">
          <Note>{v.peakText}</Note>
          {v.without > 0 && <Note>{`${v.without} arrivals have no recorded time and are not in the grid`}</Note>}
        </div>
      )}
    >
      <div className="relative overflow-x-auto">
        <table aria-label={v.aria} className="min-w-max border-separate border-spacing-0.5 text-xs">
          <thead>
            <tr>
              <th scope="col" className="px-1 py-1 text-left font-semibold text-slate-700 dark:text-slate-200">Day</th>
              {Array.from({ length: 24 }, (_, h) => (
                <th key={h} scope="col" className="w-7 px-0.5 py-1 text-center font-medium text-slate-600 dark:text-slate-300">
                  <span aria-hidden="true">{String(h).padStart(2, "0")}</span><span className="sr-only">{hourText(h)}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {v.rows.map((r) => (
              <tr key={r.weekday}>
                <th scope="row" className="px-1 py-1 text-left font-semibold text-slate-800 dark:text-slate-100">{r.weekday}</th>
                {r.cells.map((n, h) => {
                  const step = sequentialStep(n, v.max);
                  const bg = step > 0 ? SEQ_RAMP[step] : null;
                  const peak = v.peak !== null && v.peak.weekday === r.weekday && v.peak.hour === h;
                  const ink = bg ? cellInk(bg) : null;
                  return (
                    <td key={h} className={`h-7 w-7 rounded text-center tabular-nums ${bg ? "font-semibold" : "text-slate-600 dark:text-slate-400"} ${peak ? "outline outline-2 outline-amber-500" : ""}`}
                      style={bg && ink ? { background: bg, color: ink.color } : undefined}>
                      {ink?.plate ? <span className="rounded bg-white px-0.5">{n}</span> : n}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ChartFrame>
  );
}
