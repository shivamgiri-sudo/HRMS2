import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, "../../../..");

function read(relativePath: string) {
  return fs.readFileSync(path.join(backendRoot, relativePath), "utf8");
}
/** Comments discuss `throw new Error(...)` by name; only real code counts. */
function stripComments(source: string) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

const SERVICES = [
  "branch-budget.service.ts",
  "branch-budget-allocation.service.ts",
  "budget-coverage.service.ts",
  "budget-consumption.service.ts",
  "budget-topup.service.ts",
];

/**
 * errorHandler.ts forwards `error.message` only when the error carries a `statusCode`. A bare
 * `throw new Error(...)` is classified as an unexpected 500 and, in production, has its message
 * replaced with "An unexpected server error occurred. Please quote reference <hex>...".
 *
 * Every business rule in the budget services was thrown bare — 144 of them — so wrong-stage,
 * maker-checker, locked-period, missing-reason and exhausted-budget refusals all reached users as
 * an anonymous reference id.
 */
describe("budget refusals reach the user", () => {
  it.each(SERVICES)("%s throws no bare Error", (file) => {
    const code = stripComments(read(`src/modules/process-pnl/${file}`));
    const bare = code.match(/throw new Error\(/g) ?? [];
    expect(bare, `${file} has ${bare.length} bare throw(s); each would be masked in production`)
      .toHaveLength(0);
  });

  it.each(SERVICES)("%s routes its refusals through the shared helper", (file) => {
    const source = read(`src/modules/process-pnl/${file}`);
    expect(source).toContain('from "./finance-error.js"');
    expect(source).toMatch(/throw refuse\(\d{3}, "[A-Z_]+",/);
  });

  it("the helper sets both fields errorHandler.ts reads", () => {
    const helper = read("src/modules/process-pnl/finance-error.ts");
    expect(helper).toContain("statusCode: status");
    expect(helper).toContain("code");
    // One definition, not five.
    const copies = SERVICES.filter((f) =>
      /function refuse\(status: number/.test(read(`src/modules/process-pnl/${f}`))
    );
    expect(copies, "refuse must be defined once, in finance-error.ts").toHaveLength(0);
  });

  it("uses only statuses errorHandler.ts forwards verbatim", () => {
    const seen = new Set<string>();
    for (const file of SERVICES) {
      for (const m of read(`src/modules/process-pnl/${file}`).matchAll(/throw refuse\((\d{3}),/g)) {
        seen.add(m[1]);
      }
    }
    expect(seen.size).toBeGreaterThan(0);
    // 4xx is forwarded with its message; a 5xx here would defeat the point of the sweep.
    for (const status of seen) {
      expect(Number(status), `refuse(${status}) must be a 4xx`).toBeGreaterThanOrEqual(400);
      expect(Number(status), `refuse(${status}) must be a 4xx`).toBeLessThan(500);
    }
  });

  /**
   * BudgetLinkedGrnForm offers its "Request a budget increase" shortcut only when the error
   * message matches /exceeds (the )?available budget/i. While that message was masked the regex
   * could never match, so the shortcut — and the deep-link that is the only reason
   * BudgetTopupPanel accepts a preset line id — never appeared for anyone.
   */
  it("the GRN over-budget message still matches the shortcut the GRN form keys on", () => {
    const consumption = read("src/modules/process-pnl/budget-consumption.service.ts");
    const form = fs.readFileSync(
      path.resolve(backendRoot, "../src/components/finance/grn/BudgetLinkedGrnForm.tsx"),
      "utf8"
    );
    const detector = form.match(/\/exceeds \(the \)\?available budget\/i/);
    expect(detector, "the GRN form's over-budget detector moved; re-check the message below").toBeTruthy();

    const messages = [...consumption.matchAll(/throw refuse\(\d{3}, "GRN_EXCEEDS_BUDGET_\w+",\s*([\s\S]{0,120}?)\);/g)]
      .map((m) => m[1]);
    expect(messages.length).toBe(2);
    for (const message of messages) {
      expect(message, "must still satisfy /exceeds (the )?available budget/i")
        .toMatch(/exceeds (the )?available budget/i);
    }
    // And it must now actually be delivered rather than masked.
    expect(consumption).toContain('throw refuse(409, "GRN_EXCEEDS_BUDGET_AMOUNT"');
  });

  it("maker-checker and locked-period refusals are 409, not 500", () => {
    const all = SERVICES.map((f) => read(`src/modules/process-pnl/${f}`)).join("\n");
    for (const code of ["MAKER_CHECKER", "FINANCE_PERIOD_LOCKED"]) {
      const hits = [...all.matchAll(new RegExp(`throw refuse\\((\\d{3}), "[A-Z_]*${code}[A-Z_]*"`, "g"))];
      expect(hits.length, `${code} must be thrown somewhere`).toBeGreaterThan(0);
      for (const hit of hits) expect(hit[1]).toBe("409");
    }
  });
});
