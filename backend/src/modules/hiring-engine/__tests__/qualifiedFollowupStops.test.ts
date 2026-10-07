import { beforeEach, describe, expect, it, vi } from "vitest";

const execute = vi.hoisted(() => vi.fn());
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));
vi.mock("../../../logger.js", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

import { expireStaleClaims, runStopChecks, syncWaReceipts } from "../qualified-followup.stops.js";

const facts = (o: Record<string, unknown> = {}) => ({
  id: "r1", mobile10: "9876543210", email: "a@b.in", lead_status: null, consent_revoked: 0, he_replied: 0, meta_replied: 0,
  ats_stage: null, jr_id: "req-1", approval_status: "approved", active_status: 1, closed_at: null, requested_headcount: 10, fulfilled_headcount: 1, ...o,
});
const updates = () => execute.mock.calls.filter(([sql]) => /^\s*UPDATE/.test(String(sql)));

beforeEach(() => {
  execute.mockReset();
  execute.mockResolvedValue([{ affectedRows: 1 }]);
});

describe("runStopChecks", () => {
  it("opted_out wins over replied; UPDATE carries the reason and row id", async () => {
    execute.mockResolvedValueOnce([[facts({ lead_status: "opted_out", he_replied: 1 })]]);
    const r = await runStopChecks("live");
    expect(r).toEqual({ checked: 1, stopped: { opted_out: 1 } });
    const [sql, params] = updates()[0];
    expect(params).toEqual(["opted_out", "r1"]);
    expect(sql).toContain("call_state = IF(call_state = 'pending', 'skipped', call_state)");
  });
  it("a revoked whatsapp consent stops as opted_out", async () => {
    execute.mockResolvedValueOnce([[facts({ consent_revoked: 1 })]]);
    expect((await runStopChecks("live")).stopped).toEqual({ opted_out: 1 });
  });
  it("only a meta_lead_messages inbound reply stops as replied", async () => {
    execute.mockResolvedValueOnce([[facts({ meta_replied: 1 })]]);
    expect((await runStopChecks("live")).stopped).toEqual({ replied: 1 });
    expect(updates()[0][1]).toEqual(["replied", "r1"]);
  });
  it("inactive requisition stops as requisition_closed; an open one issues no UPDATE", async () => {
    execute.mockResolvedValueOnce([[facts({ active_status: 0 })]]);
    expect((await runStopChecks("live")).stopped).toEqual({ requisition_closed: 1 });
    execute.mockReset();
    execute.mockResolvedValueOnce([[facts()]]);
    expect(await runStopChecks("live")).toEqual({ checked: 1, stopped: {} });
    expect(updates()).toHaveLength(0);
  });
  it("joined via ATS stage; no mobile and no email stops as no_contact_details", async () => {
    execute.mockResolvedValueOnce([[facts({ ats_stage: "Payroll_Validated" }), facts({ id: "r2", mobile10: "123", email: null })]]);
    expect((await runStopChecks("live")).stopped).toEqual({ joined: 1, no_contact_details: 1 });
  });
  it("joined via he_lead.status; an email with an invalid mobile does NOT stop", async () => {
    execute.mockResolvedValueOnce([[facts({ lead_status: "joined" }), facts({ id: "r2", mobile10: "123" })]]);
    expect((await runStopChecks("live")).stopped).toEqual({ joined: 1 });
    expect(updates()).toHaveLength(1);
  });
  it("pages past the limit so later open rows are also checked", async () => {
    execute
      .mockResolvedValueOnce([[facts({ id: "a1" }), facts({ id: "a2" })]])
      .mockResolvedValueOnce([[facts({ id: "a3", lead_status: "opted_out" })]]);
    const r = await runStopChecks("live", 2);
    expect(r).toEqual({ checked: 3, stopped: { opted_out: 1 } });
    expect(execute.mock.calls[1][0]).toContain("qf.id > ?");
    expect(execute.mock.calls[1][1]).toEqual(["live", "a2"]);
    expect(updates()[0][1]).toEqual(["opted_out", "a3"]);
  });
  it("selection skips finished rows (only rows with pending work)", async () => {
    execute.mockResolvedValueOnce([[]]);
    await runStopChecks("live");
    const sql = String(execute.mock.calls[0][0]);
    expect(sql).toContain("qf.email_status IS NULL OR qf.email_status = 'sending'");
    expect(sql).toContain("qf.wa_status IS NULL OR qf.wa_status = 'sending'");
    expect(sql).toContain("qf.call_state = 'pending'");
  });
  it("one failing UPDATE does not abort the batch", async () => {
    execute.mockResolvedValueOnce([[facts({ id: "x1", lead_status: "opted_out" }), facts({ id: "x2", lead_status: "opted_out" })]])
      .mockRejectedValueOnce(new Error("deadlock"));
    expect((await runStopChecks("live")).stopped).toEqual({ opted_out: 1 });
    expect(updates()).toHaveLength(2);
  });
  it("the fact query filters on mode_at_enqueue with the given tag and a bounded limit", async () => {
    execute.mockResolvedValueOnce([[]]);
    await runStopChecks("test", 50);
    const [sql, params] = execute.mock.calls[0];
    expect(sql).toContain("mode_at_enqueue = ?");
    expect(sql).toContain("LIMIT 50");
    expect(sql).toContain("COLLATE utf8mb4_unicode_ci");
    expect(params).toEqual(["test"]);
  });
});

describe("syncWaReceipts", () => {
  it("one UPDATE joined to he_message on wa_message_id for failed deliveries", async () => {
    execute.mockResolvedValueOnce([{ affectedRows: 3 }]);
    expect(await syncWaReceipts("live")).toBe(3);
    expect(execute).toHaveBeenCalledTimes(1);
    const [sql, params] = execute.mock.calls[0];
    expect(sql).toMatch(/JOIN he_message hm ON hm\.id = qf\.wa_message_id/);
    expect(sql).toContain("hm.delivery_status = 'failed'");
    expect(sql).toContain("qf.wa_status = 'failed'");
    expect(params).toEqual(["live"]);
    expect(sql).toContain("'test_sent'");
  });
});

describe("expireStaleClaims", () => {
  it("fails stale sending claims with the unknown-outcome text and a 15-minute cutoff", async () => {
    const now = new Date("2026-10-07T10:00:00+05:30");
    execute.mockResolvedValueOnce([{ affectedRows: 1 }]).mockResolvedValueOnce([{ affectedRows: 2 }]);
    expect(await expireStaleClaims("live", now)).toBe(3);
    const [sql, params] = execute.mock.calls[0];
    expect(sql).toContain("= 'sending'");
    expect(sql).toContain("COALESCE(step_claimed_at, updated_at) < ?");
    expect(params[0]).toBe("outcome unknown (process stopped mid-send)");
    expect(params[1]).toBe("live");
    expect(params[2].getTime()).toBe(now.getTime() - 15 * 60_000);
    expect(String(execute.mock.calls[1][0])).toContain("wa_status = 'failed'");
  });
});
