import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Source-inspection contract for the shared employee-creation orchestrator: the single-LOB
 * default must (1) run after the employees INSERT, on the same transaction connection,
 * (2) be non-blocking, and (3) resolve through applySingleMappedLob (behaviour of that helper
 * is covered in wfm/__tests__/process-lob-map.service.test.ts).
 */
const src = readFileSync(resolve(__dirname, "../employee-creation-orchestrator.service.ts"), "utf8");

describe("orchestrator single-LOB default", () => {
  it("imports and calls applySingleMappedLob with the transaction connection and resolved process", () => {
    expect(src).toContain('import { applySingleMappedLob } from "../wfm/process-lob-map.service.js"');
    expect(src).toContain("applySingleMappedLob(conn, employeeId, resolvedProcessId)");
  });

  it("runs after INSERT INTO employees and never blocks creation", () => {
    const insertAt = src.indexOf("INSERT INTO employees\n");
    const callAt = src.indexOf("applySingleMappedLob(conn");
    expect(insertAt).toBeGreaterThan(-1);
    expect(callAt).toBeGreaterThan(insertAt);
    const block = src.slice(callAt - 40, callAt + 260);
    expect(block).toMatch(/try\s*\{[\s\S]*catch/);
  });

  it("does not add lob_id to the INSERT column list", () => {
    const insert = src.slice(src.indexOf("INSERT INTO employees\n"), src.indexOf("VALUES (?, ?, ?, ?, ?, ?, NULL"));
    expect(insert).not.toMatch(/\blob_id\b/);
  });
});
