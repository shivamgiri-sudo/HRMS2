import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import type { DeepReportPack, DeepReportSourceGroup } from "./deep-report-packs.js";

export interface DeepReportFilters {
  branchId?: string;
  processId?: string;
  month?: string;
  from?: string;
  to?: string;
  authorizedBranchIds?: string[];
  scopeIsGlobal?: boolean;
}

interface ColumnMetadata extends RowDataPacket {
  table_name: string;
  column_name: string;
  data_type: string;
}

interface TableMetadata extends RowDataPacket {
  table_name: string;
  table_rows: number | null;
}

export interface DeepSourceHealth {
  key: string;
  label: string;
  description: string;
  required: boolean;
  state: "available" | "missing" | "error";
  selectedTable: string | null;
  availableTables: string[];
  missingCandidates: string[];
  rowCount: number | null;
  activeCount: number | null;
  issueCount: number | null;
  latestActivity: string | null;
  statusColumn: string | null;
  statusBreakdown: Array<{ status: string; count: number }>;
  missingBranchMappings: number | null;
  missingProcessMappings: number | null;
  appliedFilters: string[];
  error?: string;
}

const IDENTIFIER = /^[A-Za-z0-9_]+$/;
const MONTH = /^\d{4}-\d{2}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISSUE_STATUS = /(pending|failed|failure|error|rejected|overdue|unmapped|missing|hold|open|blocked|exception|expired|negative|mismatch)/i;
const ACTIVE_STATUS = /^(active|approved|completed|complete|closed|paid|verified|validated|success|successful|finalized|released|locked|disbursed|present)$/i;
const NO_SCOPE_SENTINEL = "__NO_BRANCH_SCOPE__";

function q(identifier: string) {
  if (!IDENTIFIER.test(identifier)) throw new Error(`Unsafe SQL identifier: ${identifier}`);
  return `\`${identifier}\``;
}

function normalizeFilters(filters: DeepReportFilters): DeepReportFilters {
  return {
    branchId: filters.branchId ? String(filters.branchId).trim() : undefined,
    processId: filters.processId ? String(filters.processId).trim() : undefined,
    month: filters.month && MONTH.test(filters.month) ? filters.month : undefined,
    from: filters.from && DATE.test(filters.from) ? filters.from : undefined,
    to: filters.to && DATE.test(filters.to) ? filters.to : undefined,
    authorizedBranchIds: [...new Set((filters.authorizedBranchIds ?? []).map(String).filter(Boolean))],
    scopeIsGlobal: Boolean(filters.scopeIsGlobal),
  };
}

function chooseColumn(columns: Set<string>, candidates: string[]) {
  return candidates.find((candidate) => columns.has(candidate)) ?? null;
}

function placeholders(values: unknown[]) {
  return values.map(() => "?").join(",");
}

function buildWhere(columns: Set<string>, filters: DeepReportFilters) {
  const clauses: string[] = [];
  const params: unknown[] = [];
  const applied: string[] = [];
  const authorised = filters.scopeIsGlobal ? [] : (filters.authorizedBranchIds ?? []);

  if (!filters.scopeIsGlobal && authorised.includes(NO_SCOPE_SENTINEL)) {
    return {
      sql: "",
      params: [],
      applied: [],
      unsafeReason: "The authenticated user has no authorised branch scope for reporting.",
    };
  }

  if (!filters.scopeIsGlobal && filters.branchId && !authorised.includes(filters.branchId)) {
    return {
      sql: "",
      params: [],
      applied: [],
      unsafeReason: "The requested branch is outside the authenticated user's reporting scope.",
    };
  }

  const effectiveBranches = filters.branchId
    ? [filters.branchId]
    : authorised;

  if (effectiveBranches.length > 0) {
    if (columns.has("branch_id")) {
      clauses.push(`${q("branch_id")} IN (${placeholders(effectiveBranches)})`);
      params.push(...effectiveBranches);
      applied.push(filters.branchId ? "branchId" : "authorisedBranchScope");
    } else if (columns.has("employee_id")) {
      clauses.push(`${q("employee_id")} IN (
        SELECT scoped_employee.id
          FROM employees scoped_employee
         WHERE scoped_employee.branch_id IN (${placeholders(effectiveBranches)})
      )`);
      params.push(...effectiveBranches);
      applied.push(filters.branchId ? "branchIdThroughEmployee" : "authorisedBranchScopeThroughEmployee");
    } else {
      return {
        sql: "",
        params: [],
        applied: [],
        unsafeReason: "This source cannot be safely restricted to the authenticated user's branch scope.",
      };
    }
  }

  if (filters.processId) {
    if (columns.has("process_id")) {
      clauses.push(`${q("process_id")} = ?`);
      params.push(filters.processId);
      applied.push("processId");
    } else if (columns.has("employee_id")) {
      clauses.push(`${q("employee_id")} IN (
        SELECT scoped_employee.id
          FROM employees scoped_employee
         WHERE scoped_employee.process_id = ?
      )`);
      params.push(filters.processId);
      applied.push("processIdThroughEmployee");
    } else {
      return {
        sql: "",
        params: [],
        applied: [],
        unsafeReason: "This source cannot be safely restricted to the selected Process.",
      };
    }
  }

  const periodColumn = chooseColumn(columns, ["period_code", "run_month", "payroll_month", "month"]);
  const dateColumn = chooseColumn(columns, [
    "record_date",
    "activity_date",
    "visit_date",
    "request_date",
    "effective_date",
    "event_date",
    "created_at",
    "updated_at",
    "date_of_joining",
  ]);

  if (filters.month) {
    if (periodColumn) {
      clauses.push(`${q(periodColumn)} = ?`);
      params.push(filters.month);
      applied.push("month");
    } else if (dateColumn) {
      clauses.push(`DATE_FORMAT(${q(dateColumn)}, '%Y-%m') = ?`);
      params.push(filters.month);
      applied.push("month");
    }
  } else if (dateColumn && (filters.from || filters.to)) {
    if (filters.from) {
      clauses.push(`DATE(${q(dateColumn)}) >= ?`);
      params.push(filters.from);
      applied.push("from");
    }
    if (filters.to) {
      clauses.push(`DATE(${q(dateColumn)}) <= ?`);
      params.push(filters.to);
      applied.push("to");
    }
  }

  return {
    sql: clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "",
    params,
    applied,
    unsafeReason: null as string | null,
  };
}

function sourceError(
  group: DeepReportSourceGroup,
  selectedTable: string | null,
  availableTables: string[],
  missingCandidates: string[],
  message: string
): DeepSourceHealth {
  return {
    key: group.key,
    label: group.label,
    description: group.description,
    required: group.required !== false,
    state: "error",
    selectedTable,
    availableTables,
    missingCandidates,
    rowCount: null,
    activeCount: null,
    issueCount: null,
    latestActivity: null,
    statusColumn: null,
    statusBreakdown: [],
    missingBranchMappings: null,
    missingProcessMappings: null,
    appliedFilters: [],
    error: message,
  };
}

async function probeSourceGroup(
  group: DeepReportSourceGroup,
  tableMap: Map<string, TableMetadata>,
  columnMap: Map<string, ColumnMetadata[]>,
  filters: DeepReportFilters
): Promise<DeepSourceHealth> {
  const availableTables = group.candidateTables.filter((table) => tableMap.has(table));
  const missingCandidates = group.candidateTables.filter((table) => !tableMap.has(table));
  const selectedTable = availableTables[0] ?? null;

  if (!selectedTable) {
    return {
      key: group.key,
      label: group.label,
      description: group.description,
      required: group.required !== false,
      state: "missing",
      selectedTable: null,
      availableTables: [],
      missingCandidates,
      rowCount: null,
      activeCount: null,
      issueCount: null,
      latestActivity: null,
      statusColumn: null,
      statusBreakdown: [],
      missingBranchMappings: null,
      missingProcessMappings: null,
      appliedFilters: [],
    };
  }

  try {
    const columns = new Set((columnMap.get(selectedTable) ?? []).map((column) => column.column_name));
    const where = buildWhere(columns, filters);
    if (where.unsafeReason) {
      return sourceError(group, selectedTable, availableTables, missingCandidates, where.unsafeReason);
    }

    const statusColumn = chooseColumn(columns, [
      "status",
      "approval_status",
      "payment_status",
      "lifecycle_status",
      "run_status",
      "employment_status",
      "verification_status",
      "active_status",
      "is_active",
    ]);
    const updatedColumn = chooseColumn(columns, [
      "updated_at",
      "created_at",
      "record_date",
      "activity_date",
      "visit_date",
      "effective_date",
      "event_date",
    ]);

    const [countRows] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM ${q(selectedTable)}${where.sql}`,
      where.params
    );
    const rowCount = Number(countRows[0]?.total ?? 0);

    let statusBreakdown: Array<{ status: string; count: number }> = [];
    let activeCount: number | null = null;
    let issueCount: number | null = null;
    if (statusColumn) {
      const [statusRows] = await db.execute<RowDataPacket[]>(
        `SELECT COALESCE(CAST(${q(statusColumn)} AS CHAR), '(null)') AS status, COUNT(*) AS count
           FROM ${q(selectedTable)}${where.sql}
          GROUP BY ${q(statusColumn)}
          ORDER BY count DESC
          LIMIT 20`,
        where.params
      );
      statusBreakdown = statusRows.map((row) => ({
        status: String(row.status ?? "(null)"),
        count: Number(row.count ?? 0),
      }));
      activeCount = statusBreakdown
        .filter((item) => ACTIVE_STATUS.test(item.status) || item.status === "1")
        .reduce((total, item) => total + item.count, 0);
      issueCount = statusBreakdown
        .filter((item) => ISSUE_STATUS.test(item.status) || item.status === "0")
        .reduce((total, item) => total + item.count, 0);
    }

    let latestActivity: string | null = null;
    if (updatedColumn) {
      const [latestRows] = await db.execute<RowDataPacket[]>(
        `SELECT MAX(${q(updatedColumn)}) AS latest FROM ${q(selectedTable)}${where.sql}`,
        where.params
      );
      latestActivity = latestRows[0]?.latest ? String(latestRows[0].latest) : null;
    }

    let missingBranchMappings: number | null = null;
    if (columns.has("branch_id")) {
      const [mappingRows] = await db.execute<RowDataPacket[]>(
        `SELECT SUM(CASE WHEN ${q("branch_id")} IS NULL OR CAST(${q("branch_id")} AS CHAR) = '' THEN 1 ELSE 0 END) AS missing
           FROM ${q(selectedTable)}${where.sql}`,
        where.params
      );
      missingBranchMappings = Number(mappingRows[0]?.missing ?? 0);
    }

    let missingProcessMappings: number | null = null;
    if (columns.has("process_id")) {
      const [mappingRows] = await db.execute<RowDataPacket[]>(
        `SELECT SUM(CASE WHEN ${q("process_id")} IS NULL OR CAST(${q("process_id")} AS CHAR) = '' THEN 1 ELSE 0 END) AS missing
           FROM ${q(selectedTable)}${where.sql}`,
        where.params
      );
      missingProcessMappings = Number(mappingRows[0]?.missing ?? 0);
    }

    return {
      key: group.key,
      label: group.label,
      description: group.description,
      required: group.required !== false,
      state: "available",
      selectedTable,
      availableTables,
      missingCandidates,
      rowCount,
      activeCount,
      issueCount,
      latestActivity,
      statusColumn,
      statusBreakdown,
      missingBranchMappings,
      missingProcessMappings,
      appliedFilters: where.applied,
    };
  } catch (error) {
    return sourceError(
      group,
      selectedTable,
      availableTables,
      missingCandidates,
      error instanceof Error ? error.message : String(error)
    );
  }
}

export const deepReportService = {
  async overview(pack: DeepReportPack, inputFilters: DeepReportFilters) {
    const filters = normalizeFilters(inputFilters);
    const candidateTables = [...new Set(pack.sourceGroups.flatMap((group) => group.candidateTables))]
      .filter((table) => IDENTIFIER.test(table));

    const tableMap = new Map<string, TableMetadata>();
    const columnMap = new Map<string, ColumnMetadata[]>();

    if (candidateTables.length) {
      const tablePlaceholders = candidateTables.map(() => "?").join(",");
      // Alias to lowercase explicitly — information_schema hands back UPPERCASE keys.
      //
      // MySQL 8 labels these TABLE_NAME / COLUMN_NAME / TABLE_ROWS however the SELECT
      // is written, so String(table.table_name) was "undefined" and both maps below
      // collapsed to a single "undefined" key. Every later lookup by real table name
      // missed, which silently emptied the column metadata the pack builder filters
      // on. Verified against live 8.0.42.
      const [tables] = await db.execute<TableMetadata[]>(
        `SELECT TABLE_NAME AS table_name, TABLE_ROWS AS table_rows
           FROM information_schema.tables
          WHERE table_schema = DATABASE()
            AND table_name IN (${tablePlaceholders})`,
        candidateTables
      );
      for (const table of tables) tableMap.set(String(table.table_name), table);

      const [columns] = await db.execute<ColumnMetadata[]>(
        `SELECT TABLE_NAME AS table_name, COLUMN_NAME AS column_name, DATA_TYPE AS data_type
           FROM information_schema.columns
          WHERE table_schema = DATABASE()
            AND table_name IN (${tablePlaceholders})`,
        candidateTables
      );
      for (const column of columns) {
        const tableName = String(column.table_name);
        if (!columnMap.has(tableName)) columnMap.set(tableName, []);
        columnMap.get(tableName)!.push(column);
      }
    }

    const sources: DeepSourceHealth[] = [];
    for (const group of pack.sourceGroups) {
      sources.push(await probeSourceGroup(group, tableMap, columnMap, filters));
    }

    const requiredSources = sources.filter((source) => source.required);
    const availableRequired = requiredSources.filter((source) => source.state === "available");
    const sourceErrors = sources.filter((source) => source.state === "error");
    const missingRequired = requiredSources.filter((source) => source.state === "missing");
    const mappingExceptions = sources.reduce(
      (total, source) => total + (source.missingBranchMappings ?? 0) + (source.missingProcessMappings ?? 0),
      0
    );
    const knownIssueCount = sources.reduce((total, source) => total + (source.issueCount ?? 0), 0);
    const knownRowCount = sources.reduce((total, source) => total + (source.rowCount ?? 0), 0);
    const activityValues = sources
      .map((source) => source.latestActivity)
      .filter((value): value is string => Boolean(value))
      .sort();
    const latestActivity = activityValues.length ? activityValues[activityValues.length - 1] : null;
    const coveragePct = requiredSources.length
      ? Number(((availableRequired.length / requiredSources.length) * 100).toFixed(1))
      : 100;

    const alerts = [
      ...missingRequired.map((source) => ({
        severity: "critical" as const,
        code: `MISSING_SOURCE_${source.key.toUpperCase()}`,
        message: `${source.label} has no recognised source table in the current schema.`,
      })),
      ...sourceErrors.map((source) => ({
        severity: "critical" as const,
        code: `SOURCE_ERROR_${source.key.toUpperCase()}`,
        message: `${source.label} could not be queried safely: ${source.error ?? "unknown error"}`,
      })),
      ...(mappingExceptions > 0
        ? [{
            severity: "warning" as const,
            code: "ORG_MAPPING_GAPS",
            message: `${mappingExceptions} branch/process mapping gaps were detected in available sources.`,
          }]
        : []),
      ...(pack.perspectives.flatMap((perspective) => perspective.reportCodes).length === 0
        ? [{
            severity: "info" as const,
            code: "NO_DRILLDOWN_REPORTS",
            message: "This section currently provides schema-aware control reporting but has no dedicated detailed report dataset.",
          }]
        : []),
    ];

    return {
      packCode: pack.code,
      generatedAt: new Date().toISOString(),
      filters: {
        branchId: filters.branchId,
        processId: filters.processId,
        month: filters.month,
        from: filters.from,
        to: filters.to,
      },
      kpis: {
        schemaCoveragePct: coveragePct,
        availableRequiredSources: availableRequired.length,
        requiredSources: requiredSources.length,
        knownRows: knownRowCount,
        knownIssues: knownIssueCount,
        mappingExceptions,
        latestActivity,
      },
      readiness: {
        ready: missingRequired.length === 0 && sourceErrors.length === 0,
        missingRequiredSources: missingRequired.map((source) => source.label),
        sourceErrors: sourceErrors.map((source) => source.label),
      },
      sources,
      alerts,
    };
  },
};
