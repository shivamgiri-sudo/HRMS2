import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Eye, RefreshCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { hrmsApi } from "@/lib/hrmsApi";
import type {
  PaginatedPerformanceRuns,
  PerformanceDataset,
  PerformanceRunDetail,
} from "@/types/performanceIngestion";

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function statusClass(status: string): string {
  const normalised = status.toLowerCase();
  if (["published", "preview_complete", "success", "completed"].includes(normalised)) {
    return "border-[var(--status-present)]/30 bg-[var(--status-present)]/10 text-[var(--status-present)]";
  }
  if (["failed", "error", "rejected"].includes(normalised)) {
    return "border-[var(--status-absent)]/30 bg-[var(--status-absent)]/10 text-[var(--status-absent)]";
  }
  return "border-[var(--border-default)] bg-[var(--surface-1)] text-[var(--text-secondary)]";
}

function evidenceCount(detail: PerformanceRunDetail | undefined, key: keyof PerformanceRunDetail): number {
  const value = detail?.[key];
  return Array.isArray(value) ? value.length : value ? 1 : 0;
}

export function PerformanceRunHistory({ dataset }: { dataset: PerformanceDataset | null }) {
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  const runsQuery = useQuery({
    queryKey: ["performance-hub", "ingestion", "runs", dataset?.id],
    queryFn: async () => (
      await hrmsApi.get<{ success: true; data: PaginatedPerformanceRuns }>(
        `/api/performance-hub/ingestion/datasets/${dataset!.id}/runs?page=1&pageSize=25`,
      )
    ).data,
    enabled: Boolean(dataset?.id),
  });

  const detailQuery = useQuery({
    queryKey: ["performance-hub", "ingestion", "run-detail", selectedRunId],
    queryFn: async () => (
      await hrmsApi.get<{ success: true; data: PerformanceRunDetail }>(
        `/api/performance-hub/ingestion/runs/${selectedRunId}`,
      )
    ).data,
    enabled: Boolean(selectedRunId),
  });

  if (!dataset) {
    return (
      <div className="rounded-[var(--r-md)] border border-dashed border-[var(--border-default)] bg-[var(--surface-1)] p-8 text-center text-sm text-[var(--text-muted)]">
        Select a performance source to view its preview and publication history.
      </div>
    );
  }

  return (
    <section className="rounded-[var(--r-md)] border border-[var(--border-hairline)] bg-[var(--surface-0)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-hairline)] p-4">
        <div>
          <h3 className="font-semibold text-[var(--text-primary)]">Run history</h3>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            Every preview and publication run for {dataset.datasetName}, including reconciliation evidence.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void runsQuery.refetch()} disabled={runsQuery.isFetching}>
          <RefreshCcw className={`mr-2 h-4 w-4 ${runsQuery.isFetching ? "animate-spin" : ""}`} aria-hidden="true" />
          Refresh
        </Button>
      </div>

      {runsQuery.isLoading ? (
        <p className="p-6 text-sm text-[var(--text-muted)]">Loading run history…</p>
      ) : runsQuery.isError ? (
        <div className="flex items-start gap-3 p-6 text-sm text-[var(--status-absent)]">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <div>
            <p className="font-semibold">Run history could not be loaded.</p>
            <p className="mt-1">{runsQuery.error.message}</p>
          </div>
        </div>
      ) : !runsQuery.data?.rows.length ? (
        <p className="p-6 text-sm text-[var(--text-muted)]">No preview or publication run exists for this source yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-[var(--surface-1)] text-xs uppercase tracking-wide text-[var(--text-muted)]">
              <tr>
                <th className="px-4 py-3 font-semibold">Run</th>
                <th className="px-4 py-3 font-semibold">Window</th>
                <th className="px-4 py-3 text-right font-semibold">Source</th>
                <th className="px-4 py-3 text-right font-semibold">Mapped</th>
                <th className="px-4 py-3 text-right font-semibold">Invalid</th>
                <th className="px-4 py-3 text-right font-semibold">Published</th>
                <th className="px-4 py-3 font-semibold">Finished</th>
                <th className="px-4 py-3"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-hairline)]">
              {runsQuery.data.rows.map((run) => (
                <tr key={run.id} className="align-top hover:bg-[var(--surface-1)]/70">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {run.status === "failed"
                        ? <AlertTriangle className="h-4 w-4 text-[var(--status-absent)]" aria-hidden="true" />
                        : <CheckCircle2 className="h-4 w-4 text-[var(--status-present)]" aria-hidden="true" />}
                      <div>
                        <p className="font-semibold capitalize text-[var(--text-primary)]">{run.mode}</p>
                        <span className={`mt-1 inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase ${statusClass(run.status)}`}>
                          {run.status.replaceAll("_", " ")}
                        </span>
                      </div>
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-[var(--text-secondary)]">
                    {run.windowFrom ?? "—"} to {run.windowTo ?? "—"}
                    {run.sourceFileName && <p className="mt-1 max-w-52 truncate text-xs text-[var(--text-muted)]">{run.sourceFileName}</p>}
                  </td>
                  <td className="px-4 py-3 text-right font-medium">{run.sourceRows}</td>
                  <td className="px-4 py-3 text-right font-medium">{run.mappedRows}</td>
                  <td className={`px-4 py-3 text-right font-medium ${run.invalidRows > 0 ? "text-[var(--status-absent)]" : ""}`}>{run.invalidRows}</td>
                  <td className="px-4 py-3 text-right font-medium">{run.publishedFacts}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-[var(--text-secondary)]">{formatDateTime(run.finishedAt ?? run.createdAt)}</td>
                  <td className="px-4 py-3 text-right">
                    <Button variant="ghost" size="sm" onClick={() => setSelectedRunId(run.id)}>
                      <Eye className="mr-2 h-4 w-4" aria-hidden="true" />
                      Evidence
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={Boolean(selectedRunId)} onOpenChange={(open) => !open && setSelectedRunId(null)}>
        <DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Ingestion run evidence</DialogTitle>
            <DialogDescription>
              Validation, reconciliation, mapping exceptions, and publication evidence for this controlled run.
            </DialogDescription>
          </DialogHeader>

          {detailQuery.isLoading ? (
            <p className="py-8 text-sm text-[var(--text-muted)]">Loading run evidence…</p>
          ) : detailQuery.isError ? (
            <p className="py-8 text-sm text-[var(--status-absent)]">{detailQuery.error.message}</p>
          ) : detailQuery.data ? (
            <div className="grid gap-4">
              <div className="grid gap-3 sm:grid-cols-4">
                <div className="rounded-[var(--r-md)] border border-[var(--border-hairline)] bg-[var(--surface-1)] p-3">
                  <p className="text-xs text-[var(--text-muted)]">Validations</p>
                  <p className="mt-1 text-xl font-semibold">{evidenceCount(detailQuery.data, "validations")}</p>
                </div>
                <div className="rounded-[var(--r-md)] border border-[var(--border-hairline)] bg-[var(--surface-1)] p-3">
                  <p className="text-xs text-[var(--text-muted)]">Reconciliations</p>
                  <p className="mt-1 text-xl font-semibold">{evidenceCount(detailQuery.data, "reconciliations")}</p>
                </div>
                <div className="rounded-[var(--r-md)] border border-[var(--border-hairline)] bg-[var(--surface-1)] p-3">
                  <p className="text-xs text-[var(--text-muted)]">Mapping exceptions</p>
                  <p className="mt-1 text-xl font-semibold">{evidenceCount(detailQuery.data, "mappingExceptions")}</p>
                </div>
                <div className="rounded-[var(--r-md)] border border-[var(--border-hairline)] bg-[var(--surface-1)] p-3">
                  <p className="text-xs text-[var(--text-muted)]">Publication</p>
                  <p className="mt-1 text-xl font-semibold">{detailQuery.data.publication ? "Yes" : "No"}</p>
                </div>
              </div>

              <EvidenceSection title="Reconciliation results" rows={detailQuery.data.reconciliations} />
              <EvidenceSection title="Validation results" rows={detailQuery.data.validations} />
              <EvidenceSection title="Mapping exceptions" rows={detailQuery.data.mappingExceptions} />
              {detailQuery.data.publication && (
                <EvidenceSection title="Publication batch" rows={[detailQuery.data.publication]} />
              )}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </section>
  );
}

function EvidenceSection({ title, rows }: { title: string; rows: Array<Record<string, unknown>> }) {
  return (
    <section className="rounded-[var(--r-md)] border border-[var(--border-hairline)] bg-[var(--surface-0)]">
      <div className="border-b border-[var(--border-hairline)] px-4 py-3">
        <h4 className="font-semibold text-[var(--text-primary)]">{title}</h4>
      </div>
      {!rows.length ? (
        <p className="p-4 text-sm text-[var(--text-muted)]">No records.</p>
      ) : (
        <div className="max-h-72 overflow-auto p-3">
          {rows.map((row, index) => (
            <pre key={String(row.id ?? index)} className="mb-2 overflow-x-auto rounded-md bg-[var(--surface-1)] p-3 text-xs text-[var(--text-secondary)] last:mb-0">
              {JSON.stringify(row, null, 2)}
            </pre>
          ))}
        </div>
      )}
    </section>
  );
}
