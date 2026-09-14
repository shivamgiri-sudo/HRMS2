import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

/**
 * Two implementations of the same five endpoints, one of them unreachable.
 *
 * finance-expense-master.routes.ts exports a router for GET /expense-masters, POST
 * /expense-heads, POST /expense-sub-heads and the two DELETEs — and nothing imports it. The live
 * copies are inline in finance/grn.routes.ts, which is mounted at /api/finance.
 *
 * The guards are equivalent today, so this is a maintenance trap rather than a security one: the
 * standalone file is the one someone would naturally find when hardening expense-master access,
 * and a change there cannot take effect. These tests keep that true and visible.
 *
 * They are deliberately not a deletion. If the dead router is ever mounted on purpose, the third
 * test fails and forces the inline copies to be retired in the same change — otherwise both
 * answer the same paths and Express silently serves whichever registered first.
 */

const modulesDir = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(modulesDir, rel), "utf8");

const DEAD = "process-pnl/finance-expense-master.routes.ts";
const LIVE = "finance/grn.routes.ts";

/** Every .ts under modules/, so "nothing imports it" is a fact rather than an assumption. */
function allSources(dir = modulesDir): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return allSources(full);
    return entry.name.endsWith(".ts") ? [full] : [];
  });
}

describe("the duplicate expense-master router", () => {
  it("is still unmounted — nothing imports it", () => {
    const importers = allSources()
      .filter((f) => !f.endsWith("finance-expense-master.routes.ts"))
      .filter((f) => !f.includes("__tests__"))
      .filter((f) => /financeExpenseMasterRouter|finance-expense-master\.routes/.test(fs.readFileSync(f, "utf8")))
      .map((f) => f.replace(modulesDir, "modules"));
    expect(
      importers,
      "if this router is now mounted, retire the inline copies in grn.routes.ts in the same "
        + "change — two routers answering the same paths means Express serves whichever "
        + "registered first, and the other becomes silently dead in its turn"
    ).toEqual([]);
  });

  it("says so at the top of the file, where someone editing it will look", () => {
    expect(read(DEAD).slice(0, 400)).toContain("NOT MOUNTED");
  });

  it("the live copies still exist where the comment sends people", () => {
    // If grn.routes.ts ever stops serving these, the comment becomes a wrong signpost.
    const live = read(LIVE);
    for (const route of [
      '"/expense-masters"', '"/expense-heads"', '"/expense-sub-heads"',
      '"/expense-heads/:id"', '"/expense-sub-heads/:id"',
    ]) {
      expect(live, `${route} must still be served from grn.routes.ts`).toContain(route);
    }
  });

  it("both copies still agree on who may write and who may edit", () => {
    // The guards are equivalent today. If they diverge, the dead file stops being a harmless
    // duplicate and becomes a misleading record of what the rules are.
    const dead = read(DEAD);
    const live = read(LIVE);
    expect(dead).toContain('const WRITE_ROLES = ["super_admin", "finance_head"] as const');
    expect(live).toContain('const EXPENSE_MASTER_WRITE_ROLES: RoleKey[] = ["super_admin", "finance_head"]');
    expect(dead).toContain('const EDIT_ROLES = ["super_admin"] as const');
    expect(live).toContain('const EXPENSE_MASTER_EDIT_ROLES: RoleKey[] = ["super_admin"]');
  });
});
