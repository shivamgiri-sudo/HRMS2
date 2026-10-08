import { beforeEach, describe, expect, it, vi } from "vitest";

const execute = vi.hoisted(() => vi.fn());
vi.mock("../../../db/mysql.js", () => ({ db: { execute, query: execute, getConnection: vi.fn() } }));
vi.mock("../../../logger.js", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

import {
  LIVE_FROM_DEFAULT, attributeSource, attributionJoinsSql, cutoffSql, formFillTime, isLiveFill, liveFillSql, metaOriginSql, personFillSql, sourceTypeSql,
  typeKeySql, validDay,
} from "../he-source-attribution.js";
import { clearLiveFromCache, loadLiveFrom } from "../he-source-attribution.service.js";
import { classifySource } from "../qualified-followup.schedule.js";

const OLD_FILL = "2026-09-20 09:00:00";
const LIVE_FILL = "2026-10-08 10:00:00";

describe("attributeSource (the shared rule, pure mirror): three exclusive types", () => {
  it("a Meta-origin person is Live Meta from the cutoff day on, Old Meta data before it, whatever drive they came through", () => {
    for (const driveSourceKind of [null, "pool", "meta", "campaign", "batch"]) {
      expect(attributeSource({ driveSourceKind, metaOrigin: true, formFilledAt: LIVE_FILL })).toBe("meta_live");
      expect(attributeSource({ driveSourceKind, metaOrigin: true, formFilledAt: OLD_FILL })).toBe("meta_old");
    }
  });
  it("the cutoff is 2026-10-08 00:00 IST by default", () => {
    expect(LIVE_FROM_DEFAULT).toBe("2026-10-08");
    expect(isLiveFill("2026-10-08 00:00:00")).toBe(true);
    expect(isLiveFill("2026-10-07 23:59:59")).toBe(false);
    expect(isLiveFill(null)).toBe(false);
  });
  it("takes another cutoff", () => {
    expect(attributeSource({ metaOrigin: true, formFilledAt: LIVE_FILL, liveFrom: "2026-10-09" })).toBe("meta_old");
    expect(attributeSource({ metaOrigin: true, formFilledAt: OLD_FILL, liveFrom: "2026-09-01" })).toBe("meta_live");
    expect(attributeSource({ metaOrigin: true, formFilledAt: LIVE_FILL, liveFrom: "not a day" })).toBe("meta_live"); // invalid: default
  });
  it("a Meta-sourced drive or a Meta stream credit makes the person Meta; with no fill time they are Old Meta data", () => {
    for (const k of ["meta", "campaign", "batch"]) expect(attributeSource({ driveSourceKind: k })).toBe("meta_old");
    expect(attributeSource({ streamType: "meta_live" })).toBe("meta_old");
    expect(attributeSource({ streamType: "meta_live", formFilledAt: LIVE_FILL })).toBe("meta_live");
    expect(attributeSource({ streamType: "meta_old", formFilledAt: LIVE_FILL })).toBe("meta_live");
  });
  it("needs no run_label (the old Old Meta fallback did)", () => {
    expect(attributeSource({ driveSourceKind: "meta", formFilledAt: OLD_FILL })).toBe("meta_old");
  });
  it("a Meta-origin person stays Meta even under a Hiring Engine stream credit (the sections never overlap)", () => {
    expect(attributeSource({ streamType: "he", metaOrigin: true, formFilledAt: OLD_FILL })).toBe("meta_old");
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

describe("classifySource is the shared rule (parity, engine behaviour unchanged)", () => {
  // The rule classifySource had before it delegated, kept here as the reference.
  const legacy = (i: { launchSourceKind?: string | null; campaignStatus?: string | null }) => {
    if (i.launchSourceKind === "pool") return "he";
    if (i.launchSourceKind) return "meta_old";
    if (i.campaignStatus === "active" || i.campaignStatus === "draft") return "meta_live";
    return "he";
  };
  it("gives the same answer as before and as attributeSource for every drive kind and campaign status", () => {
    for (const launchSourceKind of [undefined, null, "pool", "meta", "campaign", "batch"] as const) {
      for (const campaignStatus of [undefined, null, "active", "draft", "paused", "closed"]) {
        const got = classifySource({ launchSourceKind, campaignStatus });
        expect(got).toBe(legacy({ launchSourceKind, campaignStatus }));
        expect(got).toBe(attributeSource({ driveSourceKind: launchSourceKind, campaignStatus }));
      }
    }
  });
});

describe("SQL fragment (mirrors attributeSource)", () => {
  const sql = sourceTypeSql({ streams: true, d: "d", lead: "al", liveFrom: "2026-10-08" });
  it("Meta when a Meta stream credit, a Meta drive or a Meta-origin person; then Live / Old by the cutoff; else he", () => {
    expect(sql).toBe(`CASE WHEN COALESCE(rs.source_type, 'he') <> 'he' OR COALESCE(d.source_kind, 'pool') <> 'pool' OR ${metaOriginSql("al")} `
      + `THEN IF(${liveFillSql("al", "2026-10-08")}, 'meta_live', 'meta_old') ELSE 'he' END`);
    expect(sql).not.toContain("run_label");
  });
  it("without the stream tables it is the same rule minus the credit", () => {
    const off = sourceTypeSql({ streams: false, d: "d", lead: "al", liveFrom: "2026-10-08" });
    expect(off.startsWith("CASE WHEN COALESCE(d.source_kind, 'pool') <> 'pool' OR ")).toBe(true);
    expect(off).not.toContain("rs.");
  });
  it("inlines only a validated cutoff day", () => {
    expect(cutoffSql("2026-10-15")).toBe("TIMESTAMP '2026-10-15 00:00:00'");
    expect(cutoffSql("2026-10-15' OR 1=1 --")).toBe("TIMESTAMP '2026-10-08 00:00:00'");
  });
  it("Meta origin is the person's meta_lead_id or a campaign link, both by key", () => {
    expect(metaOriginSql("al")).toBe("(al.meta_lead_id IS NOT NULL OR EXISTS (SELECT 1 FROM he_lead_campaign alx WHERE alx.lead_id = al.id))");
  });
  it("live is any fill on or after the cutoff, checked on the import time before the payload, with one keyed subquery", () => {
    const l = liveFillSql("al", "2026-10-08");
    expect(l.startsWith("((alf.created_at >= TIMESTAMP '2026-10-08 00:00:00' AND LEAST(alf.created_at, COALESCE(")).toBe(true);
    expect(l).toContain("WHERE alc.lead_id = al.id AND (alc.form_filled_at IS NULL OR alc.form_filled_at >= TIMESTAMP '2026-10-08 00:00:00') AND LEAST(afr.created_at, COALESCE(");
    expect(l).toContain("CONVERT_TZ(STR_TO_DATE(LEFT(alf.raw_payload->>'$.created_time', 19), '%Y-%m-%dT%H:%i:%s'), CONCAT(SUBSTRING(alf.raw_payload->>'$.created_time', 20, 3), ':', SUBSTRING(alf.raw_payload->>'$.created_time', 23, 2)), '+05:30')");
    const froms = [...l.matchAll(/FROM (\w+) (\w+)(?: JOIN (\w+) (\w+) ON (\S+) = \S+(?: COLLATE \w+)?)? WHERE (\S+)/g)];
    expect(froms.map((m) => [m[1], m[6], m[5]])).toEqual([["he_lead_campaign", "alc.lead_id", "afr.id"]]);
  });
  it("the fill-time specification reaches every table by key", () => {
    const f = personFillSql("al");
    const froms = [...f.matchAll(/FROM (\w+) (\w+)(?: JOIN (\w+) (\w+) ON (\S+) = \S+(?: COLLATE \w+)?)? WHERE (\S+)/g)];
    expect(froms.map((m) => [m[1], m[6]])).toEqual([["he_lead_campaign", "alc.lead_id"], ["meta_lead_raw", "afm.id"]]);
  });
  it("joins the credit by match id, the person and their first fill by primary key", () => {
    expect(attributionJoinsSql({ streams: true, match: "m", requisition: "d.requisition_id", lead: "al", leadId: "m.lead_id" }).replace(/\s+/g, " ").trim())
      .toBe("LEFT JOIN requisition_stream_match sm ON sm.match_id = m.id LEFT JOIN requisition_stream rs ON rs.id = sm.stream_id AND rs.requisition_id = d.requisition_id"
        + " LEFT JOIN he_lead al ON al.id = m.lead_id LEFT JOIN meta_lead_raw alf ON alf.id = al.meta_lead_id COLLATE utf8mb4_unicode_ci");
    expect(attributionJoinsSql({ streams: false, match: "m", requisition: "d.requisition_id", lead: "al", leadId: "m.lead_id" }).replace(/\s+/g, " ").trim())
      .toBe("LEFT JOIN he_lead al ON al.id = m.lead_id LEFT JOIN meta_lead_raw alf ON alf.id = al.meta_lead_id COLLATE utf8mb4_unicode_ci");
  });
  it("the per-person key ranks Live, Old, he", () => {
    expect(typeKeySql("p.t")).toBe("CONCAT(FIELD(p.t, 'meta_live', 'meta_old', 'he'), p.t)");
    expect(["3he", "2meta_old", "1meta_live"].sort()[0].slice(1)).toBe("meta_live");
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
