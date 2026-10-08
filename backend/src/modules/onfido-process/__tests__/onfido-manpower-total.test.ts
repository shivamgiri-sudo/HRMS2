import { describe, expect, it } from "vitest";
import { computeManpower, queuesMissingPlan, totalApprovedAsOf, type ManpowerPlanRow } from "../onfido-overview-report.pure.js";
import { parseManpowerPlanInput } from "../onfido-wfm-inputs.validation.js";

const row = (processQueue: ManpowerPlanRow["processQueue"], effectiveFrom: string, approvedHc: number): ManpowerPlanRow => ({ processQueue, effectiveFrom, approvedHc, activeHc: null });

describe("company-wide TOTAL approved HC", () => {
  it("is used as the floor's approved HC with no per-queue rows", () => {
    const rows = [row("TOTAL", "2026-07-01", 181)];
    expect(totalApprovedAsOf(rows, "2026-08-31")).toBe(181);
    expect(queuesMissingPlan(rows, "2026-08-31")).toEqual([]);
  });

  it("is not in force before its effective date", () => {
    expect(totalApprovedAsOf([row("TOTAL", "2026-07-01", 181)], "2026-06-30")).toBeNull();
  });

  it("wins over a per-queue sum, and the latest TOTAL row wins", () => {
    const rows = [row("EXTRACTION", "2026-07-01", 100), row("POA", "2026-07-01", 50), row("ENCORD", "2026-07-01", 5), row("TOTAL", "2026-07-01", 170), row("TOTAL", "2026-08-01", 181)];
    expect(totalApprovedAsOf(rows, "2026-08-31")).toBe(181);
  });

  it("keeps the old rule without a TOTAL: null until every queue has an entry", () => {
    expect(totalApprovedAsOf([row("EXTRACTION", "2026-07-01", 100)], "2026-08-31")).toBeNull();
    expect(totalApprovedAsOf([row("EXTRACTION", "2026-07-01", 100), row("POA", "2026-07-01", 50), row("ENCORD", "2026-07-01", 5)], "2026-08-31")).toBe(155);
  });

  it("gives Buffer % and Shortfall for 181 approved against 199 active", () => {
    const m = computeManpower(181, 199);
    expect(m.requiredHc).toBe(217.2);
    expect(m.bufferPct).toBe(9.9);
    expect(m.shortfall).toBe(18.2);
  });

  it("accepts TOTAL on the plan input and still rejects unknown queues", () => {
    const ok = parseManpowerPlanInput({ processQueue: "TOTAL", effectiveFrom: "2026-07-01", approvedHc: 181 });
    expect(ok.ok && ok.value.processQueue).toBe("TOTAL");
    expect(ok.ok && ok.value.activeHc).toBeNull();
    expect(parseManpowerPlanInput({ processQueue: "NOPE", effectiveFrom: "2026-07-01", approvedHc: 1 }).ok).toBe(false);
  });
});
