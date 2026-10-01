/**
 * Renders the KPI catalogue seed as Markdown for review: one section per process, a role / department matrix, and the
 * known model conflicts. Usage:  npx tsx scripts/generate-kpi-catalogue-map.ts [outfile]
 * Default output: ../docs/KPI_CATALOGUE_MAP.md
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { SEED_PROCESSES } from "../src/modules/kpi-catalogue/kpi-catalogue.seed.js";
import { AUDIENCES } from "../src/modules/kpi-catalogue/kpi-catalogue.library.js";
import { renderCatalogueMarkdown } from "../src/modules/kpi-catalogue/kpi-catalogue.markdown.js";

const out = resolve(process.argv[2] ?? resolve(process.cwd(), "../docs/KPI_CATALOGUE_MAP.md"));
writeFileSync(out, renderCatalogueMarkdown(SEED_PROCESSES, AUDIENCES), "utf8");
console.log(`Wrote ${out} (${SEED_PROCESSES.length} processes, ${SEED_PROCESSES.reduce((s, p) => s + p.kpis.length, 0)} KPIs)`);
