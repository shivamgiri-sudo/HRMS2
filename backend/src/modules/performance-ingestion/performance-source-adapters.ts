import axios from "axios";
import sql from "mssql";
import mysql from "mysql2/promise";
import * as XLSX from "xlsx";
import {
  getCredentialsForKey,
  getPoolForKey,
} from "../external-db/external-db.service.js";
import type {
  DatabaseDatasetConfig,
  PerformanceDataset,
  SourceRow,
} from "./performance-ingestion.types.js";

const MUTATING_SQL = /\b(INSERT|UPDATE|DELETE|MERGE|DROP|ALTER|TRUNCATE|CREATE|GRANT|REVOKE|EXEC(?:UTE)?|CALL|REPLACE|LOAD\s+DATA|INTO\s+OUTFILE)\b/i;
const STARTS_READ_ONLY = /^\s*(SELECT|WITH)\b/i;
const GOOGLE_SHEET_HOSTS = new Set([
  "docs.google.com",
  "drive.google.com",
  "sheets.googleapis.com",
]);

export function assertReadOnlyQuery(query: string): void {
  const normalised = String(query ?? "").trim();
  if (!normalised) throw new Error("Dataset query is not configured");
  if (!STARTS_READ_ONLY.test(normalised)) {
    throw new Error("Only SELECT or WITH queries are allowed for performance sources");
  }
  if (MUTATING_SQL.test(normalised)) {
    throw new Error("Mutating SQL is forbidden for performance source connectors");
  }
  if (normalised.replace(/;\s*$/, "").includes(";")) {
    throw new Error("Multiple SQL statements are not allowed");
  }
}

function isAllowedGoogleHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  return GOOGLE_SHEET_HOSTS.has(host) || host.endsWith(".googleusercontent.com");
}

export function assertAllowedGoogleSheetUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("Google Sheet dataset requires a valid CSV export URL");
  }
  if (url.protocol !== "https:" || !isAllowedGoogleHost(url.hostname)) {
    throw new Error("Google Sheet exports are restricted to approved Google HTTPS hosts");
  }
  if (url.username || url.password) {
    throw new Error("Google Sheet export URLs cannot contain embedded credentials");
  }
  return url;
}

export function assertConnectorType(
  datasetType: PerformanceDataset["sourceType"],
  connectorType: "mysql" | "mssql",
): void {
  if (datasetType !== connectorType) {
    throw new Error(
      `Dataset source type ${datasetType} does not match connector type ${connectorType}`,
    );
  }
}

function boundedMaxRows(dataset: PerformanceDataset): number {
  const configured = Number((dataset.config as { maxRows?: number }).maxRows ?? 10_000);
  if (!Number.isFinite(configured)) return 10_000;
  return Math.max(1, Math.min(100_000, Math.trunc(configured)));
}

function queryArguments(
  config: DatabaseDatasetConfig,
  input: { from: string; to: string; checkpoint?: string | null },
): string[] {
  const values: Record<"from" | "to" | "checkpoint", string> = {
    from: input.from,
    to: input.to,
    checkpoint: input.checkpoint ?? "",
  };
  return (config.queryParams ?? ["from", "to"]).map((name) => values[name]);
}

async function readDatabaseRows(
  dataset: PerformanceDataset,
  input: { from: string; to: string; checkpoint?: string | null },
): Promise<SourceRow[]> {
  if (!dataset.connectorKey) throw new Error("Database dataset has no connector key");
  const credentials = await getCredentialsForKey(dataset.connectorKey);
  if (!credentials) throw new Error(`Connector ${dataset.connectorKey} is not configured`);
  assertConnectorType(dataset.sourceType, credentials.db_type);

  const config = dataset.config as DatabaseDatasetConfig;
  const maxRows = boundedMaxRows(dataset);

  if (credentials.db_type === "mysql") {
    const query = String(config.queryMysql ?? "");
    assertReadOnlyQuery(query);
    const pool = await getPoolForKey(dataset.connectorKey) as mysql.Pool;
    const [rows] = await pool.execute(query, queryArguments(config, input));
    return (rows as SourceRow[]).slice(0, maxRows);
  }

  const query = String(config.queryMssql ?? "");
  assertReadOnlyQuery(query);
  const pool = await getPoolForKey(dataset.connectorKey) as sql.ConnectionPool;
  const request = pool.request();
  request.input("from", sql.NVarChar(50), input.from);
  request.input("to", sql.NVarChar(50), input.to);
  request.input("checkpoint", sql.NVarChar(500), input.checkpoint ?? "");
  const result = await request.query(query);
  return (result.recordset as SourceRow[]).slice(0, maxRows);
}

function workbookRows(buffer: Buffer, maxRows: number): SourceRow[] {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true, raw: false });
  const firstSheet = workbook.SheetNames[0];
  if (!firstSheet) return [];
  const rows = XLSX.utils.sheet_to_json<SourceRow>(workbook.Sheets[firstSheet], {
    defval: null,
    raw: false,
  });
  return rows.slice(0, maxRows);
}

async function googleSheetRows(dataset: PerformanceDataset): Promise<SourceRow[]> {
  const rawUrl = String((dataset.config as { csvUrl?: string }).csvUrl ?? "").trim();
  const csvUrl = assertAllowedGoogleSheetUrl(rawUrl);
  const response = await axios.get<ArrayBuffer>(csvUrl.toString(), {
    responseType: "arraybuffer",
    timeout: 30_000,
    maxContentLength: 20 * 1024 * 1024,
    maxBodyLength: 20 * 1024 * 1024,
    maxRedirects: 3,
    beforeRedirect: (options) => {
      const redirectedHost = String(options.hostname ?? options.host ?? "");
      if (!isAllowedGoogleHost(redirectedHost)) {
        throw new Error("Google Sheet export redirect left the approved Google host allow-list");
      }
    },
  });
  return workbookRows(Buffer.from(response.data), boundedMaxRows(dataset));
}

export async function readPerformanceSourceRows(
  dataset: PerformanceDataset,
  input: {
    from: string;
    to: string;
    checkpoint?: string | null;
    uploadBuffer?: Buffer | null;
  },
): Promise<SourceRow[]> {
  if (dataset.sourceType === "mysql" || dataset.sourceType === "mssql") {
    return readDatabaseRows(dataset, input);
  }
  if (dataset.sourceType === "google_sheet") {
    return googleSheetRows(dataset);
  }
  if (dataset.sourceType === "excel" || dataset.sourceType === "csv") {
    if (!input.uploadBuffer) throw new Error("An Excel or CSV file is required for this dataset");
    return workbookRows(input.uploadBuffer, boundedMaxRows(dataset));
  }
  throw new Error(`Unsupported performance source type: ${dataset.sourceType}`);
}
