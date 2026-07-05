-- 351_page_catalog_route_repairs.sql
-- Repair live page_catalog links that were inserted earlier with NULL or legacy paths.
-- Safe to re-run.

UPDATE page_catalog SET page_path = '/audit-log'
WHERE page_code = 'AUDIT_LOG';

UPDATE page_catalog SET page_path = '/migration-console'
WHERE page_code IN ('MIGRATION_CONSOLE', 'ISPARK_MIGRATION');

UPDATE page_catalog SET page_path = '/ats/command-center'
WHERE page_code IN ('ATS_COMMAND_CENTER', 'ATS_HEALTH_CHECK');

UPDATE page_catalog SET page_path = '/ats/recruiter/my-candidates'
WHERE page_code IN ('ATS_INTERVIEW_APPROVALS', 'ATS_INTERVIEW_QUEUE', 'ATS_INTERVIEW_SUBMIT', 'ATS_RECRUITER_QUEUE');

UPDATE page_catalog SET page_path = '/ats/name-consistency'
WHERE page_code = 'NAME_CONSISTENCY_MATRIX';

UPDATE page_catalog SET page_path = '/candidate-onboarding-full'
WHERE page_code = 'CANDIDATE_ONBOARDING_FULL';

UPDATE page_catalog SET page_path = '/privacy/dpdp-withdrawal'
WHERE page_code = 'DPDP_WITHDRAWAL';

UPDATE page_catalog SET page_path = '/compliance/dpdp-withdrawal-admin'
WHERE page_code = 'DPDP_WITHDRAWAL_ADMIN';

UPDATE page_catalog SET page_path = '/ceo/dashboard'
WHERE page_code = 'CEO_DASHBOARD';

UPDATE page_catalog SET page_path = '/hr/dashboard'
WHERE page_code = 'HR_DASHBOARD';

UPDATE page_catalog SET page_path = '/my-dashboard'
WHERE page_code = 'EMPLOYEE_SELF_DASHBOARD';

UPDATE page_catalog SET page_path = '/payroll-hr/dashboard'
WHERE page_code = 'PAYROLL_HR_DASHBOARD';

UPDATE page_catalog SET page_path = '/wfm/dashboard'
WHERE page_code = 'WFM_DASHBOARD';

UPDATE page_catalog SET page_path = '/management/dashboard'
WHERE page_code IN ('BRANCH_HEAD_DASHBOARD', 'COMPLIANCE_DASHBOARD', 'FINANCE_HEAD_DASHBOARD', 'OPERATIONS_HEAD_DASHBOARD', 'PROCESS_MANAGER_DASHBOARD', 'PROVISIONING_DASHBOARD');

UPDATE page_catalog SET page_path = '/ats/recruiter/hiring-dashboard'
WHERE page_code = 'RECRUITER_DASHBOARD';

UPDATE page_catalog SET page_path = '/employees'
WHERE page_code IN ('EMPLOYEES', 'EMPLOYEE_MANAGEMENT');

UPDATE page_catalog SET page_path = '/payroll/epf-compliance'
WHERE page_code IN ('EMPLOYEE_EPF_COMPLIANCE', 'PAYROLL_EPF_COMPLIANCE');

UPDATE page_catalog SET page_path = '/payroll/incentives'
WHERE page_code IN ('PAYROLL_INCENTIVE_APPROVALS', 'PAYROLL_INCENTIVE_REGISTER', 'PAYROLL_INCENTIVE_UPLOAD', 'SALARY_PROPOSAL_QUEUE', 'SALARY_SLAB_MASTER');

UPDATE page_catalog SET page_path = '/employees'
WHERE page_code = 'EMPLOYEE_JOINING_DOCUMENTS';

UPDATE page_catalog SET page_path = '/people-experience/command-center'
WHERE page_code IN ('PEOPLE_EXPERIENCE_COMMAND_CENTER', 'ENGAGEMENT_COMMAND_CENTER');

UPDATE page_catalog SET page_path = '/exit/resignation'
WHERE page_code = 'RESIGNATION_MY_REQUEST';

UPDATE page_catalog SET page_path = '/exit/resignation-command-center'
WHERE page_code = 'RESIGNATION_COMMAND_CENTER';

UPDATE page_catalog SET page_path = '/governance/tat-matrix'
WHERE page_code = 'TAT_MATRIX';

UPDATE page_catalog SET page_path = '/governance/tat-dashboard'
WHERE page_code = 'TAT_DASHBOARD';

UPDATE page_catalog SET page_path = '/support/grievance-command-center'
WHERE page_code = 'GRIEVANCE_COMMAND_CENTER';

UPDATE page_catalog SET page_path = '/support/command-center'
WHERE page_code = 'SUPPORT_COMMAND_CENTER';

UPDATE page_catalog SET page_path = '/letters/appointment-esign'
WHERE page_code = 'APPOINTMENT_ESIGN';

UPDATE page_catalog SET page_path = '/it-provisioning'
WHERE page_code = 'IT_PROVISIONING_TRACKER';
