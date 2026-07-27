import type { NextFunction, Response } from "express";
import { db } from "../../db/mysql.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";

const REDACTED_KEY = /(password|secret|token|credential|private[_-]?key|authorization)/i;
const MAX_JSON_LENGTH = 60_000;

function sanitise(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[DEPTH_LIMIT]";
  if (value === null || value === undefined) return value ?? null;
  if (typeof value === "string") return value.length > 4000 ? `${value.slice(0, 4000)}…` : value;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => sanitise(item, depth + 1));
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, 200)
        .map(([key, item]) => [
          key,
          REDACTED_KEY.test(key) ? "[REDACTED]" : sanitise(item, depth + 1),
        ]),
    );
  }
  return String(value);
}

function jsonValue(value: unknown): string | null {
  if (value === undefined) return null;
  const serialised = JSON.stringify(sanitise(value));
  if (serialised.length <= MAX_JSON_LENGTH) return serialised;
  return JSON.stringify({ truncated: true, preview: serialised.slice(0, MAX_JSON_LENGTH) });
}

function actionFor(method: string, path: string): string {
  if (method === "POST" && path === "/datasets") return "PERFORMANCE_DATASET_SAVED";
  if (method === "PATCH" && /\/datasets\/[^/]+\/status$/.test(path)) return "PERFORMANCE_DATASET_STATUS_CHANGED";
  if (method === "POST" && /\/datasets\/[^/]+\/approve$/.test(path)) return "PERFORMANCE_MAPPING_APPROVED";
  if (method === "POST" && /\/datasets\/[^/]+\/preview$/.test(path)) return "PERFORMANCE_SOURCE_PREVIEWED";
  if (method === "POST" && /\/datasets\/[^/]+\/publish$/.test(path)) return "PERFORMANCE_SOURCE_PUBLISHED";
  if (method === "POST" && path === "/identity-maps") return "PERFORMANCE_IDENTITY_MAPPED";
  if (method === "POST" && path === "/process-maps") return "PERFORMANCE_PROCESS_MAPPED";
  if (method === "POST" && /\/mapping-exceptions\/[^/]+\/resolve$/.test(path)) return "PERFORMANCE_EXCEPTION_RESOLVED";
  if (method === "PUT" && /\/datasets\/[^/]+\/schedule$/.test(path)) return "PERFORMANCE_SCHEDULE_CHANGED";
  if (method === "POST" && /\/datasets\/[^/]+\/run-now$/.test(path)) return "PERFORMANCE_SCHEDULE_RUN_NOW";
  return `PERFORMANCE_${method}_MUTATION`;
}

function entityFor(path: string): { entityType: string; entityId: string | null; datasetId: string | null } {
  const dataset = path.match(/^\/datasets\/([^/]+)/);
  if (dataset) {
    return { entityType: "performance_dataset", entityId: dataset[1], datasetId: dataset[1] };
  }
  const exception = path.match(/^\/mapping-exceptions\/([^/]+)/);
  if (exception) {
    return { entityType: "mapping_exception", entityId: exception[1], datasetId: null };
  }
  if (path === "/datasets") {
    return { entityType: "performance_dataset", entityId: null, datasetId: null };
  }
  if (path === "/identity-maps") {
    return { entityType: "identity_mapping", entityId: null, datasetId: null };
  }
  if (path === "/process-maps") {
    return { entityType: "process_mapping", entityId: null, datasetId: null };
  }
  return { entityType: "performance_governance", entityId: null, datasetId: null };
}

async function recordAudit(input: {
  req: AuthenticatedRequest;
  statusCode: number;
  responseBody: unknown;
}): Promise<void> {
  const { req, statusCode, responseBody } = input;
  const path = req.path;
  const entity = entityFor(path);
  const responseData = responseBody && typeof responseBody === "object"
    ? responseBody as Record<string, unknown>
    : {};
  const createdDatasetId = path === "/datasets"
    ? String((responseData.data as Record<string, unknown> | undefined)?.id ?? "") || null
    : null;
  const datasetId = createdDatasetId ?? entity.datasetId;

  await db.execute(
    `INSERT INTO performance_governance_audit
       (actor_user_id, action_code, entity_type, entity_id, dataset_id,
        after_json, metadata_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      req.authUser?.id ?? null,
      actionFor(req.method, path),
      entity.entityType,
      entity.entityId ?? createdDatasetId,
      datasetId,
      jsonValue(responseBody),
      jsonValue({
        method: req.method,
        path,
        statusCode,
        requestBody: req.body,
        query: req.query,
        actorRole: req.authUser?.role ?? null,
        actorRoles: req.authUser?.roles ?? [],
      }),
    ],
  );
}

export function performanceGovernanceAuditMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();

  const originalJson = res.json.bind(res);
  res.json = ((body: unknown) => {
    const successful = res.statusCode < 400 && !(
      body && typeof body === "object" && (body as Record<string, unknown>).success === false
    );
    if (successful) {
      void recordAudit({ req, statusCode: res.statusCode, responseBody: body }).catch((error) =>
        console.error(
          "[performance-governance-audit] write failed:",
          error instanceof Error ? error.message : String(error),
        ),
      );
    }
    return originalJson(body);
  }) as Response["json"];

  return next();
}
