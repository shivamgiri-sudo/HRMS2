import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  Database,
  Edit3,
  FileSpreadsheet,
  History,
  Link2,
  PauseCircle,
  Play,
  Plus,
  RefreshCcw,
  ShieldCheck,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { hrmsApi } from "@/lib/hrmsApi";
import type { PerformanceContext } from "@/types/performanceHub";
import type {
  PerformanceDataset,
  PerformanceDatasetDetail,
  PerformanceReferenceData,
  PerformanceRunResult,
} from "@/types/performanceIngestion";
import { PerformanceMappingExceptionQueue } from "./PerformanceMappingExceptionQueue";
import { PerformanceRunHistory } from "./PerformanceRunHistory";
import { PerformanceSourceEditor } from "./PerformanceSourceEditor";

const sourceReaderRoles = new Set([
  "super_admin",
  "admin",
  "hr",
  "process_manager",
  "qa_manager",
  "quality_lead",
]);
const sourceManagerRoles = new Set(["super_admin", "admin", "process_manager", "qa_manager"]);
const approverRoles = new Set(["super_admin", "admin"]);
const mappingManagerRoles = new Set(["super_admin", "admin", "hr", "process_manager", "qa_manager"]);

function localDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function statusClass(status: string): string {
  const normalised = status.toLowerCase();
  if (["active", "published", "preview_complete"].includes(normalised)) {
    return "border-[var(--status-present)]/30 bg-[var(--status-present)]/10 text-[var(--status-present)]";
  }
  if (["failed", "inactive", "rejected"].includes(normalised)) {
    return "border-[var(--status-absent)]/30 bg-[var(--status-absent)]/10 text-[var(--status-absent)]";
  }
  return "border-[var(--border-default)] bg-[var(--surface-1)] text-[var(--text-secondary)]";
}

function sourceTypeLabel(sourceType: PerformanceDataset["sourceType"]): string {
  if (sourceType === "mssql") return "SQL Server";
  if (sourceType === "google_sheet") return "Google Sheet";
  return sourceType.toUpperCase();
}

export function PerformanceDataSourceAdmin({ context }: { context: PerformanceContext }) {
  const queryClient = useQueryClient();
  const role = context.effectiveRole.toLowerCase();
  const canView = sourceReaderRoles.has(role);
  const canManage = sourceManagerRoles.has(role);
  const canApprove = approverRoles.has(role);
  const canPublish = sourceManagerRoles.has(role);
  const canResolve = mappingManagerRoles.has(role);

  const [selectedId, setSelectedId] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingDataset, setEditingDataset] = useState<PerformanceDataset | null>(null);
  const [approvalOpen, setApprovalOpen] = useState(false);
  const [approvalEffectiveFrom, setApprovalEffectiveFrom] = useState(() => localDate(new Date()));
  const [file, setFile] = useState<File | null>(null);
  const [from, setFrom] = useState(() => localDate(new Date(new Date().getFullYear(), new Date().getMonth(), 1)));
  const [to, setTo] = useState(() => localDate(new Date()));
  const [runResult, setRunResult] = useState<PerformanceRunResult | null>(null);

  const datasetsQuery = useQuery({
    queryKey: ["performance-hub", "ingestion", "datasets"],
    queryFn: async () => (
      await hrmsApi.get<{ success: true; data: PerformanceDataset[] }>(
        "/api/performance-hub/ingestion/datasets",
      )
    ).data,
    enabled: canView,
  });

  const referenceQuery = useQuery({
    queryKey: ["performance-hub", "ingestion", "reference-data"],
    queryFn: async () => (
      await hrmsApi.get<{ success: true; data: PerformanceReferenceData }>(
        "/api/performance-hub/ingestion/reference-data",
      )
    ).data,
    enabled: canView,
    staleTime: 5 * 60 * 1000,
  });

  const selected = useMemo(
    () => datasetsQuery.data?.find((dataset) => dataset.id === selectedId) ?? null,
    [datasetsQuery.data, selectedId],
  );

  const detailQuery = useQuery({
    queryKey: ["performance-hub", "ingestion", "dataset-detail", selectedId],
    queryFn: async () => (
      await hrmsApi.get<{ success: true; data: PerformanceDatasetDetail }>(
        `/api/performance-hub/ingestion/datasets/${selectedId}`,
      )
    ).data,
    enabled: Boolean(selectedId),
  });

  useEffect(() => {
    if (!selectedId && datasetsQuery.data?.length) {
      setSelectedId(datasetsQuery.data[0].id);
    }
    if (selectedId && datasetsQuery.data && !datasetsQuery.data.some((dataset) => dataset.id === selectedId)) {
      setSelectedId(datasetsQuery.data[0]?.id ?? "");
    }
  }, [datasetsQuery.data, selectedId]);

  useEffect(() => {
    setFile(null);
    setRunResult(null);
  }, [selectedId]);

  const approveMutation = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error("Select a performance source first");
      return hrmsApi.post(`/api/performance-hub/ingestion/datasets/${selected.id}/approve`, {
        effectiveFrom: approvalEffectiveFrom,
      });
    },
    onSuccess: async () => {
      toast.success(`Mapping approved from ${approvalEffectiveFrom}`);
      setApprovalOpen(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["performance-hub", "ingestion", "datasets"] }),
        queryClient.invalidateQueries({ queryKey: ["performance-hub", "ingestion", "dataset-detail", selectedId] }),
      ]);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const statusMutation = useMutation({
    mutationFn: async (activeStatus: boolean) => {
      if (!selected) throw new Error("Select a performance source first");
      return hrmsApi.patch(`/api/performance-hub/ingestion/datasets/${selected.id}/status`, { activeStatus });
    },
    onSuccess: async () => {
      toast.success(selected?.activeStatus ? "Performance source deactivated" : "Performance source activated");
      await queryClient.invalidateQueries({ queryKey: ["performance-hub", "ingestion", "datasets"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const runMutation = useMutation({
    mutationFn: async (mode: "preview" | "publish") => {
      if (!selected) throw new Error("Select a performance source first");
      if ((selected.sourceType === "excel" || selected.sourceType === "csv") && !file) {
        throw new Error("Choose the Excel or CSV file before running this source");
      }
      const formData = new FormData();
      formData.set("from", from);
      formData.set("to", to);
      if (file) formData.set("file", file);
      const response = await hrmsApi.postForm<{ success: true; data: PerformanceRunResult }>(
        `/api/performance-hub/ingestion/datasets/${selected.id}/${mode}`,
        formData,
      );
      return response.data;
    },
    onSuccess: async (data) => {
      setRunResult(data);
      toast.success(data.mode === "publish" ? "Performance facts published" : "Source preview completed");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["performance-hub"] }),
        queryClient.invalidateQueries({ queryKey: ["performance-hub", "ingestion", "runs", selectedId] }),
        queryClient.invalidateQueries({ queryKey: ["performance-hub", "ingestion", "mapping-exceptions"] }),
      ]);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const refreshAll = () => {
    void datasetsQuery.refetch();
    void referenceQuery.refetch();
    if (selectedId) void detailQuery.refetch();
  };

  const openCreate = () => {
    setEditingDataset(null);
    setEditorOpen(true);
  };

  const openEdit = () => {
    if (!selected) return;
    setEditingDataset(selected);
    setEditorOpen(true);
  };

  const afterSourceSaved = async (datasetId: string) => {
    setSelectedId(datasetId);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["performance-hub", "ingestion", "datasets"] }),
      queryClient.invalidateQueries({ queryKey: ["performance-hub", "ingestion", "dataset-detail"] }),
    ]);
  };

  if (!canView) return null;

  const fileSource = selected?.sourceType === "excel" || selected?.sourceType === "csv";
  const publishBlocked = !selected?.activeStatus || selected.approvalStatus !== "active" || (fileSource && !file);

  return (
    <section className="rounded-[var(--r-lg)] border border-[var(--border-hairline)] bg-[var(--surface-0)] p-4 shadow-[var(--shadow-xs)]">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-[var(--brand-700)]">
            <Database className="h-4 w-4" aria-hidden="true" />
            Performance data administration
          </div>
          <h2 className="mt-1 text-lg font-semibold text-[var(--text-primary)]">Controlled ingestion, validation, and publication</h2>
          <p className="mt-1 max-w-4xl text-sm leading-6 text-[var(--text-secondary)]">
            Configure authorised data sources, preview raw rows, resolve mapping exceptions, approve effective-dated mappings, and publish traceable KPI facts.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" className="h-11" onClick={refreshAll} disabled={datasetsQuery.isFetching || referenceQuery.isFetching}>
            <RefreshCcw className={`mr-2 h-4 w-4 ${datasetsQuery.isFetching ? "animate-spin" : ""}`} aria-hidden="true" />
            Refresh
          </Button>
          {canManage && (
            <Button className="h-11" onClick={openCreate}>
              <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
              Add source
            </Button>
          )}
        </div>
      </div>

      <Tabs defaultValue="sources" className="mt-5">
        <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1 p-1">
          <TabsTrigger value="sources" className="gap-2">
            <Database className="h-4 w-4" aria-hidden="true" /> Sources
          </TabsTrigger>
          <TabsTrigger value="runs" className="gap-2">
            <History className="h-4 w-4" aria-hidden="true" /> Run history
          </TabsTrigger>
          <TabsTrigger value="exceptions" className="gap-2">
            <Link2 className="h-4 w-4" aria-hidden="true" /> Mapping exceptions
          </TabsTrigger>
        </TabsList>

        <TabsContent value="sources" className="mt-4">
          <div className="grid gap-4 xl:grid-cols-[minmax(280px,0.75fr)_minmax(0,1.25fr)]">
            <div className="grid content-start gap-2">
              {datasetsQuery.isLoading ? (
                <p className="rounded-[var(--r-md)] border border-[var(--border-hairline)] bg-[var(--surface-1)] p-4 text-sm text-[var(--text-muted)]">Loading sources…</p>
              ) : datasetsQuery.isError ? (
                <p className="rounded-[var(--r-md)] border border-[var(--status-absent)]/30 bg-[var(--status-absent)]/10 p-4 text-sm text-[var(--status-absent)]">{datasetsQuery.error.message}</p>
              ) : !datasetsQuery.data?.length ? (
                <div className="rounded-[var(--r-md)] border border-dashed border-[var(--border-default)] bg-[var(--surface-1)] p-6 text-center">
                  <p className="text-sm text-[var(--text-muted)]">No performance source is configured in your scope.</p>
                  {canManage && <Button variant="outline" className="mt-3" onClick={openCreate}>Create first source</Button>}
                </div>
              ) : datasetsQuery.data.map((dataset) => (
                <button
                  key={dataset.id}
                  type="button"
                  onClick={() => setSelectedId(dataset.id)}
                  className={`rounded-[var(--r-md)] border p-3 text-left transition ${
                    selectedId === dataset.id
                      ? "border-[var(--brand-400)] bg-[var(--brand-50)] shadow-sm"
                      : "border-[var(--border-hairline)] bg-[var(--surface-1)] hover:border-[var(--brand-300)]"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-[var(--text-primary)]">{dataset.datasetName}</p>
                      <p className="mt-1 text-xs text-[var(--text-muted)]">
                        {sourceTypeLabel(dataset.sourceType)} · {dataset.sourceEntity ?? dataset.datasetKey}
                      </p>
                    </div>
                    <span className={`shrink-0 rounded-full border px-2 py-1 text-[10px] font-semibold uppercase ${statusClass(dataset.approvalStatus)}`}>
                      {dataset.approvalStatus}
                    </span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-[var(--text-secondary)]">
                    <span>{dataset.processName ?? "Dynamic process"}</span>
                    <span>·</span>
                    <span>{dataset.branchName ?? "Dynamic branch"}</span>
                    {!dataset.activeStatus && <span className="font-semibold text-[var(--status-absent)]">· Inactive</span>}
                  </div>
                </button>
              ))}
            </div>

            <div className="min-w-0 rounded-[var(--r-md)] border border-[var(--border-hairline)] bg-[var(--surface-1)] p-4">
              {!selected ? (
                <p className="text-sm text-[var(--text-muted)]">Select a dataset to preview, approve, or publish.</p>
              ) : (
                <div className="grid gap-5">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-lg font-semibold text-[var(--text-primary)]">{selected.datasetName}</h3>
                        <span className={`rounded-full border px-2 py-1 text-[10px] font-semibold uppercase ${statusClass(selected.activeStatus ? "active" : "inactive")}`}>
                          {selected.activeStatus ? "active" : "inactive"}
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-[var(--text-muted)]">
                        {selected.connectorKey ?? "File or Google Sheet source"} · {selected.timezoneName}
                      </p>
                    </div>
                    {canManage && (
                      <div className="flex flex-wrap gap-2">
                        <Button variant="outline" size="sm" onClick={openEdit}>
                          <Edit3 className="mr-2 h-4 w-4" aria-hidden="true" /> Edit
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={statusMutation.isPending}
                          onClick={() => statusMutation.mutate(!selected.activeStatus)}
                        >
                          <PauseCircle className="mr-2 h-4 w-4" aria-hidden="true" />
                          {selected.activeStatus ? "Deactivate" : "Activate"}
                        </Button>
                      </div>
                    )}
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <InfoCard label="Process" value={selected.processName ?? "Source mapped"} />
                    <InfoCard label="Branch" value={selected.branchName ?? "Employee derived"} />
                    <InfoCard label="Mapped metrics" value={String(selected.mapping.metrics?.length ?? 0)} />
                    <InfoCard
                      label="Mapping version"
                      value={selected.currentMappingVersion ? `v${selected.currentMappingVersion}` : "Not approved"}
                      detail={selected.currentEffectiveFrom ? `From ${selected.currentEffectiveFrom}` : undefined}
                    />
                  </div>

                  <div className="rounded-[var(--r-md)] border border-[var(--border-hairline)] bg-[var(--surface-0)] p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <h4 className="font-semibold text-[var(--text-primary)]">Mapping approval</h4>
                        <p className="mt-1 text-sm text-[var(--text-muted)]">
                          Approval freezes the current mapping as a version effective from a chosen historical date.
                        </p>
                      </div>
                      {selected.approvalStatus === "active" ? (
                        <span className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--status-present)]">
                          <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> Approved
                        </span>
                      ) : canApprove ? (
                        <Button variant="outline" onClick={() => {
                          setApprovalEffectiveFrom(from);
                          setApprovalOpen(true);
                        }}>
                          <ShieldCheck className="mr-2 h-4 w-4" aria-hidden="true" /> Approve mapping
                        </Button>
                      ) : (
                        <span className="text-sm font-semibold text-[var(--status-absent)]">Admin approval required</span>
                      )}
                    </div>

                    {detailQuery.data?.mappingVersions.length ? (
                      <div className="mt-4 overflow-x-auto">
                        <table className="min-w-full text-left text-xs">
                          <thead className="text-[var(--text-muted)]">
                            <tr>
                              <th className="py-2 pr-4 font-semibold">Version</th>
                              <th className="py-2 pr-4 font-semibold">Effective period</th>
                              <th className="py-2 pr-4 font-semibold">Status</th>
                              <th className="py-2 font-semibold">Approved</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[var(--border-hairline)]">
                            {detailQuery.data.mappingVersions.slice(0, 5).map((version) => (
                              <tr key={version.id}>
                                <td className="py-2 pr-4 font-semibold">v{version.versionNo}</td>
                                <td className="py-2 pr-4">{version.effectiveFrom} to {version.effectiveTo ?? "current"}</td>
                                <td className="py-2 pr-4 capitalize">{version.status}</td>
                                <td className="py-2">{version.approvedAt ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(new Date(version.approvedAt)) : "—"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : null}
                  </div>

                  <div className="rounded-[var(--r-md)] border border-[var(--border-hairline)] bg-[var(--surface-0)] p-4">
                    <h4 className="font-semibold text-[var(--text-primary)]">Preview and publication window</h4>
                    <p className="mt-1 text-sm text-[var(--text-muted)]">
                      Preview writes staging and validation evidence only. Publish replaces this source’s current contribution inside the selected correction window.
                    </p>
                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      <div className="grid gap-1">
                        <Label htmlFor="performance-source-from">From</Label>
                        <Input id="performance-source-from" type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} />
                      </div>
                      <div className="grid gap-1">
                        <Label htmlFor="performance-source-to">To</Label>
                        <Input id="performance-source-to" type="date" value={to} min={from} onChange={(event) => setTo(event.target.value)} />
                      </div>
                    </div>

                    {fileSource && (
                      <label className="mt-3 flex min-h-20 cursor-pointer items-center justify-center gap-2 rounded-[var(--r-md)] border border-dashed border-[var(--border-default)] bg-[var(--surface-1)] px-4 text-sm text-[var(--text-secondary)]">
                        <Upload className="h-4 w-4" aria-hidden="true" />
                        <span>{file?.name ?? "Choose Excel or CSV file"}</span>
                        <input
                          type="file"
                          accept=".xlsx,.xls,.csv"
                          className="sr-only"
                          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                        />
                      </label>
                    )}

                    <div className="mt-4 flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        disabled={runMutation.isPending || !selected.activeStatus || (fileSource && !file)}
                        onClick={() => runMutation.mutate("preview")}
                      >
                        <Play className="mr-2 h-4 w-4" aria-hidden="true" /> Preview and validate
                      </Button>
                      {canPublish && (
                        <Button
                          disabled={runMutation.isPending || publishBlocked}
                          onClick={() => runMutation.mutate("publish")}
                        >
                          <FileSpreadsheet className="mr-2 h-4 w-4" aria-hidden="true" /> Publish facts
                        </Button>
                      )}
                    </div>

                    {runResult && (
                      <div className="mt-4 rounded-[var(--r-md)] border border-[var(--border-hairline)] bg-[var(--surface-1)] p-3">
                        <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-5">
                          <InfoMetric label="Source" value={runResult.sourceRows} />
                          <InfoMetric label="Staged" value={runResult.stagedRows} />
                          <InfoMetric label="Mapped" value={runResult.mappedRows} />
                          <InfoMetric label="Invalid" value={runResult.invalidRows} warning={runResult.invalidRows > 0} />
                          <InfoMetric label="Published" value={runResult.publishedFacts} />
                        </div>
                        {runResult.issues.length > 0 && (
                          <div className="mt-3 max-h-44 overflow-y-auto rounded-md border border-[var(--status-absent)]/20 bg-[var(--status-absent)]/5 p-3 text-xs text-[var(--status-absent)]">
                            {runResult.issues.slice(0, 30).map((issue, index) => (
                              <p key={`${issue.code}-${index}`} className="mb-1 last:mb-0">
                                <strong>{issue.code}:</strong> {issue.message}
                              </p>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="runs" className="mt-4">
          <PerformanceRunHistory dataset={selected} />
        </TabsContent>

        <TabsContent value="exceptions" className="mt-4">
          <PerformanceMappingExceptionQueue
            dataset={selected}
            reference={referenceQuery.data}
            canResolve={canResolve}
          />
        </TabsContent>
      </Tabs>

      <PerformanceSourceEditor
        open={editorOpen}
        onOpenChange={setEditorOpen}
        dataset={editingDataset}
        reference={referenceQuery.data}
        onSaved={afterSourceSaved}
      />

      <Dialog open={approvalOpen} onOpenChange={setApprovalOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Approve effective-dated mapping</DialogTitle>
            <DialogDescription>
              This creates a new immutable mapping version. Earlier approved versions remain attached to historical performance dates.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="mapping-effective-from">Effective from</Label>
            <Input
              id="mapping-effective-from"
              type="date"
              value={approvalEffectiveFrom}
              onChange={(event) => setApprovalEffectiveFrom(event.target.value)}
            />
            {selected?.currentEffectiveFrom && (
              <p className="text-xs text-[var(--text-muted)]">
                The current open mapping started on {selected.currentEffectiveFrom}; a replacement must start after that date.
              </p>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setApprovalOpen(false)}>Cancel</Button>
            <Button
              disabled={approveMutation.isPending || !approvalEffectiveFrom}
              onClick={() => approveMutation.mutate()}
            >
              <ShieldCheck className="mr-2 h-4 w-4" aria-hidden="true" />
              {approveMutation.isPending ? "Approving…" : "Approve mapping"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function InfoCard({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="rounded-[var(--r-md)] border border-[var(--border-hairline)] bg-[var(--surface-0)] p-3">
      <p className="text-xs text-[var(--text-muted)]">{label}</p>
      <p className="mt-1 truncate font-semibold text-[var(--text-primary)]">{value}</p>
      {detail && <p className="mt-1 text-xs text-[var(--text-secondary)]">{detail}</p>}
    </div>
  );
}

function InfoMetric({ label, value, warning = false }: { label: string; value: number; warning?: boolean }) {
  return (
    <div>
      <p className="text-xs text-[var(--text-muted)]">{label}</p>
      <p className={`font-semibold ${warning ? "text-[var(--status-absent)]" : "text-[var(--text-primary)]"}`}>{value}</p>
    </div>
  );
}
