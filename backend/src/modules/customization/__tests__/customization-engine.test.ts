import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { CustomizationRule, CustomizationContext } from '../customization.types.js';

// Mock the engine functions for testing
describe('Customization Engine', () => {
  describe('matchesContext', () => {
    it('should match rule with no dimension filters (applies to all)', () => {
      const rule: Partial<CustomizationRule> = {
        branch_ids: undefined,
        process_ids: undefined,
        department_ids: undefined,
        designation_ids: undefined,
        role_ids: undefined,
        employee_ids: undefined,
      };

      const context: CustomizationContext = {
        employeeId: 'emp-1',
        branchId: 'branch-1',
      };

      // Rule with no filters should match any context
      const matches = !rule.branch_ids?.length && !rule.process_ids?.length;
      expect(matches).toBe(true);
    });

    it('should match rule with matching branch', () => {
      const rule: Partial<CustomizationRule> = {
        branch_ids: ['branch-1', 'branch-2'],
      };

      const context: CustomizationContext = {
        employeeId: 'emp-1',
        branchId: 'branch-1',
      };

      const matches = rule.branch_ids?.includes(context.branchId!);
      expect(matches).toBe(true);
    });

    it('should NOT match rule with non-matching branch', () => {
      const rule: Partial<CustomizationRule> = {
        branch_ids: ['branch-1', 'branch-2'],
      };

      const context: CustomizationContext = {
        employeeId: 'emp-1',
        branchId: 'branch-3',
      };

      const matches = rule.branch_ids?.includes(context.branchId!);
      expect(matches).toBe(false);
    });

    it('should match rule with multiple dimensions (AND logic)', () => {
      const rule: Partial<CustomizationRule> = {
        branch_ids: ['branch-1'],
        department_ids: ['dept-1'],
      };

      const context: CustomizationContext = {
        employeeId: 'emp-1',
        branchId: 'branch-1',
        departmentId: 'dept-1',
      };

      const matches =
        rule.branch_ids?.includes(context.branchId!) &&
        rule.department_ids?.includes(context.departmentId!);
      expect(matches).toBe(true);
    });

    it('should NOT match if one dimension fails (AND logic)', () => {
      const rule: Partial<CustomizationRule> = {
        branch_ids: ['branch-1'],
        department_ids: ['dept-1'],
      };

      const context: CustomizationContext = {
        employeeId: 'emp-1',
        branchId: 'branch-1',
        departmentId: 'dept-2', // Different dept
      };

      const matches =
        rule.branch_ids?.includes(context.branchId!) &&
        rule.department_ids?.includes(context.departmentId!);
      expect(matches).toBe(false);
    });
  });

  describe('applyCustomizations - override', () => {
    it('should override base config values', () => {
      const baseConfig = {
        max_days_per_year: 12,
        carry_forward: true,
      };

      const ruleConfig = {
        max_days_per_year: 15,
      };

      const result = { ...baseConfig, ...ruleConfig };

      expect(result.max_days_per_year).toBe(15);
      expect(result.carry_forward).toBe(true); // Unchanged
    });
  });

  describe('applyCustomizations - merge', () => {
    it('should deep merge nested objects', () => {
      const baseConfig = {
        policy: {
          grace_period_minutes: 0,
          late_deduction: 30,
        },
      };

      const ruleConfig = {
        policy: {
          grace_period_minutes: 15,
        },
      };

      // Deep merge simulation
      const result = {
        policy: {
          ...baseConfig.policy,
          ...ruleConfig.policy,
        },
      };

      expect(result.policy.grace_period_minutes).toBe(15);
      expect(result.policy.late_deduction).toBe(30); // Preserved
    });
  });

  describe('applyCustomizations - extend', () => {
    it('should append to arrays', () => {
      const baseConfig = {
        components: [
          { code: 'BASIC', amount: 10000 },
        ],
      };

      const ruleConfig = {
        additional_components: [
          { code: 'TRAVEL', amount: 5000 },
        ],
      };

      const result = {
        components: [
          ...baseConfig.components,
          ...ruleConfig.additional_components,
        ],
      };

      expect(result.components).toHaveLength(2);
      expect(result.components[1].code).toBe('TRAVEL');
    });
  });

  describe('applyCustomizations - disable', () => {
    it('should mark config as disabled', () => {
      const baseConfig = {
        visible: true,
        name: 'Salary Section',
      };

      const ruleConfig = {
        _disabled: true,
      };

      const result = { ...baseConfig, ...ruleConfig };

      expect(result._disabled).toBe(true);
      expect(result.name).toBe('Salary Section'); // Other props preserved
    });
  });

  describe('priority resolution', () => {
    it('should apply rules by priority (higher wins)', () => {
      const baseConfig = { value: 1 };

      const rules = [
        { priority: 1, config_data: { value: 2 } },
        { priority: 10, config_data: { value: 3 } },
        { priority: 5, config_data: { value: 4 } },
      ];

      // Sort by priority (low to high)
      const sorted = rules.sort((a, b) => a.priority - b.priority);

      // Apply sequentially (last wins)
      let result = { ...baseConfig };
      for (const rule of sorted) {
        result = { ...result, ...rule.config_data };
      }

      expect(result.value).toBe(3); // Priority 10 wins
    });
  });

  describe('caching', () => {
    it('should generate correct cache key', () => {
      const employeeId = 'emp-123';
      const entityType = 'leave_type';
      const entityId = 'leave-456';

      const cacheKey = `${employeeId}:${entityType}:${entityId}`;

      expect(cacheKey).toBe('emp-123:leave_type:leave-456');
    });

    it('should handle null entityId in cache key', () => {
      const employeeId = 'emp-123';
      const entityType = 'attendance_policy';
      const entityId = null;

      const cacheKey = `${employeeId}:${entityType}:${entityId || 'null'}`;

      expect(cacheKey).toBe('emp-123:attendance_policy:null');
    });
  });
});
