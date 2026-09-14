import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Cost Centre code shown with the Process (Requirement 18).
 *
 * Two properties are load-bearing, and both are about NOT breaking something:
 *
 *   1. process_master.process_name is never mutated. The requirement asks for the code to be
 *      visible alongside the process, and the tempting shortcut — writing "Onfido — CC001" into
 *      the name — would corrupt the master that payroll, roster, KPI and billing all join on.
 *      The label is derived on read, every time.
 *   2. The relationship runs cost centre → process, so a process has MANY cost centres. Anything
 *      assuming one would silently drop the second code.
 *
 * Verified against production on 2026-08-07: 927 cost centres, of which 24 carry a process_id
 * and 21 resolve to an active mapping — so 110 of 131 processes have no cost centre at all, and
 * exactly one process (BTM Ventures) carries two codes. client_id is empty on all 927 rows,
 * which is why process_id is the only link used: there is nothing else to derive from.
 */

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));

let processService: typeof import("../org.service.js")["processService"];
beforeAll(async () => {
  ({ processService } = await import("../org.service.js"));
}, 120_000);

beforeEach(() => execute.mockReset());

/** Captures the SQL the list actually issues. */
function captureSql() {
  const seen: string[] = [];
  execute.mockImplementation(async (sql: string) => {
    seen.push(String(sql).replace(/\s+/g, " ").trim());
    return [[], []];
  });
  return seen;
}

describe("processService.list", () => {
  it("resolves cost centre codes from cost_centre_master.process_id", async () => {
    const seen = captureSql();
    await processService.list({});
    const sql = seen.find((s) => /FROM process_master/.test(s)) ?? "";
    expect(sql).toContain("cost_centre_codes");
    expect(sql).toContain("FROM cost_centre_master cc");
    expect(sql).toContain("WHERE cc.process_id = pm.id");
  });

  it("returns every mapped code, not just the first", async () => {
    // One process really does carry two codes today. A subquery without GROUP_CONCAT, or one
    // with a LIMIT, would silently show half the mapping.
    const seen = captureSql();
    await processService.list({});
    const sql = seen.find((s) => /FROM process_master/.test(s)) ?? "";
    expect(sql).toMatch(/GROUP_CONCAT\(cc\.cost_centre_code ORDER BY cc\.cost_centre_code SEPARATOR ','\)/);
  });

  it("counts only active cost centres", async () => {
    // A retired cost centre still points at its process; showing it would misrepresent the
    // current mapping.
    const seen = captureSql();
    await processService.list({});
    const sql = seen.find((s) => /FROM process_master/.test(s)) ?? "";
    expect(sql).toContain("cc.active_status = 1");
  });

  it("passes the derived codes straight through without touching process_name", async () => {
    execute.mockResolvedValue([
      [
        { id: "p1", process_name: "BTM Ventures", cost_centre_codes: "BSS/FLD/NOIDA-2/1029,BSS/OB/NOIDA-2/972" },
        { id: "p2", process_name: "Unmapped Process", cost_centre_codes: null },
      ],
      [],
    ]);
    const rows = (await processService.list({})) as Record<string, unknown>[];
    expect(rows[0].process_name).toBe("BTM Ventures");
    expect(rows[0].cost_centre_codes).toBe("BSS/FLD/NOIDA-2/1029,BSS/OB/NOIDA-2/972");
    // An unmapped process must stay NULL rather than become "" or "—": the UI distinguishes
    // "no cost centre points here" from "one does, and it is blank".
    expect(rows[1].cost_centre_codes).toBeNull();
  });

  it("never writes to process_master while listing", async () => {
    const seen = captureSql();
    await processService.list({});
    for (const sql of seen) {
      expect(sql).not.toMatch(/^\s*(UPDATE|INSERT|DELETE)/i);
    }
  });
});

describe("the label is derived, never stored", () => {
  it("no create or update path concatenates a code into process_name", async () => {
    const { readFileSync } = await import("fs");
    const src = readFileSync(
      new URL("../org.service.ts", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"),
      "utf8",
    );
    // process_name is written by create/update from the caller's value alone. Any interpolation
    // of a cost centre code into it would corrupt the master for every joiner.
    expect(src).not.toMatch(/process_name\s*[:=]\s*[`"'][^`"']*\$\{[^}]*cost_centre/i);
    expect(src).not.toMatch(/cost_centre_code[^\n]*\+[^\n]*process_name/i);
  });
});
