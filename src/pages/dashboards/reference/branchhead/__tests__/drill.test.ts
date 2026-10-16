import { describe, expect, it } from "vitest";
import { joinByProcessName, normalizeProcessName, processTarget } from "../drill";
import { procRow } from "./fixtures";

const rows = [
  procRow({ processId: "a", processName: "Alpha Voice" }),
  procRow({ processId: "b", processName: "  Beta   Chat " }),
];

describe("joinByProcessName", () => {
  it("normalises case, outer and inner spaces", () => {
    expect(normalizeProcessName("  Beta \t  CHAT ")).toBe("beta chat");
    expect(joinByProcessName("alpha voice", rows)?.processId).toBe("a");
    expect(joinByProcessName("ALPHA  VOICE ", rows)?.processId).toBe("a");
    expect(joinByProcessName("Beta Chat", rows)?.processId).toBe("b");
  });
  it("returns null for a missing or blank name", () => {
    expect(joinByProcessName("Gamma", rows)).toBeNull();
    expect(joinByProcessName("", rows)).toBeNull();
    expect(joinByProcessName("   ", [procRow({ processName: " " })])).toBeNull();
    expect(joinByProcessName("Alpha Voice", [])).toBeNull();
  });
  it("processTarget gives a process target on a match, else the fallback metric", () => {
    expect(processTarget("alpha voice", rows, "headcount")).toEqual({ kind: "process", id: "a", name: "Alpha Voice" });
    expect(processTarget("Nope", rows, "pnl")).toEqual({ kind: "metric", id: "pnl" });
  });
});
