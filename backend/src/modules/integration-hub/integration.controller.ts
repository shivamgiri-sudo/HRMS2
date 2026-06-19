import type { Response } from "express";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { integrationService } from "./integration.service.js";
import {
  confirmFieldMapSchema,
  createIntegrationSchema,
  runFiltersSchema,
  updateIntegrationSchema,
  upsertTableMapSchema,
  upsertScheduleSchema,
} from "./integration.validation.js";

function integrationTypeFromUi(value: unknown): string {
  const type = String(value ?? "").trim();
  const aliases: Record<string, string> = {
    api: "rest_pull",
    db: "database",
    manual: "file_upload",
    scheduled: "sftp",
  };
  return aliases[type] ?? type;
}

function integrationTypeToUi(value: unknown): "manual" | "api" | "db" | "scheduled" {
  const type = String(value ?? "");
  if (type === "database") return "db";
  if (type === "rest_pull" || type === "rest_push") return "api";
  if (type === "sftp") return "scheduled";
  return "manual";
}

function parseConfigJson(value: unknown): Record<string, unknown> | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (typeof value === "object") return value as Record<string, unknown>;
  try {
    return JSON.parse(String(value)) as Record<string, unknown>;
  } catch {
    throw Object.assign(new Error("config_json must be valid JSON"), { statusCode: 400 });
  }
}

const SENSITIVE_CONFIG_KEY = /(password|passphrase|private[_-]?key|api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|authorization)/i;

function sanitizeConfig(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeConfig);
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !SENSITIVE_CONFIG_KEY.test(key))
      .map(([key, item]) => [key, sanitizeConfig(item)])
  );
}

function connectorDto(record: any) {
  const {
    encrypted_credentials: _encryptedCredentials,
    config_json: configJson,
    ...safeRecord
  } = record;
  return {
    ...safeRecord,
    config_json: sanitizeConfig(configJson),
    key: record.integration_key,
    name: record.integration_name,
    type: integrationTypeToUi(record.integration_type),
    status: Number(record.active_status) === 1 ? "active" : "inactive",
    description: record.notes ?? "",
    last_run_at: record.last_run_at ?? null,
  };
}

function normalizeCreateBody(body: any) {
  return {
    integrationKey: body.integrationKey ?? body.key,
    integrationName: body.integrationName ?? body.name,
    integrationType: integrationTypeFromUi(body.integrationType ?? body.type),
    vendorName: body.vendorName ?? body.vendor_name ?? null,
    baseUrl: body.baseUrl ?? body.base_url ?? null,
    authType: body.authType ?? body.auth_type ?? null,
    secretName: body.secretName ?? body.secret_name ?? null,
    configJson: parseConfigJson(body.configJson ?? body.config_json),
    notes: body.notes ?? body.description ?? null,
  };
}

function normalizeUpdateBody(body: any) {
  const normalized: Record<string, unknown> = {};
  if (body.integrationName !== undefined || body.name !== undefined) normalized.integrationName = body.integrationName ?? body.name;
  if (body.integrationType !== undefined || body.type !== undefined) normalized.integrationType = integrationTypeFromUi(body.integrationType ?? body.type);
  if (body.vendorName !== undefined || body.vendor_name !== undefined) normalized.vendorName = body.vendorName ?? body.vendor_name;
  if (body.baseUrl !== undefined || body.base_url !== undefined) normalized.baseUrl = body.baseUrl ?? body.base_url;
  if (body.authType !== undefined || body.auth_type !== undefined) normalized.authType = body.authType ?? body.auth_type;
  if (body.secretName !== undefined || body.secret_name !== undefined) normalized.secretName = body.secretName ?? body.secret_name;
  if (body.configJson !== undefined || body.config_json !== undefined) normalized.configJson = parseConfigJson(body.configJson ?? body.config_json);
  if (body.notes !== undefined || body.description !== undefined) normalized.notes = body.notes ?? body.description;
  if (body.activeStatus !== undefined || body.active_status !== undefined) normalized.activeStatus = Boolean(body.activeStatus ?? body.active_status);
  return normalized;
}

export const integrationController = {
  async list(req: AuthenticatedRequest, res: Response) {
    const { activeStatus } = req.query as { activeStatus?: string };
    const filters =
      activeStatus === "active" || activeStatus === "inactive"
        ? { activeStatus: activeStatus as "active" | "inactive" | "all" }
        : undefined;
    const data = await integrationService.list(filters);
    return res.json({ success: true, data: data.map(connectorDto) });
  },

  async getByKey(req: AuthenticatedRequest, res: Response) {
    const data = await integrationService.getByKey(req.params.key);
    return res.json({ success: true, data: connectorDto(data) });
  },

  async create(req: AuthenticatedRequest, res: Response) {
    const input = createIntegrationSchema.parse(normalizeCreateBody(req.body ?? {}));
    const data = await integrationService.create(input, req.authUser!.id);
    return res.status(201).json({ success: true, data: connectorDto(data), message: "Integration created" });
  },

  async update(req: AuthenticatedRequest, res: Response) {
    const input = updateIntegrationSchema.parse(normalizeUpdateBody(req.body ?? {}));
    const data = await integrationService.update(req.params.key, input, req.authUser!.id);
    return res.json({ success: true, data: connectorDto(data), message: "Integration updated" });
  },

  async listRuns(req: AuthenticatedRequest, res: Response) {
    const filters = runFiltersSchema.parse(req.query);
    const result = await integrationService.listRuns(filters);
    const data = result.data.map((run: any) => ({
      ...run,
      connector_key: run.integration_key,
      connector_name: run.integration_name ?? run.integration_key,
      type: integrationTypeToUi(run.integration_type),
      status: run.status === "complete"
        ? (Number(run.rows_failed ?? 0) > 0 ? "partial" : "success")
        : run.status,
      records_synced: Math.max(
        Number(run.rows_promoted ?? 0),
        Number(run.rows_staged ?? 0),
        Number(run.rows_fetched ?? 0),
      ),
      errors: Number(run.rows_failed ?? 0),
      created_at: run.started_at,
    }));
    return res.json({ success: true, data, total: result.total, page: result.page, limit: result.limit });
  },

  async createRun(req: AuthenticatedRequest, res: Response) {
    const data = await integrationService.createRun(
      req.params.key,
      "manual",
      req.authUser!.id,
    );
    return res.status(201).json({ success: true, data, message: "Run triggered" });
  },

  async listFieldMaps(req: AuthenticatedRequest, res: Response) {
    const data = await integrationService.listFieldMaps(req.params.key);
    return res.json({
      success: true,
      data: data.map((map: any) => ({
        ...map,
        target_field: `${map.target_table}.${map.target_column}`,
        is_active: Boolean(map.active_status),
      })),
    });
  },

  async listTableMaps(req: AuthenticatedRequest, res: Response) {
    const data = await integrationService.listTableMaps(req.params.key);
    return res.json({
      success: true,
      data: data.map((map) => ({
        ...map,
        is_active: Boolean(map.active_status),
      })),
    });
  },

  async upsertTableMap(req: AuthenticatedRequest, res: Response) {
    const input = upsertTableMapSchema.parse({
      sourceTable: req.body?.sourceTable ?? req.body?.source_table,
      targetTable: req.body?.targetTable ?? req.body?.target_table,
      syncMode: req.body?.syncMode ?? req.body?.sync_mode,
    });
    const data = await integrationService.upsertTableMap(req.params.key, input, req.authUser!.id);
    return res.json({ success: true, data, message: "Table mapping saved" });
  },

  async mappingCatalog(_req: AuthenticatedRequest, res: Response) {
    return res.json({ success: true, data: integrationService.getMappingCatalog() });
  },

  async sourceSchema(req: AuthenticatedRequest, res: Response) {
    const data = await integrationService.inspectSourceSchema(req.params.key);
    return res.json({ success: true, data });
  },

  async confirmFieldMap(req: AuthenticatedRequest, res: Response) {
    if (req.body?.suggestion_id) {
      const data = await integrationService.confirmSuggestion(String(req.body.suggestion_id), req.authUser!.id);
      return res.json({ success: true, data, message: "Field mapping confirmed" });
    }

    const input = confirmFieldMapSchema.parse(req.body);
    const data = await integrationService.confirmFieldMap(input, req.authUser!.id);
    return res.json({ success: true, data, message: "Field mapping confirmed" });
  },

  async listSuggestions(req: AuthenticatedRequest, res: Response) {
    const data = await integrationService.listSuggestions(req.params.key);
    return res.json({
      success: true,
      data: data.map((suggestion: any) => ({
        ...suggestion,
        suggestion_id: suggestion.id,
        target_field: suggestion.suggested_table && suggestion.suggested_column
          ? `${suggestion.suggested_table}.${suggestion.suggested_column}`
          : "",
        confidence: Number(suggestion.confidence_score ?? 0),
        confirmed: suggestion.status === "confirmed",
      })),
    });
  },

  async getSchedule(req: AuthenticatedRequest, res: Response) {
    const data = await integrationService.getSchedule(req.params.key);
    return res.json({
      success: true,
      data: {
        ...data,
        is_enabled: Boolean(data.enabled),
      },
    });
  },

  async upsertSchedule(req: AuthenticatedRequest, res: Response) {
    const input = upsertScheduleSchema.parse({
      cronExpression: req.body?.cronExpression ?? req.body?.cron_expression,
      enabled: req.body?.enabled ?? req.body?.is_enabled,
    });
    const data = await integrationService.upsertSchedule(req.params.key, input);
    return res.json({
      success: true,
      data: { ...data, is_enabled: Boolean(data.enabled) },
      message: "Schedule updated",
    });
  },
};
