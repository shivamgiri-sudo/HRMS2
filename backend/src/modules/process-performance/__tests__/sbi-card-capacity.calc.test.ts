import { describe, it, expect } from "vitest";
import { capacityOf, tableLabel, DEFAULT_TARGET_PENETRATION } from "../sbi-card-capacity.calc.js";

const accts = (table: string, n: number, attempts: number) => Array.from({ length: n }, () => ({ callTable: table, attempts }));

describe("table labels", () => {
  it("drops the site prefix and the date stamp so one table groups across days", () => {
    expect(tableLabel("MAS_AHM_CD3_HB_28092026")).toBe("CD3_HB");
    expect(tableLabel("AL_MUM_CD3_FAT_S_HB_19082026")).toBe("CD3_FAT_S_HB");
    expect(tableLabel("EL_DEL_CD2_JO_")).toBe("CD2_JO");
    expect(tableLabel(null)).toBe("Unknown");
  });
});

describe("penetration against the client's target", () => {
  it("applies Dials Required = accounts x target, as the Pen Estimation sheet does", () => {
    const r = capacityOf({ accounts: [...accts("MAS_AHM_CD3_HB_28092026", 1318, 2), ...accts("MAS_AHM_CD3_PTP_28092026", 41, 3)], apr: null, downtime: [] });
    expect(r.target).toBe(DEFAULT_TARGET_PENETRATION);
    const hb = r.rows.find((x) => x.table === "CD3_HB")!;
    expect([hb.requiredDials, hb.attempts, hb.shortfallDials, hb.penetration, hb.status]).toEqual([3954, 2636, 1318, 2, "behind"]);   // 1318 x 3 = 3954, the sheet's own figure
    expect(r.rows.find((x) => x.table === "CD3_PTP")!.status).toBe("on-target");
    expect(r.total).toMatchObject({ accounts: 1359, requiredDials: 4077, shortfallDials: 1318, behindTables: 1 });
  });
  it("uses the client's target when one is given, and says so", () => {
    const r = capacityOf({ accounts: accts("T", 10, 3), targetPenetration: 4, apr: null, downtime: [] });
    expect([r.target, r.targetFromClient, r.rows[0]!.requiredDials, r.rows[0]!.shortfallDials]).toEqual([4, true, 40, 10]);
  });
  it("orders the tables furthest behind first", () => {
    const r = capacityOf({ accounts: [...accts("A", 10, 3), ...accts("B", 100, 1), ...accts("C", 10, 0)], apr: null, downtime: [] });
    expect(r.rows.map((x) => x.table)).toEqual(["B", "C", "A"]);
  });
});

describe("capacity from the APR", () => {
  it("turns the dial gap into login hours at the observed dials per hour", () => {
    const r = capacityOf({ accounts: accts("T", 1000, 2), apr: { calls: 1884, loginHours: 172.8 }, downtime: [] });
    expect(r.total.shortfallDials).toBe(1000);
    expect(r.capacity!.dph).toBe(10.9);
    expect(r.capacity!.extraHoursToCloseGap).toBe(91.72);        // 1000 / (1884 / 172.8)
    expect(r.capacity!.requiredHoursAtTarget).toBe(275.16);      // 3000 / dph
  });
  it("has no capacity figures without an APR, and never divides by zero", () => {
    expect(capacityOf({ accounts: accts("T", 5, 1), apr: null, downtime: [] }).capacity).toBeNull();
    expect(capacityOf({ accounts: accts("T", 5, 1), apr: { calls: 0, loginHours: 0 }, downtime: [] }).capacity).toBeNull();
  });
});

describe("downtime", () => {
  it("is users x hours, the tracker's own 'Total Downtime' (33 users x 4h20 = 143 agent-hours)", () => {
    const r = capacityOf({ accounts: accts("T", 10, 1), apr: { calls: 100, loginHours: 10 }, downtime: [{ minutes: 260, users: 33 }, { minutes: 15, users: 35 }] });
    expect(r.downtime.events).toBe(2);
    expect(r.downtime.agentHoursLost).toBe(151.75);   // 143 + 8.75
    expect(r.downtime.dialsLost).toBe(1518);          // at 10 dials per hour
  });
  it("ignores events with no users or minutes", () => {
    const r = capacityOf({ accounts: [], apr: null, downtime: [{ minutes: null, users: 5 }, { minutes: 30, users: null }] });
    expect([r.downtime.agentHoursLost, r.downtime.dialsLost, r.total.penetration]).toEqual([0, null, 0]);
  });
});
