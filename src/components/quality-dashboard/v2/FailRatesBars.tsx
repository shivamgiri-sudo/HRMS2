import type { QDSummary } from "./types";
import { PanelShell, Spinner } from "./shared";

interface Props {
  summary: QDSummary | undefined;
  loading: boolean;
}

const PARAMS = [
  { key: "fail_rate_call_open"       as const, label: "Call Opening"    },
  { key: "fail_rate_professionalism" as const, label: "Professionalism" },
  { key: "fail_rate_active_listening"as const, label: "Active Listening"},
  { key: "fail_rate_call_closure"    as const, label: "Call Closure"    },
  { key: "fail_rate_accuracy"        as const, label: "Accuracy"        },
];

function barColor(val: number) {
  if (val > 30) return "bg-red-400";
  if (val > 20) return "bg-orange-400";
  return "bg-yellow-400";
}

function textColor(val: number) {
  if (val > 30) return "text-red-600";
  if (val > 20) return "text-orange-500";
  return "text-yellow-600";
}

export function FailRatesBars({ summary: s, loading }: Props) {
  return (
    <PanelShell title="Parameter Fail Rates" subtitle="% of audited calls failing each quality parameter">
      {loading || !s ? (
        <Spinner size="sm" />
      ) : (
        <div className="space-y-3.5">
          {PARAMS.map(({ key, label }) => {
            const val = Number((s as Record<string, unknown>)[key]) || 0;
            return (
              <div key={key}>
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-600">{label}</span>
                  <span className={`text-xs font-bold tabular-nums ${textColor(val)}`}>{val.toFixed(1)}%</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                  <div
                    className={`h-2 rounded-full transition-all duration-700 ${barColor(val)}`}
                    style={{ width: `${Math.min(val, 100)}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </PanelShell>
  );
}
