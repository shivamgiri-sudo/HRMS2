import { randomUUID } from 'crypto';
import type { RowDataPacket } from 'mysql2';
import { db } from '../../db/mysql.js';
import { getEffectiveConfig as engineGetEffectiveConfig, invalidateCache } from './customization-engine.js';
import type { CustomizationRule, EffectiveConfigResult, PaginatedResult } from './customization.types.js';
import type {
  CreateRuleInput,
  UpdateRuleInput,
  GetRulesFilters,
  GetEffectiveConfigInput,
  PreviewRuleInput,
  BulkApplyInput,
} from './customization.validation.js';

export const customizationService = {
  // ─── Rules Management ──────────────────────────────────────────────────────

  async listRules(filters: GetRulesFilters): Promise<PaginatedResult<CustomizationRule>> {
    const { entityType, entityId, isActive, page, limit } = filters;
    const offset = (page - 1) * limit;

    const conds: string[] = [];
    const params: any[] = [];

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

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT * FROM customization_rule ${where} ORDER BY priority DESC, created_at DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    const [countRows] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM customization_rule ${where}`,
      params
    );

    const total = (countRows as any)[0]?.total ?? 0;

    return {
      data: (rows as any[]).map(parseRuleRow),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  },

  async getRule(id: string): Promise<CustomizationRule> {
    const [rows] = await db.execute<RowDataPacket[]>(
      'SELECT * FROM customization_rule WHERE id = ? LIMIT 1',
      [id]
    );
    const rule = (rows as any[])[0];
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

    // Invalidate cache for affected entity type
    await invalidateCache(undefined, input.entityType);

    return this.getRule(id);
  },

  async updateRule(id: string, input: UpdateRuleInput, _userId: string): Promise<CustomizationRule> {
    const existing = await this.getRule(id);
    const sets: string[] = [];
    const params: any[] = [];

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

      // Invalidate cache for affected entity type
      await invalidateCache(undefined, existing.entity_type);
    }

    return this.getRule(id);
  },

  async deleteRule(id: string): Promise<void> {
    const rule = await this.getRule(id);
    await db.execute('DELETE FROM customization_rule WHERE id = ?', [id]);

    // Invalidate cache for affected entity type
    await invalidateCache(undefined, rule.entity_type);
  },

  async toggleRule(id: string): Promise<CustomizationRule> {
    const rule = await this.getRule(id);
    await db.execute('UPDATE customization_rule SET is_active = ? WHERE id = ?', [rule.is_active ? 0 : 1, id]);

    // Invalidate cache for affected entity type
    await invalidateCache(undefined, rule.entity_type);

    return this.getRule(id);
  },

  // ─── Effective Config ──────────────────────────────────────────────────────

  async getEffectiveConfig(input: GetEffectiveConfigInput): Promise<EffectiveConfigResult> {
    const { employeeId, entityType, entityId } = input;

    // Base config (empty for now - services should pass their defaults)
    const baseConfig = {};

    return engineGetEffectiveConfig(employeeId, entityType, entityId || null, baseConfig);
  },

  async previewRule(input: PreviewRuleInput): Promise<Record<string, any>> {
    const { ruleId, employeeIds } = input;
    const rule = await this.getRule(ruleId);

    const results: Record<string, any> = {};

    for (const empId of employeeIds) {
      try {
        // Apply rule to employee (without logging)
        const baseConfig = {};
        const result = await engineGetEffectiveConfig(empId, rule.entity_type, rule.entity_id || null, baseConfig);
        results[empId] = {
          success: true,
          config: result.config,
          appliedRules: result.appliedRules,
        };
      } catch (error: any) {
        results[empId] = {
          success: false,
          error: error.message,
        };
      }
    }

    return results;
  },

  async getAppliedRules(employeeId: string): Promise<any[]> {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT cal.*, cr.rule_name, cr.entity_type
       FROM customization_application_log cal
       JOIN customization_rule cr ON cal.rule_id = cr.id
       WHERE cal.employee_id = ?
       ORDER BY cal.applied_at DESC
       LIMIT 100`,
      [employeeId]
    );

    return rows as any[];
  },

  // ─── Bulk Operations ───────────────────────────────────────────────────────

  async bulkApply(input: BulkApplyInput): Promise<Record<string, any>> {
    const { ruleId, employeeIds } = input;
    const rule = await this.getRule(ruleId);

    const results: Record<string, any> = {};

    for (const empId of employeeIds) {
      try {
        // Apply rule and log application
        await engineGetEffectiveConfig(empId, rule.entity_type, rule.entity_id || null, {});
        results[empId] = { success: true };
      } catch (error: any) {
        results[empId] = { success: false, error: error.message };
      }
    }

    return results;
  },
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function parseRuleRow(row: any): CustomizationRule {
  // Helper to parse JSON fields (handles string, Buffer, or already-parsed objects)
  const parseJsonField = (field: any) => {
    if (!field) return undefined;
    if (typeof field === 'object' && !Buffer.isBuffer(field)) return field; // Already parsed
    const str = Buffer.isBuffer(field) ? field.toString('utf8') : field;
    try {
      return JSON.parse(str);
    } catch (err) {
      console.warn('JSON parse error:', err, 'Field:', str);
      return undefined;
    }
  };

  return {
    ...row,
    branch_ids: parseJsonField(row.branch_ids),
    process_ids: parseJsonField(row.process_ids),
    department_ids: parseJsonField(row.department_ids),
    designation_ids: parseJsonField(row.designation_ids),
    role_ids: parseJsonField(row.role_ids),
    employee_ids: parseJsonField(row.employee_ids),
    config_data: parseJsonField(row.config_data) || {},
  };
}

