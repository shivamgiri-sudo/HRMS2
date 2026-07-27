import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Database, FileSpreadsheet, Play, Plus, ShieldCheck, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { hrmsApi } from "@/lib/hrmsApi";
import type { PerformanceContext } from "@/types/performanceHub";

type Dataset = {
  id: string;
  datasetKey: string;
  datasetName: string;
  sourceType: "mysql" | "mssql" | "excel" | "csv" | "google_sheet";
  connectorKey: string | null;
  sourceEntity: string | null;
  approvalStatus: string;
  activeStatus: boolean;
  mapping: { metrics?: Array<{ metricCode: string }> };
};

type RunResult = {
  runId: string;
  mode: "preview" | "publish";
  status: string;
  sourceRows: number;
  stagedRows: number;
  mappedRows: number;
  invalidRows: number;
  publishedFacts: number;
  issues: Array<{ code: string; message: string; invalidValue?: unknown }>;
};

const adminRoles = new Set(["super_admin", "admin", "process_manager", "qa_manager"]);

function localDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

const defaultMapping = JSON.stringify({
  employeeIdentifierField: "employee_code",
  eventDateField: "performance_date",
  sourceRecordKeyField: "record_id",
  externalProcessField: "process",
  metrics: [
    {
      metricCode: "QUALITY_SCORE",
      numeratorField: "points_earned",
      denominatorField: "points_possible",
      aggregation: "ratio",
      ratioMultiplier: 100,
    },
  ],
}, null, 2);

const defaultConfig = JSON.stringify({
  queryMysql: "SELECT employee_code, performance_date, points_earned, points_possible FROM reporting_view WHERE performance_date BETWEEN ? AND ?",
  queryMssql: "SELECT employee_code, performance_date, points_earned, points_possible FROM reporting_view WHERE performance_date BETWEEN @from AND @to",
  queryParams: ["from", "to"],
  maxRows: 10000,
}, null, 2);

export function PerformanceDataSourceAdmin({ context }: { context: PerformanceContext }) {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string>("");
  const [file, setFile] = useState<File | null>(null);
  const [from, setFrom] = useState(() => localDate(new Date(new Date().getFullYear(), new Date().getMonth(), 1)));
  const [to, setTo] = useState(() => localDate(new Date()));
  const [result, setResult] = useState<RunResult | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({
    datasetKey: "",
    datasetName: "",
    sourceType: "excel" as Dataset["sourceType"],
    connectorKey: "",
    sourceEntity: "",
    configJson: defaultConfig,
    mappingJson: defaultMapping,
  });

  const canAdminister = adminRoles.has(context.effectiveRole.toLowerCase());
  const datasetsQuery = useQuery({
    queryKey: ["performance-hub", "ingestion", "datasets"],
    queryFn: async () => (
      await hrmsApi.get<{ success: true; data: Dataset[] }>("/api/performance-hub/ingestion/datasets")
    ).data,
    enabled: canAdminister,
  });

  const selected = useMemo(
    () => datasetsQuery.data?.find((dataset) => dataset.id === selectedId) ?? null,
    [datasetsQuery.data, selectedId],
  );

  const saveMutation = useMutation({
    mutationFn: async () => {
      const config = JSON.parse(form.configJson);
      const mapping = JSON.parse(form.mappingJson);
      return hrmsApi.post("/api/performance-hub/ingestion/datasets", {
        datasetKey: form.datasetKey,
        datasetName: form.datasetName,
        sourceType: form.sourceType,
        connectorKey: form.connectorKey || null,
        sourceEntity: form.sourceEntity || null,
        config,
        mapping,
      });
    },
    onSuccess: async () => {
      toast.success("Performance source saved as draft");
      setDialogOpen(false);
      await queryClient.invalidateQueries({ queryKey: ["performance-hub", "ingestion", "datasets"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const approveMutation = useMutation({
    mutationFn: (datasetId: string) => hrmsApi.post(`/api/performance-hub/ingestion/datasets/${datasetId}/approve`),
    onSuccess: async () => {
      toast.success("Dataset mapping approved");
      await queryClient.invalidateQueries({ queryKey: ["performance-hub", "ingestion", "datasets"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const runMutation = useMutation({
    mutationFn: async (mode: "preview" | "publish") => {
      if (!selected) throw new Error("Select a performance source first");
      const formData = new FormData();
      formData.set("from", from);
      formData.set("to", to);
      if (file) formData.set("file", file);
      const response = await hrmsApi.postForm<{ success: true; data: RunResult }>(
        `/api/performance-hub/ingestion/datasets/${selected.id}/${mode}`,
        formData,
      );
      return response.data;
    },
    onSuccess: (data) => {
      setResult(data);
      toast.success(data.mode === "publish" ? "Performance facts published" : "Source preview completed");
      void queryClient.invalidateQueries({ queryKey: ["performance-hub"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (!canAdminister) return null;

  return (
    <section className="rounded-[var(--r-lg)] border border-[var(--border-hairline)] bg-[var(--surface-0)] p-4 shadow-[var(--shadow-xs)]">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-[var(--brand-700)]">
            <Database className="h-4 w-4" />
            Performance data sources
          </div>
          <h2 className="mt-1 text-lg font-semibold text-[var(--text-primary)]">Controlled ingestion and publication</h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-[var(--text-secondary)]">
            Preview external database, Google Sheet, Excel, or CSV data before it becomes visible. Publishing is blocked until the dataset mapping is approved.
          </p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button className="h-11"><Plus className="mr-2 h-4 w-4" />Add source</Button>
          </DialogTrigger>
          <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Add performance source</DialogTitle>
              <DialogDescription>Create a draft dataset. Preview and validate it before approval.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="grid gap-2"><Label>Dataset key</Label><Input value={form.datasetKey} onChange={(event) => setForm((current) => ({ ...current, datasetKey: event.target.value }))} placeholder="onfido_quality" /></div>
              <div className="grid gap-2"><Label>Dataset name</Label><Input value={form.datasetName} onChange={(event) => setForm((current) => ({ ...current, datasetName: event.target.value }))} placeholder="Onfido Quality" /></div>
              <div className="grid gap-2"><Label>Source type</Label><select className="h-11 rounded-md border bg-background px-3 text-sm" value={form.sourceType} onChange={(event) => setForm((current) => ({ ...current, sourceType: event.target.value as Dataset["sourceType"] }))}><option value="mysql">MySQL</option><option value="mssql">SQL Server</option><option value="excel">Excel</option><option value="csv">CSV</option><option value="google_sheet">Google Sheet CSV</option></select></div>
              <div className="grid gap-2"><Label>Connector key</Label><Input value={form.connectorKey} onChange={(event) => setForm((current) => ({ ...current, connectorKey: event.target.value }))} placeholder="Required for database sources" /></div>
              <div className="grid gap-2 md:col-span-2"><Label>Source entity</Label><Input value={form.sourceEntity} onChange={(event) => setForm((current) => ({ ...current, sourceEntity: event.target.value }))} placeholder="Database view, table, Sheet tab, or report name" /></div>
              <div className="grid gap-2 md:col-span-2"><Label>Source configuration JSON</Label><Textarea className="min-h-44 font-mono text-xs" value={form.configJson} onChange={(event) => setForm((current) => ({ ...current, configJson: event.target.value }))} /></div>
              <div className="grid gap-2 md:col-span-2"><Label>Field and metric mapping JSON</Label><Textarea className="min-h-64 font-mono text-xs" value={form.mappingJson} onChange={(event) => setForm((current) => ({ ...current, mappingJson: event.target.value }))} /></div>
            </div>
            <Button disabled={saveMutation.isPending || !form.datasetKey || !form.datasetName} onClick={() => saveMutation.mutate()}>{saveMutation.isPending ? "Saving…" : "Save draft source"}</Button>
          </DialogContent>
        </Dialog>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <div className="grid content-start gap-2">
          {datasetsQuery.isLoading ? <p className="text-sm text-[var(--text-muted)]">Loading sources…</p> : datasetsQuery.data?.map((dataset) => (
            <button key={dataset.id} type="button" onClick={() => { setSelectedId(dataset.id); setResult(null); setFile(null); }} className={`rounded-[var(--r-md)] border p-3 text-left transition ${selectedId === dataset.id ? "border-[var(--brand-400)] bg-[var(--brand-50)]" : "border-[var(--border-hairline)] bg-[var(--surface-1)] hover:border-[var(--brand-300)]"}`}>
              <div className="flex items-start justify-between gap-3">
                <div><p className="font-semibold text-[var(--text-primary)]">{dataset.datasetName}</p><p className="mt-1 text-xs text-[var(--text-muted)]">{dataset.sourceType} · {dataset.sourceEntity ?? dataset.datasetKey}</p></div>
                <span className="rounded-full border px-2 py-1 text-[11px] font-semibold uppercase">{dataset.approvalStatus}</span>
              </div>
              <p className="mt-2 text-xs text-[var(--text-secondary)]">{dataset.mapping.metrics?.length ?? 0} mapped metrics</p>
            </button>
          ))}
        </div>

        <div className="rounded-[var(--r-md)] border border-[var(--border-hairline)] bg-[var(--surface-1)] p-4">
          {!selected ? <p className="text-sm text-[var(--text-muted)]">Select a dataset to preview or publish.</p> : <>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><h3 className="font-semibold text-[var(--text-primary)]">{selected.datasetName}</h3><p className="mt-1 text-xs text-[var(--text-muted)]">{selected.connectorKey ?? "File/Sheet source"}</p></div>
              {selected.approvalStatus !== "active" ? <Button variant="outline" disabled={approveMutation.isPending} onClick={() => approveMutation.mutate(selected.id)}><ShieldCheck className="mr-2 h-4 w-4" />Approve mapping</Button> : <span className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--status-present)]"><CheckCircle2 className="h-4 w-4" />Approved</span>}
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1"><Label>From</Label><Input type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} /></div>
              <div className="grid gap-1"><Label>To</Label><Input type="date" value={to} min={from} onChange={(event) => setTo(event.target.value)} /></div>
            </div>
            {(selected.sourceType === "excel" || selected.sourceType === "csv") && <label className="mt-3 flex min-h-20 cursor-pointer items-center justify-center gap-2 rounded-[var(--r-md)] border border-dashed border-[var(--border-default)] bg-[var(--surface-0)] px-4 text-sm"><Upload className="h-4 w-4" /><span>{file?.name ?? "Choose Excel or CSV file"}</span><input type="file" accept=".xlsx,.xls,.csv" className="sr-only" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></label>}
            <div className="mt-4 flex flex-wrap gap-2"><Button variant="outline" disabled={runMutation.isPending} onClick={() => runMutation.mutate("preview")}><Play className="mr-2 h-4 w-4" />Preview and validate</Button><Button disabled={runMutation.isPending || selected.approvalStatus !== "active"} onClick={() => runMutation.mutate("publish")}><FileSpreadsheet className="mr-2 h-4 w-4" />Publish facts</Button></div>

            {result && <div className="mt-4 rounded-[var(--r-md)] border border-[var(--border-hairline)] bg-[var(--surface-0)] p-3"><div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-5"><div><p className="text-xs text-[var(--text-muted)]">Source</p><p className="font-semibold">{result.sourceRows}</p></div><div><p className="text-xs text-[var(--text-muted)]">Staged</p><p className="font-semibold">{result.stagedRows}</p></div><div><p className="text-xs text-[var(--text-muted)]">Mapped</p><p className="font-semibold">{result.mappedRows}</p></div><div><p className="text-xs text-[var(--text-muted)]">Invalid</p><p className="font-semibold">{result.invalidRows}</p></div><div><p className="text-xs text-[var(--text-muted)]">Published</p><p className="font-semibold">{result.publishedFacts}</p></div></div>{result.issues.length > 0 && <div className="mt-3 max-h-40 overflow-y-auto text-xs text-[var(--status-absent)]">{result.issues.slice(0, 20).map((issue, index) => <p key={`${issue.code}-${index}`}>{issue.code}: {issue.message}</p>)}</div>}</div>}
          </>}
        </div>
      </div>
    </section>
  );
}
