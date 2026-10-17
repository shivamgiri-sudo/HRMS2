import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Locked days (APR bulk upload, approved regularization) keep their pay-relevant
// outcome, but the COSEC hours shown for that day must still follow the latest
// biometric sync. Only biometric_minutes is allowed to change on a locked row.
const source = readFileSync(resolve(__dirname, "../attendance-engine.service.ts"), "utf8");

function upsertBlock(): string {
  const start = source.indexOf("INSERT INTO attendance_daily_record");
  expect(start).toBeGreaterThan(-1);
  const end = source.indexOf("created_by         = IF(is_locked = 0", start);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end + 200);
}

describe("attendance engine upsert on locked rows", () => {
  it("refreshes biometric_minutes on locked rows when a new value is supplied", () => {
    expect(upsertBlock()).toMatch(
      /biometric_minutes\s*=\s*IF\(is_locked = 0,\s*VALUES\(biometric_minutes\),\s*COALESCE\(VALUES\(biometric_minutes\),\s*biometric_minutes\)\)/,
    );
  });

  it("keeps every other column frozen on locked rows", () => {
    const frozen = [
      "attendance_source", "source_system", "source_record_date", "source_reference",
      "dialler_minutes", "raw_minutes", "attendance_status", "biometric_status",
      "apr_status", "mismatch_flag", "lwp_value", "late_mark", "late_by_minutes",
      "rule_config_id", "created_by",
    ];
    const block = upsertBlock();
    for (const col of frozen) {
      expect(block).toMatch(
        new RegExp(`\\b${col}\\s*=\\s*IF\\(is_locked = 0,\\s*VALUES\\(${col}\\),\\s*${col}\\)`),
      );
    }
    expect(block).toMatch(/processed_at\s*=\s*IF\(is_locked = 0,\s*NOW\(\),\s*processed_at\)/);
  });
});
