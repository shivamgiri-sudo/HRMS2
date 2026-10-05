/**
 * Branch Recruitment Activity audit. READ-ONLY.
 *
 * Lists the token facts behind one branch's FTD walk-in / selected counts for a date, with the raw DB values
 * and how each was classified.
 *
 *   npx tsx scripts/branch-activity-audit.ts [YYYY-MM-DD] [branch]
 */
import "dotenv/config";
import { fetchRawFacts } from "../src/modules/ats/branch-activity-report/query.js";
import { toFact } from "../src/modules/ats/branch-activity-report/metrics.js";
import { canonicalBranch, recruiterKey } from "../src/modules/ats/ats-vocabulary.js";

const DATE = process.argv[2] ?? "2026-10-03";
const BRANCH = (process.argv[3] ?? "NOIDA-2").toLowerCase();

(async () => {
  const { rows } = await fetchRawFacts(DATE, DATE);
  const facts = rows
    .map((r) => toFact(r, canonicalBranch, recruiterKey))
    .filter((f) => f.arrivalDate === DATE && f.branch.toLowerCase() === BRANCH);
  console.log(`\n${BRANCH} ${DATE}: ${facts.length} tokens, ${new Set(facts.map((f) => f.candidateId)).size} distinct walk-ins`);
  const by = (k: (f: (typeof facts)[number]) => string) =>
    Object.entries(facts.reduce<Record<string, number>>((m, f) => ((m[k(f)] = (m[k(f)] ?? 0) + 1), m), {}));
  console.log("by outcome:", by((f) => f.outcome));
  console.log("by has-queue-row:", by((f) => String(f.raw.hasQueueRow)));
  console.log("by source:", by((f) => f.source));
  console.table(
    facts.map((f) => ({
      tok: f.tokenNumber, name: f.candidateName.slice(0, 22), time: f.arrivalHhmm, q: f.raw.hasQueueRow ? f.raw.queueStatus : "NOQ",
      form: f.raw.subId ? "Y" : "N", decision: f.raw.decisionText, cstatus: f.raw.candStatus, stage: f.raw.currentStage,
      src: f.raw.sourceChannel, outcome: f.outcome, emp: f.raw.isEmployee ? "Y" : "",
    })),
  );
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
