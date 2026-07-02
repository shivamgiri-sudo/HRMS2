# Statutory Compliance Page Review

## Page checked

```text
/compliance/statutory
```

## Files checked

```text
src/pages/NativeStatutoryCompliance.tsx
backend/src/modules/payroll/payroll-extended.routes.ts
backend/src/modules/employees/employee.service.ts
```

## Concrete issue fixed

The UAN tab expected employee rows with:

```text
employee_id
uan
member_id
epf_join_date
```

The employee list returned `id` but not `employee_id`, and did not include UAN values.

Fix completed:

```text
backend/src/modules/employees/employee.service.ts
```

Employee list rows now include:

```text
employee_id alias
uan
member_id
epf_join_date
```

This prevents the UAN modal from receiving an undefined employee id.

## Remaining page issues

```text
UAN list still uses capped employee list.
UAN search is client-side.
PT state list is hardcoded in frontend.
PT slab selects are native HTML selects.
Payroll run dropdown uses fixed limit.
Copy/export actions need backend audit.
ECR/ESIC should show readiness warnings before generation.
```

## Next fixes

```text
Add dedicated UAN list API with pagination and search.
Render member ID and EPF join date in the table.
Move PT state list to backend config.
Use shared Select component.
Add compliance insight cards for missing UAN/PAN/ESIC.
```
