# CEO Demo Auth Mapping Runbook

This runbook is for non-production/demo only. Do not run on production without explicit approval.

## Purpose

The PeopleOS demo seed creates MySQL demo records and role rows. Supabase Auth owns real login accounts. For a real browser demo, each demo email must exist in Supabase Auth and its Supabase Auth UUID must be mapped in `mas_hrms.user_roles.user_id`.

## Hard Safety Rules

- Do not store real passwords in Git.
- Do not paste service-role keys in chat or PR comments.
- Do not run on production.
- Keep demo user creation restricted to the demo/local/staging Supabase project.
- Client user must remain aggregate-only.

## Demo Emails

- superadmin@demo.peopleOS.ai
- hradmin@demo.peopleOS.ai
- recruiter@demo.peopleOS.ai
- employee@demo.peopleOS.ai
- wfm@demo.peopleOS.ai
- processmanager@demo.peopleOS.ai
- am@demo.peopleOS.ai
- tl@demo.peopleOS.ai
- qa@demo.peopleOS.ai
- trainer@demo.peopleOS.ai
- payroll@demo.peopleOS.ai
- branchhead@demo.peopleOS.ai
- ceo@demo.peopleOS.ai
- client@demo.peopleOS.ai
- shivam.giri@teammas.in

## Required Role Mapping

| Email | Role |
|---|---|
| shivam.giri@teammas.in | super_admin |
| superadmin@demo.peopleOS.ai | super_admin |
| hradmin@demo.peopleOS.ai | hr |
| recruiter@demo.peopleOS.ai | recruiter |
| employee@demo.peopleOS.ai | employee |
| wfm@demo.peopleOS.ai | wfm |
| processmanager@demo.peopleOS.ai | process_manager |
| am@demo.peopleOS.ai | assistant_manager |
| tl@demo.peopleOS.ai | team_leader |
| qa@demo.peopleOS.ai | qa |
| trainer@demo.peopleOS.ai | trainer |
| payroll@demo.peopleOS.ai | finance |
| branchhead@demo.peopleOS.ai | branch_head |
| ceo@demo.peopleOS.ai | ceo |
| client@demo.peopleOS.ai | client_user |

## Process

1. Create the demo users in the non-production Supabase project using the dashboard or a local admin script.
2. Copy each Supabase Auth UUID.
3. Update `mas_hrms.user_roles` for each UUID and role.
4. Run the PeopleOS API using the non-production environment.
5. Login as each role and verify visible modules against `docs/demo/DEMO_LOGIN_MATRIX.md`.

## SQL Template

Replace `<SUPABASE_AUTH_UUID>` with the actual UUID from Supabase Auth.

```sql
INSERT INTO user_roles (id, user_id, role_key, active_status)
VALUES (UUID(), '<SUPABASE_AUTH_UUID>', '<ROLE_KEY>', 1)
ON DUPLICATE KEY UPDATE active_status = 1;
```

## Shivam Super Admin Mapping

```sql
INSERT INTO user_roles (id, user_id, role_key, active_status)
VALUES (UUID(), '<SHIVAM_SUPABASE_AUTH_UUID>', 'super_admin', 1)
ON DUPLICATE KEY UPDATE active_status = 1;
```

## Validation Checklist

- Shivam login opens all internal modules.
- Super Admin can open Account Control.
- HR Admin cannot access Client Portal as client.
- Payroll/Finance cannot access Client Portal.
- Client User sees only aggregate Client Portal data.
- TL/AM cannot edit published roster truth.
- WFM/Process Manager can view workforce mandate and capacity.
- No salary, payroll, employee documents, raw roster rows, attendance reasons, grievances, or candidate PII are visible to Client User.
