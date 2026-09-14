import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * excludeEmployeeShapedCandidatesSql(alias) must be passed the alias the enclosing query
 * actually uses for ats_candidate.
 *
 * This is not a style rule. The helper interpolates the argument into a column reference, so a
 * mismatch is a guaranteed ER_BAD_FIELD_ERROR at runtime — MySQL rejects the original table
 * name once an alias exists.
 *
 * It has already happened. listCandidates was given the literal "ats_candidate" while its query
 * is `FROM ats_candidate c`, and every candidate list 500'd until it was corrected in 764579b1.
 * The tests covering that change asserted only that the helper was CALLED, which source
 * inspection can confirm while the SQL it produces is invalid.
 *
 * Scoping to the ENCLOSING FUNCTION matters. A first version of this check looked backwards a
 * fixed number of characters and flagged getFunnel in ats-ext.service.ts, whose query is
 * `FROM ats_candidate` with no alias at all — the "c2" it matched belonged to an unrelated
 * query earlier in the file. A detector that cries wolf on correct code gets muted.
 */

const BACKEND_SRC = join(process.cwd(), "src");

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      if (entry !== "__tests__") sourceFiles(p, out);
    } else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
}

/** Split a file into function-ish regions, so a lookup cannot cross into a neighbouring query. */
function enclosingRegion(src: string, index: number): string {
  const starts = [...src.matchAll(/^\s*(?:export\s+)?(?:async\s+)?(?:function\s+\w+|\w+\s*[:(])/gm)]
    .map((m) => m.index!)
    .filter((i) => i <= index);
  const ends = [...src.matchAll(/^\s*(?:export\s+)?(?:async\s+)?(?:function\s+\w+|\w+\s*[:(])/gm)]
    .map((m) => m.index!)
    .filter((i) => i > index);
  return src.slice(starts.length ? starts[starts.length - 1] : 0, ends.length ? ends[0] : src.length);
}

interface Site { file: string; line: number; arg: string; alias: string }

function callSites(): Site[] {
  const sites: Site[] = [];
  for (const file of sourceFiles(BACKEND_SRC)) {
    const src = readFileSync(file, "utf8");
    if (!src.includes("excludeEmployeeShapedCandidatesSql(")) continue;

    for (const m of src.matchAll(/excludeEmployeeShapedCandidatesSql\(\s*["'`]([^"'`]+)["'`]\s*\)/g)) {
      const region = enclosingRegion(src, m.index!);
      const decl = [...region.matchAll(/\b(?:FROM|JOIN)\s+ats_candidate\b(?:\s+(?:AS\s+)?([a-zA-Z_]\w*))?/gi)];
      if (!decl.length) continue; // module-level constant; validated where it is used

      // If the function queries ats_candidate under several names, any of them is acceptable —
      // the fragment may legitimately target a different one.
      const aliases = new Set(
        decl.map((d) => {
          const a = d[1];
          return a && !/^(WHERE|ON|SET|LEFT|INNER|GROUP|ORDER|LIMIT|AND)$/i.test(a) ? a : "ats_candidate";
        }),
      );
      if (aliases.has(m[1])) continue;

      sites.push({
        file: relative(process.cwd(), file),
        line: src.slice(0, m.index).split("\n").length,
        arg: m[1],
        alias: [...aliases].join(" | "),
      });
    }
  }
  return sites;
}

describe("the legacy-row exclusion is passed the alias its query uses", () => {
  it("finds call sites at all — otherwise this suite proves nothing", () => {
    let found = 0;
    for (const file of sourceFiles(BACKEND_SRC)) {
      const src = readFileSync(file, "utf8");
      found += (src.match(/excludeEmployeeShapedCandidatesSql\(/g) ?? []).length;
    }
    expect(found).toBeGreaterThan(10);
  });

  it("every call site names the alias in its own query", () => {
    const bad = callSites();
    expect(
      bad.map((s) => `${s.file}:${s.line} passes "${s.arg}" but its query uses "${s.alias}"`),
      "The helper interpolates this argument into a column reference. A mismatch is an " +
        "ER_BAD_FIELD_ERROR at runtime, not a style problem — MySQL rejects the original table " +
        "name once the query aliases it. This exact mistake 500'd the candidate list.",
    ).toEqual([]);
  });
});
