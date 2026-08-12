import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

/**
 * The auto-roster scheduler could never carry a slot requirement forward, and
 * every plan it labels was labelled with a truncated UUID.
 *
 *   the weekly copy-forward INSERT named slot_start_time, slot_end_time and
 *   notes. wfm_client_slot_requirement has slot_start and slot_end, and no notes
 *   column at all, so the statement raised ER_BAD_FIELD_ERROR into the
 *   console.warn wrapping it - "non-fatal", and therefore invisible.
 *
 *   the plan label read `SELECT name FROM process_master`. The column is
 *   process_name. That threw into an empty catch, leaving processName as
 *   processId.substring(0, 8), so plans came out named "Auto W33 3f2a1b9c".
 *
 * Both are latent rather than live: the worker is registered in all-workers.ts
 * and worker_config.enabled = 1, but wfm_process_planning_rule holds 0 rows, so
 * checkAndRun returns at "no processes configured" on every 6-hourly tick. They
 * fire the moment a planning rule is created.
 *
 * active_status is now carried forward too. It is NOT NULL DEFAULT 1, so
 * omitting it from the column list would have resurrected a deactivated slot
 * requirement as active every single week.
 *
 * Verified against production 8.0.42: every query in the worker PREPAREs (2 of 4
 * failed before), and the copy-forward was replayed on a scratch copy of the
 * real table - the old statement fails, the new one shifts both rows by 7 days
 * and keeps the deactivated one deactivated.
 */
const WORKER = path.resolve(__dirname, "../auto-roster-scheduler.worker.ts");
const SERVICE = path.resolve(__dirname, "../../modules/wfm/auto-roster-synced.service.ts");

/** The old names appear in this file's own comments; match live code only. */
function liveCode(file: string): string {
  return fs
    .readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !l.trim().startsWith("//"))
    .join("\n");
}

describe("auto-roster scheduler writes columns that exist", () => {
  it("copies slot requirements using slot_start and slot_end", () => {
    const code = liveCode(WORKER);
    expect(code).not.toMatch(/slot_start_time/);
    expect(code).not.toMatch(/slot_end_time/);
    expect(code).toMatch(/slot_start, slot_end/);
  });

  it("does not write a notes column, which this table does not have", () => {
    expect(liveCode(WORKER)).not.toMatch(/notes/);
  });

  it("carries active_status forward so a disabled requirement stays disabled", () => {
    const code = liveCode(WORKER);
    // present in both the column list and the SELECT list
    expect(code.match(/active_status/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("reads the process label from process_name", () => {
    const code = liveCode(WORKER);
    expect(code).not.toMatch(/SELECT name FROM process_master/);
    expect(code).toMatch(/SELECT process_name FROM process_master/);
    expect(code).toMatch(/pRows\?\.\[0\]\?\.process_name/);
  });

  it("orders roster conflicts by detected_at, the column that exists", () => {
    const code = liveCode(SERVICE);
    expect(code).toMatch(/FROM wfm_roster_conflict_log[\s\S]{0,140}detected_at DESC/);
    expect(code).not.toMatch(/FROM wfm_roster_conflict_log[\s\S]{0,140}created_at DESC/);
  });
});
