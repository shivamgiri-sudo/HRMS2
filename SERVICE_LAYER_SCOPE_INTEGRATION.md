# Service Layer Scope Integration

**Date**: 2026-06-04  
**Purpose**: Integrate scopeFilter WHERE clause into service layer list methods

---

## 🎯 OBJECTIVE

Routes pass `scopeFilter` SQL to service methods, but services don't use it yet.

**Current Flow**:
```typescript
// Route
const scoped = await buildScopeWhereClause(...);
(req as any).scopeFilter = scoped;
return controller(req, res);

// Controller
const filters = { ...req.query, scopeFilter: (req as any).scopeFilter };
const result = await service.listEmployees(filters);

// Service (PROBLEM: doesn't use scopeFilter!)
const where = `WHERE ${conds.join(" AND ")}`;
```

**Target Flow**:
```typescript
// Service (FIXED)
if (filters.scopeFilter) {
  conds.push(filters.scopeFilter.replace(/^WHERE\s+/i, ''));
}
const where = `WHERE ${conds.join(" AND ")}`;
```

---

## 📝 FILES TO UPDATE

### 1. employee.service.ts
```typescript
async listEmployees(filters: EmployeeFilters): Promise<PaginatedResult<Employee>> {
  const { page, limit, status, processId, branchId, search, scopeFilter } = filters;
  const offset = (page - 1) * limit;
  const conds: string[] = ["active_status = 1"];
  const params: unknown[] = [];

  if (status)    { conds.push("employment_status = ?"); params.push(status); }
  if (processId) { conds.push("process_id = ?");        params.push(processId); }
  if (branchId)  { conds.push("branch_id = ?");         params.push(branchId); }
  if (search)    { conds.push("(full_name LIKE ? OR employee_code LIKE ?)"); params.push(`%${search}%`, `%${search}%`); }
  
  // ADD THIS: Apply scope filter
  if (scopeFilter) {
    const scopeClause = scopeFilter.replace(/^WHERE\s+/i, '').trim();
    if (scopeClause) conds.push(`(${scopeClause})`);
  }

  const where = `WHERE ${conds.join(" AND ")}`;
  // ... rest unchanged
}
```

### 2. ats.service.ts (or controller if service doesn't exist)
Similar pattern for candidate list filtering

### 3. payroll.service.ts
Similar pattern for runs/lines list filtering

---

## ⚠️ IMPORTANT NOTES

1. **Remove "WHERE" prefix**: scopeFilter includes "WHERE", strip it before appending
2. **Wrap in parentheses**: Scope clause may have OR conditions, wrap: `(scope clause)`
3. **Check null/empty**: Don't append empty strings
4. **Parameter binding**: scopeFilter is already SQL, don't add params

---

## 🧪 TESTING

After update, test:
```bash
# HR Pune should see ONLY Delhi branch employees
GET /api/employees
Authorization: Bearer <hr_token>

# Expected SQL:
# WHERE active_status = 1 
# AND ((e.branch_id = '6a8f81b1-5caf-11f1-adb1-00155d0ab410'))
```

---

## 📅 IMPLEMENTATION

Updating employee.service.ts now...
