// Shortlist preview for one requisition x source (plan 2026-10-09, S10): the rule funnel, a masked sample, score buckets,
// what-if with draft criteria (validated, never saved) and a masked CSV. Reads the facts cache; when the cache holds nobody
// for the source it reads the records live (capped) and says so in `partial`. Reads only.
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { csvSafe } from "../hiring-engine/qualified-followup.callfile.js";
import { compileCriteria } from "./compile-criteria.js";
import { applyPatch } from "./criteria.service.js";
import { validateCriteria } from "./criteria-validate.js";
import { loadDbRow, toCriteriaRow } from "./criteria-row.js";
import { evaluate } from "./evaluate.js";
import { readFactCache } from "./fact-cache.service.js";
import { normaliseFacts } from "./facts-normalise.js";
import { loadRawPeople } from "./facts-loader.service.js";
import { loadLiveFrom } from "../hiring-engine/he-source-attribution.service.js";
import { buildFunnel, finalVerdict, pickSample, type FunnelResult } from "./funnel.js";
import { loadOverrides, withOverride } from "./override.service.js";
import type { CandidateFacts, CompiledCriteria, Evaluation, SourceKind, SubSource, Verdict } from "./selection-types.js";
import type { CriteriaPatch } from "./templates.js";

export const MAX_PEOPLE = 100_000;
export const LIVE_READ_CAP = 5_000;
export const maskMobile = (m: string) => (/^\d{10}$/.test(m) ? `${m.slice(0, 2)}xxxxxx${m.slice(-2)}` : "xxxxxxxxxx");

export interface PreviewInput { requisitionId: string; sourceKind: SourceKind; subSource?: SubSource | "all"; draft?: CriteriaPatch | null; now?: Date }
export interface Evaluated { facts: CandidateFacts; e: Evaluation }
export interface PreviewResult extends FunnelResult {
  requisitionId: string; versionId: string | null; draft: boolean; source: SourceKind; subSource: SubSource | "all"; start: number;
  sample: Array<{ maskedMobile: string; firstName: string; subSource: SubSource; verdict: Verdict; score: number; override: string | null; cells: Array<{ key: string; outcome: "pass" | "fail" | "unknown"; text: string }> }>;
  capPreview: { seatsLeft: number; dailyCap: number | null }; generatedAt: string; partial: string[];
}
const fail = (statusCode: number, message: string, issues?: unknown) => Object.assign(new Error(message), { statusCode, ...(issues ? { issues } : {}) });

/** Facts are person-level; this requisition's own journey or booking is a system block here, another one stays "in another journey". */
export function forRequisition(f: CandidateFacts, requisitionId: string): CandidateFacts {
  const s = f.system;
  const here = s.inOtherJourney === requisitionId || s.bookedFor === requisitionId;
  return { ...f, system: { ...s, inOtherJourney: s.inOtherJourney === requisitionId ? null : s.inOtherJourney, bookedFor: s.bookedFor === requisitionId ? null : s.bookedFor,
    eligibility: here ? { ok: false, blocks: ["already_in_this_requisition", ...s.eligibility.blocks], priority: s.eligibility.priority } : s.eligibility } };
}

export async function latestVersionId(requisitionId: string): Promise<string | null> {
  try {
    const [v] = await db.execute<RowDataPacket[]>("SELECT id FROM job_requisition_criteria_version WHERE requisition_id = ? ORDER BY version_no DESC LIMIT 1", [requisitionId]);
    return v[0] ? String(v[0].id) : null;
  } catch { return null; }
}

/** Compiles the requisition (with a draft when given) and evaluates every person of the source. Shared by preview, CSV and runs. */
export async function evaluatePopulation(i: PreviewInput): Promise<{ compiled: CompiledCriteria; versionId: string | null; people: Evaluated[]; partial: string[] }> {
  const now = i.now ?? new Date();
  const d = await loadDbRow((sql, p) => db.execute(sql, p as never) as never, i.requisitionId);
  if (!d) throw fail(404, "Requisition not found");
  let row = toCriteriaRow(d);
  if (i.draft) {
    row = applyPatch(row, i.draft);
    const issues = validateCriteria(row);
    if (issues.some((x) => x.level === "error")) throw fail(422, "The draft criteria contradict each other", issues);
  }
  const compiled = compileCriteria(row);
  const versionId = i.draft ? null : await latestVersionId(i.requisitionId);
  const subs = i.subSource && i.subSource !== "all" ? [i.subSource] : undefined;
  const partial: string[] = [];
  const raw: Array<{ facts: CandidateFacts; hash?: string }> = [];
  // Live Meta is a rolling window: the cached Live rows are re-checked against the cutoff of this clock (fact-cache.service.ts).
  const liveFrom = i.sourceKind === "meta_live" ? await loadLiveFrom(now) : null;
  let after: string | undefined;
  for (;;) {
    const r = await readFactCache({ sourceKind: i.sourceKind, subSources: subs, afterKey: after, limit: 5000, ...(liveFrom ? { liveFrom } : {}) });
    for (const x of r.rows) raw.push({ facts: x.facts, hash: x.factsHash });
    if (!r.nextKey || raw.length >= MAX_PEOPLE) { if (r.nextKey) partial.push(`capped_at_${MAX_PEOPLE}`); break; }
    after = r.nextKey;
  }
  if (!raw.length) {
    const live = await loadRawPeople({ sourceKind: i.sourceKind, subSources: subs, limit: LIVE_READ_CAP }, now);
    for (const p of live.people) raw.push({ facts: normaliseFacts(p.person, now) });
    partial.push(live.nextKey ? `facts_cache_empty_live_read_capped_at_${LIVE_READ_CAP}` : "facts_cache_empty_live_read");
  }
  const overrides = await loadOverrides(i.requisitionId);
  const people = raw.map(({ facts, hash }) => {
    const f = forRequisition(facts, i.requisitionId);
    return { facts: f, e: withOverride(evaluate(f, compiled, now, hash ? { factsHash: hash } : {}), overrides.get(f.personKey)) };
  });
  return { compiled, versionId, people, partial };
}

export async function previewRequisition(i: PreviewInput): Promise<PreviewResult> {
  const now = i.now ?? new Date();
  const { compiled, versionId, people, partial } = await evaluatePopulation({ ...i, now });
  const [seats] = await db.execute<RowDataPacket[]>("SELECT requested_headcount, fulfilled_headcount FROM job_requisition WHERE id = ? LIMIT 1", [i.requisitionId]);
  const seatsLeft = Math.max(0, Number(seats[0]?.requested_headcount ?? 0) - Number(seats[0]?.fulfilled_headcount ?? 0));
  return {
    requisitionId: i.requisitionId, versionId, draft: !!i.draft, source: i.sourceKind, subSource: i.subSource ?? "all", start: people.length,
    ...buildFunnel(people, compiled),
    sample: pickSample(people, compiled).map(({ facts, e }) => ({
      maskedMobile: maskMobile(facts.personKey), firstName: facts.firstName ?? "", subSource: facts.subSource, verdict: finalVerdict(e), score: e.score,
      override: e.override && !e.systemBlock ? `HR ${e.override.kind === "include" ? "included" : "excluded"}: ${e.override.reason}` : null,
      cells: [...e.passed, ...e.failed, ...e.unknown].sort((a, b) => (a.index ?? -1) - (b.index ?? -1)).map((r) => ({ key: r.key, outcome: r.outcome, text: `${r.actualText} (required ${r.requiredText})` })),
    })),
    capPreview: { seatsLeft, dailyCap: null }, generatedAt: now.toISOString(), partial,
  };
}

// Names and reasons come from Meta / ATS: a text cell starting = + - @ TAB CR is neutralised (call-file rule); numbers stay numbers.
const csvCell = (v: unknown) => {
  const s = typeof v === "number" ? String(v) : csvSafe(String(v ?? ""));
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, "\"\"")}"` : s;
};
/** Every evaluated person, masked (S-O11): no full mobile, first name only. */
export async function previewCsv(i: PreviewInput): Promise<string> {
  const { people } = await evaluatePopulation(i);
  const lines = [["mobile", "first_name", "source", "verdict", "score", "system_block", "failed_rules", "review_reasons", "override"].join(",")];
  for (const { facts, e } of people) {
    lines.push([maskMobile(facts.personKey), facts.firstName ?? "", facts.subSource, finalVerdict(e), e.score, e.systemBlock ?? "",
      e.failed.filter((r) => r.mode !== "prefer").map((r) => `${r.label}: ${r.actualText}`).join("; "), e.reviewReasons.join("; "),
      e.override && !e.systemBlock ? `${e.override.kind}: ${e.override.reason}` : ""].map(csvCell).join(","));
  }
  return `${lines.join("\n")}\n`;
}
