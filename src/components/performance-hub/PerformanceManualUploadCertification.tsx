import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileCheck2,
  RefreshCcw,
  ShieldCheck,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { hrmsApi } from "@/lib/hrmsApi";
import type { PerformanceContext } from "@/types/performanceHub";
import type {
  PaginatedPerformanceRuns,
  PerformanceDataset,
  PerformanceManualUploadPreflight,
  PerformanceManualUploadSchema,
  PerformanceRunCertification,
} from "@/types/performanceIngestion";

const allowedRoles = new Set([
  "super_admin",
  "admin",
  "hr",
  "process_manager",
  "qa_manager",
  "quality_lead",
]);

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function PerformanceManualUploadCertification({ context }: { context: PerformanceContext }) {
  const canView = allowedRoles.has(context.effectiveRole.toLowerCase());
  const [selectedId, setSelectedId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preflight, setPreflight] = useState<PerformanceManualUploadPreflight | null>(null);
  const [selectedRunId, setSelectedRunId] = useState("");

  const datasetsQuery = useQuery({
    queryKey: ["performance-hub", "ingestion", "manual-certification-datasets"],
    queryFn: async () => (
      await hrmsApi.get<{ success: true; data: PerformanceDataset[] }>(
        "/api/performance-hub/ingestion/datasets",
      )
    ).data,
    enabled: canView,
  });

  const datasets = useMemo(
    () => (datasetsQuery.data ?? []).filter((item) => item.sourceType === "excel" || item.sourceType === "csv"),
    [datasetsQuery.data],
  );
  const selected = datasets.find((item) => item.id === selectedId) ?? null;

  useEffect(() => {
    if (!selectedId && datasets.length) setSelectedId(datasets[0].id);
    if (selectedId && datasets.length && !datasets.some((item) => item.id === selectedId)) {
      setSelectedId(datasets[0].id);
    }
  }, [datasets, selectedId]);

  useEffect(() => {
    setFile(null);
    setPreflight(null);
    setSelectedRunId("");
  }, [selectedId]);

  const schemaQuery = useQuery({
    queryKey: ["performance-hub", "ingestion", "manual-schema", selectedId],
    queryFn: async () => (
      await hrmsApi.get<{ success: true; data: PerformanceManualUploadSchema }>(
        `/api/performance-hub/ingestion/datasets/${selectedId}/manual-schema`,
      )
    ).data,
    enabled: Boolean(selectedId),
  });

  const runsQuery = useQuery({
    queryKey: ["performance-hub", "ingestion", "manual-certification-runs", selectedId],
    queryFn: async () => (
      await hrmsApi.get<{ success: true; data: PaginatedPerformanceRuns }>(
        `/api/performance-hub/ingestion/datasets/${selectedId}/runs?page=1&pageSize=10`,
      )
    ).data,
    enabled: Boolean(selectedId),
  });

  const certificationQuery = useQuery({
    queryKey: ["performance-hub", "ingestion", "manual-certification", selectedRunId],
    queryFn: async () => (
      await hrmsApi.get<{ success: true; data: PerformanceRunCertification }>(
        `/api/performance-hub/ingestion/runs/${selectedRunId}/certification`,
      )
    ).data,
    enabled: Boolean(selectedRunId),
    retry: false,
  });

  const preflightMutation = useMutation({
    mutationFn: async () => {
      if (!selected || !file) throw new Error("Choose a manual performance file first");
      const body = new FormData();
      body.set("file", file);
      return (
        await hrmsApi.postForm<{ success: true; data: PerformanceManualUploadPreflight }>(
          `/api/performance-hub/ingestion/datasets/${selected.id}/manual-preflight`,
          body,
        )
      ).data;
    },
    onSuccess: (data) => {
      setPreflight(data);
      toast.success("File structure passed manual-upload preflight");
    },
    onError: (error: Error) => {
      setPreflight(null);
      toast.error(error.message);
    },
  });

  const downloadTemplate = async () => {
    if (!selected) return;
    try {
      const blob = await hrmsApi.getBlob(
        `/api/performance-hub/ingestion/datasets/${selected.id}/manual-template.csv`,
      );
      saveBlob(blob, `${selected.datasetKey}-manual-upload-template.csv`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Template download failed");
    }
  };

  const downloadErrors = async (runId: string) => {
    try {
      const blob = await hrmsApi.getBlob(
        `/api/performance-hub/ingestion/runs/${runId}/validation-errors.csv`,
      );
      saveBlob(blob, `performance-run-${runId}-errors.csv`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Validation error export failed");
    }
  };

  if (!canView) return null;

  return (
    <section className="rounded-[var(--r-lg)] border border-[var(--border-hairline)] bg-[var(--surface-0)] p-4 shadow-[var(--shadow-xs)]">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-[var(--brand-700)]">
            <ShieldCheck className="h-4 w-4" aria-hidden="true" />
            Manual upload certification
          </div>
          <h2 className="mt-1 text-lg font-semibold text-[var(--text-primary)]">
            Verify the file before preview and certify the database after publication
          </h2>
          <p className="mt-1 max-w-4xl text-sm leading-6 text-[var(--text-secondary)]">
            This console validates file type, worksheet, headers, duplicate columns, row limits and mapping fields. After preview or publication, it reconciles raw records, validation evidence, lineage and canonical KPI facts.
          </p>
        </div>
        <Button variant="outline" onClick={() => void Promise.all([datasetsQuery.refetch(), schemaQuery.refetch(), runsQuery.refetch()])}>
          <RefreshCcw className="mr-2 h-4 w-4" aria-hidden="true" /> Refresh
        </Button>
      </div>

      {!datasets.length ? (
        <div className="mt-5 rounded-[var(--r-md)] border border-dashed border-[var(--border-default)] bg-[var(--surface-1)] p-6 text-sm text-[var(--text-muted)]">
          Configure an Excel or CSV performance source to use manual-upload certification.
        </div>
      ) : (
        <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(280px,0.65fr)_minmax(0,1.35fr)]">
          <div className="grid content-start gap-3">
            <div className="grid gap-2">
              <Label htmlFor="manual-certification-dataset">Manual source</Label>
              <select
                id="manual-certification-dataset"
                className="h-11 rounded-[var(--r-md)] border border-[var(--border-default)] bg-[var(--surface-0)] px-3 text-sm text-[var(--text-primary)]"
                value={selectedId}
                onChange={(event) => setSelectedId(event.target.value)}
              >
                {datasets.map((dataset) => (
                  <option key={dataset.id} value={dataset.id}>{dataset.datasetName}</option>
                ))}
              </select>
            </div>

            {schemaQuery.data && (
              <div className="rounded-[var(--r-md)] border border-[var(--border-hairline)] bg-[var(--surface-1)] p-4 text-sm">
                <p className="font-semibold text-[var(--text-primary)]">Governed file contract</p>
                <dl className="mt-3 grid gap-2 text-xs text-[var(--text-secondary)]">
                  <div className="flex justify-between gap-3"><dt>Accepted</dt><dd>{schemaQuery.data.acceptedExtensions.join(", ")}</dd></div>
                  <div className="flex justify-between gap-3"><dt>Maximum file</dt><dd>{formatBytes(schemaQuery.data.maximumFileBytes)}</dd></div>
                  <div className="flex justify-between gap-3"><dt>Maximum rows</dt><dd>{schemaQuery.data.maxRows.toLocaleString("en-GB")}</dd></div>
                  <div className="flex justify-between gap-3"><dt>Worksheet</dt><dd>{schemaQuery.data.sheetName ?? "First worksheet"}</dd></div>
                </dl>
                <Button variant="outline" className="mt-4 w-full" onClick={() => void downloadTemplate()}>
                  <Download className="mr-2 h-4 w-4" aria-hidden="true" /> Download governed template
                </Button>
              </div>
            )}

            <div className="rounded-[var(--r-md)] border border-[var(--border-hairline)] bg-[var(--surface-1)] p-4">
              <p className="text-sm font-semibold text-[var(--text-primary)]">Required columns</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {(schemaQuery.data?.requiredColumns ?? []).map((column) => (
                  <span key={column} className="rounded-full border border-[var(--border-default)] bg-[var(--surface-0)] px-2.5 py-1 text-xs text-[var(--text-secondary)]">
                    {column}
                  </span>
                ))}
              </div>
            </div>
          </div>

          <div className="grid min-w-0 gap-4">
            <div className="rounded-[var(--r-md)] border border-[var(--border-hairline)] bg-[var(--surface-1)] p-4">
              <h3 className="font-semibold text-[var(--text-primary)]">1. File preflight</h3>
              <p className="mt-1 text-sm text-[var(--text-muted)]">
                Preflight does not stage or publish data. It proves that the selected file matches the approved dataset contract.
              </p>
              <label className="mt-4 flex min-h-20 cursor-pointer items-center justify-center gap-2 rounded-[var(--r-md)] border border-dashed border-[var(--border-default)] bg-[var(--surface-0)] px-4 text-sm text-[var(--text-secondary)]">
                <Upload className="h-4 w-4" aria-hidden="true" />
                <span>{file?.name ?? "Choose the file to inspect"}</span>
                <Input
                  type="file"
                  className="sr-only"
                  accept={schemaQuery.data?.acceptedExtensions.join(",") ?? ".csv,.xlsx,.xls"}
                  onChange={(event) => {
                    setFile(event.target.files?.[0] ?? null);
                    setPreflight(null);
                  }}
                />
              </label>
              <Button className="mt-3" disabled={!file || preflightMutation.isPending} onClick={() => preflightMutation.mutate()}>
                <FileCheck2 className="mr-2 h-4 w-4" aria-hidden="true" />
                {preflightMutation.isPending ? "Inspecting…" : "Run file preflight"}
              </Button>

              {preflight && (
                <div className="mt-4 rounded-[var(--r-md)] border border-[var(--status-present)]/30 bg-[var(--status-present)]/5 p-4">
                  <div className="flex items-center gap-2 font-semibold text-[var(--status-present)]">
                    <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> File contract passed
                  </div>
                  <div className="mt-3 grid gap-2 text-xs text-[var(--text-secondary)] sm:grid-cols-2 lg:grid-cols-4">
                    <span>{preflight.rowCount.toLocaleString("en-GB")} data rows</span>
                    <span>{preflight.columns.length} columns</span>
                    <span>{formatBytes(preflight.fileSize)}</span>
                    <span>Sheet: {preflight.sheetName}</span>
                  </div>
                  {preflight.warnings.map((warning) => (
                    <p key={warning} className="mt-2 flex items-center gap-2 text-xs text-[var(--status-warning)]">
                      <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" /> {warning}
                    </p>
                  ))}
                  <details className="mt-3">
                    <summary className="cursor-pointer text-xs font-semibold text-[var(--brand-700)]">View first rows</summary>
                    <pre className="mt-2 max-h-64 overflow-auto rounded-md bg-[var(--surface-0)] p-3 text-xs text-[var(--text-secondary)]">
                      {JSON.stringify(preflight.sample, null, 2)}
                    </pre>
                  </details>
                </div>
              )}
            </div>

            <div className="rounded-[var(--r-md)] border border-[var(--border-hairline)] bg-[var(--surface-1)] p-4">
              <h3 className="font-semibold text-[var(--text-primary)]">2. Run database certification</h3>
              <p className="mt-1 text-sm text-[var(--text-muted)]">
                Complete preview or publication in Performance data administration, then certify the resulting run here.
              </p>
              {!runsQuery.data?.rows.length ? (
                <p className="mt-4 text-sm text-[var(--text-muted)]">No run is available for this source.</p>
              ) : (
                <div className="mt-4 grid gap-2">
                  {runsQuery.data.rows.slice(0, 5).map((run) => (
                    <div key={run.id} className="flex flex-col gap-3 rounded-[var(--r-md)] border border-[var(--border-hairline)] bg-[var(--surface-0)] p-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="text-sm font-semibold capitalize text-[var(--text-primary)]">{run.mode} · {run.status.replaceAll("_", " ")}</p>
                        <p className="mt-1 text-xs text-[var(--text-muted)]">{run.sourceFileName ?? run.id} · source {run.sourceRows} · invalid {run.invalidRows} · published {run.publishedFacts}</p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {run.invalidRows > 0 && (
                          <Button variant="outline" size="sm" onClick={() => void downloadErrors(run.id)}>
                            <Download className="mr-2 h-4 w-4" aria-hidden="true" /> Errors
                          </Button>
                        )}
                        <Button variant="outline" size="sm" onClick={() => setSelectedRunId(run.id)}>
                          <ShieldCheck className="mr-2 h-4 w-4" aria-hidden="true" /> Certify
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {selectedRunId && certificationQuery.isLoading && (
                <p className="mt-4 text-sm text-[var(--text-muted)]">Checking database evidence…</p>
              )}
              {certificationQuery.isError && (
                <p className="mt-4 text-sm text-[var(--status-absent)]">{certificationQuery.error.message}</p>
              )}
              {certificationQuery.data && (
                <div className={`mt-4 rounded-[var(--r-md)] border p-4 ${certificationQuery.data.certified ? "border-[var(--status-present)]/30 bg-[var(--status-present)]/5" : "border-[var(--status-absent)]/30 bg-[var(--status-absent)]/5"}`}>
                  <div className={`flex items-center gap-2 font-semibold ${certificationQuery.data.certified ? "text-[var(--status-present)]" : "text-[var(--status-absent)]"}`}>
                    {certificationQuery.data.certified
                      ? <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                      : <AlertTriangle className="h-4 w-4" aria-hidden="true" />}
                    {certificationQuery.data.certified ? "Run certified" : "Run certification failed"}
                  </div>
                  <div className="mt-3 grid gap-2">
                    {certificationQuery.data.checks.map((item) => (
                      <div key={item.code} className="rounded-md border border-[var(--border-hairline)] bg-[var(--surface-0)] p-3 text-xs">
                        <p className={`font-semibold ${item.passed ? "text-[var(--status-present)]" : "text-[var(--status-absent)]"}`}>
                          {item.passed ? "PASS" : "FAIL"} · {item.label}
                        </p>
                        <p className="mt-1 text-[var(--text-muted)]">{item.detail}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
