// evaluate(facts, compiled, now): pass | fail | review with every rule's actual vs required value (plan 2026-10-09, S7).
// Pure and deterministic: no clock reads (now is passed in); rule order is the compiled order.
//  1. System rules (never editable) first; any block fails with systemBlock.
//  2. Every rule is evaluated, so the explanation is complete.
//  3. MUST fail -> fail. MUST unknown -> its missing policy (per sub-source, per source kind, general): review / fail / no effect.
//  4. PREFER pass +weight, fail -weight/2 ("rejected elsewhere" is a pure penalty: -weight), unknown 0. PREFER never moves the verdict.
//  5. Score = scoreLead (non-strict; MUST rules gate, scoreLead only ranks) rankScore + PREFER effects, clamped 0..100.
import { scoreLead } from "../hiring-engine/he-matcher.js";
import { canonicalJson, sha256 } from "./compile-criteria.js";
import { checkRule } from "./rule-checks.js";
import { ENGINE_VERSION, type CandidateFacts, type CompiledCriteria, type CompiledRule, type Evaluation, type MissingPolicy, type RuleResult } from "./selection-types.js";

export { ENGINE_VERSION };

function systemBlock(f: CandidateFacts): string | null {
  if (f.recordType === "legacy_employee" || f.recordType === "test") return f.recordType;
  if (!f.mobileValid) return "invalid_mobile";
  if (!f.system.eligibility.ok) return f.system.eligibility.blocks[0] ?? "not_eligible";
  if (f.system.bookedFor) return "already_booked";
  if (f.system.inOtherJourney) return "in_other_journey";
  return null;
}

export function resolveRuleMissing(rule: CompiledRule, f: CandidateFacts): MissingPolicy {
  return rule.missingBySource?.[f.subSource] ?? rule.missingBySource?.[f.sourceKind] ?? rule.missing;
}

export function evaluate(f: CandidateFacts, c: CompiledCriteria, now: Date, o: { factsHash?: string } = {}): Evaluation {
  const passed: RuleResult[] = [], failed: RuleResult[] = [], unknown: RuleResult[] = [];
  const reviewReasons: string[] = [];
  let anyFail = false, preferDelta = 0;

  const block = systemBlock(f);
  if (block) {
    anyFail = true;
    failed.push({ key: "system", label: "System rule", outcome: "fail", actualText: block.replace(/_/g, " "), requiredText: "eligible to contact", mode: "system", effect: "fail" });
  }

  for (const [index, rule] of c.rules.entries()) {
    if (rule.only && !rule.only.includes(f.sourceKind)) continue;
    const chk = checkRule(rule, f, now);
    let effect: RuleResult["effect"] = "none";
    if (rule.mode === "must") {
      if (chk.outcome === "fail") { effect = "fail"; anyFail = true; }
      if (chk.outcome === "unknown") {
        const m = resolveRuleMissing(rule, f);
        if (m === "fail") { effect = "fail"; anyFail = true; }
        if (m === "review") { effect = "review"; reviewReasons.push(`${rule.label}: ${chk.actualText}`); }
      }
      if (chk.outcome === "pass" && chk.bonus) { effect = `+${chk.bonus}`; preferDelta += chk.bonus; }
    } else if (chk.outcome !== "unknown") {
      const penaltyOnly = rule.key === "rejected_other_process";
      const d = chk.outcome === "pass" ? (penaltyOnly ? 0 : rule.weight) : -(penaltyOnly ? rule.weight : Math.round(rule.weight / 2));
      if (d) { effect = d > 0 ? `+${d}` : `-${-d}`; preferDelta += d; }
    }
    const res: RuleResult = { key: rule.key, label: rule.label, outcome: chk.outcome, actualText: chk.actualText, requiredText: rule.requiredText, mode: rule.mode, effect, index };
    (chk.outcome === "pass" ? passed : chk.outcome === "fail" ? failed : unknown).push(res);
  }

  const base = scoreLead(f.match, { ...c.matchReq, strict: false }).rankScore;
  const score = Math.round(Math.max(0, Math.min(100, base + preferDelta)) * 10) / 10;
  return {
    verdict: anyFail ? "fail" : reviewReasons.length ? "review" : "pass", score, systemBlock: block,
    passed, failed, unknown, reviewReasons, criteriaHash: c.hash, versionId: c.versionId, engineVersion: ENGINE_VERSION,
    factsHash: o.factsHash ?? sha256(canonicalJson(f)),
  };
}

/** One line for HR: "Minimum qualification: 10th (required 12th or above) - fail". */
export function explain(r: RuleResult): string {
  return `${r.label}: ${r.actualText} (required ${r.requiredText}) - ${r.outcome}${/^[+-]/.test(r.effect) ? ` (${r.effect})` : ""}`;
}
