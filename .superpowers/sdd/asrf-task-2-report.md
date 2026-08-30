# Task 2 Completion Report: Migrations 1633–1635

## Summary
Task 2 implemented three new SQL migration files and a contract test for the Attendance Source Rule Foundation feature. All work was purely additive with no database execution.

## Work Completed

### Files Created

1. **backend/sql/1633_attendance_source_rule_store.sql**
   - Creates `attendance_source_rule` table with columns: id, rule_name, attendance_source (ENUM: dialler/biometric), effective_from, effective_to, change_reason, active_status, created_by, created_at, updated_at
   - Creates `attendance_source_rule_dimension_value` child table with composite primary key (rule_id, dimension, value_id)
   - Declares proper charset and collation (utf8mb4_unicode_ci) per Global Constraints
   - No FOREIGN KEY constraints per established convention

2. **backend/sql/1634_day_threshold_rule_store.sql**
   - Creates `day_threshold_rule` table with threshold columns: full_day_minutes, half_day_minutes, grace_minutes (SMALLINT UNSIGNED)
   - Creates `day_threshold_rule_dimension_value` child table with same structure as 1633's dimension_value
   - Proper charset/collation and indexing for date-window filtering
   - No FOREIGN KEY constraints

3. **backend/sql/1635_attendance_threshold_and_ceiling_store.sql**
   - Creates `attendance_threshold_rule` table with threshold_kind ENUM (apr_corroboration/variance_tolerance/floor_absence_ceiling) discriminator
   - Creates `attendance_threshold_rule_dimension_value` child table
   - Creates `attendance_dual_review_ceiling` table with branch_id and pay_month scope (not the six dimensions), including UNIQUE KEY constraint
   - Proper charset/collation and appropriate indexing

4. **backend/src/db/__tests__/attendance-source-rule-store-migration.contract.test.ts**
   - vitest contract test with 6 assertions
   - Validates exact SQL column declarations (whitespace-sensitive `toContain` checks)
   - Verifies absence of FOREIGN KEY constraints across all three migrations
   - Confirms correct ENUM declarations and collation settings

### Test Execution

Command: `cd backend && npx vitest run src/db/__tests__/attendance-source-rule-store-migration.contract.test.ts`

Result:
```
Test Files  1 passed (1)
     Tests  6 passed (6)
  Start at  01:51:46
  Duration  894ms
```

All 6 tests passed:
1. 1633 attendance_source_rule ENUM and COLLATE validation
2. 1633 dimension_value composite key validation
3. 1634 day_threshold_rule threshold columns validation
4. 1635 threshold_kind ENUM validation
5. 1635 attendance_dual_review_ceiling scope validation
6. All three migrations lack FOREIGN KEY constraints

### Git Commit

Commit SHA: **005e1b5b**

Staged files (4 total):
- backend/sql/1633_attendance_source_rule_store.sql
- backend/sql/1634_day_threshold_rule_store.sql
- backend/sql/1635_attendance_threshold_and_ceiling_store.sql
- backend/src/db/__tests__/attendance-source-rule-store-migration.contract.test.ts

Commit message (exact per brief Step 6):
```
feat: add attendance_source_rule, day_threshold_rule, attendance_threshold_rule and attendance_dual_review_ceiling tables (unexecuted)
```

## Implementation Notes

- All SQL and test content was copied verbatim from the brief, preserving exact whitespace and formatting (critical for whitespace-sensitive test assertions)
- No database connections or execution occurred (migrations are marked NOT YET EXECUTED pending owner approval)
- Followed Global Constraints: utf8mb4_unicode_ci collation explicit, no FOREIGN KEY constraints, CHAR(36) IDs per convention
- Tests use text-based parsing (readFileSync) to validate schema structure without database interaction

## Concerns

None. All requirements met, all tests passing, commit successful.

---

## Task 2 Review Fixes (Post-Review)

### Fixes Applied

#### Fix 1: Strengthen existing test for 1633 to check COLLATE and ENGINE occurrence counts

**Changed:** Test `'1633 declares attendance_source_rule with the ENUM and COLLATE this design requires'`

**From:**
```typescript
expect(sql).toContain('COLLATE=utf8mb4_unicode_ci');
```

**To:**
```typescript
expect((sql.match(/COLLATE=utf8mb4_unicode_ci/g) || []).length).toBe(2);
expect((sql.match(/ENGINE=InnoDB/g) || []).length).toBe(2);
```

**Verified occurrence counts in 1633_attendance_source_rule_store.sql:**
- `COLLATE=utf8mb4_unicode_ci`: 2 occurrences (line 53 in `attendance_source_rule`, line 64 in `attendance_source_rule_dimension_value`)
- `ENGINE=InnoDB`: 2 occurrences (line 51 in `attendance_source_rule`, line 62 in `attendance_source_rule_dimension_value`)

#### Fix 2: Add test for 1634 migration (day_threshold_rule store)

**Added new test:** `'1634 declares utf8mb4_unicode_ci COLLATE and ENGINE=InnoDB on both its tables'`

Verifies:
- `COLLATE=utf8mb4_unicode_ci` count = 2 (line 41 in `day_threshold_rule`, line 52 in `day_threshold_rule_dimension_value`)
- `ENGINE=InnoDB` count = 2 (line 39 in `day_threshold_rule`, line 50 in `day_threshold_rule_dimension_value`)

#### Fix 3: Add test for 1635 migration (threshold and ceiling store)

**Added new test:** `'1635 declares utf8mb4_unicode_ci COLLATE and ENGINE=InnoDB on all three of its tables'`

Verifies:
- `COLLATE=utf8mb4_unicode_ci` count = 3 (line 41 in `attendance_threshold_rule`, line 52 in `attendance_threshold_rule_dimension_value`, line 68 in `attendance_dual_review_ceiling`)
- `ENGINE=InnoDB` count = 3 (line 39 in `attendance_threshold_rule`, line 50 in `attendance_threshold_rule_dimension_value`, line 66 in `attendance_dual_review_ceiling`)

#### Fix 4: Add NULL-key caveat comment to 1635 SQL file

**Added comment near `attendance_dual_review_ceiling` table definition:**

```sql
-- Note: UNIQUE KEY uq_adrc_scope cannot prevent multiple (NULL, NULL) rows because MySQL's
-- unique index treats NULL-vs-NULL as distinct. At most one truly-global (branch_id, pay_month
-- both NULL) ceiling row is a write-path invariant, not something this key enforces alone.
```

### Test Execution

```
cd backend && npx vitest run src/db/__tests__/attendance-source-rule-store-migration.contract.test.ts
```

Result:
```
Test Files  1 passed (1)
     Tests  8 passed (8)
  Start at  01:56:42
  Duration  1.11s
```

All 8 tests passed (6 original + 2 new):
1. 1633 attendance_source_rule ENUM and COLLATE validation (with strengthened occurrence checks)
2. 1633 dimension_value composite key validation
3. 1634 day_threshold_rule threshold columns validation
4. 1634 COLLATE and ENGINE occurrence validation (**NEW**)
5. 1635 threshold_kind ENUM validation
6. 1635 attendance_dual_review_ceiling scope validation
7. 1635 COLLATE and ENGINE occurrence validation (**NEW**)
8. All three migrations lack FOREIGN KEY constraints

### Git Commit

Staged files (2 total):
- backend/sql/1635_attendance_threshold_and_ceiling_store.sql
- backend/src/db/__tests__/attendance-source-rule-store-migration.contract.test.ts

Commit SHA: **17148aa6**

Commit message:
```
fix: strengthen migration collation/engine contract tests to check every table, not just the first (Task 2 review)
```

### Review Findings Resolution

1. ✅ **Important finding 1** — COLLATE regression catch: Changed from single `toContain()` to counted regex match pattern; now catches if COLLATE is dropped from the second table in any migration.

2. ✅ **Important finding 2** — Missing 1634/1635 tests: Added two new tests that verify all tables in each migration declare the required COLLATE and ENGINE settings.

3. ✅ **Minor finding 3** — NULL-key caveat: Added explanatory comment to 1635 SQL file documenting that the UNIQUE KEY constraint cannot prevent multiple (NULL, NULL) rows, same as noted in 1633's header comment.
