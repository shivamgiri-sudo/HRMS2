import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

// A row handed to the engine (owner='engine') is record-only: the operator list, retry and every pipeline step must leave it alone.
const execute = vi.hoisted(() => vi.fn());
vi.mock("../../../db/mysql.js", () => ({ db: { execute, query: execute, getConnection: vi.fn() } }));
vi.mock("../../../logger.js", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

import { listAttention, retryFollowupStep } from "../qualified-followup.attention.js";
import { runEmailStep } from "../qualified-followup.email.js";
import { runWhatsappStep } from "../qualified-followup.whatsapp.js";
import { runCallStep } from "../qualified-followup.call.js";
import { runCallFileBatch } from "../qualified-followup.callfile.js";
import { readSwitches } from "../qualified-followup.policy.js";

const OWNER = /\b(qf\.)?owner = 'pipeline'/;
const sql = () => execute.mock.calls.map(([q]) => String(q).replace(/\s+/g, " "));

beforeEach(() => { execute.mockReset(); execute.mockImplementation(async () => [[]]); });

describe("engine-owned rows are not the operator's to retry", () => {
  it("every attention list read is limited to pipeline rows", async () => {
    await listAttention();
    const reads = sql().filter((q) => q.includes("FROM qualified_followup qf"));
    expect(reads).toHaveLength(3);
    for (const q of reads) expect(q).toContain("WHERE qf.stopped_reason IS NULL AND qf.owner = 'pipeline' AND");
  });

  it.each(["email", "whatsapp", "call"] as const)("%s retry: the check and the reset both require owner = 'pipeline'", async (ch) => {
    // the row the database answers for an engine-owned failure: the owner guard makes it not retryable
    execute.mockImplementation(async (q: string) => (String(q).startsWith("SELECT") ? [[{ id: "x", stopped_reason: null, retryable: 0, err: "boom", already_sent: 0 }]] : [{ affectedRows: 0 }]));
    expect(await retryFollowupStep("x", ch)).toBe("not_retryable");
    expect(sql()[0]).toMatch(/\(.*owner = 'pipeline'.*\) AS retryable/);
    execute.mockImplementation(async (q: string) => (String(q).startsWith("SELECT") ? [[{ id: "x", stopped_reason: null, retryable: 1, err: "boom", already_sent: 0 }]] : [{ affectedRows: 0 }]));
    expect(await retryFollowupStep("x", ch)).toBe("not_retryable"); // a hand-over between the read and the reset
    expect(sql().find((q) => q.startsWith("UPDATE"))).toContain("owner = 'pipeline'");
  });
});

describe("pipeline steps never select or claim an engine-owned row", () => {
  const sw = readSwitches({ QUAL_FOLLOWUP_MODE: "dry_run" } as NodeJS.ProcessEnv);
  const noon = new Date("2026-10-07T06:30:00Z"); // 12:00 IST, inside the send window

  it("email, WhatsApp, call and calling-file selections", async () => {
    await runEmailStep(sw, "dry_run", noon);
    await runWhatsappStep(sw, "dry_run", noon, 100);
    await runCallStep(sw, "dry_run", noon);
    await runCallFileBatch(sw, "dry_run", noon);
    const selects = sql().filter((q) => q.startsWith("SELECT") && q.includes("FROM qualified_followup qf"));
    expect(selects.length).toBe(4);
    for (const q of selects) expect(q).toContain("AND qf.owner = 'pipeline'");
  });

  it("every claim UPDATE in the step modules carries the owner guard", () => {
    const claims: string[] = [];
    for (const f of ["email", "whatsapp", "call"]) {
      const src = readFileSync(new URL(`../qualified-followup.${f}.ts`, import.meta.url), "utf8");
      claims.push(...(src.match(/"UPDATE qualified_followup SET (email_status = 'sending'|wa_status = 'sending', step_claimed_at|call_state = 'queued', call_error = NULL|call_state = 'in_file', call_error = \?)[^"]*"/g) ?? []));
    }
    expect(claims).toHaveLength(4);
    for (const c of claims) expect(c).toMatch(OWNER);
  });
});
