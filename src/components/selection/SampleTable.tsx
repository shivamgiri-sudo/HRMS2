/** Up to 50 people of the preview (S18): masked mobile, first name, source, verdict and one cell per rule (icon + word; the reason is
 * the cell's accessible name and title). Scrolls inside its own box at 375 px. */
import { Check, HelpCircle, X } from "lucide-react";
import { labelOf } from "./ruleInfo";
import { cellView } from "./ruleFunnelModel";
import type { PreviewResult } from "./selectionTypes";

const VERDICT: Record<string, string> = { pass: "Shortlist", review: "Review", fail: "Rejected" };
const SUB: Record<string, string> = { meta_live: "Live Meta", meta_old: "Old Meta", candidate: "ATS", naukri_import: "Naukri", workindia_import: "WorkIndia", walk_in: "Walk-in", intake_upload: "Upload", pool_other: "Pool" };

export default function SampleTable({ preview }: { preview: PreviewResult }) {
  const keys = [...new Set(preview.sample.flatMap((s) => s.cells.map((c) => c.key)))];
  if (!preview.sample.length) return <p className="rounded-lg border border-dashed border-slate-300 px-3 py-4 text-center text-sm text-slate-600 dark:border-slate-600 dark:text-slate-300">No people to show for this source.</p>;
  return (
    <div className="relative max-w-full overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
      <table className="w-full min-w-max border-collapse text-left text-xs text-slate-800 dark:text-slate-100">
        <caption className="sr-only">Sample of up to 50 people: 20 shortlisted, 15 in review, 15 rejected. Mobiles are masked.</caption>
        <thead className="bg-slate-50 dark:bg-slate-800">
          <tr>
            <th scope="col" className="px-2 py-2">Mobile</th><th scope="col" className="px-2 py-2">Name</th><th scope="col" className="px-2 py-2">Source</th>
            <th scope="col" className="px-2 py-2">Verdict</th><th scope="col" className="px-2 py-2">Score</th>
            {keys.map((k) => <th key={k} scope="col" className="px-2 py-2">{labelOf(k)}</th>)}
          </tr>
        </thead>
        <tbody>
          {preview.sample.map((s, i) => (
            <tr key={i} className="border-t border-slate-100 dark:border-slate-800">
              <th scope="row" className="whitespace-nowrap px-2 py-1.5 font-mono font-medium">{s.maskedMobile}</th>
              <td className="px-2 py-1.5">{s.firstName || "–"}</td>
              <td className="px-2 py-1.5">{SUB[s.subSource] ?? s.subSource}</td>
              <td className="px-2 py-1.5 font-semibold">{VERDICT[s.verdict] ?? s.verdict}{s.override ? <span className="block font-normal">{s.override}</span> : null}</td>
              <td className="px-2 py-1.5 tabular-nums">{s.score}</td>
              {keys.map((k) => {
                const c = s.cells.find((x) => x.key === k);
                if (!c) return <td key={k} className="px-2 py-1.5 text-slate-500">–</td>;
                const v = cellView(c);
                const Icon = v.icon === "check" ? Check : v.icon === "x" ? X : HelpCircle;
                return (
                  <td key={k} className="px-2 py-1.5">
                    <span tabIndex={0} title={c.text} aria-label={v.aria} className="inline-flex min-h-8 items-center gap-1 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
                      <Icon className="h-3.5 w-3.5" aria-hidden="true" />{v.word}
                    </span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
