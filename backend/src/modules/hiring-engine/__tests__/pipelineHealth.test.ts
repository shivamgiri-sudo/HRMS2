import { describe, expect, it, vi } from "vitest";

vi.mock("../../../db/mysql.js", () => ({ db: { query: vi.fn().mockRejectedValue(new Error("db down")) } }));
vi.mock("../../../cron/metaLeadSync.cron.js", () => ({ getLastMetaSyncSummary: () => { throw new Error("boom"); } }));
vi.mock("../../meta-campaign/meta-api.client.js", () => ({ isMetaConfigured: () => { throw new Error("boom"); } }));

import { evaluateHealth, overallLevel, type HealthSnapshot } from "../he-pipeline-health.js";
import { collectHealthSnapshot } from "../he-pipeline-health.service.js";

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
  it("output carries no candidate data keys", () => {
    for (const c of evaluateHealth(base, NOW)) expect(Object.keys(c).sort()).toEqual(["detail", "key", "label", "level"]);
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
  it("resolves with nulls and zeroes when every probe fails", async () => {
    const s = await collectHealthSnapshot();
    expect(s.lastLeadAt).toBeNull();
    expect(s.leadsLast24h).toBe(0);
    expect(s.avgLeadsPerDay14d).toBe(0);
    expect(s.lastSyncFinishedAt).toBeNull();
    expect(s.whatsappSent24h).toBe(0);
    expect(s.whatsappFailed24h).toBe(0);
    expect(s.followupOverdue).toBe(0);
    expect(s.tokenValid).toBeNull();
  });
});
