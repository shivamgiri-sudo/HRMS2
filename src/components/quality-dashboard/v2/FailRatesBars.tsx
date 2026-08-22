import type { QDSummary } from "./types";
import { PanelShell, Spinner } from "./shared";

interface Props {
  summary: QDSummary | undefined;
  loading: boolean;
}

/**
 * Only the numeric fail-rate fields of QDSummary, so the lookup below needs no cast.
 *
 * This was indexed via `(s as Record<string, unknown>)[key]`, which TypeScript rejects — QDSummary
 * has no index signature, so the two types do not overlap enough to convert. Widening it further
 * (`as unknown as Record<string, unknown>`, which the compiler suggests) would compile by
 * discarding the type instead of using it: a key renamed in QDSummary would then read undefined
 * and the bar would silently render 0%, which is indistinguishable from a genuine 0% fail rate.
 *
 * Deriving the key type instead makes a stale key a compile error.
 */
type FailRateKey = Extract<keyof QDSummary, `fail_rate_${string}`>;

const PARAMS: ReadonlyArray<{ key: FailRateKey; label: string }> = [
  { key: "fail_rate_call_open",        label: "Call Opening"    },
  { key: "fail_rate_professionalism",  label: "Professionalism" },
  { key: "fail_rate_active_listening", label: "Active Listening"},
  { key: "fail_rate_call_closure",     label: "Call Closure"    },
  { key: "fail_rate_accuracy",         label: "Accuracy"        },
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
            // `|| 0` still guards the runtime case the type cannot: the API may omit a rate.
            const val = s[key] || 0;
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
