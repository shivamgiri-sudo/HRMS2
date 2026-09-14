/**
 * KPI formula engine — the calculation layer the KPI schema has always described but never had.
 *
 * `kpi_formula_version.formula_expression`, `kpi_data_source_mapping.formula_sql` and
 * `kpi_formula_catalog.formula_expression` have all existed as free-text columns since
 * migration 125/504. Nothing ever parsed them. Every metric's arithmetic instead lives
 * hardcoded in kpi-data-connector.service.ts — one bespoke block per metric — which is why
 * AHT is computed two different ways in two different files ((talk+dispo)/calls in the APR
 * sync, (talk+hold+acw)/calls in dialer-kpi-sync). A configurable KPI cannot be built on top
 * of that; this module is what makes the formula columns real.
 *
 * ── Why a hand-written parser and not a library ────────────────────────────────────────────
 * `eval` and `new Function` are out: a formula is administrator-supplied text that arrives
 * over HTTP, and either one turns the KPI builder into remote code execution against the
 * backend. mathjs/expr-eval would work but add a dependency whose own evaluator has had
 * sandbox escapes, and we need only arithmetic over named numbers. A ~200 line recursive
 * descent parser has no reachable surface beyond the operators listed below: there is no
 * property access, no function reference, no assignment, no string type, and the function
 * table is a closed literal map.
 *
 * ── Why null propagates instead of becoming zero ───────────────────────────────────────────
 * This is the single most important semantic here. A missing input is NOT zero.
 *
 * syncAttendanceMetrics carries an explicit fix for exactly this: it skips WEEK_OFF/HOLIDAY/
 * LEAVE rows rather than scoring them 0, because a day nobody was scheduled to work is not a
 * day of 0% attendance. syncQualityMetrics carries the same fix on FATAL_RATE (divide by
 * scored_audits, not total_audits). Both bugs were the same mistake: treating absent data as
 * a real measurement of zero.
 *
 * So arithmetic on a null operand yields null, and null means "not measured" all the way out
 * to the caller, which then declines to write a row rather than writing a false zero. An
 * author who genuinely wants a missing value to read as zero says so explicitly with
 * COALESCE(x, 0) — visible in the formula, not implied by the engine.
 *
 * Division by zero yields null for the same reason: 0 calls does not mean infinite handle
 * time, it means there is nothing to average.
 */

/** Result of evaluating a formula. `value: null` means "not measurable", never "zero". */
export interface FormulaEvaluation {
  value: number | null;
  /** Populated only when the formula could not be evaluated at all (bad syntax, unknown name). */
  error?: string;
  /** Why the result is null, when it is null but the formula itself was valid. */
  nullReason?: string;
}

export interface FormulaValidation {
  ok: boolean;
  error?: string;
  /** Every variable the formula reads, in first-appearance order. Drives the builder UI. */
  variables: string[];
  /** Functions the formula calls. Lets the UI explain what the formula does. */
  functions: string[];
}

/**
 * Guards against a pathological formula pinning a request. A KPI formula is a ratio of a few
 * fields; anything approaching these limits is not a KPI, and the limits are what stop a
 * deeply nested expression from exhausting the JS stack (which would be an uncatchable
 * RangeError rather than a 400).
 */
const MAX_EXPRESSION_LENGTH = 2_000;
const MAX_TOKENS = 500;
const MAX_DEPTH = 32;

/** Variable names an administrator may reference. Same shape as a SQL identifier. */
const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

// ─── Tokenizer ───────────────────────────────────────────────────────────────────────────

type TokenType = "number" | "identifier" | "operator" | "lparen" | "rparen" | "comma";

interface Token {
  type: TokenType;
  value: string;
  /** Character offset, so a syntax error can point at the offending position. */
  pos: number;
}

/**
 * Multi-character operators must be tested before their single-character prefixes, otherwise
 * `<=` tokenizes as `<` followed by a stray `=`.
 */
const OPERATORS = ["<=", ">=", "==", "!=", "<>", "&&", "||", "+", "-", "*", "/", "%", "^", "<", ">", "="] as const;

export class FormulaError extends Error {
  constructor(message: string, readonly pos?: number) {
    super(message);
    this.name = "FormulaError";
  }
}

function tokenize(expression: string): Token[] {
  if (expression.length > MAX_EXPRESSION_LENGTH) {
    throw new FormulaError(`Formula is longer than the ${MAX_EXPRESSION_LENGTH} character limit`);
  }

  const tokens: Token[] = [];
  let i = 0;

  while (i < expression.length) {
    const char = expression[i];

    // Whitespace, including newlines — a formula may be laid out over several lines.
    if (/\s/.test(char)) {
      i += 1;
      continue;
    }

    if (tokens.length >= MAX_TOKENS) {
      throw new FormulaError(`Formula has more than the ${MAX_TOKENS} token limit`);
    }

    // Number. Leading digit or a decimal point (".5" is accepted, as spreadsheet users write it).
    if (/[0-9]/.test(char) || (char === "." && /[0-9]/.test(expression[i + 1] ?? ""))) {
      let raw = "";
      while (i < expression.length && /[0-9._]/.test(expression[i])) {
        // Underscores as digit separators (50_000) are stripped, matching how targets are
        // written elsewhere in this codebase's comments.
        if (expression[i] !== "_") raw += expression[i];
        i += 1;
      }
      // Scientific notation, so a currency threshold can be written 1.5e6.
      if (/[eE]/.test(expression[i] ?? "") && /[0-9+-]/.test(expression[i + 1] ?? "")) {
        raw += expression[i];
        i += 1;
        if (/[+-]/.test(expression[i])) {
          raw += expression[i];
          i += 1;
        }
        while (i < expression.length && /[0-9]/.test(expression[i])) {
          raw += expression[i];
          i += 1;
        }
      }
      if (!Number.isFinite(Number(raw))) {
        throw new FormulaError(`"${raw}" is not a valid number`, i);
      }
      tokens.push({ type: "number", value: raw, pos: i });
      continue;
    }

    // Identifier: a variable name or a function name.
    if (/[A-Za-z_]/.test(char)) {
      let raw = "";
      const start = i;
      while (i < expression.length && /[A-Za-z0-9_]/.test(expression[i])) {
        raw += expression[i];
        i += 1;
      }
      // AND / OR / NOT are spelled out by spreadsheet users; accept them as operator words
      // rather than treating them as variables that will then fail to resolve.
      const upper = raw.toUpperCase();
      if (upper === "AND") tokens.push({ type: "operator", value: "&&", pos: start });
      else if (upper === "OR") tokens.push({ type: "operator", value: "||", pos: start });
      else if (upper === "NOT") tokens.push({ type: "operator", value: "!", pos: start });
      else tokens.push({ type: "identifier", value: raw, pos: start });
      continue;
    }

    if (char === "(") {
      tokens.push({ type: "lparen", value: "(", pos: i });
      i += 1;
      continue;
    }
    if (char === ")") {
      tokens.push({ type: "rparen", value: ")", pos: i });
      i += 1;
      continue;
    }
    if (char === ",") {
      tokens.push({ type: "comma", value: ",", pos: i });
      i += 1;
      continue;
    }

    const matched = OPERATORS.find((op) => expression.startsWith(op, i));
    if (matched) {
      tokens.push({ type: "operator", value: matched, pos: i });
      i += matched.length;
      continue;
    }

    if (char === "!") {
      tokens.push({ type: "operator", value: "!", pos: i });
      i += 1;
      continue;
    }

    throw new FormulaError(`Unexpected character "${char}" at position ${i + 1}`, i);
  }

  if (!tokens.length) throw new FormulaError("Formula is empty");
  return tokens;
}

// ─── AST ─────────────────────────────────────────────────────────────────────────────────

type Node =
  | { kind: "number"; value: number }
  | { kind: "variable"; name: string }
  | { kind: "unary"; op: string; operand: Node }
  | { kind: "binary"; op: string; left: Node; right: Node }
  | { kind: "call"; name: string; args: Node[] };

/**
 * Functions an administrator may call. A closed literal map — there is deliberately no way to
 * reach a JS global from a formula, so `constructor`, `process` and friends are simply not
 * names the evaluator knows.
 *
 * `nullPolicy` decides what happens when an argument is null:
 *   "propagate" — any null argument makes the result null (the default, and correct for maths)
 *   "handles"   — the function is *about* nulls and inspects them itself (COALESCE, IF, IFNULL)
 */
interface FormulaFunction {
  minArgs: number;
  maxArgs: number;
  nullPolicy: "propagate" | "handles";
  /** Receives already-evaluated arguments. Returning null means "not measurable". */
  apply: (args: Array<number | null>) => number | null;
  description: string;
}

const round = (value: number, places = 0) => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

export const FORMULA_FUNCTIONS: Record<string, FormulaFunction> = {
  // ── Null handling. The explicit opt-in to "treat missing as a number". ──
  COALESCE: {
    minArgs: 1,
    maxArgs: 10,
    nullPolicy: "handles",
    apply: (args) => args.find((a) => a !== null) ?? null,
    description: "First value that is present. COALESCE(bonus, 0) reads a missing bonus as zero.",
  },
  IFNULL: {
    minArgs: 2,
    maxArgs: 2,
    nullPolicy: "handles",
    apply: ([value, fallback]) => (value === null ? fallback : value),
    description: "IFNULL(value, fallback) — fallback is used only when value is missing.",
  },
  /**
   * Deliberately "handles" rather than "propagate": a condition that is null is unknown, not
   * false, and silently taking the false branch on unknown data is how a false zero gets
   * written. Unknown condition means unknown result.
   */
  IF: {
    minArgs: 3,
    maxArgs: 3,
    nullPolicy: "handles",
    apply: ([condition, whenTrue, whenFalse]) => {
      if (condition === null) return null;
      return condition !== 0 ? whenTrue : whenFalse;
    },
    description: "IF(condition, then, else). A missing condition yields no result, not the else branch.",
  },

  // ── Division that says "no data" instead of dividing by zero. ──
  /**
   * The single most useful function here, because nearly every operational KPI is a ratio and
   * nearly every ratio has a period where the denominator is zero. An agent who took no calls
   * has no average handle time; SAFE_DIV states that, where `/` would too but SAFE_DIV makes
   * the intent legible in the formula.
   */
  SAFE_DIV: {
    minArgs: 2,
    maxArgs: 3,
    nullPolicy: "handles",
    apply: ([numerator, denominator, fallback]) => {
      if (numerator === null || denominator === null) return null;
      if (denominator === 0) return fallback ?? null;
      return numerator / denominator;
    },
    description: "SAFE_DIV(a, b) — a divided by b, or no result when b is zero. Optional third argument is used instead.",
  },
  /** Percentage, the shape most quality and conversion metrics want. */
  PCT: {
    minArgs: 2,
    maxArgs: 2,
    nullPolicy: "handles",
    apply: ([part, whole]) => {
      if (part === null || whole === null) return null;
      if (whole === 0) return null;
      return (part / whole) * 100;
    },
    description: "PCT(part, whole) — part as a percentage of whole. No result when whole is zero.",
  },

  // ── Arithmetic. ──
  ABS: { minArgs: 1, maxArgs: 1, nullPolicy: "propagate", apply: ([v]) => Math.abs(v as number), description: "Absolute value." },
  ROUND: {
    minArgs: 1,
    maxArgs: 2,
    nullPolicy: "propagate",
    apply: ([v, places]) => round(v as number, places === null || places === undefined ? 0 : (places as number)),
    description: "ROUND(value) or ROUND(value, decimals).",
  },
  FLOOR: { minArgs: 1, maxArgs: 1, nullPolicy: "propagate", apply: ([v]) => Math.floor(v as number), description: "Round down." },
  CEIL: { minArgs: 1, maxArgs: 1, nullPolicy: "propagate", apply: ([v]) => Math.ceil(v as number), description: "Round up." },
  SQRT: {
    minArgs: 1,
    maxArgs: 1,
    nullPolicy: "propagate",
    // The square root of a negative is not a number a KPI can carry, so it is no result
    // rather than NaN leaking into a score.
    apply: ([v]) => ((v as number) < 0 ? null : Math.sqrt(v as number)),
    description: "Square root. No result for a negative input.",
  },
  MIN: {
    minArgs: 1,
    maxArgs: 10,
    nullPolicy: "propagate",
    apply: (args) => Math.min(...(args as number[])),
    description: "Smallest of the values.",
  },
  MAX: {
    minArgs: 1,
    maxArgs: 10,
    nullPolicy: "propagate",
    apply: (args) => Math.max(...(args as number[])),
    description: "Largest of the values.",
  },
  SUM: {
    minArgs: 1,
    maxArgs: 10,
    nullPolicy: "handles",
    // SUM ignores missing values rather than propagating, which is what a spreadsheet user
    // expects and is safe here: summing what is present is a defensible total. It returns no
    // result when EVERY input is missing, so an all-empty sum is not reported as 0.
    apply: (args) => {
      const present = args.filter((a): a is number => a !== null);
      return present.length ? present.reduce((total, value) => total + value, 0) : null;
    },
    description: "Adds the values that are present. No result when all of them are missing.",
  },
  AVG: {
    minArgs: 1,
    maxArgs: 10,
    nullPolicy: "handles",
    apply: (args) => {
      const present = args.filter((a): a is number => a !== null);
      return present.length ? present.reduce((total, value) => total + value, 0) / present.length : null;
    },
    description: "Average of the values that are present.",
  },
  /** Keeps a computed value inside a sane band — e.g. CLAMP(score, 0, 100). */
  CLAMP: {
    minArgs: 3,
    maxArgs: 3,
    nullPolicy: "propagate",
    apply: ([value, low, high]) => Math.min(Math.max(value as number, low as number), high as number),
    description: "CLAMP(value, low, high) — value held within the low and high bounds.",
  },

  // ── Unit helpers, because operational sources store durations inconsistently. ──
  MINUTES_TO_SECONDS: {
    minArgs: 1,
    maxArgs: 1,
    nullPolicy: "propagate",
    apply: ([v]) => (v as number) * 60,
    description: "Minutes expressed as seconds.",
  },
  SECONDS_TO_MINUTES: {
    minArgs: 1,
    maxArgs: 1,
    nullPolicy: "propagate",
    apply: ([v]) => (v as number) / 60,
    description: "Seconds expressed as minutes.",
  },
  HOURS_TO_SECONDS: {
    minArgs: 1,
    maxArgs: 1,
    nullPolicy: "propagate",
    apply: ([v]) => (v as number) * 3600,
    description: "Hours expressed as seconds.",
  },
  SECONDS_TO_HOURS: {
    minArgs: 1,
    maxArgs: 1,
    nullPolicy: "propagate",
    apply: ([v]) => (v as number) / 3600,
    description: "Seconds expressed as hours.",
  },
};

// ─── Parser ──────────────────────────────────────────────────────────────────────────────

/**
 * Binding power per operator, low to high. `^` is right-associative so 2^3^2 is 2^(3^2),
 * matching every spreadsheet an author will have used.
 */
const BINARY_PRECEDENCE: Record<string, number> = {
  "||": 1,
  "&&": 2,
  "==": 3,
  "=": 3,
  "!=": 3,
  "<>": 3,
  "<": 4,
  "<=": 4,
  ">": 4,
  ">=": 4,
  "+": 5,
  "-": 5,
  "*": 6,
  "/": 6,
  "%": 6,
  "^": 7,
};

const RIGHT_ASSOCIATIVE = new Set(["^"]);

class Parser {
  private index = 0;
  private depth = 0;

  constructor(private readonly tokens: Token[]) {}

  parse(): Node {
    const node = this.parseExpression(0);
    if (this.index < this.tokens.length) {
      const token = this.tokens[this.index];
      throw new FormulaError(`Unexpected "${token.value}" at position ${token.pos + 1}`, token.pos);
    }
    return node;
  }

  private peek(): Token | undefined {
    return this.tokens[this.index];
  }

  private next(): Token {
    const token = this.tokens[this.index];
    if (!token) throw new FormulaError("Formula ended unexpectedly");
    this.index += 1;
    return token;
  }

  private parseExpression(minPrecedence: number): Node {
    this.depth += 1;
    if (this.depth > MAX_DEPTH) {
      throw new FormulaError(`Formula nests deeper than the ${MAX_DEPTH} level limit`);
    }
    try {
      let left = this.parseUnary();

      for (;;) {
        const token = this.peek();
        if (!token || token.type !== "operator") break;
        const precedence = BINARY_PRECEDENCE[token.value];
        if (precedence === undefined || precedence < minPrecedence) break;

        this.next();
        const nextMinimum = RIGHT_ASSOCIATIVE.has(token.value) ? precedence : precedence + 1;
        const right = this.parseExpression(nextMinimum);
        left = { kind: "binary", op: token.value, left, right };
      }

      return left;
    } finally {
      this.depth -= 1;
    }
  }

  private parseUnary(): Node {
    const token = this.peek();
    if (token?.type === "operator" && (token.value === "-" || token.value === "+" || token.value === "!")) {
      this.next();
      return { kind: "unary", op: token.value, operand: this.parseUnary() };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): Node {
    const token = this.next();

    if (token.type === "number") {
      return { kind: "number", value: Number(token.value) };
    }

    if (token.type === "lparen") {
      const node = this.parseExpression(0);
      const closing = this.peek();
      if (closing?.type !== "rparen") {
        throw new FormulaError(`Missing closing bracket for the one at position ${token.pos + 1}`, token.pos);
      }
      this.next();
      return node;
    }

    if (token.type === "identifier") {
      // A function call is an identifier immediately followed by "(".
      if (this.peek()?.type === "lparen") {
        const name = token.value.toUpperCase();
        const fn = FORMULA_FUNCTIONS[name];
        if (!fn) {
          throw new FormulaError(
            `"${token.value}" is not a function this builder knows. Available: ${Object.keys(FORMULA_FUNCTIONS).join(", ")}`,
            token.pos,
          );
        }
        this.next(); // consume "("
        const args: Node[] = [];
        if (this.peek()?.type !== "rparen") {
          for (;;) {
            args.push(this.parseExpression(0));
            if (this.peek()?.type === "comma") {
              this.next();
              continue;
            }
            break;
          }
        }
        if (this.peek()?.type !== "rparen") {
          throw new FormulaError(`Missing closing bracket for ${name}(`, token.pos);
        }
        this.next(); // consume ")"

        if (args.length < fn.minArgs || args.length > fn.maxArgs) {
          const expected = fn.minArgs === fn.maxArgs ? `${fn.minArgs}` : `${fn.minArgs} to ${fn.maxArgs}`;
          throw new FormulaError(`${name} takes ${expected} values, got ${args.length}`, token.pos);
        }
        return { kind: "call", name, args };
      }

      if (!IDENTIFIER_PATTERN.test(token.value)) {
        throw new FormulaError(`"${token.value}" is not a valid field name`, token.pos);
      }
      return { kind: "variable", name: token.value };
    }

    throw new FormulaError(`Unexpected "${token.value}" at position ${token.pos + 1}`, token.pos);
  }
}

function parse(expression: string): Node {
  return new Parser(tokenize(expression)).parse();
}

// ─── Evaluation ──────────────────────────────────────────────────────────────────────────

function collect(node: Node, variables: Set<string>, functions: Set<string>): void {
  switch (node.kind) {
    case "variable":
      variables.add(node.name);
      return;
    case "unary":
      collect(node.operand, variables, functions);
      return;
    case "binary":
      collect(node.left, variables, functions);
      collect(node.right, variables, functions);
      return;
    case "call":
      functions.add(node.name);
      for (const arg of node.args) collect(arg, variables, functions);
      return;
    default:
      return;
  }
}

/**
 * Parses a formula without running it, and reports what it needs.
 *
 * The builder UI calls this on every keystroke: `variables` is how it can show "this formula
 * reads talk_seconds and calls" and offer to map those to source columns, before any data
 * exists. `allowedVariables` is the enforcement point — an author cannot reference a field the
 * chosen data source does not provide, which is otherwise a formula that silently evaluates
 * to null forever.
 */
export function validateFormula(expression: string, allowedVariables?: readonly string[]): FormulaValidation {
  if (typeof expression !== "string" || !expression.trim()) {
    return { ok: false, error: "Formula is empty", variables: [], functions: [] };
  }

  let ast: Node;
  try {
    ast = parse(expression);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      variables: [],
      functions: [],
    };
  }

  const variableSet = new Set<string>();
  const functionSet = new Set<string>();
  collect(ast, variableSet, functionSet);
  const variables = [...variableSet];
  const functions = [...functionSet];

  if (allowedVariables) {
    // Case-insensitive, because an author typing TALK_SECONDS against a talk_seconds column is
    // making a typo, not choosing a different field.
    const allowed = new Set(allowedVariables.map((name) => name.toLowerCase()));
    const unknown = variables.filter((name) => !allowed.has(name.toLowerCase()));
    if (unknown.length) {
      return {
        ok: false,
        error:
          `${unknown.join(", ")} ${unknown.length === 1 ? "is not a field" : "are not fields"} ` +
          `this data source provides. Available: ${allowedVariables.join(", ") || "none configured yet"}`,
        variables,
        functions,
      };
    }
  }

  if (!variables.length && !functions.length) {
    // A formula of pure literals scores every employee identically, which is never what was
    // intended — it is the shape you get from half-finishing one.
    return {
      ok: false,
      error: "Formula does not read any field, so every employee would score the same",
      variables,
      functions,
    };
  }

  return { ok: true, variables, functions };
}

function evaluateNode(node: Node, inputs: Map<string, number | null>, trace: { nullReason?: string }): number | null {
  switch (node.kind) {
    case "number":
      return node.value;

    case "variable": {
      // Resolved case-insensitively to match validateFormula's allowance rule.
      const key = node.name.toLowerCase();
      if (!inputs.has(key)) {
        throw new FormulaError(`No value was supplied for "${node.name}"`);
      }
      const value = inputs.get(key) ?? null;
      if (value === null && !trace.nullReason) {
        trace.nullReason = `${node.name} has no value for this period`;
      }
      return value;
    }

    case "unary": {
      const operand = evaluateNode(node.operand, inputs, trace);
      if (operand === null) return null;
      if (node.op === "-") return -operand;
      if (node.op === "+") return operand;
      return operand === 0 ? 1 : 0; // "!"
    }

    case "binary": {
      const left = evaluateNode(node.left, inputs, trace);
      const right = evaluateNode(node.right, inputs, trace);
      if (left === null || right === null) return null;

      switch (node.op) {
        case "+":
          return left + right;
        case "-":
          return left - right;
        case "*":
          return left * right;
        case "/":
          if (right === 0) {
            // Not Infinity. An agent with zero calls has no average handle time; reporting one
            // as infinite would then be capped to the max-achievement ceiling and read as a
            // perfect score.
            if (!trace.nullReason) trace.nullReason = "Division by zero — the denominator has no value for this period";
            return null;
          }
          return left / right;
        case "%":
          if (right === 0) {
            if (!trace.nullReason) trace.nullReason = "Remainder by zero";
            return null;
          }
          return left % right;
        case "^": {
          const result = left ** right;
          // A fractional power of a negative is NaN, and NaN must never reach a score.
          if (!Number.isFinite(result)) {
            if (!trace.nullReason) trace.nullReason = `${left} to the power of ${right} is not a usable number`;
            return null;
          }
          return result;
        }
        case "<":
          return left < right ? 1 : 0;
        case "<=":
          return left <= right ? 1 : 0;
        case ">":
          return left > right ? 1 : 0;
        case ">=":
          return left >= right ? 1 : 0;
        case "==":
        case "=":
          return left === right ? 1 : 0;
        case "!=":
        case "<>":
          return left !== right ? 1 : 0;
        case "&&":
          return left !== 0 && right !== 0 ? 1 : 0;
        case "||":
          return left !== 0 || right !== 0 ? 1 : 0;
        default:
          throw new FormulaError(`Unsupported operator "${node.op}"`);
      }
    }

    case "call": {
      const fn = FORMULA_FUNCTIONS[node.name];
      if (!fn) throw new FormulaError(`Unknown function "${node.name}"`);
      const args = node.args.map((arg) => evaluateNode(arg, inputs, trace));
      if (fn.nullPolicy === "propagate" && args.some((arg) => arg === null)) return null;
      const result = fn.apply(args);
      if (result === null) return null;
      if (!Number.isFinite(result)) {
        if (!trace.nullReason) trace.nullReason = `${node.name} did not produce a usable number`;
        return null;
      }
      return result;
    }

    default:
      throw new FormulaError("Unsupported expression");
  }
}

/**
 * Runs a formula against a set of named inputs.
 *
 * Every variable the formula reads must be present as a key, even if its value is null —
 * a missing key is an error (the wiring is wrong) while a null value is a fact (the source had
 * no data). Conflating them is how a broken mapping hides as an empty KPI for months.
 */
export function evaluateFormula(
  expression: string,
  /**
   * Values as they actually arrive, which is not always a number. mysql2 returns DECIMAL columns
   * as strings, an uploaded spreadsheet cell can hold "N/A", and an empty cell arrives as "".
   * Typing this as `number | null` would be a lie that pushes a cast onto every caller and hides
   * the very cases the normalisation below exists to handle.
   */
  inputs: Record<string, number | string | null | undefined>,
): FormulaEvaluation {
  let ast: Node;
  try {
    ast = parse(expression);
  } catch (error) {
    return { value: null, error: error instanceof Error ? error.message : String(error) };
  }

  const normalized = new Map<string, number | null>();
  for (const [key, raw] of Object.entries(inputs)) {
    let value: number | null;
    if (raw === null || raw === undefined || raw === "") {
      value = null;
    } else {
      const parsed = Number(raw);
      // A source column that holds "N/A" is missing data, not zero.
      value = Number.isFinite(parsed) ? parsed : null;
    }
    normalized.set(key.toLowerCase(), value);
  }

  const trace: { nullReason?: string } = {};
  try {
    const value = evaluateNode(ast, normalized, trace);
    if (value === null) {
      return { value: null, nullReason: trace.nullReason ?? "One or more inputs had no value for this period" };
    }
    return { value };
  } catch (error) {
    return { value: null, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * The function catalogue in a shape the builder UI can render as a picker. Exported rather
 * than duplicated in the frontend so the two cannot drift — a function the UI offers but the
 * engine does not implement is a formula that validates in the browser and fails on save.
 */
export function listFormulaFunctions(): Array<{ name: string; args: string; description: string }> {
  return Object.entries(FORMULA_FUNCTIONS).map(([name, fn]) => ({
    name,
    args: fn.minArgs === fn.maxArgs ? `${fn.minArgs}` : `${fn.minArgs}-${fn.maxArgs}`,
    description: fn.description,
  }));
}
