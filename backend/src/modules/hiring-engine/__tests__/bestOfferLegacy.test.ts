import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The follow-up email, WhatsApp and call steps as they were before best-offer holds: the exact SQL text (byte for byte), parameters,
 * order and counts, for an empty queue and for one due row per step. Written on the untouched code; the switch values below meant
 * nothing then, so every one of them must keep producing these snapshots. Never update this snapshot.
 */
const execute = vi.hoisted(() => vi.fn());
const send = vi.hoisted(() => vi.fn());
const sendTpl = vi.hoisted(() => vi.fn());
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));
vi.mock("../../../logger.js", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock("../../communication/email.service.js", () => ({ emailService: { send, isConfigured: () => true } }));
vi.mock("../he-meta-bridge.service.js", () => ({ bridgeOneMetaLead: vi.fn() }));
vi.mock("../../meta-campaign/interview-slot.service.js", () => ({ assignInterviewSlot: vi.fn() }));
vi.mock("../he-send.service.js", async (orig) => ({ ...(await orig<typeof import("../he-send.service.js")>()), sendTemplateToLead: sendTpl }));
vi.mock("../he-secrets.service.js", () => ({ superbotConfig: vi.fn(async () => null) }));

import { readSwitches } from "../qualified-followup.policy.js";
import { runEmailStep } from "../qualified-followup.email.js";
import { runWhatsappStep } from "../qualified-followup.whatsapp.js";
import { runCallStep } from "../qualified-followup.call.js";

const now = new Date("2026-10-14T05:00:00Z"); // Wed 10:30 IST, inside the send window
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;

const base = {
  source_type: "meta_live", meta_lead_id: "m1", he_lead_id: "lead-1", ats_candidate_id: null, drive_id: null, mobile10: "9876543210", email: "c@x.com",
  full_name: "asha rao", branch_name: "Noida", role_name: "Customer Support", qualified_at: "2026-10-14 09:00:00", email_attempts: 0, wa_attempts: 0, call_attempts: 0,
};
const ROWS = {
  email: { ...base, id: "e0000000-0000-0000-0000-000000000001", requisition_id: "req-e", email_due_at: "2026-10-14 10:00:00", email_status: null, wa_due_at: null, wa_status: null, call_due_at: null, call_state: "pending" },
  wa: { ...base, id: "w0000000-0000-0000-0000-000000000002", requisition_id: "req-w", email_due_at: "2026-10-14 09:10:00", email_status: "sent", wa_due_at: "2026-10-14 10:00:00", wa_status: null, call_due_at: null, call_state: "pending" },
  call: { ...base, id: "c0000000-0000-0000-0000-000000000003", requisition_id: "req-c", email_due_at: "2026-10-14 08:00:00", email_status: "sent", wa_due_at: "2026-10-14 09:00:00", wa_status: "sent", call_due_at: "2026-10-14 10:00:00", call_state: "pending" },
};

function world(withRows: boolean) {
  execute.mockImplementation(async (sql: string) => {
    const q = String(sql);
    if (!withRows) return [[]];
    if (q.includes("FROM qualified_followup qf")) {
      if (q.includes("qf.email_status IS NULL AND qf.stopped_reason")) return [[ROWS.email]];
      if (q.includes("qf.wa_status IS NULL AND qf.wa_sent_at IS NULL")) return [[ROWS.wa]];
      if (q.includes("qf.call_state = 'pending' AND")) return [[ROWS.call]];
      return [[]];
    }
    if (q.startsWith("UPDATE")) return [{ affectedRows: 1 }];
    if (q.startsWith("INSERT")) return [{ affectedRows: 1 }];
    if (q.includes("SELECT status FROM he_lead")) return [[{ status: "new" }]];
    if (q.includes("FROM branch_master")) return [[{ address: "Sector 62, Noida", latitude: null, longitude: null }]];
    if (q.includes("FROM job_requisition")) return [[{ bmi_assessment_url: "https://bmi.example/x" }]];
    if (q.includes("FROM meta_lead_raw")) return [[{ interview_date: "2026-10-15", interview_time: "10:30:00" }]];
    return [[]];
  });
}

async function run(withRows: boolean) {
  world(withRows);
  const s = readSwitches({ QUAL_FOLLOWUP_MODE: "live" } as NodeJS.ProcessEnv);
  const email = await runEmailStep(s, "live", now);
  const wa = await runWhatsappStep(s, "live", now, 10);
  const call = await runCallStep(s, "live", now);
  const statements = execute.mock.calls.map(([sql, params]) => ({
    sql: String(sql),
    params: JSON.parse(JSON.stringify(params ?? []).replace(UUID, (u) => (Object.values(ROWS).some((r) => r.id === u) ? u : "<uuid>"))),
  }));
  return { counts: { email, wa, call }, statements, sends: { email: send.mock.calls.length, wa: sendTpl.mock.calls.length } };
}

const OFF_VALUES: Array<string | undefined> = [undefined, "", "1", "yes", "on", "false", "  "];

beforeEach(() => {
  execute.mockReset(); send.mockReset(); sendTpl.mockReset();
  send.mockResolvedValue({ messageId: "mail-1" });
  sendTpl.mockResolvedValue({ status: "sent", messageId: "msg-1", providerMessageId: "p1" });
});

describe("follow-up step selects before best-offer holds", () => {
  for (const v of OFF_VALUES) {
    it(`empty queue, HE_BEST_OFFER=${JSON.stringify(v)}`, async () => {
      const prev = process.env.HE_BEST_OFFER;
      if (v === undefined) delete process.env.HE_BEST_OFFER; else process.env.HE_BEST_OFFER = v;
      try { expect(await run(false)).toMatchSnapshot("empty queue"); }
      finally { if (prev === undefined) delete process.env.HE_BEST_OFFER; else process.env.HE_BEST_OFFER = prev; }
    });
    it(`one due row per step, HE_BEST_OFFER=${JSON.stringify(v)}`, async () => {
      const prev = process.env.HE_BEST_OFFER;
      if (v === undefined) delete process.env.HE_BEST_OFFER; else process.env.HE_BEST_OFFER = v;
      try { expect(await run(true)).toMatchSnapshot("one row per step"); }
      finally { if (prev === undefined) delete process.env.HE_BEST_OFFER; else process.env.HE_BEST_OFFER = prev; }
    });
  }
});
