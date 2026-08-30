# Task 4 Implementation Report — dialler-source-registry.service.ts

## Summary

Task 4 completed successfully. Implemented a read-only registry resolution service for resolving feed identifiers to active Dialler_Source rows and validating metric availability.

## Files Created

1. **backend/src/modules/wfm/dialler-source-registry.service.ts** (111 lines)
   - Exports `PRODUCTIVITY_METRICS`: E14 vocabulary (14 metrics)
   - Exports `validateMetricAvailability()`: validates a declared metric list against the controlled vocabulary
   - Exports `resolveActiveDiallerSource()`: resolves a feed identifier to an active source, with effective-date windowing
   - Exports `resolveCampaignOwner()`: resolves a campaign code to its owning source and sentinel status

2. **backend/src/modules/wfm/__tests__/dialler-source-registry.service.test.ts** (80 lines)
   - 7 test cases covering all exported functions
   - Uses vitest with mocked `db.execute()` from mysql.js

## Test Results

**All 7 tests pass:**
- PRODUCTIVITY_METRICS holds the E14 vocabulary
- validateMetricAvailability accepts a subset of the controlled list
- validateMetricAvailability rejects and names an unrecognised metric (criterion 16.3)
- resolveActiveDiallerSource returns null when no active row matches
- resolveActiveDiallerSource returns the row when found, with metric_availability parsed from JSON
- resolveCampaignOwner returns null when the campaign code is unknown
- resolveCampaignOwner returns the sentinel flag and owning source for a known campaign

## Commit

```
82546a76 feat: add dialler-source-registry.service.ts — resolveActiveDiallerSource(), resolveCampaignOwner(), Metric_Availability validation
```

## Implementation Notes

- Code copied verbatim from the brief specification
- Mock path verified: `vi.mock('../../../db/mysql.js')` is correct (test lives in `modules/wfm/__tests__/`)
- RowDataPacket types used to match mysql2 query result expectations
- All functions follow the requirements in the brief (criteria 16.4, 16.5, 16.7, 16.8)
- No external dependencies beyond existing mysql2 and vitest

## Concerns

None. All requirements met, all tests passing.
