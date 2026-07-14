#!/bin/bash
# Run Sidebar Migrations Script
# Execute this on a server with MySQL client installed

set -e

DB_HOST="122.184.128.90"
DB_PORT="3306"
DB_USER="shivam_user"
DB_PASSWORD="qwersdfg!@#hjk"
DB_NAME="mas_hrms"

echo "=========================================="
echo "Running Sidebar Migrations"
echo "=========================================="
echo ""

echo "Phase 1: Adding 18 critical missing pages..."
mysql -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" < backend/sql/add_missing_page_catalog_entries.sql

if [ $? -eq 0 ]; then
    echo "✓ Phase 1 migration completed successfully"
else
    echo "✗ Phase 1 migration failed"
    exit 1
fi

echo ""
echo "Phase 2: Adding 2 missing report pages..."
mysql -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" < backend/sql/add_missing_report_pages.sql

if [ $? -eq 0 ]; then
    echo "✓ Phase 2 migration completed successfully"
else
    echo "✗ Phase 2 migration failed"
    exit 1
fi

echo ""
echo "=========================================="
echo "Verification"
echo "=========================================="
echo ""

# Verify all pages were inserted
echo "Checking page_catalog entries..."
mysql -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" -e "
SELECT COUNT(*) as 'Total Pages Added'
FROM page_catalog
WHERE page_code IN (
  'MY_EXPENSES', 'EXPENSE_CREATE', 'EXPENSE_APPROVALS', 'EXPENSE_FINANCE', 'EXPENSE_REPORTS',
  'EMPLOYEE_DASHBOARD', 'CEO_DASHBOARD', 'HR_DASHBOARD', 'WFM_DASHBOARD', 'PAYROLL_DASHBOARD', 'MANAGER_DASHBOARD',
  'PAYROLL_DISBURSAL', 'PAYROLL_LOANS', 'SALARY_CERTIFICATE',
  'MODULE_ACCESS', 'SUPER_ADMIN_DASHBOARD', 'SECURITY_CENTER',
  'LMS_PROGRESS_DASHBOARD', 'COMPLIANCE_AUDIT_REPORT'
);
"

echo ""
echo "Showing added pages by module..."
mysql -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" -e "
SELECT pc.module, pc.page_code, pc.page_name, pc.active_status, COUNT(rpa.role_key) as role_count
FROM page_catalog pc
LEFT JOIN role_page_access rpa ON pc.page_code = rpa.page_code
WHERE pc.page_code IN (
  'MY_EXPENSES', 'EXPENSE_CREATE', 'EXPENSE_APPROVALS', 'EXPENSE_FINANCE', 'EXPENSE_REPORTS',
  'EMPLOYEE_DASHBOARD', 'CEO_DASHBOARD', 'HR_DASHBOARD', 'WFM_DASHBOARD', 'PAYROLL_DASHBOARD', 'MANAGER_DASHBOARD',
  'PAYROLL_DISBURSAL', 'PAYROLL_LOANS', 'SALARY_CERTIFICATE',
  'MODULE_ACCESS', 'SUPER_ADMIN_DASHBOARD', 'SECURITY_CENTER',
  'LMS_PROGRESS_DASHBOARD', 'COMPLIANCE_AUDIT_REPORT'
)
GROUP BY pc.page_code
ORDER BY pc.module, pc.page_code;
"

echo ""
echo "=========================================="
echo "✓ All migrations completed successfully!"
echo "=========================================="
echo ""
echo "Summary:"
echo "- Phase 1: 18 pages added (Expenses, Dashboards, Payroll, Admin)"
echo "- Phase 2: 2 pages added (LMS Progress, Compliance Audit)"
echo "- Total: 20 pages with role permissions configured"
echo ""
echo "Next steps:"
echo "1. Deploy frontend build to production"
echo "2. Test with different user roles"
echo "3. Verify sidebar shows new pages"
