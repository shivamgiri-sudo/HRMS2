import { describe, it, expect } from "vitest";
import { agentTimeOf, type AgentTimeRow } from "../sbi-card-agent-time.calc.js";

const r = (o: Partial<AgentTimeRow>): AgentTimeRow => ({
  date: "2026-09-28", employeeId: "MAS1", name: "A", calls: 100, loginSec: 36000, waitSec: 7200, talkSec: 14400, dispoSec: 3600, pauseSec: 10800,
  deadSec: 0, achtSec: 200, firstLogin: "10:00:00", lastLogout: "19:00:00", lb: 3600, tb: 1800, wb: 600, mb: null, qb: null, loginCode: 600, ...o,
});

describe("agent time utilisation", () => {
  it("computes the documented ratios", () => {
    const o = agentTimeOf([r({})]);
    const a = o.agents[0]!;
    expect(a.utilisationPct).toBe(50);      // (4h + 1h) / 10h
    expect(a.occupancyPct).toBe(71.4);      // 5h / (5h + 2h)
    expect(a.pausePct).toBe(30);
    expect(a.waitPct).toBe(20);
    expect(a.callsPerLoginHour).toBe(10);
    expect(a.achtSec).toBe(200);
    expect(a.flags).toEqual([]);
  });
  it("flags an agent against the team, not against a fixed target", () => {
    const o = agentTimeOf([
      r({ employeeId: "GOOD1" }), r({ employeeId: "GOOD2" }), r({ employeeId: "GOOD3" }),
      r({ employeeId: "BAD", talkSec: 1800, dispoSec: 0, pauseSec: 20000, calls: 20 }),
    ]);
    expect(o.agents[0]!.employeeId).toBe("BAD");
    expect(o.agents[0]!.flags).toEqual(["Low utilisation", "High pause", "Low call rate"]);
    expect(o.agents.filter((a) => a.flags.length).length).toBe(1);
    expect(o.summary.flagged).toBe(1);
  });
  it("weights ACHT by calls and rolls up a day and the team", () => {
    const o = agentTimeOf([r({ employeeId: "MAS1", calls: 100, achtSec: 100 }), r({ employeeId: "MAS2", calls: 300, achtSec: 200 }), r({ employeeId: "MAS1", date: "2026-09-29", calls: 0, achtSec: 0 })]);
    expect(o.summary.agents).toBe(2);
    expect(o.summary.days).toBe(2);
    expect(o.daily[0]).toMatchObject({ date: "2026-09-28", agents: 2, calls: 400, achtSec: 175 });
  });
  it("splits pause time by code and keeps the remainder as unnamed", () => {
    const o = agentTimeOf([r({})]);
    const lb = o.pauseCodes.find((c) => c.code === "LB")!;
    expect(lb).toMatchObject({ hours: 1, sharePct: 33.3 });
    expect(o.pauseCodes.find((c) => c.code === "Other / unnamed")!.hours).toBe(1.2);
  });
  it("returns nulls, not NaN, for an agent who never logged in", () => {
    const a = agentTimeOf([r({ loginSec: 0, waitSec: 0, talkSec: 0, dispoSec: 0, pauseSec: 0, calls: 0 })]).agents[0]!;
    expect([a.utilisationPct, a.occupancyPct, a.pausePct, a.achtSec, a.callsPerLoginHour]).toEqual([null, null, null, null, null]);
    expect(a.flags).toEqual([]);
  });
});
