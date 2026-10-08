import { useMemo, useState } from "react";
import { Check, Loader2, Pencil, Plus, Settings2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  useDeleteDataSource,
  useDeleteSourceField,
  useSaveSourceField,
  useSourceColumns,
  useStudioCapability,
  type DataSourceDetail,
  type SourceField,
} from "@/hooks/useKpiStudio";
import {
  AGGREGATES,
  describeFilterRows,
  describeSaveError,
  emptyFieldDraft,
  filterToJson,
  parseFilter,
  sourceTypeLabel,
  validateField,
  type FieldDraft,
  type FilterRow,
} from "./source-form";
import { Field, Problems, focusRing, selectClass } from "./form-bits";
import { FieldFilterEditor } from "./FieldFilterEditor";
import { UploadPanel } from "./UploadPanel";

/**
 * One source's fields. A "field" is a named number a formula can reference; declaring them up
 * front is what lets the formula builder offer clickable inputs and reject a formula that reads a
 * column the source does not have.
 */
export function FieldEditor({
  source,
  onRetired,
  onEditSource,
}: {
  source: DataSourceDetail;
  onRetired: () => void;
  onEditSource: () => void;
}) {
  const isFileBacked = source.source_type === "manual" || source.source_type === "upload";
  const columns = useSourceColumns(isFileBacked ? null : source.id);
  const saveField = useSaveSourceField();
  const deleteField = useDeleteSourceField();
  // Its own capability read rather than a prop: a stale prop is how a form ends up offering a
  // control the database cannot store.
  const capability = useStudioCapability();
  const retireSource = useDeleteDataSource();
  const [confirmRetire, setConfirmRetire] = useState(false);
  const [retireError, setRetireError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [attempted, setAttempted] = useState(false);

  const [draft, setDraft] = useState<FieldDraft>(emptyFieldDraft);
  const [filters, setFilters] = useState<FilterRow[]>([]);

  const columnNames = useMemo(() => (columns.data ?? []).map((column) => column.column_name), [columns.data]);
  const numericColumns = useMemo(() => (columns.data ?? []).filter((column) => column.is_numeric), [columns.data]);
  const canFilter = Boolean(capability.data?.fieldFilters) && !isFileBacked;
  const activeFilters = canFilter ? filters : [];
  const problems = validateField(draft, activeFilters, isFileBacked);
  const editing = Boolean(draft.id);
  const patch = (change: Partial<FieldDraft>) => setDraft((previous) => ({ ...previous, ...change }));

  function reset() {
    setDraft(emptyFieldDraft);
    setFilters([]);
    setAttempted(false);
    setServerError(null);
  }

  function startEdit(field: SourceField) {
    setDraft({
      id: field.id,
      field_name: field.field_name,
      display_name: field.display_name ?? "",
      source_column: field.source_column ?? "",
      aggregate_fn: (field.aggregate_fn ?? "SUM").toUpperCase(),
      unit: field.unit ?? "",
      description: field.description ?? "",
    });
    setFilters(parseFilter(field.filter_json));
    setAttempted(false);
    setServerError(null);
  }

  async function handleSaveField() {
    setAttempted(true);
    setServerError(null);
    if (problems.length) return;
    try {
      await saveField.mutateAsync({
        dataSourceId: source.id,
        ...(draft.id ? { id: draft.id } : {}),
        field_name: draft.field_name.trim(),
        display_name: draft.display_name || null,
        // A file-backed source has no column to aggregate: the field name IS the column in the
        // uploaded sheet, and the value is stored per employee per day already.
        source_column: isFileBacked ? null : draft.source_column || null,
        aggregate_fn: isFileBacked ? "NONE" : draft.aggregate_fn,
        unit: draft.unit || null,
        description: draft.description || null,
        // Sent as an empty list when every condition was removed, which is what clears them.
        ...(canFilter ? { filter_json: filterToJson(activeFilters) } : {}),
      });
      reset();
    } catch (caught) {
      setServerError(describeSaveError(caught, "Could not save the field. Please try again."));
    }
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="break-words text-base font-semibold text-slate-900">{source.source_name}</h3>
          <p className="mt-0.5 break-words text-xs text-slate-500">
            {sourceTypeLabel(source.source_type)}
            {source.source_object ? ` · ${source.source_object}` : ""}
            {source.integration_key ? ` · ${source.integration_key}` : ""}
          </p>
        </div>
        <div className="shrink-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <Button type="button" size="sm" variant="outline" className="h-8 cursor-pointer px-2.5 text-xs" onClick={onEditSource}>
              <Settings2 className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Edit settings
            </Button>
            {confirmRetire ? (
              <>
                <Button type="button" size="sm" variant="ghost" className="h-8 cursor-pointer px-2 text-xs" onClick={() => setConfirmRetire(false)}>
                  Cancel
                </Button>
                <Button
                  type="button"
                  size="sm"
                  className="h-8 cursor-pointer bg-rose-600 px-2 text-xs hover:bg-rose-700"
                  disabled={retireSource.isPending}
                  onClick={() => {
                    setRetireError(null);
                    retireSource.mutate(source.id, {
                      onSuccess: () => {
                        setConfirmRetire(false);
                        onRetired();
                      },
                      onError: (error) => setRetireError(describeSaveError(error, "Could not retire the source.")),
                    });
                  }}
                >
                  {retireSource.isPending ? "Retiring…" : "Yes, retire"}
                </Button>
              </>
            ) : (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-8 cursor-pointer px-2 text-xs text-slate-500 hover:text-rose-600"
                onClick={() => {
                  setRetireError(null);
                  setConfirmRetire(true);
                }}
              >
                <Trash2 className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Retire source
              </Button>
            )}
          </div>
          {/* The refusal names the KPIs still reading it, which is the whole point of asking the
              server rather than hiding the button. */}
          {retireError && (
            <p role="alert" className="mt-1 max-w-xs text-[11px] leading-relaxed text-rose-600">
              {retireError}
            </p>
          )}
        </div>
      </header>

      {source.fields.length > 0 ? (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th scope="col" className="px-3 py-2 font-semibold">Field name</th>
                <th scope="col" className="px-3 py-2 font-semibold">Reads</th>
                <th scope="col" className="px-3 py-2 font-semibold">Unit</th>
                <th scope="col" className="px-3 py-2"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {source.fields.map((field) => {
                const fieldFilters = parseFilter(field.filter_json);
                const reads =
                  field.source_expression ??
                  (field.source_column
                    ? `${field.aggregate_fn ?? "SUM"}(${field.source_column})`
                    : isFileBacked
                      ? "uploaded value"
                      : "—");
                return (
                  <tr key={field.id} className={draft.id === field.id ? "bg-indigo-50/60" : undefined}>
                    <td className="px-3 py-2 align-top">
                      <code className="font-mono text-xs font-semibold text-indigo-700">{field.field_name}</code>
                      {field.display_name && <span className="block text-[11px] text-slate-500">{field.display_name}</span>}
                    </td>
                    <td className="px-3 py-2 align-top">
                      <span className="font-mono text-[11px] text-slate-600">{reads}</span>
                      {fieldFilters.length > 0 && (
                        <span className="mt-0.5 block text-[11px] leading-snug text-slate-500">{describeFilterRows(fieldFilters)}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 align-top text-xs text-slate-500">{field.unit ?? "—"}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right align-top">
                      <button
                        type="button"
                        onClick={() => startEdit(field)}
                        className={`cursor-pointer rounded p-1.5 text-slate-400 transition-colors hover:text-indigo-600 ${focusRing}`}
                        title="Edit this field"
                        aria-label={`Edit ${field.field_name}`}
                      >
                        <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        disabled={deleteField.isPending}
                        onClick={() => {
                          setServerError(null);
                          if (draft.id === field.id) reset();
                          deleteField.mutate(
                            { fieldId: field.id, dataSourceId: source.id },
                            { onError: (error) => setServerError(describeSaveError(error, "Could not remove the field.")) },
                          );
                        }}
                        className={`cursor-pointer rounded p-1.5 text-slate-400 transition-colors hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`}
                        title="Remove this field"
                        aria-label={`Remove ${field.field_name}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="rounded-xl border border-dashed border-amber-300 bg-amber-50 p-3 text-xs text-amber-800">
          No fields yet. A calculation can only read fields declared here, so add at least one.
        </p>
      )}

      <section aria-labelledby="field-form-title" className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
        <h4 id="field-form-title" className="text-sm font-medium text-slate-700">
          {editing ? `Edit field ${draft.field_name}` : "Add a field"}
        </h4>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="field-name" label="Name used in formulas" hint="Letters, numbers and underscores. This is what you type in a calculation.">
            <Input
              id="field-name"
              value={draft.field_name}
              onChange={(event) =>
                // Normalised as it is typed rather than rejected on save: silently making the input
                // a legal name is kinder than an error about characters nobody sees the point of.
                patch({ field_name: event.target.value.replace(/[^A-Za-z0-9_]/g, "_").toLowerCase() })
              }
              placeholder="talk_seconds"
              className="font-mono text-xs"
            />
          </Field>

          <Field id="field-label" label="Label (optional)" hint="A friendlier name shown beside the field.">
            <Input id="field-label" value={draft.display_name} onChange={(event) => patch({ display_name: event.target.value })} placeholder="Talk time in seconds" />
          </Field>

          {!isFileBacked && (
            <>
              <Field
                id="field-column"
                label="Column in the source"
                hint={
                  columns.isLoading
                    ? "Reading the table's columns…"
                    : numericColumns.length > 0
                      ? "The column whose numbers this field reads."
                      : "The columns could not be read, so type the name. Check the table name and connection if this is unexpected."
                }
              >
                {numericColumns.length > 0 ? (
                  <select id="field-column" value={draft.source_column} onChange={(event) => patch({ source_column: event.target.value })} className={`${selectClass} font-mono text-xs`}>
                    <option value="">Choose a column…</option>
                    {/* Kept selectable when editing a field whose column is not numeric (a COUNT). */}
                    {draft.source_column && !numericColumns.some((column) => column.column_name === draft.source_column) && (
                      <option value={draft.source_column}>{draft.source_column}</option>
                    )}
                    {numericColumns.map((column) => (
                      <option key={column.column_name} value={column.column_name}>
                        {column.column_name} ({column.data_type})
                      </option>
                    ))}
                  </select>
                ) : (
                  <Input id="field-column" value={draft.source_column} onChange={(event) => patch({ source_column: event.target.value })} placeholder="talk_sec" className="font-mono text-xs" />
                )}
              </Field>

              <Field id="field-aggregate" label="Combine each day's rows by" hint="A day usually has many rows. This turns them into the one number a formula uses.">
                <select id="field-aggregate" value={draft.aggregate_fn} onChange={(event) => patch({ aggregate_fn: event.target.value })} className={selectClass}>
                  {AGGREGATES.map((aggregate) => (
                    <option key={aggregate.value} value={aggregate.value}>
                      {aggregate.label}
                    </option>
                  ))}
                </select>
              </Field>
            </>
          )}

          <Field id="field-unit" label="Unit (optional)" hint="For example seconds, calls or %.">
            <Input id="field-unit" value={draft.unit} onChange={(event) => patch({ unit: event.target.value })} placeholder="seconds" />
          </Field>

          <Field id="field-description" label="Notes (optional)" hint="What this number means, for whoever builds a KPI from it.">
            <Input id="field-description" value={draft.description} onChange={(event) => patch({ description: event.target.value })} placeholder="Excludes hold time" />
          </Field>
        </div>

        {/* Only for column-backed sources: a file-backed field has no rows to filter, its value
            is already one number per employee per day. */}
        {canFilter && <FieldFilterEditor rows={filters} onChange={setFilters} columns={columnNames} idPrefix="field-filter" />}

        {attempted && <Problems items={problems} />}
        {serverError && <Problems items={[serverError]} />}

        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" onClick={() => void handleSaveField()} disabled={!draft.field_name.trim() || saveField.isPending} className="cursor-pointer">
            {saveField.isPending ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : editing ? (
              <Check className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
            )}
            {editing ? "Save field" : "Add field"}
          </Button>
          {editing && (
            <Button type="button" size="sm" variant="outline" onClick={reset} className="cursor-pointer">
              Cancel
            </Button>
          )}
        </div>
      </section>

      {isFileBacked && source.fields.length > 0 && <UploadPanel source={source} />}
    </div>
  );
}
