import { describe, expect, it, vi } from "vitest";
import { listDecisions, logDecision } from "../roster-requests.decision-log.js";

const mk = (rows: any[] = []) => ({ execute: vi.fn(async () => [rows, []] as any) });

describe("decision log", () => {
  it("inserts with ordered params and JSON-encodes before/after", async () => {
    const exec = mk();
    await logDecision(
      { kind: "swap", sourceId: "s1", action: "approve", actorUserId: "u1", auto: true, reason: "ok", before: { a: 1 }, after: { a: 2 } },
      exec as any,
    );
    const [sql, params] = exec.execute.mock.calls[0] as any;
    expect(sql).toContain("INSERT INTO roster_request_decision_log");
    expect(params).toEqual(["swap", "s1", "approve", "u1", 1, "ok", '{"a":1}', '{"a":2}']);
  });
  it("defaults optional fields to null/0", async () => {
    const exec = mk();
    await logDecision({ kind: "dispute", sourceId: "d1", action: "reject" }, exec as any);
    expect((exec.execute.mock.calls[0] as any)[1]).toEqual(["dispute", "d1", "reject", null, 0, null, null, null]);
  });
  it("propagates errors", async () => {
    const exec = { execute: vi.fn(async () => { throw new Error("boom"); }) };
    await expect(logDecision({ kind: "swap", sourceId: "s", action: "a" }, exec as any)).rejects.toThrow("boom");
  });
  it("lists by kind and source", async () => {
    const exec = mk([{ id: "1" }]);
    expect(await listDecisions("swap", "s1", exec as any)).toEqual([{ id: "1" }]);
    expect((exec.execute.mock.calls[0] as any)[1]).toEqual(["swap", "s1"]);
  });
});
