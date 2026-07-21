# Task 1 Report: ATS Performance Indexes (Migration 519)

## Status
**COMPLETE** — All deliverables created and committed.

## Commit Hash
```
a7fddf5b
```

## Files Created/Modified

### 1. `backend/sql/519_ats_performance_indexes.sql` (NEW)
- Created 7 covering indexes using MySQL 5.7-safe INFORMATION_SCHEMA guards
- No `ADD INDEX IF NOT EXISTS` — uses PREPARE/EXECUTE pattern for idempotent index creation
- Indexes created:
  1. `idx_ats_cand_active_created` on `ats_candidate` — hot filter for `webData()` 
  2. `idx_ats_cand_active_stage` on `ats_candidate` — for `getDashboardMetrics()` COUNTs
  3. `idx_ats_cand_active_created_at` on `ats_candidate` — fallback sort index
  4. `idx_ats_asmt_candidate_id` on `ats_candidate_assessment` — speeds up scores subquery
  5. `idx_ats_typing_asmt_id` on `ats_typing_test_attempt` — speeds up JOIN in scores subquery
  6. `idx_ats_qt_status_arrival` on `ats_queue_token` — for `position_in_queue` subquery
  7. `idx_ats_qt_candidate_status` on `ats_queue_token` — for candidate-scoped queue lookups

### 2. `backend/src/db/runPendingMigrations.ts` (MODIFIED)
- Added `"519_ats_performance_indexes.sql"` to MIGRATION_MANIFEST
- Positioned immediately after `518_dpdp_feature_flags.sql`
- Added inline comment: `// ATS command center covering indexes`

## TypeScript Validation
```
✓ npx tsc --noEmit
→ 0 errors
```

## Query Performance Impact (Expected)

These indexes directly support the ATS Command Center query paths:

- **`webData()` filter**: `active_status=X AND created_date BETWEEN Y AND Z` — now covered by `idx_ats_cand_active_created`
- **Dashboard metrics counts**: Separate COUNTs grouped by `current_stage` — now covered by `idx_ats_cand_active_stage`
- **Candidate assessment scores**: Subquery joins `ats_candidate_assessment` by `candidate_id` — now indexed
- **Typing test scores**: JOIN on `assessment_id` — now indexed
- **Queue position calculation**: Window function-style lookup of `queue_status=pending AND arrival_time < now()` — now covered by `idx_ats_qt_status_arrival`
- **Candidate queue lookups**: `candidate_id + queue_status` filters — now covered by `idx_ats_qt_candidate_status`

All 7 indexes are **idempotent** — safe to apply multiple times without error.

## Integration Points
- Migration runs automatically on backend startup via `runPendingMigrations.ts`
- Tracked in `schema_migrations` table after first successful execution
- No code changes required in service layers — indexes are transparent to existing queries

## Known Limitations / Concerns
None — this is a pure performance enhancement with:
- No data changes
- No API changes
- No breaking changes
- Backward compatible with all existing code

## Deployment Notes
1. Migration will execute on first backend startup after this commit
2. Index creation is a DDL operation and may briefly lock tables during creation (MySQL version dependent)
3. No downtime required — apply to live database safely
4. Once applied, cannot be rolled back without explicit DROP INDEX commands (recommend staging test first)

## Validation Steps (For User)
1. After backend restart, verify indexes exist:
   ```sql
   SHOW INDEXES FROM ats_candidate WHERE Key_name LIKE 'idx_ats_cand%';
   SHOW INDEXES FROM ats_candidate_assessment WHERE Key_name LIKE 'idx_ats_asmt%';
   SHOW INDEXES FROM ats_typing_test_attempt WHERE Key_name LIKE 'idx_ats_typing%';
   SHOW INDEXES FROM ats_queue_token WHERE Key_name LIKE 'idx_ats_qt%';
   ```

2. Verify migration was recorded:
   ```sql
   SELECT filename FROM schema_migrations WHERE filename='519_ats_performance_indexes.sql';
   ```

3. Test `/ats/command-center` page load time (should be significantly reduced from 30s+ timeout)
