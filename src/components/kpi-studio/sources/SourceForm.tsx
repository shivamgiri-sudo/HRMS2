import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSaveDataSource, useScopeOptions, useStudioCapability } from "@/hooks/useKpiStudio";
import {
  codeFromName,
  dateFormatOptions,
  describeSaveError,
  fieldsForType,
  toSourcePayload,
  validateSource,
  type SourceForm as SourceFormState,
} from "./source-form";
import { Field, Problems, selectClass } from "./form-bits";
import { SourceTypePicker } from "./SourceTypePicker";
import { ProcessKeyFields } from "./ProcessKeyFields";
import { GoogleSheetFields } from "./GoogleSheetFields";
import { NamedPoolFields } from "./NamedPoolFields";

/**
 * Create or edit a data source. Shows only the inputs that apply to the chosen kind, checks them
 * against the same rules the server applies, and reports a refused save next to the Save button.
 */
export function SourceForm({
  initial,
  onSaved,
  onCancel,
}: {
  initial: SourceFormState;
  onSaved: (id: string, wasEdit: boolean) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<SourceFormState>(initial);
  const [codeTouched, setCodeTouched] = useState(Boolean(initial.source_code));
  const [attempted, setAttempted] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const saveSource = useSaveDataSource();
  const capability = useStudioCapability();
  const scopeOptions = useScopeOptions();
  const queryClient = useQueryClient();

  const isEdit = Boolean(form.id);
  const show = fieldsForType(form.source_type);
  const context = { processGrain: Boolean(capability.data?.processGrain), dateFormat: Boolean(capability.data?.dateFormat) };
  const problems = validateSource(form, context);
  const patch = (change: Partial<SourceFormState>) => setForm((previous) => ({ ...previous, ...change }));
  const isSheet = show.sheet;

  async function handleSave() {
    setAttempted(true);
    setServerError(null);
    if (problems.length) return;
    try {
      const saved = await saveSource.mutateAsync(toSourcePayload(form, context));
      // The save hook refreshes the list; the open source's own details are a separate cache entry.
      void queryClient.invalidateQueries({ queryKey: ["kpi-studio", "data-source", saved.id] });
      void queryClient.invalidateQueries({ queryKey: ["kpi-studio", "columns", saved.id] });
      onSaved(saved.id, isEdit);
    } catch (error) {
      setServerError(describeSaveError(error, "Could not save the data source. Please try again."));
    }
  }

  return (
    <section aria-labelledby="source-form-title" className="space-y-4 rounded-xl border border-indigo-200 bg-indigo-50/40 p-3 sm:p-4">
      <h3 id="source-form-title" className="text-base font-semibold text-slate-900">
        {isEdit ? `Edit ${initial.source_name}` : "Add a data source"}
      </h3>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="source-name" label="Name" hint="What people will see when they pick this source for a KPI.">
          <Input
            id="source-name"
            value={form.source_name}
            onChange={(event) => {
              const source_name = event.target.value;
              patch(codeTouched || isEdit ? { source_name } : { source_name, source_code: codeFromName(source_name) });
            }}
            placeholder="Dialer call detail"
          />
        </Field>
        <Field
          id="source-code"
          label="Code"
          hint={isEdit ? "A permanent short name. It cannot be changed after the source is created." : "A permanent short name: capital letters, numbers and underscores. Filled in from the name."}
        >
          <Input
            id="source-code"
            value={form.source_code}
            disabled={isEdit}
            onChange={(event) => {
              setCodeTouched(true);
              patch({ source_code: event.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "_") });
            }}
            placeholder="DIALER_CALL_DETAIL"
            className="font-mono text-xs"
          />
        </Field>
      </div>

      <div>
        <p className="mb-1 text-xs font-medium text-slate-700">Where do the figures come from?</p>
        <SourceTypePicker value={form.source_type} onChange={(source_type) => patch({ source_type })} />
      </div>

      {show.integrationKey && (
        <Field
          id="source-integration-key"
          label="Integration Hub key"
          hint="The key of a connection already set up in the Integration Hub. The login stays there and is never copied here."
        >
          <Input
            id="source-integration-key"
            value={form.integration_key}
            onChange={(event) => patch({ integration_key: event.target.value })}
            placeholder="apr_productivity"
            className="font-mono text-xs"
          />
        </Field>
      )}

      {show.namedPool && <NamedPoolFields poolKey={form.integration_key} table={form.source_object} onChange={patch} />}

      {show.table && !show.namedPool && (
        <Field id="source-table" label="Table name" hint="The table to read, exactly as it is named in the database.">
          <Input
            id="source-table"
            value={form.source_object}
            onChange={(event) => patch({ source_object: event.target.value })}
            placeholder="attendance_daily_record"
            className="font-mono text-xs"
          />
        </Field>
      )}

      {isSheet && <GoogleSheetFields csvUrl={form.csv_url} sheetTab={form.sheet_tab} onChange={patch} />}

      {show.rowColumns && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            id="source-employee-column"
            label={isSheet ? "Heading of the employee column" : "Employee column (optional)"}
            hint={
              isSheet
                ? "The heading, exactly as written in the sheet, of the column holding each person's employee code."
                : "The column that says whose row it is. Leave empty for data that is only about a process."
            }
          >
            <Input
              id="source-employee-column"
              value={form.employee_key_column}
              onChange={(event) => patch({ employee_key_column: event.target.value })}
              placeholder={isSheet ? "Employee Code" : "employee_id"}
              className="font-mono text-xs"
            />
          </Field>
          {!isSheet && (
            <Field
              id="source-employee-kind"
              label="That column holds"
              hint="Employee code is the number on the ID card. The internal ID is this system's own record ID."
            >
              <select
                id="source-employee-kind"
                value={form.employee_key_kind}
                onChange={(event) => patch({ employee_key_kind: event.target.value })}
                className={selectClass}
              >
                <option value="employee_code">Employee code</option>
                <option value="employee_id">This system's internal ID</option>
              </select>
            </Field>
          )}
          <Field
            id="source-date-column"
            label={isSheet ? "Heading of the date column" : "Date column"}
            hint="The column that says which day a row belongs to. Figures are worked out day by day."
          >
            <Input
              id="source-date-column"
              value={form.date_column}
              onChange={(event) => patch({ date_column: event.target.value })}
              placeholder={isSheet ? "Date" : "call_date"}
              className="font-mono text-xs"
            />
          </Field>
          {/* A closed list, not free text: a format that is subtly wrong reads every row as "no
              date", and the source then looks empty instead of misconfigured. */}
          {show.dateFormat && capability.data?.dateFormat && (
            <Field
              id="source-date-format"
              label="How dates are written in that column"
              hint="Choose a format only if the column stores dates as text. Reading text dates is slower on large tables."
            >
              <select
                id="source-date-format"
                value={form.date_format}
                onChange={(event) => patch({ date_format: event.target.value })}
                className={selectClass}
              >
                <option value="">It is a real date column</option>
                {dateFormatOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}, e.g. {option.example}
                  </option>
                ))}
              </select>
            </Field>
          )}
        </div>
      )}

      {show.processKey && capability.data?.processGrain && (
        <ProcessKeyFields
          form={form}
          onChange={patch}
          processes={scopeOptions.data?.processes ?? []}
          loading={scopeOptions.isLoading}
          loadError={scopeOptions.isError ? describeSaveError(scopeOptions.error, "Please try again.") : null}
        />
      )}

      {!show.rowColumns && (
        <p className="rounded-lg border border-slate-200 bg-white p-2.5 text-xs text-slate-600">
          Nothing else to set up here. After saving, add the fields, then{" "}
          {form.source_type === "upload" ? "upload a spreadsheet" : "enter or upload the figures"} for them.
        </p>
      )}

      <Field id="source-description" label="Notes (optional)" hint="Anything the next person should know about this source.">
        <Input
          id="source-description"
          value={form.description}
          onChange={(event) => patch({ description: event.target.value })}
          placeholder="Synced nightly from the dialer"
        />
      </Field>

      <div className="space-y-2">
        {attempted && <Problems items={problems} />}
        {serverError && <Problems items={[serverError]} />}
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" onClick={() => void handleSave()} disabled={saveSource.isPending} className="cursor-pointer">
            {saveSource.isPending ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Check className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
            )}
            {isEdit ? "Save changes" : "Create data source"}
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={onCancel} disabled={saveSource.isPending} className="cursor-pointer">
            Cancel
          </Button>
        </div>
      </div>
    </section>
  );
}
