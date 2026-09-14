import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

import {
  ESIGN_BUCKET_COLORS,
  ESIGN_STATE_COLORS,
  esignStatusColor,
} from "@/lib/esignState";

/**
 * Esign_State_Authority (`backend/src/modules/ats/esignState.ts`) and its frontend
 * mirror (`src/lib/esignState.ts`) declare the same 20-key status→bucket table
 * twice, because they have to: `vite.config.ts` and the root `tsconfig.json` alias
 * `@` to `./src` only and the backend compiles under its own tsconfig, so neither
 * build can import the other's module. Nothing in either type checker can see the
 * duplication, which is precisely the drift that produced the original defect —
 * the tracker knew about statuses the documents page had never heard of, so
 * MAS63411 rendered a green "5/5" over nine documents, four of them unsigned.
 *
 * This file is that missing check. It READS BOTH FILES AS TEXT and parses the
 * `ESIGN_STATE_BUCKET` object literal out of each; it deliberately does not
 * import the backend module, since no import path between the two builds exists
 * and inventing one here would pin a contract the shipping code cannot rely on.
 *
 * The last group is the Build_Check of Requirement 6, criterion 8: a status added
 * to the authority with no presentation classification on
 * `EmployeeJoiningDocumentsPage.tsx` fails here BY NAME, before it can reach a
 * user's screen unstyled.
 *
 * Requirements: 6.7, 6.8
 */

const ROOT = path.resolve(__dirname, "..", "..", "..");
const AUTHORITY = path.join(ROOT, "backend", "src", "modules", "ats", "esignState.ts");
const MIRROR = path.join(ROOT, "src", "lib", "esignState.ts");
const PAGE = path.join(ROOT, "src", "pages", "EmployeeJoiningDocumentsPage.tsx");

/** Short labels, so a failure message reads as a file the reader can open. */
const AUTHORITY_LABEL = "backend/src/modules/ats/esignState.ts";
const MIRROR_LABEL = "src/lib/esignState.ts";
const PAGE_LABEL = "src/pages/EmployeeJoiningDocumentsPage.tsx";

function read(file: string, label: string): string {
  expect(fs.existsSync(file), `${label} does not exist`).toBe(true);
  return fs.readFileSync(file, "utf8");
}

/**
 * Remove `//` and block comments, respecting string literals so a comment
 * marker inside a Tailwind class string is not treated as a comment. Both tables
 * are heavily commented by design (the comments are how the two files are kept
 * readable as the same table), and every one of those comments would otherwise
 * confuse brace matching and key extraction.
 */
function stripComments(src: string): string {
  let out = "";
  let i = 0;
  let quote: string | null = null;

  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];

    if (quote !== null) {
      out += c;
      if (c === "\\") {
        out += next ?? "";
        i += 2;
        continue;
      }
      if (c === quote) quote = null;
      i += 1;
      continue;
    }

    if (c === '"' || c === "'" || c === "`") {
      quote = c;
      out += c;
      i += 1;
      continue;
    }

    if (c === "/" && next === "/") {
      const nl = src.indexOf("\n", i);
      i = nl === -1 ? src.length : nl;
      continue;
    }

    if (c === "/" && next === "*") {
      const end = src.indexOf("*/", i + 2);
      i = end === -1 ? src.length : end + 2;
      continue;
    }

    out += c;
    i += 1;
  }

  return out;
}

/**
 * The `{ ... }` body of `const <name> = ...`, brace-matched. Exported or not —
 * the page's `STATUS_COLORS` is module-local, which is correct: it is presentation
 * detail nothing else should consume.
 */
function objectLiteralBody(src: string, name: string, label: string): string {
  const code = stripComments(src);
  const decl = new RegExp(`(?:^|\\n)\\s*(?:export\\s+)?const\\s+${name}\\b`).exec(code)?.index ?? -1;
  expect(decl, `${label} does not declare "const ${name}"`).toBeGreaterThan(-1);

  const open = code.indexOf("{", decl);
  expect(open, `${label}: no object literal follows "const ${name}"`).toBeGreaterThan(-1);

  let depth = 0;
  for (let i = open; i < code.length; i += 1) {
    if (code[i] === "{") depth += 1;
    else if (code[i] === "}") {
      depth -= 1;
      if (depth === 0) return code.slice(open + 1, i);
    }
  }

  throw new Error(`${label}: unbalanced braces in the ${name} object literal`);
}

/** `key: "value"` pairs, in declaration order. */
function stringEntries(body: string): Array<[string, string]> {
  const entries: Array<[string, string]> = [];
  const pattern = /(?:^|[\s,{])(?:"([\w-]+)"|'([\w-]+)'|([A-Za-z_$][\w$]*))\s*:\s*["']([^"']*)["']/g;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(body)) !== null) {
    entries.push([m[1] ?? m[2] ?? m[3], m[4]]);
  }
  return entries;
}

function bucketTable(file: string, label: string): Record<string, string> {
  const entries = stringEntries(objectLiteralBody(read(file, label), "ESIGN_STATE_BUCKET", label));
  const table: Record<string, string> = {};
  const duplicates: string[] = [];
  for (const [key, value] of entries) {
    if (key in table) duplicates.push(key);
    table[key] = value;
  }
  expect(
    duplicates,
    `${label} declares the same status key more than once in ESIGN_STATE_BUCKET: ` +
      `${duplicates.join(", ")}. The later declaration silently wins, so the table ` +
      `does not say what it appears to say.`,
  ).toEqual([]);
  return table;
}

/** `export type EsignBucket = ...;` with its whitespace normalised. */
function bucketUnion(src: string, label: string): string {
  const code = stripComments(src);
  const m = /export\s+type\s+EsignBucket\s*=\s*([^;]+);/.exec(code);
  expect(m, `${label} does not declare "export type EsignBucket"`).not.toBeNull();
  return (m as RegExpExecArray)[1].replace(/\s+/g, " ").trim();
}

const authority = bucketTable(AUTHORITY, AUTHORITY_LABEL);
const mirror = bucketTable(MIRROR, MIRROR_LABEL);

const authorityKeys = Object.keys(authority);
const mirrorKeys = Object.keys(mirror);

describe("Esign_State_Authority and its frontend mirror declare the same table", () => {
  it("both files parse to a non-empty table", () => {
    // Guards the parser itself: a regex that silently matched nothing would make
    // every set-comparison below pass vacuously, which is worse than no test.
    expect(
      authorityKeys.length,
      `parsed no status keys out of ${AUTHORITY_LABEL} — the parser, not the table, is wrong`,
    ).toBeGreaterThan(0);
    expect(
      mirrorKeys.length,
      `parsed no status keys out of ${MIRROR_LABEL} — the parser, not the table, is wrong`,
    ).toBeGreaterThan(0);
  });

  it("declares the same status key set in both files", () => {
    const missingFromMirror = authorityKeys.filter((k) => !(k in mirror));
    const missingFromAuthority = mirrorKeys.filter((k) => !(k in authority));

    const detail = [
      missingFromMirror.length > 0
        ? `in ${AUTHORITY_LABEL} but NOT in ${MIRROR_LABEL}: ${missingFromMirror.join(", ")} ` +
          `— these statuses classify on the server and render unstyled in the browser`
        : null,
      missingFromAuthority.length > 0
        ? `in ${MIRROR_LABEL} but NOT in ${AUTHORITY_LABEL}: ${missingFromAuthority.join(", ")} ` +
          `— the frontend styles a status the server does not classify`
        : null,
    ]
      .filter(Boolean)
      .join("; ");

    expect(
      { missingFromMirror, missingFromAuthority },
      `the two ESIGN_STATE_BUCKET tables have drifted apart — ${detail}. ` +
        `Fix the file that is behind; do not delete the key from the other.`,
    ).toEqual({ missingFromMirror: [], missingFromAuthority: [] });
  });

  it("maps every shared key to the same bucket in both files", () => {
    const disagreements = authorityKeys
      .filter((k) => k in mirror && authority[k] !== mirror[k])
      .map((k) => `${k}: ${AUTHORITY_LABEL} says "${authority[k]}", ${MIRROR_LABEL} says "${mirror[k]}"`);

    expect(
      disagreements,
      `the same status is bucketed differently on the two sides, so a document ` +
        `counted one way in the tracker's denominator renders the other way on the ` +
        `documents page:\n  ${disagreements.join("\n  ")}`,
    ).toEqual([]);
  });

  it("declares the EsignBucket union identically in both files", () => {
    const expected = '"completed" | "in_progress" | "not_started"';
    const fromAuthority = bucketUnion(read(AUTHORITY, AUTHORITY_LABEL), AUTHORITY_LABEL);
    const fromMirror = bucketUnion(read(MIRROR, MIRROR_LABEL), MIRROR_LABEL);

    expect(
      fromMirror,
      `EsignBucket differs between the two files: ${AUTHORITY_LABEL} declares ` +
        `${fromAuthority}, ${MIRROR_LABEL} declares ${fromMirror}`,
    ).toBe(fromAuthority);

    expect(
      fromAuthority,
      `EsignBucket is no longer ${expected}. A fourth bucket (or a renamed one) is a ` +
        `change to the tracker's counters and to every consumer of the API's bucket ` +
        `field, not a local edit — update the spec before widening it here.`,
    ).toBe(expected);
  });

  it("buckets every status into a member of the declared union", () => {
    const union = new Set(["completed", "in_progress", "not_started"]);
    const strays = [
      ...authorityKeys
        .filter((k) => !union.has(authority[k]))
        .map((k) => `${AUTHORITY_LABEL} ${k} → "${authority[k]}"`),
      ...mirrorKeys
        .filter((k) => !union.has(mirror[k]))
        .map((k) => `${MIRROR_LABEL} ${k} → "${mirror[k]}"`),
    ];
    expect(strays, `bucket values outside EsignBucket: ${strays.join(", ")}`).toEqual([]);
  });
});

/**
 * Requirement 6, criterion 8 — the Build_Check.
 *
 * `STATUS_COLORS` is spread from the mirror rather than hand-listed, so its keys
 * are not literal in the page's source. The page's literal is therefore parsed for
 * its SPREAD SOURCES and its own explicit keys, and each spread source is resolved
 * against the mirror module's real exports (importable here — same build, `@`
 * alias applies). An unresolvable spread fails rather than passing quietly.
 */
describe("STATUS_COLORS resolves a colour for every status and every bucket", () => {
  const pageSrc = read(PAGE, PAGE_LABEL);
  const body = objectLiteralBody(pageSrc, "STATUS_COLORS", PAGE_LABEL);

  /** Mirror exports a `STATUS_COLORS` spread is allowed to name. */
  const resolvableSpreads: Record<string, Readonly<Record<string, string>>> = {
    ESIGN_STATE_COLORS,
    ESIGN_BUCKET_COLORS,
  };

  const spreadNames = [...body.matchAll(/\.\.\.\s*([A-Za-z_$][\w$]*)/g)].map((m) => m[1]);
  const explicitKeys = new Map(stringEntries(body));

  it("derives its vocabulary from the mirror of Esign_State_Authority (6.7)", () => {
    expect(
      spreadNames,
      `${PAGE_LABEL} STATUS_COLORS no longer spreads ESIGN_STATE_COLORS. Criterion 6.7 ` +
        `requires the page's status vocabulary to come from the mirror of ` +
        `Esign_State_Authority, not from a list maintained on the page.`,
    ).toContain("ESIGN_STATE_COLORS");
  });

  it("spreads only sources this contract can resolve", () => {
    const unknown = spreadNames.filter((n) => !(n in resolvableSpreads));
    expect(
      unknown,
      `${PAGE_LABEL} STATUS_COLORS spreads ${unknown.join(", ")}, which this contract ` +
        `cannot resolve — coverage below would pass without checking those keys. Export ` +
        `the source from ${MIRROR_LABEL} and add it to resolvableSpreads in this test.`,
    ).toEqual([]);
  });

  const resolved = new Map<string, string>();
  for (const name of spreadNames) {
    for (const [key, value] of Object.entries(resolvableSpreads[name] ?? {})) {
      resolved.set(key, value);
    }
  }
  // Explicit keys are written after the spreads in the literal, so they win.
  for (const [key, value] of explicitKeys) resolved.set(key, value);

  it("covers every status in Esign_State_Authority", () => {
    const unclassified = authorityKeys.filter((k) => {
      const colour = resolved.get(k);
      return colour === undefined || colour.trim() === "";
    });

    expect(
      unclassified,
      `these statuses exist in ${AUTHORITY_LABEL} but resolve to NO chip colour in ` +
        `${PAGE_LABEL} STATUS_COLORS: ${unclassified.join(", ")}. A document in one of ` +
        `those states renders with no status styling at all. Classify each one — a ` +
        `bucket default in ESIGN_BUCKET_COLORS is enough — in ${MIRROR_LABEL}.`,
    ).toEqual([]);
  });

  it("covers every bucket", () => {
    const uncoloured = ["completed", "in_progress", "not_started"].filter((bucket) => {
      const colour = ESIGN_BUCKET_COLORS[bucket as keyof typeof ESIGN_BUCKET_COLORS];
      return typeof colour !== "string" || colour.trim() === "";
    });
    expect(
      uncoloured,
      `ESIGN_BUCKET_COLORS in ${MIRROR_LABEL} has no colour for: ${uncoloured.join(", ")}. ` +
        `Every status in that bucket falls back to it, so the gap is not local to one status.`,
    ).toEqual([]);
  });

  it("resolves each status through the mirror to the colour the page renders", () => {
    // The page's fallback is `STATUS_COLORS[value] ?? esignStatusColor(value)`.
    // Where STATUS_COLORS does carry a status, the two paths must agree, or the
    // chip colour depends on which branch happened to run.
    const conflicts = authorityKeys
      .filter((k) => resolved.has(k) && resolved.get(k) !== esignStatusColor(k))
      .map((k) => `${k}: STATUS_COLORS gives "${resolved.get(k)}", esignStatusColor gives "${esignStatusColor(k)}"`);

    expect(
      conflicts,
      `STATUS_COLORS and the mirror's esignStatusColor() disagree, so the same status ` +
        `renders differently depending on which lookup answers first:\n  ${conflicts.join("\n  ")}`,
    ).toEqual([]);
  });
});
