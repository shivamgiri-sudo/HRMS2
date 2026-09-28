import { AlertTriangle, Info, ShieldCheck, BookOpen } from "lucide-react";
import { SectionCard } from "./DashboardKit";
import { fmtInt, type SatyaCheck } from "./satyaReportModel";

const DEFINITIONS: Array<{ term: string; meaning: string }> = [
  { term: "Total allocation", meaning: "Shops assigned to an agent on a date (one row per shop per day in the allocation upload)." },
  { term: "Pending", meaning: "Allocations not yet called. They belong to the queue placeholder agent 'VDCL', not a person." },
  { term: "Calls made", meaning: "Allocation − pending. Equals unique calls + repeat calls." },
  { term: "Unique / repeat calls", meaning: "First-time allocations (flag 1) versus repeat allocations of a shop (flag 2)." },
  { term: "Connected / not connected", meaning: "The disposition on the allocation row. Connect % = connected ÷ (connected + not connected). Call-dropped rows are counted separately." },
  { term: "Orders placed", meaning: "Allocation rows whose outcome is 'Order Placed'. 'From unique calls' is the subset on first-time calls." },
  { term: "Conversion %", meaning: "Orders ÷ calls made. 'At connect' = orders from unique calls ÷ connected." },
  { term: "Order revenue", meaning: "Sum of order_value on order rows (the sheet stores it as text with thousands separators; it is parsed here)." },
  { term: "Weeks", meaning: "Day of month: 1–7 = W-1, 8–14 = W-2, 15–21 = W-3, 22–28 = W-4, 29+ = W-5." },
  { term: "Dial attempts", meaning: "Every row of the call log (a shop can be dialled many times). Independent of the allocation counts above." },
];

/** Live data-quality findings plus the definitions every figure uses, so a
 * number that differs from a spreadsheet can be explained rather than argued. */
export function SatyaChecksTab({ checks }: { checks: SatyaCheck[] }) {
  const warnings = checks.filter((c) => c.level === "warn");
  const infos = checks.filter((c) => c.level === "info");

  return (
    <div className="space-y-5">
      <SectionCard
        icon={ShieldCheck} title="Data checks" tone="amber"
        footnote="Computed live from the uploaded tables on every load. Nothing is changed or deleted — these are read-time adjustments and observations."
      >
        {warnings.length === 0 && infos.length === 0 ? (
          <p className="py-6 text-center text-xs text-slate-400">No findings.</p>
        ) : (
          <ul className="space-y-2.5">
            {[...warnings, ...infos].map((c) => (
              <li key={c.id} className={`flex gap-3 rounded-xl border p-3 ${c.level === "warn" ? "border-amber-200 bg-amber-50/70" : "border-sky-100 bg-sky-50/60"}`}>
                <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${c.level === "warn" ? "bg-amber-100 text-amber-700" : "bg-sky-100 text-sky-700"}`}>
                  {c.level === "warn" ? <AlertTriangle className="h-4 w-4" /> : <Info className="h-4 w-4" />}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-800">
                    {c.title} <span className="ml-1 rounded-full bg-white/80 px-2 py-0.5 text-[11px] font-bold text-slate-600">{fmtInt(c.count)}</span>
                  </p>
                  <p className="mt-0.5 text-xs leading-relaxed text-slate-600">{c.detail}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard icon={BookOpen} title="How the numbers are defined" tone="indigo">
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          {DEFINITIONS.map((d) => (
            <div key={d.term}>
              <dt className="text-xs font-bold text-slate-700">{d.term}</dt>
              <dd className="text-xs leading-relaxed text-slate-500">{d.meaning}</dd>
            </div>
          ))}
        </dl>
      </SectionCard>
    </div>
  );
}
