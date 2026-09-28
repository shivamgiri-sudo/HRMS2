import { CheckCircle2, HelpCircle, Info, XCircle } from "lucide-react";
import type { Verdict, VerdictReason } from "@/lib/fraudReview";

const CARD: Record<Verdict["level"], string> = {
  different: "border-red-200 bg-red-50",
  same: "border-emerald-200 bg-emerald-50",
  unsure: "border-amber-200 bg-amber-50",
};
const HEADLINE: Record<Verdict["level"], string> = {
  different: "text-red-700",
  same: "text-emerald-700",
  unsure: "text-amber-800",
};

function ReasonIcon({ tone }: { tone: VerdictReason["tone"] }) {
  const cls = "mt-0.5 h-4 w-4 shrink-0";
  if (tone === "bad") return <XCircle className={`${cls} text-red-600`} aria-hidden="true" />;
  if (tone === "ok") return <CheckCircle2 className={`${cls} text-emerald-600`} aria-hidden="true" />;
  if (tone === "warn") return <HelpCircle className={`${cls} text-amber-600`} aria-hidden="true" />;
  return <Info className={`${cls} text-slate-500`} aria-hidden="true" />;
}

/** The one-sentence answer, and the reasons behind it. */
export function VerdictCard({ verdict }: { verdict: Verdict }) {
  return (
    <section className={`rounded-xl border p-4 ${CARD[verdict.level]}`} aria-label="What the system found">
      <p className="text-[11px] font-bold uppercase tracking-widest text-slate-500">What the system found</p>
      <p className={`mt-0.5 text-lg font-bold ${HEADLINE[verdict.level]}`}>{verdict.headline}</p>
      <p className="text-xs text-slate-600">{verdict.strength}</p>
      <ul className="mt-3 space-y-1.5">
        {verdict.reasons.map((r, i) => (
          <li key={i} className="flex items-start gap-2 text-sm text-slate-800">
            <ReasonIcon tone={r.tone} />
            <span>{r.text}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
