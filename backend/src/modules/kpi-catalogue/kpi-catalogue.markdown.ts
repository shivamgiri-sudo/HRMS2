import type { AudienceDef, AudiencePreset, CatalogueProcessDef } from "./kpi-catalogue.types.js";

const esc = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");

/** Conflicts known from reading the six models (the live drift check adds row-level ones). */
export const STATIC_CONFLICTS: Array<{ type: string; detail: string; resolution: string }> = [
  { type: "rating_scale_mismatch", detail: "kpi_rating_config uses S/A/B/C/D at 100/90/75/60/0; kpi-score-engine ratingForScore uses Outstanding/Exceeds/Meets/Needs Improvement at 95/85/75/60.", resolution: "One scale: kpi_rating_scale 'standard_sabcd' (S/A/B/C/D)." },
  { type: "weight_not_normalised", detail: "kpi_master_config.weightage defaults to 100 per metric and is never normalised, so an employee's weights can sum to 300+.", resolution: "Weights normalised to 100 at read time (kpi-catalogue.resolve.ts)." },
  { type: "duplicate_definition", detail: "The same KPI is defined independently in kpi_template, kpi_master_config, kpi_process_config, kpi_role_template_metric, kpi_studio_definition and portal_kpi_config, each resolved in a different order.", resolution: "One catalogue row per process + metric; one resolution order: employee > role+process > process > department > designation." },
  { type: "hardcoded_registry", detail: "kpi-metric-registry.ts hard-codes targets and metrics for 5 processes; most are not_tracked / no_data.", resolution: "Seed derives those processes from the registry so they cannot diverge; hasData:false marks missing feeds." },
  { type: "score_cap", detail: "Score cap is fixed at 120 for most scoring types; max_achievement is only honoured by the floor-gated types.", resolution: "Documented; scoring change is out of scope for the catalogue." },
  { type: "attendance_granularity", detail: "ATTENDANCE_PCT only holds 0 / 50 / 100 per day, a poor continuous metric.", resolution: "Catalogue records the definition; floor-gating stays opt-in." },
  { type: "no_feed", detail: "ADHERENCE, SHRINKAGE and OCCUPANCY are defined in kpi_metric_master but no job produces rows; only 13 of 93 metrics have data.", resolution: "Catalogue marks them hasData:false so pages say 'no data', never 0." },
  { type: "realtime_gap", detail: "kpi_daily_actual is a 24h interval sync; the only direct live reads are dialer CDR queries (5 min cache) and the process-dashboard stream.", resolution: "freshness per KPI (realtime / hourly / daily / upload) so each page states how live a number is." },
];

export function renderCatalogueMarkdown(processes: CatalogueProcessDef[], audiences: Record<AudiencePreset, AudienceDef>): string {
  const lines: string[] = [];
  const total = processes.reduce((s, p) => s + p.kpis.length, 0);
  lines.push("# KPI Catalogue Map", "", `Generated from \`backend/src/modules/kpi-catalogue/kpi-catalogue.seed.ts\`. ${processes.length} processes, ${total} KPIs. Do not edit by hand: edit the seed and re-run \`npm run kpi:catalogue-map\` (in \`backend/\`).`, "");

  lines.push("## Audiences", "", "| Audience | Roles | Department | Access |", "|---|---|---|---|");
  for (const [name, a] of Object.entries(audiences)) lines.push(`| ${name} | ${a.roles.join(", ")} | ${a.department} | ${a.access} |`);
  lines.push("");

  lines.push("## Process overview", "", "| Process | Codes | KPIs | With data | Employee-level | Realtime |", "|---|---|---|---|---|---|");
  for (const p of processes) {
    const withData = p.kpis.filter((x) => x.hasData !== false).length;
    lines.push(`| ${esc(p.processName)} (\`${p.processKey}\`) | ${p.processCodes.join(", ") || "-"} | ${p.kpis.length} | ${withData} | ${p.kpis.filter((x) => x.grain !== "process").length} | ${p.kpis.filter((x) => x.freshness === "realtime").length} |`);
  }
  lines.push("");

  lines.push("## KPIs per process", "");
  for (const p of processes) {
    lines.push(`### ${p.processName} (\`${p.processKey}\`)`, "");
    lines.push("| KPI | Theme | Unit | Better | Grain | Source | Formula | Fresh | Dimensions | Audience |", "|---|---|---|---|---|---|---|---|---|---|");
    for (const x of p.kpis) {
      const flag = x.hasData === false ? " **(no data)**" : "";
      lines.push(`| ${esc(x.name)}${flag} | ${x.theme} | ${x.unit} | ${x.direction === "higher_is_better" ? "higher" : "lower"} | ${x.grain} | ${esc(x.sourceRef)} | ${esc(x.formula)} | ${x.freshness} | ${x.dimensions.join(", ")} | ${x.audience.join(", ")} |`);
    }
    lines.push("");
  }

  lines.push("## Role and department matrix (KPI count per process)", "");
  const presets = Object.keys(audiences) as AudiencePreset[];
  lines.push(`| Process | ${presets.join(" | ")} |`, `|---|${presets.map(() => "---").join("|")}|`);
  for (const p of processes) lines.push(`| ${p.processKey} | ${presets.map((a) => p.kpis.filter((x) => x.audience.includes(a)).length).join(" | ")} |`);
  lines.push("");

  lines.push("## Known conflicts between the existing KPI models", "", "| Type | What is wrong | Resolution in the catalogue |", "|---|---|---|");
  for (const c of STATIC_CONFLICTS) lines.push(`| ${c.type} | ${esc(c.detail)} | ${esc(c.resolution)} |`);
  lines.push("", "The live drift check (`GET /api/kpi-catalogue/drift`) adds row-level conflicts from the database: direction / unit / target mismatches, Studio definitions not linked to the catalogue, weights not summing to 100, metrics with no feed, and legacy-only metrics.", "");
  return lines.join("\n");
}
