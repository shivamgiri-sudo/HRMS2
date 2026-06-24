import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react";

export interface OnboardingBlocker {
  code: string;
  message: string;
  severity: "hard" | "soft";
}

interface OnboardingBlockerPanelProps {
  blockers: OnboardingBlocker[];
}

export default function OnboardingBlockerPanel({ blockers }: OnboardingBlockerPanelProps) {
  const hardBlockers = blockers.filter((b) => b.severity === "hard");
  const softBlockers = blockers.filter((b) => b.severity === "soft");

  if (blockers.length === 0) {
    return (
      <div className="flex items-center gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
        <CheckCircle2 className="h-5 w-5 flex-shrink-0 text-emerald-600" />
        <p className="text-sm font-bold text-emerald-700">Ready to submit</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b bg-slate-50">
        <p className="text-xs font-black uppercase tracking-widest text-slate-600">
          Submission blockers
        </p>
        {hardBlockers.length > 0 && (
          <span className="rounded-full bg-red-100 text-red-700 text-[11px] font-bold px-2.5 py-0.5">
            {hardBlockers.length} required
          </span>
        )}
      </div>

      {/* Hard blockers */}
      {hardBlockers.length > 0 && (
        <ul className="divide-y divide-red-50">
          {hardBlockers.map((b) => (
            <li key={b.code} className="flex items-start gap-3 px-4 py-3 bg-red-50/60">
              <XCircle className="h-4 w-4 flex-shrink-0 text-red-500 mt-0.5" />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-red-700 leading-snug">{b.message}</p>
                <p className="text-[11px] text-red-400 mt-0.5 font-mono">{b.code}</p>
              </div>
              <span className="ml-auto flex-shrink-0 rounded-full bg-red-100 text-red-700 text-[10px] font-black px-2 py-0.5 uppercase">
                required
              </span>
            </li>
          ))}
        </ul>
      )}

      {/* Soft blockers */}
      {softBlockers.length > 0 && (
        <ul className="divide-y divide-amber-50">
          {softBlockers.map((b) => (
            <li key={b.code} className="flex items-start gap-3 px-4 py-3 bg-amber-50/60">
              <AlertTriangle className="h-4 w-4 flex-shrink-0 text-amber-500 mt-0.5" />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-amber-700 leading-snug">{b.message}</p>
                <p className="text-[11px] text-amber-400 mt-0.5 font-mono">{b.code}</p>
              </div>
              <span className="ml-auto flex-shrink-0 rounded-full bg-amber-100 text-amber-700 text-[10px] font-black px-2 py-0.5 uppercase">
                recommended
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
