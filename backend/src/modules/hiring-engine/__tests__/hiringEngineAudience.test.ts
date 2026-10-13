import { describe, expect, it } from "vitest";
import { audienceSql } from "../he-drive.service.js";

const d = (o: Partial<{ source_kind: string; source_ids: unknown; max_lead_age_days: number | null }>) => ({ source_kind: "pool", source_ids: null, max_lead_age_days: null, ...o });

describe("drive audience", () => {
  it("a pool drive is the non-Meta pool: anyone who ever filled a Meta form is left out", () => {
    const a = audienceSql(d({}), {});
    expect(a.sql).toContain("l.meta_lead_id IS NULL");
    expect(a.sql).toContain("NOT EXISTS (SELECT 1 FROM he_lead_campaign");
    expect(a.args).toEqual([]);
  });
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

import { scoreLead } from "../he-matcher.js";
describe("night shift for sources that cannot state it", () => {
  const req = { nightShift: true, strict: true } as never;
  const lead = { nightShiftOk: null } as never;
  it("strict drops an unknown night-shift preference", () => expect(scoreLead(lead, req).eligible).toBe(false));
  it("a Meta audience lets the unknown through", () => expect(scoreLead(lead, { ...(req as object), unknownOk: ["night_shift"] } as never).eligible).toBe(true));
  it("but a stated NO still blocks", () => expect(scoreLead({ nightShiftOk: false } as never, { ...(req as object), unknownOk: ["night_shift"] } as never).eligible).toBe(false));
});
