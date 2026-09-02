import { useMemo, useState } from "react";
import { Check, Database, FileSpreadsheet, Loader2, Plus, Trash2, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  useDataSource,
  useDataSources,
  useDeleteSourceField,
  useSaveDataSource,
  useSaveSourceField,
  useSourceColumns,
  useUploadCommit,
  useUploadPreview,
  type DataSourceSummary,
  type UploadPreview,
} from "@/hooks/useKpiStudio";

/**
 * Data sources and their fields.
 *
 * A "field" here is the unit that makes the formula builder work: a named number a formula can
 * reference. Declaring them up front is what lets the builder offer clickable inputs and reject a
 * formula that references a column the source does not have — otherwise a typo becomes a KPI that
 * silently reads empty for ever.
 *
 * Google Sheets is deliberately absent from the source types. There is no working Sheets
 * integration in this system — the existing one is a stub that always fails — so a Sheet is
 * exported to CSV and loaded through the upload route, which does work. Offering a Sheets option
 * that silently does nothing would be worse than not offering one.
 */

const SOURCE_TYPE_LABEL: Record<string, string> = {
  local_query: "A table in this system",
  integration_connector: "An external database",
  google_sheet_csv: "A live Google Sheet",
  upload: "Spreadsheet upload",
  manual: "Typed in or uploaded",
};

const AGGREGATES = ["SUM", "AVG", "COUNT", "MIN", "MAX", "NONE"] as const;

export function DataSourceManager() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const sources = useDataSources();
  const detail = useDataSource(selectedId);
  const saveSource = useSaveDataSource();

  const [newSource, setNewSource] = useState({
    source_code: "",
    source_name: "",
    source_type: "local_query",
    integration_key: "",
    source_object: "",
    employee_key_column: "",
    employee_key_kind: "employee_code",
    date_column: "",
    csv_url: "",
    sheet_tab: "",
  });

  async function handleCreateSource() {
    setMessage(null);
    try {
      const created = await saveSource.mutateAsync(newSource);
      setSelectedId(created.id);
      setCreating(false);
      setNewSource({
        source_code: "",
        source_name: "",
        source_type: "local_query",
        integration_key: "",
        source_object: "",
        employee_key_column: "",
        employee_key_kind: "employee_code",
        date_column: "",
        csv_url: "",
        sheet_tab: "",
      });
      setMessage({ ok: true, text: "Data source created. Now add the fields a formula can read." });
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : "Could not create the data source" });
    }
  }

  return (
    <div className="space-y-5">
      {message && (
        <p
          role="status"
          className={`rounded-lg border p-3 text-sm ${
            message.ok ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-rose-200 bg-rose-50 text-rose-800"
          }`}
        >
          {message.text}
        </p>
      )}

      <div className="grid gap-5 lg:grid-cols-[20rem_1fr]">
        {/* ── Source list ── */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-800">Data sources</h3>
            <Button size="sm" variant="outline" onClick={() => setCreating((open) => !open)}>
              <Plus className="mr-1 h-3.5 w-3.5" /> Add
            </Button>
          </div>

          {creating && (
            <div className="space-y-2.5 rounded-xl border border-indigo-200 bg-indigo-50/50 p-3">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-700">Name</span>
                <Input
                  value={newSource.source_name}
                  onChange={(event) => {
                    const source_name = event.target.value;
                    setNewSource((previous) => ({
                      ...previous,
                      source_name,
                      source_code:
                        previous.source_code || source_name.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_").slice(0, 60),
                    }));
                  }}
                  placeholder="e.g. Dialer call detail"
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-700">Kind</span>
                <select
                  value={newSource.source_type}
                  onChange={(event) => setNewSource((previous) => ({ ...previous, source_type: event.target.value }))}
                  className="w-full cursor-pointer rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm"
                >
                  {Object.entries(SOURCE_TYPE_LABEL).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>

              {newSource.source_type === "integration_connector" && (
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-slate-700">Integration key</span>
                  <Input
                    value={newSource.integration_key}
                    onChange={(event) => setNewSource((previous) => ({ ...previous, integration_key: event.target.value }))}
                    placeholder="e.g. apr_productivity"
                    className="font-mono text-xs"
                  />
                  {/* The credential deliberately is not asked for here: it already lives encrypted
                      against this key in the Integration Hub, and copying it into a second place
                      would mean two records of one secret that can disagree. */}
                  <span className="mt-1 block text-[11px] leading-snug text-slate-500">
                    Must already be set up in the Integration Hub. Credentials stay there — they are
                    never copied into KPI config.
                  </span>
                </label>
              )}

              {newSource.source_type === "google_sheet_csv" && (
                <>
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium text-slate-700">Published CSV link</span>
                    <Input
                      value={newSource.csv_url}
                      onChange={(event) => setNewSource((previous) => ({ ...previous, csv_url: event.target.value }))}
                      placeholder="https://docs.google.com/spreadsheets/d/e/…/pub?output=csv"
                      className="text-xs"
                    />
                    <span className="mt-1 block text-[11px] leading-snug text-slate-500">
                      In the sheet: File → Share → Publish to web → choose the tab → Comma-separated
                      values (.csv) → Publish, then paste the link here. The sheet is read live, so
                      edits show up on the next calculation.
                    </span>
                  </label>

                  {/* Stated plainly because it is a property of Google's publish feature, the data is
                      employee performance, and the person configuring it is the only one who can
                      decide whether that is acceptable. */}
                  <p className="rounded-lg border border-amber-300 bg-amber-50 p-2 text-[11px] leading-snug text-amber-900">
                    Publishing makes the sheet readable by anyone who has the link, without signing
                    in. Only publish a sheet whose contents you are content to expose that way, and
                    keep the link private.
                  </p>

                  <div className="grid grid-cols-2 gap-2">
                    <label className="block">
                      <span className="mb-1 block text-xs font-medium text-slate-700">Employee code column</span>
                      <Input
                        value={newSource.employee_key_column}
                        onChange={(event) =>
                          setNewSource((previous) => ({ ...previous, employee_key_column: event.target.value }))
                        }
                        placeholder="Employee Code"
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-xs font-medium text-slate-700">Date column</span>
                      <Input
                        value={newSource.date_column}
                        onChange={(event) => setNewSource((previous) => ({ ...previous, date_column: event.target.value }))}
                        placeholder="Audit Date"
                      />
                    </label>
                  </div>
                  <span className="block text-[11px] leading-snug text-slate-500">
                    These are the column HEADINGS as typed in the sheet. Capitalisation and spacing do
                    not matter.
                  </span>
                </>
              )}

              {newSource.source_type !== "manual" &&
                newSource.source_type !== "upload" &&
                newSource.source_type !== "google_sheet_csv" && (
                <>
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium text-slate-700">Table</span>
                    <Input
                      value={newSource.source_object}
                      onChange={(event) => setNewSource((previous) => ({ ...previous, source_object: event.target.value }))}
                      placeholder="e.g. attendance_daily_record"
                      className="font-mono text-xs"
                    />
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="block">
                      <span className="mb-1 block text-xs font-medium text-slate-700">Employee column</span>
                      <Input
                        value={newSource.employee_key_column}
                        onChange={(event) =>
                          setNewSource((previous) => ({ ...previous, employee_key_column: event.target.value }))
                        }
                        placeholder="employee_id"
                        className="font-mono text-xs"
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-xs font-medium text-slate-700">Holds</span>
                      <select
                        value={newSource.employee_key_kind}
                        onChange={(event) =>
                          setNewSource((previous) => ({ ...previous, employee_key_kind: event.target.value }))
                        }
                        className="w-full cursor-pointer rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
                      >
                        <option value="employee_code">Employee code</option>
                        <option value="employee_id">This system's ID</option>
                      </select>
                    </label>
                  </div>
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium text-slate-700">Date column</span>
                    <Input
                      value={newSource.date_column}
                      onChange={(event) => setNewSource((previous) => ({ ...previous, date_column: event.target.value }))}
                      placeholder="e.g. call_date"
                      className="font-mono text-xs"
                    />
                  </label>
                </>
              )}

              <Button
                size="sm"
                onClick={handleCreateSource}
                disabled={!newSource.source_name.trim() || saveSource.isPending}
                className="w-full"
              >
                {saveSource.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-1.5 h-3.5 w-3.5" />}
                Create
              </Button>
            </div>
          )}

          <div className="space-y-1">
            {(sources.data ?? []).map((source) => (
              <button
                key={source.id}
                type="button"
                onClick={() => setSelectedId(source.id)}
                className={`flex w-full cursor-pointer items-start justify-between gap-2 rounded-lg border px-3 py-2 text-left transition-colors ${
                  selectedId === source.id
                    ? "border-indigo-500 bg-indigo-50"
                    : "border-slate-200 bg-white hover:border-slate-300"
                }`}
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-slate-900">{source.source_name}</span>
                  <span className="block text-[11px] text-slate-400">
                    {SOURCE_TYPE_LABEL[source.source_type] ?? source.source_type}
                  </span>
                </span>
                <span
                  className={`shrink-0 rounded-full px-1.5 py-0.5 text-[11px] ${
                    source.field_count > 0 ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
                  }`}
                >
                  {source.field_count} field{source.field_count === 1 ? "" : "s"}
                </span>
              </button>
            ))}
            {sources.isLoading && (
              <p className="flex items-center gap-2 p-3 text-xs text-slate-500">
                <Loader2 className="h-3 w-3 animate-spin" /> Loading…
              </p>
            )}
          </div>
        </div>

        {/* ── Field editor ── */}
        <div>
          {!selectedId ? (
            <div className="rounded-xl border border-dashed border-slate-200 p-10 text-center">
              <Database className="mx-auto mb-2 h-8 w-8 text-slate-300" />
              <p className="text-sm font-medium text-slate-600">Pick a data source</p>
              <p className="mt-1 text-sm text-slate-500">
                Its fields are what a calculation can read. Nothing else needs configuring.
              </p>
            </div>
          ) : detail.isLoading ? (
            <p className="flex items-center gap-2 p-6 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </p>
          ) : detail.data ? (
            <FieldEditor source={detail.data} />
          ) : null}
        </div>
      </div>
    </div>
  );
}

function FieldEditor({ source }: { source: DataSourceSummary & { fields: Array<any> } }) {
  const columns = useSourceColumns(
    source.source_type === "manual" || source.source_type === "upload" ? null : source.id,
  );
  const saveField = useSaveSourceField();
  const deleteField = useDeleteSourceField();
  const [error, setError] = useState<string | null>(null);

  const [draft, setDraft] = useState({ field_name: "", display_name: "", source_column: "", aggregate_fn: "SUM", unit: "" });

  const numericColumns = useMemo(() => (columns.data ?? []).filter((column) => column.is_numeric), [columns.data]);
  const isFileBacked = source.source_type === "manual" || source.source_type === "upload";

  async function handleAddField() {
    setError(null);
    try {
      await saveField.mutateAsync({
        dataSourceId: source.id,
        field_name: draft.field_name,
        display_name: draft.display_name || null,
        // A file-backed source has no column to aggregate: the field name IS the column in the
        // uploaded sheet, and the value is stored per employee per day already.
        source_column: isFileBacked ? null : draft.source_column || null,
        aggregate_fn: isFileBacked ? "NONE" : draft.aggregate_fn,
        unit: draft.unit || null,
      });
      setDraft({ field_name: "", display_name: "", source_column: "", aggregate_fn: "SUM", unit: "" });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not add the field");
    }
  }

  return (
    <div className="space-y-4">
      <header>
        <h3 className="text-base font-semibold text-slate-900">{source.source_name}</h3>
        <p className="mt-0.5 text-xs text-slate-500">
          {SOURCE_TYPE_LABEL[source.source_type] ?? source.source_type}
          {source.source_object ? ` · ${source.source_object}` : ""}
          {source.integration_key ? ` · ${source.integration_key}` : ""}
        </p>
      </header>

      {/* Existing fields */}
      {source.fields.length > 0 ? (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2 font-semibold">Field name</th>
                <th className="px-3 py-2 font-semibold">Reads</th>
                <th className="px-3 py-2 font-semibold">Unit</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {source.fields.map((field) => (
                <tr key={field.id}>
                  <td className="px-3 py-2">
                    <code className="font-mono text-xs font-semibold text-indigo-700">{field.field_name}</code>
                    {field.display_name && <span className="block text-[11px] text-slate-400">{field.display_name}</span>}
                  </td>
                  <td className="px-3 py-2 font-mono text-[11px] text-slate-600">
                    {field.source_expression ?? (isFileBacked ? "uploaded value" : "—")}
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-500">{field.unit ?? "—"}</td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => void deleteField.mutateAsync({ fieldId: field.id, dataSourceId: source.id })}
                      className="cursor-pointer text-slate-400 transition-colors hover:text-rose-600"
                      title="Remove this field"
                      aria-label={`Remove ${field.field_name}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="rounded-xl border border-dashed border-amber-300 bg-amber-50 p-3 text-xs text-amber-800">
          No fields yet. A calculation can only read fields declared here, so add at least one.
        </p>
      )}

      {/* Add a field */}
      <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
        <p className="text-sm font-medium text-slate-700">Add a field</p>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-700">Name used in formulas</span>
            <Input
              value={draft.field_name}
              onChange={(event) =>
                // Normalised as it is typed rather than rejected on save: the constraint (a legal
                // identifier) is the engine's, and silently making the input satisfy it is kinder
                // than a validation error about characters the user cannot see the point of.
                setDraft((previous) => ({
                  ...previous,
                  field_name: event.target.value.replace(/[^A-Za-z0-9_]/g, "_").toLowerCase(),
                }))
              }
              placeholder="talk_seconds"
              className="font-mono text-xs"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-700">Label (optional)</span>
            <Input
              value={draft.display_name}
              onChange={(event) => setDraft((previous) => ({ ...previous, display_name: event.target.value }))}
              placeholder="Talk time in seconds"
            />
          </label>

          {!isFileBacked && (
            <>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-700">Column in the source</span>
                {numericColumns.length > 0 ? (
                  <select
                    value={draft.source_column}
                    onChange={(event) => setDraft((previous) => ({ ...previous, source_column: event.target.value }))}
                    className="w-full cursor-pointer rounded-lg border border-slate-300 px-2.5 py-1.5 font-mono text-xs"
                  >
                    <option value="">Choose a column…</option>
                    {numericColumns.map((column) => (
                      <option key={column.column_name} value={column.column_name}>
                        {column.column_name} ({column.data_type})
                      </option>
                    ))}
                  </select>
                ) : (
                  <>
                    <Input
                      value={draft.source_column}
                      onChange={(event) => setDraft((previous) => ({ ...previous, source_column: event.target.value }))}
                      placeholder="talk_sec"
                      className="font-mono text-xs"
                    />
                    <span className="mt-1 block text-[11px] text-slate-500">
                      {columns.isLoading
                        ? "Reading the table…"
                        : "Could not read the table's columns, so type the name. Check the table and connector if this is unexpected."}
                    </span>
                  </>
                )}
              </label>

              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-700">Combine each day by</span>
                <select
                  value={draft.aggregate_fn}
                  onChange={(event) => setDraft((previous) => ({ ...previous, aggregate_fn: event.target.value }))}
                  className="w-full cursor-pointer rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm"
                >
                  {AGGREGATES.map((aggregate) => (
                    <option key={aggregate} value={aggregate}>
                      {aggregate === "NONE" ? "Take the value as-is" : aggregate}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-700">Unit (optional)</span>
            <Input
              value={draft.unit}
              onChange={(event) => setDraft((previous) => ({ ...previous, unit: event.target.value }))}
              placeholder="seconds"
            />
          </label>
        </div>

        {error && <p className="text-xs text-rose-700">{error}</p>}

        <Button size="sm" onClick={handleAddField} disabled={!draft.field_name.trim() || saveField.isPending}>
          {saveField.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Plus className="mr-1.5 h-3.5 w-3.5" />}
          Add field
        </Button>
      </div>

      {isFileBacked && source.fields.length > 0 && <UploadPanel source={source} />}
    </div>
  );
}

/**
 * Spreadsheet upload: preview, confirm the mapping, then commit.
 *
 * Three deliberate steps. Auto-mapping and committing in one action is how a column lands in the
 * wrong field and nobody finds out until a rating is wrong, so the suggested mapping is always
 * shown for confirmation, and the dry run reports exactly what would be accepted and rejected using
 * the same code path the commit uses.
 */
function UploadPanel({ source }: { source: DataSourceSummary & { fields: Array<any> } }) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<UploadPreview | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [employeeColumn, setEmployeeColumn] = useState("");
  const [dateColumn, setDateColumn] = useState("");
  const [result, setResult] = useState<{ dry: boolean; accepted: number; rejected: number; rejections: Array<{ rowNumber: number; reason: string }> } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const previewUpload = useUploadPreview();
  const commitUpload = useUploadCommit();

  async function handleFile(selected: File) {
    setError(null);
    setResult(null);
    setFile(selected);
    try {
      const parsed = await previewUpload.mutateAsync({ file: selected, dataSourceId: source.id });
      setPreview(parsed);
      setMapping(
        Object.fromEntries(
          Object.entries(parsed.suggested_mapping).filter(([, header]) => Boolean(header)) as Array<[string, string]>,
        ),
      );
      // Guessed from the headers so the common case needs no input, but both remain editable
      // because the guess is a heuristic and being wrong here misfiles every row.
      setEmployeeColumn(
        parsed.headers.find((header) => /emp.*code|agent|user/i.test(header)) ?? parsed.headers[0] ?? "",
      );
      setDateColumn(parsed.headers.find((header) => /date|day/i.test(header)) ?? "");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not read that file");
    }
  }

  async function run(dryRun: boolean) {
    if (!file) return;
    setError(null);
    try {
      const committed = await commitUpload.mutateAsync({
        file,
        dataSourceId: source.id,
        employeeColumn,
        dateColumn,
        columnMapping: mapping,
        dryRun,
      });
      setResult({
        dry: dryRun,
        accepted: committed.accepted_rows,
        rejected: committed.rejected_rows,
        rejections: committed.rejections,
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Upload failed");
    }
  }

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-3">
      <p className="flex items-center gap-2 text-sm font-medium text-slate-700">
        <FileSpreadsheet className="h-4 w-4 text-indigo-600" />
        Load figures from a spreadsheet
      </p>
      <p className="text-xs text-slate-500">
        CSV or Excel. A Google Sheet works too — use File → Download → CSV, then upload it here.
      </p>

      <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-slate-300 p-3 text-sm text-slate-600 transition-colors hover:border-indigo-400 hover:bg-indigo-50/40">
        <Upload className="h-4 w-4" />
        {file ? file.name : "Choose a file"}
        <input
          type="file"
          accept=".csv,.xlsx,.xls"
          className="hidden"
          onChange={(event) => {
            const selected = event.target.files?.[0];
            if (selected) void handleFile(selected);
          }}
        />
      </label>

      {previewUpload.isPending && (
        <p className="flex items-center gap-2 text-xs text-slate-500">
          <Loader2 className="h-3 w-3 animate-spin" /> Reading the file…
        </p>
      )}

      {preview && (
        <div className="space-y-3 border-t border-slate-200 pt-3">
          <p className="text-xs text-slate-600">
            {preview.row_count} row{preview.row_count === 1 ? "" : "s"} found. Confirm which column is which.
          </p>

          <div className="grid gap-2 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-700">Employee code is in</span>
              <select
                value={employeeColumn}
                onChange={(event) => setEmployeeColumn(event.target.value)}
                className="w-full cursor-pointer rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
              >
                <option value="">Choose…</option>
                {preview.headers.map((header) => (
                  <option key={header} value={header}>
                    {header}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-700">Date is in</span>
              <select
                value={dateColumn}
                onChange={(event) => setDateColumn(event.target.value)}
                className="w-full cursor-pointer rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
              >
                <option value="">Choose…</option>
                {preview.headers.map((header) => (
                  <option key={header} value={header}>
                    {header}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div>
            <p className="mb-1.5 text-xs font-medium text-slate-700">Which column feeds which field</p>
            <div className="space-y-1.5">
              {preview.fields.map((fieldName) => (
                <div key={fieldName} className="flex items-center gap-2">
                  <code className="w-40 shrink-0 truncate font-mono text-[11px] text-indigo-700">{fieldName}</code>
                  <select
                    value={mapping[fieldName] ?? ""}
                    onChange={(event) =>
                      setMapping((previous) => {
                        const next = { ...previous };
                        if (event.target.value) next[fieldName] = event.target.value;
                        else delete next[fieldName];
                        return next;
                      })
                    }
                    className="flex-1 cursor-pointer rounded-lg border border-slate-300 px-2 py-1 text-xs"
                  >
                    <option value="">Not in this file</option>
                    {preview.headers.map((header) => (
                      <option key={header} value={header}>
                        {header}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => void run(true)}
              disabled={!employeeColumn || !dateColumn || !Object.keys(mapping).length || commitUpload.isPending}
            >
              Check it first
            </Button>
            <Button
              size="sm"
              onClick={() => void run(false)}
              disabled={!employeeColumn || !dateColumn || !Object.keys(mapping).length || commitUpload.isPending}
            >
              {commitUpload.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-1.5 h-3.5 w-3.5" />}
              Load the figures
            </Button>
          </div>
        </div>
      )}

      {error && <p className="text-xs text-rose-700">{error}</p>}

      {result && (
        <div className="space-y-2 border-t border-slate-200 pt-3">
          <p className="text-xs">
            <span className="font-medium text-emerald-700">{result.accepted}</span> day
            {result.accepted === 1 ? "" : "s"} of figures {result.dry ? "would be loaded" : "loaded"}
            {result.rejected > 0 && (
              <>
                , <span className="font-medium text-rose-700">{result.rejected}</span> row
                {result.rejected === 1 ? "" : "s"} skipped
              </>
            )}
            .
          </p>
          {result.rejections.length > 0 && (
            <ul className="max-h-32 space-y-0.5 overflow-y-auto">
              {result.rejections.slice(0, 20).map((rejection) => (
                <li key={`${rejection.rowNumber}-${rejection.reason}`} className="flex items-start gap-1.5 text-[11px] text-slate-600">
                  <X className="mt-0.5 h-3 w-3 shrink-0 text-rose-400" />
                  Row {rejection.rowNumber}: {rejection.reason}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
