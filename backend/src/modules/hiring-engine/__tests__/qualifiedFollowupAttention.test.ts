import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const execute = vi.hoisted(() => vi.fn());
vi.mock("../../../db/mysql.js", () => ({ db: { execute, query: execute, getConnection: vi.fn() } }));
vi.mock("../../../logger.js", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

let actor: { id: string; role: string; roles: string[] };
vi.mock("../../../middleware/authMiddleware.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../middleware/authMiddleware.js")>();
  return { ...original, requireAuth: (req: any, _res: any, next: any) => { req.authUser = actor; next(); } };
});

import { getFollowupAudit, listAttention, markFollowupCalled, retryFollowupStep } from "../qualified-followup.attention.js";
import { heRouter } from "../he.routes.js";

const ID = "0f1e2d3c-aaaa-bbbb-cccc-0000000abcde";
const sqls = (re: RegExp) => execute.mock.calls.filter(([sql]) => re.test(String(sql)));

function appFor(role: string) {
  actor = { id: `u-${role}`, role, roles: [role] };
  const app = express();
  app.use(express.json());
  app.use("/api/he", heRouter);
  return app;
}

const waRow = (err: string, i: number) => ({ id: `id-${i}`, full_name: "Asha", mobile10: "9876543210", requisition_id: "req-1", source_type: "meta_live", err, attempts: 1, updated_at: "2026-10-07 10:00:00" });

beforeEach(() => { execute.mockReset(); vi.unstubAllEnvs(); vi.stubEnv("QUAL_FOLLOWUP_MODE", "live"); });

describe("listAttention", () => {
  it("groups WhatsApp failures by Meta code, biggest first, with masked numbers only", async () => {
    execute.mockImplementation(async (sql: string) => {
      if (String(sql).includes("qf.wa_status = 'failed'")) return [[waRow("(#132018) a", 1), waRow("(#132018) b", 2), waRow("(#131026) c", 3)]];
      return [[]];
    });
    const groups = await listAttention();
    expect(groups.map((g) => [g.channel, g.cause, g.count])).toEqual([["whatsapp", "132018", 2], ["whatsapp", "131026", 1]]);
    expect(groups[0].rows[0].mobileMasked).toBe("xxxxxx3210");
    expect(JSON.stringify(groups)).not.toMatch(/\d{10}/);
  });

  it("flags stale-claim rows with outcomeUnknown", async () => {
    execute.mockImplementation(async (sql: string) =>
      String(sql).includes("qf.wa_status = 'failed'") ? [[waRow("outcome unknown (process stopped mid-send)", 1), waRow("(#132018) a", 2)]] : [[]]);
    const rows = (await listAttention()).flatMap((g) => g.rows);
    expect(rows.find((r) => r.id === "id-1")?.outcomeUnknown).toBe(true);
    expect(rows.find((r) => r.id === "id-2")?.outcomeUnknown).toBe(false);
  });

  it("lists a receipt-failed WhatsApp row as not retryable (already_sent) and a stamped call row as already_in_file", async () => {
    execute.mockImplementation(async (sql: string) => {
      const q = String(sql);
      if (q.includes("qf.wa_status = 'failed'")) return [[{ ...waRow("delivery failed", 1), already_sent: 1, batch_id: null }, { ...waRow("(#131026) c", 2), already_sent: 0, batch_id: null }]];
      if (q.includes("qf.call_error IS NOT NULL")) return [[{ ...waRow("bot_unavailable", 3), already_sent: 0, batch_id: "b1" }]];
      return [[]];
    });
    const rows = (await listAttention()).flatMap((g) => g.rows);
    const by = (id: string) => rows.find((r) => r.id === id)!;
    expect([by("id-1").retryable, by("id-1").retryReason]).toEqual([false, "already_sent"]);
    expect([by("id-2").retryable, by("id-2").retryReason]).toEqual([true, null]);
    expect([by("id-3").retryable, by("id-3").retryReason]).toEqual([false, "already_in_file"]);
  });

  it("uses text before the first colon for email and call causes and keeps open rows only", async () => {
    execute.mockImplementation(async (sql: string) => {
      const q = String(sql);
      if (q.includes("qf.email_status = 'failed'")) return [[{ ...waRow("SMTP 550: mailbox full", 1) }]];
      if (q.includes("qf.call_error IS NOT NULL")) return [[{ ...waRow("bot_unavailable: no key", 2) }]];
      return [[]];
    });
    const groups = await listAttention(1);
    expect(groups.map((g) => [g.channel, g.cause]).sort()).toEqual([["call", "bot_unavailable"], ["email", "SMTP 550"]]);
    expect(sqls(/stopped_reason IS NULL/)).toHaveLength(3);
  });
});

describe("retryFollowupStep", () => {
  it("resets a failed WhatsApp step", async () => {
    execute.mockResolvedValueOnce([[{ id: ID, stopped_reason: null, retryable: 1 }]]).mockResolvedValueOnce([{ affectedRows: 1 }]);
    expect(await retryFollowupStep(ID, "whatsapp")).toBe("ok");
    const upd = sqls(/^UPDATE/)[0];
    expect(String(upd[0])).toContain("wa_attempts = 0");
    expect(String(upd[0])).toContain("wa_status IN ('failed','test_sent')");
    expect(upd[1]).toEqual([ID, "outcome unknown (process stopped mid-send)"]);
  });
  it("refuses a step that is not failed, a stopped row and an unknown id", async () => {
    execute.mockResolvedValueOnce([[{ id: ID, stopped_reason: null, retryable: 0 }]]);
    expect(await retryFollowupStep(ID, "whatsapp")).toBe("not_retryable");
    execute.mockResolvedValueOnce([[{ id: ID, stopped_reason: "opted_out", retryable: 1 }]]);
    expect(await retryFollowupStep(ID, "whatsapp")).toBe("stopped");
    execute.mockResolvedValueOnce([[]]);
    expect(await retryFollowupStep(ID, "email")).toBe("not_found");
    expect(sqls(/^UPDATE/)).toHaveLength(0);
  });
  it("a call retry only touches rows not yet stamped into a calling file", async () => {
    execute.mockResolvedValueOnce([[{ id: ID, stopped_reason: null, retryable: 1, err: "bot_unavailable" }]]).mockResolvedValueOnce([{ affectedRows: 1 }]);
    expect(await retryFollowupStep(ID, "call")).toBe("ok");
    expect(String(sqls(/^UPDATE/)[0][0])).toContain("call_file_batch_id IS NULL");
    expect(String(sqls(/^SELECT/)[0][0])).toContain("call_file_batch_id IS NULL");
  });
  it("refuses a step whose outcome is unknown (stale claim) and never updates", async () => {
    execute.mockResolvedValueOnce([[{ id: ID, stopped_reason: null, retryable: 1, err: "outcome unknown (process stopped mid-send)" }]]);
    expect(await retryFollowupStep(ID, "whatsapp")).toBe("outcome_unknown");
    expect(sqls(/^UPDATE/)).toHaveLength(0);
    execute.mockResolvedValueOnce([[{ id: ID, stopped_reason: null, retryable: 1, err: "(#132018) x" }]]).mockResolvedValueOnce([{ affectedRows: 1 }]);
    expect(await retryFollowupStep(ID, "whatsapp")).toBe("ok");
    const upd = sqls(/^UPDATE/)[0];
    expect(String(upd[0])).toContain("wa_error, '') <> ?");
    expect(upd[1]).toEqual([ID, "outcome unknown (process stopped mid-send)"]);
  });
  it("whatsapp retry needs wa_sent_at IS NULL; a receipt failure (sent) is refused with already_sent", async () => {
    execute.mockResolvedValueOnce([[{ id: ID, stopped_reason: null, retryable: 0, err: "delivery failed", already_sent: 1 }]]);
    expect(await retryFollowupStep(ID, "whatsapp")).toBe("already_sent");
    expect(sqls(/^UPDATE/)).toHaveLength(0);
    execute.mockResolvedValueOnce([[{ id: ID, stopped_reason: null, retryable: 1, err: "(#132018) x", already_sent: 0 }]]).mockResolvedValueOnce([{ affectedRows: 1 }]);
    expect(await retryFollowupStep(ID, "whatsapp")).toBe("ok");
    expect(String(sqls(/^UPDATE/)[0][0])).toContain("wa_status IN ('failed','test_sent') AND wa_sent_at IS NULL");
    expect(String(sqls(/^SELECT/)[1][0])).toContain("wa_sent_at IS NULL");
  });
  it("is idempotent: a lost race (0 rows updated) reports not_retryable", async () => {
    execute.mockResolvedValueOnce([[{ id: ID, stopped_reason: null, retryable: 1 }]]).mockResolvedValueOnce([{ affectedRows: 0 }]);
    expect(await retryFollowupStep(ID, "call")).toBe("not_retryable");
  });
});

describe("markFollowupCalled", () => {
  it("only moves in_file/queued rows and returns the count", async () => {
    execute.mockResolvedValue([{ affectedRows: 2 }]);
    expect(await markFollowupCalled("9876543210")).toBe(2);
    const [sql, params] = execute.mock.calls[0];
    expect(String(sql)).toContain("call_state IN ('in_file','queued')");
    expect(String(sql)).toContain("COLLATE utf8mb4_unicode_ci");
    expect(String(sql)).toContain("mode_at_enqueue = ?");
    expect(params).toEqual(["9876543210", "live"]);
  });
  it("does nothing while the mode is off and never touches a mode other than the running one", async () => {
    vi.stubEnv("QUAL_FOLLOWUP_MODE", "off");
    expect(await markFollowupCalled("9876543210")).toBe(0);
    expect(execute).not.toHaveBeenCalled();
    vi.stubEnv("QUAL_FOLLOWUP_MODE", "dry_run");
    execute.mockResolvedValue([{ affectedRows: 0 }]);
    await markFollowupCalled("9876543210");
    expect(execute.mock.calls[0][1]).toEqual(["9876543210", "dry_run"]);
  });
  it("an operator naming one row is not mode-scoped", async () => {
    vi.stubEnv("QUAL_FOLLOWUP_MODE", "off");
    execute.mockResolvedValue([{ affectedRows: 1 }]);
    expect(await markFollowupCalled("9876543210", ID)).toBe(1);
    expect(execute.mock.calls[0][1]).toEqual(["9876543210", ID]);
  });
});

describe("routes", () => {
  // retry and the audit view are branch-scoped (followupRowScoped, see followupSwitchRoutes.test.ts); org-wide roles skip the lookup here.
  it("rejects a bad channel with 400 and a non-admin with 403", async () => {
    expect((await request(appFor("super_admin")).post(`/api/he/qualified-followup/${ID}/retry`).send({ channel: "sms" })).status).toBe(400);
    expect((await request(appFor("super_admin")).post(`/api/he/qualified-followup/not-an-id/retry`).send({ channel: "email" })).status).toBe(400);
    expect((await request(appFor("hr")).post(`/api/he/qualified-followup/${ID}/retry`).send({ channel: "email" })).status).toBe(403);
  });
  it("retries as admin (200), 404 unknown, 409 when not retryable", async () => {
    execute.mockResolvedValueOnce([[{ id: ID, stopped_reason: null, retryable: 1 }]]).mockResolvedValueOnce([{ affectedRows: 1 }]);
    const ok = await request(appFor("super_admin")).post(`/api/he/qualified-followup/${ID}/retry`).send({ channel: "whatsapp" });
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ success: true });
    execute.mockResolvedValueOnce([[]]);
    expect((await request(appFor("super_admin")).post(`/api/he/qualified-followup/${ID}/retry`).send({ channel: "email" })).status).toBe(404);
    execute.mockResolvedValueOnce([[{ id: ID, stopped_reason: null, retryable: 1, err: "outcome unknown (process stopped mid-send)" }]]);
    const unknown = await request(appFor("super_admin")).post(`/api/he/qualified-followup/${ID}/retry`).send({ channel: "email" });
    expect(unknown.status).toBe(409);
    expect(unknown.body.message).toBe("outcome_unknown");
    execute.mockResolvedValueOnce([[{ id: ID, stopped_reason: "replied", retryable: 1 }]]);
    const stopped = await request(appFor("super_admin")).post(`/api/he/qualified-followup/${ID}/retry`).send({ channel: "email" });
    expect(stopped.status).toBe(409);
    expect(stopped.body.message).toBe("stopped");
  });
  it("lists attention for hr and hides SQL on failure", async () => {
    execute.mockResolvedValue([[]]);
    const res = await request(appFor("hr")).get("/api/he/qualified-followup/attention");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: [] });
    execute.mockRejectedValue(new Error("SELECT secret FROM x at /srv/a.ts"));
    const bad = await request(appFor("hr")).get("/api/he/qualified-followup/attention");
    expect(bad.status).toBe(500);
    expect(JSON.stringify(bad.body)).not.toMatch(/SELECT|secret|\.ts/);
  });
  it("mark-called: 404 unknown, 200 with updated count", async () => {
    // super_admin is org-wide (no branch lookup); the branch rule is in followupSwitchRoutes.test.ts.
    execute.mockResolvedValueOnce([[]]);
    expect((await request(appFor("super_admin")).post(`/api/he/qualified-followup/${ID}/mark-called`)).status).toBe(404);
    execute.mockResolvedValueOnce([[{ mobile10: "9876543210" }]]).mockResolvedValueOnce([{ affectedRows: 1 }]);
    const res = await request(appFor("super_admin")).post(`/api/he/qualified-followup/${ID}/mark-called`);
    expect(res.body).toEqual({ success: true, updated: 1 });
    expect((await request(appFor("ceo")).post(`/api/he/qualified-followup/${ID}/mark-called`)).status).toBe(403);
  });
  it("audit returns channel fields with a masked number and 404 when absent", async () => {
    const row = { id: ID, source_type: "meta_live", origin_id: "o1", origin_label: "Campaign", mode_at_enqueue: "live", mobile10: "9876543210", requisition_id: "req-1", qualified_at: "2026-10-07 09:00:00",
      email_status: "sent", email_attempts: 1, wa_status: "failed", wa_error: "(#132018) bad for 9876543210", wa_attempts: 1, wa_template_key: "he_winback", call_state: "pending", call_attempts: 0 };
    execute.mockResolvedValueOnce([[row]]);
    const res = await request(appFor("super_admin")).get(`/api/he/qualified-followup/${ID}`);
    expect(res.status).toBe(200);
    expect(res.body.data.wa_template_key).toBe("he_winback");
    expect(res.body.data.wa_error).toContain("(#132018)");
    expect(res.body.data.mobileMasked).toBe("xxxxxx3210");
    expect(JSON.stringify(res.body)).not.toMatch(/\d{10}/);
    execute.mockResolvedValueOnce([[]]);
    expect((await request(appFor("super_admin")).get(`/api/he/qualified-followup/${ID}`)).status).toBe(404);
    execute.mockResolvedValueOnce([[]]);
    expect(await getFollowupAudit(ID)).toBeNull();
  });
});
