import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Legacy Meta outreach retired per source mode (unified Task 14), Pinbot as the only WhatsApp, manual Notify = enrol and run now.
 */
const h = vi.hoisted(() => ({
  sqls: [] as Array<{ sql: string; p: unknown[] }>, calls: [] as unknown[][], pinbotOn: true, owned: false, closed: false, sync: [] as Array<Record<string, unknown>>,
  enqueue: vi.fn(async () => ({ status: "enqueued", id: "F1" })), run: vi.fn(async () => ({ step: "email", result: "sent" })), optedOut: false,
}));
vi.mock("../../../db/mysql.js", () => ({
  db: {
    execute: vi.fn(async (sql: string, p: unknown[] = []) => {
      const q = sql.replace(/\s+/g, " ").trim();
      h.sqls.push({ sql: q, p });
      if (q.includes("FROM meta_lead_raw ml")) {
        return [[{ id: "L1", parsed_name: "Asha Rao", parsed_phone: "9876543210", parsed_email: "a@x.in", screening_result: "qualified", notification_sent_at: null,
          requisition_id: "R1", campaign_id: "C1", designation_name: "CSE", branch_name: "NOIDA-2", requisition_code: "R1", bmi_assessment_url: "https://bmi.test/x", salary_min: null, salary_max: null,
          approval_status: "approved", active_status: 1, closed_at: h.closed ? "2026-10-01 10:00:00" : null, requested_headcount: 5, fulfilled_headcount: 0, parsed_location: "Noida",
          current_address: null, permanent_address: null, branch_state: "UP", branch_address: "Sector 62, Noida", branch_city: "Noida", branch_lat: null, branch_lng: null }]];
      }
      if (q.startsWith("SELECT id") && q.includes("FROM meta_lead_raw") && q.includes("notification_sent_at IS NULL")) {
        // The sync splits held (auto_notify off / backfill, computed in SQL) from eligible leads with HAVING on the select aliases.
        const held = (r: any) => Number(r.auto_notify_off) === 1 || Number(r.is_backfill) === 1;
        return [(h.sync as any[]).filter((r) => (q.includes("HAVING (auto_notify_off = 1 OR is_backfill = 1)") ? held(r) : !held(r)))];
      }
      if (q.includes("FROM meta_lead_raw r") && q.includes("EXISTS (SELECT 1 FROM qualified_followup qf")) return [h.owned ? [{ hit: 1 }] : []];
      if (q.startsWith("SELECT requisition_id FROM meta_lead_raw WHERE id = ?")) return [[{ requisition_id: "R1" }]];
      if (q.includes("FROM he_model_param")) return [[{ param_key: "policy.followup.meta_live", value: Number(process.env.UF_META_LIVE ?? 0) }, { param_key: "policy.followup.wa_inbound_ack", value: 1 }]];
      if (q.includes("FROM followup_canary")) return [[{ source_type: "meta_live", requisition_id: "R1" }]];
      return [[]];
    }),
  },
}));
vi.mock("../../communication/providers/whatsapp/pinbot.provider.js", () => ({
  PinbotWhatsAppProvider: class { isConfigured() { return h.pinbotOn; } async sendTemplate(...a: unknown[]) { h.calls.push(["pinbot", ...a]); return { success: true }; } },
}));
vi.mock("../../communication/providers/provider.factory.js", () => ({ providerFactory: { getProviderAsync: vi.fn(async () => ({ getName: () => "db-whatsapp", isConfigured: () => true, send: async (...a: unknown[]) => { h.calls.push(["db_provider", ...a]); return { success: true }; } })) } }));
vi.mock("../../communication/provider-config.service.js", () => ({ providerConfigService: { loadActiveConfig: vi.fn(async () => null) } }));
vi.mock("../../communication/email.service.js", () => ({ emailService: { isConfigured: () => true, send: async (m: { to: string; subject: string }) => { h.calls.push(["email", m.to, m.subject]); } } }));
vi.mock("../voicebot.provider.js", () => ({ triggerVoiceCall: vi.fn(), isVoicebotConfigured: () => false }));
vi.mock("../vapi-voicebot.provider.js", () => ({ triggerVapiCallWithInlineScript: vi.fn(), isVapiConfigured: () => false }));
vi.mock("../interview-slot.service.js", () => ({ assignInterviewSlot: vi.fn(async () => ({ date: "2026-10-10", time: "11:00:00", dateLabel: "Sat 10 Oct", timeLabel: "11:00 AM" })) }));
vi.mock("../../hiring-engine/he-campaign-config.service.js", () => ({ metaOutreachBlockedByEngine: vi.fn(async () => null), heOwnsCampaign: vi.fn(async () => false) }));
vi.mock("../../hiring-engine/qualified-followup.service.js", async (orig) => ({ ...(await orig<typeof import("../../hiring-engine/qualified-followup.service.js")>()), personOptedOut: vi.fn(async () => h.optedOut), enqueueMetaLeadFollowup: h.enqueue }));
vi.mock("../../hiring-engine/qualified-followup.runnow.js", async (orig) => ({ ...(await orig<typeof import("../../hiring-engine/qualified-followup.runnow.js")>()), runJourneyNow: h.run }));

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { notifyQualifiedLead } from "../lead-outreach.service.js";
import { notifyNewQualifiedLeads } from "../../../cron/metaLeadSync.cron.js";

const setMode = (code: number | null) => { if (code === null) { delete process.env.QUAL_FOLLOWUP_MODE; delete process.env.UF_META_LIVE; } else { process.env.QUAL_FOLLOWUP_MODE = "live"; process.env.UF_META_LIVE = String(code); } };
beforeEach(() => { h.sqls = []; h.calls = []; h.pinbotOn = true; h.owned = false; h.closed = false; h.optedOut = false; h.sync = []; h.enqueue.mockClear(); h.run.mockClear(); setMode(null); });

describe("legacy outreach per source mode", () => {
  it("switches off, Pinbot not configured: no WhatsApp at all (Pinbot is the only provider), email still goes", async () => {
    h.pinbotOn = false;
    const out = await notifyQualifiedLead("L1");
    expect(h.calls.map((c) => c[0])).toEqual(["email"]);
    expect(out.skipped).toContainEqual({ channel: "whatsapp", reason: "Pinbot is not configured" });
  });
  it("meta_live live: the automatic call sends nothing and enrols", async () => {
    setMode(4);
    const out = await notifyQualifiedLead("L1");
    expect(h.calls).toEqual([]);
    expect(h.enqueue).toHaveBeenCalledWith("L1", expect.anything());
    expect(out.skipped).toEqual([{ channel: "all", reason: "Handled by the follow-up method" }]);
  });
  it("canary: only listed requisitions step aside", async () => {
    setMode(3);
    expect((await notifyQualifiedLead("L1")).skipped[0]?.reason).toBe("Handled by the follow-up method"); // R1 listed
  });
  it("an owned row (live / canary, open or stopped) blocks after a rollback to off", async () => {
    setMode(0); h.owned = true;
    const out = await notifyQualifiedLead("L1");
    expect(h.calls).toEqual([]);
    expect(out.skipped[0]?.reason).toBe("Handled by the follow-up method");
  });
  it("manual Notify in live: enrol and run the journey now (force = recorded HR override)", async () => {
    setMode(4);
    const out = await notifyQualifiedLead("L1", { manual: true, actor: "U-1" });
    expect(h.run).toHaveBeenCalledWith("F1", { actor: "U-1", hrOverride: false });
    expect(out.succeeded).toEqual(["followup:email"]);
    await notifyQualifiedLead("L1", { manual: true, actor: "U-1", force: true });
    expect(h.run).toHaveBeenLastCalledWith("F1", { actor: "U-1", hrOverride: true });
  });
  it("force never overrides STOP or a closed requisition", async () => {
    setMode(4); h.optedOut = true;
    expect((await notifyQualifiedLead("L1", { manual: true, force: true, actor: "U" })).skipped[0]?.reason).toBe("Candidate opted out (STOP)");
    h.optedOut = false; h.closed = true;
    expect((await notifyQualifiedLead("L1", { manual: true, force: true, actor: "U" })).skipped[0]?.reason).toMatch(/closed/);
    expect(h.run).not.toHaveBeenCalled();
  });
});

describe("30-minute sync", () => {
  it("auto_notify = 0 campaigns are not notified; the lead is enrolled (held_manual) instead", async () => {
    h.sync = [{ id: "L1", auto_notify_off: 1, is_backfill: 0 }];
    const r = await notifyNewQualifiedLeads();
    expect(h.calls).toEqual([]);
    expect(h.enqueue).toHaveBeenCalledWith("L1", expect.objectContaining({ skipOutreach: false }));
    expect(r).toEqual({ sent: 0, skipped: 1, failed: 0 });
  });
  it("a backfilled lead (Meta created it long before the import) is never messaged; enrolled held_manual skip_outreach", async () => {
    h.sync = [{ id: "L1", auto_notify_off: 0, is_backfill: 1 }];
    await notifyNewQualifiedLeads();
    expect(h.calls).toEqual([]);
    expect(h.enqueue).toHaveBeenCalledWith("L1", expect.objectContaining({ skipOutreach: true }));
  });
  it("selects with the row-based owned skip (live and canary rows) whatever the mode", async () => {
    await notifyNewQualifiedLeads();
    const q = h.sqls.find((s) => s.sql.startsWith("SELECT id") && s.sql.includes("FROM meta_lead_raw"))!.sql;
    expect(q).toContain("qf.mode_at_enqueue IN ('live','canary')");
  });
});

describe("Pinbot is the only outbound WhatsApp (owner decision O7)", () => {
  const ROOT = join(__dirname, "../../..");
  const files = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? (f === "__tests__" ? [] : files(p)) : p.endsWith(".ts") ? [p] : []; });
  it("no Wassenger, whatsapp-web.js or non-Pinbot WhatsApp provider in the candidate outreach code, and no WASSENGER_ env", () => {
    const offenders: string[] = [];
    for (const f of [...files(join(ROOT, "modules/meta-campaign")), ...files(join(ROOT, "modules/hiring-engine")), ...files(join(ROOT, "cron"))]) {
      const s = readFileSync(f, "utf8");
      if (/wassenger\.provider|whatsapp-web\.provider|twilio-whatsapp|local-whatsapp|whatsapp\/meta\.provider|getProviderAsync\(\s*['"]whatsapp|WASSENGER_/.test(s)) offenders.push(f.slice(ROOT.length));
    }
    expect(offenders).toEqual([]);
  });
});
