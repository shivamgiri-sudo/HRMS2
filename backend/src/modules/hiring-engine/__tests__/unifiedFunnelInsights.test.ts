import { describe, expect, it } from "vitest";
import { funnelInsights, type FunnelCounts } from "../he-unified-funnel.service.js";

const c = (o: Partial<FunnelCounts>): FunnelCounts => ({ enrolled: 0, emailed: 0, whatsapped: 0, called: 0, confirmed: 0, walkedIn: 0, selected: 0, joined: 0, ...o });
const ats = { registered: 800, selected: 280, joined: 120, fromDrives: 44, beforeEnrolment: 200, otherSources: { registered: 556, selected: 230, joined: 110 } };

describe("funnelInsights", () => {
  it("says so when nobody was contacted", () => {
    const z = c({});
    expect(funnelInsights({ drives: { meta_live: z, meta_old: z, he: z }, total: z, ats })).toEqual([{ level: "info", text: "Nobody was first contacted in this period." }]);
  });
  it("warns when under half of the confirmed walk in and names the best drive", () => {
    const d = { meta_live: c({ enrolled: 1000, confirmed: 80, walkedIn: 10 }), meta_old: c({ enrolled: 2000, confirmed: 70, walkedIn: 30 }), he: c({ enrolled: 100, confirmed: 5, walkedIn: 0 }) };
    const total = c({ enrolled: 3100, confirmed: 155, walkedIn: 40, selected: 12, joined: 0 });
    const out = funnelInsights({ drives: d, total, ats });
    expect(out.some((i) => i.level === "warn" && /walked in \(26%\)/.test(i.text))).toBe(true);
    expect(out.some((i) => /Old Meta data brings the most walk-ins/.test(i.text))).toBe(true);
    expect(out.some((i) => /have not joined yet/.test(i.text))).toBe(true);
  });
});
