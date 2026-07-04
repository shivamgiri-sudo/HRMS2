import { randomUUID } from 'crypto';
import type { RowDataPacket } from 'mysql2';
import { db } from '../../db/mysql.js';
import { getEffectiveConfig as engineGetEffectiveConfig, invalidateCache } from './customization-engine.js';
import type {
  CustomizationApplicationLog,
  CustomizationRule,
  EffectiveConfigResult,
  PaginatedResult,
} from './customization.types.js';
import type {
  BulkApplyInput,
  CreateRuleInput,
  GetEffectiveConfigInput,
  GetRulesFilters,
  PreviewRuleInput,
  UpdateRuleInput,
} from './customization.validation.js';

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

interface CountRow extends RowDataPacket {
  total: number;
}

interface AppliedRuleRow extends RowDataPacket, CustomizationApplicationLog {
  rule_name: string;
  config_data?: unknown;
}

type PreviewResults = Record<
  string,
  {
    success: boolean;
    config?: Record<string, unknown>;
    appliedRules?: string[];
    error?: string;
  }
>;

type BulkApplyResults = Record<
  string,
  {
    success: boolean;
    error?: string;
  }
>;

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

function parseAppliedRuleRow(row: AppliedRuleRow): AppliedRuleRow {
  return {
    ...row,
    applied_config: parseObjectField(row.applied_config),
  };
}

export const customizationService = {
  // ─── Rules Management ─────────────────────────────────────────────────────

  async listRules(filters: GetRulesFilters): Promise<PaginatedResult<CustomizationRule>> {
    const { entityType, entityId, isActive, page, limit } = filters;
    const offset = (page - 1) * limit;

    const conds: string[] = [];
    const params: unknown[] = [];

    if (entityType) {
      conds.push('entity_type = ?');
      params.push(entityType);
    }
    if (entityId) {
      conds.push('entity_id = ?');
      params.push(entityId);
    }
    if (isActive === 'active') {
      conds.push('is_active = 1');
    } else if (isActive === 'inactive') {
      conds.push('is_active = 0');
    }

    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

    const [rows] = await db.execute<CustomizationRuleRow[]>(
      `SELECT * FROM customization_rule ${where} ORDER BY priority DESC, created_at DESC LIMIT ${limit} OFFSET ${offset}`,
      params
    );

    const [countRows] = await db.execute<CountRow[]>(
      `SELECT COUNT(*) AS total FROM customization_rule ${where}`,
      params
    );

    const total = Number(countRows[0]?.total ?? 0);

    return {
      data: rows.map(parseRuleRow),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  },

  async getRule(id: string): Promise<CustomizationRule> {
    const [rows] = await db.execute<CustomizationRuleRow[]>(
      'SELECT * FROM customization_rule WHERE id = ? LIMIT 1',
      [id]
    );
    const rule = rows[0];
    if (!rule) throw new Error('Rule not found');
    return parseRuleRow(rule);
  },

  async createRule(input: CreateRuleInput, userId: string): Promise<CustomizationRule> {
    const id = randomUUID();
    await db.execute(
      `INSERT INTO customization_rule
         (id, rule_name, entity_type, entity_id, branch_ids, process_ids, department_ids, designation_ids, role_ids, employee_ids, config_type, config_data, priority, effective_from, effective_to, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.ruleName,
        input.entityType,
        input.entityId || null,
        input.branchIds ? JSON.stringify(input.branchIds) : null,
        input.processIds ? JSON.stringify(input.processIds) : null,
        input.departmentIds ? JSON.stringify(input.departmentIds) : null,
        input.designationIds ? JSON.stringify(input.designationIds) : null,
        input.roleIds ? JSON.stringify(input.roleIds) : null,
        input.employeeIds ? JSON.stringify(input.employeeIds) : null,
        input.configType,
        JSON.stringify(input.configData),
        input.priority || 0,
        input.effectiveFrom || null,
        input.effectiveTo || null,
        userId,
      ]
    );

    await invalidateCache(undefined, input.entityType);
    return this.getRule(id);
  },

  async updateRule(id: string, input: UpdateRuleInput, _userId: string): Promise<CustomizationRule> {
    const existing = await this.getRule(id);
    const sets: string[] = [];
    const params: unknown[] = [];

    if (input.ruleName !== undefined) {
      sets.push('rule_name = ?');
      params.push(input.ruleName);
    }
    if (input.entityType !== undefined) {
      sets.push('entity_type = ?');
      params.push(input.entityType);
    }
    if (input.entityId !== undefined) {
      sets.push('entity_id = ?');
      params.push(input.entityId || null);
    }
    if (input.branchIds !== undefined) {
      sets.push('branch_ids = ?');
      params.push(input.branchIds ? JSON.stringify(input.branchIds) : null);
    }
    if (input.processIds !== undefined) {
      sets.push('process_ids = ?');
      params.push(input.processIds ? JSON.stringify(input.processIds) : null);
    }
    if (input.departmentIds !== undefined) {
      sets.push('department_ids = ?');
      params.push(input.departmentIds ? JSON.stringify(input.departmentIds) : null);
    }
    if (input.designationIds !== undefined) {
      sets.push('designation_ids = ?');
      params.push(input.designationIds ? JSON.stringify(input.designationIds) : null);
    }
    if (input.roleIds !== undefined) {
      sets.push('role_ids = ?');
      params.push(input.roleIds ? JSON.stringify(input.roleIds) : null);
    }
    if (input.employeeIds !== undefined) {
      sets.push('employee_ids = ?');
      params.push(input.employeeIds ? JSON.stringify(input.employeeIds) : null);
    }
    if (input.configType !== undefined) {
      sets.push('config_type = ?');
      params.push(input.configType);
    }
    if (input.configData !== undefined) {
      sets.push('config_data = ?');
      params.push(JSON.stringify(input.configData));
    }
    if (input.priority !== undefined) {
      sets.push('priority = ?');
      params.push(input.priority);
    }
    if (input.effectiveFrom !== undefined) {
      sets.push('effective_from = ?');
      params.push(input.effectiveFrom || null);
    }
    if (input.effectiveTo !== undefined) {
      sets.push('effective_to = ?');
      params.push(input.effectiveTo || null);
    }
    if (input.isActive !== undefined) {
      sets.push('is_active = ?');
      params.push(input.isActive ? 1 : 0);
    }

    if (sets.length > 0) {
      params.push(id);
      await db.execute(`UPDATE customization_rule SET ${sets.join(', ')} WHERE id = ?`, params);
      await invalidateCache(undefined, existing.entity_type);
    }

    return this.getRule(id);
  },

  async deleteRule(id: string): Promise<void> {
    const rule = await this.getRule(id);
    await db.execute('DELETE FROM customization_rule WHERE id = ?', [id]);
    await invalidateCache(undefined, rule.entity_type);
  },

  async toggleRule(id: string): Promise<CustomizationRule> {
    const rule = await this.getRule(id);
    await db.execute('UPDATE customization_rule SET is_active = ? WHERE id = ?', [rule.is_active ? 0 : 1, id]);
    await invalidateCache(undefined, rule.entity_type);
    return this.getRule(id);
  },

  // ─── Effective Config ─────────────────────────────────────────────────────

  async getEffectiveConfig(input: GetEffectiveConfigInput): Promise<EffectiveConfigResult> {
    const { employeeId, entityType, entityId } = input;
    const baseConfig: Record<string, unknown> = {};
    return engineGetEffectiveConfig(employeeId, entityType, entityId || null, baseConfig);
  },

  async previewRule(input: PreviewRuleInput): Promise<PreviewResults> {
    const { ruleId, employeeIds } = input;
    const rule = await this.getRule(ruleId);

    const results: PreviewResults = {};

    for (const empId of employeeIds) {
      try {
        const result = await engineGetEffectiveConfig(empId, rule.entity_type, rule.entity_id || null, {});
        results[empId] = {
          success: true,
          config: result.config,
          appliedRules: result.appliedRules,
        };
      } catch (error: unknown) {
        results[empId] = {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }

    return results;
  },

  async getAppliedRules(employeeId: string): Promise<AppliedRuleRow[]> {
    const [rows] = await db.execute<AppliedRuleRow[]>(
      `SELECT cal.*, cr.rule_name, cr.entity_type
       FROM customization_application_log cal
       JOIN customization_rule cr ON cal.rule_id = cr.id
       WHERE cal.employee_id = ?
       ORDER BY cal.applied_at DESC
       LIMIT 100`,
      [employeeId]
    );

    return rows.map(parseAppliedRuleRow);
  },

  // ─── Bulk Operations ───────────────────────────────────────────────────────

  async bulkApply(input: BulkApplyInput): Promise<BulkApplyResults> {
    const { ruleId, employeeIds } = input;
    const rule = await this.getRule(ruleId);

    const results: BulkApplyResults = {};

    for (const empId of employeeIds) {
      try {
        await engineGetEffectiveConfig(empId, rule.entity_type, rule.entity_id || null, {});
        results[empId] = { success: true };
      } catch (error: unknown) {
        results[empId] = {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }

    return results;
  },
};
