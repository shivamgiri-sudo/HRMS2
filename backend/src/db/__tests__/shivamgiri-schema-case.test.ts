import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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

/** Walked once — both source sweeps below reuse it. */
const BACKEND_TS_FILES = tsFilesUnder(SRC_DIR);

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
