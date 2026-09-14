/**
 * Which report blocks in report-suite.routes.ts contain broken column references, and
 * can any of them actually be reached?
 *
 * The baseline records 71 broken refs for this one file but only as `table.column`, so
 * it cannot say which report each belongs to — and that is the only thing that decides
 * whether a fix changes anything. Both routes that reach the switch sit behind
 * reportCatalogAccessMiddleware, which 404s any code absent from REPORT_CATALOG, so a
 * broken query inside an uncatalogued block is unreachable code.
 *
 * Reuses the repo's own extractor rather than grepping. A naive `alias.column` grep
 * cannot work here: the broken columns include `id`, `status`, `branch_id` and
 * `created_at`, so every `e.id` in the file matches and the result is noise.
 *
 *   npx tsx scripts/report-block-drift.ts
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { columnRefsIn, brokenRefs } from "../src/db/__tests__/schema-column-refs.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, "..", "src");
const suite = readFileSync(resolve(SRC, "modules/reporting/report-suite.routes.ts"), "utf8");
const catalog = readFileSync(resolve(SRC, "modules/reporting/report-catalog.ts"), "utf8");
const schema = JSON.parse(
  readFileSync(resolve(HERE, "..", "sql", "schema-snapshot.json"), "utf8"),
) as { tables: Record<string, string[]> };

const catalogued = new Set([...catalog.matchAll(/code:\s*"([a-z0-9-]+)"/g)].map((m) => m[1]));

// Slice the switch into one source block per case label, so the extractor sees each
// report's SQL in isolation and an alias cannot leak across reports.
const marks = [...suite.matchAll(/^[ \t]*case "([a-z0-9-]+)":/gm)].map((m) => ({
  code: m[1],
  at: m.index!,
}));

const reachable: string[] = [];
const dead: string[] = [];

for (let i = 0; i < marks.length; i++) {
  const body = suite.slice(marks[i].at, marks[i + 1]?.at ?? suite.length);
  const broken = brokenRefs(columnRefsIn(body), schema.tables);
  if (broken.length === 0) continue;

  const refs = broken.map((r) => `${r.table}.${r.column}`).join(", ");
  const line = `${marks[i].code} (${broken.length}): ${refs}`;
  (catalogued.has(marks[i].code) ? reachable : dead).push(line);
}

console.log(`case blocks: ${marks.length}, catalogued: ${catalogued.size}\n`);
console.log(`REACHABLE blocks with broken refs — these are live defects (${reachable.length}):`);
for (const l of reachable) console.log(`  ! ${l}`);
if (reachable.length === 0) console.log("  none");
console.log(`\nUNREACHABLE blocks with broken refs — 404 before the SQL runs (${dead.length}):`);
for (const l of dead) console.log(`  - ${l}`);
