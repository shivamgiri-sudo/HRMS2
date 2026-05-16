import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { DashboardLayout } from "@/components/layout/DashboardLayout";

type UploadTemplate = {
  id: string;
  upload_type_code: string;
  upload_type_name: string;
  target_table: string | null;
  description: string | null;
  required_columns: string[];
  optional_columns: string[];
  sample_row: Record<string, unknown>;
  validation_rules: Record<string, unknown>;
  active_status: boolean;
  created_at: string;
  updated_at: string;
};

type UploadBatch = {
  id: string;
  upload_batch_no: string;
  upload_type_code: string;
  original_file_name: string;
  file_path: string | null;
  file_size_bytes: number | null;
  total_rows: number;
  valid_rows: number;
  error_rows: number;
  imported_rows: number;
  batch_status: string;
  uploaded_by: string | null;
  validated_by: string | null;
  imported_by: string | null;
  uploaded_at: string;
  validated_at: string | null;
  imported_at: string | null;
  error_summary: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

type UploadBatchRow = {
  id: string;
  upload_batch_id: string;
  row_no: number;
  raw_data: Record<string, unknown>;
  normalized_data: Record<string, unknown>;
  row_status: string;
  error_messages: string[];
  target_record_id: string | null;
  created_at: string;
  updated_at: string;
};

type CsvRow = Record<string, string>;

const db = supabase as any;
const BULK_UPLOAD_BUCKET = "hrms-bulk-uploads";

const statusClass: Record<string, string> = {
  uploaded: "bg-slate-100 text-slate-700 border-slate-200",
  validating: "bg-sky-50 text-sky-700 border-sky-200",
  validated: "bg-emerald-50 text-emerald-700 border-emerald-200",
  validation_failed: "bg-amber-50 text-amber-700 border-amber-200",
  importing: "bg-indigo-50 text-indigo-700 border-indigo-200",
  imported: "bg-emerald-50 text-emerald-700 border-emerald-200",
  imported_with_errors: "bg-amber-50 text-amber-700 border-amber-200",
  failed: "bg-rose-50 text-rose-700 border-rose-200",
  cancelled: "bg-slate-100 text-slate-500 border-slate-200",
};

const rowStatusClass: Record<string, string> = {
  pending: "bg-slate-100 text-slate-700 border-slate-200",
  valid: "bg-emerald-50 text-emerald-700 border-emerald-200",
  error: "bg-rose-50 text-rose-700 border-rose-200",
  imported: "bg-indigo-50 text-indigo-700 border-indigo-200",
  skipped: "bg-slate-100 text-slate-500 border-slate-200",
};

function normalizeHeader(value: string) {
  return value.trim().replace(/^\uFEFF/, "");
}

function parseCsv(text: string): CsvRow[] {
  const lines = text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .filter((line) => line.trim().length > 0);

  if (lines.length < 2) return [];

  const headers = splitCsvLine(lines[0]).map(normalizeHeader);

  return lines.slice(1).map((line) => {
    const values = splitCsvLine(line);
    const row: CsvRow = {};

    headers.forEach((header, index) => {
      row[header] = values[index]?.trim() || "";
    });

    return row;
  });
}

function splitCsvLine(line: string) {
  const result: string[] = [];
  let current = "";
  let insideQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const nextChar = line[index + 1];

    if (char === '"' && nextChar === '"') {
      current += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      insideQuotes = !insideQuotes;
      continue;
    }

    if (char === "," && !insideQuotes) {
      result.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  result.push(current);
  return result;
}

function toCsvValue(value: unknown) {
  const text = String(value ?? "");
  if (text.includes(",") || text.includes('"') || text.includes("\n")) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function downloadTextFile(fileName: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);

  URL.revokeObjectURL(url);
}

function formatBytes(bytes?: number | null) {
  if (!bytes) return "-";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDateTime(value?: string | null) {
  if (!value) return "-";

  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export default function BulkUploadHub() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [templates, setTemplates] = useState<UploadTemplate[]>([]);
  const [batches, setBatches] = useState<UploadBatch[]>([]);
  const [selectedTemplateCode, setSelectedTemplateCode] = useState("");
  const [selectedBatch, setSelectedBatch] = useState<UploadBatch | null>(null);
  const [selectedBatchRows, setSelectedBatchRows] = useState<UploadBatchRow[]>(
    []
  );

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewRows, setPreviewRows] = useState<CsvRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const selectedTemplate = useMemo(
    () =>
      templates.find(
        (template) => template.upload_type_code === selectedTemplateCode
      ) || null,
    [templates, selectedTemplateCode]
  );

  const stats = useMemo(() => {
    return {
      templates: templates.length,
      batches: batches.length,
      validated: batches.filter((batch) => batch.batch_status === "validated")
        .length,
      imported: batches.filter((batch) =>
        ["imported", "imported_with_errors"].includes(batch.batch_status)
      ).length,
      errors: batches.reduce((total, batch) => total + batch.error_rows, 0),
    };
  }, [templates, batches]);

  async function loadData() {
    setIsLoading(true);
    setErrorMessage(null);

    const [templatesResult, batchesResult] = await Promise.all([
      db
        .from("upload_template_master")
        .select("*")
        .eq("active_status", true)
        .order("upload_type_code", { ascending: true }),
      db
        .from("upload_batch")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(25),
    ]);

    if (templatesResult.error) {
      setErrorMessage(templatesResult.error.message);
      setIsLoading(false);
      return;
    }

    if (batchesResult.error) {
      setErrorMessage(batchesResult.error.message);
      setIsLoading(false);
      return;
    }

    const loadedTemplates = (templatesResult.data || []) as UploadTemplate[];
    setTemplates(loadedTemplates);
    setBatches((batchesResult.data || []) as UploadBatch[]);

    if (!selectedTemplateCode && loadedTemplates.length > 0) {
      setSelectedTemplateCode(loadedTemplates[0].upload_type_code);
    }

    setIsLoading(false);
  }

  async function loadBatchRows(batch: UploadBatch) {
    setSelectedBatch(batch);
    setSelectedBatchRows([]);

    const { data, error } = await db
      .from("upload_batch_row")
      .select("*")
      .eq("upload_batch_id", batch.id)
      .order("row_no", { ascending: true });

    if (error) {
      setErrorMessage(error.message);
      return;
    }

    setSelectedBatchRows((data || []) as UploadBatchRow[]);
  }

  useEffect(() => {
    loadData();
  }, []);

  async function handleFileChange(file: File | null) {
    setSelectedFile(file);
    setPreviewRows([]);
    setMessage(null);
    setErrorMessage(null);

    if (!file) return;

    if (file.name.toLowerCase().endsWith(".csv")) {
      const text = await file.text();
      const rows = parseCsv(text);
      setPreviewRows(rows.slice(0, 10));
      return;
    }

    setMessage(
      "Excel file selected. File can be uploaded and tracked. Row preview is available for CSV files only in this handover build."
    );
  }

  function downloadTemplate(template: UploadTemplate) {
    const requiredColumns = template.required_columns || [];
    const optionalColumns = template.optional_columns || [];
    const headers = [...requiredColumns, ...optionalColumns];
    const sample = template.sample_row || {};

    const csv = [
      headers.join(","),
      headers.map((header) => toCsvValue(sample[header] || "")).join(","),
    ].join("\n");

    downloadTextFile(
      `${template.upload_type_code.toLowerCase()}_template.csv`,
      csv,
      "text/csv;charset=utf-8"
    );
  }

  function validateRows(template: UploadTemplate, rows: CsvRow[]) {
    const requiredColumns = template.required_columns || [];
    const allowedColumns = new Set([
      ...(template.required_columns || []),
      ...(template.optional_columns || []),
    ]);

    return rows.map((row, index) => {
      const errors: string[] = [];

      requiredColumns.forEach((column) => {
        const value = row[column];

        if (value === undefined || value === null || String(value).trim() === "") {
          errors.push(`${column} is required`);
        }
      });

      Object.keys(row).forEach((column) => {
        if (column && !allowedColumns.has(column)) {
          errors.push(`Unknown column: ${column}`);
        }
      });

      return {
        rowNo: index + 1,
        rawData: row,
        normalizedData: row,
        status: errors.length > 0 ? "error" : "valid",
        errors,
      };
    });
  }

  async function createUploadBatch() {
    setMessage(null);
    setErrorMessage(null);

    if (!selectedTemplate) {
      setErrorMessage("Please select an upload template.");
      return;
    }

    if (!selectedFile) {
      setErrorMessage("Please select a CSV or Excel file.");
      return;
    }

    setIsProcessing(true);

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      const { data: batchNo, error: batchNoError } = await db.rpc(
        "generate_upload_batch_no"
      );

      if (batchNoError) throw new Error(batchNoError.message);

      const safeFileName = `${Date.now()}-${selectedFile.name.replace(
        /[^a-zA-Z0-9._-]/g,
        "_"
      )}`;
      const filePath = `${selectedTemplate.upload_type_code}/${safeFileName}`;

      const { error: uploadError } = await supabase.storage
        .from(BULK_UPLOAD_BUCKET)
        .upload(filePath, selectedFile, {
          cacheControl: "3600",
          upsert: false,
        });

      if (uploadError) throw new Error(uploadError.message);

      let parsedRows: CsvRow[] = [];
      let stagedRows: ReturnType<typeof validateRows> = [];

      if (selectedFile.name.toLowerCase().endsWith(".csv")) {
        const text = await selectedFile.text();
        parsedRows = parseCsv(text);
        stagedRows = validateRows(selectedTemplate, parsedRows);
      }

      const validRows = stagedRows.filter((row) => row.status === "valid").length;
      const errorRows = stagedRows.filter((row) => row.status === "error").length;

      const batchStatus =
        stagedRows.length === 0
          ? "uploaded"
          : errorRows > 0
            ? "validation_failed"
            : "validated";

      const { data: batch, error: batchError } = await db
        .from("upload_batch")
        .insert({
          upload_batch_no: batchNo,
          upload_type_code: selectedTemplate.upload_type_code,
          original_file_name: selectedFile.name,
          file_path: filePath,
          file_size_bytes: selectedFile.size,
          total_rows: stagedRows.length,
          valid_rows: validRows,
          error_rows: errorRows,
          imported_rows: 0,
          batch_status: batchStatus,
          uploaded_by: user?.id || null,
          validated_by: stagedRows.length > 0 ? user?.id || null : null,
          validated_at: stagedRows.length > 0 ? new Date().toISOString() : null,
          error_summary:
            errorRows > 0 ? `${errorRows} row(s) have validation errors` : null,
          metadata: {
            source: "frontend_bulk_upload_hub",
            csv_preview_available: selectedFile.name
              .toLowerCase()
              .endsWith(".csv"),
          },
        })
        .select("*")
        .single();

      if (batchError) throw new Error(batchError.message);

      if (stagedRows.length > 0) {
        const { error: rowError } = await db.from("upload_batch_row").insert(
          stagedRows.map((row) => ({
            upload_batch_id: batch.id,
            row_no: row.rowNo,
            raw_data: row.rawData,
            normalized_data: row.normalizedData,
            row_status: row.status,
            error_messages: row.errors,
          }))
        );

        if (rowError) throw new Error(rowError.message);
      }

      setMessage("Upload batch created successfully.");
      setSelectedFile(null);
      setPreviewRows([]);

      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }

      await loadData();
      await loadBatchRows(batch as UploadBatch);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Upload failed.");
    } finally {
      setIsProcessing(false);
    }
  }

  async function importBatchToTarget(batch: UploadBatch) {
    setMessage(null);
    setErrorMessage(null);
    setIsProcessing(true);

    try {
      if (batch.upload_type_code !== "EMPLOYEE_MASTER") {
        throw new Error(
          `Import mapping for ${batch.upload_type_code} is not enabled yet. This upload can be staged and validated, but only Employee Master import is production-enabled in this fix.`
        );
      }

      const { data, error } = await db.rpc("import_upload_batch", {
        p_batch_id: batch.id,
      });

      if (error) throw new Error(error.message);

      const result = data || {};
      if (result.ok === false) {
        throw new Error(result.message || "Import action failed.");
      }

      setMessage(
        `Import completed. Imported ${result.importedRows || 0} row(s). ${
          result.errorRows ? `${result.errorRows} row(s) failed and are visible in View Rows.` : ""
        }`
      );

      await loadData();
      await loadBatchRows(batch);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Import action failed."
      );
    } finally {
      setIsProcessing(false);
    }
  }

  return (
    <DashboardLayout>
      <div className="min-h-screen bg-slate-50 p-4 sm:p-6">
        <div className="mx-auto max-w-7xl space-y-5">
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
                  Admin Operations
                </p>
                <h1 className="mt-2 text-2xl font-semibold text-slate-950">
                  Bulk Upload Hub
                </h1>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
                  Manage upload templates, upload CSV/Excel files, stage rows,
                  validate required columns, and import validated Employee Master rows directly into HRMS.
                </p>
              </div>

              <button
                onClick={loadData}
                className="h-10 rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
              >
                Refresh
              </button>
            </div>
          </section>

          {(message || errorMessage) && (
            <div
              className={`rounded-2xl border p-4 text-sm ${
                errorMessage
                  ? "border-rose-200 bg-rose-50 text-rose-700"
                  : "border-emerald-200 bg-emerald-50 text-emerald-700"
              }`}
            >
              {errorMessage || message}
            </div>
          )}

          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <StatCard label="Templates" value={stats.templates} />
            <StatCard label="Upload Batches" value={stats.batches} />
            <StatCard label="Validated" value={stats.validated} />
            <StatCard label="Imported" value={stats.imported} />
            <StatCard label="Error Rows" value={stats.errors} />
          </section>

          <section className="grid gap-5 xl:grid-cols-[1.05fr_0.95fr]">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-base font-semibold text-slate-950">
                New Upload
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                Choose upload type, download sample template, then upload a CSV
                or Excel file.
              </p>

              <div className="mt-5 space-y-4">
                <Field label="Upload Type">
                  <select
                    value={selectedTemplateCode}
                    onChange={(event) =>
                      setSelectedTemplateCode(event.target.value)
                    }
                    className="h-10 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-slate-400"
                  >
                    {templates.map((template) => (
                      <option
                        key={template.id}
                        value={template.upload_type_code}
                      >
                        {template.upload_type_name}
                      </option>
                    ))}
                  </select>
                </Field>

                {selectedTemplate && (
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <p className="text-sm font-semibold text-slate-950">
                          {selectedTemplate.upload_type_code}
                        </p>
                        <p className="mt-1 text-xs leading-5 text-slate-500">
                          {selectedTemplate.description || "-"}
                        </p>
                        <p className="mt-2 text-xs text-slate-500">
                          Target table:{" "}
                          <span className="font-semibold text-slate-800">
                            {selectedTemplate.target_table || "-"}
                          </span>
                        </p>
                      </div>

                      <button
                        onClick={() => downloadTemplate(selectedTemplate)}
                        className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
                      >
                        Download Template
                      </button>
                    </div>

                    <div className="mt-4 grid gap-3 lg:grid-cols-2">
                      <ColumnList
                        title="Required Columns"
                        columns={selectedTemplate.required_columns || []}
                      />
                      <ColumnList
                        title="Optional Columns"
                        columns={selectedTemplate.optional_columns || []}
                      />
                    </div>
                  </div>
                )}

                <Field label="Upload File">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv,.xls,.xlsx,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                    onChange={(event) =>
                      handleFileChange(event.target.files?.[0] || null)
                    }
                    className="block w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 file:mr-4 file:rounded-lg file:border-0 file:bg-slate-950 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white hover:file:bg-slate-800"
                  />
                </Field>

                {selectedFile && (
                  <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm">
                    <p className="font-semibold text-slate-950">
                      Selected File
                    </p>
                    <div className="mt-2 grid gap-2 text-slate-600 sm:grid-cols-3">
                      <span>Name: {selectedFile.name}</span>
                      <span>Size: {formatBytes(selectedFile.size)}</span>
                      <span>Type: {selectedFile.type || "Unknown"}</span>
                    </div>
                  </div>
                )}

                {previewRows.length > 0 && (
                  <div className="rounded-2xl border border-slate-200 bg-white p-4">
                    <p className="text-sm font-semibold text-slate-950">
                      CSV Preview
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      Showing first {previewRows.length} row(s). Full staging
                      happens after creating upload batch.
                    </p>

                    <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200">
                      <table className="min-w-full divide-y divide-slate-200 text-xs">
                        <thead className="bg-slate-50">
                          <tr>
                            {Object.keys(previewRows[0] || {}).map((key) => (
                              <th
                                key={key}
                                className="whitespace-nowrap px-3 py-2 text-left font-semibold text-slate-500"
                              >
                                {key}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {previewRows.map((row, index) => (
                            <tr key={index}>
                              {Object.keys(previewRows[0] || {}).map((key) => (
                                <td
                                  key={key}
                                  className="whitespace-nowrap px-3 py-2 text-slate-600"
                                >
                                  {row[key] || "-"}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                <div className="flex justify-end">
                  <button
                    onClick={createUploadBatch}
                    disabled={isProcessing}
                    className="h-10 rounded-xl bg-slate-950 px-5 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isProcessing ? "Processing..." : "Create Upload Batch"}
                  </button>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-base font-semibold text-slate-950">
                Upload Templates
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                Templates define required columns, optional columns and sample
                format.
              </p>

              <div className="mt-5 max-h-[610px] space-y-3 overflow-y-auto pr-1">
                {templates.map((template) => (
                  <button
                    key={template.id}
                    onClick={() =>
                      setSelectedTemplateCode(template.upload_type_code)
                    }
                    className={`w-full rounded-2xl border p-4 text-left transition ${
                      selectedTemplateCode === template.upload_type_code
                        ? "border-slate-950 bg-slate-50"
                        : "border-slate-200 bg-white hover:bg-slate-50"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-slate-950">
                          {template.upload_type_name}
                        </p>
                        <p className="mt-1 text-xs font-medium text-slate-400">
                          {template.upload_type_code}
                        </p>
                      </div>

                      <StatusBadge status={template.active_status ? "active" : "inactive"} />
                    </div>

                    <p className="mt-2 line-clamp-2 text-xs leading-5 text-slate-500">
                      {template.description || "-"}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="text-base font-semibold text-slate-950">
                  Upload Batch History
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Track uploaded files, validation status, staged rows and import
                  status.
                </p>
              </div>
            </div>

            <div className="mt-5 overflow-hidden rounded-2xl border border-slate-200">
              {isLoading ? (
                <div className="p-6 text-sm text-slate-500">
                  Loading upload batches...
                </div>
              ) : batches.length === 0 ? (
                <div className="p-8 text-center text-sm text-slate-500">
                  No upload batches found.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-slate-200 text-sm">
                    <thead className="bg-slate-50">
                      <tr>
                        <Th>Batch No</Th>
                        <Th>Upload Type</Th>
                        <Th>File</Th>
                        <Th>Rows</Th>
                        <Th>Status</Th>
                        <Th>Uploaded</Th>
                        <Th>Actions</Th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 bg-white">
                      {batches.map((batch) => (
                        <tr key={batch.id} className="hover:bg-slate-50">
                          <Td>
                            <div className="font-semibold text-slate-950">
                              {batch.upload_batch_no}
                            </div>
                            <div className="mt-0.5 text-xs text-slate-400">
                              {batch.id.slice(0, 8)}
                            </div>
                          </Td>
                          <Td>{batch.upload_type_code}</Td>
                          <Td>
                            <div className="max-w-[260px] truncate font-medium text-slate-800">
                              {batch.original_file_name}
                            </div>
                            <div className="text-xs text-slate-400">
                              {formatBytes(batch.file_size_bytes)}
                            </div>
                          </Td>
                          <Td>
                            <div>Total: {batch.total_rows}</div>
                            <div className="text-xs text-slate-400">
                              Valid {batch.valid_rows} / Error{" "}
                              {batch.error_rows} / Imported{" "}
                              {batch.imported_rows}
                            </div>
                          </Td>
                          <Td>
                            <StatusBadge status={batch.batch_status} />
                          </Td>
                          <Td>{formatDateTime(batch.uploaded_at)}</Td>
                          <Td>
                            <div className="flex flex-wrap gap-2">
                              <button
                                onClick={() => loadBatchRows(batch)}
                                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                              >
                                View Rows
                              </button>

                              {batch.valid_rows > batch.imported_rows && (
                                <button
                                  onClick={() => importBatchToTarget(batch)}
                                  disabled={isProcessing}
                                  className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-60"
                                >
                                  Import to HRMS
                                </button>
                              )}
                            </div>
                          </Td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </section>
        </div>

        {selectedBatch && (
          <BatchRowsDialog
            batch={selectedBatch}
            rows={selectedBatchRows}
            onClose={() => {
              setSelectedBatch(null);
              setSelectedBatchRows([]);
            }}
          />
        )}
      </div>
    </DashboardLayout>
  );
}

function BatchRowsDialog({
  batch,
  rows,
  onClose,
}: {
  batch: UploadBatch;
  rows: UploadBatchRow[];
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
      <div className="max-h-[90vh] w-full max-w-6xl overflow-y-auto rounded-2xl bg-white p-5 shadow-xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-400">
              Upload Batch Rows
            </p>
            <h3 className="mt-1 text-xl font-semibold text-slate-950">
              {batch.upload_batch_no}
            </h3>
            <p className="mt-1 text-sm text-slate-500">
              {batch.original_file_name}
            </p>
          </div>

          <button
            onClick={onClose}
            className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Close
          </button>
        </div>

        <div className="mt-5 overflow-hidden rounded-2xl border border-slate-200">
          {rows.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500">
              No staged rows found for this batch.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-xs">
                <thead className="bg-slate-50">
                  <tr>
                    <Th>Row No</Th>
                    <Th>Status</Th>
                    <Th>Raw Data</Th>
                    <Th>Errors</Th>
                    <Th>Created</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((row) => (
                    <tr key={row.id}>
                      <Td>{row.row_no}</Td>
                      <Td>
                        <StatusBadge status={row.row_status} small />
                      </Td>
                      <Td>
                        <pre className="max-w-xl whitespace-pre-wrap rounded-xl bg-slate-50 p-3 text-[11px] text-slate-700">
                          {JSON.stringify(row.raw_data, null, 2)}
                        </pre>
                      </Td>
                      <Td>
                        {row.error_messages?.length ? (
                          <ul className="list-disc pl-4 text-rose-600">
                            {row.error_messages.map((error, index) => (
                              <li key={index}>{error}</li>
                            ))}
                          </ul>
                        ) : (
                          "-"
                        )}
                      </Td>
                      <Td>{formatDateTime(row.created_at)}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-400">
        {label}
      </p>
      <p className="mt-2 text-2xl font-semibold text-slate-950">{value}</p>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold text-slate-600">
        {label}
      </span>
      {children}
    </label>
  );
}

function ColumnList({
  title,
  columns,
}: {
  title: string;
  columns: string[];
}) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-400">
        {title}
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {columns.length === 0 ? (
          <span className="text-xs text-slate-400">No columns defined.</span>
        ) : (
          columns.map((column) => (
            <span
              key={column}
              className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600"
            >
              {column}
            </span>
          ))
        )}
      </div>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
      {children}
    </th>
  );
}

function Td({ children }: { children: React.ReactNode }) {
  return <td className="whitespace-nowrap px-4 py-3 text-slate-600">{children}</td>;
}

function StatusBadge({
  status,
  small = false,
}: {
  status: string;
  small?: boolean;
}) {
  const label = status
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

  return (
    <span
      className={`inline-flex rounded-full border font-semibold ${
        small ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-1 text-xs"
      } ${
        statusClass[status] ||
        rowStatusClass[status] ||
        "bg-slate-100 text-slate-700 border-slate-200"
      }`}
    >
      {label}
    </span>
  );
}
