import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, dirname, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const SRC_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * `hour12: false` is NOT a safe way to ask for a 24-hour clock.
 *
 * On the production runtime (node v20.20.2 / ICU 78.2) it selects the h24 cycle, which
 * renders midnight as hour "24" rather than "00". Every other hour is unaffected, so the
 * bug is invisible for 23 hours a day:
 *
 *     00:41 IST -> "2026-08-06 24:41:04"   <- MySQL rejects this DATETIME outright
 *     12:00 IST -> "2026-08-06 12:00:00"   <- fine
 *
 * That is not theoretical. It was failing live in break-management: every break started
 * between 00:00 and 00:59 IST threw
 *   ER_TRUNCATED_WRONG_VALUE: Incorrect datetime value: '2026-08-06 24:41:04'
 * and the session was never recorded. The same helper shape existed in
 * biometric-punch.routes.ts, which feeds payroll attendance.
 *
 * It also silently corrupted shift-date attribution wherever the code branches on
 * `hour >= 5 ? today : yesterday`: Number("24") is 24, so the midnight hour took the
 * "today" branch while 01:00–04:59 correctly took "yesterday".
 *
 * `hourCycle: "h23"` is the explicit, version-independent way to say 00–23.
 *
 * Note this cannot be caught by asserting the buggy output in a test — newer Node (v24)
 * returns "00" for `hour12: false`, so such a test would pass locally and still ship the
 * bug. The reliable guard is on the source itself.
 */
function tsFilesUnder(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = resolve(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "node_modules" || name === "dist") continue;
      tsFilesUnder(full, acc);
    } else if (name.endsWith(".ts") && !name.endsWith(".d.ts")) {
      acc.push(full);
    }
  }
  return acc;
}

/** Intl options blocks that ask for a numeric hour while relying on `hour12: false`. */
export function unsafeHourCycleBlocks(source: string): number {
  let count = 0;
  for (const m of source.matchAll(/new Intl\.DateTimeFormat\s*\([\s\S]{0,600}?\)/g)) {
    const block = m[0];
    const asksForHour = /\bhour\s*:\s*["']2-digit["']|\bhour\s*:\s*["']numeric["']/.test(block);
    const usesHour12False = /\bhour12\s*:\s*false\b/.test(block);
    const pinsCycle = /\bhourCycle\s*:\s*["']h23["']/.test(block);
    if (asksForHour && usesHour12False && !pinsCycle) count++;
  }
  return count;
}

describe("IST midnight hour", () => {
  it("flags an Intl block that formats an hour using hour12:false", () => {
    const bad = `new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", hour: "2-digit", hour12: false })`;
    expect(unsafeHourCycleBlocks(bad)).toBe(1);
  });

  it("accepts an Intl block that pins hourCycle h23", () => {
    const good = `new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", hour: "2-digit", hourCycle: "h23" })`;
    expect(unsafeHourCycleBlocks(good)).toBe(0);
  });

  it("ignores blocks that do not format an hour at all", () => {
    const dateOnly = `new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", hour12: false })`;
    expect(unsafeHourCycleBlocks(dateOnly)).toBe(0);
  });

  it("renders midnight IST as hour 00, not 24", () => {
    // 2026-08-06 00:41:04 IST == 2026-08-05 19:11:04 UTC
    const midnight = new Date(Date.UTC(2026, 7, 5, 19, 11, 4));
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(midnight);
    const pick = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    expect(pick("hour")).toBe("00");
    expect(Number(pick("hour"))).toBeLessThan(5); // so shift-date logic picks the previous day
  });

  it("no source file formats an hour with hour12:false", () => {
    const offenders: string[] = [];
    const selfPath = fileURLToPath(import.meta.url);
    for (const file of tsFilesUnder(SRC_DIR)) {
      if (file === selfPath) continue; // this file carries the bad pattern as a fixture
      const n = unsafeHourCycleBlocks(readFileSync(file, "utf8"));
      if (n > 0) offenders.push(`${relative(SRC_DIR, file).split(sep).join("/")} (${n})`);
    }
    expect(
      offenders,
      "hour12:false selects the h24 cycle on node 20, so midnight formats as '24:xx' and " +
        "MySQL rejects the DATETIME. Use hourCycle: 'h23'.\n" +
        offenders.map((o) => `  - ${o}`).join("\n")
    ).toEqual([]);
  }, 30_000);
});
