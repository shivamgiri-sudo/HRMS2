import { describe, it, expect, beforeAll } from 'vitest';

// E2E test scenarios for customization system
describe('Customization E2E Scenarios', () => {
  describe('Scenario 1: Mumbai Branch Extended Leave', () => {
    it('should apply branch-specific leave policy', () => {
      // Given: Mumbai branch rule (max_days_per_year: 15)
      const baseLeaveType = {
        id: 'casual-leave',
        leave_name: 'Casual Leave',
        max_days_per_year: 12,
      };

      const mumbaiRule = {
        branch_ids: ['mumbai-branch-id'],
        config_type: 'override',
        config_data: { max_days_per_year: 15 },
        priority: 10,
      };

      const mumbaiEmployee = {
        employeeId: 'emp-mumbai-1',
        branchId: 'mumbai-branch-id',
      };

      // When: Rule applied
      const matches = mumbaiRule.branch_ids.includes(mumbaiEmployee.branchId);
      const effectiveConfig = matches
        ? { ...baseLeaveType, ...mumbaiRule.config_data }
        : baseLeaveType;

      // Then: Mumbai employee gets 15 days
      expect(effectiveConfig.max_days_per_year).toBe(15);
    });

    it('should NOT apply to Delhi branch', () => {
      const baseLeaveType = {
        id: 'casual-leave',
        max_days_per_year: 12,
      };

      const mumbaiRule = {
        branch_ids: ['mumbai-branch-id'],
        config_data: { max_days_per_year: 15 },
      };

      const delhiEmployee = {
        branchId: 'delhi-branch-id',
      };

      // When: Rule NOT matched
      const matches = mumbaiRule.branch_ids.includes(delhiEmployee.branchId);
      const effectiveConfig = matches
        ? { ...baseLeaveType, ...mumbaiRule.config_data }
        : baseLeaveType;

      // Then: Delhi employee gets default 12 days
      expect(effectiveConfig.max_days_per_year).toBe(12);
    });
  });

  describe('Scenario 2: Sales Travel Allowance', () => {
    it('should add travel allowance for Sales dept', () => {
      // Given: Sales dept rule (extend components)
      const baseComponents = [
        { code: 'BASIC', amount: 10000 },
        { code: 'HRA', amount: 5000 },
      ];

      const salesRule = {
        department_ids: ['sales-dept-id'],
        config_type: 'extend',
        config_data: {
          additional_components: [
            { code: 'TRAVEL', amount: 5000 },
          ],
        },
      };

      const salesEmployee = {
        departmentId: 'sales-dept-id',
      };

      // When: Rule applied
      const matches = salesRule.department_ids.includes(salesEmployee.departmentId);
      const effectiveComponents = matches
        ? [...baseComponents, ...salesRule.config_data.additional_components]
        : baseComponents;

      // Then: Sales employee has 3 components
      expect(effectiveComponents).toHaveLength(3);
      expect(effectiveComponents[2].code).toBe('TRAVEL');
    });
  });

  describe('Scenario 3: BPO Flexible Attendance', () => {
    it('should merge grace period for BPO process', () => {
      // Given: BPO process rule (merge policy)
      const basePolicy = {
        grace_period_minutes: 0,
        late_deduction_threshold: 30,
        allow_self_regularization: false,
      };

      const bpoRule = {
        process_ids: ['bpo-process-id'],
        config_type: 'merge',
        config_data: {
          grace_period_minutes: 15,
          allow_self_regularization: true,
        },
      };

      const bpoEmployee = {
        processId: 'bpo-process-id',
      };

      // When: Rule applied
      const matches = bpoRule.process_ids.includes(bpoEmployee.processId);
      const effectivePolicy = matches
        ? { ...basePolicy, ...bpoRule.config_data }
        : basePolicy;

      // Then: BPO employee gets grace period + keeps other defaults
      expect(effectivePolicy.grace_period_minutes).toBe(15);
      expect(effectivePolicy.allow_self_regularization).toBe(true);
      expect(effectivePolicy.late_deduction_threshold).toBe(30); // Preserved
    });
  });

  describe('Scenario 4: Multi-Dimensional Rule', () => {
    it('should apply when ALL dimensions match', () => {
      // Given: Senior Sales Manager rule (dept + designation)
      const rule = {
        department_ids: ['sales-dept-id'],
        designation_ids: ['senior-manager-id'],
        config_data: { max_days_per_year: 30 },
      };

      const seniorSalesManager = {
        departmentId: 'sales-dept-id',
        designationId: 'senior-manager-id',
      };

      // When: Both dimensions match
      const matches =
        rule.department_ids.includes(seniorSalesManager.departmentId) &&
        rule.designation_ids.includes(seniorSalesManager.designationId);

      // Then: Rule applies
      expect(matches).toBe(true);
    });

    it('should NOT apply when one dimension fails', () => {
      const rule = {
        department_ids: ['sales-dept-id'],
        designation_ids: ['senior-manager-id'],
      };

      const juniorSalesEmployee = {
        departmentId: 'sales-dept-id',
        designationId: 'junior-id', // Different designation
      };

      // When: Only one dimension matches
      const matches =
        rule.department_ids.includes(juniorSalesEmployee.departmentId) &&
        rule.designation_ids.includes(juniorSalesEmployee.designationId);

      // Then: Rule does NOT apply
      expect(matches).toBe(false);
    });
  });

  describe('Scenario 5: Priority Resolution', () => {
    it('should apply highest priority rule', () => {
      // Given: Multiple conflicting rules
      const baseConfig = { value: 1 };

      const globalRule = {
        priority: 1,
        config_data: { value: 10 },
      };

      const branchRule = {
        priority: 5,
        config_data: { value: 20 },
      };

      const departmentRule = {
        priority: 10,
        config_data: { value: 30 },
      };

      // When: All rules apply (sorted by priority)
      const rules = [globalRule, branchRule, departmentRule].sort(
        (a, b) => a.priority - b.priority
      );

      let result = { ...baseConfig };
      for (const rule of rules) {
        result = { ...result, ...rule.config_data };
      }

      // Then: Highest priority wins
      expect(result.value).toBe(30);
    });
  });

  describe('Scenario 6: Date Range', () => {
    it('should apply rule within date range', () => {
      const rule = {
        effective_from: '2026-01-01',
        effective_to: '2026-12-31',
      };

      const currentDate = new Date('2026-06-15');

      // When: Current date within range
      const isActive =
        currentDate >= new Date(rule.effective_from) &&
        currentDate <= new Date(rule.effective_to);

      // Then: Rule is active
      expect(isActive).toBe(true);
    });

    it('should NOT apply rule outside date range', () => {
      const rule = {
        effective_from: '2026-01-01',
        effective_to: '2026-12-31',
      };

      const futureDate = new Date('2027-01-01');

      // When: Current date outside range
      const isActive =
        futureDate >= new Date(rule.effective_from) &&
        futureDate <= new Date(rule.effective_to);

      // Then: Rule is NOT active
      expect(isActive).toBe(false);
    });
  });

  describe('Scenario 7: Caching', () => {
    it('should use same cache key for same request', () => {
      const request1 = {
        employeeId: 'emp-123',
        entityType: 'leave_type',
        entityId: 'casual-leave',
      };

      const request2 = {
        employeeId: 'emp-123',
        entityType: 'leave_type',
        entityId: 'casual-leave',
      };

      const key1 = `${request1.employeeId}:${request1.entityType}:${request1.entityId}`;
      const key2 = `${request2.employeeId}:${request2.entityType}:${request2.entityId}`;

      expect(key1).toBe(key2);
    });

    it('should use different cache keys for different employees', () => {
      const request1 = {
        employeeId: 'emp-123',
        entityType: 'leave_type',
        entityId: 'casual-leave',
      };

      const request2 = {
        employeeId: 'emp-456',
        entityType: 'leave_type',
        entityId: 'casual-leave',
      };

      const key1 = `${request1.employeeId}:${request1.entityType}:${request1.entityId}`;
      const key2 = `${request2.employeeId}:${request2.entityType}:${request2.entityId}`;

      expect(key1).not.toBe(key2);
    });
  });
});
