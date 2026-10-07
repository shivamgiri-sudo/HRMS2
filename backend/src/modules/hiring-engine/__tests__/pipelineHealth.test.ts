import { describe, expect, it, vi } from "vitest";

vi.mock("../../../db/mysql.js", () => ({ db: { query: vi.fn().mockRejectedValue(new Error("db down")) } }));
vi.mock("../../../cron/metaLeadSync.cron.js", () => ({ getLastMetaSyncSummary: () => { throw new Error("boom"); } }));
vi.mock("../../meta-campaign/meta-api.client.js", () => ({ isMetaConfigured: () => { throw new Error("boom"); } }));

import { evaluateHealth, overallLevel, type HealthSnapshot } from "../he-pipeline-health.js";
import { collectHealthSnapshot, tokenValidFromProbe } from "../he-pipeline-health.service.js";

const NOW = new Date("2026-10-07T12:00:00Z");
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000);
const base: HealthSnapshot = {
  metaConfigured: true, tokenValid: true, lastLeadAt: ago(10), leadsLast24h: 10, avgLeadsPerDay14d: 10,
  lastSyncFinishedAt: ago(10), lastSyncImported: 1, formErrorsLastRun: 0, schedulerRunning: true,
  whatsappFailed24h: 0, whatsappSent24h: 0, followupOverdue: 0,
};
const lvl = (patch: Partial<HealthSnapshot>, key: string) =>
  evaluateHealth({ ...base, ...patch }, NOW).find((c) => c.key === key)!.level;

describe("evaluateHealth", () => {
  it("healthy snapshot is all ok", () => {
    expect(evaluateHealth(base, NOW).every((c) => c.level === "ok")).toBe(true);
  });
  it("meta_configured", () => {
    expect(lvl({ metaConfigured: false }, "meta_configured")).toBe("critical");
    expect(lvl({}, "meta_configured")).toBe("ok");
  });
  it("token", () => {
    expect(lvl({ tokenValid: false }, "token")).toBe("critical");
    expect(lvl({ tokenValid: true }, "token")).toBe("ok");
    expect(lvl({ tokenValid: null }, "token")).toBe("warn");
  });
  it("lead_intake", () => {
    expect(lvl({ leadsLast24h: 0, avgLeadsPerDay14d: 5 }, "lead_intake")).toBe("critical");
    expect(lvl({ leadsLast24h: 0, avgLeadsPerDay14d: 3 }, "lead_intake")).toBe("critical");
    expect(lvl({ leadsLast24h: 0, avgLeadsPerDay14d: 2 }, "lead_intake")).toBe("ok");
    expect(lvl({ leadsLast24h: 1, avgLeadsPerDay14d: 10 }, "lead_intake")).toBe("warn");
    expect(lvl({ leadsLast24h: 3, avgLeadsPerDay14d: 10 }, "lead_intake")).toBe("ok");
    expect(lvl({ leadsLast24h: 2, avgLeadsPerDay14d: 10 }, "lead_intake")).toBe("warn");
  });
  it("sync_recent", () => {
    expect(lvl({ lastSyncFinishedAt: ago(181) }, "sync_recent")).toBe("critical");
    expect(lvl({ lastSyncFinishedAt: ago(179) }, "sync_recent")).toBe("ok");
    expect(lvl({ schedulerRunning: false }, "sync_recent")).toBe("warn");
    expect(lvl({ lastSyncFinishedAt: null }, "sync_recent")).toBe("warn");
  });
  it("form_errors", () => {
    expect(lvl({ formErrorsLastRun: 1 }, "form_errors")).toBe("warn");
    expect(lvl({ formErrorsLastRun: 0 }, "form_errors")).toBe("ok");
    expect(lvl({ formErrorsLastRun: null }, "form_errors")).toBe("ok");
  });
  it("whatsapp_failures", () => {
    expect(lvl({ whatsappSent24h: 10, whatsappFailed24h: 10 }, "whatsapp_failures")).toBe("critical");
    expect(lvl({ whatsappSent24h: 11, whatsappFailed24h: 9 }, "whatsapp_failures")).toBe("warn");
    expect(lvl({ whatsappSent24h: 2, whatsappFailed24h: 2 }, "whatsapp_failures")).toBe("warn");
    expect(lvl({ whatsappSent24h: 16, whatsappFailed24h: 4 }, "whatsapp_failures")).toBe("warn");
    expect(lvl({ whatsappSent24h: 17, whatsappFailed24h: 3 }, "whatsapp_failures")).toBe("ok");
  });
  it("followup_overdue", () => {
    expect(lvl({ followupOverdue: 1 }, "followup_overdue")).toBe("warn");
    expect(lvl({ followupOverdue: 0 }, "followup_overdue")).toBe("ok");
  });
  it("null lead counts are critical, never healthy", () => {
    expect(lvl({ leadsLast24h: null }, "lead_intake")).toBe("critical");
    expect(lvl({ avgLeadsPerDay14d: null }, "lead_intake")).toBe("critical");
    const c = evaluateHealth({ ...base, leadsLast24h: null, avgLeadsPerDay14d: null }, NOW).find((x) => x.key === "lead_intake")!;
    expect(c.detail).toBe("Could not read lead counts from the database");
  });
  it("null whatsapp counts warn", () => {
    expect(lvl({ whatsappSent24h: null, whatsappFailed24h: null }, "whatsapp_failures")).toBe("warn");
    expect(lvl({ whatsappSent24h: 5, whatsappFailed24h: null }, "whatsapp_failures")).toBe("warn");
    expect(evaluateHealth({ ...base, whatsappSent24h: null }, NOW).find((x) => x.key === "whatsapp_failures")!.detail).toBe("Check unavailable");
  });
  it("null overdue warns", () => {
    expect(lvl({ followupOverdue: null }, "followup_overdue")).toBe("warn");
  });
  it("output carries no candidate data keys", () => {
    for (const c of evaluateHealth(base, NOW)) expect(Object.keys(c).sort()).toEqual(["detail", "key", "label", "level"]);
  });
});

describe("pinbot quality and inbound checks", () => {
  const find = (patch: Partial<HealthSnapshot>, key: string) => evaluateHealth({ ...base, ...patch }, NOW).find((c) => c.key === key);
  it("pinbot_quality maps the rating", () => {
    expect(find({ pinbotQuality: "GREEN" }, "pinbot_quality")!.level).toBe("ok");
    expect(find({ pinbotQuality: "YELLOW" }, "pinbot_quality")).toMatchObject({ level: "warn", detail: "Quality YELLOW: follow-up sends halved" });
    expect(find({ pinbotQuality: "RED" }, "pinbot_quality")).toMatchObject({ level: "critical", detail: "Quality RED: new follow-up sends paused" });
    expect(find({ pinbotQuality: "UNKNOWN" }, "pinbot_quality")).toMatchObject({ level: "warn", detail: "Quality unknown: follow-up sends halved" });
    expect(find({ pinbotQuality: null }, "pinbot_quality")).toMatchObject({ level: "warn", detail: "Quality unknown: follow-up sends halved" });
  });
  it("no pinbot_quality or whatsapp_inbound check when the fields are absent", () => {
    expect(find({}, "pinbot_quality")).toBeUndefined();
    expect(find({}, "whatsapp_inbound")).toBeUndefined();
  });
  it("whatsapp_inbound", () => {
    expect(find({ whatsappSent24h: 20, whatsappFailed24h: 0, inboundWa24h: 0 }, "whatsapp_inbound")).toMatchObject({
      level: "critical", detail: "No candidate replies reached HRMS in 24 h while 20 were sent: check the Pinbot webhook" });
    expect(find({ whatsappSent24h: 19, inboundWa24h: 0 }, "whatsapp_inbound")!.level).toBe("warn");
    expect(find({ whatsappSent24h: 1, inboundWa24h: 0 }, "whatsapp_inbound")!.level).toBe("warn");
    expect(find({ whatsappSent24h: 0, inboundWa24h: 0 }, "whatsapp_inbound")!.level).toBe("ok");
    expect(find({ whatsappSent24h: 50, inboundWa24h: 1 }, "whatsapp_inbound")!.level).toBe("ok");
    expect(find({ inboundWa24h: null }, "whatsapp_inbound")).toMatchObject({ level: "warn", detail: "Check unavailable" });
    expect(find({ whatsappSent24h: null, inboundWa24h: 0 }, "whatsapp_inbound")!.level).toBe("warn");
  });
});

describe("overallLevel", () => {
  it("returns the worst", () => {
    const c = (level: "ok" | "warn" | "critical") => ({ key: "k", label: "l", level, detail: "" });
    expect(overallLevel([])).toBe("ok");
    expect(overallLevel([c("ok"), c("warn")])).toBe("warn");
    expect(overallLevel([c("warn"), c("critical"), c("ok")])).toBe("critical");
  });
});

describe("collectHealthSnapshot", () => {
  it("resolves with nulls (never zeros) when every probe fails", async () => {
    const s = await collectHealthSnapshot();
    expect(s.lastLeadAt).toBeNull();
    expect(s.leadsLast24h).toBeNull();
    expect(s.avgLeadsPerDay14d).toBeNull();
    expect(s.lastSyncFinishedAt).toBeNull();
    expect(s.whatsappSent24h).toBeNull();
    expect(s.whatsappFailed24h).toBeNull();
    expect(s.followupOverdue).toBeNull();
    expect(s.inboundWa24h).toBeNull();
    expect(s.pinbotQuality).toBeNull();
    expect(s.tokenValid).toBeNull();
  });
});

describe("tokenValidFromProbe", () => {
  it("maps status and Graph error code", () => {
    expect(tokenValidFromProbe(200, null)).toBe(true);
    expect(tokenValidFromProbe(400, 190)).toBe(false);
    expect(tokenValidFromProbe(400, 4)).toBeNull();
    expect(tokenValidFromProbe(403, null)).toBeNull();
    expect(tokenValidFromProbe(500, null)).toBeNull();
    expect(tokenValidFromProbe(null, null)).toBeNull();
  });
});
