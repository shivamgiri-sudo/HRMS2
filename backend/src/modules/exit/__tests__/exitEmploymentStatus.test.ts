/**
 * An exit must leave a status that says HOW the person left, and the nightly activation job
 * must refuse to reactivate every one of those statuses.
 *
 * The second half is the one with teeth. employee-activation.service.ts runs at 00:01 and
 * GRANTS LOGIN to anyone with active_status = 0 whose employment_status is not in its
 * exclusion list. That list contained 'absconding'. Writing 'absconded' on exit without
 * touching it would mean the job stopped recognising absconded employees and could hand
 * their accounts back the same night — a worse outcome than the original bug.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import {
  employmentStatusForExit,
  NON_REACTIVATABLE_STATUSES,
  TERMINAL_EXIT_STATUSES,
} from "../exitEmploymentStatus.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("employmentStatusForExit", () => {
  it("records an involuntary termination as terminated, not inactive", () => {
    expect(employmentStatusForExit("involuntary", "termination")).toBe("terminated");
    expect(employmentStatusForExit("involuntary", undefined)).toBe("terminated");
  });

  it("records absconding and abandonment as absconded", () => {
    // Same event, two labels. One status keeps downstream filters from needing both.
    expect(employmentStatusForExit("involuntary", "absconding")).toBe("absconded");
    expect(employmentStatusForExit("voluntary", "abandonment")).toBe("absconded");
  });

  it("lets the sub-type win over the type, because it is the more specific fact", () => {
    expect(employmentStatusForExit("voluntary", "absconding")).toBe("absconded");
  });

  it("leaves an ordinary resignation as inactive, preserving today's behaviour", () => {
    expect(employmentStatusForExit("voluntary", "resignation")).toBe("inactive");
    expect(employmentStatusForExit("voluntary", undefined)).toBe("inactive");
    expect(employmentStatusForExit(null, null)).toBe("inactive");
  });

  it("is case and whitespace tolerant", () => {
    expect(employmentStatusForExit("  INVOLUNTARY ", "  Absconding ")).toBe("absconded");
  });
});

describe("the activation guard covers every status an exit can write", () => {
  it("lists all terminal exit statuses as non-reactivatable", () => {
    for (const s of TERMINAL_EXIT_STATUSES) {
      expect(NON_REACTIVATABLE_STATUSES).toContain(s);
    }
  });

  it("keeps the older 'absconding' spelling so rows already carrying it stay guarded", () => {
    expect(NON_REACTIVATABLE_STATUSES).toContain("absconding");
  });

  it("employee-activation.service.ts derives its exclusion list from this module", () => {
    // A hand-maintained copy of the list is exactly how the two drift apart, and the failure
    // mode is silent: the job simply starts reactivating a status it no longer recognises.
    const src = fs.readFileSync(
      path.resolve(__dirname, "..", "..", "employees", "employee-activation.service.ts"),
      "utf8",
    );
    expect(src).toMatch(/nonReactivatableSqlList|NON_REACTIVATABLE_STATUSES/);
    // And it must not still carry the old hardcoded tuple.
    expect(src).not.toMatch(/'resigned',\s*'terminated',\s*'inactive',\s*'exited',\s*'absconding'/);
  });
});
