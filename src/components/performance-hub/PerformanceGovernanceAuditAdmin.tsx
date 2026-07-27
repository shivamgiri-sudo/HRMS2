import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Eye, RefreshCcw, ScrollText } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { hrmsApi } from "@/lib/hrmsApi";
import type { PerformanceContext } from "@/types/performanceHub";
import type { PerformanceDataset } from "@/types/performanceIngestion";
import type {
  PaginatedPerformanceGovernanceAudit,
  PerformanceGovernanceAuditRow,
} from "@/types/performanceAudit";

const readerRoles = new Set([
  "super_admin",
  "admin",
  "hr",
  "process_manager",
  "qa_manager",
  "quality_lead",
]);

function labelAction(value: string): string {
  return value
    .replace(/^PERFORMANCE_/, "")
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function PerformanceGovernanceAuditAdmin({ context }: { context: PerformanceContext }) {
  const canView = readerRoles.has(context.effectiveRole.toLowerCase());
  const [datasetId, setDatasetId] = useState("");
  const [actionCode, setActionCode] = useState("");
  const [selected, setSelected] = useState<PerformanceGovernanceAuditRow | null>(null);

  const datasetsQuery = useQuery({
    queryKey: ["performance-hub", "ingestion", "datasets"],
    queryFn: async () => (
      await hrmsApi.get<{ success: true; data: PerformanceDataset[] }>(
        "/api/performance-hub/ingestion/datasets",
      )
    ).data,
    enabled: canView,
  });

  const queryString = useMemo(() => {
    const params = new URLSearchParams({ page: "1", pageSize: "50" });
    if (datasetId) params.set("datasetId", datasetId);
    if (actionCode) params.set("actionCode", actionCode);
    return params.toString();
  }, [actionCode, datasetId]);

  const auditQuery = useQuery({
    queryKey: ["performance-hub", "ingestion", "governance-audit", datasetId, actionCode],
    queryFn: async () => (
      await hrmsApi.get<{ success: true; data: PaginatedPerformanceGovernanceAudit }>(
        `/api/performance-hub/ingestion/governance-audit?${queryString}`,
      )
    ).data,
    enabled: canView,
  });

  if (!canView) return null;

  return (
    <section className="rounded-[var(--r-lg)] border border-[var(--border-hairline)] bg-[var(--surface-0)] p-4 shadow-[var(--shadow-xs)]">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-[var(--brand-700)]">
            <ScrollText className="h-4 w-4" aria-hidden="true" />
            Performance governance audit
          </div>
          <h2 className="mt-1 text-lg font-semibold text-[var(--text-primary)]">Source and publication change history</h2>
          <p className="mt-1 max-w-4xl text-sm leading-6 text-[var(--text-secondary)]">
            Review successful source, mapping, approval, schedule, preview, and publication-control actions inside your authorised HRMS scope.
          </p>
        </div>
        <Button variant="outline" className="h-11" disabled={auditQuery.isFetching} onClick={() => void auditQuery.refetch()}>
          <RefreshCcw className={`mr-2 h-4 w-4 ${auditQuery.isFetching ? "animate-spin" : ""}`} aria-hidden="true" />
          Refresh
        </Button>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-xs font-semibold text-[var(--text-muted)]">
          Dataset
          <select
            className="h-11 rounded-[var(--r-md)] border border-[var(--border-default)] bg-[var(--surface-0)] px-3 text-sm text-[var(--text-primary)]"
            value={datasetId}
            onChange={(event) => setDatasetId(event.target.value)}
          >
            <option value="">All datasets in my scope</option>
            {(datasetsQuery.data ?? []).map((dataset) => (
              <option key={dataset.id} value={dataset.id}>{dataset.datasetName}</option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-xs font-semibold text-[var(--text-muted)]">
          Action
          <select
            className="h-11 rounded-[var(--r-md)] border border-[var(--border-default)] bg-[var(--surface-0)] px-3 text-sm text-[var(--text-primary)]"
            value={actionCode}
            onChange={(event) => setActionCode(event.target.value)}
          >
            <option value="">All governance actions</option>
            {(auditQuery.data?.actions ?? []).map((action) => (
              <option key={action} value={action}>{labelAction(action)}</option>
            ))}
          </select>
        </label>
      </div>

      {auditQuery.isLoading ? (
        <p className="mt-4 rounded-[var(--r-md)] border border-[var(--border-hairline)] bg-[var(--surface-1)] p-6 text-sm text-[var(--text-muted)]">Loading governance audit…</p>
      ) : auditQuery.isError ? (
        <p className="mt-4 rounded-[var(--r-md)] border border-[var(--status-absent)]/30 bg-[var(--status-absent)]/10 p-6 text-sm text-[var(--status-absent)]">{auditQuery.error.message}</p>
      ) : !auditQuery.data?.rows.length ? (
        <p className="mt-4 rounded-[var(--r-md)] border border-dashed border-[var(--border-default)] bg-[var(--surface-1)] p-6 text-sm text-[var(--text-muted)]">No governance actions match the selected filters.</p>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-[var(--r-md)] border border-[var(--border-hairline)]">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-[var(--surface-1)] text-xs uppercase tracking-wide text-[var(--text-muted)]">
              <tr>
                <th className="px-4 py-3 font-semibold">Action</th>
                <th className="px-4 py-3 font-semibold">Dataset</th>
                <th className="px-4 py-3 font-semibold">Actor</th>
                <th className="px-4 py-3 font-semibold">Entity</th>
                <th className="px-4 py-3 font-semibold">Timestamp</th>
                <th className="px-4 py-3"><span className="sr-only">Evidence</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-hairline)] bg-[var(--surface-0)]">
              {auditQuery.data.rows.map((row) => (
                <tr key={row.id} className="align-top hover:bg-[var(--surface-1)]/70">
                  <td className="px-4 py-3">
                    <span className="inline-flex rounded-full border border-[var(--brand-200)] bg-[var(--brand-50)] px-2 py-1 text-[10px] font-semibold uppercase text-[var(--brand-700)]">
                      {labelAction(row.actionCode)}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-semibold text-[var(--text-primary)]">{row.datasetName ?? "Organisation-level action"}</p>
                    <p className="mt-1 text-xs text-[var(--text-muted)]">
                      {[row.processName, row.branchName].filter(Boolean).join(" · ") || row.datasetKey || "—"}
                    </p>
                  </td>
                  <td className="max-w-48 break-all px-4 py-3 font-mono text-xs text-[var(--text-secondary)]">{row.actorUserId ?? "System worker"}</td>
                  <td className="px-4 py-3 text-[var(--text-secondary)]">
                    <p className="capitalize">{row.entityType.replaceAll("_", " ")}</p>
                    {row.entityId && <p className="mt-1 max-w-48 truncate font-mono text-xs text-[var(--text-muted)]">{row.entityId}</p>}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-[var(--text-secondary)]">{formatDateTime(row.createdAt)}</td>
                  <td className="px-4 py-3 text-right">
                    <Button variant="ghost" size="sm" onClick={() => setSelected(row)}>
                      <Eye className="mr-2 h-4 w-4" aria-hidden="true" /> Evidence
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={Boolean(selected)} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{selected ? labelAction(selected.actionCode) : "Governance evidence"}</DialogTitle>
            <DialogDescription>
              Sanitised evidence is retained for review. Credential-like fields are redacted before storage.
            </DialogDescription>
          </DialogHeader>
          {selected && (
            <div className="grid gap-4">
              <Evidence title="Response evidence" value={selected.after} />
              <Evidence title="Request metadata" value={selected.metadata} />
              {selected.before !== null && <Evidence title="Previous value" value={selected.before} />}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}

function Evidence({ title, value }: { title: string; value: unknown }) {
  return (
    <section className="rounded-[var(--r-md)] border border-[var(--border-hairline)] bg-[var(--surface-0)]">
      <h3 className="border-b border-[var(--border-hairline)] px-4 py-3 font-semibold text-[var(--text-primary)]">{title}</h3>
      <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words bg-[var(--surface-1)] p-4 text-xs text-[var(--text-secondary)]">
        {JSON.stringify(value, null, 2)}
      </pre>
    </section>
  );
}
