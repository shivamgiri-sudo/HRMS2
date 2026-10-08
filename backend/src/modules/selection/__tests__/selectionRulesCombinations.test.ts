import { describe, expect, it } from "vitest";
import { parseSelectionRules } from "../selection-rules.schema.js";
import { MISSING_POLICIES, RULE_KEYS, RULE_MODES, SOURCE_KINDS, SUB_SOURCES, type RuleKey } from "../selection-types.js";

// Generated combinations checked against an oracle written here, independently of the schema code.
const SAMPLE: Partial<Record<RuleKey, unknown>> = {
  education_stream: ["commerce"], education_completed: "completed", skills: { match: "any" }, relocation_ok: true,
  salary_fit: { maxRatio: 1.25 }, notice_period: { maxDays: 30 }, certificate: { level: "declared" }, employer_include: ["Concentrix"],
  employer_exclude: ["Acme"], ex_employee: "allow_clean", record_age: { maxDays: 365 }, contact_recent: { days: 7 }, valid_email: true,
  sources: { exclude: ["workindia_import:Whats App"] },
};
const WEIGHTS = [undefined, 0, 10, 50, 51, -1, 2.5];
const DECIDED = [undefined, true, false];

function oracle(mode: string, missing: string | undefined, weight: number | undefined, decided: boolean | undefined) {
  if (weight !== undefined && !(Number.isInteger(weight) && weight >= 0 && weight <= 50)) return false;
  if (mode === "must" && (weight ?? 0) > 0) return false;
  if (mode === "prefer" && missing === "fail") return false;
  if (mode !== "off" && decided === false) return false;
  return true;
}

let seed = 20261009;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const pick = <T,>(a: readonly T[]) => a[Math.floor(rnd() * a.length)];

describe("every key x mode x missing x weight x decided", () => {
  it("parse result matches the oracle; ok values round-trip; no fail appears that HR did not set", () => {
    let checked = 0;
    for (const key of RULE_KEYS) for (const mode of RULE_MODES) for (const missing of [undefined, ...MISSING_POLICIES])
      for (const weight of WEIGHTS) for (const decided of DECIDED) {
        const setting: Record<string, unknown> = { mode };
        if (missing !== undefined) setting.missing = missing;
        if (weight !== undefined) setting.weight = weight;
        if (decided !== undefined) setting.decided = decided;
        if (key in SAMPLE) setting.value = SAMPLE[key];
        const raw = { schema: 1, rules: { [key]: setting } };
        const p = parseSelectionRules(raw);
        const label = JSON.stringify(raw);
        expect(p.ok, label).toBe(oracle(mode, missing, weight, decided));
        if (p.ok) {
          const again = parseSelectionRules(JSON.parse(JSON.stringify(p.value)));
          expect(again.ok && again.value, label).toEqual(p.value);
          if (missing !== "fail") expect(JSON.stringify(p.value), label).not.toContain('"fail"');
          expect(p.warnings.some((w) => /no effect/.test(w)), label).toBe(mode === "prefer" && weight === 0);
        }
        checked++;
      }
    expect(checked).toBe(RULE_KEYS.length * 3 * 4 * WEIGHTS.length * 3);
  });
});

describe("missingBySource: every source x policy x mode", () => {
  it("only a PREFER rule with a fail override is refused; unknown sources always are", () => {
    for (const src of [...SUB_SOURCES, ...SOURCE_KINDS, "linkedin", "META_LIVE"]) for (const pol of MISSING_POLICIES) for (const mode of RULE_MODES) {
      const p = parseSelectionRules({ schema: 1, rules: { experience: { mode, missingBySource: { [src]: pol } } } });
      const known = (SUB_SOURCES as readonly string[]).includes(src) || (SOURCE_KINDS as readonly string[]).includes(src);
      expect(p.ok, `${src} ${pol} ${mode}`).toBe(known && !(mode === "prefer" && pol === "fail"));
    }
  });
});

describe("sources: every subset of exclude tokens", () => {
  const TOKENS = [...SUB_SOURCES, "he"];
  const HE_SUBS = SUB_SOURCES.filter((s) => s !== "meta_live" && s !== "meta_old");
  it("refused exactly when the subset covers every source", () => {
    for (let mask = 0; mask < 1 << TOKENS.length; mask++) {
      const exclude = TOKENS.filter((_, i) => mask & (1 << i));
      const covered = new Set(exclude.flatMap((t) => (t === "he" ? HE_SUBS : [t])));
      const all = SUB_SOURCES.every((s) => covered.has(s));
      const p = parseSelectionRules({ schema: 1, rules: { sources: { mode: "must", value: { exclude } } } });
      expect(p.ok, exclude.join(",")).toBe(!all);
    }
  });
  it("a source with a detail never counts as excluding the whole source", () => {
    const exclude = [...SUB_SOURCES.map((s) => `${s}:x`), "he:anything"];
    expect(parseSelectionRules({ schema: 1, rules: { sources: { mode: "must", value: { exclude } } } }).ok).toBe(true);
  });
  it("an unknown source token is refused", () => {
    expect(parseSelectionRules({ schema: 1, rules: { sources: { mode: "must", value: { exclude: ["legacy_employee"] } } } }).ok).toBe(false);
  });
});

describe("employers: random include/exclude lists", () => {
  const NAMES = ["Teleperformance", "Concentrix", "iEnergizer", "Acme Corp", "HDFC", "SBI Cards"];
  it("refused exactly when a normalised name is on both lists", () => {
    for (let i = 0; i < 400; i++) {
      const inc = NAMES.filter(() => rnd() < 0.3).map((n) => (rnd() < 0.5 ? n.toUpperCase() : ` ${n}  `));
      const exc = NAMES.filter(() => rnd() < 0.3).map((n) => (rnd() < 0.5 ? n.toLowerCase() : n));
      const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
      const overlap = inc.some((a) => exc.some((b) => norm(a) === norm(b)));
      const r: Record<string, unknown> = {};
      if (inc.length) r.employer_include = { mode: "prefer", weight: pick([5, 10]), value: inc };
      if (exc.length) r.employer_exclude = { mode: "must", value: exc };
      expect(parseSelectionRules({ schema: 1, rules: r }).ok, JSON.stringify(r)).toBe(!overlap);
    }
  });
});

describe("whole rule sets built at random from valid parts", () => {
  it("valid parts never combine into a refusal unless a cross-rule contradiction is present", () => {
    for (let i = 0; i < 300; i++) {
      const r: Record<string, unknown> = {};
      for (const key of RULE_KEYS) {
        if (rnd() < 0.5) continue;
        const mode = pick(RULE_MODES);
        const s: Record<string, unknown> = { mode };
        if (mode === "prefer") s.weight = pick([1, 10, 50]);
        if (mode === "must") s.missing = pick(MISSING_POLICIES);
        if (key in SAMPLE) s.value = SAMPLE[key];
        r[key] = s;
      }
      const order = RULE_KEYS.filter(() => rnd() < 0.3);
      const p = parseSelectionRules({ schema: 1, rules: r, order, enrolment: { mode: pick(["off", "hr_approves"]), standingApprovalDays: pick([0, 7, 30]) } });
      expect(p.ok, JSON.stringify(r)).toBe(true);
    }
  });
});
