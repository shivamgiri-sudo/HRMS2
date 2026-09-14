import { useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Database, Save } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { hrmsApi } from "@/lib/hrmsApi";
import type {
  PerformanceDataset,
  PerformanceDatasetMapping,
  PerformanceReferenceData,
  PerformanceSourceType,
} from "@/types/performanceIngestion";

type SourceForm = {
  datasetKey: string;
  datasetName: string;
  sourceType: PerformanceSourceType;
  connectorKey: string;
  sourceEntity: string;
  processId: string;
  branchId: string;
  timezoneName: string;
  activeStatus: boolean;
  configJson: string;
  mappingJson: string;
};

const defaultMapping: PerformanceDatasetMapping = {
  employeeIdentifierField: "employee_code",
  employeeIdentifierType: "employee_code",
  eventDateField: "performance_date",
  sourceRecordKeyField: "record_id",
  sourceEventTimestampField: "source_updated_at",
  externalProcessField: "process",
  metrics: [
    {
      metricCode: "QUALITY_SCORE",
      numeratorField: "points_earned",
      denominatorField: "points_possible",
      aggregation: "ratio",
      ratioMultiplier: 100,
      sourceRecordCountField: "audited_cases",
    },
  ],
};

function defaultConfig(sourceType: PerformanceSourceType): Record<string, unknown> {
  if (sourceType === "mysql") {
    return {
      queryMysql: "SELECT employee_code, performance_date, points_earned, points_possible FROM reporting_view WHERE performance_date BETWEEN ? AND ?",
      queryParams: ["from", "to"],
      maxRows: 10000,
    };
  }
  if (sourceType === "mssql") {
    return {
      queryMssql: "SELECT employee_code, performance_date, points_earned, points_possible FROM reporting_view WHERE performance_date BETWEEN @from AND @to",
      maxRows: 10000,
    };
  }
  if (sourceType === "google_sheet") {
    return {
      csvUrl: "https://docs.google.com/spreadsheets/d/REPLACE/export?format=csv&gid=0",
      maxRows: 10000,
    };
  }
  return { maxRows: 10000 };
}

function blankForm(): SourceForm {
  return {
    datasetKey: "",
    datasetName: "",
    sourceType: "excel",
    connectorKey: "",
    sourceEntity: "",
    processId: "",
    branchId: "",
    timezoneName: "Asia/Kolkata",
    activeStatus: true,
    configJson: JSON.stringify(defaultConfig("excel"), null, 2),
    mappingJson: JSON.stringify(defaultMapping, null, 2),
  };
}

function formFromDataset(dataset: PerformanceDataset): SourceForm {
  return {
    datasetKey: dataset.datasetKey,
    datasetName: dataset.datasetName,
    sourceType: dataset.sourceType,
    connectorKey: dataset.connectorKey ?? "",
    sourceEntity: dataset.sourceEntity ?? "",
    processId: dataset.processId ?? "",
    branchId: dataset.branchId ?? "",
    timezoneName: dataset.timezoneName || "Asia/Kolkata",
    activeStatus: dataset.activeStatus,
    configJson: JSON.stringify(dataset.config ?? {}, null, 2),
    mappingJson: JSON.stringify(dataset.mapping ?? defaultMapping, null, 2),
  };
}

function parseObjectJson(value: string, label: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

export function PerformanceSourceEditor({
  open,
  onOpenChange,
  dataset,
  reference,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dataset: PerformanceDataset | null;
  reference: PerformanceReferenceData | undefined;
  onSaved: (datasetId: string) => Promise<void> | void;
}) {
  const [form, setForm] = useState<SourceForm>(blankForm);
  const editing = Boolean(dataset);

  useEffect(() => {
    if (!open) return;
    setForm(dataset ? formFromDataset(dataset) : blankForm());
  }, [dataset, open]);

  const metricHint = useMemo(() => {
    const metrics = reference?.metrics ?? [];
    return metrics.slice(0, 12).map((metric) => metric.code).join(", ");
  }, [reference?.metrics]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const config = parseObjectJson(form.configJson, "Source configuration");
      const mapping = parseObjectJson(form.mappingJson, "Field and metric mapping");
      const response = await hrmsApi.post<{ success: true; data: { id: string } }>(
        "/api/performance-hub/ingestion/datasets",
        {
          id: dataset?.id,
          datasetKey: form.datasetKey.trim(),
          datasetName: form.datasetName.trim(),
          sourceType: form.sourceType,
          connectorKey: form.connectorKey.trim() || null,
          sourceEntity: form.sourceEntity.trim() || null,
          processId: form.processId || null,
          branchId: form.branchId || null,
          timezoneName: form.timezoneName.trim() || "Asia/Kolkata",
          activeStatus: form.activeStatus,
          config,
          mapping,
        },
      );
      return response.data.id;
    },
    onSuccess: async (datasetId) => {
      toast.success(editing ? "Performance source updated as draft" : "Performance source created as draft");
      onOpenChange(false);
      await onSaved(datasetId);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const changeSourceType = (sourceType: PerformanceSourceType) => {
    setForm((current) => ({
      ...current,
      sourceType,
      connectorKey: sourceType === "mysql" || sourceType === "mssql" ? current.connectorKey : "",
      configJson: JSON.stringify(defaultConfig(sourceType), null, 2),
    }));
  };

  const requiresConnector = form.sourceType === "mysql" || form.sourceType === "mssql";
  const saveDisabled = saveMutation.isPending || !form.datasetKey.trim() || !form.datasetName.trim();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Database className="h-5 w-5" aria-hidden="true" />
            {editing ? "Edit performance source" : "Add performance source"}
          </DialogTitle>
          <DialogDescription>
            Saving an existing source returns it to draft status. Preview the revised mapping before approving it again.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="performance-dataset-key">Dataset key</Label>
            <Input
              id="performance-dataset-key"
              value={form.datasetKey}
              disabled={editing}
              onChange={(event) => setForm((current) => ({ ...current, datasetKey: event.target.value }))}
              placeholder="onfido_quality"
              autoComplete="off"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="performance-dataset-name">Dataset name</Label>
            <Input
              id="performance-dataset-name"
              value={form.datasetName}
              onChange={(event) => setForm((current) => ({ ...current, datasetName: event.target.value }))}
              placeholder="Onfido Quality"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="performance-source-type">Source type</Label>
            <select
              id="performance-source-type"
              className="h-11 rounded-[var(--r-md)] border border-[var(--border-default)] bg-[var(--surface-0)] px-3 text-sm text-[var(--text-primary)]"
              value={form.sourceType}
              onChange={(event) => changeSourceType(event.target.value as PerformanceSourceType)}
            >
              <option value="mysql">MySQL</option>
              <option value="mssql">SQL Server</option>
              <option value="excel">Excel</option>
              <option value="csv">CSV</option>
              <option value="google_sheet">Google Sheet CSV</option>
            </select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="performance-connector-key">Connector key</Label>
            <Input
              id="performance-connector-key"
              value={form.connectorKey}
              disabled={!requiresConnector}
              onChange={(event) => setForm((current) => ({ ...current, connectorKey: event.target.value }))}
              placeholder={requiresConnector ? "Encrypted Integration Hub connector key" : "Not required for this source"}
            />
          </div>

          <div className="grid gap-2 md:col-span-2">
            <Label htmlFor="performance-source-entity">Source entity</Label>
            <Input
              id="performance-source-entity"
              value={form.sourceEntity}
              onChange={(event) => setForm((current) => ({ ...current, sourceEntity: event.target.value }))}
              placeholder="Reporting view, Sheet tab, client report, or file name"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="performance-process">Process</Label>
            <select
              id="performance-process"
              className="h-11 rounded-[var(--r-md)] border border-[var(--border-default)] bg-[var(--surface-0)] px-3 text-sm text-[var(--text-primary)]"
              value={form.processId}
              onChange={(event) => setForm((current) => ({ ...current, processId: event.target.value }))}
            >
              <option value="">Dynamic or source-mapped process</option>
              {(reference?.processes ?? []).map((process) => (
                <option key={process.id} value={process.id}>{process.name}</option>
              ))}
            </select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="performance-branch">Branch</Label>
            <select
              id="performance-branch"
              className="h-11 rounded-[var(--r-md)] border border-[var(--border-default)] bg-[var(--surface-0)] px-3 text-sm text-[var(--text-primary)]"
              value={form.branchId}
              onChange={(event) => setForm((current) => ({ ...current, branchId: event.target.value }))}
            >
              <option value="">Dynamic or employee-derived branch</option>
              {(reference?.branches ?? []).map((branch) => (
                <option key={branch.id} value={branch.id}>{branch.name}</option>
              ))}
            </select>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="performance-timezone">Source timezone</Label>
            <Input
              id="performance-timezone"
              value={form.timezoneName}
              onChange={(event) => setForm((current) => ({ ...current, timezoneName: event.target.value }))}
              placeholder="Asia/Kolkata"
            />
          </div>
          <label className="flex min-h-11 items-center gap-3 self-end rounded-[var(--r-md)] border border-[var(--border-default)] bg-[var(--surface-1)] px-3 text-sm font-medium text-[var(--text-primary)]">
            <input
              type="checkbox"
              checked={form.activeStatus}
              onChange={(event) => setForm((current) => ({ ...current, activeStatus: event.target.checked }))}
            />
            Source is active
          </label>

          <div className="grid gap-2 md:col-span-2">
            <Label htmlFor="performance-config-json">Source configuration JSON</Label>
            <Textarea
              id="performance-config-json"
              className="min-h-48 font-mono text-xs"
              value={form.configJson}
              onChange={(event) => setForm((current) => ({ ...current, configJson: event.target.value }))}
              spellCheck={false}
            />
            <p className="text-xs text-[var(--text-muted)]">
              Database sources accept read-only queries. Google Sheets require an approved HTTPS CSV export URL. File sources normally need only maxRows.
            </p>
          </div>

          <div className="grid gap-2 md:col-span-2">
            <Label htmlFor="performance-mapping-json">Field and metric mapping JSON</Label>
            <Textarea
              id="performance-mapping-json"
              className="min-h-72 font-mono text-xs"
              value={form.mappingJson}
              onChange={(event) => setForm((current) => ({ ...current, mappingJson: event.target.value }))}
              spellCheck={false}
            />
            <p className="text-xs text-[var(--text-muted)]">
              Active metric codes include: {metricHint || "Load KPI master reference data to view available codes"}.
            </p>
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" disabled={saveDisabled} onClick={() => saveMutation.mutate()}>
            <Save className="mr-2 h-4 w-4" aria-hidden="true" />
            {saveMutation.isPending ? "Saving…" : editing ? "Save revised draft" : "Create draft source"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
