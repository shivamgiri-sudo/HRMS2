import { beforeEach, describe, expect, it, vi } from "vitest";

const execute = vi.hoisted(() => vi.fn());
vi.mock("../../../db/mysql.js", () => ({ db: { execute, query: execute, getConnection: vi.fn() } }));
vi.mock("../../../logger.js", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

import {
  LIVE_FROM_DEFAULT, attributeSource, attributionJoinsSql, cutoffSql, fillTypeSql, formFillTime, isLiveFill, isMetaDrive, liveFirstFillSql, metaDriveSql, metaOriginSql,
  personFirstFillSql, sourceTypeSql, typeKeySql, validDay,
} from "../he-source-attribution.js";
import { clearLiveFromCache, loadLiveFrom } from "../he-source-attribution.service.js";
import { classifySource } from "../qualified-followup.schedule.js";

const OLD_FILL = "2026-09-20 09:00:00";
const LIVE_FILL = "2026-10-08 10:00:00";
const OCT = "2026-10-09 11:00:00", SEP = "2026-09-28 11:00:00";

describe("attributeSource (the display rule, pure mirror): three exclusive types", () => {
  it("a Meta-origin person whose first fill is on or after the cutoff is Live Meta for activity on or after it, whatever drive", () => {
    for (const driveSourceKind of [null, "pool", "meta", "campaign", "batch"]) {
      expect(attributeSource({ driveSourceKind, metaOrigin: true, firstFillAt: LIVE_FILL, activityAt: OCT })).toBe("meta_live");
      expect(attributeSource({ driveSourceKind, metaOrigin: true, firstFillAt: OLD_FILL, activityAt: OCT })).toBe("meta_old");
    }
  });
  it("nothing before the cutoff is ever Live (a September window shows Live Meta 0)", () => {
    expect(attributeSource({ metaOrigin: true, firstFillAt: LIVE_FILL, activityAt: SEP })).toBe("meta_old");
    expect(attributeSource({ metaOrigin: true, firstFillAt: LIVE_FILL, activityAt: "2026-10-07" })).toBe("meta_old");
    expect(attributeSource({ metaOrigin: true, firstFillAt: LIVE_FILL, activityAt: "2026-10-08" })).toBe("meta_live");
  });
  it("the FIRST fill decides: a re-fill after the cutoff never makes an earlier Meta person Live", () => {
    // fills on both sides of the cutoff: the first (September) one decides
    expect(attributeSource({ metaOrigin: true, firstFillAt: OLD_FILL, activityAt: OCT })).toBe("meta_old");
  });
  it("the cutoff is 2026-10-08 00:00 IST by default and can be moved", () => {
    expect(LIVE_FROM_DEFAULT).toBe("2026-10-08");
    expect(isLiveFill("2026-10-08 00:00:00")).toBe(true);
    expect(isLiveFill("2026-10-07 23:59:59")).toBe(false);
    expect(isLiveFill(null)).toBe(false);
    expect(attributeSource({ metaOrigin: true, firstFillAt: LIVE_FILL, activityAt: OCT, liveFrom: "2026-10-09" })).toBe("meta_old");
    expect(attributeSource({ metaOrigin: true, firstFillAt: OLD_FILL, activityAt: SEP, liveFrom: "2026-09-01" })).toBe("meta_live");
    expect(attributeSource({ metaOrigin: true, firstFillAt: LIVE_FILL, activityAt: OCT, liveFrom: "not a day" })).toBe("meta_live"); // invalid: default
  });
  it("Meta drives are 'meta' and 'campaign', and 'batch' only when the upload batch is a Meta one", () => {
    expect(isMetaDrive("meta")).toBe(true);
    expect(isMetaDrive("campaign")).toBe(true);
    expect(isMetaDrive("batch")).toBe(false);
    expect(isMetaDrive("batch", true)).toBe(true);
    expect(isMetaDrive("pool", true)).toBe(false);
    expect(attributeSource({ driveSourceKind: "batch" })).toBe("he"); // a Naukri / WorkIndia / walk-in upload drive is Hiring Engine
    expect(attributeSource({ driveSourceKind: "batch", driveBatchMeta: true })).toBe("meta_old");
    for (const k of ["meta", "campaign"]) expect(attributeSource({ driveSourceKind: k })).toBe("meta_old");
  });
  it("a Meta stream credit makes the person Meta; with no fill time they are Old Meta data; needs no run_label", () => {
    expect(attributeSource({ streamType: "meta_live" })).toBe("meta_old");
    expect(attributeSource({ streamType: "meta_live", firstFillAt: LIVE_FILL, activityAt: OCT })).toBe("meta_live");
    expect(attributeSource({ driveSourceKind: "meta", firstFillAt: OLD_FILL })).toBe("meta_old");
  });
  it("a Meta-origin person stays Meta even under a Hiring Engine stream credit (the sections never overlap)", () => {
    expect(attributeSource({ streamType: "he", metaOrigin: true, firstFillAt: OLD_FILL })).toBe("meta_old");
  });
  it("everyone else is Hiring Engine", () => {
    expect(attributeSource({ driveSourceKind: "pool", metaOrigin: false })).toBe("he");
    expect(attributeSource({ streamType: "he", driveSourceKind: "pool" })).toBe("he");
    expect(attributeSource({})).toBe("he");
  });
  it("validDay accepts real days only", () => {
    expect(validDay("2026-10-08")).toBe("2026-10-08");
    for (const v of ["2026-02-30", "2026-10-8", "x", "2026-10-08'; DROP", null, 20261008]) expect(validDay(v)).toBeNull();
  });
});

describe("formFillTime (Meta created_time, else import time; IST wall clock)", () => {
  it("converts Meta's UTC created_time to IST", () => {
    expect(formFillTime("2026-09-20 18:00:00", "2026-09-20T10:11:12+0000")).toBe("2026-09-20 15:41:12");
  });
  it("honours any offset", () => {
    expect(formFillTime("2026-09-21 18:00:00", "2026-09-20T22:00:00-0230")).toBe("2026-09-21 06:00:00");
  });
  it("never later than the import time (a created_time after the import is not trusted)", () => {
    expect(formFillTime("2026-09-20 10:00:00", "2026-09-20T10:11:12+0000")).toBe("2026-09-20 10:00:00");
  });
  it("falls back to the import time when created_time is missing or not ISO with an offset", () => {
    expect(formFillTime("2026-09-20 10:00:00", null)).toBe("2026-09-20 10:00:00");
    expect(formFillTime("2026-09-20 10:00:00", "1758363072")).toBe("2026-09-20 10:00:00");
    expect(formFillTime("2026-09-20 10:00:00", "2026-09-20 10:11:12")).toBe("2026-09-20 10:00:00");
  });
});

describe("classifySource keeps the follow-up pipeline's own enqueue-time type (engine behaviour unchanged)", () => {
  // The rule classifySource has always had, kept here as the reference: the display rule may differ (an upload batch is not Meta there).
  const legacy = (i: { launchSourceKind?: string | null; campaignStatus?: string | null }) => {
    if (i.launchSourceKind === "pool") return "he";
    if (i.launchSourceKind) return "meta_old";
    if (i.campaignStatus === "active" || i.campaignStatus === "draft") return "meta_live";
    return "he";
  };
  it("gives the same answer as before for every drive kind and campaign status, batch -> meta_old included", () => {
    for (const launchSourceKind of [undefined, null, "pool", "meta", "campaign", "batch"] as const) {
      for (const campaignStatus of [undefined, null, "active", "draft", "paused", "closed"]) {
        expect(classifySource({ launchSourceKind, campaignStatus })).toBe(legacy({ launchSourceKind, campaignStatus }));
      }
    }
    expect(classifySource({ launchSourceKind: "batch" })).toBe("meta_old");
  });
});

describe("SQL fragment (mirrors attributeSource)", () => {
  const sql = sourceTypeSql({ streams: true, d: "d", lead: "al", liveFrom: "2026-10-08", ref: "d.drive_date" });
  it("Meta when a Meta stream credit, a Meta drive or a Meta-origin person; Live only for activity and first fill on or after the cutoff", () => {
    expect(sql).toBe(`CASE WHEN COALESCE(rs.source_type, 'he') <> 'he' OR ${metaDriveSql("d")} OR ${metaOriginSql("al")} `
      + `THEN IF(d.drive_date >= TIMESTAMP '2026-10-08 00:00:00' AND ${liveFirstFillSql("al", "alf", "2026-10-08")}, 'meta_live', 'meta_old') ELSE 'he' END`);
    expect(sql).not.toContain("run_label");
  });
  it("a batch drive is Meta only through a Meta upload batch among its source_ids", () => {
    expect(metaDriveSql("d")).toBe("(d.source_kind IN ('meta','campaign') OR (d.source_kind = 'batch' AND EXISTS (SELECT 1 FROM he_import_batch hib WHERE hib.source = 'meta'"
      + " AND JSON_CONTAINS(d.source_ids, JSON_QUOTE(hib.id)))))");
  });
  it("without the stream tables it is the same rule minus the credit; an extra Meta signal can be added", () => {
    const off = sourceTypeSql({ streams: false, d: "d", lead: "al", liveFrom: "2026-10-08", ref: "d.drive_date" });
    expect(off.startsWith(`CASE WHEN ${metaDriveSql("d")} OR `)).toBe(true);
    expect(off).not.toContain("rs.");
    expect(sourceTypeSql({ streams: false, d: "qd", lead: "hl", first: "hlf", liveFrom: "2026-10-08", ref: "qf.qualified_at", extraMeta: "qf.meta_lead_id IS NOT NULL" }))
      .toContain(`${metaOriginSql("hl", "qf.meta_lead_id IS NOT NULL")} THEN IF(qf.qualified_at >= TIMESTAMP '2026-10-08 00:00:00' AND ${liveFirstFillSql("hl", "hlf", "2026-10-08")}`);
  });
  it("inlines only a validated cutoff day", () => {
    expect(cutoffSql("2026-10-15")).toBe("TIMESTAMP '2026-10-15 00:00:00'");
    expect(cutoffSql("2026-10-15' OR 1=1 --")).toBe("TIMESTAMP '2026-10-08 00:00:00'");
  });
  it("Meta origin is the person's meta_lead_id or a campaign link, both by key", () => {
    expect(metaOriginSql("al")).toBe("(al.meta_lead_id IS NOT NULL OR EXISTS (SELECT 1 FROM he_lead_campaign alx WHERE alx.lead_id = al.id))");
  });
  it("first fill Live: the first-fill import before the cutoff decides with no subquery; payload only for imports on or after it", () => {
    const l = liveFirstFillSql("al", "alf", "2026-10-08");
    expect(l.startsWith("((alf.id IS NULL OR (alf.created_at >= TIMESTAMP '2026-10-08 00:00:00' AND LEAST(alf.created_at, COALESCE(")).toBe(true);
    expect(l).toContain("NOT EXISTS (SELECT 1 FROM he_lead_campaign alc JOIN meta_lead_raw afr ON afr.id = alc.meta_lead_id COLLATE utf8mb4_unicode_ci WHERE alc.lead_id = al.id AND (alc.form_filled_at < TIMESTAMP '2026-10-08 00:00:00' OR afr.created_at < TIMESTAMP '2026-10-08 00:00:00' OR LEAST(");
    expect(l).toContain("CONVERT_TZ(STR_TO_DATE(LEFT(alf.raw_payload->>'$.created_time', 19), '%Y-%m-%dT%H:%i:%s'), CONCAT(SUBSTRING(alf.raw_payload->>'$.created_time', 20, 3), ':', SUBSTRING(alf.raw_payload->>'$.created_time', 23, 2)), '+05:30')");
    const froms = [...l.matchAll(/FROM (\w+) (\w+)(?: JOIN (\w+) (\w+) ON (\S+) = \S+(?: COLLATE \w+)?)? WHERE (\S+)/g)];
    expect(froms.map((m) => [m[1], m[6]])).toEqual([["he_lead_campaign", "aly.lead_id"], ["he_lead_campaign", "alc.lead_id"]]);
  });
  it("a raw fill is Live only when it and the person's first fill are on or after the cutoff; with no pool person, by the same parsed_phone", () => {
    const f = fillTypeSql("r", "2026-10-08");
    expect(f.startsWith("IF(r.created_at >= TIMESTAMP '2026-10-08 00:00:00' AND LEAST(r.created_at, COALESCE(")).toBe(true);
    const phone = "RIGHT(REGEXP_REPLACE(r.parsed_phone, '[^0-9]', ''), 10) COLLATE utf8mb4_unicode_ci";
    expect(f).toContain(`AND IF(EXISTS (SELECT 1 FROM he_lead pl WHERE pl.mobile10 = ${phone}), EXISTS (SELECT 1 FROM he_lead pl LEFT JOIN meta_lead_raw plf ON plf.id = pl.meta_lead_id COLLATE utf8mb4_unicode_ci WHERE pl.mobile10 = ${phone} AND ${liveFirstFillSql("pl", "plf", "2026-10-08")}), NOT EXISTS (SELECT 1 FROM meta_lead_raw afx WHERE afx.parsed_phone = r.parsed_phone`);
    expect(f).not.toContain("LEFT JOIN he_lead pl ON"); // no join: the person lookups run only for fills on or after the cutoff
  });
  it("the first-fill specification reaches every table by key", () => {
    const f = personFirstFillSql("al");
    const froms = [...f.matchAll(/FROM (\w+) (\w+)(?: JOIN (\w+) (\w+) ON (\S+) = \S+(?: COLLATE \w+)?)? WHERE (\S+)/g)];
    expect(froms.map((m) => [m[1], m[6]])).toEqual([["he_lead_campaign", "alc.lead_id"]]);
    expect(f).toContain("SELECT MIN(");
  });
  it("joins the credit by match id, the person and their first fill by primary key", () => {
    expect(attributionJoinsSql({ streams: true, match: "m", requisition: "d.requisition_id", lead: "al", leadId: "m.lead_id" }).replace(/\s+/g, " ").trim())
      .toBe("LEFT JOIN requisition_stream_match sm ON sm.match_id = m.id LEFT JOIN requisition_stream rs ON rs.id = sm.stream_id AND rs.requisition_id = d.requisition_id"
        + " LEFT JOIN he_lead al ON al.id = m.lead_id LEFT JOIN meta_lead_raw alf ON alf.id = al.meta_lead_id COLLATE utf8mb4_unicode_ci");
  });
  it("the per-person key ranks Live, Old, he", () => {
    expect(typeKeySql("p.t")).toBe("CONCAT(FIELD(p.t, 'meta_live', 'meta_old', 'he'), p.t)");
  });
});

describe("loadLiveFrom (he_model_param 'meta.live_from.YYYY-MM-DD' = 1)", () => {
  beforeEach(() => { vi.clearAllMocks(); clearLiveFromCache(); });
  it("defaults to 2026-10-08 with no row, a failing read or an invalid key", async () => {
    execute.mockResolvedValueOnce([[]]);
    expect(await loadLiveFrom()).toBe("2026-10-08");
    clearLiveFromCache();
    execute.mockRejectedValueOnce(Object.assign(new Error("x"), { code: "ER_NO_SUCH_TABLE" }));
    expect(await loadLiveFrom()).toBe("2026-10-08");
    clearLiveFromCache();
    execute.mockResolvedValueOnce([[{ param_key: "meta.live_from.2026-13-01" }]]);
    expect(await loadLiveFrom()).toBe("2026-10-08");
  });
  it("takes the latest valid day and caches it", async () => {
    execute.mockResolvedValueOnce([[{ param_key: "meta.live_from.2026-10-01" }, { param_key: "meta.live_from.2026-10-15" }]]);
    expect(await loadLiveFrom()).toBe("2026-10-15");
    expect(await loadLiveFrom()).toBe("2026-10-15");
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0]).toEqual(["SELECT param_key FROM he_model_param WHERE param_key LIKE ? AND value = 1", ["meta.live_from.%"]]);
  });
});
