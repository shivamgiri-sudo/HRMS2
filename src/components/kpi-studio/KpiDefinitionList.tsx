import { useMemo, useState } from "react";
import { Archive, ChevronDown, Loader2, Search, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  useDefinitionCoverage,
  useDefinitions,
  useRetireDefinition,
  useScopeOptions,
  type StudioDefinition,
} from "@/hooks/useKpiStudio";

/**
 * Every configured KPI, and — crucially — which scope each one wins at.
 *
 * The problem this solves is the one KpiTargetMatrix was built for at the target level and which
 * returns as soon as formulas exist: with rules at four levels of specificity, "what is this person
 * actually measured on" stops being answerable by reading a flat list. So the scope tier is shown
 * on every row, ordered most specific first, and a row can be expanded to see exactly how many
 * employees it currently drives.
 */

const SCOPE_STYLE: Record<string, string> = {
  employee: "bg-violet-100 text-violet-700 border-violet-200",
  "branch+process+designation": "bg-indigo-100 text-indigo-700 border-indigo-200",
  "process+designation": "bg-blue-100 text-blue-700 border-blue-200",
  "branch+process": "bg-sky-100 text-sky-700 border-sky-200",
  process: "bg-cyan-100 text-cyan-700 border-cyan-200",
  "branch+designation": "bg-teal-100 text-teal-700 border-teal-200",
  designation: "bg-emerald-100 text-emerald-700 border-emerald-200",
  branch: "bg-slate-100 text-slate-600 border-slate-200",
};

function scopeTargetLabel(definition: StudioDefinition): string {
  if (definition.employee_id) {
    return definition.employee_name ?? definition.employee_code ?? "one employee";
  }
  const parts = [definition.branch_name, definition.process_name, definition.designation_name].filter(Boolean);
  return parts.length ? parts.join(" · ") : "—";
}

function formatNumber(value: string | number | null): string {
  if (value === null || value === "") return "—";
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return String(value);
  // Trailing zeros from a DECIMAL(18,4) column are noise: 240.0000 reads as a precision claim
  // nobody made.
  return String(Math.round(parsed * 10_000) / 10_000);
}

export function KpiDefinitionList() {
  const [search, setSearch] = useState("");
  const [processFilter, setProcessFilter] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [currentOnly, setCurrentOnly] = useState(true);

  const today = new Date().toISOString().slice(0, 10);
  const scopeOptions = useScopeOptions();
  const definitions = useDefinitions({
    process_id: processFilter || undefined,
    as_of: currentOnly ? today : undefined,
  });
  const retire = useRetireDefinition();
  const coverage = useDefinitionCoverage(expanded);

  const visible = useMemo(() => {
    const rows = definitions.data ?? [];
    const term = search.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((definition) =>
      [
        definition.metric_name,
        definition.metric_code,
        definition.process_name,
        definition.designation_name,
        definition.branch_name,
        definition.employee_name,
        definition.employee_code,
      ]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(term)),
    );
  }, [definitions.data, search]);

  async function handleRetire(definition: StudioDefinition) {
    const target = scopeTargetLabel(definition);
    if (
      !window.confirm(
        `Stop measuring ${definition.metric_name} for ${target} from today?\n\n` +
          `Scores already calculated are kept — this only ends the rule going forward.`,
      )
    ) {
      return;
    }
    await retire.mutateAsync({ id: definition.id });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Filter by KPI, process or person"
            className="w-72 pl-8"
            aria-label="Filter configured KPIs"
          />
        </div>

        <select
          value={processFilter}
          onChange={(event) => setProcessFilter(event.target.value)}
          className="h-9 cursor-pointer rounded-lg border border-slate-300 bg-white px-2 text-sm"
          aria-label="Filter by process"
        >
          <option value="">All processes</option>
          {(scopeOptions.data?.processes ?? []).map((process) => (
            <option key={process.id} value={process.id}>
              {process.name}
            </option>
          ))}
        </select>

        <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={currentOnly}
            onChange={(event) => setCurrentOnly(event.target.checked)}
            className="cursor-pointer rounded border-slate-300"
          />
          In force today only
        </label>

        <span className="ml-auto text-sm text-slate-500">
          {visible.length} rule{visible.length === 1 ? "" : "s"}
        </span>
      </div>

      {definitions.isLoading ? (
        <div className="flex items-center gap-2 p-8 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 p-10 text-center">
          <p className="text-sm font-medium text-slate-600">
            {definitions.data?.length ? "Nothing matches that filter." : "No KPIs configured in the Studio yet."}
          </p>
          {!definitions.data?.length && (
            <p className="mt-1 text-sm text-slate-500">
              Use the Build a KPI tab to set one up. Existing targets set elsewhere keep working
              regardless.
            </p>
          )}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 font-semibold">KPI</th>
                <th className="px-4 py-3 font-semibold">Applies to</th>
                <th className="px-4 py-3 font-semibold">Calculation</th>
                <th className="px-4 py-3 text-right font-semibold">Target</th>
                <th className="px-4 py-3 text-right font-semibold">Weight</th>
                <th className="px-4 py-3 font-semibold">From</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visible.map((definition) => {
                const isExpanded = expanded === definition.id;
                return (
                  <>
                    <tr key={definition.id} className="align-top transition-colors hover:bg-slate-50/70">
                      <td className="px-4 py-3">
                        <span className="block font-medium text-slate-900">{definition.metric_name}</span>
                        <span className="block text-xs text-slate-400">
                          {definition.metric_code} · {definition.unit}
                        </span>
                      </td>

                      <td className="px-4 py-3">
                        {definition.scope_label && (
                          <span
                            className={`inline-block rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                              SCOPE_STYLE[definition.scope_label] ?? "bg-slate-100 text-slate-600 border-slate-200"
                            }`}
                          >
                            {definition.scope_label}
                          </span>
                        )}
                        <span className="mt-1 block text-xs text-slate-600">{scopeTargetLabel(definition)}</span>
                      </td>

                      <td className="max-w-[16rem] px-4 py-3">
                        {definition.formula_expression ? (
                          <>
                            <code className="block break-words font-mono text-[11px] leading-snug text-slate-700">
                              {definition.formula_expression}
                            </code>
                            {definition.source_name && (
                              <span className="mt-0.5 block text-[11px] text-slate-400">
                                from {definition.source_name}
                              </span>
                            )}
                          </>
                        ) : (
                          <span className="text-xs text-slate-500">Scores existing data</span>
                        )}
                      </td>

                      <td className="px-4 py-3 text-right font-mono text-slate-900">
                        {formatNumber(definition.target_value)}
                        {definition.min_threshold !== null && definition.min_threshold !== "" && (
                          <span className="mt-0.5 block text-[11px] font-normal text-slate-400">
                            limit {formatNumber(definition.min_threshold)}
                          </span>
                        )}
                      </td>

                      <td className="px-4 py-3 text-right font-mono text-slate-500">
                        {formatNumber(definition.weightage)}%
                      </td>

                      <td className="px-4 py-3 text-xs text-slate-600">
                        {String(definition.effective_from).slice(0, 10)}
                        {definition.effective_to && (
                          <span className="mt-0.5 block text-slate-400">
                            to {String(definition.effective_to).slice(0, 10)}
                          </span>
                        )}
                      </td>

                      <td className="whitespace-nowrap px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => setExpanded(isExpanded ? null : definition.id)}
                          className="mr-1 inline-flex cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-xs text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800"
                          aria-expanded={isExpanded}
                        >
                          <Users className="h-3.5 w-3.5" />
                          Who
                          <ChevronDown className={`h-3 w-3 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                        </button>
                        {!definition.effective_to && (
                          <button
                            type="button"
                            onClick={() => void handleRetire(definition)}
                            className="inline-flex cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-xs text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-600"
                            title="Stop applying this rule from today"
                          >
                            <Archive className="h-3.5 w-3.5" />
                            Retire
                          </button>
                        )}
                      </td>
                    </tr>

                    {isExpanded && (
                      <tr key={`${definition.id}-coverage`} className="bg-slate-50/80">
                        <td colSpan={7} className="px-4 py-3">
                          {coverage.isLoading ? (
                            <span className="flex items-center gap-2 text-xs text-slate-500">
                              <Loader2 className="h-3 w-3 animate-spin" /> Checking who this applies to…
                            </span>
                          ) : (
                            <div className="text-xs">
                              <p className="font-medium text-slate-700">
                                {coverage.data?.employee_count ?? 0} active employee
                                {coverage.data?.employee_count === 1 ? "" : "s"} currently measured by this rule
                              </p>
                              {(coverage.data?.sample ?? []).length > 0 && (
                                <div className="mt-1.5 flex flex-wrap gap-1.5">
                                  {coverage.data!.sample.map((employee) => (
                                    <span
                                      key={employee.id}
                                      className="rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[11px] text-slate-600"
                                    >
                                      {employee.employee_code}
                                      {employee.full_name ? ` · ${employee.full_name}` : ""}
                                    </span>
                                  ))}
                                  {(coverage.data?.employee_count ?? 0) > (coverage.data?.sample.length ?? 0) && (
                                    <span className="px-1 py-0.5 text-[11px] text-slate-400">
                                      and {(coverage.data!.employee_count - coverage.data!.sample.length).toLocaleString()} more
                                    </span>
                                  )}
                                </div>
                              )}
                              {coverage.data?.employee_count === 0 && (
                                <p className="mt-1 text-amber-700">
                                  This rule currently matches nobody. Check the branch and process
                                  actually go together.
                                </p>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-slate-500">
        Where two rules cover the same person, the more specific one wins — an employee rule beats a
        process rule, which beats a designation rule. Retiring a rule ends it going forward and never
        rewrites a score already calculated.
      </p>
    </div>
  );
}
