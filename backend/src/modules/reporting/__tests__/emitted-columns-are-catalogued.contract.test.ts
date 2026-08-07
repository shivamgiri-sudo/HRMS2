import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * If the SQL emits a mandatory identity column, BOTH catalogues must declare it.
 *
 * catalog-frontend-parity.contract.test.ts compares the two catalogues to each other, so it
 * only fires when they DISAGREE. It cannot see the case where both are wrong in the same
 * direction — the SQL returns cost_centre_code and neither catalogue mentions it. That is not
 * hypothetical: eight reports were in exactly that state on 2026-08-08
 * (increment-promotion-history, regularization-summary, attendance-dispute-summary,
 * leave-utilization, fnf-settlement-register, early-attrition-report, quality-audit-log,
 * fatal-error-register). The column crossed the wire on every request and the grid discarded
 * it, because ReportLibraryView draws only what the frontend catalogue lists.
 *
 * This reads the third source neither of those tests consults: the query itself. A column is
 * only useful when all three agree — SQL emits it, backend catalogue declares it, frontend
 * catalogue draws it.
 */

const ROOT = process.cwd();
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

const backendCatalog = read("src/modules/reporting/report-catalog.ts");
const frontendCatalog = read("../src/lib/report-catalog.ts");

/** Column keys a catalogue declares for a code. */
function catalogueKeys(src: string, code: string): string[] | null {
  const i = src.indexOf(`code: "${code}"`);
  if (i === -1) return null;
  const end = src.indexOf("\n  },", i);
  const seg = src.slice(i, end === -1 ? undefined : end);
  return [...seg.matchAll(/key:\s*"([^"]+)"/g)].map(m => m[1]);
}

/** Report codes whose serving SQL emits `AS cost_centre_code`, from every layer. */
function codesEmittingCostCentre(): Set<string> {
  const out = new Set<string>();

  // Inline blocks and the high-risk router: split on the case/handler boundary and look inside.
  for (const [file, splitter] of [
    ["src/modules/reporting/report-suite.routes.ts", /(?=\n {4}case ")/],
    ["src/modules/reporting/report-suite-highrisk.routes.ts", /(?=\n\w*[Rr]outer\.get\()/],
  ] as const) {
    const src = read(file);
    for (const part of src.split(splitter)) {
      const m = /^\n {4}case "([a-z0-9-]+)"/.exec(part) ?? /\.get\("\/([a-z0-9-]+)"/.exec(part);
      if (m && /AS cost_centre_code/.test(part)) out.add(m[1]);
    }
  }

  // Executors: map the emitting function back to its registered code via EXECUTOR_MAP's source,
  // rather than importing it, so this stays a pure source check like its siblings.
  const indexSrc = read("src/modules/reporting/executors/index.ts");
  const dir = resolve(ROOT, "src/modules/reporting/executors");
  for (const file of readdirSync(dir).filter(f => f.endsWith(".executor.ts"))) {
    const src = readFileSync(resolve(dir, file), "utf8");
    for (const part of src.split(/(?=\nexport async function )/)) {
      const fn = /^\nexport async function (\w+)\(/.exec(part)?.[1];
      if (!fn || !/AS cost_centre_code/.test(part)) continue;
      for (const m of indexSrc.matchAll(new RegExp(`"([a-z0-9-]+)":\\s*${fn}\\b`, "g"))) out.add(m[1]);
    }
  }
  return out;
}

/**
 * Reports where `AS cost_centre_code` appears in the SQL but NOT in the result projection.
 *
 * team-performance-summary resolves scoped employees in a lookup subquery — which selects cost
 * centre so the per-agent report can enrich from it — and then aggregates by team lead. A team
 * spans cost centres, so its output rows carry none, and demanding one would mean picking an
 * arbitrary member's. Source scanning cannot tell a lookup subquery from a projection, hence
 * the explicit entry rather than a cleverer regex that would be wrong in a different way.
 */
const EMITS_IN_SUBQUERY_ONLY = new Set<string>(["team-performance-summary"]);

/**
 * Codes that emit cost centre and have NO frontend entry, so they cannot be selected in the
 * Report Library at all. A pre-existing catalogue gap, separate from the drift this guards.
 * Shrink only — closing one means authoring a real entry with labels, formats and widths.
 */
const NO_FRONTEND_ENTRY = new Set<string>([
  "leave-allocation-register", "leave-lwp-reconciliation", "leave-lapse-summary",
  "bank-missing", "increment-requests", "ytd-salary-summary", "uan-master-register",
  "employee-document-compliance", "ff-settlement-register", "roster-adherence",
  "productivity-individual-scorecard",
]);

describe("a column the SQL emits must be declared in both catalogues", () => {
  const emitting = new Set(
    [...codesEmittingCostCentre()].filter(c => !EMITS_IN_SUBQUERY_ONLY.has(c)),
  );

  it("finds the reports that emit cost centre", () => {
    expect(emitting.size).toBeGreaterThan(30);
  });

  it("every emitting report declares cost centre in the BACKEND catalogue", () => {
    const offenders = [...emitting]
      .filter(code => {
        const keys = catalogueKeys(backendCatalog, code);
        return keys !== null && !keys.includes("cost_centre_code");
      })
      .sort();

    expect(
      offenders,
      `their SQL returns cost_centre_code, the backend catalogue does not declare it:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("every emitting report declares cost centre in the FRONTEND catalogue", () => {
    // A missing entry is the separate, tracked gap; a present-but-incomplete entry is the bug.
    const offenders = [...emitting]
      .filter(code => !NO_FRONTEND_ENTRY.has(code))
      .filter(code => {
        const keys = catalogueKeys(frontendCatalog, code);
        return keys !== null && !keys.includes("cost_centre_code");
      })
      .sort();

    expect(
      offenders,
      `their SQL returns cost_centre_code and the grid will discard it — add it to ` +
        `src/lib/report-catalog.ts:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("the unlisted-report backlog only shrinks", () => {
    const stillMissing = [...NO_FRONTEND_ENTRY].filter(
      code => catalogueKeys(frontendCatalog, code) === null,
    );
    const nowListed = [...NO_FRONTEND_ENTRY].filter(c => !stillMissing.includes(c)).sort();

    expect(
      nowListed,
      `these now have a frontend entry — remove them from NO_FRONTEND_ENTRY:\n${nowListed.join("\n")}`,
    ).toEqual([]);
  });
});
