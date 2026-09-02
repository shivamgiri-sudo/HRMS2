import { useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, PlayCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useComputeKpis, useScopeOptions, type ComputeOutcome } from "@/hooks/useKpiStudio";

/**
 * Runs the calculations and shows what happened.
 *
 * Exists because a KPI that has been configured has not yet been calculated, and the gap between
 * those two states is invisible otherwise: the definition looks saved, the dashboard shows nothing,
 * and there is no way to tell whether the formula is wrong, the source is empty or the job simply
 * has not run.
 *
 * Two things it insists on:
 *
 *  - A dry run is offered first and visually dominant, because a real run writes to
 *    kpi_daily_actual, which every KPI page reads. Recalculating a month for the whole company is a
 *    change to everyone's scores, and that should take a deliberate second click.
 *  - "No data" is reported as its own number, separately from errors. Those are different problems —
 *    an empty source versus a broken formula — and collapsing them into one count is how the
 *    false-zero bugs in this codebase's history went unnoticed.
 */

export function KpiComputePanel() {
  const [date, setDate] = useState(() => new Date(Date.now() - 86_400_000).toISOString().slice(0, 10));
  const [processId, setProcessId] = useState("");
  const [outcome, setOutcome] = useState<{ dry: boolean; result: ComputeOutcome } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const scopeOptions = useScopeOptions();
  const compute = useComputeKpis();

  async function run(dryRun: boolean) {
    setError(null);
    try {
      const result = await compute.mutateAsync({
        date,
        process_id: processId || undefined,
        dry_run: dryRun,
      });
      setOutcome({ dry: dryRun, result });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not run the calculation");
    }
  }

  const result = outcome?.result;

  return (
    <div className="space-y-4">
      <header>
        <h3 className="text-base font-semibold text-slate-900">Run the calculations</h3>
        <p className="mt-1 text-sm text-slate-500">
          Works out the configured KPIs for a day and stores the results, so they appear on
          everyone's KPI dashboard. Only KPIs with a calculation are affected — those fed by an
          existing sync are untouched.
        </p>
      </header>

      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-700">Day</span>
          <Input
            type="date"
            value={date}
            max={new Date().toISOString().slice(0, 10)}
            onChange={(event) => setDate(event.target.value)}
            className="w-40"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-700">Limit to a process</span>
          <select
            value={processId}
            onChange={(event) => setProcessId(event.target.value)}
            className="h-10 w-56 cursor-pointer rounded-lg border border-slate-300 bg-white px-2 text-sm"
          >
            <option value="">Everyone in scope</option>
            {(scopeOptions.data?.processes ?? []).map((process) => (
              <option key={process.id} value={process.id}>
                {process.name}
              </option>
            ))}
          </select>
        </label>

        <Button variant="outline" onClick={() => void run(true)} disabled={compute.isPending}>
          {compute.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
          Try it without saving
        </Button>

        <Button onClick={() => void run(false)} disabled={compute.isPending}>
          <PlayCircle className="mr-1.5 h-4 w-4" />
          Run and save
        </Button>
      </div>

      {error && (
        <p className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</p>
      )}

      {result && (
        <div className="space-y-4">
          <div
            className={`flex items-start gap-2 rounded-lg border p-3 text-sm ${
              outcome!.dry
                ? "border-sky-200 bg-sky-50 text-sky-900"
                : "border-emerald-200 bg-emerald-50 text-emerald-900"
            }`}
          >
            {outcome!.dry ? (
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            ) : (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            )}
            <span>
              {outcome!.dry
                ? "Nothing was saved. This is what would happen."
                : `Saved. ${result.written} value${result.written === 1 ? "" : "s"} are now on the KPI dashboards.`}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Values calculated" value={result.written} tone="good" />
            {/* Given its own tile rather than folded into a failure count: an empty source is a fact
                about the data, not a fault, and the two need different responses. */}
            <Stat
              label="No data for the day"
              value={result.no_data}
              tone={result.no_data > 0 ? "warn" : "neutral"}
              hint="The calculation ran but an input had no value. Not counted as zero."
            />
            <Stat label="Calculation errors" value={result.errors} tone={result.errors > 0 ? "bad" : "neutral"} />
            <Stat label="Employees checked" value={result.employees_considered} tone="neutral" />
          </div>

          {result.source_failures.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
              <p className="text-sm font-medium text-amber-900">Some data sources could not be read</p>
              <ul className="mt-1.5 space-y-1">
                {result.source_failures.map((failure) => (
                  <li key={failure.source_code} className="text-xs text-amber-800">
                    <span className="font-mono">{failure.source_code}</span> — {failure.error}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-amber-700">
                Other KPIs still calculated. These will fill in once the source is reachable.
              </p>
            </div>
          )}

          {result.sample.length > 0 && (
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
              <p className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                A sample of what came out
              </p>
              <table className="min-w-full text-sm">
                <tbody className="divide-y divide-slate-100">
                  {result.sample.map((entry, index) => (
                    <tr key={`${entry.employee_code}-${entry.metric_code}-${index}`}>
                      <td className="px-3 py-2 font-mono text-xs text-slate-600">{entry.employee_code}</td>
                      <td className="px-3 py-2 text-xs text-slate-700">{entry.metric_code}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs">
                        {entry.value === null ? <span className="text-slate-400">—</span> : entry.value}
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-500">{entry.reason ?? entry.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {result.definitions_considered === 0 && (
            <p className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
              No KPI has a calculation configured for this date, so there was nothing to work out.
              Build one under Build a KPI, or check its start date.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: number;
  tone: "good" | "warn" | "bad" | "neutral";
  hint?: string;
}) {
  const toneClass =
    tone === "good"
      ? "text-emerald-700"
      : tone === "warn"
        ? "text-amber-700"
        : tone === "bad"
          ? "text-rose-700"
          : "text-slate-700";

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <span className={`block text-2xl font-bold ${toneClass}`}>{value.toLocaleString()}</span>
      <span className="mt-0.5 block text-xs font-medium text-slate-600">{label}</span>
      {hint && <span className="mt-1 block text-[11px] leading-snug text-slate-400">{hint}</span>}
    </div>
  );
}
