import { describe, expect, it } from "vitest";
import {
  evaluateFormula,
  validateFormula,
  listFormulaFunctions,
  FORMULA_FUNCTIONS,
} from "../kpi-formula.engine.js";

/**
 * The engine's whole reason to exist is that KPI arithmetic was hardcoded per metric, in two
 * places, with two different definitions of AHT. So the first thing these tests pin is that
 * the real production formulas are expressible and produce the values the hardcoded code
 * produces — otherwise the engine is not a replacement for anything.
 *
 * The second thing they pin, at length, is null handling. Every KPI bug this codebase has
 * documented a fix for was a false zero: attendance scoring 0 on a week-off,
 * FATAL_RATE dividing by total instead of scored audits. An engine that returns 0 for missing
 * data would reintroduce that class of bug for every formula an administrator writes.
 */

describe("formula engine — arithmetic", () => {
  it("respects operator precedence", () => {
    expect(evaluateFormula("2 + 3 * 4", {}).value).toBe(14);
    expect(evaluateFormula("(2 + 3) * 4", {}).value).toBe(20);
    expect(evaluateFormula("10 - 2 - 3", {}).value).toBe(5);
    expect(evaluateFormula("100 / 10 / 2", {}).value).toBe(5);
  });

  it("treats ^ as right-associative, as every spreadsheet does", () => {
    // 2^(3^2) = 512, not (2^3)^2 = 64.
    expect(evaluateFormula("2 ^ 3 ^ 2", {}).value).toBe(512);
  });

  it("handles unary minus, including before a bracket", () => {
    expect(evaluateFormula("-5 + 10", {}).value).toBe(5);
    expect(evaluateFormula("-(3 * 4)", {}).value).toBe(-12);
    expect(evaluateFormula("10 - -5", {}).value).toBe(15);
  });

  it("reads numbers written the way targets are written", () => {
    expect(evaluateFormula("50_000 / 2", {}).value).toBe(25000);
    expect(evaluateFormula("1.5e3", {}).value).toBe(1500);
    expect(evaluateFormula(".5 * calls", { calls: 10 }).value).toBe(5);
  });

  it("substitutes named fields", () => {
    expect(evaluateFormula("talk_seconds / calls", { talk_seconds: 600, calls: 4 }).value).toBe(150);
  });

  it("resolves field names case-insensitively", () => {
    // An author typing TALK_SECONDS against a talk_seconds column made a typo, not a choice.
    expect(evaluateFormula("TALK_SECONDS / Calls", { talk_seconds: 600, calls: 4 }).value).toBe(150);
  });
});

describe("formula engine — the real production formulas", () => {
  it("expresses AHT as the APR sync computes it: (talk + dispo) / calls", () => {
    const result = evaluateFormula("(talk_seconds + dispo_seconds) / calls", {
      talk_seconds: 1200,
      dispo_seconds: 300,
      calls: 5,
    });
    expect(result.value).toBe(300);
  });

  it("expresses AHT as the dialer sync computes it: (talk + hold + acw) / calls", () => {
    // The two definitions disagreeing in production is precisely why this needs to be
    // configuration rather than code — both are now writable per process.
    const result = evaluateFormula("(talk_seconds + hold_seconds + acw_seconds) / calls", {
      talk_seconds: 1200,
      hold_seconds: 200,
      acw_seconds: 300,
      calls: 5,
    });
    expect(result.value).toBe(340);
  });

  it("expresses QUALITY_SCORE as points earned over points possible", () => {
    expect(evaluateFormula("PCT(points_earned, points_possible)", { points_earned: 85, points_possible: 100 }).value).toBe(85);
  });

  it("expresses FATAL_RATE over scored audits, not total audits", () => {
    // The documented fix: dividing by total_audits counted un-scored audits as passes.
    const result = evaluateFormula("PCT(fatal_audits, scored_audits)", { fatal_audits: 3, scored_audits: 60 });
    expect(result.value).toBe(5);
  });

  it("expresses CONVERSION_RATE", () => {
    const result = evaluateFormula("PCT(converted_sales, eligible_contacts)", {
      converted_sales: 12,
      eligible_contacts: 240,
    });
    expect(result.value).toBe(5);
  });

  it("expresses a net login figure with a break deduction", () => {
    const result = evaluateFormula("SECONDS_TO_HOURS(login_seconds - break_seconds)", {
      login_seconds: 32_400,
      break_seconds: 3_600,
    });
    expect(result.value).toBe(8);
  });
});

describe("formula engine — missing data is never zero", () => {
  it("returns no result when an input is null, and says which one", () => {
    const result = evaluateFormula("talk_seconds / calls", { talk_seconds: null, calls: 4 });
    expect(result.value).toBeNull();
    expect(result.error).toBeUndefined();
    expect(result.nullReason).toContain("talk_seconds");
  });

  it("returns no result for division by zero rather than Infinity", () => {
    // Infinity would be capped at the max-achievement ceiling and read as a perfect score:
    // an agent who took no calls would top the AHT leaderboard.
    const result = evaluateFormula("talk_seconds / calls", { talk_seconds: 600, calls: 0 });
    expect(result.value).toBeNull();
    expect(result.nullReason).toContain("Division by zero");
  });

  it("treats a non-numeric source value as missing, not as zero", () => {
    // An uploaded spreadsheet cell holding "N/A" is a real case, not a hypothetical.
    const result = evaluateFormula("score * 1", { score: "N/A" });
    expect(result.value).toBeNull();
  });

  it("treats an empty-string source value as missing", () => {
    expect(evaluateFormula("score * 1", { score: "" }).value).toBeNull();
  });

  it("accepts the strings mysql2 returns for DECIMAL columns", () => {
    // mysql2 hands back DECIMAL as a string. Rejecting that would make every database-backed
    // formula fail while every hand-tested one passed.
    expect(evaluateFormula("talk_seconds / calls", { talk_seconds: "600.0000", calls: "4" }).value).toBe(150);
  });

  it("distinguishes a null value from an unwired field", () => {
    // A null value is a fact about the source. A missing key is a broken mapping, and must be
    // loud — otherwise a mis-wired formula reads as an empty KPI for months.
    const nullValue = evaluateFormula("calls * 2", { calls: null });
    expect(nullValue.value).toBeNull();
    expect(nullValue.error).toBeUndefined();

    const unwired = evaluateFormula("calls * 2", {});
    expect(unwired.value).toBeNull();
    expect(unwired.error).toContain("No value was supplied");
  });

  it("lets an author opt into zero explicitly with COALESCE", () => {
    expect(evaluateFormula("COALESCE(bonus, 0) + base", { bonus: null, base: 100 }).value).toBe(100);
  });

  it("does not let a null condition silently take the else branch", () => {
    // IF(unknown, a, b) is unknown. Taking `b` would be inventing a measurement.
    const result = evaluateFormula("IF(quality_score > 80, 100, 0)", { quality_score: null });
    expect(result.value).toBeNull();
  });

  it("propagates null through arithmetic but not through SUM", () => {
    expect(evaluateFormula("a + b", { a: 5, b: null }).value).toBeNull();
    // SUM of what is present is a defensible total; a spreadsheet user expects this.
    expect(evaluateFormula("SUM(a, b)", { a: 5, b: null }).value).toBe(5);
    // But an all-missing SUM is not a zero total.
    expect(evaluateFormula("SUM(a, b)", { a: null, b: null }).value).toBeNull();
  });

  it("averages only the values that are present", () => {
    expect(evaluateFormula("AVG(a, b, c)", { a: 10, b: null, c: 20 }).value).toBe(15);
    expect(evaluateFormula("AVG(a, b)", { a: null, b: null }).value).toBeNull();
  });
});

describe("formula engine — functions", () => {
  it("SAFE_DIV reports no result on a zero denominator, or the supplied fallback", () => {
    expect(evaluateFormula("SAFE_DIV(a, b)", { a: 10, b: 0 }).value).toBeNull();
    expect(evaluateFormula("SAFE_DIV(a, b, 0)", { a: 10, b: 0 }).value).toBe(0);
    expect(evaluateFormula("SAFE_DIV(a, b)", { a: 10, b: 4 }).value).toBe(2.5);
  });

  it("PCT returns no result when the whole is zero", () => {
    expect(evaluateFormula("PCT(a, b)", { a: 5, b: 0 }).value).toBeNull();
  });

  it("ROUND takes an optional decimal count", () => {
    expect(evaluateFormula("ROUND(x)", { x: 2.6 }).value).toBe(3);
    expect(evaluateFormula("ROUND(x, 2)", { x: 2.34567 }).value).toBe(2.35);
  });

  it("CLAMP holds a value inside its bounds", () => {
    expect(evaluateFormula("CLAMP(x, 0, 100)", { x: 150 }).value).toBe(100);
    expect(evaluateFormula("CLAMP(x, 0, 100)", { x: -20 }).value).toBe(0);
    expect(evaluateFormula("CLAMP(x, 0, 100)", { x: 55 }).value).toBe(55);
  });

  it("MIN and MAX span several values", () => {
    expect(evaluateFormula("MIN(a, b, c)", { a: 5, b: 2, c: 9 }).value).toBe(2);
    expect(evaluateFormula("MAX(a, b, c)", { a: 5, b: 2, c: 9 }).value).toBe(9);
  });

  it("SQRT of a negative is no result, not NaN", () => {
    expect(evaluateFormula("SQRT(x)", { x: -4 }).value).toBeNull();
    expect(evaluateFormula("SQRT(x)", { x: 16 }).value).toBe(4);
  });

  it("converts units both ways", () => {
    expect(evaluateFormula("MINUTES_TO_SECONDS(x)", { x: 5 }).value).toBe(300);
    expect(evaluateFormula("SECONDS_TO_MINUTES(x)", { x: 300 }).value).toBe(5);
    expect(evaluateFormula("HOURS_TO_SECONDS(x)", { x: 2 }).value).toBe(7200);
    expect(evaluateFormula("SECONDS_TO_HOURS(x)", { x: 7200 }).value).toBe(2);
  });

  it("accepts function names in any case", () => {
    expect(evaluateFormula("round(x, 1)", { x: 1.26 }).value).toBe(1.3);
  });

  it("nests functions", () => {
    const result = evaluateFormula("ROUND(CLAMP(PCT(passed, total), 0, 100), 1)", { passed: 7, total: 9 });
    expect(result.value).toBe(77.8);
  });
});

describe("formula engine — comparisons and conditionals", () => {
  it("evaluates comparisons to 1 and 0", () => {
    expect(evaluateFormula("a > b", { a: 5, b: 3 }).value).toBe(1);
    expect(evaluateFormula("a < b", { a: 5, b: 3 }).value).toBe(0);
    expect(evaluateFormula("a >= b", { a: 3, b: 3 }).value).toBe(1);
    expect(evaluateFormula("a != b", { a: 3, b: 3 }).value).toBe(0);
    expect(evaluateFormula("a <> b", { a: 3, b: 4 }).value).toBe(1);
    expect(evaluateFormula("a = b", { a: 3, b: 3 }).value).toBe(1);
  });

  it("supports AND / OR / NOT as words and as symbols", () => {
    expect(evaluateFormula("a > 1 AND b > 1", { a: 2, b: 2 }).value).toBe(1);
    expect(evaluateFormula("a > 1 && b > 1", { a: 2, b: 0 }).value).toBe(0);
    expect(evaluateFormula("a > 1 OR b > 1", { a: 0, b: 2 }).value).toBe(1);
    expect(evaluateFormula("NOT (a > 1)", { a: 0 }).value).toBe(1);
  });

  it("scores a banded KPI through nested IF", () => {
    const banded = "IF(aht <= 240, 100, IF(aht <= 300, 80, IF(aht <= 360, 60, 0)))";
    expect(evaluateFormula(banded, { aht: 200 }).value).toBe(100);
    expect(evaluateFormula(banded, { aht: 280 }).value).toBe(80);
    expect(evaluateFormula(banded, { aht: 350 }).value).toBe(60);
    expect(evaluateFormula(banded, { aht: 400 }).value).toBe(0);
  });
});

describe("formula engine — validation", () => {
  it("reports the fields and functions a formula uses", () => {
    const result = validateFormula("SAFE_DIV(talk_seconds + hold_seconds, calls)");
    expect(result.ok).toBe(true);
    expect(result.variables).toEqual(["talk_seconds", "hold_seconds", "calls"]);
    expect(result.functions).toEqual(["SAFE_DIV"]);
  });

  it("rejects a field the chosen data source does not provide", () => {
    const result = validateFormula("talk_seconds / mystery_column", ["talk_seconds", "calls"]);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("mystery_column");
    expect(result.error).toContain("talk_seconds, calls");
  });

  it("accepts allowed fields regardless of case", () => {
    expect(validateFormula("TALK_SECONDS / CALLS", ["talk_seconds", "calls"]).ok).toBe(true);
  });

  it("rejects a formula that reads no field at all", () => {
    // 100 * 2 scores every employee identically — the shape of a half-finished formula.
    const result = validateFormula("100 * 2");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("every employee would score the same");
  });

  it("rejects an empty formula", () => {
    expect(validateFormula("").ok).toBe(false);
    expect(validateFormula("   ").ok).toBe(false);
  });

  it("reports unbalanced brackets with a position", () => {
    const result = validateFormula("(a + b");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("closing bracket");
  });

  it("names an unknown function and lists the real ones", () => {
    const result = validateFormula("VLOOKUP(a, b)");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("VLOOKUP");
    expect(result.error).toContain("SAFE_DIV");
  });

  it("rejects the wrong number of arguments", () => {
    const result = validateFormula("IF(a > 1, 100)");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("IF takes 3 values, got 2");
  });

  it("rejects a stray operator", () => {
    expect(validateFormula("a + + * b").ok).toBe(false);
    expect(validateFormula("a b").ok).toBe(false);
  });
});

describe("formula engine — safety", () => {
  it("cannot reach JavaScript globals", () => {
    // These are the shapes an injection attempt takes. None of them is a name the evaluator
    // knows, so each fails as an unknown function or an unsupplied field rather than running.
    for (const attempt of [
      "process.exit(1)",
      "require('fs')",
      "constructor.constructor('return 1')()",
      "globalThis.process",
      "this.constructor",
      "__proto__",
      "eval('1+1')",
    ]) {
      const validated = validateFormula(attempt);
      const evaluated = evaluateFormula(attempt, {});
      // Either it fails to parse, or it parses as a plain variable name that was never
      // supplied. What it must never do is execute.
      expect(validated.ok === false || evaluated.value === null).toBe(true);
      expect(evaluated.value).toBeNull();
    }
  });

  it("treats a bare identifier as a field, never as a global", () => {
    // `process` parses as a variable. Supplying it proves it is just a number to the engine.
    expect(evaluateFormula("process + 1", { process: 41 }).value).toBe(42);
  });

  it("rejects an over-long formula", () => {
    const result = validateFormula(`x + ${"1 + ".repeat(600)}1`);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/limit/);
  });

  it("rejects a formula nested past the depth limit without blowing the stack", () => {
    const deep = `${"(".repeat(200)}x${")".repeat(200)}`;
    const result = validateFormula(deep);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("nests deeper");
  });

  it("rejects an unexpected character", () => {
    const result = validateFormula("a $ b");
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Unexpected character "$"');
  });

  it("never returns NaN or Infinity as a value", () => {
    const cases: Array<[string, Record<string, number | null>]> = [
      ["a / b", { a: 1, b: 0 }],
      ["a % b", { a: 1, b: 0 }],
      ["a ^ b", { a: -8, b: 0.5 }],
      ["SQRT(a)", { a: -1 }],
      ["a / b", { a: 0, b: 0 }],
    ];
    for (const [expression, inputs] of cases) {
      const result = evaluateFormula(expression, inputs);
      expect(result.value === null || Number.isFinite(result.value)).toBe(true);
      expect(Number.isNaN(result.value as number)).toBe(false);
    }
  });
});

describe("formula engine — function catalogue", () => {
  it("exposes every implemented function to the builder UI", () => {
    const listed = listFormulaFunctions();
    expect(listed.length).toBe(Object.keys(FORMULA_FUNCTIONS).length);
    // A function the UI offers but the engine lacks is a formula that validates in the browser
    // and fails on save, so the two lists must be the same list.
    for (const entry of listed) {
      expect(FORMULA_FUNCTIONS[entry.name]).toBeDefined();
      expect(entry.description.length).toBeGreaterThan(0);
    }
  });

  it("documents the functions an operational KPI actually needs", () => {
    const names = listFormulaFunctions().map((fn) => fn.name);
    for (const required of ["SAFE_DIV", "PCT", "IF", "COALESCE", "ROUND", "CLAMP", "MIN", "MAX", "SUM", "AVG"]) {
      expect(names).toContain(required);
    }
  });
});
