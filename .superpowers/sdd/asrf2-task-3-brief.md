# Attendance Source Rules — Dialler Registry & Canonical Aggregation (Phase 2 of 11) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Register every dialler as a first-class `Dialler_Source`, give manual-upload sources a
JSON column-mapping so future uploads don't need a code change, and implement
`deriveCanonical()` — the single pure function that turns a set of per-source contributions for
one employee-date into exactly one Canonical_Productive_Minutes figure, bounded to a calendar
day, never by summing concurrent sessions. Schema + pure functions only, same as Phase 1 — no
ingestion wiring, no engine wiring.

**Architecture:** Two new tables (`dialler_source`, `dialler_source_column_mapping`), one altered
table (`campaign_master` gains ownership columns), two new materialisation tables
(`attendance_productive_day`, `attendance_productive_contribution` — created now, written by
nobody until Phase 3's ingestion tasks), one pure aggregation function
(`deriveCanonical()`), and one thin read-only registry service resolving a feed identifier to an
active `Dialler_Source` row.

**Tech Stack:** TypeScript, mysql2, vitest + fast-check (already a devDependency as of Phase 1),
plain SQL migrations under `backend/sql/`.

## Global Constraints

- No SQL runs against production without the owner's explicit approval (CLAUDE.md hard stop) —
  every migration in this plan is written and registered but **not executed**.
- `ADD COLUMN IF NOT EXISTS` is invalid on this server's MySQL 8.0.42. The `campaign_master`
  ALTER uses the `INFORMATION_SCHEMA.COLUMNS` + `SET @sql = IF(...)` + `PREPARE`/`EXECUTE` idiom,
  copied verbatim from migration 1630's proven pattern (`backend/sql/1630_grn_funding_cost_centre.sql`).
- Every new table declares `ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  explicitly.
- No `FOREIGN KEY` constraint on any NEW table or NEW column — plain indexed `CHAR(36)`, matching
  the convention every Phase 1 table already follows (and the reason migration 1500's FK is
  currently blocking every deploy). `campaign_master`'s two PRE-EXISTING FKs
  (`process_id`→`process_master`, `lob_id`→`lob_master`) are untouched — this migration adds
  columns, not constraints.
- Every migration file is registered in `MIGRATION_MANIFEST`
  (`backend/src/db/runPendingMigrations.ts`) with a one-paragraph inline comment. **Phase 1
  discovered the anchor line `"1632_salary_revision_page.sql"` does not exist in the manifest at
  all** (it's a deliberately-unregistered, pending-approval RBAC migration) — insert after
  whatever the actual last entry is at execution time; grep for it fresh, do not assume a line
  number.
- vitest config: `fileParallelism: false`, `testTimeout: 30_000`, tests live under
### Task 3: `deriveCanonical()` — the canonical daily aggregation algorithm

**Files:**
- Create: `backend/src/modules/wfm/canonical-productivity.ts`
- Test: `backend/src/modules/wfm/__tests__/canonical-productivity.property.test.ts`

**Interfaces:**
- Consumes: nothing (pure function, no DB).
- Produces (consumed by Phase 3's ingestion tasks, not this phase):
  ```ts
  export interface Contribution {
    diallerSourceId: string;
    interval: { startMinute: number; endMinute: number } | null;
    magnitudeMinutes: number;
  }
  export type ProducingRule = 'interval_union' | 'max_contribution';
  export interface CanonicalResult {
    minutes: number | null;
    rule: ProducingRule | null;
    excludedCount: number;
  }
  export function deriveCanonical(contributions: Contribution[]): CanonicalResult;
  ```

- [ ] **Step 1: Write the failing property tests**

```ts
// backend/src/modules/wfm/__tests__/canonical-productivity.property.test.ts
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { deriveCanonical, type Contribution } from '../canonical-productivity.js';

// Minutes-from-midnight domain, kept small so overlaps/adjacency/nesting occur often.
const MAX_MINUTE = 200;

const usableIntervalArb: fc.Arbitrary<{ startMinute: number; endMinute: number }> = fc
  .tuple(fc.integer({ min: 0, max: MAX_MINUTE }), fc.integer({ min: 1, max: MAX_MINUTE }))
  .map(([a, b]) => (a < b ? { startMinute: a, endMinute: b } : { startMinute: b, endMinute: a + 1 }))
  .filter((iv) => iv.startMinute < iv.endMinute);

const contributionArb: fc.Arbitrary<Contribution> = fc.record({
  diallerSourceId: fc.uuid(),
  interval: fc.option(usableIntervalArb, { nil: null }),
  magnitudeMinutes: fc.integer({ min: 1, max: 1500 }),
});

const allUsableContributionsArb: fc.Arbitrary<Contribution[]> = fc.array(
  fc.record({
    diallerSourceId: fc.uuid(),
    interval: usableIntervalArb,
    magnitudeMinutes: fc.integer({ min: 1, max: 1500 }),
  }),
  { minLength: 1, maxLength: 8 },
);

describe('deriveCanonical — Property 20: The daily bound holds', () => {
  it('canonical minutes is never more than 1440 for any set of contributions', () => {
    // Feature: payroll-attendance-source-rules, Property 20: The daily bound holds
    fc.assert(
      fc.property(fc.array(contributionArb, { maxLength: 10 }), (contributions) => {
        const result = deriveCanonical(contributions);
        if (result.minutes !== null) {
          expect(result.minutes).toBeLessThanOrEqual(1440);
        }
      }),
      { numRuns: 300 },
    );
  });
});

describe('deriveCanonical — Property 21: Neither shrinkage nor inflation', () => {
  it('canonical minutes is at least the largest single contribution and at most the sum of all contributions, measured on the basis the governing rule actually uses', () => {
    // Feature: payroll-attendance-source-rules, Property 21: Neither shrinkage nor inflation
    //
    // The "contribution size" a bound is measured against depends on which rule governs:
    // interval_union never reads magnitudeMinutes at all, so a bound stated over magnitudes
    // would be comparing two unrelated random quantities (design.md Risk #5: Net_Login is a
    // bucket sum, not a span). The real invariant for interval_union is the standard
    // union-of-intervals inequality: union length is always >= the longest member interval and
    // always <= the sum of member interval lengths. For max_contribution, magnitudeMinutes IS
    // the basis the rule uses, so the bound is stated over magnitudes there.
    fc.assert(
      fc.property(fc.array(contributionArb, { minLength: 1, maxLength: 8 }), (contributions) => {
        const result = deriveCanonical(contributions);
        if (result.minutes === null) return; // all-excluded case, nothing to bound

        if (result.rule === 'max_contribution') {
          const magnitudes = contributions.map((c) => c.magnitudeMinutes);
          const largestSingle = Math.max(...magnitudes);
          const sumAll = magnitudes.reduce((a, b) => a + b, 0);
          expect(result.minutes).toBeGreaterThanOrEqual(Math.min(largestSingle, 1440));
          expect(result.minutes).toBeLessThanOrEqual(Math.min(sumAll, 1440));
        } else {
          const lengths = contributions.map((c) => c.interval!.endMinute - c.interval!.startMinute);
          const largestSingle = Math.max(...lengths);
          const sumAll = lengths.reduce((a, b) => a + b, 0);
          expect(result.minutes).toBeGreaterThanOrEqual(Math.min(largestSingle, 1440));
          expect(result.minutes).toBeLessThanOrEqual(Math.min(sumAll, 1440));
        }
      }),
      { numRuns: 300 },
    );
  });
});

describe('deriveCanonical — Property 22: Recomputation stability, and the producing rule is recorded', () => {
  it('two consecutive derivations over an unchanged contribution set return the same minutes and the same rule', () => {
    // Feature: payroll-attendance-source-rules, Property 22: Recomputation stability, and the producing rule is recorded
    fc.assert(
      fc.property(fc.array(contributionArb, { maxLength: 8 }), (contributions) => {
        const first = deriveCanonical(contributions);
        const second = deriveCanonical(contributions);
        expect(second.minutes).toBe(first.minutes);
        expect(second.rule).toBe(first.rule);
      }),
      { numRuns: 300 },
    );
  });

  it('the recorded rule is max_contribution exactly when at least one contribution lacks a usable interval', () => {
    // Feature: payroll-attendance-source-rules, Property 22: Recomputation stability, and the producing rule is recorded
    fc.assert(
      fc.property(fc.array(contributionArb, { minLength: 1, maxLength: 8 }), (contributions) => {
        const result = deriveCanonical(contributions);
        const anyUnusable = contributions.some(
          (c) => c.interval === null || c.interval.endMinute <= c.interval.startMinute,
        );
        if (anyUnusable) {
          expect(result.rule).toBe('max_contribution');
        } else {
          expect(result.rule).toBe('interval_union');
        }
      }),
      { numRuns: 300 },
    );
  });
});

describe('deriveCanonical — absent is never zero (criterion 18.10)', () => {
  it('an empty contribution list returns minutes: null, not 0', () => {
    const result = deriveCanonical([]);
    expect(result.minutes).toBeNull();
    expect(result.rule).toBeNull();
  });
});

describe('deriveCanonical — hand-traced example scenarios', () => {
  it('overlapping intervals from two sources count the overlap once (interval_union)', () => {
    const contributions: Contribution[] = [
      { diallerSourceId: 'src-a', interval: { startMinute: 0, endMinute: 100 }, magnitudeMinutes: 90 },
      { diallerSourceId: 'src-b', interval: { startMinute: 50, endMinute: 150 }, magnitudeMinutes: 95 },
    ];
    // union of [0,100) and [50,150) is [0,150) = 150 minutes, not 90+95=185
    const result = deriveCanonical(contributions);
    expect(result.rule).toBe('interval_union');
    expect(result.minutes).toBe(150);
  });

  it('adjacent (touching, non-overlapping) intervals sum exactly', () => {
    const contributions: Contribution[] = [
      { diallerSourceId: 'src-a', interval: { startMinute: 0, endMinute: 60 }, magnitudeMinutes: 60 },
      { diallerSourceId: 'src-b', interval: { startMinute: 60, endMinute: 120 }, magnitudeMinutes: 60 },
    ];
    const result = deriveCanonical(contributions);
    expect(result.rule).toBe('interval_union');
    expect(result.minutes).toBe(120);
  });

  it('a nested interval contributes nothing extra beyond the interval that contains it', () => {
    const contributions: Contribution[] = [
      { diallerSourceId: 'src-a', interval: { startMinute: 0, endMinute: 200 }, magnitudeMinutes: 200 },
      { diallerSourceId: 'src-b', interval: { startMinute: 50, endMinute: 100 }, magnitudeMinutes: 50 },
    ];
    const result = deriveCanonical(contributions);
    expect(result.rule).toBe('interval_union');
    expect(result.minutes).toBe(200);
  });

  it('a single contribution with no usable interval (manual upload, login_minutes only) falls to max_contribution', () => {
    const contributions: Contribution[] = [
      { diallerSourceId: 'src-manual', interval: null, magnitudeMinutes: 420 },
    ];
    const result = deriveCanonical(contributions);
    expect(result.rule).toBe('max_contribution');
    expect(result.minutes).toBe(420);
  });

  it('one interval-less contribution demotes the WHOLE employee-date to max_contribution, even with other usable intervals present', () => {
    const contributions: Contribution[] = [
      { diallerSourceId: 'src-a', interval: { startMinute: 0, endMinute: 480 }, magnitudeMinutes: 480 },
      { diallerSourceId: 'src-manual', interval: null, magnitudeMinutes: 500 },
    ];
    const result = deriveCanonical(contributions);
    expect(result.rule).toBe('max_contribution');
    expect(result.minutes).toBe(500); // max(480, 500), NOT the 480-minute interval union
  });

  it('a zero-length interval (Logout_Time equals Login_Time) is unusable and demotes to max_contribution', () => {
    const contributions: Contribution[] = [
      { diallerSourceId: 'src-a', interval: { startMinute: 100, endMinute: 100 }, magnitudeMinutes: 0 },
      { diallerSourceId: 'src-b', interval: { startMinute: 0, endMinute: 60 }, magnitudeMinutes: 60 },
    ];
    const result = deriveCanonical(contributions);
    expect(result.rule).toBe('max_contribution');
    expect(result.minutes).toBe(60);
  });

  it('a set of contributions summing past 1440 minutes clamps to 1440 (the impossible-day case E11 measured)', () => {
    const contributions: Contribution[] = [
      { diallerSourceId: 'src-a', interval: { startMinute: 0, endMinute: 800 }, magnitudeMinutes: 800 },
      { diallerSourceId: 'src-b', interval: { startMinute: 700, endMinute: 1600 }, magnitudeMinutes: 900 },
    ];
    const result = deriveCanonical(contributions);
    expect(result.minutes).toBeLessThanOrEqual(1440);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && npx vitest run src/modules/wfm/__tests__/canonical-productivity.property.test.ts`
Expected: FAIL — `Cannot find module '../canonical-productivity.js'`

- [ ] **Step 3: Write the implementation**

```ts
// backend/src/modules/wfm/canonical-productivity.ts
//
// Requirement 18's canonical daily productivity aggregation (requirements.md), implemented as a
// pure function with no DB access, directly property-testable (design.md component 5,
// "Canonical daily aggregation"). Consumed by Phase 3's ingestion write path — this phase does
// not wire it to any table or worker.
//
// Two rules, exactly as decision A8 settles them:
//   - PRIMARY (criterion 18.4): every contribution has a usable interval -> sweep-merge
//     overlapping intervals, sum the merged lengths. Any instant covered by two or more
//     contributions counts once. This is the only rule faithful to genuinely sequential
//     cross-dialler work.
//   - SECONDARY (criterion 18.6): if ANY contribution lacks a usable interval, the WHOLE
//     employee-date falls to the maximum single magnitude instead — not just the unusable
//     contribution's own value discarded. This is mandatory, not configurable, and it is what
//     currently governs most dialler days in production: dialer_session_log and
//     apr_manual_upload both carry only a minutes figure, no logout column at all.
//
// A contribution is "usable" only when its interval is present AND endMinute > startMinute
// (criterion 18.5) — a zero-length or malformed interval is treated exactly like a missing one,
// not silently ignored.
//
// Summing net login across concurrent sessions (what the current, broken aggregation does) is
// deliberately never expressed here — the type doesn't even have a "just add them up" code path.

export interface Contribution {
  diallerSourceId: string;
  // Minutes from 00:00 on the target calendar date. null means this contribution supplies no
  // ordered interval at all (e.g. a manual upload with only login_minutes, no logout column).
  interval: { startMinute: number; endMinute: number } | null;
  // Net_Login / login_minutes — the contribution magnitude used by the secondary rule and by
  // the no-shrinkage/no-inflation bounds, regardless of which rule ultimately governs.
  magnitudeMinutes: number;
}

export type ProducingRule = 'interval_union' | 'max_contribution';

export interface CanonicalResult {
  // null means absent for this employee-date (criterion 18.10) — never a measured zero.
  minutes: number | null;
  rule: ProducingRule | null;
  excludedCount: number;
}

function isUsable(c: Contribution): boolean {
  return c.interval !== null && c.interval.endMinute > c.interval.startMinute;
}

export function deriveCanonical(contributions: Contribution[]): CanonicalResult {
  if (contributions.length === 0) {
    return { minutes: null, rule: null, excludedCount: 0 };
  }

  const usable = contributions.filter(isUsable);
  const excludedCount = contributions.length - usable.length;

  // Secondary rule (18.6): ANY unusable contribution demotes the WHOLE employee-date.
  if (usable.length < contributions.length) {
    const maxMagnitude = Math.max(...contributions.map((c) => c.magnitudeMinutes));
    return {
      minutes: Math.min(maxMagnitude, 1440),
      rule: 'max_contribution',
      excludedCount,
    };
  }

  // Primary rule (18.4): sweep-merge overlapping intervals, sum the merged lengths.
  const sorted = [...usable].sort((a, b) => a.interval!.startMinute - b.interval!.startMinute);
  let totalMinutes = 0;
  let mergedStart = sorted[0].interval!.startMinute;
  let mergedEnd = sorted[0].interval!.endMinute;
  for (let i = 1; i < sorted.length; i++) {
    const { startMinute, endMinute } = sorted[i].interval!;
    if (startMinute <= mergedEnd) {
      mergedEnd = Math.max(mergedEnd, endMinute);
    } else {
      totalMinutes += mergedEnd - mergedStart;
      mergedStart = startMinute;
      mergedEnd = endMinute;
    }
  }
  totalMinutes += mergedEnd - mergedStart;

  return {
    minutes: Math.min(totalMinutes, 1440),
    rule: 'interval_union',
    excludedCount: 0,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && npx vitest run src/modules/wfm/__tests__/canonical-productivity.property.test.ts`
Expected: PASS, 12 tests (3 property describe blocks with 4 `it`s total + 1 absent-is-never-zero
+ 7 hand-traced examples).

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/wfm/canonical-productivity.ts \
        backend/src/modules/wfm/__tests__/canonical-productivity.property.test.ts
git commit -m "feat: add deriveCanonical() — the Requirement 18 aggregation algorithm, property-tested"
```

---

