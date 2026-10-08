/**
 * CL and ML share ONE yearly allowance, and the cap is the pool's — not each bucket's.
 *
 * Owner ruling 2026-09-05: the combined CL+ML entitlement is 12 days a year. That is exactly
 * CL's 7 plus ML's 5, so the per-type numbers are the notional split rather than two separate
 * ceilings.
 *
 * WHAT WAS WRONG. The cap was enforced against the requested type's own usage, with a comment
 * saying pooling covers a balance shortfall but not the annual cap. So MAS48651 — 7 CL used,
 * 1 ML used, 8 of his 12 — had a one-day CL request refused as "would exceed the annual limit
 * of 7 day(s) for CL", while four days of his own allowance sat unused in the other bucket.
 *
 * A second defect made it reachable at all. His CL was ALLOCATED 8 against a cap of 7, so the
 * balance screen showed 1 CL day available; there was no shortfall for pooling to notice, and
 * the cap check simply refused it. 784 employees carry an allocation above their cap (382 CL,
 * 402 ML), 14 of them with days shown available that the old rule could never let them take.
 *
 * Source-level, matching this module's convention: the behaviour needs a live ledger, two
 * seeded balance rows and a transaction, and what must hold is the SHAPE of the rule — cap
 * before allocation, pool totals rather than per-bucket ones.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.resolve(DIR, "..", "leave.service.ts"), "utf8");

/** The balance/cap block inside reviewRequest. */
function capBlock(): string {
  const start = src.indexOf("const partner: BalanceSnapshot | null = partnerTypeId");
  expect(start, "pooled balance block not found").toBeGreaterThan(-1);
  return src.slice(start, start + 3000);
}

describe("the cap is the pool's", () => {
  it("adds the partner's cap to the requested type's", () => {
    // 7 + 5 = 12, derived from the masters. Hard-coding 12 would silently diverge the moment
    // either cap is edited in leave_type_master.
    expect(capBlock()).toContain("maxDaysPerYear + partnerMaxDaysPerYear");
    expect(capBlock()).not.toMatch(/=== 12|== 12|: 12\b/);
  });

  it("counts usage across both buckets", () => {
    // The whole defect: 7 CL used was measured against CL's 7 alone, ignoring that only 8 of
    // the pooled 12 had been consumed.
    expect(capBlock()).toContain("primary.usedDays + partner!.usedDays");
  });

  it("reads the partner's cap from the same row as its id", () => {
    // Two lookups could disagree — a cap read for one type and a balance for another is how a
    // pool silently enforces the wrong ceiling.
    expect(src).toContain("COALESCE(max_days_per_year, 0) AS cap FROM leave_type_master WHERE id = ?");
  });

  it("leaves an unpooled type on its own cap", () => {
    // EL has no partner. Its behaviour must be exactly what it was.
    expect(capBlock()).toMatch(/pooled \? maxDaysPerYear \+ partnerMaxDaysPerYear : maxDaysPerYear/);
    expect(capBlock()).toMatch(/pooled \? primary\.usedDays \+ partner!\.usedDays : primary\.usedDays/);
  });
});

describe("the cap is checked before the buckets are chosen", () => {
  it("refuses on the pool total, not on which bucket happens to be empty", () => {
    /*
     * Order matters. The old code picked fromPrimary first — grabbing the phantom day that
     * pushed usage past the per-type cap — and only then checked, so it refused a request the
     * pool could afford. The cap decides how much may be drawn at all; only then does it
     * matter which bucket supplies it.
     */
    const block = capBlock();
    expect(block.indexOf("usedTotal + daysNeeded > capTotal"))
      .toBeLessThan(block.indexOf("const fromPrimary ="));
  });

  it("still overflows to the partner once the cap allows it", () => {
    // The point of the pool: a CL request with CL exhausted but pool headroom left comes out
    // of ML rather than being refused.
    const block = capBlock();
    const idx = block.indexOf("if (remainder > 0 && pooled)");
    expect(idx).toBeGreaterThan(-1);
    expect(block.slice(idx, idx + 200)).toContain("partner!.available");
  });

  it("never invents credit from a partner with no ledger row", () => {
    // Permissiveness for a missing row applies only to the type actually requested — an
    // administrative gap. Extending it to the partner would hand out leave never allocated.
    const block = capBlock();
    const idx = block.indexOf("fromPartner = partner!.exists");
    expect(idx).toBeGreaterThan(-1);
    expect(block.slice(idx, idx + 120)).toContain(": 0");
  });
});

describe("the refusal explains itself", () => {
  it("names the combined scope rather than one code", () => {
    // "exceeds the annual limit of 7 for CL" sent people looking at the wrong bucket while
    // their remaining days sat in the other one.
    expect(capBlock()).toMatch(/\$\{leaveCode\}\+\$\{partnerCode\} combined/);
  });

  it("shows the split, so the reader can see where the days went", () => {
    expect(capBlock()).toMatch(/\$\{primary\.usedDays\} \$\{leaveCode\} \+ \$\{partner!\.usedDays\} \$\{partnerCode\}/);
  });

  it("states what was asked for alongside what was used", () => {
    expect(capBlock()).toContain("requested: ${daysNeeded}");
  });
});
