import { beforeEach, describe, expect, it, vi } from "vitest";

const execute = vi.hoisted(() => vi.fn());
const logger = vi.hoisted(() => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));
vi.mock("../../../logger.js", () => ({ logger }));
vi.mock("../../communication/email.service.js", () => ({ emailService: { send: vi.fn() } }));

import { readSwitches } from "../qualified-followup.policy.js";
import { buildDailyReport, type DailyReportData } from "../qualified-followup.report.js";
import { collectUnifiedReport, emptySourceDay, unifiedSubject, type UnifiedReport } from "../qualified-followup.report-unified.js";

const from = new Date("2026-10-08T08:30:00+05:30");
const to = new Date("2026-10-09T08:30:00+05:30");
const s = readSwitches({ QUAL_FOLLOWUP_MODE: "live" } as NodeJS.ProcessEnv);

type Routes = Partial<Record<"rows" | "msgs" | "held" | "stops" | "wafail" | "skips" | "budget" | "multipath" | "inbound" | "verified" | "shadow" | "enginesends" | "legacysends", unknown[]>>;
function route(r: Routes) {
  execute.mockImplementation(async (sql: string) => {
    const q = String(sql);
    const m = /\/\* uf:([a-z]+) \*\//.exec(q);
    if (m) return [r[m[1] as keyof Routes] ?? []];
    if (q.includes("direction = 'in' AND channel = 'whatsapp'")) return [r.inbound ?? [{ last_at: null, n7: 0 }]];
    if (q.includes("wa_inbound_verified")) return [r.verified ?? []];
    return [[]];
  });
}

const legacyBase = (): DailyReportData => ({
  date: "2026-10-09", mode: "live", perSource: [], skipped: [], waFailuresByCode: [], blockedByReason: [], callFiles: [],
});

beforeEach(() => { execute.mockReset(); Object.values(logger).forEach((f) => f.mockReset()); });

describe("collectUnifiedReport", () => {
  it("one section per source with stage A and stage B counts", async () => {
    route({
      rows: [{ source_type: "meta_live", tag: "live", enrolled: 3, booked: 2, email: 2, whatsapp: 2, calls: 1, call_file: 1, replied: 1, confirmed: 1, arrived: 1, no_show: 1 }],
      msgs: [
        { source_type: "meta_live", tag: "live", k: "he_walkin_confirmed", n: 1 }, { source_type: "meta_live", tag: "live", k: "he_reminder_1d", n: 2 },
        { source_type: "meta_live", tag: "live", k: "he_reminder_2h_location", n: 3 }, { source_type: "meta_live", tag: "live", k: "he_no_show_recovery", n: 1 },
        { source_type: "meta_live", tag: "live", k: "he_other_role_offer", n: 4 }, { source_type: "meta_live", tag: "live", k: "he_missed_call", n: 1 },
        { source_type: "meta_live", tag: "live", k: "he_reinvite", n: 2 }, { source_type: "meta_live", tag: "live", k: "he_walkin_invite", n: 2 },
      ],
    });
    const u = await collectUnifiedReport(from, to, s, "GREEN");
    expect(u.sources.map((x) => x.source)).toEqual(["meta_live", "meta_old", "he"]);
    const ml = u.sources[0];
    expect(ml.tag).toBe("live");
    expect(ml.enrolled).toBe(3);
    expect(ml.booked).toBe(2);
    expect(ml.stageA).toEqual({ email: 2, whatsapp: 2, call: 1, callFile: 1, t9: 1 });
    expect(ml.stageB).toEqual({ replied: 1, confirmed: 1, t2: 1, d1: 2, t4: 3, arrived: 1, noShow: 1, t6: 1, reinvited: 2, t7: 4 });
    expect(u.sources[1]).toEqual(emptySourceDay("meta_old", s.sourceModes.meta_old));
    expect(u.sent).toBe(16);
    expect(u.enrolled).toBe(3);
    // every message counted is the follow-up worker's own
    const msgSql = execute.mock.calls.map(([q]) => String(q)).find((q) => q.includes("/* uf:msgs */"))!;
    expect(msgSql).toContain("sent_by = 'followup'");
  });

  it("a source enrolled under two tags gets two sections", async () => {
    route({ rows: [{ source_type: "he", tag: "canary", enrolled: 1 }, { source_type: "he", tag: "dry_run", enrolled: 4 }] });
    const u = await collectUnifiedReport(from, to, s, "GREEN");
    expect(u.sources.filter((x) => x.source === "he").map((x) => [x.tag, x.enrolled])).toEqual([["canary", 1], ["dry_run", 4]]);
  });

  it("held counts by reason (held_manual, held_best_offer, branch_cap, wa_budget)", async () => {
    route({ held: [
      { source_type: "meta_live", tag: "live", reason: "held_manual", n: 2 }, { source_type: "meta_live", tag: "live", reason: "held_best_offer", n: 1 },
      { source_type: "meta_live", tag: "live", reason: "branch_cap", n: 5 }, { source_type: "meta_live", tag: "live", reason: "wa_budget", n: 7 },
    ] });
    const u = await collectUnifiedReport(from, to, s, "GREEN");
    expect(u.sources[0].held).toEqual({ held_manual: 2, held_best_offer: 1, branch_cap: 5, wa_budget: 7 });
    const sql = execute.mock.calls.map(([q]) => String(q)).find((q) => q.includes("/* uf:held */"))!;
    expect(sql).toContain("journey_state NOT IN ('stopped','declined')");
  });

  it("ineligible_* stop reasons are listed", async () => {
    route({ stops: [{ source_type: "he", tag: "live", reason: "ineligible_closed", n: 2 }, { source_type: "he", tag: "live", reason: "opted_out", n: 1 }] });
    const u = await collectUnifiedReport(from, to, s, "GREEN");
    const he = u.sources.find((x) => x.source === "he")!;
    expect(he.stopped).toEqual({ ineligible_closed: 2, opted_out: 1 });
    const html = buildDailyReport({ ...legacyBase(), unified: u }).html;
    expect(html).toContain("ineligible_closed 2");
  });

  it("guard skips by reason and WhatsApp failures by code per source", async () => {
    route({
      skips: [{ source_type: "meta_old", tag: "live", reason: "quiet_hours", n: 3 }],
      wafail: [{ source_type: "meta_old", tag: "live", wa_error: "(#131026) undeliverable 9876543210" }, { source_type: "meta_old", tag: "live", wa_error: "(#131026) x" }],
    });
    const u = await collectUnifiedReport(from, to, s, "GREEN");
    const mo = u.sources.find((x) => x.source === "meta_old")!;
    expect(mo.skips).toEqual({ quiet_hours: 3 });
    expect(mo.waFailuresByCode).toEqual([{ code: "131026", count: 2 }]);
  });

  it("multi-path counts a person messaged by the engine and the worker the same day; 0 when only the worker", async () => {
    route({ multipath: [{ mobile10: "9876543210" }] });
    const u = await collectUnifiedReport(from, to, s, "GREEN");
    expect(u.multiPath).toEqual({ people: 1, samples: ["xxxxxx3210"] });
    const sql = execute.mock.calls.map(([q]) => String(q)).find((q) => q.includes("/* uf:multipath */"))!;
    expect(sql).toContain("sent_by = 'followup'");
    expect(sql).toMatch(/sent_by IS NULL OR \w+\.sent_by <> 'followup'/);
    expect(sql).toContain("notification_sent_at");
    expect(sql).toContain("meta_lead_messages");
    route({ multipath: [] });
    expect((await collectUnifiedReport(from, to, s, "GREEN")).multiPath).toEqual({ people: 0, samples: [] });
  });

  it("budget shows used vs max x quality and transactional separately", async () => {
    route({ budget: [{ used: 120, transactional: 7 }] });
    const u = await collectUnifiedReport(from, to, { ...s, waDailyMax: 500 }, "YELLOW");
    expect(u.budget).toEqual({ max: 250, configuredMax: 500, quality: "YELLOW", used: 120, transactional: 7 });
    const r = buildDailyReport({ ...legacyBase(), unified: u });
    expect(r.text).toContain("WhatsApp budget: 120 of 250 used (quality YELLOW, configured 500); transactional 7 (not counted)");
  });

  it("inbound health line says \"not verified\" when the flag is 0", async () => {
    route({ inbound: [{ last_at: "2026-10-08 11:00:00", n7: 4 }], verified: [{ param_key: "policy.followup.wa_inbound_verified", value: 0 }] });
    const u = await collectUnifiedReport(from, to, s, "GREEN");
    expect(u.inbound).toEqual({ lastInboundAt: "2026-10-08 11:00:00", inbound7d: 4, verified: false });
    expect(buildDailyReport({ ...legacyBase(), unified: u }).text).toContain("Pinbot inbound: not verified");
    route({ verified: [{ param_key: "policy.followup.wa_inbound_verified", value: 1 }] });
    expect(buildDailyReport({ ...legacyBase(), unified: await collectUnifiedReport(from, to, s, "GREEN") }).text).toContain("Pinbot inbound: verified");
  });

  it("a failing part leaves the rest of the report (logged without numbers)", async () => {
    execute.mockImplementation(async (sql: string) => {
      if (String(sql).includes("/* uf:multipath */")) throw new Error("boom 9876543210");
      return [[]];
    });
    const u = await collectUnifiedReport(from, to, s, null);
    expect(u.multiPath).toBeNull();
    expect(u.sources).toHaveLength(3);
    expect(JSON.stringify(logger.warn.mock.calls)).not.toMatch(/\d{10}/);
    expect(buildDailyReport({ ...legacyBase(), unified: u }).text).toContain("Multi-path: unavailable");
  });
});

describe("buildDailyReport with the unified sections", () => {
  const u = (): UnifiedReport => ({
    day: "2026-10-09", enrolled: 12, sent: 30,
    sources: [{ ...emptySourceDay("meta_live", "live"), enrolled: 12, held: { branch_cap: 1 } }, emptySourceDay("meta_old", "off"), emptySourceDay("he", "off")],
    budget: { max: 500, configuredMax: 500, quality: "GREEN", used: 10, transactional: 2 },
    multiPath: { people: 2, samples: ["xxxxxx3210", "xxxxxx1111"] },
    inbound: { lastInboundAt: null, inbound7d: 0, verified: false },
    shadow: { matched: 3, unifiedOnly: { whatsapp: 2 }, legacyOnly: { engine: { quiet_hours: 1 }, legacy_meta: { not_enrolled: 4 } }, samples: ["xxxxxx3210 2026-10-08 engine-only he_walkin_invite (quiet_hours)"] },
  });

  it("subject carries enrolled, sent and multi-path", () => {
    expect(buildDailyReport({ ...legacyBase(), unified: u() }).subject).toBe("Follow-up daily report 2026-10-09 — 12 enrolled, 30 sent, multi-path 2");
    expect(unifiedSubject(u())).toBe("Follow-up daily report 2026-10-09 — 12 enrolled, 30 sent, multi-path 2");
  });

  it("one section per source, the shadow comparison and the multi-path samples", () => {
    const r = buildDailyReport({ ...legacyBase(), unified: u() });
    for (const h of ["meta_live (live)", "meta_old (off)", "he (off)", "Shadow comparison", "Multi-path"]) expect(r.html).toContain(h);
    expect(r.text).toContain("matched 3");
    expect(r.text).toContain("engine-only: quiet_hours 1");
    expect(r.text).toContain("legacy-only: not_enrolled 4");
    expect(r.text).toContain("unified-only: whatsapp 2");
    expect(r.text).toContain("held: branch_cap 1");
  });

  it("no mobile numbers in the html/text except masked", () => {
    const r = buildDailyReport({ ...legacyBase(), unified: u() });
    expect(r.html).toContain("xxxxxx3210");
    expect(r.html).not.toMatch(/\d{10}/);
    expect(r.text).not.toMatch(/\d{10}/);
  });

  it("without the unified part the report and subject are unchanged", () => {
    expect(buildDailyReport(legacyBase()).subject).toBe("[HRMS] Qualified follow-up daily report 2026-10-09 (live)");
  });
});

describe("scrubbing keeps dates readable", () => {
  it("dates and times survive, phone-like runs do not", () => {
    const u: UnifiedReport = { day: "2026-10-09", enrolled: 0, sent: 0, sources: [], budget: null, multiPath: null, shadow: null,
      inbound: { lastInboundAt: "2026-10-09 12:54:30", inbound7d: 1, verified: true } };
    const r = buildDailyReport({ ...legacyBase(), unified: u });
    expect(r.text).toContain("last inbound 2026-10-09 12:54:30");
    const sh = { ...u, shadow: { matched: 0, unifiedOnly: {}, legacyOnly: { engine: {}, legacy_meta: {} }, samples: ["xxxxxx0002 2026-10-09 unified-only email", "leak 98765 43210 +919876543210"] } };
    const t = buildDailyReport({ ...legacyBase(), unified: sh }).text;
    expect(t).toContain("xxxxxx0002 2026-10-09 unified-only email");
    expect(t).not.toMatch(/98765|9876543210/);
  });
});
