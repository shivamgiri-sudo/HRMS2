import { AlertTriangle, CheckCircle2 } from "lucide-react";
import type { FraudSignals } from "./types";
import { PanelShell, Spinner, ErrBanner } from "./shared";

interface Props {
  data: FraudSignals | undefined;
  loading: boolean;
  error: boolean;
}

const SIGNALS: [keyof FraudSignals, string][] = [
  ["data_theft",          "Data Theft"],
  ["financial_fraud",     "Financial Fraud"],
  ["collusion",           "Collusion"],
  ["escalation_failure",  "Escalation Failure"],
  ["unprofessional",      "Unprofessional"],
  ["system_manipulation", "System Manip."],
];

export function QualityFraudGrid({ data, loading, error }: Props) {
  return (
    <PanelShell title="Fraud Risk Signals" subtitle="Flagged behavioural patterns in audited calls">
      {loading ? (
        <Spinner size="sm" />
      ) : error ? (
        <ErrBanner msg="Failed to load fraud signals" />
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {SIGNALS.map(([key, label]) => {
            const count = data?.[key] ?? 0;
            return (
              <div
                key={key}
                className={`flex flex-col items-center gap-1 rounded-xl border p-2.5 text-center transition-all ${
                  count > 0
                    ? "border-red-200 bg-red-50"
                    : "border-emerald-100 bg-emerald-50"
                }`}
              >
                {count > 0 ? (
                  <AlertTriangle className="h-4 w-4 text-red-500" />
                ) : (
                  <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                )}
                <span className={`text-lg font-black tabular-nums leading-none ${count > 0 ? "text-red-700" : "text-emerald-700"}`}>
                  {count}
                </span>
                <span className="text-[10px] font-medium leading-tight text-slate-500">{label}</span>
              </div>
            );
          })}
        </div>
      )}
    </PanelShell>
  );
}
