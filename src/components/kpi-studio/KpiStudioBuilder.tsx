import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  Loader2,
  Plus,
  Save,
  Search,
  Target,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormulaBuilder } from "./FormulaBuilder";
import {
  useCreateMetric,
  useDataSources,
  useDataSources_ByIds,
  useEmployeeSearch,
  useKpiMetrics,
  useSaveDefinition,
  useScopeOptions,
  useValidateDefinition,
  type KpiMetricOption,
} from "@/hooks/useKpiStudio";

/**
 * The KPI builder.
 *
 * Four steps, in the order a person actually thinks about this: who is being measured, what is
 * being measured, how it is calculated, and what good looks like. The alternative — one long form
 * with every field visible — is what the existing /kpi-master modal does, and it works only because
 * that modal has five fields. This has closer to twenty, and a flat form of twenty fields where
 * half are conditional on the others is how people end up saving a formula with no data source.
 *
 * Every step can be revisited without losing the others, and the summary rail on the right shows
 * the whole decision at once so the wizard never hides what has already been chosen.
 */

type Step = 1 | 2 | 3 | 4;

const STEPS: ReadonlyArray<{ step: Step; label: string; hint: string }> = [
  { step: 1, label: "Who", hint: "Which employees this applies to" },
  { step: 2, label: "Which KPI", hint: "The thing being measured" },
  { step: 3, label: "How it's calculated", hint: "Where the number comes from" },
  { step: 4, label: "Target", hint: "What good looks like" },
];

interface BuilderState {
  branch_id: string;
  process_id: string;
  designation_id: string;
  employee_id: string;
  metric_id: string;
  data_source_id: string;
  /** Sources beyond the primary, for a KPI whose formula spans systems. */
  extra_source_ids: string[];
  formula_expression: string;
  aggregation_method: string;
  target_value: string;
  min_threshold: string;
  weightage: string;
  max_achievement: string;
  scoring_type: string;
  effective_from: string;
  notes: string;
}

const EMPTY: BuilderState = {
  branch_id: "",
  process_id: "",
  designation_id: "",
  employee_id: "",
  metric_id: "",
  data_source_id: "",
  extra_source_ids: [],
  formula_expression: "",
  aggregation_method: "average",
  target_value: "",
  min_threshold: "",
  weightage: "100",
  max_achievement: "120",
  scoring_type: "",
  effective_from: new Date().toISOString().slice(0, 10),
  notes: "",
};

/** Mirrors classifyScope on the backend so the UI can name the tier before saving. */
function describeScope(state: BuilderState): string | null {
  if (state.employee_id) return "this one employee";
  const parts: string[] = [];
  if (state.branch_id) parts.push("branch");
  if (state.process_id) parts.push("process");
  if (state.designation_id) parts.push("designation");
  if (!parts.length) return null;
  return parts.join(" + ");
}

export function KpiStudioBuilder({ onSaved }: { onSaved?: () => void }) {
  const [step, setStep] = useState<Step>(1);
  const [state, setState] = useState<BuilderState>(EMPTY);
  const [employeeSearch, setEmployeeSearch] = useState("");
  const [metricSearch, setMetricSearch] = useState("");
  const [creatingMetric, setCreatingMetric] = useState(false);
  const [newMetric, setNewMetric] = useState({ code: "", name: "", unit: "count", direction: "higher_is_better", category: "custom" });
  const [formulaValid, setFormulaValid] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const scopeOptions = useScopeOptions();
  const metrics = useKpiMetrics();
  const dataSources = useDataSources();
  const selectedSourceIds = useMemo(
    () => [state.data_source_id, ...state.extra_source_ids].filter(Boolean),
    [state.data_source_id, state.extra_source_ids],
  );
  const selectedSources = useDataSources_ByIds(selectedSourceIds);

  /**
   * Fields grouped by the source that supplies them, in the order the sources are read.
   *
   * Grouped so that when a KPI spans a QA sheet and the dialer database the author can see which
   * system each field comes from — without that, two sources both offering `total_calls` is
   * impossible to reason about.
   */
  const fieldGroups = useMemo(
    () =>
      selectedSourceIds
        .map((sourceId) => {
          const source = (selectedSources.data ?? []).find((candidate) => candidate?.id === sourceId);
          if (!source) return null;
          return {
            sourceId: source.id,
            sourceName: source.source_name,
            sourceType: source.source_type,
            fields: source.fields ?? [],
          };
        })
        .filter((group): group is NonNullable<typeof group> => group !== null),
    [selectedSourceIds, selectedSources.data],
  );
  const createMetric = useCreateMetric();
  const saveDefinition = useSaveDefinition();
  const validateDefinition = useValidateDefinition();

  const employees = useEmployeeSearch({
    search: employeeSearch,
    branch_id: state.branch_id || undefined,
    process_id: state.process_id || undefined,
    designation_id: state.designation_id || undefined,
  });

  const set = <K extends keyof BuilderState>(key: K, value: BuilderState[K]) =>
    setState((previous) => ({ ...previous, [key]: value }));

  const selectedMetric: KpiMetricOption | undefined = useMemo(
    () => metrics.data?.find((metric) => metric.id === state.metric_id),
    [metrics.data, state.metric_id],
  );

  /**
   * Processes narrow to the chosen branch. A process belongs to a branch, so offering all 132 after
   * a branch is picked invites a combination that matches no employee — the definition would save
   * and then apply to nobody, which is the worst kind of failure because it looks like success.
   */
  const visibleProcesses = useMemo(() => {
    const all = scopeOptions.data?.processes ?? [];
    if (!state.branch_id) return all;
    // Processes with no branch recorded are kept visible rather than hidden: excluding them would
    // silently make them unreachable in the builder.
    return all.filter((process) => !process.branch_id || process.branch_id === state.branch_id);
  }, [scopeOptions.data, state.branch_id]);

  const visibleMetrics = useMemo(() => {
    const all = metrics.data ?? [];
    const term = metricSearch.trim().toLowerCase();
    if (!term) return all;
    return all.filter(
      (metric) =>
        metric.metric_name.toLowerCase().includes(term) || metric.metric_code.toLowerCase().includes(term),
    );
  }, [metrics.data, metricSearch]);

  const scopeDescription = describeScope(state);

  // The employee chosen in step 1 doubles as the subject of the formula test in step 3, so a formula
  // is always tried against somebody real. Falling back to the first employee in scope means the
  // test button works even when no specific employee was named.
  const testEmployee = useMemo(() => {
    if (state.employee_id) return employees.data?.find((employee) => employee.id === state.employee_id) ?? null;
    return employees.data?.[0] ?? null;
  }, [employees.data, state.employee_id]);

  const payload = useMemo(
    () => ({
      metric_id: state.metric_id,
      branch_id: state.branch_id || null,
      process_id: state.process_id || null,
      designation_id: state.designation_id || null,
      employee_id: state.employee_id || null,
      data_source_id: state.formula_expression.trim() ? state.data_source_id || null : null,
      extra_source_ids: state.formula_expression.trim() ? state.extra_source_ids : [],
      formula_expression: state.formula_expression.trim() || null,
      aggregation_method: state.aggregation_method,
      scoring_type: state.scoring_type || null,
      target_value: state.target_value === "" ? null : Number(state.target_value),
      min_threshold: state.min_threshold === "" ? null : Number(state.min_threshold),
      max_achievement: Number(state.max_achievement || "120"),
      weightage: Number(state.weightage || "100"),
      effective_from: state.effective_from,
      notes: state.notes.trim() || null,
    }),
    [state],
  );

  /**
   * The final step asks the server whether this would save, using the identical validator the write
   * path uses. Re-implementing the rules here would produce a UI that permits what the API refuses,
   * which is a worse experience than no client validation at all.
   */
  useEffect(() => {
    if (step !== 4 || !state.metric_id) return;
    const timer = setTimeout(() => validateDefinition.mutate(payload), 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, payload]);

  const canLeaveStep1 = Boolean(state.branch_id || state.process_id || state.designation_id || state.employee_id);
  const canLeaveStep2 = Boolean(state.metric_id);
  const canLeaveStep3 = !state.formula_expression.trim() || (Boolean(state.data_source_id) && formulaValid);

  async function handleCreateMetric() {
    try {
      const created = await createMetric.mutateAsync({
        metric_code: newMetric.code,
        metric_name: newMetric.name,
        unit: newMetric.unit,
        direction: newMetric.direction,
        category: newMetric.category,
      });
      set("metric_id", created.id);
      setCreatingMetric(false);
      setNewMetric({ code: "", name: "", unit: "count", direction: "higher_is_better", category: "custom" });
      setSaveMessage({
        ok: true,
        text: created.reactivated
          ? `${created.metric_code} already existed and has been reactivated.`
          : `${created.metric_code} created.`,
      });
    } catch (error) {
      setSaveMessage({ ok: false, text: error instanceof Error ? error.message : "Could not create the KPI" });
    }
  }

  async function handleSave() {
    setSaveMessage(null);
    try {
      const result = await saveDefinition.mutateAsync(payload);
      setSaveMessage({
        ok: true,
        text: `Saved for ${result.scope_label ?? "the chosen scope"}, effective ${result.effective_from}.`,
      });
      // Scope and KPI are kept, calculation and target cleared: the overwhelmingly common next
      // action is adding another KPI to the same group of people, and making them re-pick the
      // branch and process every time is the friction that stops anyone configuring more than one.
      setState((previous) => ({
        ...previous,
        metric_id: "",
        formula_expression: "",
        extra_source_ids: [],
        target_value: "",
        min_threshold: "",
        notes: "",
      }));
      setStep(2);
      onSaved?.();
    } catch (error) {
      setSaveMessage({ ok: false, text: error instanceof Error ? error.message : "Could not save" });
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_18rem]">
      <div className="space-y-5">
        {/* ── Step rail ── */}
        <ol className="flex flex-wrap gap-1">
          {STEPS.map((entry) => {
            const active = entry.step === step;
            const done = entry.step < step;
            return (
              <li key={entry.step} className="flex-1 min-w-[8rem]">
                <button
                  type="button"
                  onClick={() => setStep(entry.step)}
                  className={`w-full cursor-pointer rounded-lg border px-3 py-2 text-left transition-colors ${
                    active
                      ? "border-indigo-500 bg-indigo-50"
                      : done
                        ? "border-emerald-200 bg-emerald-50/60 hover:border-emerald-400"
                        : "border-slate-200 bg-white hover:border-slate-300"
                  }`}
                >
                  <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-800">
                    {done ? (
                      <Check className="h-3.5 w-3.5 text-emerald-600" />
                    ) : (
                      <span
                        className={`flex h-4 w-4 items-center justify-center rounded-full text-[10px] ${
                          active ? "bg-indigo-600 text-white" : "bg-slate-200 text-slate-600"
                        }`}
                      >
                        {entry.step}
                      </span>
                    )}
                    {entry.label}
                  </span>
                  <span className="mt-0.5 block text-[11px] leading-tight text-slate-500">{entry.hint}</span>
                </button>
              </li>
            );
          })}
        </ol>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          {/* ── Step 1: who ── */}
          {step === 1 && (
            <div className="space-y-4">
              <header>
                <h3 className="flex items-center gap-2 text-base font-semibold text-slate-900">
                  <Users className="h-4 w-4 text-indigo-600" /> Who is this KPI for?
                </h3>
                <p className="mt-1 text-sm text-slate-500">
                  Pick as narrowly or as broadly as you like. Naming a single employee overrides
                  anything set for their process or branch.
                </p>
              </header>

              <div className="grid gap-4 sm:grid-cols-3">
                <label className="block">
                  <span className="mb-1 block text-sm font-medium text-slate-700">Branch</span>
                  <select
                    value={state.branch_id}
                    onChange={(event) => {
                      set("branch_id", event.target.value);
                      // A process belonging to the previous branch would silently no longer match.
                      set("process_id", "");
                    }}
                    className="w-full cursor-pointer rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="">Any branch</option>
                    {(scopeOptions.data?.branches ?? []).map((branch) => (
                      <option key={branch.id} value={branch.id}>
                        {branch.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block">
                  <span className="mb-1 block text-sm font-medium text-slate-700">Process</span>
                  <select
                    value={state.process_id}
                    onChange={(event) => set("process_id", event.target.value)}
                    className="w-full cursor-pointer rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="">Any process</option>
                    {visibleProcesses.map((process) => (
                      <option key={process.id} value={process.id}>
                        {process.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block">
                  <span className="mb-1 block text-sm font-medium text-slate-700">Designation</span>
                  <select
                    value={state.designation_id}
                    onChange={(event) => set("designation_id", event.target.value)}
                    className="w-full cursor-pointer rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="">Any designation</option>
                    {(scopeOptions.data?.designations ?? []).map((designation) => (
                      <option key={designation.id} value={designation.id}>
                        {designation.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
                <p className="mb-2 text-sm font-medium text-slate-700">
                  Just one person? <span className="font-normal text-slate-500">Optional</span>
                </p>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <Input
                    value={employeeSearch}
                    onChange={(event) => setEmployeeSearch(event.target.value)}
                    placeholder="Search by name or employee code"
                    className="pl-8"
                    aria-label="Search for an employee"
                  />
                </div>

                {employees.data && employees.data.length > 0 && (
                  <div className="mt-2 max-h-40 space-y-1 overflow-y-auto">
                    {employees.data.map((employee) => (
                      <button
                        key={employee.id}
                        type="button"
                        onClick={() => set("employee_id", state.employee_id === employee.id ? "" : employee.id)}
                        className={`flex w-full cursor-pointer items-center justify-between rounded-lg border px-2.5 py-1.5 text-left text-xs transition-colors ${
                          state.employee_id === employee.id
                            ? "border-indigo-500 bg-indigo-50"
                            : "border-transparent bg-white hover:border-slate-300"
                        }`}
                      >
                        <span>
                          <span className="font-medium text-slate-800">{employee.full_name ?? employee.employee_code}</span>
                          <span className="ml-1.5 text-slate-400">{employee.employee_code}</span>
                        </span>
                        <span className="text-slate-500">{employee.process_name ?? "—"}</span>
                      </button>
                    ))}
                  </div>
                )}

                {state.employee_id && (
                  <p className="mt-2 rounded-md bg-amber-50 px-2 py-1.5 text-xs text-amber-800">
                    Scoped to one person. Branch, process and designation are ignored, so this stays
                    theirs even if they transfer.
                  </p>
                )}
              </div>

              {!canLeaveStep1 && (
                <p className="flex items-start gap-1.5 text-xs text-slate-500">
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  Choose at least one of these. A KPI with no scope would apply to everyone in the
                  company.
                </p>
              )}
            </div>
          )}

          {/* ── Step 2: which KPI ── */}
          {step === 2 && (
            <div className="space-y-4">
              <header className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="flex items-center gap-2 text-base font-semibold text-slate-900">
                    <Target className="h-4 w-4 text-indigo-600" /> What is being measured?
                  </h3>
                  <p className="mt-1 text-sm text-slate-500">Pick an existing KPI, or build a new one.</p>
                </div>
                <Button size="sm" variant="outline" onClick={() => setCreatingMetric((open) => !open)}>
                  <Plus className="mr-1.5 h-3.5 w-3.5" />
                  New KPI
                </Button>
              </header>

              {creatingMetric && (
                <div className="space-y-3 rounded-xl border border-indigo-200 bg-indigo-50/50 p-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="block">
                      <span className="mb-1 block text-xs font-medium text-slate-700">Name</span>
                      <Input
                        value={newMetric.name}
                        onChange={(event) => {
                          const name = event.target.value;
                          setNewMetric((previous) => ({
                            ...previous,
                            name,
                            // Derived from the name so nobody has to invent a code, but still
                            // editable — an organisation with an existing naming convention needs
                            // to be able to follow it.
                            code: previous.code || name.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_").slice(0, 50),
                          }));
                        }}
                        placeholder="e.g. Net Login Hours"
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-xs font-medium text-slate-700">Code</span>
                      <Input
                        value={newMetric.code}
                        onChange={(event) => setNewMetric((previous) => ({ ...previous, code: event.target.value.toUpperCase() }))}
                        placeholder="NET_LOGIN_HOURS"
                        className="font-mono"
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-xs font-medium text-slate-700">Measured in</span>
                      <select
                        value={newMetric.unit}
                        onChange={(event) => setNewMetric((previous) => ({ ...previous, unit: event.target.value }))}
                        className="w-full cursor-pointer rounded-lg border border-slate-300 px-3 py-2 text-sm"
                      >
                        <option value="count">Count</option>
                        <option value="percent">Percent</option>
                        <option value="seconds">Seconds</option>
                        <option value="hours">Hours</option>
                        <option value="currency">Currency</option>
                      </select>
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-xs font-medium text-slate-700">Better when</span>
                      <select
                        value={newMetric.direction}
                        onChange={(event) => setNewMetric((previous) => ({ ...previous, direction: event.target.value }))}
                        className="w-full cursor-pointer rounded-lg border border-slate-300 px-3 py-2 text-sm"
                      >
                        <option value="higher_is_better">Higher (sales, quality, attendance)</option>
                        <option value="lower_is_better">Lower (handle time, error rate)</option>
                      </select>
                    </label>
                  </div>
                  <Button
                    size="sm"
                    onClick={handleCreateMetric}
                    disabled={!newMetric.name.trim() || !newMetric.code.trim() || createMetric.isPending}
                  >
                    {createMetric.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-1.5 h-3.5 w-3.5" />}
                    Create and use it
                  </Button>
                </div>
              )}

              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  value={metricSearch}
                  onChange={(event) => setMetricSearch(event.target.value)}
                  placeholder="Search KPIs"
                  className="pl-8"
                  aria-label="Search KPIs"
                />
              </div>

              <div className="max-h-72 space-y-1 overflow-y-auto">
                {visibleMetrics.map((metric) => (
                  <button
                    key={metric.id}
                    type="button"
                    onClick={() => set("metric_id", metric.id)}
                    className={`flex w-full cursor-pointer items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left transition-colors ${
                      state.metric_id === metric.id
                        ? "border-indigo-500 bg-indigo-50"
                        : "border-slate-200 bg-white hover:border-slate-300"
                    }`}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-slate-900">{metric.metric_name}</span>
                      <span className="block text-xs text-slate-400">
                        {metric.metric_code} · {metric.unit} ·{" "}
                        {metric.direction === "lower_is_better" ? "lower is better" : "higher is better"}
                      </span>
                    </span>
                    {/* Whether anything feeds this KPI today is the single most useful fact when
                        choosing one: a KPI with no data needs a calculation built in step 3, and one
                        with data can simply be given a target. */}
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                        metric.actual_rows > 0 ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"
                      }`}
                    >
                      {metric.actual_rows > 0 ? "has data" : "no data yet"}
                    </span>
                  </button>
                ))}
                {visibleMetrics.length === 0 && (
                  <p className="py-6 text-center text-sm text-slate-400">
                    No KPI matches that. Use “New KPI” to build one.
                  </p>
                )}
              </div>
            </div>
          )}

          {/* ── Step 3: calculation ── */}
          {step === 3 && (
            <div className="space-y-4">
              <header>
                <h3 className="text-base font-semibold text-slate-900">How is it calculated?</h3>
                <p className="mt-1 text-sm text-slate-500">
                  {selectedMetric && selectedMetric.actual_rows > 0
                    ? `${selectedMetric.metric_name} already receives data, so you can leave this empty and just set a target.`
                    : "Nothing feeds this KPI yet, so build the calculation here."}
                </p>
              </header>

              <label className="block">
                <span className="mb-1 block text-sm font-medium text-slate-700">Where the data comes from</span>
                <select
                  value={state.data_source_id}
                  onChange={(event) => {
                    set("data_source_id", event.target.value);
                    // Clearing the primary source clears the extras too: extras only mean anything
                    // alongside a primary, and leaving them set would silently keep reading systems
                    // the author thought they had detached.
                    if (!event.target.value) set("extra_source_ids", []);
                  }}
                  className="w-full cursor-pointer rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="">No calculation — score what already arrives</option>
                  {(dataSources.data ?? []).map((source) => (
                    <option key={source.id} value={source.id}>
                      {source.source_name} ({source.field_count} field{source.field_count === 1 ? "" : "s"})
                    </option>
                  ))}
                </select>
              </label>

              {/* Additional sources.
                  This is what makes a cross-system KPI possible: PCT(audited_passed, total_calls)
                  where the QA team keeps the numerator in a Google Sheet and the denominator lives in
                  the dialer database. Without it, one of the two has to be copied into the other's
                  system by hand every month. */}
              {state.data_source_id && (dataSources.data ?? []).length > 1 && (
                <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
                  <p className="text-sm font-medium text-slate-700">
                    Does this calculation also need another system?{" "}
                    <span className="font-normal text-slate-500">Optional</span>
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    Tick any other source whose figures this formula reads. Their fields become
                    available alongside the first source's.
                  </p>
                  <div className="mt-2 space-y-1">
                    {(dataSources.data ?? [])
                      .filter((source) => source.id !== state.data_source_id)
                      .map((source) => {
                        const checked = state.extra_source_ids.includes(source.id);
                        return (
                          <label
                            key={source.id}
                            className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1 text-xs transition-colors hover:bg-white"
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(event) =>
                                set(
                                  "extra_source_ids",
                                  event.target.checked
                                    ? [...state.extra_source_ids, source.id]
                                    : state.extra_source_ids.filter((id) => id !== source.id),
                                )
                              }
                              className="cursor-pointer rounded border-slate-300"
                            />
                            <span className="font-medium text-slate-800">{source.source_name}</span>
                            <span className="text-slate-400">
                              {source.field_count} field{source.field_count === 1 ? "" : "s"}
                            </span>
                          </label>
                        );
                      })}
                  </div>
                </div>
              )}

              {state.data_source_id && (
                <FormulaBuilder
                  value={state.formula_expression}
                  onChange={(formula) => set("formula_expression", formula)}
                  fieldGroups={fieldGroups}
                  dataSourceId={state.data_source_id}
                  extraSourceIds={state.extra_source_ids}
                  testEmployeeId={testEmployee?.id ?? null}
                  testEmployeeLabel={testEmployee ? `${testEmployee.full_name ?? testEmployee.employee_code}` : null}
                  onValidityChange={setFormulaValid}
                />
              )}

              <label className="block max-w-xs">
                <span className="mb-1 block text-sm font-medium text-slate-700">Roll up a period by</span>
                <select
                  value={state.aggregation_method}
                  onChange={(event) => set("aggregation_method", event.target.value)}
                  className="w-full cursor-pointer rounded-lg border border-slate-300 px-3 py-2 text-sm"
                >
                  <option value="average">Average of the days (handle time, quality)</option>
                  <option value="sum">Total across the days (sales, calls)</option>
                  <option value="last">The most recent day</option>
                  <option value="min">The worst day</option>
                  <option value="max">The best day</option>
                </select>
              </label>
            </div>
          )}

          {/* ── Step 4: target ── */}
          {step === 4 && (
            <div className="space-y-4">
              <header>
                <h3 className="text-base font-semibold text-slate-900">What does good look like?</h3>
                <p className="mt-1 text-sm text-slate-500">
                  A target is optional. Without one the KPI is tracked but not scored, which is a
                  reasonable place to start.
                </p>
              </header>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-sm font-medium text-slate-700">
                    Target {selectedMetric?.unit ? <span className="text-slate-400">({selectedMetric.unit})</span> : null}
                  </span>
                  <Input
                    value={state.target_value}
                    onChange={(event) => set("target_value", event.target.value)}
                    inputMode="decimal"
                    placeholder="e.g. 240"
                  />
                </label>

                <label className="block">
                  <span className="mb-1 block text-sm font-medium text-slate-700">
                    Unacceptable past{" "}
                    <span className="text-slate-400">
                      {selectedMetric?.direction === "lower_is_better" ? "(a ceiling)" : "(a floor)"}
                    </span>
                  </span>
                  <Input
                    value={state.min_threshold}
                    onChange={(event) => set("min_threshold", event.target.value)}
                    inputMode="decimal"
                    placeholder="optional"
                  />
                  {/* Which side the threshold sits on is the single most confusing part of KPI
                      configuration and the backend rejects it the wrong way round, so the rule is
                      stated inline rather than left to be discovered by a validation error. */}
                  <span className="mt-1 block text-[11px] leading-snug text-slate-500">
                    {selectedMetric?.direction === "lower_is_better"
                      ? "Lower is better here, so this must be ABOVE the target — e.g. target 240s, unacceptable past 360s."
                      : "Higher is better here, so this must be BELOW the target — e.g. target 95%, unacceptable below 85%."}
                  </span>
                </label>

                <label className="block">
                  <span className="mb-1 block text-sm font-medium text-slate-700">Weight in the overall score</span>
                  <Input
                    value={state.weightage}
                    onChange={(event) => set("weightage", event.target.value)}
                    inputMode="decimal"
                  />
                </label>

                <label className="block">
                  <span className="mb-1 block text-sm font-medium text-slate-700">Applies from</span>
                  <Input
                    type="date"
                    value={state.effective_from}
                    onChange={(event) => set("effective_from", event.target.value)}
                  />
                  <span className="mt-1 block text-[11px] leading-snug text-slate-500">
                    Earlier scores keep the target they were measured against. Nothing already
                    calculated is rewritten.
                  </span>
                </label>
              </div>

              <label className="block">
                <span className="mb-1 block text-sm font-medium text-slate-700">Note (optional)</span>
                <Input
                  value={state.notes}
                  onChange={(event) => set("notes", event.target.value)}
                  placeholder="Why this target — e.g. client SLA, agreed in Q3 review"
                />
              </label>

              {validateDefinition.data && !validateDefinition.data.ok && (
                <p className="flex items-start gap-1.5 rounded-lg border border-rose-200 bg-rose-50 p-2.5 text-xs text-rose-800">
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {validateDefinition.data.message}
                </p>
              )}
            </div>
          )}

          {/* ── Navigation ── */}
          <div className="mt-5 flex items-center justify-between border-t border-slate-200 pt-4">
            <Button variant="ghost" size="sm" onClick={() => setStep((current) => (current > 1 ? ((current - 1) as Step) : current))} disabled={step === 1}>
              <ArrowLeft className="mr-1.5 h-3.5 w-3.5" /> Back
            </Button>

            {step < 4 ? (
              <Button
                size="sm"
                onClick={() => setStep((current) => (current + 1) as Step)}
                disabled={(step === 1 && !canLeaveStep1) || (step === 2 && !canLeaveStep2) || (step === 3 && !canLeaveStep3)}
              >
                Next <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={handleSave}
                disabled={saveDefinition.isPending || validateDefinition.data?.ok === false}
              >
                {saveDefinition.isPending ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Save className="mr-1.5 h-3.5 w-3.5" />
                )}
                Save this KPI
              </Button>
            )}
          </div>
        </div>

        {saveMessage && (
          <p
            role="status"
            className={`rounded-lg border p-3 text-sm ${
              saveMessage.ok
                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                : "border-rose-200 bg-rose-50 text-rose-800"
            }`}
          >
            {saveMessage.text}
          </p>
        )}
      </div>

      {/* ── Summary rail ──
          The wizard hides four fifths of the decision at any moment, so this shows all of it at
          once. Without it, checking what scope you picked means navigating back and losing your
          place. */}
      <aside className="lg:sticky lg:top-6 lg:self-start">
        <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">This KPI</h4>

          <SummaryRow icon={<Building2 className="h-3.5 w-3.5" />} label="Applies to">
            {scopeDescription ? (
              <>
                <span className="font-medium">{scopeDescription}</span>
                <span className="mt-0.5 block text-slate-500">
                  {state.employee_id
                    ? (employees.data?.find((employee) => employee.id === state.employee_id)?.full_name ?? "one employee")
                    : [
                        scopeOptions.data?.branches.find((branch) => branch.id === state.branch_id)?.name,
                        visibleProcesses.find((process) => process.id === state.process_id)?.name,
                        scopeOptions.data?.designations.find((designation) => designation.id === state.designation_id)?.name,
                      ]
                        .filter(Boolean)
                        .join(" · ") || "—"}
                </span>
              </>
            ) : (
              <span className="text-slate-400">Not chosen</span>
            )}
          </SummaryRow>

          <SummaryRow icon={<Target className="h-3.5 w-3.5" />} label="KPI">
            {selectedMetric ? (
              <>
                <span className="font-medium">{selectedMetric.metric_name}</span>
                <span className="mt-0.5 block text-slate-500">{selectedMetric.metric_code}</span>
              </>
            ) : (
              <span className="text-slate-400">Not chosen</span>
            )}
          </SummaryRow>

          <SummaryRow label="Calculation">
            {state.formula_expression.trim() ? (
              <code className="block break-words font-mono text-[11px] leading-snug text-slate-700">
                {state.formula_expression}
              </code>
            ) : (
              <span className="text-slate-500">Scores the values already arriving</span>
            )}
          </SummaryRow>

          <SummaryRow label="Target">
            {state.target_value === "" ? (
              <span className="text-slate-500">Tracked, not scored</span>
            ) : (
              <>
                <span className="font-medium">{state.target_value}</span>
                {state.min_threshold !== "" && (
                  <span className="mt-0.5 block text-slate-500">unacceptable past {state.min_threshold}</span>
                )}
                <span className="mt-0.5 block text-slate-500">weight {state.weightage}%</span>
              </>
            )}
          </SummaryRow>
        </div>
      </aside>
    </div>
  );
}

function SummaryRow({
  icon,
  label,
  children,
}: {
  icon?: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border-t border-slate-200 pt-3 first-of-type:border-t-0 first-of-type:pt-0">
      <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-400">
        {icon}
        {label}
      </span>
      <div className="mt-1 text-xs text-slate-800">{children}</div>
    </div>
  );
}
