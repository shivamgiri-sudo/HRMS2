/** Compact criteria summary (S15): completeness badge, plain-language rules grouped Who / Where / ..., missing decisions, version. */
import { AlertTriangle, CheckCircle2, CircleDashed, Lock } from "lucide-react";
import { badgeOf, enrolmentNote, missingLinks, summaryGroups, versionLine } from "./completenessModel";
import type { Completeness, CriteriaSummaryData } from "./selectionTypes";

const TONE = {
  good: "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-100",
  warn: "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100",
  bad: "border-rose-300 bg-rose-50 text-rose-900 dark:border-rose-700 dark:bg-rose-950 dark:text-rose-100",
} as const;
export const LINK_BTN = "inline-flex min-h-11 cursor-pointer items-center rounded-md px-2 text-xs font-semibold text-blue-700 underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-blue-300 sm:min-h-8";

export function CompletenessBadge({ completeness }: { completeness: Completeness }) {
  const b = badgeOf(completeness);
  const Icon = b.icon === "check" ? CheckCircle2 : b.icon === "half" ? CircleDashed : AlertTriangle;
  return (
    <span role="img" aria-label={b.aria} className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-semibold ${TONE[b.tone]}`}>
      <Icon className="h-3.5 w-3.5" aria-hidden="true" /><span>{b.text}</span>
    </span>
  );
}

export default function CriteriaSummary({ data, now = new Date(), onEdit }: { data: CriteriaSummaryData; now?: Date; onEdit?: (key: string) => void }) {
  const groups = summaryGroups(data.rules);
  const blocked = enrolmentNote(data.completeness);
  const missing = missingLinks(data.completeness);
  return (
    <div className="min-w-0 space-y-2 text-sm text-slate-800 dark:text-slate-100">
      <div className="flex flex-wrap items-center gap-2">
        <CompletenessBadge completeness={data.completeness} />
        <span className="text-xs text-slate-600 dark:text-slate-300">{versionLine(data.version, now)}</span>
        {data.legacy && <span className="text-xs text-slate-600 dark:text-slate-300">Today's screening rules (nothing saved in the criteria editor yet)</span>}
      </div>
      {blocked && (
        <p className="flex items-center gap-1.5 text-xs font-semibold text-rose-800 dark:text-rose-200"><Lock className="h-3.5 w-3.5" aria-hidden="true" />{blocked}</p>
      )}
      {groups.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 px-3 py-2 text-xs text-slate-600 dark:border-slate-600 dark:text-slate-300">No selection rules apply yet: everyone in the source is a candidate until criteria are set.</p>
      ) : (
        <dl className="space-y-1.5">
          {groups.map((g) => (
            <div key={g.group} className="grid grid-cols-1 gap-1 sm:grid-cols-[8rem_1fr]">
              <dt className="text-xs font-bold uppercase tracking-wide text-slate-600 dark:text-slate-300">{g.title}</dt>
              <dd><ul className="space-y-0.5">
                {g.lines.map((l, i) => (
                  <li key={`${l.key}-${i}`} className="flex flex-wrap items-baseline gap-x-2 text-xs">
                    <span className="break-words">{l.text}</span>
                    <span className="rounded border border-slate-300 px-1 font-semibold dark:border-slate-600">{l.mode}</span>
                    {l.unknown && <span className="text-slate-600 dark:text-slate-300">{l.unknown}</span>}
                    {l.scope && <span className="text-slate-600 dark:text-slate-300">({l.scope})</span>}
                    {l.defaulted && <span className="font-semibold text-amber-800 dark:text-amber-200">not decided: acts as MUST</span>}
                  </li>
                ))}
              </ul></dd>
            </div>
          ))}
        </dl>
      )}
      {missing.length > 0 && (
        <div className="flex flex-wrap items-center gap-1 text-xs">
          <span className="text-slate-600 dark:text-slate-300">Still to decide:</span>
          {missing.map((m) => (onEdit
            ? <button key={m.key} type="button" aria-label={`Decide ${m.label}`} onClick={() => onEdit(m.key)} className={LINK_BTN}>{m.label}</button>
            : <span key={m.key} className="rounded border border-slate-300 px-1 dark:border-slate-600">{m.label}</span>))}
        </div>
      )}
    </div>
  );
}
