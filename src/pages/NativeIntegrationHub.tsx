import { useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Clock,
  Database,
  FileSpreadsheet,
  GitBranch,
  Loader,
  Plus,
  RefreshCcw,
  Settings,
  ToggleLeft,
  ToggleRight,
  X,
  Zap,
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";
import {
  DatabaseConnectorCard,
  type DbConnectorConfig,
} from "@/components/integrations/DatabaseConnectorCard";
import { DatabaseConfigModal } from "@/components/integrations/DatabaseConfigModal";

// ─── Types ──────────────────────────────────────────────────────────────────

type ConnectorType = "manual" | "api" | "db" | "scheduled";
type ConnectorKind = "api" | "mysql" | "mssql" | "google_sheets";
type ConnectorStatus = "active" | "inactive" | "error" | "pending";

interface Connector {
  key: string;
  name: string;
  type: ConnectorType;
  status: ConnectorStatus;
  last_run_at: string | null;
  description: string;
}

interface FieldMap {
  id: string;
  source_table: string;
  source_field: string;
  target_table?: string;
  target_column?: string;
  target_field: string;
  transform: string | null;
  is_active: boolean;
}

interface SuggestedMapping {
  suggestion_id: string;
  source_field: string;
  target_field: string;
  confidence: number;
  confirmed: boolean;
}

interface Schedule {
  cron_expression: string;
  is_enabled: boolean;
  last_run_at: string | null;
  next_run_at: string | null;
}

interface FieldMapForm {
  source_table: string;
  source_field: string;
  target_table: string;
  target_column: string;
  transform: string;
}

interface TableMap {
  id: string;
  source_table: string;
  target_table: string;
  sync_mode: "daily_aggregate";
  is_active: boolean;
}

interface SourceSchema {
  table: string;
  columns: Array<{ name: string; type: string }>;
}

interface MappingTarget {
  table: string;
  columns: string[];
  sync_modes: Array<"daily_aggregate">;
}

interface TableMapForm {
  source_table: string;
  target_table: string;
  sync_mode: "daily_aggregate";
}

interface RunRecord {
  id: string;
  connector_key: string;
  connector_name: string;
  type: ConnectorType;
  status: "success" | "partial" | "failed" | "running";
  records_synced: number;
  errors: number;
  created_at: string;
}

interface DatabaseConnector {
  integration_key: string;
  integration_name: string;
  config_json: DbConnectorConfig;
  active_status: number;
  test_ok: boolean | null;
  test_error: string | null;
  test_at: string | null;
}

interface NewConnectorForm {
  key: string;
  name: string;
  kind: ConnectorKind;
  description: string;
  base_url: string;
  method: "GET" | "POST";
  auth_type: "none" | "api_key" | "bearer" | "basic";
  auth_header: string;
  secret_name: string;
  timeout_seconds: string;
  pagination: "none" | "page" | "offset" | "cursor";
  host: string;
  port: string;
  database: string;
  username: string;
  password: string;
  tables: string;
  date_column: string;
  employee_code_column: string;
  encrypt: boolean;
  trust_server_certificate: boolean;
  spreadsheet_id: string;
  sheet_name: string;
  sheet_range: string;
  header_row: string;
  sheets_auth_mode: "service_account" | "oauth" | "public";
  service_account_email: string;
  sync_direction: "pull" | "push";
}

const emptyConnectorForm = (): NewConnectorForm => ({
  key: "",
  name: "",
  kind: "api",
  description: "",
  base_url: "",
  method: "GET",
  auth_type: "none",
  auth_header: "Authorization",
  secret_name: "",
  timeout_seconds: "30",
  pagination: "none",
  host: "",
  port: "3306",
  database: "",
  username: "",
  password: "",
  tables: "",
  date_column: "event_time",
  employee_code_column: "employee_code",
  encrypt: false,
  trust_server_certificate: true,
  spreadsheet_id: "",
  sheet_name: "Sheet1",
  sheet_range: "A:Z",
  header_row: "1",
  sheets_auth_mode: "service_account",
  service_account_email: "",
  sync_direction: "pull",
});

const emptyFieldMapForm = (): FieldMapForm => ({
  source_table: "",
  source_field: "",
  target_table: "",
  target_column: "",
  transform: "",
});

const emptyTableMapForm = (): TableMapForm => ({
  source_table: "",
  target_table: "dialer_session_log",
  sync_mode: "daily_aggregate",
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

const TYPE_COLORS: Record<ConnectorType, string> = {
  manual:    "bg-slate-100 text-slate-700",
  api:       "bg-blue-50 text-blue-700",
  db:        "bg-violet-50 text-violet-700",
  scheduled: "bg-amber-50 text-amber-700",
};

const STATUS_DOT: Record<ConnectorStatus, string> = {
  active:   "bg-emerald-500",
  inactive: "bg-slate-400",
  error:    "bg-red-500",
  pending:  "bg-amber-400",
};

const RUN_STATUS_COLORS: Record<string, string> = {
  success: "bg-emerald-50 text-emerald-700",
  partial: "bg-amber-50 text-amber-700",
  failed:  "bg-red-50 text-red-700",
  running: "bg-blue-50 text-blue-700",
};

const TABS = ["Overview", "Run History", "Connector Config"] as const;
type Tab = (typeof TABS)[number];

function canRunConnector(connector: Connector): boolean {
  return connector.status === "active" && (connector.type === "api" || connector.type === "db");
}

function runDisabledReason(connector: Connector): string | null {
  if (connector.status !== "active") return "Activate and configure this connector before running sync.";
  if (connector.type === "manual") return "Manual/file connectors do not support Run Now. Upload or configure a live API/database connector.";
  if (connector.type === "scheduled") return "Scheduled-only connectors run from the background worker. Configure the schedule instead.";
  return null;
}

function TypeBadge({ type }: { type: ConnectorType }) {
  return (
    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${TYPE_COLORS[type]}`}>
      {type}
    </span>
  );
}

function RunStatusBadge({ status }: { status: string }) {
  const cls = RUN_STATUS_COLORS[status] ?? "bg-slate-100 text-slate-600";
  return (
    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${cls}`}>
      {status}
    </span>
  );
}

function StatCard({
  title,
  value,
  icon,
  tone,
}: {
  title: string;
  value: number | string;
  icon: React.ReactNode;
  tone: string;
}) {
  return (
    <div className="rounded-3xl border bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-slate-500">{title}</p>
          <p className="mt-2 text-3xl font-black tracking-tight text-slate-950">{value}</p>
        </div>
        <div className={`rounded-2xl p-3 ${tone}`}>{icon}</div>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function NativeIntegrationHub() {
  const [activeTab, setActiveTab] = useState<Tab>("Overview");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  // Overview
  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [runningKey, setRunningKey] = useState<string | null>(null);

  // Database Connectors
  const [dbConnectors, setDbConnectors] = useState<DatabaseConnector[]>([]);
  const [dbConfigOpen, setDbConfigOpen] = useState(false);
  const [activeDbKey, setActiveDbKey] = useState<string | null>(null);
  const [testingKey, setTestingKey] = useState<string | null>(null);

  // Run History
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [runsLoading, setRunsLoading] = useState(false);

  // Connector Config
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedConnector, setSelectedConnector] = useState<Connector | null>(null);
  const [fieldMaps, setFieldMaps] = useState<FieldMap[]>([]);
  const [tableMaps, setTableMaps] = useState<TableMap[]>([]);
  const [sourceSchemas, setSourceSchemas] = useState<SourceSchema[]>([]);
  const [mappingTargets, setMappingTargets] = useState<MappingTarget[]>([]);
  const [suggestions, setSuggestions] = useState<SuggestedMapping[]>([]);
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [scheduleEditing, setScheduleEditing] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [mappingSaving, setMappingSaving] = useState(false);
  const [tableMappingSaving, setTableMappingSaving] = useState(false);
  const [fieldMapForm, setFieldMapForm] = useState<FieldMapForm>(emptyFieldMapForm);
  const [tableMapForm, setTableMapForm] = useState<TableMapForm>(emptyTableMapForm);

  const [newForm, setNewForm] = useState<NewConnectorForm>(emptyConnectorForm);

  // ─── Data Loaders ──────────────────────────────────────────────────────────

  const loadConnectors = async () => {
    setLoading(true);
    setMessage("");
    try {
      const res = await hrmsApi.get<{ success: boolean; data: Connector[] }>(
        "/api/integration-hub/"
      );
      setConnectors(res.data ?? []);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to load connectors";
      setMessage(msg);
    } finally {
      setLoading(false);
    }
  };

  const loadDbConnectors = async () => {
    try {
      const res = await hrmsApi.get<{ success: boolean; data: DatabaseConnector[] }>('/api/external-db');
      setDbConnectors(res.data ?? []);
    } catch { /* silent */ }
  };

  const testDbConnector = async (key: string) => {
    setTestingKey(key);
    try {
      await hrmsApi.post(`/api/external-db/${key}/test`, {});
      await loadDbConnectors();
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : 'Test failed');
    } finally {
      setTestingKey(null);
    }
  };

  const loadRuns = async () => {
    setRunsLoading(true);
    try {
      const res = await hrmsApi.get<{ success: boolean; data: RunRecord[] }>(
        "/api/integration-hub/runs"
      );
      setRuns(res.data ?? []);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to load run history";
      setMessage(msg);
    } finally {
      setRunsLoading(false);
    }
  };

  const loadConnectorDetail = async (connector: Connector) => {
    setSelectedConnector(connector);
    setFieldMaps([]);
    setTableMaps([]);
    setSourceSchemas([]);
    setSuggestions([]);
    setSchedule(null);
    setFieldMapForm(emptyFieldMapForm());
    setTableMapForm(emptyTableMapForm());
    setDetailLoading(true);
    try {
      const [fmRes, tableRes, schemaRes, catalogRes, sugRes, schedRes] = await Promise.all([
        hrmsApi.get<{ success: boolean; data: FieldMap[] }>(
          `/api/integration-hub/${connector.key}/field-maps`
        ),
        hrmsApi.get<{ success: boolean; data: TableMap[] }>(
          `/api/integration-hub/${connector.key}/table-maps`
        ),
        hrmsApi.get<{ success: boolean; data: SourceSchema[] }>(
          `/api/integration-hub/${connector.key}/source-schema`
        ).catch(() => ({ success: false, data: [] })),
        hrmsApi.get<{ success: boolean; data: MappingTarget[] }>(
          "/api/integration-hub/mapping-catalog"
        ),
        hrmsApi.get<{ success: boolean; data: SuggestedMapping[] }>(
          `/api/integration-hub/${connector.key}/suggestions`
        ),
        hrmsApi.get<{ success: boolean; data: Schedule }>(
          `/api/integration-hub/${connector.key}/schedule`
        ),
      ]);
      setFieldMaps(fmRes.data ?? []);
      setTableMaps(tableRes.data ?? []);
      setSourceSchemas(schemaRes.data ?? []);
      setMappingTargets(catalogRes.data ?? []);
      setSuggestions(sugRes.data ?? []);
      setSchedule(schedRes.data ?? null);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to load connector details";
      setMessage(msg);
    } finally {
      setDetailLoading(false);
    }
  };

  useEffect(() => {
    void loadConnectors();
    void loadDbConnectors();
  }, []);

  useEffect(() => {
    if (activeTab === "Run History") void loadRuns();
  }, [activeTab]);

  // ─── Actions ───────────────────────────────────────────────────────────────

  const triggerRun = async (key: string) => {
    const connector = connectors.find((item) => item.key === key);
    if (!connector) {
      setMessage("Connector not found. Refresh the page and try again.");
      return;
    }

    const disabledReason = runDisabledReason(connector);
    if (disabledReason) {
      setMessage(disabledReason);
      return;
    }

    setRunningKey(key);
    try {
      const response = await hrmsApi.post<{
        success: boolean;
        data?: { rows_fetched?: number; rows_promoted?: number; rows_failed?: number; status?: string };
        message?: string;
      }>(`/api/integration-hub/${key}/run`, {});
      const summary = response.data;
      setMessage(
        response.message ??
          `Run ${summary?.status ?? "completed"}: fetched ${summary?.rows_fetched ?? 0}, promoted ${summary?.rows_promoted ?? 0}, failed ${summary?.rows_failed ?? 0}.`
      );
      await loadConnectors();
      await loadRuns();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Run trigger failed";
      setMessage(msg);
    } finally {
      setRunningKey(null);
    }
  };

  const addConnector = async () => {
    if (!newForm.key.trim() || !newForm.name.trim()) {
      setMessage("Key and Name are required.");
      return;
    }
    const isDatabase = newForm.kind === "mysql" || newForm.kind === "mssql";
    if (newForm.kind === "api" && !newForm.base_url.trim()) {
      setMessage("API base URL is required.");
      return;
    }
    if (isDatabase && (!newForm.host.trim() || !newForm.database.trim() || !newForm.username.trim())) {
      setMessage("Database host, database name, and username are required.");
      return;
    }
    if (newForm.kind === "google_sheets" && !newForm.spreadsheet_id.trim()) {
      setMessage("Google Spreadsheet ID is required.");
      return;
    }

    const integrationType = isDatabase
      ? "db"
      : newForm.kind === "google_sheets" || newForm.sync_direction === "pull"
        ? "api"
        : "api";
    const configJson = newForm.kind === "api"
      ? {
          connector_kind: "rest_api",
          method: newForm.method,
          auth_header: newForm.auth_header,
          timeout_seconds: Number(newForm.timeout_seconds) || 30,
          pagination: newForm.pagination,
        }
      : isDatabase
        ? {
            connector_kind: newForm.kind,
            db_type: newForm.kind,
            host: newForm.host.trim(),
            port: Number(newForm.port),
            database: newForm.database.trim(),
            username: newForm.username.trim(),
            source_tables: newForm.tables.split(",").map((value) => value.trim()).filter(Boolean),
            date_column: newForm.date_column.trim(),
            employee_code_column: newForm.employee_code_column.trim(),
            encrypt: newForm.encrypt,
            trust_server_certificate: newForm.trust_server_certificate,
          }
        : {
            connector_kind: "google_sheets",
            spreadsheet_id: newForm.spreadsheet_id.trim(),
            sheet_name: newForm.sheet_name.trim(),
            range: newForm.sheet_range.trim(),
            header_row: Number(newForm.header_row) || 1,
            auth_mode: newForm.sheets_auth_mode,
            service_account_email: newForm.service_account_email.trim() || null,
            sync_direction: newForm.sync_direction,
          };

    try {
      await hrmsApi.post("/api/integration-hub/", {
        key: newForm.key.trim(),
        name: newForm.name.trim(),
        type: integrationType,
        description: newForm.description,
        vendor_name: newForm.kind === "google_sheets" ? "Google" : null,
        base_url: newForm.kind === "api" ? newForm.base_url.trim() : null,
        auth_type: newForm.kind === "api" ? newForm.auth_type : newForm.sheets_auth_mode,
        secret_name: newForm.secret_name.trim() || null,
        config_json: configJson,
      });
      if (isDatabase) {
        await hrmsApi.put(`/api/external-db/${newForm.key.trim()}`, {
          db_type: newForm.kind,
          host: newForm.host.trim(),
          port: Number(newForm.port),
          database: newForm.database.trim(),
          username: newForm.username.trim(),
          password: newForm.password,
          date_column: newForm.date_column.trim(),
          employee_code_column: newForm.employee_code_column.trim(),
          tables: newForm.tables.split(",").map((value) => value.trim()).filter(Boolean),
          encrypt: newForm.encrypt,
          trust_server_certificate: newForm.trust_server_certificate,
        });
      }
      setShowAddModal(false);
      setNewForm(emptyConnectorForm());
      setMessage("Connector added successfully.");
      await loadConnectors();
      await loadDbConnectors();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to add connector";
      setMessage(msg);
    }
  };

  const confirmSuggestion = async (suggestionId: string) => {
    setConfirmingId(suggestionId);
    try {
      await hrmsApi.post("/api/integration-hub/field-maps/confirm", {
        suggestion_id: suggestionId,
      });
      setSuggestions((prev) =>
        prev.map((s) =>
          s.suggestion_id === suggestionId ? { ...s, confirmed: true } : s
        )
      );
      setMessage("Mapping confirmed.");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Confirm failed";
      setMessage(msg);
    } finally {
      setConfirmingId(null);
    }
  };

  const editFieldMap = (fieldMap: FieldMap) => {
    setFieldMapForm({
      source_table: fieldMap.source_table ?? "*",
      source_field: fieldMap.source_field,
      target_table: fieldMap.target_table ?? fieldMap.target_field?.split(".")[0] ?? "",
      target_column: fieldMap.target_column ?? fieldMap.target_field?.split(".").slice(1).join(".") ?? "",
      transform: fieldMap.transform ?? "",
    });
  };

  const saveFieldMap = async () => {
    if (!selectedConnector) return;
    if (!fieldMapForm.source_table.trim() || !fieldMapForm.source_field.trim() || !fieldMapForm.target_table.trim() || !fieldMapForm.target_column.trim()) {
      setMessage("Source table, source header, target table, and target column are required.");
      return;
    }

    setMappingSaving(true);
    try {
      await hrmsApi.post("/api/integration-hub/field-maps/confirm", {
        integrationKey: selectedConnector.key,
        sourceTable: fieldMapForm.source_table.trim(),
        sourceField: fieldMapForm.source_field.trim(),
        targetTable: fieldMapForm.target_table.trim(),
        targetColumn: fieldMapForm.target_column.trim(),
        transform: fieldMapForm.transform.trim() || null,
      });
      setFieldMapForm(emptyFieldMapForm());
      await loadConnectorDetail(selectedConnector);
      setMessage("Field mapping saved.");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Field mapping save failed";
      setMessage(msg);
    } finally {
      setMappingSaving(false);
    }
  };

  const editTableMap = (tableMap: TableMap) => {
    setTableMapForm({
      source_table: tableMap.source_table,
      target_table: tableMap.target_table,
      sync_mode: tableMap.sync_mode,
    });
  };

  const saveTableMap = async () => {
    if (!selectedConnector) return;
    if (!tableMapForm.source_table.trim() || !tableMapForm.target_table.trim()) {
      setMessage("Source and target tables are required.");
      return;
    }
    setTableMappingSaving(true);
    try {
      await hrmsApi.put(`/api/integration-hub/${selectedConnector.key}/table-maps`, {
        sourceTable: tableMapForm.source_table.trim(),
        targetTable: tableMapForm.target_table.trim(),
        syncMode: tableMapForm.sync_mode,
      });
      setTableMapForm(emptyTableMapForm());
      await loadConnectorDetail(selectedConnector);
      setMessage("Table mapping saved.");
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Table mapping save failed");
    } finally {
      setTableMappingSaving(false);
    }
  };

  const saveSchedule = async () => {
    if (!selectedConnector || !schedule) return;
    try {
      const response = await hrmsApi.put<{ success: boolean; data: Schedule; message?: string }>(`/api/integration-hub/${selectedConnector.key}/schedule`, {
        cron_expression: schedule.cron_expression,
        is_enabled: schedule.is_enabled,
      });
      setSchedule(response.data);
      setScheduleEditing(false);
      setMessage(response.message ?? "Schedule updated.");
      await loadConnectors();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Schedule update failed";
      setMessage(msg);
    }
  };

  // ─── Derived Stats ─────────────────────────────────────────────────────────

  const activeCount = connectors.filter((c) => c.status === "active").length;
  const errorCount  = connectors.filter((c) => c.status === "error").length;
  const successRuns = runs.filter((r) => r.status === "success").length;

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Page Header */}
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-black uppercase tracking-[0.2em] text-blue-600">
              Integrations
            </p>
            <h1 className="mt-2 text-3xl font-black text-slate-950">Integration Hub</h1>
            <p className="mt-2 max-w-4xl text-slate-600">
              Manage data connectors, field mappings, sync schedules, and run history across all
              integrated systems.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                void loadConnectors();
                if (activeTab === "Run History") void loadRuns();
              }}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 transition-colors cursor-pointer disabled:opacity-50"
            >
              <RefreshCcw className="h-4 w-4" />
              Refresh
            </button>
          </div>
        </div>

        {/* Message Banner */}
        {message && (
          <div className="flex items-center justify-between gap-3 rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm font-bold text-blue-800">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 flex-shrink-0" />
              {message}
            </div>
            <button
              onClick={() => setMessage("")}
              className="cursor-pointer text-blue-600 hover:text-blue-900 transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Stat Cards */}
        <div className="grid gap-4 md:grid-cols-4">
          <StatCard
            title="Total Connectors"
            value={connectors.length}
            icon={<GitBranch className="h-5 w-5" />}
            tone="bg-slate-100 text-slate-700"
          />
          <StatCard
            title="Active"
            value={activeCount}
            icon={<CheckCircle2 className="h-5 w-5" />}
            tone="bg-emerald-50 text-emerald-700"
          />
          <StatCard
            title="Errors"
            value={errorCount}
            icon={<AlertTriangle className="h-5 w-5" />}
            tone="bg-red-50 text-red-700"
          />
          <StatCard
            title="Successful Runs"
            value={successRuns}
            icon={<Zap className="h-5 w-5" />}
            tone="bg-blue-50 text-blue-700"
          />
        </div>

        {/* Tab Nav */}
        <div className="flex gap-1 rounded-2xl border bg-white p-1.5 shadow-sm w-fit">
          {TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`rounded-xl px-5 py-2.5 text-sm font-semibold transition-colors cursor-pointer ${
                activeTab === tab
                  ? "bg-slate-950 text-white shadow"
                  : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* ── Tab: Overview ────────────────────────────────────────────────── */}
        {activeTab === "Overview" && (
          <div className="space-y-4">
            {loading ? (
              <div className="flex items-center justify-center py-20">
                <Loader className="h-8 w-8 animate-spin text-slate-400" />
              </div>
            ) : connectors.length === 0 ? (
              <div className="rounded-3xl border bg-white py-20 text-center shadow-sm">
                <GitBranch className="mx-auto mb-3 h-10 w-10 text-slate-300" />
                <p className="font-semibold text-slate-400">No connectors found.</p>
              </div>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {connectors.map((c) => {
                  const disabledReason = runDisabledReason(c);
                  const runnable = canRunConnector(c);
                  return (
                    <div
                      key={c.key}
                      className="group relative overflow-hidden rounded-3xl border bg-white p-6 shadow-sm hover:shadow-md transition-shadow"
                    >
                      {/* Status dot */}
                      <span
                        className={`absolute right-5 top-5 h-3 w-3 rounded-full ${STATUS_DOT[c.status] ?? "bg-slate-300"}`}
                        title={c.status}
                      />
                      <div className="mb-3 flex items-start gap-3">
                        <div className="rounded-2xl bg-slate-100 p-2.5 text-slate-700">
                          <Database className="h-5 w-5" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <h3 className="truncate font-black text-slate-950">{c.name}</h3>
                          <p className="font-mono text-xs text-slate-400">{c.key}</p>
                        </div>
                      </div>
                      <p className="mb-4 text-sm text-slate-500 line-clamp-2">{c.description || "No description."}</p>
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <TypeBadge type={c.type} />
                          <span className="text-xs text-slate-400 flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {c.last_run_at ? c.last_run_at.slice(0, 16).replace("T", " ") : "Never"}
                          </span>
                        </div>
                        <button
                          onClick={() => void triggerRun(c.key)}
                          disabled={runningKey === c.key || !runnable}
                          title={disabledReason ?? "Run this connector now"}
                          className="inline-flex items-center gap-1.5 rounded-xl bg-slate-950 px-3 py-2 text-xs font-bold text-white hover:bg-slate-800 transition-colors cursor-pointer disabled:opacity-50"
                        >
                          {runningKey === c.key ? (
                            <Loader className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Zap className="h-3.5 w-3.5" />
                          )}
                          Run Now
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {dbConnectors.length > 0 && (
              <div className="space-y-3">
                <h2 className="text-sm font-black uppercase tracking-widest text-slate-400">Database Connectors</h2>
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {dbConnectors.map((dc) => {
                    const cfg = dc.config_json ?? {};
                    return (
                      <DatabaseConnectorCard
                        key={dc.integration_key}
                        integrationKey={dc.integration_key}
                        name={dc.integration_name}
                        config={cfg}
                        activeStatus={dc.active_status}
                        testOk={dc.test_ok}
                        testError={dc.test_error}
                        testAt={dc.test_at}
                        onConfigure={() => { setActiveDbKey(dc.integration_key); setDbConfigOpen(true); }}
                        onTest={() => testDbConnector(dc.integration_key)}
                        isTesting={testingKey === dc.integration_key}
                      />
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Tab: Run History ─────────────────────────────────────────────── */}
        {activeTab === "Run History" && (
          <div className="overflow-hidden rounded-3xl border bg-white shadow-sm">
            <div className="border-b p-5">
              <h2 className="font-black text-slate-950">Run History</h2>
              <p className="text-sm text-slate-500">{runs.length} records</p>
            </div>
            {runsLoading ? (
              <div className="flex items-center justify-center py-20">
                <Loader className="h-8 w-8 animate-spin text-slate-400" />
              </div>
            ) : runs.length === 0 ? (
              <div className="py-20 text-center">
                <Clock className="mx-auto mb-3 h-10 w-10 text-slate-300" />
                <p className="font-semibold text-slate-400">No run history yet.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[900px] text-sm">
                  <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                    <tr>
                      {["Connector", "Type", "Status", "Records Synced", "Errors", "Ran At"].map(
                        (h) => (
                          <th key={h} className="p-4 font-semibold">
                            {h}
                          </th>
                        )
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {runs.map((r) => (
                      <tr key={r.id} className="border-t hover:bg-slate-50/80 transition-colors">
                        <td className="p-4">
                          <div className="font-bold text-slate-950">
                            {r.connector_name || r.connector_key}
                          </div>
                          <div className="font-mono text-xs text-slate-400">{r.connector_key}</div>
                        </td>
                        <td className="p-4">
                          <TypeBadge type={r.type} />
                        </td>
                        <td className="p-4">
                          <RunStatusBadge status={r.status} />
                        </td>
                        <td className="p-4 font-semibold text-slate-700">
                          {r.records_synced.toLocaleString()}
                        </td>
                        <td className="p-4">
                          <span
                            className={
                              r.errors > 0
                                ? "font-bold text-red-600"
                                : "text-slate-400"
                            }
                          >
                            {r.errors}
                          </span>
                        </td>
                        <td className="p-4 font-mono text-xs text-slate-400">
                          {r.created_at?.slice(0, 16).replace("T", " ")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ── Tab: Connector Config ─────────────────────────────────────────── */}
        {activeTab === "Connector Config" && (
          <div className="space-y-5">
            {/* Add Connector */}
            <div className="flex justify-end">
              <button
                onClick={() => setShowAddModal(true)}
                className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-5 py-2.5 text-sm font-bold text-white hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <Plus className="h-4 w-4" />
                Add Connector
              </button>
            </div>

            <div className="grid gap-5 xl:grid-cols-[340px_1fr]">
              {/* Connector List */}
              <div className="overflow-hidden rounded-3xl border bg-white shadow-sm">
                <div className="border-b p-4">
                  <h3 className="font-black text-slate-950">Connectors</h3>
                  <p className="text-xs text-slate-500">Click to view detail</p>
                </div>
                {loading ? (
                  <div className="flex items-center justify-center py-16">
                    <Loader className="h-6 w-6 animate-spin text-slate-400" />
                  </div>
                ) : connectors.length === 0 ? (
                  <div className="py-10 text-center text-sm text-slate-400">
                    No connectors yet.
                  </div>
                ) : (
                  <div className="divide-y">
                    {connectors.map((c) => (
                      <button
                        key={c.key}
                        onClick={() => void loadConnectorDetail(c)}
                        className={`w-full cursor-pointer px-4 py-3 text-left transition-colors hover:bg-slate-50 ${
                          selectedConnector?.key === c.key ? "bg-blue-50" : ""
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="min-w-0">
                            <p className="truncate font-bold text-slate-950">{c.name}</p>
                            <p className="font-mono text-xs text-slate-400">{c.key}</p>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                            <span
                              className={`h-2 w-2 rounded-full ${STATUS_DOT[c.status] ?? "bg-slate-300"}`}
                            />
                            <ChevronRight className="h-4 w-4 text-slate-400" />
                          </div>
                        </div>
                        <div className="mt-1">
                          <TypeBadge type={c.type} />
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Detail Panel */}
              <div className="space-y-5">
                {!selectedConnector ? (
                  <div className="flex h-64 items-center justify-center rounded-3xl border bg-white shadow-sm">
                    <div className="text-center">
                      <Settings className="mx-auto mb-3 h-10 w-10 text-slate-300" />
                      <p className="font-semibold text-slate-400">
                        Select a connector to view details
                      </p>
                    </div>
                  </div>
                ) : detailLoading ? (
                  <div className="flex h-64 items-center justify-center rounded-3xl border bg-white shadow-sm">
                    <Loader className="h-8 w-8 animate-spin text-slate-400" />
                  </div>
                ) : (
                  <>
                    {/* Connector Info */}
                    <div className="rounded-3xl border bg-white p-5 shadow-sm">
                      <h3 className="mb-1 font-black text-slate-950">
                        {selectedConnector.name}
                      </h3>
                      <p className="mb-3 text-sm text-slate-500">
                        {selectedConnector.description || "No description."}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <TypeBadge type={selectedConnector.type} />
                        <span
                          className={`rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${
                            selectedConnector.status === "active"
                              ? "bg-emerald-50 text-emerald-700"
                              : selectedConnector.status === "error"
                              ? "bg-red-50 text-red-700"
                              : "bg-slate-100 text-slate-600"
                          }`}
                        >
                          {selectedConnector.status}
                        </span>
                      </div>
                    </div>

                    {/* Table Mapping */}
                    <div className="rounded-3xl border bg-white p-5 shadow-sm">
                      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <h3 className="font-black text-slate-950">Table Mapping</h3>
                          <p className="mt-1 text-xs text-slate-500">
                            Choose which external source table feeds an approved HRMS destination.
                          </p>
                        </div>
                        <button
                          onClick={() => setTableMapForm(emptyTableMapForm())}
                          className="w-fit cursor-pointer rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                        >
                          New Table Mapping
                        </button>
                      </div>

                      <div className="mb-5 grid gap-3 rounded-2xl border border-violet-100 bg-violet-50/50 p-4 md:grid-cols-[1fr_auto_1fr_1fr_auto] md:items-end">
                        <div>
                          <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">
                            Source Table
                          </label>
                          <select
                            value={tableMapForm.source_table}
                            onChange={(event) => setTableMapForm({ ...tableMapForm, source_table: event.target.value })}
                            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 font-mono text-sm text-slate-900"
                          >
                            <option value="">Select source table</option>
                            {sourceSchemas.map((schema) => (
                              <option key={schema.table} value={schema.table}>{schema.table}</option>
                            ))}
                          </select>
                        </div>
                        <ChevronRight className="mb-2 hidden h-4 w-4 text-slate-400 md:block" />
                        <div>
                          <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">
                            HRMS Target Table
                          </label>
                          <select
                            value={tableMapForm.target_table}
                            onChange={(event) => setTableMapForm({ ...tableMapForm, target_table: event.target.value })}
                            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 font-mono text-sm text-slate-900"
                          >
                            {mappingTargets.map((target) => (
                              <option key={target.table} value={target.table}>{target.table}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">
                            Sync Mode
                          </label>
                          <select
                            value={tableMapForm.sync_mode}
                            onChange={(event) => setTableMapForm({ ...tableMapForm, sync_mode: event.target.value as "daily_aggregate" })}
                            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900"
                          >
                            <option value="daily_aggregate">Daily aggregate</option>
                          </select>
                        </div>
                        <button
                          onClick={() => void saveTableMap()}
                          disabled={tableMappingSaving || sourceSchemas.length === 0}
                          className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl bg-violet-700 px-4 py-2 text-xs font-black text-white hover:bg-violet-800 disabled:opacity-50"
                        >
                          {tableMappingSaving && <Loader className="h-3.5 w-3.5 animate-spin" />}
                          Save
                        </button>
                      </div>

                      {sourceSchemas.length === 0 && (
                        <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                          No live source schema could be loaded. Check credentials, source tables, and network access.
                        </div>
                      )}

                      {tableMaps.length > 0 ? (
                        <div className="space-y-2">
                          {tableMaps.map((mapping) => (
                            <div key={mapping.id} className="flex flex-wrap items-center gap-3 rounded-2xl bg-violet-50 px-4 py-3 text-sm">
                              <span className="font-mono font-semibold text-slate-800">{mapping.source_table}</span>
                              <ChevronRight className="h-4 w-4 text-violet-500" />
                              <span className="font-mono font-semibold text-slate-800">{mapping.target_table}</span>
                              <span className="rounded-lg bg-white px-2 py-1 text-xs font-bold text-violet-700">
                                {mapping.sync_mode.replace("_", " ")}
                              </span>
                              <button
                                onClick={() => editTableMap(mapping)}
                                className="ml-auto cursor-pointer rounded-lg border border-violet-200 bg-white px-2 py-1 text-xs font-bold text-violet-700 hover:bg-violet-100"
                              >
                                Edit
                              </button>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="rounded-2xl border border-dashed py-6 text-center text-sm text-slate-400">
                          No table mappings configured. Automatic promotion stays blocked until one is saved.
                        </div>
                      )}
                    </div>

                    {/* Header Mapping */}
                    <div className="rounded-3xl border bg-white p-5 shadow-sm">
                      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <h3 className="font-black text-slate-950">Header Mapping</h3>
                          <p className="mt-1 text-xs text-slate-500">
                            Map actual source headers into columns of the selected HRMS target table.
                          </p>
                        </div>
                        <button
                          onClick={() => setFieldMapForm(emptyFieldMapForm())}
                          className="w-fit cursor-pointer rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
                        >
                          New Header Mapping
                        </button>
                      </div>

                      <div className="mb-5 rounded-2xl border border-blue-100 bg-blue-50/50 p-4">
                        <div className="grid gap-3 md:grid-cols-5">
                          <div>
                            <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">
                              Source Table
                            </label>
                            <select
                              value={fieldMapForm.source_table}
                              onChange={(event) => setFieldMapForm({
                                ...fieldMapForm,
                                source_table: event.target.value,
                                source_field: "",
                                target_table: tableMaps.find((mapping) => mapping.source_table === event.target.value)?.target_table
                                  ?? fieldMapForm.target_table,
                              })}
                              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 font-mono text-sm text-slate-900"
                            >
                              <option value="">Select table</option>
                              {sourceSchemas.map((schema) => (
                                <option key={schema.table} value={schema.table}>{schema.table}</option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">
                              Source Header
                            </label>
                            <select
                              value={fieldMapForm.source_field}
                              onChange={(event) => setFieldMapForm({ ...fieldMapForm, source_field: event.target.value })}
                              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 font-mono text-sm text-slate-900"
                            >
                              <option value="">Select header</option>
                              {(sourceSchemas.find((schema) => schema.table === fieldMapForm.source_table)?.columns ?? []).map((column) => (
                                <option key={column.name} value={column.name}>{column.name} ({column.type})</option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">
                              Target Table
                            </label>
                            <select
                              value={fieldMapForm.target_table}
                              onChange={(event) => setFieldMapForm({ ...fieldMapForm, target_table: event.target.value, target_column: "" })}
                              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 font-mono text-sm text-slate-900"
                            >
                              <option value="">Select target</option>
                              {mappingTargets.map((target) => (
                                <option key={target.table} value={target.table}>{target.table}</option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">
                              Target Column
                            </label>
                            <select
                              value={fieldMapForm.target_column}
                              onChange={(event) => setFieldMapForm({ ...fieldMapForm, target_column: event.target.value })}
                              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 font-mono text-sm text-slate-900"
                            >
                              <option value="">Select column</option>
                              {(mappingTargets.find((target) => target.table === fieldMapForm.target_table)?.columns ?? []).map((column) => (
                                <option key={column} value={column}>{column}</option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">
                              Transform
                            </label>
                            <input
                              value={fieldMapForm.transform}
                              onChange={(event) => setFieldMapForm({ ...fieldMapForm, transform: event.target.value })}
                              placeholder="trim|upper"
                              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 font-mono text-sm text-slate-900 outline-none focus:border-blue-400"
                            />
                          </div>
                        </div>
                        <div className="mt-3 flex justify-end">
                          <button
                            onClick={() => void saveFieldMap()}
                            disabled={mappingSaving}
                            className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-slate-950 px-4 py-2 text-xs font-black text-white hover:bg-slate-800 disabled:opacity-60"
                          >
                            {mappingSaving && <Loader className="h-3.5 w-3.5 animate-spin" />}
                            Save Mapping
                          </button>
                        </div>
                      </div>

                      {/* Confirmed Mappings */}
                      {fieldMaps.length > 0 && (
                        <div className="mb-5">
                          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
                            Active Mappings
                          </p>
                          <div className="space-y-2">
                            {fieldMaps.map((fm) => (
                              <div
                                key={fm.id}
                                className="flex items-center gap-3 rounded-2xl bg-emerald-50 px-4 py-3 text-sm"
                              >
                                <span className="font-mono font-semibold text-slate-700">
                                  {fm.source_table}.{fm.source_field}
                                </span>
                                <ChevronRight className="h-4 w-4 flex-shrink-0 text-slate-400" />
                                <span className="font-mono font-semibold text-slate-700">
                                  {fm.target_field}
                                </span>
                                {fm.transform && (
                                  <span className="rounded-lg bg-white px-2 py-1 text-xs text-slate-500 border">
                                    {fm.transform}
                                  </span>
                                )}
                                <button
                                  onClick={() => editFieldMap(fm)}
                                  className="ml-auto cursor-pointer rounded-lg border border-emerald-200 bg-white px-2 py-1 text-xs font-bold text-emerald-700 hover:bg-emerald-100"
                                >
                                  Edit
                                </button>
                                <CheckCircle2 className="h-4 w-4 flex-shrink-0 text-emerald-600" />
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Suggestions */}
                      {suggestions.length > 0 && (
                        <div>
                          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
                            Suggested Mappings
                          </p>
                          <div className="space-y-2">
                            {suggestions.map((s) => (
                              <div
                                key={s.suggestion_id}
                                className={`flex items-center gap-3 rounded-2xl border px-4 py-3 text-sm transition-colors ${
                                  s.confirmed
                                    ? "border-emerald-200 bg-emerald-50"
                                    : "border-slate-200 bg-slate-50"
                                }`}
                              >
                                <span className="font-mono text-sm text-slate-700">
                                  {s.source_field}
                                </span>
                                <ChevronRight className="h-4 w-4 flex-shrink-0 text-slate-400" />
                                <span className="font-mono text-sm text-slate-700">
                                  {s.target_field}
                                </span>
                                <span
                                  className={`ml-auto rounded-lg px-2 py-0.5 text-xs font-bold ${
                                    s.confidence >= 0.9
                                      ? "bg-emerald-100 text-emerald-700"
                                      : s.confidence >= 0.7
                                      ? "bg-amber-100 text-amber-700"
                                      : "bg-slate-100 text-slate-600"
                                  }`}
                                >
                                  {Math.round(s.confidence * 100)}%
                                </span>
                                {s.confirmed ? (
                                  <CheckCircle2 className="h-4 w-4 text-emerald-600 flex-shrink-0" />
                                ) : (
                                  <button
                                    onClick={() => void confirmSuggestion(s.suggestion_id)}
                                    disabled={confirmingId === s.suggestion_id}
                                    className="cursor-pointer rounded-xl bg-slate-950 px-3 py-1.5 text-xs font-bold text-white hover:bg-slate-800 transition-colors disabled:opacity-50 flex-shrink-0"
                                  >
                                    {confirmingId === s.suggestion_id ? (
                                      <Loader className="h-3 w-3 animate-spin" />
                                    ) : (
                                      "Confirm"
                                    )}
                                  </button>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {fieldMaps.length === 0 && suggestions.length === 0 && (
                        <div className="rounded-2xl border border-dashed py-8 text-center text-sm text-slate-400">
                          No header mappings yet. Add one above or confirm a suggestion when available.
                        </div>
                      )}
                    </div>

                    {/* Schedule */}
                    <div className="rounded-3xl border bg-white p-5 shadow-sm">
                      <div className="mb-4 flex items-center justify-between">
                        <h3 className="font-black text-slate-950">Sync Schedule</h3>
                        {!scheduleEditing ? (
                          <button
                            onClick={() => setScheduleEditing(true)}
                            className="cursor-pointer rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
                          >
                            Edit
                          </button>
                        ) : (
                          <div className="flex gap-2">
                            <button
                              onClick={() => setScheduleEditing(false)}
                              className="cursor-pointer rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition-colors"
                            >
                              Cancel
                            </button>
                            <button
                              onClick={() => void saveSchedule()}
                              className="cursor-pointer rounded-xl bg-slate-950 px-3 py-1.5 text-xs font-bold text-white hover:bg-slate-800 transition-colors"
                            >
                              Save
                            </button>
                          </div>
                        )}
                      </div>
                      {schedule ? (
                        <div className="space-y-4">
                          <div className={`rounded-2xl border px-4 py-3 text-sm ${
                            schedule.is_enabled
                              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                              : "border-amber-200 bg-amber-50 text-amber-800"
                          }`}>
                            {schedule.is_enabled
                              ? "Automatic sync is enabled. This runs on the backend server even when Super Admin is logged out."
                              : "Automatic sync is disabled. Turn Enabled on and save to start backend scheduled sync."}
                          </div>
                          <div>
                            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
                              Cron Expression
                            </label>
                            {scheduleEditing ? (
                              <input
                                value={schedule.cron_expression}
                                onChange={(e) =>
                                  setSchedule({ ...schedule, cron_expression: e.target.value })
                                }
                                className="w-full rounded-2xl border px-4 py-3 font-mono text-sm outline-none focus:border-blue-400 transition-colors"
                                placeholder="e.g. 0 * * * *"
                              />
                            ) : (
                              <p className="rounded-2xl bg-slate-50 px-4 py-3 font-mono text-sm text-slate-700">
                                {schedule.cron_expression || "–"}
                              </p>
                            )}
                          </div>
                          <div className="flex items-center justify-between rounded-2xl bg-slate-50 px-4 py-3">
                            <span className="text-sm font-semibold text-slate-700">Enabled</span>
                            <button
                              onClick={() =>
                                scheduleEditing &&
                                setSchedule({ ...schedule, is_enabled: !schedule.is_enabled })
                              }
                              className={`cursor-pointer text-slate-700 transition-colors ${
                                !scheduleEditing ? "pointer-events-none opacity-60" : ""
                              }`}
                            >
                              {schedule.is_enabled ? (
                                <ToggleRight className="h-6 w-6 text-emerald-600" />
                              ) : (
                                <ToggleLeft className="h-6 w-6 text-slate-400" />
                              )}
                            </button>
                          </div>
                          <div className="grid grid-cols-2 gap-3 text-sm">
                            <div className="rounded-2xl bg-slate-50 px-4 py-3">
                              <p className="text-xs font-semibold text-slate-500">Last Run</p>
                              <p className="mt-1 font-mono text-slate-700">
                                {schedule.last_run_at
                                  ? schedule.last_run_at.slice(0, 16).replace("T", " ")
                                  : "Never"}
                              </p>
                            </div>
                            <div className="rounded-2xl bg-slate-50 px-4 py-3">
                              <p className="text-xs font-semibold text-slate-500">Next Run</p>
                              <p className="mt-1 font-mono text-slate-700">
                                {schedule.next_run_at
                                  ? schedule.next_run_at.slice(0, 16).replace("T", " ")
                                  : "–"}
                              </p>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="rounded-2xl border border-dashed py-8 text-center text-sm text-slate-400">
                          No schedule configured for this connector.
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Database Config Modal ───────────────────────────────────────────── */}
      {dbConfigOpen && activeDbKey && (() => {
        const dc = dbConnectors.find(d => d.integration_key === activeDbKey);
        if (!dc) return null;
        const cfg = dc.config_json ?? {};
        return (
          <DatabaseConfigModal
            open={dbConfigOpen}
            onClose={() => { setDbConfigOpen(false); void loadDbConnectors(); }}
            integrationKey={activeDbKey}
            name={dc.integration_name}
            initialConfig={cfg}
          />
        );
      })()}

      {/* ── Add Connector Modal ─────────────────────────────────────────────── */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4">
          <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-3xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b p-6">
              <h2 className="text-lg font-black text-slate-950">Add Connector</h2>
              <button
                onClick={() => setShowAddModal(false)}
                className="cursor-pointer text-slate-400 hover:text-slate-700 transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-4 p-6">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1.5 block text-sm font-semibold text-slate-700">
                    Key <span className="text-red-500">*</span>
                  </label>
                  <input
                    value={newForm.key}
                    onChange={(e) => setNewForm({ ...newForm, key: e.target.value })}
                    placeholder="e.g. salesforce_sync"
                    className="w-full rounded-2xl border px-4 py-3 font-mono text-sm outline-none focus:border-blue-400 transition-colors"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-semibold text-slate-700">
                    Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    value={newForm.name}
                    onChange={(e) => setNewForm({ ...newForm, name: e.target.value })}
                    placeholder="e.g. Salesforce Sync"
                    className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 transition-colors"
                  />
                </div>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-semibold text-slate-700">
                  Connector Type
                </label>
                <select
                  value={newForm.kind}
                  onChange={(event) => {
                    const kind = event.target.value as ConnectorKind;
                    setNewForm({
                      ...newForm,
                      kind,
                      port: kind === "mssql" ? "1433" : kind === "mysql" ? "3306" : newForm.port,
                    });
                  }}
                  className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 transition-colors"
                >
                  <option value="api">REST API</option>
                  <option value="mysql">MySQL Database</option>
                  <option value="mssql">Microsoft SQL Server</option>
                  <option value="google_sheets">Google Sheets</option>
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-semibold text-slate-700">
                  Description
                </label>
                <textarea
                  value={newForm.description}
                  onChange={(e) => setNewForm({ ...newForm, description: e.target.value })}
                  placeholder="Brief description of this connector…"
                  rows={2}
                  className="w-full resize-none rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 transition-colors"
                />
              </div>

              {newForm.kind === "api" && (
                <div className="space-y-4 rounded-2xl border border-blue-100 bg-blue-50/50 p-4">
                  <div className="flex items-center gap-2 font-bold text-blue-900">
                    <Zap className="h-4 w-4" />
                    API Configuration
                  </div>
                  <div>
                    <label className="mb-1.5 block text-sm font-semibold text-slate-700">
                      Base URL <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="url"
                      value={newForm.base_url}
                      onChange={(event) => setNewForm({ ...newForm, base_url: event.target.value })}
                      placeholder="https://api.example.com/v1/employees"
                      className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400"
                    />
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <label className="mb-1.5 block text-sm font-semibold text-slate-700">HTTP Method</label>
                      <select
                        value={newForm.method}
                        onChange={(event) => setNewForm({ ...newForm, method: event.target.value as "GET" | "POST" })}
                        className="w-full rounded-2xl border px-4 py-3 text-sm"
                      >
                        <option value="GET">GET</option>
                        <option value="POST">POST</option>
                      </select>
                    </div>
                    <div>
                      <label className="mb-1.5 block text-sm font-semibold text-slate-700">Authentication</label>
                      <select
                        value={newForm.auth_type}
                        onChange={(event) => setNewForm({ ...newForm, auth_type: event.target.value as NewConnectorForm["auth_type"] })}
                        className="w-full rounded-2xl border px-4 py-3 text-sm"
                      >
                        <option value="none">No authentication</option>
                        <option value="api_key">API key</option>
                        <option value="bearer">Bearer token</option>
                        <option value="basic">Basic authentication</option>
                      </select>
                    </div>
                    <div>
                      <label className="mb-1.5 block text-sm font-semibold text-slate-700">Auth Header</label>
                      <input
                        value={newForm.auth_header}
                        onChange={(event) => setNewForm({ ...newForm, auth_header: event.target.value })}
                        className="w-full rounded-2xl border px-4 py-3 text-sm"
                      />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-sm font-semibold text-slate-700">Credential Secret Reference</label>
                      <input
                        value={newForm.secret_name}
                        onChange={(event) => setNewForm({ ...newForm, secret_name: event.target.value })}
                        placeholder="e.g. HRMS_VENDOR_API"
                        className="w-full rounded-2xl border px-4 py-3 font-mono text-sm"
                      />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-sm font-semibold text-slate-700">Pagination</label>
                      <select
                        value={newForm.pagination}
                        onChange={(event) => setNewForm({ ...newForm, pagination: event.target.value as NewConnectorForm["pagination"] })}
                        className="w-full rounded-2xl border px-4 py-3 text-sm"
                      >
                        <option value="none">None</option>
                        <option value="page">Page number</option>
                        <option value="offset">Offset and limit</option>
                        <option value="cursor">Cursor</option>
                      </select>
                    </div>
                    <div>
                      <label className="mb-1.5 block text-sm font-semibold text-slate-700">Timeout (seconds)</label>
                      <input
                        type="number"
                        min="1"
                        max="300"
                        value={newForm.timeout_seconds}
                        onChange={(event) => setNewForm({ ...newForm, timeout_seconds: event.target.value })}
                        className="w-full rounded-2xl border px-4 py-3 text-sm"
                      />
                    </div>
                  </div>
                  <p className="text-xs text-blue-800">
                    Store the API key or token in the deployment secret manager using this reference. Secrets are never written to visible connector JSON.
                  </p>
                </div>
              )}

              {(newForm.kind === "mysql" || newForm.kind === "mssql") && (
                <div className="space-y-4 rounded-2xl border border-violet-100 bg-violet-50/50 p-4">
                  <div className="flex items-center gap-2 font-bold text-violet-900">
                    <Database className="h-4 w-4" />
                    {newForm.kind === "mssql" ? "Microsoft SQL Server" : "MySQL"} Configuration
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <label className="mb-1.5 block text-sm font-semibold text-slate-700">Host / IP *</label>
                      <input
                        value={newForm.host}
                        onChange={(event) => setNewForm({ ...newForm, host: event.target.value })}
                        placeholder="db.internal.example"
                        className="w-full rounded-2xl border px-4 py-3 text-sm"
                      />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-sm font-semibold text-slate-700">Port *</label>
                      <input
                        type="number"
                        value={newForm.port}
                        onChange={(event) => setNewForm({ ...newForm, port: event.target.value })}
                        className="w-full rounded-2xl border px-4 py-3 text-sm"
                      />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-sm font-semibold text-slate-700">Database *</label>
                      <input
                        value={newForm.database}
                        onChange={(event) => setNewForm({ ...newForm, database: event.target.value })}
                        className="w-full rounded-2xl border px-4 py-3 text-sm"
                      />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-sm font-semibold text-slate-700">Username *</label>
                      <input
                        value={newForm.username}
                        onChange={(event) => setNewForm({ ...newForm, username: event.target.value })}
                        className="w-full rounded-2xl border px-4 py-3 text-sm"
                      />
                    </div>
                    <div className="md:col-span-2">
                      <label className="mb-1.5 block text-sm font-semibold text-slate-700">Password</label>
                      <input
                        type="password"
                        autoComplete="new-password"
                        value={newForm.password}
                        onChange={(event) => setNewForm({ ...newForm, password: event.target.value })}
                        className="w-full rounded-2xl border px-4 py-3 text-sm"
                      />
                      <p className="mt-1 text-xs text-violet-800">Encrypted with AES-256-GCM before database storage.</p>
                    </div>
                    <div className="md:col-span-2">
                      <label className="mb-1.5 block text-sm font-semibold text-slate-700">Source Tables</label>
                      <input
                        value={newForm.tables}
                        onChange={(event) => setNewForm({ ...newForm, tables: event.target.value })}
                        placeholder="attendance_log, agent_sessions"
                        className="w-full rounded-2xl border px-4 py-3 text-sm"
                      />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-sm font-semibold text-slate-700">Date Column</label>
                      <input
                        value={newForm.date_column}
                        onChange={(event) => setNewForm({ ...newForm, date_column: event.target.value })}
                        className="w-full rounded-2xl border px-4 py-3 text-sm"
                      />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-sm font-semibold text-slate-700">Employee Code Column</label>
                      <input
                        value={newForm.employee_code_column}
                        onChange={(event) => setNewForm({ ...newForm, employee_code_column: event.target.value })}
                        className="w-full rounded-2xl border px-4 py-3 text-sm"
                      />
                    </div>
                  </div>
                  {newForm.kind === "mssql" && (
                    <div className="flex flex-wrap gap-5 text-sm font-semibold text-slate-700">
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={newForm.encrypt}
                          onChange={(event) => setNewForm({ ...newForm, encrypt: event.target.checked })}
                        />
                        Encrypt connection
                      </label>
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={newForm.trust_server_certificate}
                          onChange={(event) => setNewForm({ ...newForm, trust_server_certificate: event.target.checked })}
                        />
                        Trust server certificate
                      </label>
                    </div>
                  )}
                </div>
              )}

              {newForm.kind === "google_sheets" && (
                <div className="space-y-4 rounded-2xl border border-emerald-100 bg-emerald-50/50 p-4">
                  <div className="flex items-center gap-2 font-bold text-emerald-900">
                    <FileSpreadsheet className="h-4 w-4" />
                    Google Sheets Configuration
                  </div>
                  <div>
                    <label className="mb-1.5 block text-sm font-semibold text-slate-700">Spreadsheet ID *</label>
                    <input
                      value={newForm.spreadsheet_id}
                      onChange={(event) => setNewForm({ ...newForm, spreadsheet_id: event.target.value })}
                      placeholder="The ID between /d/ and /edit in the Sheets URL"
                      className="w-full rounded-2xl border px-4 py-3 font-mono text-sm"
                    />
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <label className="mb-1.5 block text-sm font-semibold text-slate-700">Sheet / Tab Name</label>
                      <input
                        value={newForm.sheet_name}
                        onChange={(event) => setNewForm({ ...newForm, sheet_name: event.target.value })}
                        className="w-full rounded-2xl border px-4 py-3 text-sm"
                      />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-sm font-semibold text-slate-700">Range</label>
                      <input
                        value={newForm.sheet_range}
                        onChange={(event) => setNewForm({ ...newForm, sheet_range: event.target.value })}
                        placeholder="A:Z"
                        className="w-full rounded-2xl border px-4 py-3 font-mono text-sm"
                      />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-sm font-semibold text-slate-700">Header Row</label>
                      <input
                        type="number"
                        min="1"
                        value={newForm.header_row}
                        onChange={(event) => setNewForm({ ...newForm, header_row: event.target.value })}
                        className="w-full rounded-2xl border px-4 py-3 text-sm"
                      />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-sm font-semibold text-slate-700">Sync Direction</label>
                      <select
                        value={newForm.sync_direction}
                        onChange={(event) => setNewForm({ ...newForm, sync_direction: event.target.value as "pull" | "push" })}
                        className="w-full rounded-2xl border px-4 py-3 text-sm"
                      >
                        <option value="pull">Pull from Google Sheets</option>
                        <option value="push">Push to Google Sheets</option>
                      </select>
                    </div>
                    <div>
                      <label className="mb-1.5 block text-sm font-semibold text-slate-700">Authentication</label>
                      <select
                        value={newForm.sheets_auth_mode}
                        onChange={(event) => setNewForm({ ...newForm, sheets_auth_mode: event.target.value as NewConnectorForm["sheets_auth_mode"] })}
                        className="w-full rounded-2xl border px-4 py-3 text-sm"
                      >
                        <option value="service_account">Service account</option>
                        <option value="oauth">OAuth</option>
                        <option value="public">Public read-only sheet</option>
                      </select>
                    </div>
                    <div>
                      <label className="mb-1.5 block text-sm font-semibold text-slate-700">Credential Secret Reference</label>
                      <input
                        value={newForm.secret_name}
                        onChange={(event) => setNewForm({ ...newForm, secret_name: event.target.value })}
                        placeholder="e.g. GOOGLE_HRMS_SHEETS"
                        className="w-full rounded-2xl border px-4 py-3 font-mono text-sm"
                      />
                    </div>
                    {newForm.sheets_auth_mode === "service_account" && (
                      <div className="md:col-span-2">
                        <label className="mb-1.5 block text-sm font-semibold text-slate-700">Service Account Email</label>
                        <input
                          type="email"
                          value={newForm.service_account_email}
                          onChange={(event) => setNewForm({ ...newForm, service_account_email: event.target.value })}
                          placeholder="hrms-sync@project.iam.gserviceaccount.com"
                          className="w-full rounded-2xl border px-4 py-3 text-sm"
                        />
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
            <div className="flex gap-3 border-t p-6">
              <button
                onClick={() => setShowAddModal(false)}
                className="flex-1 cursor-pointer rounded-2xl border border-slate-200 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => void addConnector()}
                className="flex-1 cursor-pointer rounded-2xl bg-slate-950 py-3 text-sm font-bold text-white hover:bg-slate-800 transition-colors"
              >
                Add Connector
              </button>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
