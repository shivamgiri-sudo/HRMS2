import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import { scoreBand } from "./format";

const ICONS = { check: CheckCircle2, alert: AlertTriangle, x: XCircle } as const;
const CLS = { Good: "text-emerald-900", Fair: "text-amber-900", Poor: "text-rose-900" } as const;

/** Good / Fair / Poor as text plus an icon, never colour alone. */
export function ScoreBand({ score }: { score: number }) {
  const { label, icon } = scoreBand(score);
  const Icon = ICONS[icon];
  return <div className={`mt-0.5 inline-flex items-center gap-1 text-[13px] font-bold ${CLS[label]}`}><Icon className="h-4 w-4" aria-hidden="true" />{label}</div>;
}
