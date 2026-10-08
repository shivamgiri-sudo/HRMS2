import ExcelJS from "exceljs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const execute = vi.hoisted(() => vi.fn());
const send = vi.hoisted(() => vi.fn());
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));
vi.mock("../../../logger.js", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock("../../communication/email.service.js", () => ({ emailService: { send } }));

import { readSwitches } from "../qualified-followup.policy.js";
import { buildCallFiles, callFileCsv, chunkRows, recoverStaleBatches, runCallFileBatch, type CallFileRow } from "../qualified-followup.callfile.js";

const HEADER = "phone,name,role,interview_date,interview_time,branch_address,reference_id";
const now = new Date("2026-10-07T10:00:00+05:30");
const liveEnv = { QUAL_FOLLOWUP_MODE: "live" } as NodeJS.ProcessEnv;
const testEnv = { QUAL_FOLLOWUP_MODE: "live", QUAL_FOLLOWUP_TEST_MODE: "true", QUAL_FOLLOWUP_TEST_TO_PHONE: "9111122222", QUAL_FOLLOWUP_TEST_TO_EMAIL: "qa@x.in" } as NodeJS.ProcessEnv;

const row = (over: Partial<CallFileRow> = {}): CallFileRow => ({ mobile10: "9876543210", name: "Asha", role: "Support", interviewDate: "2026-10-08", interviewTime: "10:30", branchAddress: "Sector 62", referenceId: "QF-0001", ...over });
const dbRow = (i: number) => ({ id: `id-${i}`, source_type: i % 2 ? "he" : "meta_live", mobile10: `98765432${String(10 + i)}`, full_name: "asha rao", role_name: "Support", address: "Sector 62", slot_date: "2026-10-08", slot_time: "10:30:00" });

interface World { rows?: unknown[]; pending?: Array<{ id: string; age_min: number }>; stampAffected?: number }
function world(w: World = {}) {
  execute.mockImplementation(async (sql: string) => {
    const q = String(sql);
    if (q.includes("FROM qualified_followup_call_batch")) return [w.pending ?? []];
    if (q.includes("FROM qualified_followup qf")) return [w.rows ?? []];
    if (q.startsWith("UPDATE qualified_followup SET call_file_batch_id = ? WHERE id IN")) return [{ affectedRows: w.stampAffected ?? (w.rows ?? []).length }];
    return [{ affectedRows: 1 }];
  });
}
const calls = (re: RegExp) => execute.mock.calls.filter(([sql]) => re.test(String(sql)));

beforeEach(() => { execute.mockReset(); send.mockReset(); send.mockResolvedValue({}); });

describe("call file format", () => {
  it("writes a BOM, the exact header, quoted cells and test phones", () => {
    const csv = callFileCsv([row({ branchAddress: 'A, B "C"' }), row({ branchAddress: "Line1\nLine2" })]);
    expect(csv.startsWith("﻿")).toBe(true);
    const lines = csv.slice(1).split("\r\n");
    expect(lines[0]).toBe(HEADER);
    expect(lines[1]).toContain('"A, B ""C"""');
    expect(lines[2]).toContain("Line1 Line2");
    expect(lines[1].startsWith("9876543210,")).toBe(true);
    expect(callFileCsv([row()], "9111122222").split("\r\n")[1].startsWith("9111122222,")).toBe(true);
  });

  it("leaves slot and address blank when absent", () => {
    expect(callFileCsv([row({ interviewDate: null, interviewTime: null, branchAddress: null })]).split("\r\n")[1]).toBe("9876543210,Asha,Support,,,,QF-0001");
  });

  it("chunks at 500 and builds a CSV and XLSX per part", async () => {
    expect(chunkRows(Array.from({ length: 1001 }, (_, i) => i)).map((c) => c.length)).toEqual([500, 500, 1]);
    const files = await buildCallFiles(Array.from({ length: 501 }, () => row()), { stamp: "20261007-1000" });
    expect(files.map((f) => f.filename)).toEqual([
      "qualified-calls-20261007-1000-part1.csv", "qualified-calls-20261007-1000-part1.xlsx",
      "qualified-calls-20261007-1000-part2.csv", "qualified-calls-20261007-1000-part2.xlsx"]);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(files[1].content);
    const ws = wb.getWorksheet("Calls")!;
    expect((ws.getRow(1).values as unknown[]).slice(1).join(",")).toBe(HEADER);
    expect(ws.rowCount).toBe(501);
  });
});

describe("runCallFileBatch", () => {
  it("does nothing when no rows are due", async () => {
    world();
    expect(await runCallFileBatch(readSwitches(liveEnv), "live", now)).toMatchObject({ status: "empty", rows: 0 });
    expect(calls(/INSERT/)).toHaveLength(0);
    expect(send).not.toHaveBeenCalled();
  });

  it("stamps, emails once with both attachments and marks sent", async () => {
    world({ rows: [dbRow(1), dbRow(2), dbRow(3)] });
    const res = await runCallFileBatch(readSwitches(liveEnv), "live", now);
    expect(res).toMatchObject({ status: "sent", rows: 3, files: 2 });
    expect(calls(/INSERT INTO qualified_followup_call_batch/)).toHaveLength(1);
    const stamp = calls(/SET call_file_batch_id = \? WHERE id IN/)[0];
    expect(String(stamp[0])).toContain("call_file_batch_id IS NULL");
    expect(send).toHaveBeenCalledTimes(1);
    const mail = send.mock.calls[0][0];
    expect(mail.to).toBe("shivam.giri@teammas.in");
    expect(mail.attachments).toHaveLength(2);
    expect(mail.subject).toBe("[HRMS] Calling file: 3 candidates (2026-10-07 10:00 IST)");
    expect(mail.html).not.toMatch(/\d{10}/);
    expect(calls(/status = 'sent'/)).toHaveLength(1);
    // stamped before the email: the stamp UPDATE ran before send
    expect(execute.mock.invocationCallOrder[execute.mock.calls.indexOf(stamp)]).toBeLessThan(send.mock.invocationCallOrder[0]);
  });

  it("test mode mails only the test address with the test phone", async () => {
    world({ rows: [dbRow(1)] });
    await runCallFileBatch(readSwitches(testEnv), "test", now);
    const mail = send.mock.calls[0][0];
    expect(mail.to).toBe("qa@x.in");
    expect(mail.attachments[0].content.toString("utf8").split("\r\n")[1].startsWith("9111122222,")).toBe(true);
  });

  it("unstamps and records the error when the send fails", async () => {
    world({ rows: [dbRow(1), dbRow(2)] });
    send.mockRejectedValue(new Error("SMTP down"));
    const res = await runCallFileBatch(readSwitches(liveEnv), "live", now);
    expect(res).toMatchObject({ status: "failed", error: "SMTP down" });
    const batchId = calls(/INSERT INTO qualified_followup_call_batch/)[0][1][0];
    const un = calls(/SET call_file_batch_id = NULL WHERE call_file_batch_id = \?/);
    expect(un).toHaveLength(1);
    expect(un[0][1]).toEqual([batchId]);
    const failed = calls(/status = 'failed', error = \?/)[0];
    expect(failed[1]).toEqual(["SMTP down", batchId]);
  });

  it("only files rows it really stamped", async () => {
    execute.mockImplementation(async (sql: string) => {
      const q = String(sql);
      if (q.includes("FROM qualified_followup_call_batch")) return [[]];
      if (q.includes("FROM qualified_followup qf")) return [[dbRow(1), dbRow(2)]];
      if (q.includes("WHERE id IN")) return [{ affectedRows: 1 }];
      if (q.startsWith("SELECT id FROM qualified_followup WHERE call_file_batch_id")) return [[{ id: "id-1" }]];
      return [{ affectedRows: 1 }];
    });
    expect(await runCallFileBatch(readSwitches(liveEnv), "live", now)).toMatchObject({ status: "sent", rows: 1 });
  });

  it("dry run records the batch and sends nothing", async () => {
    world({ rows: [dbRow(1)] });
    const res = await runCallFileBatch(readSwitches({ QUAL_FOLLOWUP_MODE: "dry_run" } as NodeJS.ProcessEnv), "dry_run", now);
    expect(res).toMatchObject({ status: "dry_run", rows: 1 });
    expect(send).not.toHaveBeenCalled();
    expect(calls(/status = 'dry_run'/)).toHaveLength(1);
  });
});

describe("pause switches and past slots", () => {
  it("HE_SENDS_PAUSED skips the whole file in live and test, but not dry_run", async () => {
    world({ rows: [dbRow(1)] });
    const env = { ...liveEnv, HE_SENDS_PAUSED: "true" } as NodeJS.ProcessEnv;
    expect(await runCallFileBatch(readSwitches(env), "live", now)).toMatchObject({ status: "empty" });
    expect(execute).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(await runCallFileBatch(readSwitches({ ...env, QUAL_FOLLOWUP_MODE: "dry_run" } as NodeJS.ProcessEnv), "dry_run", now)).toMatchObject({ status: "dry_run" });
  });
  it("paused sources are filtered out of the selection", async () => {
    world();
    await runCallFileBatch(readSwitches({ ...liveEnv, QUAL_FOLLOWUP_PAUSE_SOURCES: "meta_old,he" } as NodeJS.ProcessEnv), "live", now);
    const [sql, params] = calls(/FROM qualified_followup qf/)[0];
    expect(String(sql)).toContain("qf.source_type NOT IN (?,?)");
    expect(params).toEqual(["live", "meta_old", "he"]);
  });
  it("a slot dated before today (IST) is blanked, date and time together; today and later are kept", async () => {
    world({ rows: [{ ...dbRow(1), slot_date: "2026-10-06" }, { ...dbRow(2), slot_date: "2026-10-07" }, { ...dbRow(3), slot_date: "2026-10-09" }] });
    await runCallFileBatch(readSwitches(liveEnv), "live", now);
    const csv = String(send.mock.calls[0][0].attachments[0].content).slice(1).split("\r\n");
    expect(csv[1]).not.toContain("2026");
    expect(csv[1]).not.toContain("10:30");
    expect(csv[2]).toContain("2026");
    expect(csv[3]).toContain("2026");
  });
});

describe("hardening", () => {
  it("a delivered file stays stamped when recording 'sent' fails, and the next slot sends nothing", async () => {
    world({ rows: [dbRow(1)] });
    const base = execute.getMockImplementation()!;
    execute.mockImplementation(async (sql: string, p?: unknown[]) => {
      if (/status = 'sent'/.test(String(sql))) throw new Error("db gone");
      return base(sql, p);
    });
    const res = await runCallFileBatch(readSwitches(liveEnv), "live", now);
    expect(res.status).toBe("sent");
    expect(calls(/status = 'sent'/)).toHaveLength(2); // one retry
    expect(calls(/status = 'sent_unrecorded'/)).toHaveLength(1);
    expect(calls(/SET call_file_batch_id = NULL/)).toHaveLength(0);
    expect(calls(/status = 'failed'/)).toHaveLength(0);
    // next slot: stamped rows are no longer selected (the select requires call_file_batch_id IS NULL), only one email went out
    expect(String(calls(/FROM qualified_followup qf/)[0][0])).toContain("call_file_batch_id IS NULL");
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("the stale sweep only looks at pending batches", async () => {
    world({ pending: [] });
    await recoverStaleBatches(now);
    expect(String(calls(/FROM qualified_followup_call_batch/)[0][0])).toContain("WHERE status = 'pending'");
  });

  it("a SELECT error returns failed without throwing; SQL has collations and a scalar address lookup", async () => {
    execute.mockImplementation(async (sql: string) => {
      if (String(sql).includes("FROM qualified_followup qf")) throw new Error("Illegal mix of collations");
      return [[]];
    });
    const res = await runCallFileBatch(readSwitches(liveEnv), "live", now);
    expect(res).toMatchObject({ status: "failed", error: "Illegal mix of collations" });
    const sql = String(calls(/FROM qualified_followup qf/)[0][0]);
    expect(sql).toContain("COLLATE utf8mb4_unicode_ci");
    expect(sql).not.toMatch(/JOIN branch_master/);
    expect(sql).toMatch(/\(SELECT bm\.address FROM branch_master[^)]*LIMIT 1\)/);
    expect(calls(/INSERT/)).toHaveLength(0);
  });

  it("test tag without a test phone fails before selecting", async () => {
    world({ rows: [dbRow(1)] });
    const res = await runCallFileBatch({ ...readSwitches(testEnv), testPhone: null }, "test", now);
    expect(res.status).toBe("failed");
    expect(execute).not.toHaveBeenCalled();
  });

  it("neutralises formula-looking text in CSV and XLSX but not the phone", async () => {
    const r = row({ name: "=cmd()", role: "+1", branchAddress: "@x", referenceId: "-2" });
    const line = callFileCsv([r]).split("\r\n")[1];
    expect(line).toBe("9876543210,'=cmd(),'+1,08/10/2026,10:30 AM,'@x,'-2");
    const [, xlsx] = await buildCallFiles([r], { stamp: "s" });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(xlsx.content);
    const vals = (wb.getWorksheet("Calls")!.getRow(2).values as unknown[]).slice(1);
    expect(vals[0]).toBe("9876543210");
    expect(vals[1]).toBe("'=cmd()");
  });
});

describe("recoverStaleBatches", () => {
  it("clears a 31-minute-old pending batch before selecting rows and leaves a 29-minute one", async () => {
    world({ pending: [{ id: "old", age_min: 31 }, { id: "fresh", age_min: 29 }] });
    await runCallFileBatch(readSwitches(liveEnv), "live", now);
    const un = calls(/SET call_file_batch_id = NULL WHERE call_file_batch_id = \?/);
    expect(un.map((c) => c[1])).toEqual([["old"]]);
    expect(calls(/error = 'stale'/).map((c) => c[1])).toEqual([["old"]]);
    const stale = execute.mock.calls.indexOf(un[0]);
    const select = execute.mock.calls.findIndex(([sql]) => String(sql).includes("FROM qualified_followup qf"));
    expect(stale).toBeLessThan(select);
  });

  it("returns how many it cleared", async () => {
    world({ pending: [{ id: "a", age_min: 45 }] });
    expect(await recoverStaleBatches(now)).toBe(1);
  });
});
