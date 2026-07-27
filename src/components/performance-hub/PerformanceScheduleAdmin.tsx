import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, PlayCircle, RefreshCcw, Save, StopCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { hrmsApi } from "@/lib/hrmsApi";
import type { PerformanceContext } from "@/types/performanceHub";
import type {
  PerformanceDataset,
  PerformanceRunResult,
  PerformanceSchedule,
} from "@/types/performanceIngestion";

const managerRoles = new Set(["super_admin", "admin", "process_manager", "qa_manager"]);

const schedulePresets = [
  { label: "Daily at 02:00", value: "0 2 * * *" },
  { label: "Every 6 hours", value: "0 */6 * * *" },
  { label: "Weekdays at 07:00", value: "0 7 * * 1-5" },
  { label: "Every 30 minutes", value: "*/30 * * * *" },
];

function formatDateTime(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function sourceTypeLabel(sourceType: PerformanceDataset["sourceType"]): string {
  if (sourceType === "mssql") return "SQL Server";
  if (sourceType === "google_sheet") return "Google Sheet";
  return sourceType.toUpperCase();
}

export function PerformanceScheduleAdmin({ context }: { context: PerformanceContext }) {
  const role = context.effectiveRole.toLowerCase();
  const canManage = managerRoles.has(role);
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState("");
  const [cronExpression, setCronExpression] = useState("0 2 * * *");
  const [lookbackDays, setLookbackDays] = useState(2);
  const [lastRunNow, setLastRunNow] = useState<PerformanceRunResult | null>(null);

  const datasetsQuery = useQuery({
    queryKey: ["performance-hub", "ingestion", "datasets"],
    queryFn: async () => (
      await hrmsApi.get<{ success: true; data: PerformanceDataset[] }>(
        "/api/performance-hub/ingestion/datasets",
      )
    ).data,
    enabled: canManage,
  });

  const schedulableDatasets = useMemo(
    () => (datasetsQuery.data ?? []).filter((dataset) =>
      ["mysql", "mssql", "google_sheet"].includes(dataset.sourceType)),
    [datasetsQuery.data],
  );

  useEffect(() => {
    if (!selectedId && schedulableDatasets.length) {
      setSelectedId(schedulableDatasets[0].id);
    }
    if (selectedId && !schedulableDatasets.some((dataset) => dataset.id === selectedId)) {
      setSelectedId(schedulableDatasets[0]?.id ?? "");
    }
  }, [schedulableDatasets, selectedId]);

  const selected = schedulableDatasets.find((dataset) => dataset.id === selectedId) ?? null;

  const scheduleQuery = useQuery({
    queryKey: ["performance-hub", "ingestion", "schedule", selectedId],
    queryFn: async () => (
      await hrmsApi.get<{ success: true; data: PerformanceSchedule }>(
        `/api/performance-hub/ingestion/datasets/${selectedId}/schedule`,
      )
    ).data,
    enabled: Boolean(selectedId),
  });

  useEffect(() => {
    if (!scheduleQuery.data) return;
    setCronExpression(scheduleQuery.data.cronExpression ?? "0 2 * * *");
    setLookbackDays(scheduleQuery.data.scheduleLookbackDays);
  }, [scheduleQuery.data]);

  const saveMutation = useMutation({
    mutationFn: async (enabled: boolean) => {
      if (!selectedId) throw new Error("Select a performance source first");
      const response = await hrmsApi.put<{ success: true; data: PerformanceSchedule }>(
        `/api/performance-hub/ingestion/datasets/${selectedId}/schedule`,
        {
          cronExpression: enabled ? cronExpression : null,
          scheduleLookbackDays: lookbackDays,
        },
      );
      return response.data;
    },
    onSuccess: async (data) => {
      toast.success(data.enabled ? "Automatic performance sync enabled" : "Automatic performance sync disabled");
      await queryClient.invalidateQueries({
        queryKey: ["performance-hub", "ingestion", "schedule", selectedId],
      });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const runNowMutation = useMutation({
    mutationFn: async () => {
      if (!selectedId) throw new Error("Select a performance source first");
      const response = await hrmsApi.post<{ success: true; data: PerformanceRunResult }>(
        `/api/performance-hub/ingestion/datasets/${selectedId}/run-now`,
      );
      return response.data;
    },
    onSuccess: async (data) => {
      setLastRunNow(data);
      toast.success("Performance source sync completed");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["performance-hub"] }),
        queryClient.invalidateQueries({ queryKey: ["performance-hub", "ingestion", "schedule", selectedId] }),
        queryClient.invalidateQueries({ queryKey: ["performance-hub", "ingestion", "runs", selectedId] }),
      ]);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (!canManage) return null;

  return (
    <section className="rounded-[var(--r-lg)] border border-[var(--border-hairline)] bg-[var(--surface-0)] p-4 shadow-[var(--shadow-xs)]">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-[var(--brand-700)]">
            <CalendarClock className="h-4 w-4" aria-hidden="true" />
            Scheduled performance sync
          </div>
          <h2 className="mt-1 text-lg font-semibold text-[var(--text-primary)]">Automatic approved-source publication</h2>
          <p className="mt-1 max-w-4xl text-sm leading-6 text-[var(--text-secondary)]">
            Schedule approved database or Google Sheet sources. Automatic runs use distributed locks, overlap windows, and fail-closed validation before publishing.
          </p>
        </div>
        <Button
          variant="outline"
          className="h-11"
          disabled={scheduleQuery.isFetching}
          onClick={() => void scheduleQuery.refetch()}
        >
          <RefreshCcw className={`mr-2 h-4 w-4 ${scheduleQuery.isFetching ? "animate-spin" : ""}`} aria-hidden="true" />
          Refresh
        </Button>
      </div>

      {!schedulableDatasets.length ? (
        <p className="mt-4 rounded-[var(--r-md)] border border-dashed border-[var(--border-default)] bg-[var(--surface-1)] p-6 text-sm text-[var(--text-muted)]">
          No MySQL, SQL Server, or Google Sheet source is available in your assigned scope.
        </p>
      ) : (
        <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(260px,0.65fr)_minmax(0,1.35fr)]">
          <div className="grid content-start gap-2">
            {schedulableDatasets.map((dataset) => (
              <button
                key={dataset.id}
                type="button"
                onClick={() => {
                  setSelectedId(dataset.id);
                  setLastRunNow(null);
                }}
                className={`rounded-[var(--r-md)] border p-3 text-left transition ${
                  dataset.id === selectedId
                    ? "border-[var(--brand-400)] bg-[var(--brand-50)]"
                    : "border-[var(--border-hairline)] bg-[var(--surface-1)] hover:border-[var(--brand-300)]"
                }`}
              >
                <p className="font-semibold text-[var(--text-primary)]">{dataset.datasetName}</p>
                <p className="mt-1 text-xs text-[var(--text-muted)]">
                  {sourceTypeLabel(dataset.sourceType)} · {dataset.processName ?? "Dynamic process"}
                </p>
                <p className={`mt-2 text-xs font-semibold ${dataset.approvalStatus === "active" ? "text-[var(--status-present)]" : "text-[var(--status-absent)]"}`}>
                  {dataset.approvalStatus === "active" ? "Approved for publication" : "Mapping approval required"}
                </p>
              </button>
            ))}
          </div>

          <div className="rounded-[var(--r-md)] border border-[var(--border-hairline)] bg-[var(--surface-1)] p-4">
            {!selected ? null : scheduleQuery.isLoading ? (
              <p className="text-sm text-[var(--text-muted)]">Loading schedule…</p>
            ) : scheduleQuery.isError ? (
              <p className="text-sm text-[var(--status-absent)]">{scheduleQuery.error.message}</p>
            ) : scheduleQuery.data ? (
              <div className="grid gap-5">
                <div className="grid gap-3 sm:grid-cols-3">
                  <StatusCard label="Schedule" value={scheduleQuery.data.enabled ? "Enabled" : "Disabled"} positive={scheduleQuery.data.enabled} />
                  <StatusCard label="Next run" value={formatDateTime(scheduleQuery.data.nextRunAt)} />
                  <StatusCard label="Last result" value={scheduleQuery.data.lastRunStatus ?? "No scheduled run"} positive={scheduleQuery.data.lastRunStatus === "published"} />
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="grid gap-2">
                    <Label htmlFor="performance-cron-expression">Cron expression</Label>
                    <Input
                      id="performance-cron-expression"
                      value={cronExpression}
                      onChange={(event) => setCronExpression(event.target.value)}
                      placeholder="0 2 * * *"
                      className="font-mono"
                    />
                    <select
                      aria-label="Schedule preset"
                      className="h-10 rounded-[var(--r-md)] border border-[var(--border-default)] bg-[var(--surface-0)] px-3 text-sm"
                      value=""
                      onChange={(event) => {
                        if (event.target.value) setCronExpression(event.target.value);
                      }}
                    >
                      <option value="">Choose a preset</option>
                      {schedulePresets.map((preset) => (
                        <option key={preset.value} value={preset.value}>{preset.label}</option>
                      ))}
                    </select>
                    <p className="text-xs text-[var(--text-muted)]">
                      Timezone: {scheduleQuery.data.timezone}. Minimum interval: five minutes.
                    </p>
                  </div>

                  <div className="grid content-start gap-2">
                    <Label htmlFor="performance-lookback-days">Correction overlap days</Label>
                    <Input
                      id="performance-lookback-days"
                      type="number"
                      min={1}
                      max={31}
                      value={lookbackDays}
                      onChange={(event) => setLookbackDays(Math.max(1, Math.min(31, Number(event.target.value) || 1)))}
                    />
                    <p className="text-xs leading-5 text-[var(--text-muted)]">
                      Each scheduled run re-reads this many days to capture client corrections. Source-specific lineage prevents unrelated approved sources from being overwritten.
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button
                    disabled={saveMutation.isPending || !cronExpression.trim() || selected.approvalStatus !== "active"}
                    onClick={() => saveMutation.mutate(true)}
                  >
                    <Save className="mr-2 h-4 w-4" aria-hidden="true" />
                    Enable or update schedule
                  </Button>
                  <Button
                    variant="outline"
                    disabled={saveMutation.isPending || !scheduleQuery.data.enabled}
                    onClick={() => saveMutation.mutate(false)}
                  >
                    <StopCircle className="mr-2 h-4 w-4" aria-hidden="true" />
                    Disable schedule
                  </Button>
                  <Button
                    variant="outline"
                    disabled={runNowMutation.isPending || selected.approvalStatus !== "active"}
                    onClick={() => runNowMutation.mutate()}
                  >
                    <PlayCircle className="mr-2 h-4 w-4" aria-hidden="true" />
                    {runNowMutation.isPending ? "Running…" : "Run approved source now"}
                  </Button>
                </div>

                {lastRunNow && (
                  <div className="rounded-[var(--r-md)] border border-[var(--status-present)]/30 bg-[var(--status-present)]/10 p-3 text-sm text-[var(--text-secondary)]">
                    <p className="font-semibold text-[var(--status-present)]">Manual scheduled-source run completed</p>
                    <p className="mt-1">
                      {lastRunNow.sourceRows} source rows · {lastRunNow.mappedRows} mapped · {lastRunNow.publishedFacts} published · {lastRunNow.invalidRows} invalid
                    </p>
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </div>
      )}
    </section>
  );
}

function StatusCard({
  label,
  value,
  positive,
}: {
  label: string;
  value: string;
  positive?: boolean;
}) {
  return (
    <div className="rounded-[var(--r-md)] border border-[var(--border-hairline)] bg-[var(--surface-0)] p-3">
      <p className="text-xs text-[var(--text-muted)]">{label}</p>
      <p className={`mt-1 font-semibold ${positive === true ? "text-[var(--status-present)]" : positive === false ? "text-[var(--status-absent)]" : "text-[var(--text-primary)]"}`}>
        {value}
      </p>
    </div>
  );
}
