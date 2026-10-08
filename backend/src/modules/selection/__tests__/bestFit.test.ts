import { describe, expect, it } from "vitest";
import { pickBestRequisition, type FitCandidate } from "../best-fit.js";
import type { Evaluation, Verdict } from "../selection-types.js";

const ev = (verdict: Verdict, score: number, failed: string[] = []): Evaluation => ({
  verdict, score, systemBlock: null, passed: [], unknown: [], reviewReasons: verdict === "review" ? ["Night shift: unknown"] : [],
  failed: failed.map((k) => ({ key: k, label: k, outcome: "fail", actualText: "no", requiredText: "yes", mode: "must", effect: "fail" })),
  criteriaHash: "h", versionId: null, engineVersion: 1, factsHash: "f",
});
const c = (requisitionId: string, e: Evaluation, seatsLeft = 10): FitCandidate => ({ requisitionId, e, seatsLeft });

describe("best-fit requisition (WS3 B1/D1: one engine, pass > review > fail)", () => {
  it("pass beats review whatever the score", () => {
    const r = pickBestRequisition([c("night", ev("review", 90)), c("day", ev("pass", 40))]);
    expect(r.requisitionId).toBe("day");
    expect(r.verdict).toBe("pass");
    expect(r.alternatives.map((a) => a.requisitionId)).toEqual(["night"]);
  });

  it("same verdict: higher score, then more seats left, then input order (primary first)", () => {
    expect(pickBestRequisition([c("a", ev("pass", 60)), c("b", ev("pass", 70))]).requisitionId).toBe("b");
    expect(pickBestRequisition([c("a", ev("pass", 70), 1), c("b", ev("pass", 70), 25)]).requisitionId).toBe("b");
    expect(pickBestRequisition([c("a", ev("pass", 70), 5), c("b", ev("pass", 70), 5)]).requisitionId).toBe("a");
  });

  it("nothing fits: hold (no pick) with every candidate's reasons", () => {
    const r = pickBestRequisition([c("night", ev("fail", 80, ["night_shift"])), c("ahm", ev("fail", 70, ["location_region"]))]);
    expect(r.requisitionId).toBeNull();
    expect(r.verdict).toBe("fail");
    expect(r.alternatives.map((a) => [a.requisitionId, a.reasons[0]])).toEqual([["night", "night_shift: no (needs yes)"], ["ahm", "location_region: no (needs yes)"]]);
  });

  it("an HR include override counts as pass; an exclude as fail", () => {
    const inc = { ...ev("fail", 50, ["age"]), override: { kind: "include" as const, reason: "known", actorId: "u", at: "t" } };
    const exc = { ...ev("pass", 90), override: { kind: "exclude" as const, reason: "no", actorId: "u", at: "t" } };
    expect(pickBestRequisition([c("x", exc), c("y", inc)]).requisitionId).toBe("y");
  });

  it("empty list: no pick", () => {
    expect(pickBestRequisition([])).toEqual({ requisitionId: null, verdict: null, score: 0, alternatives: [] });
  });
});
