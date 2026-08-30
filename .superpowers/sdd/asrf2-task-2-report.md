# Task 2 Implementation Report: Migration 1637 & Contract Tests

## Status: DONE_WITH_CONCERNS

## Summary
Task 2 has been completed with all required files created and committed. The migration and test code have been copied exactly as specified in the brief. However, the vitest contract tests fail due to an inconsistency in the brief itself.

## Files Created
1. `backend/sql/1637_canonical_productivity_store.sql` - Migration with three ALTER statements using PREPARE/EXECUTE guard pattern, plus two new materialisation tables
2. `backend/src/db/__tests__/canonical-productivity-store-migration.contract.test.ts` - Contract test suite with 6 test cases

## Commit
- SHA: `965e341a`
- Message: `feat: add campaign_master ownership columns + attendance_productive_day/contribution tables (Requirement 16/18, unexecuted)`

## Test Results
Test run output: `2 failed | 4 passed (6 total)`

### Test Failures Analysis

The test suite fails on two assertions due to comment text in the migration SQL matching overly-broad regex patterns in the tests:

1. **Test: "guards all three campaign_master ALTERs on information_schema (no bare ADD COLUMN IF NOT EXISTS)"**
   - Expected: SQL should not contain the string "ADD COLUMN IF NOT EXISTS"
   - Actual: The string appears in a comment explaining the rationale: `"-- because ADD COLUMN IF NOT EXISTS is not valid MySQL 8 syntax"`
   - Root cause: The regex `/ADD COLUMN IF NOT EXISTS/i` matches comment text, not just SQL statements

2. **Test: "does not touch campaign_master's existing FOREIGN KEYs"**
   - Expected: SQL should not contain DROP statements
   - Actual: DROP COLUMN appears in a commented-out ROLLBACK section: `"--   ALTER TABLE campaign_master DROP COLUMN is_sentinel..."`
   - Root cause: The regex `/DROP\s+(COLUMN|CONSTRAINT|FOREIGN KEY)/i` matches comment text, not just active SQL

### Assessment

The migration SQL itself is **correct**:
- It properly uses the INFORMATION_SCHEMA.COLUMNS + PREPARE/EXECUTE guard pattern (not bare ADD COLUMN IF NOT EXISTS)
- It does not add FOREIGN KEY constraints to new columns (matching no-FK convention)
- Actual SQL statements contain no DROP operations

The test regexes are **too broad**:
- They match prose in comments rather than only active SQL statements
- This mirrors the bug mentioned in the brief: "the exact bug Task 1's brief had" regarding FK-detection false positives

The brief mentioned "this brief has already been corrected once" for the FK regex to avoid false positives on comments. The same fix appears not to have been applied to the other two test assertions.

## Recommendations

1. The SQL migration (1637) is ready for deployment once execution is approved
2. The test file should be updated to use more precise regex patterns that exclude comment blocks, similar to the FK-detection regex correction
3. The brief may need another revision pass to address these inconsistencies in test expectations

## Concerns
- Tests fail despite exact compliance with brief specifications
- This suggests remaining issues in the brief that may need correction
- Recommend validation against known working examples (e.g., migration 1630 referenced in comments)


---

## Controller note (post-implementer)

Implementer correctly reported DONE_WITH_CONCERNS: 2/6 tests failed. Root cause was in the PLAN/BRIEF itself, not the implementation: two contract-test assertions ran naive negative regexes (`not.toMatch(/DROP.../)`, `not.toMatch(/ADD COLUMN IF NOT EXISTS/)`) against the WHOLE SQL file including its own header comments, which legitimately document the ROLLBACK (DROP TABLE/DROP COLUMN) and explain why the PREPARE/EXECUTE guard exists (mentioning the literal invalid syntax it guards against). Same bug class as Task 1's FOREIGN KEY-phrase issue, now the third occurrence. Controller fixed by stripping `--`-prefixed comment lines before the three negative-assertion checks (6/6 pass), and proactively checked Task 1 (not at risk, no DROP assertion existed there) and Tasks 3-5 (no SQL-text contract tests, not at risk).
