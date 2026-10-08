import { describe, expect, it } from "vitest";
import {
  LIVE_FILL_DAYS, attributeSource, attributionJoinsSql, formFillTime, isLiveFill, metaOriginSql, personFillSql, sourceTypeSql, typeKeySql,
} from "../he-source-attribution.js";
import { classifySource } from "../qualified-followup.schedule.js";

const DRIVE = "2026-10-08";

describe("attributeSource (the shared rule, pure mirror)", () => {
  it("a stream credit wins over everything else", () => {
    expect(attributeSource({ streamType: "he", driveSourceKind: "meta", metaOrigin: true, formFilledAt: "2026-10-07 10:00:00", refDate: DRIVE })).toBe("he");
    expect(attributeSource({ streamType: "meta_live", driveSourceKind: "pool" })).toBe("meta_live");
  });
  it("any non-pool drive is Meta: old unless the person filled a form within the live window", () => {
    for (const k of ["meta", "campaign", "batch"]) {
      expect(attributeSource({ driveSourceKind: k, refDate: DRIVE })).toBe("meta_old");
      expect(attributeSource({ driveSourceKind: k, metaOrigin: true, formFilledAt: "2026-09-20 09:00:00", refDate: DRIVE })).toBe("meta_old");
      expect(attributeSource({ driveSourceKind: k, metaOrigin: true, formFilledAt: "2026-10-01 09:00:00", refDate: DRIVE })).toBe("meta_live");
    }
  });
  it("needs no run_label (the old fallback did)", () => {
    expect(attributeSource({ driveSourceKind: "meta", refDate: DRIVE })).toBe("meta_old");
  });
  it("a Meta-origin person on a pool drive is Meta, by their form fill time", () => {
    expect(attributeSource({ driveSourceKind: "pool", metaOrigin: true, formFilledAt: "2026-09-20 09:00:00", refDate: DRIVE })).toBe("meta_old");
    expect(attributeSource({ driveSourceKind: "pool", metaOrigin: true, formFilledAt: "2026-10-06 09:00:00", refDate: DRIVE })).toBe("meta_live");
    expect(attributeSource({ driveSourceKind: "pool", metaOrigin: true, formFilledAt: null, refDate: DRIVE })).toBe("meta_old");
  });
  it("a pool drive and a person with no Meta origin is Hiring Engine", () => {
    expect(attributeSource({ driveSourceKind: "pool", metaOrigin: false, refDate: DRIVE })).toBe("he");
    expect(attributeSource({})).toBe("he");
  });
});

describe("isLiveFill (14 days before the drive date, or after it)", () => {
  it("is a named 14-day threshold", () => { expect(LIVE_FILL_DAYS).toBe(14); });
  it("counts from 00:00 of the day 14 days before the drive date", () => {
    expect(isLiveFill("2026-09-24 00:00:00", DRIVE)).toBe(true);
    expect(isLiveFill("2026-09-23 23:59:59", DRIVE)).toBe(false);
  });
  it("a fill on or after the drive date is live", () => {
    expect(isLiveFill("2026-10-08 18:00:00", DRIVE)).toBe(true);
    expect(isLiveFill("2026-10-20 08:00:00", DRIVE)).toBe(true);
  });
  it("no fill time or no reference date is not live", () => {
    expect(isLiveFill(null, DRIVE)).toBe(false);
    expect(isLiveFill("2026-10-01 10:00:00", null)).toBe(false);
  });
});

describe("formFillTime (Meta created_time, else import time; IST wall clock)", () => {
  it("converts Meta's UTC created_time to IST", () => {
    expect(formFillTime("2026-09-20 18:00:00", "2026-09-20T10:11:12+0000")).toBe("2026-09-20 15:41:12");
  });
  it("honours any offset", () => {
    expect(formFillTime("2026-09-21 18:00:00", "2026-09-20T22:00:00-0230")).toBe("2026-09-21 06:00:00");
  });
  it("never later than the import time (a created_time in the future of the import is not trusted)", () => {
    expect(formFillTime("2026-09-20 10:00:00", "2026-09-20T10:11:12+0000")).toBe("2026-09-20 10:00:00");
  });
  it("falls back to the import time when created_time is missing or not ISO with an offset", () => {
    expect(formFillTime("2026-09-20 10:00:00", null)).toBe("2026-09-20 10:00:00");
    expect(formFillTime("2026-09-20 10:00:00", "1758363072")).toBe("2026-09-20 10:00:00");
    expect(formFillTime("2026-09-20 10:00:00", "2026-09-20 10:11:12")).toBe("2026-09-20 10:00:00");
  });
});

describe("classifySource is the shared rule (parity)", () => {
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
  const sql = sourceTypeSql({ streams: true, d: "d", lead: "al" });
  it("puts the stream credit first, then the drive kind or the person's Meta origin, then he", () => {
    expect(sql.startsWith("COALESCE(rs.source_type, ")).toBe(true);
    const kind = sql.indexOf("COALESCE(d.source_kind, 'pool') <> 'pool'");
    const origin = sql.indexOf(metaOriginSql("al"));
    expect(kind).toBeGreaterThan(0);
    expect(origin).toBeGreaterThan(kind);
    expect(sql).toContain(`>= d.drive_date - INTERVAL ${LIVE_FILL_DAYS} DAY, 'meta_live', 'meta_old')`);
    expect(sql.trim().endsWith("ELSE 'he' END)")).toBe(true);
    expect(sql).not.toContain("run_label");
  });
  it("without the stream tables it is the same rule minus the credit", () => {
    const off = sourceTypeSql({ streams: false, d: "d", lead: "al" });
    expect(off.startsWith("CASE WHEN")).toBe(true);
    expect(off).not.toContain("rs.");
  });
  it("takes a reference date for rows that may have no drive", () => {
    expect(sourceTypeSql({ streams: false, d: "d", lead: "al", refDate: "COALESCE(d.drive_date, DATE(h.created_at))" }))
      .toContain(">= (COALESCE(d.drive_date, DATE(h.created_at))) - INTERVAL 14 DAY");
  });
  it("Meta origin is the person's meta_lead_id or a campaign link, both by key", () => {
    expect(metaOriginSql("al")).toBe("(al.meta_lead_id IS NOT NULL OR EXISTS (SELECT 1 FROM he_lead_campaign alx WHERE alx.lead_id = al.id))");
  });
  it("the fill time is the latest form fill, Meta created_time in IST capped by the import time, reached by key only", () => {
    const f = personFillSql("al");
    expect(f).toContain("FROM he_lead_campaign alc JOIN meta_lead_raw afr ON afr.id = alc.meta_lead_id WHERE alc.lead_id = al.id");
    expect(f).toContain("FROM meta_lead_raw afm WHERE afm.id = al.meta_lead_id");
    expect(f).toContain("LEAST(afr.created_at, COALESCE(");
    expect(f).toContain("JSON_UNQUOTE(JSON_EXTRACT(afr.raw_payload, '$.created_time'))");
    expect(f).toContain("INTERVAL 330 -");
  });
  it("joins the credit by match id and the person by primary key", () => {
    expect(attributionJoinsSql({ streams: true, match: "m", requisition: "d.requisition_id", lead: "al", leadId: "m.lead_id" }).replace(/\s+/g, " ").trim())
      .toBe("LEFT JOIN requisition_stream_match sm ON sm.match_id = m.id LEFT JOIN requisition_stream rs ON rs.id = sm.stream_id AND rs.requisition_id = d.requisition_id LEFT JOIN he_lead al ON al.id = m.lead_id");
    expect(attributionJoinsSql({ streams: false, match: "m", requisition: "d.requisition_id", lead: "al", leadId: "m.lead_id" }).trim()).toBe("LEFT JOIN he_lead al ON al.id = m.lead_id");
  });
  it("the per-person key ranks a stream credit first, then Live, Old, he", () => {
    expect(typeKeySql("p.credited", "p.source_type")).toBe("CONCAT(IF(p.credited, 0, 1), FIELD(p.source_type, 'meta_live', 'meta_old', 'he'), p.source_type)");
    const keys = [["0", "he"], ["1", "meta_old"], ["1", "meta_live"], ["1", "he"]].map(([c, t]) => `${c}${["meta_live", "meta_old", "he"].indexOf(t) + 1}${t}`).sort();
    expect(keys[0].slice(2)).toBe("he"); // credited wins
    expect(keys[1].slice(2)).toBe("meta_live");
  });
});
