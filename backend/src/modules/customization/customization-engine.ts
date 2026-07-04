import type { RowDataPacket } from 'mysql2';
import { db } from '../../db/mysql.js';
import type { CustomizationContext, CustomizationRule, EffectiveConfigResult } from './customization.types.js';

// =============================================================================
// Customization Engine: Rule Evaluation & Application
// =============================================================================

interface CustomizationRuleRow extends RowDataPacket {
  id: string;
  rule_name: string;
  entity_type: string;
  entity_id: string | null;
  branch_ids: unknown;
  process_ids: unknown;
  department_ids: unknown;
  designation_ids: unknown;
  role_ids: unknown;
  employee_ids: unknown;
  config_type: CustomizationRule['config_type'];
  config_data: unknown;
  priority: number;
  is_active: number;
  effective_from: string | null;
  effective_to: string | null;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
}

interface EmployeeContextRow extends RowDataPacket {
  branch_id: string | null;
  process_id: string | null;
  designation_id: string | null;
  department_id: string | null;
}

interface RoleRow extends RowDataPacket {
  role_key: string | null;
}

interface CacheRow extends RowDataPacket {
  effective_config: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value) && !Buffer.isBuffer(value);
}

function parseJsonField(field: unknown): unknown {
  if (field == null) {
    return undefined;
  }
  if (typeof field === 'object' && !Buffer.isBuffer(field)) {
    return field;
  }

  const raw = Buffer.isBuffer(field) ? field.toString('utf8') : String(field);
  try {
    return JSON.parse(raw);
  } catch (error) {
    console.warn('JSON parse error:', error, 'Field:', raw);
    return undefined;
  }
}

function parseStringArrayField(field: unknown): string[] | undefined {
  const parsed = parseJsonField(field);
  return Array.isArray(parsed) ? parsed.map((item) => String(item)) : undefined;
}

function parseObjectField(field: unknown): Record<string, unknown> {
  const parsed = parseJsonField(field);
  return isRecord(parsed) ? parsed : {};
}

/**
 * Check if rule matches given context
 */
export function matchesContext(rule: CustomizationRule, context: CustomizationContext): boolean {
  if (rule.branch_ids?.length && !rule.branch_ids.includes(context.branchId || '')) return false;
  if (rule.process_ids?.length && !rule.process_ids.includes(context.processId || '')) return false;
  if (rule.department_ids?.length && !rule.department_ids.includes(context.departmentId || '')) return false;
  if (rule.designation_ids?.length && !rule.designation_ids.includes(context.designationId || '')) return false;
  if (rule.role_ids?.length && !rule.role_ids.includes(context.roleId || '')) return false;
  if (rule.employee_ids?.length && !rule.employee_ids.includes(context.employeeId)) return false;

  const now = new Date();
  if (rule.effective_from && new Date(rule.effective_from) > now) return false;
  if (rule.effective_to && new Date(rule.effective_to) < now) return false;

  return true;
}

/**
 * Deep merge objects (for 'merge' config type)
 */
function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = { ...target };
  for (const [key, sourceValue] of Object.entries(source)) {
    if (isRecord(sourceValue)) {
      const currentValue = isRecord(result[key]) ? result[key] : {};
      result[key] = deepMerge(currentValue, sourceValue);
    } else {
      result[key] = sourceValue;
    }
  }
  return result;
}

/**
 * Extend config (for 'extend' config type)
 */
function extendConfig(base: Record<string, unknown>, extension: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };
  for (const [key, extensionValue] of Object.entries(extension)) {
    if (Array.isArray(extensionValue)) {
      const existing = Array.isArray(result[key]) ? result[key] as unknown[] : [];
      result[key] = [...existing, ...extensionValue];
    } else if (isRecord(extensionValue)) {
      const currentValue = isRecord(result[key]) ? result[key] : {};
      result[key] = deepMerge(currentValue, extensionValue);
    } else {
      result[key] = extensionValue;
    }
  }
  return result;
}

function parseRuleRow(row: CustomizationRuleRow): CustomizationRule {
  return {
    id: row.id,
    rule_name: row.rule_name,
    entity_type: row.entity_type,
    entity_id: row.entity_id ?? undefined,
    branch_ids: parseStringArrayField(row.branch_ids),
    process_ids: parseStringArrayField(row.process_ids),
    department_ids: parseStringArrayField(row.department_ids),
    designation_ids: parseStringArrayField(row.designation_ids),
    role_ids: parseStringArrayField(row.role_ids),
    employee_ids: parseStringArrayField(row.employee_ids),
    config_type: row.config_type,
    config_data: parseObjectField(row.config_data),
    priority: row.priority,
    is_active: row.is_active,
    effective_from: row.effective_from ?? undefined,
    effective_to: row.effective_to ?? undefined,
    created_by: row.created_by ?? undefined,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/**
 * Apply customizations to base config
 */
export async function applyCustomizations(
  entityType: string,
  entityId: string | null,
  baseConfig: Record<string, unknown>,
  context: CustomizationContext
): Promise<EffectiveConfigResult> {
  const rules = await getRulesForEntity(entityType, entityId);
  const matchingRules = rules.filter((rule) => matchesContext(rule, context));
  matchingRules.sort((a, b) => a.priority - b.priority);

  let effectiveConfig: Record<string, unknown> = { ...baseConfig };
  const appliedRuleIds: string[] = [];

  for (const rule of matchingRules) {
    switch (rule.config_type) {
      case 'override':
        effectiveConfig = { ...effectiveConfig, ...rule.config_data };
        break;
      case 'merge':
        effectiveConfig = deepMerge(effectiveConfig, rule.config_data);
        break;
      case 'extend':
        effectiveConfig = extendConfig(effectiveConfig, rule.config_data);
        break;
      case 'disable':
        effectiveConfig = { ...effectiveConfig, _disabled: true };
        break;
    }

    appliedRuleIds.push(rule.id);
    await logApplication(rule.id, context, entityType, entityId, effectiveConfig);
  }

  return {
    config: effectiveConfig,
    appliedRules: appliedRuleIds,
    cached: false,
  };
}

/**
 * Get all rules for entity type (with optional entity ID filter)
 */
async function getRulesForEntity(entityType: string, entityId: string | null): Promise<CustomizationRule[]> {
  let sql = `
    SELECT * FROM customization_rule
    WHERE is_active = 1
      AND entity_type = ?
      AND (effective_from IS NULL OR effective_from <= CURDATE())
      AND (effective_to IS NULL OR effective_to >= CURDATE())
  `;
  const params: unknown[] = [entityType];

  if (entityId) {
    sql += ' AND (entity_id IS NULL OR entity_id = ?)';
    params.push(entityId);
  } else {
    sql += ' AND entity_id IS NULL';
  }

  sql += ' ORDER BY priority ASC';

  const [rows] = await db.execute<CustomizationRuleRow[]>(sql, params);
  return rows.map(parseRuleRow);
}

/**
 * Log rule application
 */
async function logApplication(
  ruleId: string,
  context: CustomizationContext,
  entityType: string,
  entityId: string | null,
  appliedConfig: Record<string, unknown>
): Promise<void> {
  await db.execute(
    `INSERT INTO customization_application_log
       (id, rule_id, employee_id, entity_type, entity_id, branch_id, process_id, department_id, designation_id, role_id, applied_config, application_source, applied_at)
     VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'api', NOW())`,
    [
      ruleId,
      context.employeeId,
      entityType,
      entityId,
      context.branchId || null,
      context.processId || null,
      context.departmentId || null,
      context.designationId || null,
      context.roleId || null,
      JSON.stringify(appliedConfig),
    ]
  );
}

/**
 * Get effective config with caching
 */
export async function getEffectiveConfig(
  employeeId: string,
  entityType: string,
  entityId: string | null,
  baseConfig: Record<string, unknown>
): Promise<EffectiveConfigResult> {
  const cacheKey = `${employeeId}:${entityType}:${entityId || 'null'}`;
  const cached = await getFromCache(cacheKey);
  if (cached) {
    await incrementCacheHit(cacheKey);
    return {
      config: cached.effective_config,
      appliedRules: [],
      cached: true,
    };
  }

  const context = await getEmployeeContext(employeeId);
  const result = await applyCustomizations(entityType, entityId, baseConfig, context);
  await setCache(cacheKey, employeeId, entityType, entityId, result.config);

  return result;
}

/**
 * Get employee context for customization
 */
async function getEmployeeContext(employeeId: string): Promise<CustomizationContext> {
  const [empRows] = await db.execute<EmployeeContextRow[]>(
    `SELECT branch_id, process_id, designation_id, department_id
     FROM employees
     WHERE id = ? LIMIT 1`,
    [employeeId]
  );

  const emp = empRows[0];
  if (!emp) throw new Error('Employee not found');

  const [roleRows] = await db.execute<RoleRow[]>(
    `SELECT role_key FROM user_roles WHERE user_id = ? AND active_status = 1 LIMIT 1`,
    [employeeId]
  );
  const role = roleRows[0];

  return {
    employeeId,
    branchId: emp.branch_id ?? undefined,
    processId: emp.process_id ?? undefined,
    departmentId: emp.department_id ?? undefined,
    designationId: emp.designation_id ?? undefined,
    roleId: role?.role_key ?? undefined,
  };
}

/**
 * Cache management
 */
async function getFromCache(cacheKey: string): Promise<{ effective_config: Record<string, unknown> } | null> {
  const [rows] = await db.execute<CacheRow[]>(
    `SELECT effective_config FROM customization_cache
     WHERE cache_key = ? AND expires_at > NOW()
     LIMIT 1`,
    [cacheKey]
  );

  const cache = rows[0];
  if (!cache) return null;

  const parsed = parseJsonField(cache.effective_config);
  return {
    effective_config: isRecord(parsed) ? parsed : {},
  };
}

async function setCache(
  cacheKey: string,
  employeeId: string,
  entityType: string,
  entityId: string | null,
  config: Record<string, unknown>
): Promise<void> {
  await db.execute(
    `INSERT INTO customization_cache
       (id, cache_key, employee_id, entity_type, entity_id, effective_config, cached_at, expires_at, hit_count)
     VALUES (UUID(), ?, ?, ?, ?, ?, NOW(), DATE_ADD(NOW(), INTERVAL 1 HOUR), 0)
     ON DUPLICATE KEY UPDATE
       effective_config = VALUES(effective_config),
       cached_at = NOW(),
       expires_at = DATE_ADD(NOW(), INTERVAL 1 HOUR),
       hit_count = 0`,
    [cacheKey, employeeId, entityType, entityId, JSON.stringify(config)]
  );
}

async function incrementCacheHit(cacheKey: string): Promise<void> {
  await db.execute(
    `UPDATE customization_cache SET hit_count = hit_count + 1 WHERE cache_key = ?`,
    [cacheKey]
  );
}

/**
 * Invalidate cache for employee
 */
export async function invalidateCache(employeeId?: string, entityType?: string): Promise<void> {
  if (employeeId && entityType) {
    await db.execute(
      `DELETE FROM customization_cache WHERE employee_id = ? AND entity_type = ?`,
      [employeeId, entityType]
    );
  } else if (employeeId) {
    await db.execute(`DELETE FROM customization_cache WHERE employee_id = ?`, [employeeId]);
  } else {
    await db.execute(`DELETE FROM customization_cache WHERE 1=1`);
  }
}
