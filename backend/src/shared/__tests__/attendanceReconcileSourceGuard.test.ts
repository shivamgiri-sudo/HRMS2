/**
 * The reconciler must refuse rows whose source data the engine can no longer read.
 *
 * Found on its first real use. Asked to repair 70 rows on 2026-06-25 it proposed turning 65
 * employees from `present` into `missing_punch` or `absent`. Those 65 rows all have BOTH a
 * clock_in_time and a clock_out_time and raw_minutes > 0 — they clearly worked — but
 * biometric_minutes is 0, and biometric_minutes is what the engine keys on. With no biometric
 * evidence it returns missing_punch with rawMinutes 0. The engine was not correcting bad
 * data; it could not see the data.
 *
 * Applying that would have stripped `present` from 65 people with complete punch pairs, and
 * since unresolved missing_punch pays zero it would have REDUCED their pay — the opposite of
 * recovering the 66 over-charged LWP days it was run for.
 *
 * The blast radius is not one date. Across attendance_daily_record, 57,806 of 95,656
 * biometric rows with both punches have biometric_minutes = 0 (60.4%), concentrated in
 * 2026-03 (98.6%), 2026-04 (99.8%), 2026-05 (99.8%) and 2026-06 (60.7%), clearing from
 * 2026-07 (0.9%). Re-deriving that window unguarded would reclassify roughly 58,000 worked
 * days as missing punches.
 *
 * So "the engine disagrees with the stored row" is NOT sufficient grounds to rewrite it. The
 * engine's inputs have to be intact first.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(__dirname, "..", "..", "..", "scripts", "attendance-lwp-reconcile.ts");
const source = fs.readFileSync(SCRIPT, "utf8");
const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("reconciler refuses rows the engine cannot read", () => {
  it("selects the punch evidence it needs to make that judgement", () => {
    // It cannot decide whether the engine is blind without reading the punch columns.
    for (const col of ["clock_in_time", "clock_out_time", "biometric_minutes"]) {
      expect(code).toContain(col);
    }
  });

  it("treats complete punches with zero biometric minutes as unsafe to re-derive", () => {
    expect(code).toMatch(/sourceIsUnreadable|unsafeToRederive|engineIsBlind/);
  });

  it("skips those rows instead of writing the engine's verdict", () => {
    // The whole point: a row the engine misreads must never reach upsertDailyRecord.
    const guardAt = code.search(/sourceIsUnreadable|unsafeToRederive|engineIsBlind/);
    const upsertAt = code.indexOf("upsertDailyRecord");
    expect(guardAt).toBeGreaterThan(-1);
    expect(upsertAt).toBeGreaterThan(guardAt);
    expect(code).toMatch(/skippedUnreadable|skipped_unreadable/);
  });

  it("reports the count so a run cannot quietly do nothing", () => {
    // Silently skipping everything looks identical to finding nothing wrong.
    expect(code).toMatch(/skippedUnreadable[\s\S]{0,200}console\.log|console\.log[\s\S]{0,200}skippedUnreadable/);
  });
});
