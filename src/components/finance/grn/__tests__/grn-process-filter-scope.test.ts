import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * GrnSearchWorkspace's Process filter previously reached the backend for every source
 * (new/legacy/all), but only source="new" actually filters correctly — grn.service.ts's
 * listGrns joins straight on g.process_id. listLegacyGrns instead links Process through
 * employees.cost_centre_id, which is empty on nearly every employee row, so a legacy or
 * "all sources" search with a Process selected always silently returned zero rows: a false
 * "no data" read, not an honest "no matches" one.
 *
 * (delta-audit 2026-08-14, Section K item 7, Option B approved: remove the filter from the
 * UI until the legacy join is rebuilt — Option A, explicitly deferred as follow-up
 * engineering, not done here.)
 *
 * This directory has no interactive-rendering setup (vitest.config.ts runs under
 * environment: "node", no jsdom, no @testing-library — see that file's own comment), and
 * GrnSearchWorkspace's filter state is internal useState with no way to inject an initial
 * value from a test, so a real "select legacy, see the control disable" test isn't
 * achievable here. Matching this directory's own established fallback
 * (grn-form-capabilities.contract.test.ts), this asserts on source text instead.
 */

const SRC = readFileSync(
  new URL("../GrnSearchWorkspace.tsx", import.meta.url),
  "utf8",
);

describe("GrnSearchWorkspace — Process filter scoped to the source that supports it", () => {
  it("disables the Process control whenever source is not 'new'", () => {
    expect(SRC).toMatch(/disabled=\{draft\.source\s*!==\s*["']new["']\}/);
  });

  it("clears any previously-picked processId when switching source away from 'new'", () => {
    // Disabling alone would leave a stale value sitting in `draft` and still reaching the
    // backend if the user had picked a process before switching source — the exact false
    // "no data" trap this fix closes, just delayed by one interaction instead of prevented.
    expect(SRC).toMatch(/processId:\s*nextSource\s*===\s*["']new["']\s*\?\s*f\.processId\s*:\s*["']["']/);
  });

  it("still offers the Process filter itself when source is 'new' — this narrows availability, it does not remove the feature", () => {
    expect(SRC).toContain("processes.data");
    expect(SRC).toContain("p.process_name");
  });

  it("still sends processId to the backend (source='new' filters correctly there)", () => {
    // Guards against someone "fixing" this by deleting processId from Filters/EMPTY/the
    // query-param loop entirely, which would also break the one source where it works.
    expect(SRC).toContain("processId: string");
    expect(SRC).toMatch(/processId:\s*["']["']/); // present in EMPTY
  });
});
