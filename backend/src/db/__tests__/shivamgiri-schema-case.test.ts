import { describe, it, expect, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";

// The call-master shim imports the real source pool; only its pure adaptSql is exercised here.
vi.mock("../sourceDb.js", () => ({ getSourcePool: () => { throw new Error("no DB in this test"); } }));

const SRC_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * The MIS host runs MySQL 8.0.42 on Linux with lower_case_table_names=0, so schema names are
 * case-sensitive: `shivamgiri` and `Shivamgiri` are two different databases. Only the second
 * exists, and the grant is `GRANT ALL PRIVILEGES ON \`Shivamgiri\`.* TO shivam_user@%`.
 *
 * Eleven SQL references spelled it lowercase — six in call-master.service.ts, five in
 * inbound-quality.service.ts — and every one failed with ER_TABLEACCESS_DENIED_ERROR (1142),
 * because MySQL reports a table you have no rights to as "SELECT command denied" rather than
 * "unknown table". That reads as a grant problem and sent the investigation to the DBA twice.
 * The Call Master dashboard swallowed the throw and rendered empty, so for weeks the symptom
 * was a blank page rather than an error.
 *
 * The table those queries named — md_clients — has never existed in any schema visible to
 * shivam_user. Correcting only the case would have swapped 1142 for 1146. The real client
 * master on this host is Shivamgiri.portal_client_config (client_id INT UNSIGNED UNIQUE,
 * display_name), which joins 1:1; process_mapping_master also carries dialdesk_client_id but
 * is 1:many and would multiply every aggregate that joined it.
 */
function tsFilesUnder(dir: string): string[] {
  const out: string[] = [];
  // withFileTypes avoids a statSync syscall per entry — the naive version walked this tree
  // slowly enough on Windows to blow vitest's 30s default timeout.
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "__tests__") continue;
      out.push(...tsFilesUnder(join(dir, entry.name)));
    } else if (entry.name.endsWith(".ts")) {
      out.push(join(dir, entry.name));
    }
  }
  return out;
}

/**
 * Call Master code vendored verbatim from tausifansari-mcn/Mydashboards (c0221e89b). The upstream files are
 * overwritten by scripts/sync-mydashboards.mjs, so their SQL keeps upstream's `shivamgiri.md_clients` spelling and
 * the HRMS shim beside them translates it at query time. The blanket sweeps skip both directories; the
 * "vendored Call Master" block below proves instead that nothing untranslated is reachable from an HRMS route.
 */
const CALL_MASTER_DIR = join(SRC_DIR, "modules", "call-master");
const VENDORED_DIR = join(CALL_MASTER_DIR, "upstream");
const SHIM_DIR = join(CALL_MASTER_DIR, "upstream-shim");
const isVendored = (file: string) => [VENDORED_DIR, SHIM_DIR].some((d) => file.startsWith(d + sep));

/** Walked once — both source sweeps below reuse it. */
const BACKEND_TS_FILES = tsFilesUnder(SRC_DIR).filter((f) => !isVendored(f));

/** Schema-qualified SQL references, ignoring identifiers like shivamgiriDb / shivamgiri_quality. */
export function lowercaseSchemaRefs(source: string): string[] {
  const stripped = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  return [...stripped.matchAll(/\bshivamgiri\.(\w+)/g)].map((m) => m[0]);
}

export function mdClientsRefs(source: string): string[] {
  const stripped = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  return [...stripped.matchAll(/\bmd_clients\b/g)].map((m) => m[0]);
}

describe("Shivamgiri schema references", () => {
  it("flags a lowercase schema-qualified reference", () => {
    expect(lowercaseSchemaRefs("LEFT JOIN shivamgiri.md_clients c ON 1=1")).toEqual([
      "shivamgiri.md_clients",
    ]);
  });

  it("does not flag the pool helper or connector key", () => {
    expect(lowercaseSchemaRefs("getShivamgiriPool(); getPoolForKey('shivamgiri_quality')")).toEqual([]);
  });

  it("does not flag the correctly-cased schema", () => {
    expect(lowercaseSchemaRefs("FROM Shivamgiri.portal_client_config")).toEqual([]);
  });

  it("no backend source references the lowercase schema in SQL", () => {
    const offenders: string[] = [];
    for (const file of BACKEND_TS_FILES) {
      const hits = lowercaseSchemaRefs(readFileSync(file, "utf8"));
      if (hits.length) offenders.push(`${file}: ${hits.join(", ")}`);
    }
    expect(offenders).toEqual([]);
  });

  it("no backend source still reads md_clients, which exists in no visible schema", () => {
    const offenders: string[] = [];
    for (const file of BACKEND_TS_FILES) {
      const hits = mdClientsRefs(readFileSync(file, "utf8"));
      if (hits.length) offenders.push(`${file}: ${hits.length} ref(s)`);
    }
    expect(offenders).toEqual([]);
  });
});

describe("vendored Call Master SQL", async () => {
  const { adaptSql } = await import("../../modules/call-master/upstream-shim/sourceDb.js");
  const adapter = readFileSync(join(CALL_MASTER_DIR, "mydashboards.routes.ts"), "utf8");
  // `import * as svc from "./upstream/call-master.service.js"` -> call-master.service.ts is reached as svc.*
  const aliasOf = new Map(
    [...adapter.matchAll(/import \* as (\w+) from "\.\/upstream\/([\w.-]+)\.js"/g)].map((m) => [`${m[2]}.ts`, m[1]]),
  );

  /** Name of the top-level function enclosing `index`, by the nearest preceding declaration. */
  const enclosingFn = (source: string, index: number) => {
    let name = "<module>";
    for (const m of source.matchAll(/^export (?:async )?function (\w+)/gm)) {
      if (m.index! > index) break;
      name = m[1];
    }
    return name;
  };

  it("the shim rewrites the lowercase md_clients join onto the real client master", () => {
    const out = adaptSql("LEFT JOIN shivamgiri.md_clients c ON c.dialdesk_client_id = d.client_id");
    expect(lowercaseSchemaRefs(out)).toEqual([]);
    expect(mdClientsRefs(out)).toEqual([]);
    expect(out).toContain("FROM Shivamgiri.portal_client_config");
  });

  it("every schema or md_clients reference the shim does not translate sits in a function no HRMS route calls", () => {
    const reachable: string[] = [];
    for (const file of readdirSync(VENDORED_DIR).filter((f) => f.endsWith(".ts"))) {
      const alias = aliasOf.get(file);
      const adapted = adaptSql(readFileSync(join(VENDORED_DIR, file), "utf8"));
      // prisma.md_clients.count is the one prisma call the shim serves (from portal_client_config).
      for (const m of adapted.matchAll(/\bshivamgiri\.\w+|(?:prisma\.)?md_clients(?:\.\w+)?/g)) {
        if (m[0] === "prisma.md_clients.count") continue;
        const fn = enclosingFn(adapted, m.index!);
        // A file the adapter does not import is unreachable; otherwise the enclosing function must not be called.
        if (alias && new RegExp(`\\b${alias}\\.${fn}\\(`).test(adapter)) reachable.push(`${file} ${fn}: ${m[0]}`);
      }
    }
    expect(reachable).toEqual([]);
  });
});
