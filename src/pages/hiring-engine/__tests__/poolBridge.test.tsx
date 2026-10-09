/** Pool bridge card (WS3 D2): model + markup in node. The requests and clicks need the live check. */
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/hrmsApi", () => ({ hrmsApi: { get: vi.fn(() => new Promise(() => undefined)), post: vi.fn() } }));

import { PoolBridgeView } from "../command/PoolBridgeCard";
import { bridgeBody, canRun, requestBody, resultRows, sourceGroups, type BridgeResult, type BridgeSource } from "../command/poolBridgeModel";

const sources: BridgeSource[] = [
  { recordType: "naukri_import", sourceDetails: "SBI AHM_1.xlsx", rows: 155, inPool: 0 },
  { recordType: "naukri_import", sourceDetails: "TL_AM_161.xlsx", rows: 152, inPool: 10 },
  { recordType: "workindia_import", sourceDetails: "WorkIndia Data Base", rows: 43986, inPool: 0 },
];
const result: BridgeResult = { dryRun: true, next: null, totals: { scanned: 307, inserted: 290, enriched: 10, skipped: { legacy_employee: 3, test: 0, no_mobile: 2, employee: 1, duplicate_mobile: 1 } },
  batches: [{ recordType: "naukri_import", sourceDetails: "SBI AHM_1.xlsx", batchId: null, scanned: 155, inserted: 150, enriched: 0, skipped: { legacy_employee: 3, test: 0, no_mobile: 2, employee: 0, duplicate_mobile: 0 } }] };

describe("model", () => {
  it("groups the files by source with totals and pool coverage", () => {
    expect(sourceGroups(sources)).toEqual([
      { recordType: "naukri_import", label: "Naukri", files: 2, rows: 307, inPool: 10 },
      { recordType: "workindia_import", label: "WorkIndia", files: 1, rows: 43986, inPool: 0 },
    ]);
  });
  it("the request body is a dry run unless asked otherwise", () => {
    expect(bridgeBody(["naukri_import"], true)).toEqual({ recordTypes: ["naukri_import"], dryRun: true });
    expect(bridgeBody(["naukri_import"], false, { recordType: "naukri_import", afterId: "x" })).toEqual({ recordTypes: ["naukri_import"], dryRun: false, after: { recordType: "naukri_import", afterId: "x" } });
  });
  it("the real run starts from the beginning even when the dry run stopped early (never the dry run's cursor)", () => {
    const dry: BridgeResult = { ...result, dryRun: true, next: { recordType: "workindia_import", afterId: "row-60000" } };
    expect(requestBody(["workindia_import"], false, dry)).toEqual({ recordTypes: ["workindia_import"], dryRun: false });
    expect(requestBody(["workindia_import"], true, dry)).toEqual({ recordTypes: ["workindia_import"], dryRun: true });
  });
  it("a real run that stopped early continues from its own cursor, and the run button stays enabled for it", () => {
    const real: BridgeResult = { ...result, dryRun: false, next: { recordType: "workindia_import", afterId: "row-5000" } };
    expect(requestBody(["workindia_import"], false, real)).toEqual({ recordTypes: ["workindia_import"], dryRun: false, after: { recordType: "workindia_import", afterId: "row-5000" } });
    expect(canRun(real, ["workindia_import"])).toBe(true);
    expect(canRun({ ...real, next: null }, ["workindia_import"])).toBe(false);
    expect(canRun({ ...result, dryRun: true }, ["workindia_import"])).toBe(true);
    expect(canRun(null, ["workindia_import"])).toBe(false);
    expect(canRun({ ...result, dryRun: true }, [])).toBe(false);
  });
  it("result rows say what would happen per file, skips in words", () => {
    expect(resultRows(result)).toEqual([{ file: "SBI AHM_1.xlsx", source: "Naukri", scanned: 155, added: 150, enriched: 0, skipped: "3 former employees (legacy records), 2 without a valid mobile" }]);
  });
});

describe("PoolBridgeView", () => {
  const base = { sources, loading: false, error: null, picked: ["naukri_import"], result: null, busy: false, note: null, onPick: () => undefined, onDryRun: () => undefined, onRun: () => undefined, onRetry: () => undefined };
  it("shows the sources, the dry run first, and the run only after a dry run", () => {
    const html = renderToStaticMarkup(<PoolBridgeView {...base} />);
    expect(html).toContain("Naukri");
    expect(html).toContain("43,986");
    expect(html).toContain("Dry run");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Bring into the pool/);
  });
  it("after a dry run: per-file table, totals, and the run button enabled; preview only, nothing is sent", () => {
    const html = renderToStaticMarkup(<PoolBridgeView {...base} result={result} />);
    expect(html).toContain("SBI AHM_1.xlsx");
    expect(html).toContain("290 would be added, 10 enriched");
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>Bring into the pool/);
    expect(html).toContain("Nobody is contacted");
    expect(html).toContain("relative max-h-72 overflow-x-auto");
  });
});
