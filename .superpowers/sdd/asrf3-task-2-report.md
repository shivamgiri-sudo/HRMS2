# Task 2: `parseUploadRow()` — Column-Mapping-Driven Row Parser

## Summary
Successfully implemented a pure column-mapping-driven row parser for WFM manual productivity uploads, with full test coverage.

## Work Completed

### Files Created
1. **backend/src/modules/wfm/productivity-upload-parser.ts** (115 lines)
   - Exports `UploadTargetField` type union (9 field types)
   - Exports `MANDATORY_UPLOAD_FIELDS` constant array (`['employee_code', 'report_date', 'login_minutes']`)
   - Exports `ParsedRow` interface with mandatory + optional fields
   - Exports `ParseResult` type (success with row, or failure with reason string)
   - Implements `checkMappingCoversMandatoryFields()` — validates a column mapping covers all mandatory fields, names all missing fields
   - Implements `parseUploadRow()` — applies mapping to raw row, coerces numerics, validates constraints, returns normalized ParsedRow or rejection reason

2. **backend/src/modules/wfm/__tests__/productivity-upload-parser.test.ts** (140 lines)
   - 10 tests covering:
     - MANDATORY_UPLOAD_FIELDS constant (criterion 17.4)
     - checkMappingCoversMandatoryFields() with 3 cases (covers all, partial, empty)
     - parseUploadRow() with 7 cases (well-formed row, blank optional fields, missing mandatory, non-numeric, negative value, unmapped columns)

### Test Results
- All 10 tests pass
- Test execution time: 957ms total

### Commit
```
db1a4b7f feat: add parseUploadRow() — column-mapping-driven WFM upload row parser (Requirement 17)
```

## Implementation Notes

### Key Design Decisions
1. **Pure Function**: No database access. The mapping is passed in from Phase 2's registry and applied to one raw row at a time.
2. **Mandatory Field Set**: Exactly three fields per Requirement 17.4: employee_code, report_date, login_minutes
3. **Numeric Coercion**: Seven fields (all except employee_code and report_date) are numeric: login_minutes, calls_handled, aht_seconds, bio_minutes, lunch_minutes, qa_minutes, training_minutes
4. **Blank Handling**: Blank optional fields are omitted from the output (not set to 0 or null). Blank mandatory fields trigger specific rejection.
5. **Error Messages**: Each rejection names the exact field and the constraint violated (required-but-blank, not-a-valid-number with value, must-not-be-negative with value)

### Test Coverage
- Happy path: well-formed row with all and partial optional fields
- Blank optional fields: properly omitted from result
- Mandatory field validation: each mandatory field checked; rejection names which field
- Numeric validation: non-numeric strings rejected with the raw value quoted; negative values rejected with the parsed number shown
- Column unmapping: raw columns with no mapping entry are safely ignored

## Verification
- All code matches the brief specification exactly (including error message strings)
- Tests verify correct behavior against all documented constraints
- Code is ready for Phase 4's upload route to consume
