import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** Pin of the engine's invite and follow-up SQL (QUAL_FOLLOWUP_MODE unset) taken before the row-based follow-up skip rule. */
const h = vi.hoisted(() => ({ sqls: [] as string[] }));
vi.mock("../../../db/mysql.js", () => ({
  db: { execute: vi.fn(async (sql: string) => { h.sqls.push(sql.replace(/\s+/g, " ").trim()); return [[]]; }) },
}));
vi.mock("../../communication/providers/whatsapp/pinbot.provider.js", () => ({ PinbotWhatsAppProvider: class { isConfigured() { return true; } async sendTemplate() { return { success: true }; } } }));
vi.mock("../he-lead.service.js", () => ({ addEvent: vi.fn(), hasConsent: vi.fn(async () => false), setLeadStatus: vi.fn(), revokeConsent: vi.fn(), persistSignals: vi.fn(), findLeadByMobile: vi.fn(), upsertLead: vi.fn() }));
vi.mock("../he-campaign-config.service.js", () => ({ channelAllowed: vi.fn(async () => true) }));
vi.mock("../he-policy.service.js", () => ({ whatsappRequiresOptIn: vi.fn(async () => false) }));
vi.mock("../he-followup-email.service.js", () => ({ sendFollowUpEmail: vi.fn(async () => ({ status: "dry_run" })) }));
vi.mock("../he-superbot.service.js", () => ({ dequeueSuperbotForMatch: vi.fn() }));
vi.mock("../he-master.service.js", () => ({ refreshLeadHistoryById: vi.fn() }));
vi.mock("../he-bot.service.js", () => ({ answerCandidateQuestion: vi.fn(), isLocationTap: vi.fn(() => false), sendLocationLink: vi.fn() }));
vi.mock("../he-insight.service.js", () => ({ recomputeInsight: vi.fn() }));
vi.mock("../qualified-followup.attention.js", () => ({ markFollowupCalled: vi.fn() }));
vi.mock("../candidate-response.service.js", () => ({ recordResponseSafe: vi.fn() }));

import { inviteForDrive, runFollowUps } from "../he-engine.service.js";

const KEYS = ["QUAL_FOLLOWUP_MODE", "QUAL_FOLLOWUP_TEST_MODE", "HE_SENDS_PAUSED"] as const;
const saved: Record<string, string | undefined> = {};
beforeEach(() => { h.sqls = []; for (const k of KEYS) { saved[k] = process.env[k]; delete process.env[k]; } });
afterEach(() => { for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

describe("engine SQL pin (follow-up mode unset)", () => {
  it("inviteForDrive dry run", async () => {
    await inviteForDrive("D1", { dryRun: true, max: 5 });
    expect(h.sqls).toMatchSnapshot();
  });
  it("runFollowUps dry run", async () => {
    await runFollowUps({ dryRun: true });
    expect(h.sqls).toMatchSnapshot();
  });
});
