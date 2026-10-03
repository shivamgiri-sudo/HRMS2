import { describe, expect, it } from "vitest";
import {
  buildTaskTypeRows,
  mergePeriods,
  mergeSampling,
  splitUntraceableDoc,
} from "../onfido-audit-sampling.pure.js";
import {
  buildAnalystAonMap,
  mergePoaInternalBreakdown,
  normaliseAon,
  qualityByAon,
  sortAonRows,
} from "../onfido-poa-breakdown.pure.js";

describe("mergeSampling", () => {
  it("joins tasks and audits on normalised keys and computes sampling/error %", () => {
    const rows = mergeSampling(
      "POA",
      [{ client: "Acme Ltd", documentType: "Utility Bill", taskType: "POA", tasks: 200 }],
      [{ client: " acme ltd ", documentType: "utility bill", taskType: "POA", audits: 20, errors: 2 }],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ client: "Acme Ltd", tasksReceived: 200, audits: 20, samplingPct: 10, errors: 2, errPct: 10 });
  });
  it("keeps an audit-only row with null sampling % and never invents (unknown) when a client exists", () => {
    const rows = mergeSampling("POA", [], [{ client: "Beta", documentType: "", taskType: "POA", audits: 5, errors: 0 }]);
    expect(rows[0].client).toBe("Beta");
    expect(rows[0].documentType).toBe("(unknown)");
    expect(rows[0].samplingPct).toBeNull();
  });
  it("gives 0% sampling and null error % for tasks with no audits", () => {
    const [r] = mergeSampling("DOC", [{ client: "C", documentType: "D", taskType: "T", tasks: 10 }], []);
    expect(r.samplingPct).toBe(0);
    expect(r.errPct).toBeNull();
  });
});

describe("DOC Check task type analysis", () => {
  const rows = mergeSampling(
    "DOC",
    [
      { client: "A", documentType: "D1", taskType: "classification", tasks: 100 },
      { client: "B", documentType: "D2", taskType: "classification", tasks: 50 },
      { client: "A", documentType: "D1", taskType: "extraction", tasks: 40 },
    ],
    [
      { client: "A", documentType: "D1", taskType: "classification", audits: 15, errors: 3 },
      { client: "A", documentType: "D1", taskType: "old_obsolete_type", audits: 4, errors: 1 },
      { client: "A", documentType: "D1", taskType: "", audits: 2, errors: 0 },
    ],
  );
  it("sums per valid source task type and drops obsolete (no tasks) and blank types", () => {
    const t = buildTaskTypeRows(rows);
    expect(t.map((x) => x.taskType)).toEqual(["classification", "extraction"]);
    expect(t[0]).toMatchObject({ tasksReceived: 150, audits: 15, samplingPct: 10, errors: 3, errPct: 20 });
  });
  it("reports audits that cannot be traced to a task type", () => {
    const { kept, droppedAudits } = splitUntraceableDoc(rows);
    expect(droppedAudits).toBe(2);
    expect(kept.every((r) => r.taskType !== "(unknown)")).toBe(true);
  });
});

describe("mergePeriods", () => {
  it("orders by period and computes ratios", () => {
    const p = mergePeriods("POA", [{ period: "2026-09", tasks: 100 }, { period: "2026-08", tasks: 50 }], [{ period: "2026-09", audits: 10, errors: 1 }]);
    expect(p.map((x) => x.period)).toEqual(["2026-08", "2026-09"]);
    expect(p[1]).toMatchObject({ samplingPct: 10, errPct: 10 });
  });
});

describe("POA internal breakdown", () => {
  it("volume-weights AHT and drops quality-only labels", () => {
    const out = mergePoaInternalBreakdown(
      [{ label: "X", n: 10, aht: 100 }, { label: "X", n: 30, aht: 200 }],
      [{ label: "X", errors: 2, noErrors: 8 }, { label: "Ghost", errors: 1, noErrors: 1 }],
    );
    expect(out).toEqual([{ label: "X", taskCount: 40, avgAht: 175, errorRate: 20 }]);
  });
  it("normalises AON spellings and attributes quality through the analyst's AON", () => {
    expect(normaliseAon("0-30")).toBe("0 to 30");
    expect(normaliseAon("Above then 90")).toBe("Above 90");
    expect(normaliseAon("")).toBe("(unassigned)");
    const map = buildAnalystAonMap([
      { analyst: "a@x.com", aon: "0-30", n: 5 },
      { analyst: "A@x.com", aon: "31 to 60", n: 2 },
    ]);
    expect(map.get("a@x.com")).toBe("0 to 30");
    const q = qualityByAon([{ analyst: "a@x.com", errors: 1, noErrors: 9 }, { analyst: "z@x.com", errors: 0, noErrors: 1 }], map);
    expect(q.map((x) => x.label)).toEqual(["0 to 30", "(unassigned)"]);
    const sorted = sortAonRows([
      { label: "Above 90", taskCount: 9, avgAht: 1, errorRate: 1 },
      { label: "0 to 30", taskCount: 1, avgAht: 1, errorRate: 1 },
    ]);
    expect(sorted[0].label).toBe("0 to 30");
  });
});
