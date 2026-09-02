import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, Calculator, Check, Delete, FlaskConical, HelpCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  useFormulaHelp,
  useValidateFormula,
  usePreviewFormula,
  type SourceField,
  type PreviewResult,
} from "@/hooks/useKpiStudio";

/**
 * The calculation editor.
 *
 * Built around one constraint: the people who know what a KPI should measure are process managers
 * and QA leads, not developers. So nothing here requires typing a formula. Every field the chosen
 * data source exposes is a button, every operator is a button, and the common shapes (a ratio, a
 * percentage) are one click. Typing is allowed, because someone who knows the syntax is faster
 * that way, but it is never the only route.
 *
 * The second constraint is that a formula which validates can still be wrong — a plausible
 * expression over the wrong column produces plausible numbers. Hence "Test on a real employee",
 * which shows the ACTUAL values read from the source next to the result. That turns a silent
 * mis-mapping into something visible in the second before the definition is saved, rather than a
 * KPI that reads empty for 200 people until somebody complains.
 */

interface FormulaBuilderProps {
  value: string;
  onChange: (formula: string) => void;
  /**
   * Fields grouped by the source that supplies them.
   *
   * Grouped rather than flattened because a KPI can legitimately read a QA Google Sheet and the
   * dialer database at once, and when a formula draws on two systems the author needs to see WHICH
   * system each field comes from — otherwise a duplicated concept like `total_calls` is impossible to
   * reason about.
   */
  fieldGroups: Array<{ sourceId: string; sourceName: string; sourceType: string; fields: SourceField[] }>;
  dataSourceId: string | null;
  extraSourceIds?: string[];
  /** Employee to test against. Without one the test button explains why it is unavailable. */
  testEmployeeId?: string | null;
  testEmployeeLabel?: string | null;
  onValidityChange?: (valid: boolean) => void;
}

/** Short label so a field chip can say where it came from without a tooltip. */
const SOURCE_KIND_LABEL: Record<string, string> = {
  google_sheet_csv: "sheet",
  integration_connector: "external db",
  local_query: "this system",
  manual: "manual",
  upload: "upload",
};

/** Operator buttons, grouped so arithmetic is not mixed in with comparisons. */
const ARITHMETIC = ["+", "-", "*", "/", "(", ")"] as const;
const COMPARISON = ["<", "<=", ">", ">=", "=", "!="] as const;

/**
 * One-click starting points for the shapes almost every operational KPI takes.
 *
 * These exist because "SAFE_DIV(a, b)" is obvious to a developer and opaque to everyone else,
 * while "an average per call" is the thing the user actually wants. The template names describe
 * outcomes; the formula is what the engine needs.
 */
const TEMPLATES: ReadonlyArray<{ label: string; hint: string; build: (fields: string[]) => string }> = [
  {
    label: "Average per unit",
    hint: "A total divided by a count, e.g. talk seconds per call. Reports no value rather than dividing by zero.",
    build: (fields) => `SAFE_DIV(${fields[0] ?? "total"}, ${fields[1] ?? "count"})`,
  },
  {
    label: "Percentage",
    hint: "A part as a percentage of a whole, e.g. passed audits out of scored audits.",
    build: (fields) => `PCT(${fields[0] ?? "part"}, ${fields[1] ?? "whole"})`,
  },
  {
    label: "Simple total",
    hint: "Adds the values that are present, e.g. total calls handled.",
    build: (fields) => `SUM(${fields[0] ?? "value"})`,
  },
  {
    label: "Banded score",
    hint: "Awards a score from bands, e.g. 100 under 240 seconds, 80 under 300, otherwise 0.",
    build: (fields) => `IF(${fields[0] ?? "value"} <= 240, 100, IF(${fields[0] ?? "value"} <= 300, 80, 0))`,
  },
  {
    label: "Capped ratio",
    hint: "A ratio held inside sensible bounds, so one freak day cannot produce a 900% score.",
    build: (fields) => `CLAMP(PCT(${fields[0] ?? "part"}, ${fields[1] ?? "whole"}), 0, 100)`,
  },
];

export function FormulaBuilder({
  value,
  onChange,
  fieldGroups,
  dataSourceId,
  extraSourceIds,
  testEmployeeId,
  testEmployeeLabel,
  onValidityChange,
}: FormulaBuilderProps) {
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const [showFunctions, setShowFunctions] = useState(false);
  const [testDate, setTestDate] = useState(() => {
    // Yesterday, not today: today's data is usually still arriving from the overnight syncs, so
    // testing against it would show "no data" for a formula that is actually correct.
    const date = new Date(Date.now() - 86_400_000);
    return date.toISOString().slice(0, 10);
  });
  const [preview, setPreview] = useState<PreviewResult | null>(null);

  const help = useFormulaHelp();
  const validate = useValidateFormula();
  const previewMutation = usePreviewFormula();

  const [validation, setValidation] = useState<{ ok: boolean; error?: string; variables: string[] } | null>(null);

  const allFields = useMemo(() => fieldGroups.flatMap((group) => group.fields), [fieldGroups]);
  const fieldNames = useMemo(() => allFields.map((field) => field.field_name), [allFields]);

  /**
   * Field names offered by more than one of the chosen sources.
   *
   * The server refuses to save a formula that references one of these, because the calculation would
   * be ambiguous. Flagging them here means the author sees the problem while picking fields rather
   * than on Save.
   */
  const duplicatedNames = useMemo(() => {
    const seen = new Map<string, number>();
    for (const field of allFields) {
      seen.set(field.field_name, (seen.get(field.field_name) ?? 0) + 1);
    }
    return new Set([...seen.entries()].filter(([, count]) => count > 1).map(([name]) => name));
  }, [allFields]);

  /**
   * Validation is debounced 400ms. Validating on every keystroke would fire a request per
   * character and make the error message flicker between "unexpected end of formula" states while
   * somebody is mid-word — which reads as the editor fighting the user.
   */
  useEffect(() => {
    if (!value.trim()) {
      setValidation(null);
      onValidityChange?.(false);
      return;
    }
    const timer = setTimeout(() => {
      validate.mutate(
        { formula: value, data_source_id: dataSourceId, extra_source_ids: extraSourceIds },
        {
          onSuccess: (result) => {
            setValidation(result);
            onValidityChange?.(result.ok);
          },
        },
      );
    }, 400);
    return () => clearTimeout(timer);
    // validate/onValidityChange are stable enough for this effect's purpose; including the mutation
    // object would re-run on every render. extraSourceIds is joined rather than passed by reference
    // because a new array on every render would re-validate on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, dataSourceId, (extraSourceIds ?? []).join(",")]);

  /**
   * Inserts at the caret rather than appending.
   *
   * Appending looks fine until you need to fix the middle of an expression, at which point a
   * builder that only appends forces you to retype the rest — so people stop using the buttons and
   * type everything, and the accessible route is dead.
   */
  const insert = useCallback(
    (text: string) => {
      const element = inputRef.current;
      if (!element) {
        onChange(value + text);
        return;
      }
      const start = element.selectionStart ?? value.length;
      const end = element.selectionEnd ?? value.length;
      const needsSpace = start > 0 && !/[\s(]$/.test(value.slice(0, start)) && !/^[),]/.test(text);
      const insertion = needsSpace ? ` ${text}` : text;
      const next = value.slice(0, start) + insertion + value.slice(end);
      onChange(next);
      // Caret placed after the insertion on the next frame, once React has re-rendered the value.
      requestAnimationFrame(() => {
        const caret = start + insertion.length;
        element.focus();
        element.setSelectionRange(caret, caret);
      });
    },
    [onChange, value],
  );

  const runTest = () => {
    if (!dataSourceId || !testEmployeeId) return;
    previewMutation.mutate(
      {
        formula: value,
        data_source_id: dataSourceId,
        extra_source_ids: extraSourceIds,
        employee_id: testEmployeeId,
        date: testDate,
      },
      { onSuccess: setPreview },
    );
  };

  const canTest = Boolean(dataSourceId && testEmployeeId && value.trim() && validation?.ok);

  return (
    <TooltipProvider>
      <div className="space-y-4">
        {/* ── Templates ── */}
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Start from a common shape
          </p>
          <div className="flex flex-wrap gap-2">
            {TEMPLATES.map((template) => (
              <Tooltip key={template.label}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => onChange(template.build(fieldNames))}
                    className="cursor-pointer rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:border-indigo-400 hover:bg-indigo-50"
                  >
                    {template.label}
                  </button>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">{template.hint}</TooltipContent>
              </Tooltip>
            ))}
          </div>
        </div>

        {/* ── The expression ── */}
        <div>
          <label htmlFor="kpi-formula" className="mb-1.5 block text-sm font-medium text-slate-700">
            Calculation
          </label>
          <textarea
            id="kpi-formula"
            ref={inputRef}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            rows={3}
            spellCheck={false}
            placeholder="Click a field below, or type — for example  SAFE_DIV(talk_seconds, calls)"
            className="w-full resize-y rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            aria-describedby="kpi-formula-status"
          />

          {/* Status line. Deliberately always present so the layout does not jump when a message
              appears, which otherwise moves the buttons under the user's cursor. */}
          <div id="kpi-formula-status" className="mt-1.5 min-h-[1.25rem] text-xs" role="status">
            {validate.isPending && (
              <span className="flex items-center gap-1.5 text-slate-400">
                <Loader2 className="h-3 w-3 animate-spin" /> Checking…
              </span>
            )}
            {!validate.isPending && validation?.ok && (
              <span className="flex items-center gap-1.5 text-emerald-600">
                <Check className="h-3.5 w-3.5" />
                Valid. Reads {validation.variables.length === 0 ? "no fields" : validation.variables.join(", ")}.
              </span>
            )}
            {!validate.isPending && validation && !validation.ok && (
              <span className="flex items-start gap-1.5 text-rose-600">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{validation.error}</span>
              </span>
            )}
            {!value.trim() && (
              <span className="text-slate-400">
                Leave this empty to score the values an existing sync already writes for this KPI.
              </span>
            )}
          </div>
        </div>

        {/* ── Fields ── */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Fields from this data source
            </p>
            {value.trim() && (
              <button
                type="button"
                onClick={() => onChange("")}
                className="flex cursor-pointer items-center gap-1 text-xs text-slate-400 transition-colors hover:text-rose-600"
              >
                <Delete className="h-3 w-3" /> Clear
              </button>
            )}
          </div>

          {!dataSourceId ? (
            <p className="rounded-lg border border-dashed border-slate-200 p-3 text-xs text-slate-500">
              Choose a data source first and its fields will appear here as buttons.
            </p>
          ) : allFields.length === 0 ? (
            <p className="rounded-lg border border-dashed border-amber-300 bg-amber-50 p-3 text-xs text-amber-800">
              This data source has no fields set up yet. Add fields to it under Data sources, then come
              back — a calculation can only read fields the source declares.
            </p>
          ) : (
            <div className="space-y-2.5">
              {duplicatedNames.size > 0 && (
                <p className="rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-900">
                  {[...duplicatedNames].join(", ")} {duplicatedNames.size === 1 ? "is" : "are"} supplied by more
                  than one of these sources. Using {duplicatedNames.size === 1 ? "it" : "them"} would make the
                  calculation ambiguous, so rename it in one source before referencing it.
                </p>
              )}

              {fieldGroups
                .filter((group) => group.fields.length > 0)
                .map((group) => (
                  <div key={group.sourceId}>
                    {/* The source label only appears once there is more than one source. For a
                        single-source KPI it would be noise repeating what the dropdown above says. */}
                    {fieldGroups.filter((candidate) => candidate.fields.length > 0).length > 1 && (
                      <p className="mb-1 text-[11px] font-medium text-slate-500">
                        {group.sourceName}
                        <span className="ml-1 font-normal text-slate-400">
                          {SOURCE_KIND_LABEL[group.sourceType] ?? group.sourceType}
                        </span>
                      </p>
                    )}
                    <div className="flex flex-wrap gap-2">
                      {group.fields.map((field) => {
                        const ambiguous = duplicatedNames.has(field.field_name);
                        return (
                          <Tooltip key={`${group.sourceId}-${field.id}`}>
                            <TooltipTrigger asChild>
                              <button
                                type="button"
                                onClick={() => insert(field.field_name)}
                                className={`cursor-pointer rounded-lg border px-2.5 py-1 font-mono text-xs font-medium transition-colors ${
                                  ambiguous
                                    ? "border-amber-400 bg-amber-50 text-amber-900 hover:border-amber-600"
                                    : "border-indigo-200 bg-indigo-50 text-indigo-800 hover:border-indigo-500 hover:bg-indigo-100"
                                }`}
                              >
                                {field.field_name}
                              </button>
                            </TooltipTrigger>
                            <TooltipContent className="max-w-xs">
                              <span className="font-medium">{field.display_name || field.field_name}</span>
                              <span className="mt-0.5 block text-[11px] opacity-80">from {group.sourceName}</span>
                              {field.source_expression && (
                                <span className="mt-0.5 block font-mono text-[11px] opacity-80">
                                  {field.source_expression}
                                </span>
                              )}
                              {field.unit && <span className="mt-0.5 block text-[11px] opacity-80">Unit: {field.unit}</span>}
                              {ambiguous && (
                                <span className="mt-1 block text-[11px] font-medium">
                                  Also supplied by another source — rename one before using it.
                                </span>
                              )}
                            </TooltipContent>
                          </Tooltip>
                        );
                      })}
                    </div>
                  </div>
                ))}
            </div>
          )}
        </div>

        {/* ── Operators ── */}
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex flex-wrap gap-1.5">
            {ARITHMETIC.map((operator) => (
              <button
                key={operator}
                type="button"
                onClick={() => insert(operator)}
                aria-label={`Insert ${operator}`}
                className="h-8 w-8 cursor-pointer rounded-lg border border-slate-300 bg-white font-mono text-sm text-slate-700 transition-colors hover:border-slate-500 hover:bg-slate-50"
              >
                {operator}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {COMPARISON.map((operator) => (
              <button
                key={operator}
                type="button"
                onClick={() => insert(operator)}
                aria-label={`Insert ${operator}`}
                className="h-8 min-w-8 cursor-pointer rounded-lg border border-slate-200 bg-slate-50 px-1.5 font-mono text-xs text-slate-600 transition-colors hover:border-slate-400 hover:bg-slate-100"
              >
                {operator}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setShowFunctions((open) => !open)}
            className="flex cursor-pointer items-center gap-1.5 text-xs font-medium text-indigo-600 transition-colors hover:text-indigo-800"
          >
            <HelpCircle className="h-3.5 w-3.5" />
            {showFunctions ? "Hide functions" : "All functions"}
          </button>
        </div>

        {showFunctions && (
          <div className="max-h-52 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div className="grid gap-1.5 sm:grid-cols-2">
              {(help.data?.functions ?? []).map((fn) => (
                <button
                  key={fn.name}
                  type="button"
                  onClick={() => insert(`${fn.name}(`)}
                  className="cursor-pointer rounded-md bg-white p-2 text-left transition-colors hover:bg-indigo-50"
                >
                  <span className="font-mono text-xs font-semibold text-indigo-700">{fn.name}</span>
                  <span className="mt-0.5 block text-[11px] leading-snug text-slate-600">{fn.description}</span>
                </button>
              ))}
            </div>
            {(help.data?.notes ?? []).length > 0 && (
              <ul className="mt-3 space-y-1 border-t border-slate-200 pt-2">
                {help.data!.notes.map((note) => (
                  <li key={note} className="text-[11px] leading-snug text-slate-500">
                    {note}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* ── Test ── */}
        <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
          <div className="flex flex-wrap items-center gap-3">
            <span className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
              <FlaskConical className="h-4 w-4 text-indigo-600" />
              Test it on real data
            </span>
            <Input
              type="date"
              value={testDate}
              max={new Date().toISOString().slice(0, 10)}
              onChange={(event) => setTestDate(event.target.value)}
              className="h-8 w-36"
              aria-label="Date to test against"
            />
            <Button size="sm" onClick={runTest} disabled={!canTest || previewMutation.isPending}>
              {previewMutation.isPending ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Calculator className="mr-1.5 h-3.5 w-3.5" />
              )}
              Run
            </Button>
            {testEmployeeLabel && <span className="text-xs text-slate-500">against {testEmployeeLabel}</span>}
          </div>

          {/* Each unavailable reason is stated specifically. "Run is disabled" with no explanation
              is the most common way a builder UI wastes somebody's afternoon. */}
          {!canTest && (
            <p className="mt-2 text-xs text-slate-500">
              {!dataSourceId
                ? "Choose a data source to test against."
                : !testEmployeeId
                  ? "Pick an employee in step 1 to test against — any employee in the scope will do."
                  : !value.trim()
                    ? "Write a calculation first."
                    : "Fix the calculation above before testing."}
            </p>
          )}

          {preview && (
            <div className="mt-3 space-y-2 border-t border-slate-200 pt-3">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-xs text-slate-500">Result</span>
                {preview.status === "computed" ? (
                  <span className="font-mono text-lg font-bold text-emerald-700">{preview.value}</span>
                ) : preview.status === "no_data" ? (
                  <span className="text-sm font-semibold text-amber-700">No value for this day</span>
                ) : (
                  <span className="text-sm font-semibold text-rose-700">Could not calculate</span>
                )}
              </div>

              {/* The inputs are the point of this panel: a wrong result is only diagnosable next to
                  the numbers that produced it. */}
              {Object.keys(preview.inputs).length > 0 && (
                <div>
                  <p className="mb-1 text-xs text-slate-500">Values read from the source</p>
                  <div className="flex flex-wrap gap-1.5">
                    {Object.entries(preview.inputs).map(([field, fieldValue]) => (
                      <span
                        key={field}
                        className={`rounded-md border px-2 py-0.5 font-mono text-[11px] ${
                          fieldValue === null
                            ? "border-amber-300 bg-amber-50 text-amber-800"
                            : "border-slate-200 bg-white text-slate-700"
                        }`}
                      >
                        {field} = {fieldValue === null ? "no value" : fieldValue}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {(preview.reason || preview.message || preview.source_error) && (
                <p className="text-xs text-slate-600">{preview.reason ?? preview.message ?? preview.source_error}</p>
              )}
            </div>
          )}
        </div>
      </div>
    </TooltipProvider>
  );
}
