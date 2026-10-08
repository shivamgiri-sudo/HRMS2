import type { CandidateFacts, CompiledCriteria, CompiledRule, FactValue, RuleKey } from "../../selection-types.js";
import { catalogueEntry } from "../../rule-catalogue.js";

export const NOW = new Date("2026-10-09T06:00:00Z");
const m = <T>(): FactValue<T> => ({ value: null, quality: "missing", from: "test" });
export const ok = <T>(value: T): FactValue<T> => ({ value, quality: "ok", from: "test" });

export function baseFacts(o: Partial<CandidateFacts> = {}): CandidateFacts {
  return {
    personKey: "9876543210", sourceKind: "he", subSource: "candidate", sourceDetail: null, recordType: "candidate",
    age: m(), educationRank: m(), educationStatus: m(), stream: m(), experienceYears: m(), skillsText: m(), locationText: m(), preferredLocations: m(), hometown: m(),
    relocationOk: m(), nightShiftOk: m(), rotationalOk: m(), salaryMonthly: m(), salaryIsExpectation: false, noticeDays: m(), englishLevel: m(), typingWpm: m(),
    languages: m(), gender: m(), certificates: m(), employers: m(), formAnswers: null, lastActiveAt: m(), recordUpdatedAt: m(), lastFirstContactAt: null, email: m(), mobileValid: true,
    system: { eligibility: { ok: true, blocks: [], priority: 1 }, inOtherJourney: null, bookedFor: null, exEmployee: null, rejectedOtherProcess: false },
    metaInput: null, match: {}, ...o,
  };
}

export function rule(key: RuleKey, required: unknown, o: Partial<CompiledRule> = {}): CompiledRule {
  return { key, label: catalogueEntry(key).label, op: "x", required, requiredText: `req ${key}`, mode: "must", weight: 0, missing: "review", origin: "test", ...o };
}

export function compiled(rules: CompiledRule[], o: Partial<CompiledCriteria> = {}): CompiledCriteria {
  return {
    requisitionId: "r1", versionId: null, hash: "h", engineVersion: 1, rules, undecided: [], legacy: false, decided: [], templateId: null,
    completeness: { score: 0, label: "incomplete", missing: [], enrolmentReady: false }, matchReq: {}, ...o,
  };
}
