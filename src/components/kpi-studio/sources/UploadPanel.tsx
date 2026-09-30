import { useState } from "react";
import { Check, FileSpreadsheet, Loader2, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useUploadCommit, useUploadPreview, type DataSourceDetail, type UploadPreview } from "@/hooks/useKpiStudio";
import { selectClass } from "./form-bits";

/**
 * Spreadsheet upload: preview, confirm the mapping, then commit.
 *
 * Three deliberate steps. Auto-mapping and committing in one action is how a column lands in the
 * wrong field and nobody finds out until a rating is wrong, so the suggested mapping is always
 * shown for confirmation, and the dry run reports exactly what would be accepted and rejected using
 * the same code path the commit uses.
 */
export function UploadPanel({ source }: { source: DataSourceDetail }) {
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
        CSV or Excel. Pick the file, confirm which column is which, check it, then load it.
      </p>

      <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-slate-300 p-3 text-sm text-slate-600 transition-colors focus-within:ring-2 focus-within:ring-indigo-500 hover:border-indigo-400 hover:bg-indigo-50/40">
        <Upload className="h-4 w-4" />
        {file ? file.name : "Choose a file"}
        <input
          type="file"
          accept=".csv,.xlsx,.xls"
          className="sr-only"
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
            <label className="block" htmlFor="upload-employee-column">
              <span className="mb-1 block text-xs font-medium text-slate-700">Employee code is in</span>
              <select
                id="upload-employee-column"
                value={employeeColumn}
                onChange={(event) => setEmployeeColumn(event.target.value)}
                className={selectClass}
              >
                <option value="">Choose…</option>
                {preview.headers.map((header) => (
                  <option key={header} value={header}>
                    {header}
                  </option>
                ))}
              </select>
            </label>
            <label className="block" htmlFor="upload-date-column">
              <span className="mb-1 block text-xs font-medium text-slate-700">Date is in</span>
              <select
                id="upload-date-column"
                value={dateColumn}
                onChange={(event) => setDateColumn(event.target.value)}
                className={selectClass}
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
                  <label htmlFor={`upload-map-${fieldName}`} className="w-28 shrink-0 truncate font-mono text-[11px] text-indigo-700 sm:w-40">
                    {fieldName}
                  </label>
                  <select
                    id={`upload-map-${fieldName}`}
                    value={mapping[fieldName] ?? ""}
                    onChange={(event) =>
                      setMapping((previous) => {
                        const next = { ...previous };
                        if (event.target.value) next[fieldName] = event.target.value;
                        else delete next[fieldName];
                        return next;
                      })
                    }
                    className={`${selectClass} min-w-0 flex-1`}
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
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void run(true)}
              disabled={!employeeColumn || !dateColumn || !Object.keys(mapping).length || commitUpload.isPending}
            >
              Check it first
            </Button>
            <Button
              type="button"
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

      {error && <p role="alert" className="text-xs text-rose-700">{error}</p>}

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
