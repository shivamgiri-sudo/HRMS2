# BROKEN_SQL_ARTIFACT_COLUMNS_REPORT

**Generated:** 2026-06-25  
**Database:** mas_hrms (122.184.128.90:3306)  
**Latest Commit:** eb0f12b fix: wire DB-resolved roles in expenses/DPDP, add onboarding link endpoint, add ATS status machine

## Query Executed
```sql
SELECT 
  TABLE_NAME,
  COLUMN_NAME,
  COLUMN_TYPE,
  IS_NULLABLE,
  COLUMN_DEFAULT
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = 'mas_hrms'
  AND COLUMN_NAME IN ('IF', 'INDEX', 'UNIQUE', 'CONSTRAINT', 'KEY', 'NOT')
ORDER BY TABLE_NAME, COLUMN_NAME;
```

## Results
**NO BROKEN SQL ARTIFACT COLUMNS FOUND**

The database does not contain any columns named `IF`, `INDEX`, `UNIQUE`, `CONSTRAINT`, `KEY`, or `NOT`. This indicates that the migration scripts have not introduced SQL keyword artifacts as column names.

## Classification Summary
| Column Name | Status | Tables Affected | Row Count | Non-Null Count | Code Usage | Migration Source | Cleanup Recommendation |
|-------------|--------|-----------------|-----------|----------------|------------|------------------|------------------------|
| IF | NOT FOUND | - | - | - | - | - | N/A |
| INDEX | NOT FOUND | - | - | - | - | - | N/A |
| UNIQUE | NOT FOUND | - | - | - | - | - | N/A |
| CONSTRAINT | NOT FOUND | - | - | - | - | - | N/A |
| KEY | NOT FOUND | - | - | - | - | - | N/A |
| NOT | NOT FOUND | - | - | - | - | - | N/A |

## Notes
- The schema migration history (215 migrations in `schema_migrations` table) appears to have avoided creating SQL keyword columns
- No cleanup action required for this category
- Continue monitoring future migrations for proper quoting of identifiers