import { Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { processKeyOptions, type ProcessKeyKind, type SourceForm } from "./source-form";
import { Field, selectClass } from "./form-bits";

type ProcessPatch = Partial<Pick<SourceForm, "process_key_kind" | "process_key_column" | "process_key_value" | "process_id">>;

/**
 * How this source's rows are matched to a process, which is what lets it feed a process-level KPI.
 * The process list is whatever the scope options returned: only the processes the person looks
 * after, unless they work across the whole organisation.
 */
export function ProcessKeyFields({
  form,
  onChange,
  processes,
  loading,
  loadError,
}: {
  form: SourceForm;
  onChange: (patch: ProcessPatch) => void;
  processes: ReadonlyArray<{ id: string; name: string }>;
  loading: boolean;
  loadError: string | null;
}) {
  const kind = form.process_key_kind;
  const chosen = processKeyOptions.find((option) => option.value === kind);
  // An edit can open a source mapped to a process outside this person's list. It stays selectable
  // so opening the form does not silently change the mapping.
  const currentMissing = Boolean(form.process_id) && !processes.some((process) => process.id === form.process_id);

  return (
    <fieldset className="space-y-3 rounded-lg border border-slate-200 bg-slate-50/60 p-3">
      <legend className="px-1 text-xs font-semibold text-slate-700">Which process is this data for?</legend>

      <Field id="source-process-kind" label="How rows are matched to a process" hint={chosen?.explanation}>
        <select
          id="source-process-kind"
          value={kind}
          onChange={(event) => onChange({ process_key_kind: event.target.value as ProcessKeyKind })}
          className={selectClass}
        >
          {processKeyOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </Field>

      {kind !== "none" && (
        <Field
          id="source-process-id"
          label={kind === "employee" ? "Default process" : "Process"}
          hint={
            kind === "employee"
              ? "Used when a calculation does not name a process. Each row still follows its own employee."
              : "The process these rows count towards."
          }
        >
          {loading ? (
            <p className="flex items-center gap-2 py-1.5 text-xs text-slate-500">
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> Loading processes…
            </p>
          ) : (
            <select
              id="source-process-id"
              value={form.process_id}
              onChange={(event) => onChange({ process_id: event.target.value })}
              className={selectClass}
            >
              <option value="">Select a process…</option>
              {currentMissing && <option value={form.process_id}>Current process (not in your list)</option>}
              {processes.map((process) => (
                <option key={process.id} value={process.id}>
                  {process.name}
                </option>
              ))}
            </select>
          )}
          {loadError && <p className="mt-1 text-[11px] text-rose-700">Could not load the process list. {loadError}</p>}
          {!loading && !loadError && processes.length === 0 && (
            <p className="mt-1 text-[11px] text-amber-700">
              No processes are assigned to you, so this source cannot be tied to one. Ask an administrator.
            </p>
          )}
        </Field>
      )}

      {kind === "column" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="source-process-column" label="Column that identifies the process" hint="For example client_code or CampaignName.">
            <Input
              id="source-process-column"
              value={form.process_key_column}
              onChange={(event) => onChange({ process_key_column: event.target.value })}
              placeholder="client_code"
              className="font-mono text-xs"
            />
          </Field>
          <Field
            id="source-process-value"
            label="Value it holds for this process"
            hint="The other system's own code for this client, exactly as it appears in the table."
          >
            <Input
              id="source-process-value"
              value={form.process_key_value}
              onChange={(event) => onChange({ process_key_value: event.target.value })}
              placeholder="CLOVIA"
              className="font-mono text-xs"
            />
          </Field>
        </div>
      )}

      {kind === "employee" && (
        <p className="text-[11px] leading-snug text-slate-500">
          Needs the employee column above. The lookup uses this system's employee records, so it is
          not available for an external database set up in the Integration Hub.
        </p>
      )}
    </fieldset>
  );
}
