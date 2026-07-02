# MAS-CallNet HRMS: Customization System Design

**Date**: 2026-06-02  
**Version**: 1.0  
**Purpose**: Multi-dimensional customization for all master data and components

---

## Overview

**Goal**: Allow configuration of masters, policies, workflows, and UI components based on:
- Branch
- Process
- Department
- Designation
- Role
- Employee

**Scope**: Every master page, policy, approval workflow, and system configuration

---

## Architecture

### 1. Customization Dimensions

```sql
CREATE TABLE customization_dimension (
  id VARCHAR(36) PRIMARY KEY,
  dimension_key VARCHAR(50) UNIQUE NOT NULL, -- 'branch', 'process', 'department', 'designation', 'role'
  dimension_name VARCHAR(100) NOT NULL,
  description TEXT,
  is_active TINYINT(1) DEFAULT 1,
  priority INT DEFAULT 0, -- Higher priority = applies first
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO customization_dimension (id, dimension_key, dimension_name, priority) VALUES
(UUID(), 'employee', 'Employee', 1),
(UUID(), 'role', 'Role', 2),
(UUID(), 'designation', 'Designation', 3),
(UUID(), 'department', 'Department', 4),
(UUID(), 'process', 'Process', 5),
(UUID(), 'branch', 'Branch', 6);
```

### 2. Customization Rules

```sql
CREATE TABLE customization_rule (
  id VARCHAR(36) PRIMARY KEY,
  rule_name VARCHAR(100) NOT NULL,
  entity_type VARCHAR(50) NOT NULL, -- 'leave_type', 'attendance_policy', 'approval_workflow', etc.
  entity_id VARCHAR(36), -- Specific entity (optional)
  
  -- Dimension filters (multi-select)
  branch_ids JSON, -- ["branch-uuid-1", "branch-uuid-2"]
  process_ids JSON,
  department_ids JSON,
  designation_ids JSON,
  role_ids JSON,
  employee_ids JSON,
  
  -- Customization payload
  config_type VARCHAR(50) NOT NULL, -- 'override', 'merge', 'extend', 'disable'
  config_data JSON NOT NULL, -- Actual customization values
  
  -- Metadata
  priority INT DEFAULT 0, -- Rule precedence
  is_active TINYINT(1) DEFAULT 1,
  effective_from DATE,
  effective_to DATE,
  created_by VARCHAR(36),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  INDEX idx_entity (entity_type, entity_id),
  INDEX idx_active (is_active, effective_from, effective_to)
);
```

### 3. Customization Application Log

```sql
CREATE TABLE customization_application_log (
  id VARCHAR(36) PRIMARY KEY,
  rule_id VARCHAR(36) NOT NULL,
  employee_id VARCHAR(36) NOT NULL,
  entity_type VARCHAR(50) NOT NULL,
  entity_id VARCHAR(36),
  
  -- Context at time of application
  branch_id VARCHAR(36),
  process_id VARCHAR(36),
  department_id VARCHAR(36),
  designation_id VARCHAR(36),
  role_id VARCHAR(36),
  
  -- Applied config
  applied_config JSON NOT NULL,
  application_source VARCHAR(50), -- 'api', 'cron', 'manual'
  
  applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  INDEX idx_employee (employee_id),
  INDEX idx_rule (rule_id),
  FOREIGN KEY (rule_id) REFERENCES customization_rule(id)
);
```

---

## Customization Scenarios

### Scenario 1: Leave Policy by Branch

**Use Case**: Different branches have different leave policies

```json
{
  "rule_name": "Mumbai Branch CL Limit",
  "entity_type": "leave_type",
  "entity_id": "casual-leave-uuid",
  "branch_ids": ["mumbai-branch-uuid"],
  "config_type": "override",
  "config_data": {
    "max_days_per_request": 3,
    "max_days_per_year": 15,
    "carry_forward_allowed": false
  }
}
```

### Scenario 2: Approval Workflow by Designation

**Use Case**: Senior managers skip L1 approval

```json
{
  "rule_name": "Senior Manager Direct Approval",
  "entity_type": "approval_workflow",
  "entity_id": "leave-approval-workflow-uuid",
  "designation_ids": ["senior-manager-uuid", "assistant-manager-uuid"],
  "config_type": "override",
  "config_data": {
    "skip_levels": [1],
    "direct_approver_role": "hr"
  }
}
```

### Scenario 3: Attendance Policy by Process

**Use Case**: BPO process has different shift rules

```json
{
  "rule_name": "BPO Shift Flexibility",
  "entity_type": "attendance_policy",
  "process_ids": ["bpo-process-uuid"],
  "config_type": "merge",
  "config_data": {
    "allow_self_regularization": true,
    "grace_period_minutes": 15,
    "late_deduction_threshold": 30
  }
}
```

### Scenario 4: Payroll Component by Department

**Use Case**: Sales department gets additional allowances

```json
{
  "rule_name": "Sales Travel Allowance",
  "entity_type": "salary_component",
  "department_ids": ["sales-dept-uuid"],
  "config_type": "extend",
  "config_data": {
    "additional_components": [
      {
        "component_code": "TRAVEL_ALLOW",
        "component_name": "Travel Allowance",
        "component_type": "earning",
        "calculation_type": "fixed",
        "fixed_amount": 5000
      }
    ]
  }
}
```

### Scenario 5: UI Component Visibility by Role

**Use Case**: Hide salary info from employees, show to HR only

```json
{
  "rule_name": "Hide Salary for Employees",
  "entity_type": "ui_component",
  "entity_id": "employee-profile-salary-section",
  "role_ids": ["employee-role-uuid"],
  "config_type": "disable",
  "config_data": {
    "visible": false,
    "reason": "Role restriction"
  }
}
```

---

## Implementation Plan

### Phase 1: Core Customization Engine

**Files to Create**:
```
backend/src/modules/customization/
  ├── customization.types.ts
  ├── customization.validation.ts
  ├── customization.service.ts
  ├── customization.controller.ts
  ├── customization.routes.ts
  └── customization-engine.ts (rule evaluation)
```

**Key Functions**:
```typescript
// Evaluate which rules apply to given context
evaluateRules(context: CustomizationContext): CustomizationRule[]

// Apply rules to entity config
applyCustomizations(entityType: string, entityId: string, baseConfig: any, context: CustomizationContext): any

// Get effective config for employee
getEffectiveConfig(employeeId: string, entityType: string, entityId?: string): any
```

### Phase 2: Master-Specific Customization

**Entities to Customize**:

1. **Leave Management**
   - Leave types (max days, carry forward, encashment)
   - Leave policies (approval levels, notice period)
   - Leave calendar (working days, holidays by branch)

2. **Attendance & WFM**
   - Shift rules (timings, break duration)
   - Regularization policies (auto-approve threshold)
   - Late/early deductions
   - Overtime rules

3. **Payroll**
   - Salary components (add/remove by department)
   - Statutory rates (PF/ESIC/PT by state/branch)
   - Payment modes
   - Advance limits

4. **Performance**
   - KPI templates by role/designation
   - Review cycles (frequency, format)
   - Rating scales

5. **Approval Workflows**
   - Leave approvals (levels, escalation)
   - Expense approvals (amount thresholds)
   - Regularization approvals

6. **Assets**
   - Asset allocation limits by designation
   - Asset categories by department

7. **Client Portal**
   - KPI visibility by client
   - Report access

### Phase 3: UI Component Customization

**Frontend Implementation**:
```typescript
// React hook for customization-aware components
const useCustomization = (entityType: string, entityId?: string) => {
  const employee = useCurrentEmployee();
  const { data: config } = useQuery(['customization', entityType, entityId, employee.id], () =>
    hrmsApi.get(`/customization/effective`, {
      params: { entityType, entityId, employeeId: employee.id }
    })
  );
  return config?.data || {};
};

// Usage in component
const LeaveRequestForm = () => {
  const leaveTypeId = "casual-leave";
  const customConfig = useCustomization('leave_type', leaveTypeId);
  
  const maxDays = customConfig.max_days_per_request || 5; // Default 5
  const carryForward = customConfig.carry_forward_allowed ?? true;
  
  return (
    <Form>
      <Input max={maxDays} label={`Max Days (up to ${maxDays})`} />
      {carryForward && <Checkbox label="Carry Forward Unused Leave" />}
    </Form>
  );
};
```

### Phase 4: Admin UI for Customization Management

**New Pages**:
```
src/pages/
  ├── NativeCustomizationManager.tsx (list all rules)
  ├── NativeCustomizationRuleEditor.tsx (create/edit rules)
  └── NativeCustomizationPreview.tsx (preview effect on employee)
```

**Features**:
- Visual rule builder (no-code)
- Multi-select dimensions
- JSON config editor (advanced mode)
- Preview: "See how this affects Employee X"
- Bulk import/export rules (CSV)
- Rule priority management (drag-drop)

---

## API Endpoints

### Customization Management
```
GET    /api/customization/rules                    # List all rules
POST   /api/customization/rules                    # Create rule
GET    /api/customization/rules/:id                # Get rule
PATCH  /api/customization/rules/:id                # Update rule
DELETE /api/customization/rules/:id                # Delete rule
POST   /api/customization/rules/:id/toggle         # Enable/disable
```

### Rule Evaluation
```
GET    /api/customization/effective                # Get effective config for employee
  ?employeeId=<uuid>&entityType=<type>&entityId=<uuid>

POST   /api/customization/preview                  # Preview rule effect
  Body: { ruleId, employeeIds[] }

GET    /api/customization/applied/:employeeId      # Get all applied rules for employee
```

### Bulk Operations
```
POST   /api/customization/rules/bulk-import        # Import rules from CSV
GET    /api/customization/rules/export             # Export rules to CSV
POST   /api/customization/rules/bulk-apply         # Apply rule to multiple employees
```

---

## Rule Evaluation Algorithm

```typescript
function applyCustomizations(
  entityType: string,
  entityId: string | null,
  baseConfig: any,
  context: CustomizationContext
): any {
  // 1. Fetch all active rules for entity type
  const rules = await getRules(entityType, entityId);
  
  // 2. Filter rules matching context (branch, process, etc.)
  const matchingRules = rules.filter(rule => matchesContext(rule, context));
  
  // 3. Sort by priority (higher priority = applied last = wins)
  matchingRules.sort((a, b) => a.priority - b.priority);
  
  // 4. Apply rules sequentially
  let effectiveConfig = { ...baseConfig };
  
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
    
    // 5. Log application
    await logApplication(rule.id, context.employeeId, effectiveConfig);
  }
  
  return effectiveConfig;
}

function matchesContext(rule: CustomizationRule, context: CustomizationContext): boolean {
  // Rule matches if ANY specified dimension matches context
  if (rule.branch_ids?.length && !rule.branch_ids.includes(context.branchId)) return false;
  if (rule.process_ids?.length && !rule.process_ids.includes(context.processId)) return false;
  if (rule.department_ids?.length && !rule.department_ids.includes(context.departmentId)) return false;
  if (rule.designation_ids?.length && !rule.designation_ids.includes(context.designationId)) return false;
  if (rule.role_ids?.length && !rule.role_ids.includes(context.roleId)) return false;
  if (rule.employee_ids?.length && !rule.employee_ids.includes(context.employeeId)) return false;
  
  // Check date range
  const now = new Date();
  if (rule.effective_from && new Date(rule.effective_from) > now) return false;
  if (rule.effective_to && new Date(rule.effective_to) < now) return false;
  
  return true;
}
```

---

## Examples

### Example 1: Leave Type Customization

**Base Config**:
```json
{
  "leave_type_id": "casual-leave",
  "name": "Casual Leave",
  "max_days_per_request": 5,
  "max_days_per_year": 12,
  "carry_forward_allowed": true,
  "encashment_allowed": false
}
```

**Customization Rule** (Mumbai Branch):
```json
{
  "branch_ids": ["mumbai-branch-uuid"],
  "config_type": "override",
  "config_data": {
    "max_days_per_year": 15
  }
}
```

**Effective Config** (Mumbai employee):
```json
{
  "leave_type_id": "casual-leave",
  "name": "Casual Leave",
  "max_days_per_request": 5,
  "max_days_per_year": 15,  // Overridden
  "carry_forward_allowed": true,
  "encashment_allowed": false
}
```

### Example 2: Multi-Dimensional Rule

**Rule**: Senior Sales Managers get extended leave

```json
{
  "rule_name": "Senior Sales Extended Leave",
  "entity_type": "leave_type",
  "entity_id": "earned-leave",
  "department_ids": ["sales-dept-uuid"],
  "designation_ids": ["senior-manager-uuid"],
  "config_type": "override",
  "priority": 10,
  "config_data": {
    "max_days_per_year": 30,
    "encashment_allowed": true
  }
}
```

Only applies when:
- Department = Sales AND
- Designation = Senior Manager

---

## Migration Path

### Step 1: Create Tables
```bash
mysql -h 122.184.128.90 -u shivam_user -p'qwersdfg!@#hjk' mas_hrms < backend/sql/050_customization.sql
```

### Step 2: Implement Backend
```bash
# Create module files
# Implement service logic
# Add API routes
# Test with curl
```

### Step 3: Integrate with Existing Masters
```bash
# Update leave.service.ts to use customization engine
# Update payroll.service.ts
# Update wfm.service.ts
# etc.
```

### Step 4: Build Admin UI
```bash
# Create customization management pages
# Add to navigation
# Test rule creation + preview
```

---

## Testing

### Unit Tests
```typescript
describe('Customization Engine', () => {
  it('applies override rule correctly', () => {
    const base = { maxDays: 5 };
    const rule = { config_type: 'override', config_data: { maxDays: 10 } };
    const result = applyRule(base, rule);
    expect(result.maxDays).toBe(10);
  });
  
  it('merges nested config', () => {
    const base = { policy: { grace: 5, late: 30 } };
    const rule = { config_type: 'merge', config_data: { policy: { grace: 10 } } };
    const result = applyRule(base, rule);
    expect(result.policy).toEqual({ grace: 10, late: 30 });
  });
  
  it('applies rules by priority', () => {
    const base = { value: 1 };
    const rules = [
      { priority: 1, config_data: { value: 2 } },
      { priority: 10, config_data: { value: 3 } }
    ];
    const result = applyRules(base, rules);
    expect(result.value).toBe(3); // Higher priority wins
  });
});
```

### Integration Tests
```bash
# Test: Employee in Mumbai branch gets customized leave limit
curl -H "Authorization: Bearer <token>" \
  "http://localhost:5055/api/customization/effective?employeeId=<id>&entityType=leave_type&entityId=casual-leave"

# Expected: max_days_per_year = 15 (not 12)
```

---

## Performance Considerations

1. **Caching**: Cache effective configs per employee + entity (TTL: 1 hour)
2. **Indexing**: Index on entity_type, is_active, effective dates
3. **Lazy Loading**: Only evaluate rules when accessed (not on login)
4. **Batch Processing**: Bulk apply rules overnight for all employees

---

## Security

1. **RBAC**: Only admin + HR can create/edit rules
2. **Audit**: All rule applications logged
3. **Validation**: JSON schema validation for config_data
4. **Isolation**: Rules cannot access sensitive data outside their scope

---

## Future Enhancements

1. **Rule Templates**: Pre-built rules for common scenarios
2. **Version Control**: Track rule changes over time
3. **A/B Testing**: Enable experimental rules for subsets
4. **ML-Powered**: Suggest rules based on usage patterns
5. **Multi-Tenant**: Isolate rules per organization

---

**Document Status**: Design Complete  
**Implementation Priority**: P1 (High)  
**Estimated Effort**: 3-4 weeks  
**Dependencies**: None (standalone module)
