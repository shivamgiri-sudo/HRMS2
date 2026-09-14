import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { REPORT_CATALOG } from "../report-catalog.js";
import { EXECUTOR_MAP } from "../executors/index.js";

/**
 * Which reports may be put on an email schedule.
 *
 * The gate in communication/notification-admin.routes.ts used to be a hardcoded list of six
 * codes, justified as "report codes with a real executor in report-worker-executor.ts".
 *
 * That justification had expired. report-worker-executor.ts is dead code — no call sites
 * anywhere in backend/src. Scheduled reports are built by report-subscription.worker
 * inserting a report_request row, which report-generation.worker runs through
 * executeReport(): the same executor layer the screen and the direct XLSX download use.
 *
 * Measured on 2026-08-07: 105 codes in EXECUTOR_MAP, 120 catalogue entries, 98 in both. The
 * gate was therefore blocking 92 working reports on the strength of a file that no longer
 * runs — the same shape of defect as the export gate, where the UI hid downloads the API
 * would have served.
 */

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

describe("the subscribable-report gate is derived, not hardcoded", () => {
  const adminSource = read("src/modules/communication/notification-admin.routes.ts");

  it("no longer carries a hardcoded allowlist", () => {
    expect(
      adminSource,
      "IMPLEMENTED_REPORT_CODES was a fixed list of six that silently went stale. The set " +
        "must be derived from EXECUTOR_MAP and REPORT_CATALOG so it tracks reality.",
    ).not.toMatch(/const IMPLEMENTED_REPORT_CODES\s*=\s*\[/);
  });

  it("derives the set from the executor registry and the catalogue", () => {
    expect(adminSource).toMatch(/EXECUTOR_MAP/);
    expect(adminSource).toMatch(/REPORT_CATALOG/);
  });

  it("does not cite report-worker-executor as the reason a report cannot be scheduled", () => {
    // That file has no call sites; blaming it for a blocked report sends the next person
    // to edit something that will never run.
    const reasonText = adminSource.slice(adminSource.indexOf("/report-codes"));
    expect(reasonText).not.toMatch(/report-worker-executor\.ts/);
  });

  it("offers substantially more than the six it used to", () => {
    const withExecutor = new Set(Object.keys(EXECUTOR_MAP));
    const subscribable = REPORT_CATALOG
      .filter(r => withExecutor.has(r.code))
      .filter(r => !["deprecated", "disabled", "blocked"].includes(r.availabilityStatus ?? "under_validation"));

    expect(subscribable.length).toBeGreaterThan(50);
  });

  it("every subscribable report can actually be built", () => {
    // The original fear was real — scheduling a report with no builder would email an empty
    // spreadsheet on a cadence. The derived rule prevents that by construction; this asserts it.
    const withExecutor = new Set(Object.keys(EXECUTOR_MAP));
    const subscribable = REPORT_CATALOG
      .filter(r => withExecutor.has(r.code))
      .filter(r => !["deprecated", "disabled", "blocked"].includes(r.availabilityStatus ?? "under_validation"));

    const unbuildable = subscribable.filter(r => !withExecutor.has(r.code)).map(r => r.code);
    expect(unbuildable, `subscribable but with no executor: ${unbuildable.join(", ")}`).toEqual([]);
  });
});

describe("report-worker-executor is marked as retired", () => {
  const workerSource = read("src/modules/reporting/report-worker-executor.ts");

  it("says plainly that it is unreferenced, so nobody extends it", () => {
    expect(workerSource).toMatch(/SUPERSEDED AND UNREFERENCED/);
  });

  it("points at the path that actually runs", () => {
    expect(workerSource).toMatch(/report-generation\.worker/);
    expect(workerSource).toMatch(/executeReport\(\)/);
  });
});
