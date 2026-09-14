/**
 * ScoringPending Empty State
 * Shown when calls exist but quality scoring is pending
 */
import { Clock, CheckCircle2 } from "lucide-react";

export function ScoringPending() {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
      <div className="mb-4">
        <div className="mx-auto h-16 w-16 rounded-full bg-amber-100 flex items-center justify-center">
          <Clock className="h-8 w-8 text-amber-600 animate-spin" />
        </div>
      </div>
      <h3 className="text-lg font-semibold text-slate-900 mb-2">
        Quality review in progress
      </h3>
      <p className="text-sm text-slate-500 mb-6 max-w-sm">
        1 call pending quality review by your team lead
      </p>
      <div className="flex items-center gap-2 text-sm text-slate-600 bg-slate-50 rounded-lg px-4 py-2">
        <CheckCircle2 className="h-4 w-4 text-green-600" />
        <span>Estimated time: within 24 hours</span>
      </div>
    </div>
  );
}
