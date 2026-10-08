import { describe, it, expect, vi } from "vitest";
import { isFormerReport } from "../rehireAccess.js";

const db = (n: number) => ({ execute: vi.fn(async () => [[{ is_manager: n }], []]) });

describe("isFormerReport", () => {
  it("is true when the caller is the employee's reporting manager", async () => {
    expect(await isFormerReport(db(1) as never, "e1", "u1")).toBe(true);
  });
  it("is false when they are not", async () => {
    expect(await isFormerReport(db(0) as never, "e1", "u1")).toBe(false);
  });
  it("binds the employee id then the user id", async () => {
    const d = db(1);
    await isFormerReport(d as never, "e1", "u1");
    expect(d.execute.mock.calls[0]![1]).toEqual(["e1", "u1"]);
    expect(String(d.execute.mock.calls[0]![0])).toContain("reporting_manager_id");
  });
});
