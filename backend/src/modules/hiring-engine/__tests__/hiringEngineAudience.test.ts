import { describe, expect, it } from "vitest";
import { audienceSql } from "../he-drive.service.js";

const d = (o: Partial<{ source_kind: string; source_ids: unknown; max_lead_age_days: number | null }>) => ({ source_kind: "pool", source_ids: null, max_lead_age_days: null, ...o });

describe("drive audience", () => {
  it("a pool drive adds no filter", () => expect(audienceSql(d({}), {})).toEqual({ sql: "", args: [] }));
  it("the daily plan's Meta-only flag only widens a pool drive to Meta leads", () => {
    const a = audienceSql(d({}), { metaOnly: true });
    expect(a.sql).toContain("he_lead_campaign");
    expect(a.sql).toContain("screening_result = 'qualified'");
    expect(a.args).toEqual([]);
  });
  it("a campaign drive only takes qualified fills of its campaigns, in the right argument order", () => {
    const a = audienceSql(d({ source_kind: "campaign", source_ids: JSON.stringify(["c1", "c2"]), max_lead_age_days: 90 }), {});
    expect(a.sql).toContain("lc.campaign_id IN (?,?)");
    expect(a.sql).toContain("lc.form_filled_at >= DATE_SUB(NOW(), INTERVAL ? DAY)");
    expect(a.args).toEqual(["c1", "c2", 90]);
  });
  it("a batch drive takes only the people of its upload batches", () => {
    const a = audienceSql(d({ source_kind: "batch", source_ids: ["b1"] }), {});
    expect(a.sql).toContain("he_lead_batch");
    expect(a.args).toEqual(["b1"]);
  });
  it("a campaign drive keeps its audience even when the Meta-only flag is on (never widens)", () => {
    const a = audienceSql(d({ source_kind: "campaign", source_ids: ["c1"] }), { metaOnly: true });
    expect(a.args).toEqual(["c1"]);
  });
  it("a campaign or batch drive with an unreadable audience matches nobody, never the whole pool", () => {
    expect(audienceSql(d({ source_kind: "campaign", source_ids: [] }), {}).sql).toBe("AND 1 = 0");
    expect(audienceSql(d({ source_kind: "batch", source_ids: "not json" }), {}).sql).toBe("AND 1 = 0");
  });
});
