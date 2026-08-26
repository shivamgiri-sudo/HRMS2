import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The candidate-detail BGV section reported its statuses as plain text ("Given",
 * "not_started") while the eSign row beside it already used a coloured pill, so
 * a reviewer had to read every row to find the one that was not in order.
 *
 * The section now uses chips. The risk worth guarding is not that a chip renders
 * -- that is visible on the page -- but that its colour drifts from the BGV
 * Review tab's statusCls in this same file. Two views of one candidate that
 * disagree about what green means are worse than no colour at all.
 */
const PAGE = readFileSync(
  resolve(process.cwd(), "..", "src", "pages", "NativeHROnboardingRequests.tsx"),
  "utf8",
);

describe("Onboarding detail — BGV chip colour semantics", () => {
  it("agrees with the BGV Review tab's statusCls on every shared status", () => {
    const tone = (status: string): string | null => {
      const fn = PAGE.slice(PAGE.indexOf("function toneForStatus"), PAGE.indexOf("function prettyStatus"));
      const rows = [...fn.matchAll(/if \(\[([^\]]+)\]\.includes\(v\)\) return '(\w+)'/g)];
      for (const [, list, t] of rows) {
        if (list.split(",").map((x) => x.trim().replace(/'/g, "")).includes(status)) return t;
      }
      return null;
    };
    // statusCls: verified -> emerald, failed/mismatch -> red, manual_review ->
    // amber, waived -> purple.
    expect(tone("verified")).toBe("good");
    expect(tone("failed")).toBe("bad");
    expect(tone("mismatch")).toBe("bad");
    expect(tone("manual_review")).toBe("warn");
    expect(tone("waived")).toBe("info");
  });

  it("maps good to emerald, bad to red, warn to amber and waived to purple", () => {
    const tones = PAGE.slice(PAGE.indexOf("const CHIP_TONES"), PAGE.indexOf("type ChipTone"));
    expect(tones).toMatch(/good:\s*'bg-emerald-/);
    expect(tones).toMatch(/bad:\s*'bg-red-/);
    expect(tones).toMatch(/warn:\s*'bg-amber-/);
    expect(tones).toMatch(/info:\s*'bg-purple-/);
  });

  it("leaves an unknown status neutral rather than guessing a verdict", () => {
    const fn = PAGE.slice(PAGE.indexOf("function toneForStatus"), PAGE.indexOf("function prettyStatus"));
    // The final statement, after every known-status branch, must be the neutral
    // fallback -- not a guess at good or bad.
    const returns = [...fn.matchAll(/return '(\w+)'/g)].map((m) => m[1]);
    expect(returns[returns.length - 1]).toBe("neutral");
  });

  it("does not colour DigiLocker Provider, which is an identity and not a verdict", () => {
    // Anchor on the chip row specifically: an unrelated "BGV Consent" InfoRow
    // also exists in section 1, and matching that one tests nothing.
    const at = PAGE.indexOf('<InfoRowChip label="BGV Consent"');
    expect(at).toBeGreaterThan(-1);
    const section = PAGE.slice(at, at + 700);
    expect(section).toMatch(/<InfoRow label="DigiLocker Provider"/);
    expect(section).not.toMatch(/<InfoRowChip label="DigiLocker Provider"/);
  });
});
