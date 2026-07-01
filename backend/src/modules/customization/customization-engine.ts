import type { RowDataPacket } from 'mysql2';
import { db } from '../../db/mysql.js';
import type { CustomizationRule, CustomizationContext, EffectiveConfigResult } from './customization.types.js';

// =============================================================================
// Customization Engine: Rule Evaluation & Application
// =============================================================================

/**
 * Check if rule matches given context
 */
export function matchesContext(rule: CustomizationRule, context: CustomizationContext): boolean {
  // Rule matches if ALL specified dimensions match context
  if (rule.branch_ids?.length && !rule.branch_ids.includes(context.branchId || '')) return false;
  if (rule.process_ids?.length && !rule.process_ids.includes(context.processId || '')) return false;
  if (rule.department_ids?.length && !rule.department_ids.includes(context.departmentId || '')) return false;
  if (rule.designation_ids?.length && !rule.designation_ids.includes(context.designationId || '')) return false;
  if (rule.role_ids?.length && !rule.role_ids.includes(context.roleId || '')) return false;
  if (rule.employee_ids?.length && !rule.employee_ids.includes(context.employeeId)) return false;

  // Check date range
  const now = new Date();
  if (rule.effective_from && new Date(rule.effective_from) > now) return false;
  if (rule.effective_to && new Date(rule.effective_to) < now) return false;

  return true;
}

/**
 * Deep merge objects (for 'merge' config type)
 */
function deepMerge(target: any, source: any): any {
  const result = { ...target };
  for (const key in source) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      result[key] = deepMerge(result[key] || {}, source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

/**
 * Extend config (for 'extend' config type)
 */
function extendConfig(base: any, extension: any): any {
  const result = { ...base };
  for (const key in extension) {
    if (Array.isArray(extension[key])) {
      result[key] = [...(result[key] || []), ...extension[key]];
    } else if (typeof extension[key] === 'object') {
      result[key] = deepMerge(result[key] || {}, extension[key]);
    } else {
      result[key] = extension[key];
    }
  }
  return result;
}

/**
 * Apply customizations to base config
 */
export async function applyCustomizations(
  entityType: string,
  entityId: string | null,
  baseConfig: any,
  context: CustomizationContext
): Promise<EffectiveConfigResult> {
  // 1. Fetch all active rules for entity type
  const rules = await getRulesForEntity(entityType, entityId);

  // 2. Filter rules matching context
  const matchingRules = rules.filter(rule => matchesContext(rule, context));

  // 3. Sort by priority (lower priority = applied first)
  matchingRules.sort((a, b) => a.priority - b.priority);

  // 4. Apply rules sequentially
  let effectiveConfig = { ...baseConfig };
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

    // 5. Log application
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
  const params: any[] = [entityType];

  if (entityId) {
    sql += ' AND (entity_id IS NULL OR entity_id = ?)';
    params.push(entityId);
  } else {
    sql += ' AND entity_id IS NULL';
  }

  sql += ' ORDER BY priority ASC';

  const [rows] = await db.execute<RowDataPacket[]>(sql, params);

  return (rows as any[]).map(row => ({
    ...row,
    branch_ids: row.branch_ids ? JSON.parse(row.branch_ids) : null,
    process_ids: row.process_ids ? JSON.parse(row.process_ids) : null,
    department_ids: row.department_ids ? JSON.parse(row.department_ids) : null,
    designation_ids: row.designation_ids ? JSON.parse(row.designation_ids) : null,
    role_ids: row.role_ids ? JSON.parse(row.role_ids) : null,
    employee_ids: row.employee_ids ? JSON.parse(row.employee_ids) : null,
    config_data: JSON.parse(row.config_data),
  }));
}

/**
 * Log rule application
 */
async function logApplication(
  ruleId: string,
  context: CustomizationContext,
  entityType: string,
  entityId: string | null,
  appliedConfig: any
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
  baseConfig: any
): Promise<EffectiveConfigResult> {
  // 1. Check cache
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

  // 2. Get employee context
  const context = await getEmployeeContext(employeeId);

  // 3. Apply customizations
  const result = await applyCustomizations(entityType, entityId, baseConfig, context);

  // 4. Cache result (TTL: 1 hour)
  await setCache(cacheKey, employeeId, entityType, entityId, result.config);

  return result;
}

/**
 * Get employee context for customization
 */
async function getEmployeeContext(employeeId: string): Promise<CustomizationContext> {
  // Get employee data
  const [empRows] = await db.execute<RowDataPacket[]>(
    `SELECT branch_id, process_id, designation_id, department_id
     FROM employees
     WHERE id = ? LIMIT 1`,
    [employeeId]
  );

  const emp = (empRows as any[])[0];
  if (!emp) throw new Error('Employee not found');

  // Get role from user_roles (many-to-many, take first active role)
  const [roleRows] = await db.execute<RowDataPacket[]>(
    `SELECT role_key FROM user_roles WHERE user_id = ? AND active_status = 1 LIMIT 1`,
    [employeeId]
  );
  const role = (roleRows as any[])[0];

  return {
    employeeId,
    branchId: emp.branch_id,
    processId: emp.process_id,
    departmentId: emp.department_id,
    designationId: emp.designation_id,
    roleId: role?.role_key, // May be undefined if no role
  };
}

/**
 * Cache management
 */
async function getFromCache(cacheKey: string): Promise<any | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT effective_config FROM customization_cache
     WHERE cache_key = ? AND expires_at > NOW()
     LIMIT 1`,
    [cacheKey]
  );

  const cache = (rows as any[])[0];
  return cache ? { effective_config: JSON.parse(cache.effective_config) } : null;
}

async function setCache(
  cacheKey: string,
  employeeId: string,
  entityType: string,
  entityId: string | null,
  config: any
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
