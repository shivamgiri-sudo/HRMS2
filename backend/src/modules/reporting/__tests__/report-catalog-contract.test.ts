/**
 * The report catalogs are a CONTRACT, and nothing enforced it.
 *
 * Three independent definitions describe the same reports:
 *   1. src/lib/report-catalog.ts               — renders the Report Library tab
 *   2. backend .../reporting/report-catalog.ts — served by /api/reports/deep-sections,
 *                                                renders the Decision Center tab
 *   3. the executors' SQL aliases              — what the database actually returns
 *
 * Both grids key every cell by the catalog's column `key` against the row object the executor
 * produced (ReportLibraryView renders `row[col.key]`). So a name present in a catalog and absent
 * from the executor is not an error — it is a silent em-dash in every row, which reads as "there
 * is no data" rather than "this column was never wired up".
 *
 * Measured against live mas_hrms before these guards existed: 63 report codes had different
 * column sets between the two catalogs, and 10 reports rendered at least one permanently blank
 * column. source-effectiveness had NO overlap at all between its 9 declared columns and the 4 the
 * executor returned; payroll-register omitted seven earning components including BONUS, which
 * carried real money on 965 of 1,371 lines.
 *
 * Baseline-driven rather than all-or-nothing: the remaining drift is too large to fix in one
 * change, so it is recorded and must only ever shrink. A new mismatch fails immediately;
 * removing one requires lowering the baseline, which is the point.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { REPORT_CATALOG as BACKEND_CATALOG } from "../report-catalog.js";
import { EXECUTOR_MAP } from "../executors/index.js";

const REPO_ROOT = path.resolve(process.cwd(), "..");
const FRONTEND_CATALOG_PATH = path.join(REPO_ROOT, "src", "lib", "report-catalog.ts");
const SUITE_ROUTES_PATH = path.join(
  REPO_ROOT, "backend", "src", "modules", "reporting", "report-suite.routes.ts",
);

/**
 * The frontend catalog is parsed, not imported: it is a browser module behind the "@/" path
 * alias, and importing it pulls in lib/utils and the app graph, which will not resolve under the
 * backend's vitest config.
 */
function frontendCatalogColumns(): Map<string, string[]> {
  const src = fs.readFileSync(FRONTEND_CATALOG_PATH, "utf8");
  const byCode = new Map<string, string[]>();
  const matches = [...src.matchAll(/code:\s*"([a-z0-9-]+)"/g)];

  for (let i = 0; i < matches.length; i += 1) {
    const code = matches[i][1];
    const start = matches[i].index!;
    // Stop at the next code so a report with no columns block cannot borrow the next one's.
    const end = i + 1 < matches.length ? matches[i + 1].index! : src.length;
    const keys = [...src.slice(start, end).matchAll(/\{\s*key:\s*"([a-z0-9_]+)"/g)].map((m) => m[1]);
    if (keys.length) byCode.set(code, keys);
  }
  return byCode;
}

/** Report codes served by an inline `case` in the preview switch rather than by an executor. */
function inlineServedCodes(): Set<string> {
  const src = fs.readFileSync(SUITE_ROUTES_PATH, "utf8");
  return new Set([...src.matchAll(/^\s*case\s+"([a-z0-9-]+)":/gm)].map((m) => m[1]));
}

const FE = frontendCatalogColumns();
const BE = new Map(
  (BACKEND_CATALOG as { code: string; columns?: { key: string }[] }[])
    .map((r) => [r.code, (r.columns ?? []).map((c) => c.key)]),
);

describe("report catalog contract", () => {
  it("parses a plausible number of reports from the frontend catalog", () => {
    // Guards the parser above: one that silently matched nothing would make every other
    // assertion in this file vacuously true.
    expect(FE.size).toBeGreaterThan(100);
  });

  /**
   * Column-set parity between the two catalogs. When they disagree, the same report code shows
   * different columns depending on which tab it is opened from, and at most one of the two can
   * agree with the executor.
   */
  it("does not add NEW column drift between the frontend and backend catalogs", () => {
    const drifted: string[] = [];
    for (const [code, beKeys] of BE) {
      const feKeys = FE.get(code);
      if (!feKeys) continue;
      const beOnly = beKeys.filter((k) => !feKeys.includes(k));
      const feOnly = feKeys.filter((k) => !beKeys.includes(k));
      if (beOnly.length || feOnly.length) drifted.push(code);
    }

    // Baseline measured 2026-09-03. Started at 63; mirroring employee_status into the frontend
    // catalog, aligning cost-centre-headcount's key to the executor, and repairing
    // leave-allocation-register's phantom opening_balance/carry_forward closed four.
    //
    // Must only ever go DOWN. If a change makes it grow, one catalog was edited and the other was
    // not — which is exactly how employee_status ended up in the backend catalog alone, invisible
    // in the Library tab it was added for.
    const BASELINE = 59;
    expect(
      drifted.length,
      `Column drift between the catalogs changed.\n` +
        `Baseline ${BASELINE}, now ${drifted.length}.\n` +
        `If you added a column, add it to BOTH src/lib/report-catalog.ts and ` +
        `backend/src/modules/reporting/report-catalog.ts.\n` +
        `Drifted codes:\n  ${drifted.join("\n  ")}`,
    ).toBeLessThanOrEqual(BASELINE);
  });

  /**
   * Every catalog entry must be servable, or its export button 404s.
   *
   * The preview route falls back to a "not yet available" placeholder when no executor exists,
   * but GET /suite/:code/export calls executeReport directly and answers 404 EXECUTOR_NOT_FOUND.
   * The export button renders whenever exportRoles is non-empty, so a catalog entry with neither
   * an executor nor an inline case looks fine and then fails on download.
   */
  it("every frontend catalog report is served by an executor or an inline route case", () => {
    const inline = inlineServedCodes();
    const unservable = [...FE.keys()].filter((code) => !EXECUTOR_MAP[code] && !inline.has(code));

    // Baseline measured 2026-09-03: training-batch-summary and
    // notification-undeliverable-recipients have no backend implementation on either path.
    const BASELINE = 2;
    expect(
      unservable.length,
      `Reports in the catalog with no backend implementation changed.\n` +
        `Baseline ${BASELINE}, now ${unservable.length}.\nCodes:\n  ${unservable.join("\n  ")}`,
    ).toBeLessThanOrEqual(BASELINE);
  });

  /**
   * Reports served ONLY by an inline preview case cannot be downloaded. Tracked separately
   * because the failure looks different to a user: the report renders normally and only the
   * export fails.
   */
  it("does not add reports whose preview works but whose export would 404", () => {
    const inline = inlineServedCodes();
    const previewOnly = [...FE.keys()].filter((code) => !EXECUTOR_MAP[code] && inline.has(code));

    // Baseline measured 2026-09-03.
    const BASELINE = 9;
    expect(
      previewOnly.length,
      `Reports with an inline preview but no executor changed.\n` +
        `Baseline ${BASELINE}, now ${previewOnly.length}.\n` +
        `Each renders on screen and 404s on XLSX download:\n  ${previewOnly.join("\n  ")}`,
    ).toBeLessThanOrEqual(BASELINE);
  });
});

describe("grouped header alignment", () => {
  /**
   * headerGroups colSpans must sum to the column count, in BOTH catalogs.
   *
   * A short sum does not throw — it shifts every grouped header one or more cells left of the
   * data it labels, so numbers appear under the wrong heading. Adding employee_status to
   * leave-balance did exactly this until a trailing blank group was added for column R.
   */
  it("backend catalog headerGroups sum to the column count", () => {
    const bad: string[] = [];
    for (const r of BACKEND_CATALOG as {
      code: string; columns?: unknown[]; headerGroups?: { colSpan: number }[];
    }[]) {
      if (!r.headerGroups?.length) continue;
      const sum = r.headerGroups.reduce((a, g) => a + g.colSpan, 0);
      const cols = (r.columns ?? []).length;
      if (sum !== cols) bad.push(`${r.code} (colSpan sum ${sum} != ${cols} columns)`);
    }
    expect(bad, `Grouped headers misaligned:\n  ${bad.join("\n  ")}`).toEqual([]);
  });

  it("frontend catalog headerGroups sum to the column count", () => {
    const src = fs.readFileSync(FRONTEND_CATALOG_PATH, "utf8");
    const bad: string[] = [];
    const matches = [...src.matchAll(/code:\s*"([a-z0-9-]+)"/g)];

    for (let i = 0; i < matches.length; i += 1) {
      const code = matches[i][1];
      const slice = src.slice(
        matches[i].index!,
        i + 1 < matches.length ? matches[i + 1].index! : src.length,
      );
      if (!/headerGroups:\s*\[/.test(slice)) continue;
      const cols = (FE.get(code) ?? []).length;
      const groupBlock = slice.slice(slice.indexOf("headerGroups:"));
      const sum = [...groupBlock.matchAll(/colSpan:\s*(\d+)/g)]
        .map((m) => Number(m[1])).reduce((a, b) => a + b, 0);
      if (sum !== cols) bad.push(`${code} (colSpan sum ${sum} != ${cols} columns)`);
    }
    expect(bad, `Grouped headers misaligned:\n  ${bad.join("\n  ")}`).toEqual([]);
  });
});
