import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

/**
 * Companion to minimum-rest-policy-coverage-report.test.ts, same rationale:
 * this script's entire safety property is "never writes" — it exists
 * specifically so a candidate minimum-rest value can be evaluated for real
 * operational impact BEFORE anyone approves it (see the 2026-08-13
 * production-control incident doc: a configured value creates real
 * REST_GAP blocks the moment enforcement goes live, it isn't a free choice).
 * Source-level assertions here prove that property mechanically rather than
 * relying on a reviewer re-reading the whole file every time it changes.
 */

const SOURCE = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "../minimum-rest-policy-impact-simulation.ts"),
  "utf-8"
);

describe("minimum-rest-policy-impact-simulation.ts", () => {
  it("is strictly read-only — no SQL write statement anywhere in the file", () => {
    const writeVerbs = /\b(INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|ALTER\s+TABLE|DROP\s+TABLE|CREATE\s+TABLE|TRUNCATE\s+TABLE|REPLACE\s+INTO)\b/gi;
    const matches = SOURCE.match(writeVerbs) ?? [];
    expect(matches, `Found a SQL write statement: ${matches.join(", ")}`).toEqual([]);
  });

  it("requires at least one candidate minute value and rejects non-positive/non-numeric input", () => {
    expect(SOURCE).toMatch(/candidateMinutesArgs\.length === 0/);
    expect(SOURCE).toMatch(/!Number\.isFinite\(n\)\s*\|\|\s*n\s*<=\s*0/);
    expect(SOURCE).toMatch(/process\.exit\(2\)/);
  });

  it("computes the gap using plain TIMESTAMP(date, time) construction, matching rest-policy.service.ts's own model", () => {
    // Mirrors restGapMinutes()'s deliberate choice: no overnight-rollover inference,
    // just date+time as stored — this must stay in lockstep with production logic,
    // not "improve" on it independently.
    expect(SOURCE).toMatch(/TIMESTAMPDIFF\(MINUTE,\s*TIMESTAMP\(prev_date,\s*prev_end_time\),\s*TIMESTAMP\(roster_date,\s*shift_start_time\)\)/);
  });

  it("uses LAG() over worked (non-week-off) shift rows only, per employee, ordered by date", () => {
    expect(SOURCE).toMatch(/PARTITION BY employee_id ORDER BY roster_date/);
    expect(SOURCE).toMatch(/is_week_off = 0/);
  });

  it("states plainly that the simulation is retrospective, not a forecast, when no future roster data exists", () => {
    expect(SOURCE).toMatch(/retrospective/i);
    expect(SOURCE).toMatch(/no future-dated roster rows exist/i);
  });

  it("supports evaluating multiple candidate values in a single pass", () => {
    expect(SOURCE).toMatch(/for \(const minutes of candidateMinutesArgs\)/);
  });

  it("reports distinct-employee impact, not just raw pair counts, so WFM can gauge headcount exposure", () => {
    expect(SOURCE).toMatch(/affectedEmployees/);
    expect(SOURCE).toMatch(/new Set\(violations\.map/);
  });

  it("distinguishes the hard-block and override-required consequences of allows_emergency_override", () => {
    expect(SOURCE).toMatch(/allows_emergency_override=false/);
    expect(SOURCE).toMatch(/allows_emergency_override=true/);
  });

  it("always closes the connection, including on failure (try/finally)", () => {
    expect(SOURCE).toMatch(/finally \{\s*await conn\.end\(\);/);
  });

  it("confirms in its own final output that nothing was written", () => {
    expect(SOURCE).toMatch(/No wfm_rest_policy or wfm_rest_override_log row was written/);
  });
});
