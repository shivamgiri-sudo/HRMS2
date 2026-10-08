import ExcelJS from "exceljs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const execute = vi.hoisted(() => vi.fn());
const send = vi.hoisted(() => vi.fn());
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));
vi.mock("../../../logger.js", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock("../../communication/email.service.js", () => ({ emailService: { send } }));
const markExported = vi.hoisted(() => vi.fn(async () => ({ marked: 0 })));
vi.mock("../he-call-results.service.js", () => ({ markExportedForCalling: markExported }));
vi.mock("../he-call-ref.service.js", () => ({
  refsForMatches: vi.fn(async (ids: string[]) => new Map(ids.map((id, i) => [id, `HRMS-${String(90 + i).padStart(3, "0")}`]))),
  existingRef: vi.fn(async () => null),
}));

import { readSwitches } from "../qualified-followup.policy.js";
import { mapHeaders } from "../he-bulk-call.js";
import { buildCallFiles, callFileCsv, chunkRows, recoverStaleBatches, runCallFileBatch, type CallFileRow } from "../qualified-followup.callfile.js";

const HEADER7 = "phone,name,role,interview_date,interview_time,branch_address,reference_id";
const HEADER = `${HEADER7},requisition_code,other_requisitions,branch,drive_type,campaign,qualified_at,email_status,email_sent_at,whatsapp_status,whatsapp_sent_at,attempt,priority`;
const now = new Date("2026-10-07T10:00:00+05:30");
const liveEnv = { QUAL_FOLLOWUP_MODE: "live" } as NodeJS.ProcessEnv;
const testEnv = { QUAL_FOLLOWUP_MODE: "live", QUAL_FOLLOWUP_TEST_MODE: "true", QUAL_FOLLOWUP_TEST_TO_PHONE: "9111122222", QUAL_FOLLOWUP_TEST_TO_EMAIL: "qa@x.in" } as NodeJS.ProcessEnv;

const row = (over: Partial<CallFileRow> = {}): CallFileRow => ({
  mobile10: "9876543210", name: "Asha", role: "Support", interviewDate: "2026-10-08", interviewTime: "10:30", branchAddress: "Sector 62", referenceId: "QF-0001",
  requisitionCode: "REQ-1", otherRequisitions: [], branch: "Noida", driveType: "Live Meta", campaign: "Oct Noida", qualifiedAt: "2026-10-07 08:10",
  emailStatus: "sent", emailSentAt: "2026-10-07 08:30", waStatus: "sent", waSentAt: "2026-10-07 09:30", attempt: 1, priority: "P1", ...over,
});
const dbRow = (i: number, over: Record<string, unknown> = {}) => ({
  id: `id-${i}`, source_type: i % 2 ? "he" : "meta_live", mobile10: `98765432${String(10 + i)}`, full_name: "asha rao", role_name: "Support",
  requisition_id: `req-${i}`, requisition_code: `REQ-${i}`, branch_name: "Noida", address: "Sector 62", campaign_name: "Oct Noida", origin_label: "Pool",
  qualified_at: `2026-10-07 08:${String(10 + i)}:00`, email_status: "sent", email_sent_at: "2026-10-07 08:30:00", wa_status: "sent", wa_sent_at: "2026-10-07 09:30:00",
  slot_date: "2026-10-08", slot_time: "10:30:00", lead_status: null, consent_revoked: 0, match_states: null, row_declined: 0,
  calls_n: 0, calls_answered: 0, calls_retryable: 0, last_call_at: null, meta_outcome: null, files_n: 0, last_file_at: null, ...over,
});
const SELECT_MARK = "AS calls_retryable";

interface World { rows?: unknown[]; pending?: Array<{ id: string; age_min: number; status?: string }>; stampAffected?: number; offers?: unknown[]; params?: unknown[]; dupSlot?: boolean }
function world(w: World = {}) {
  execute.mockImplementation(async (sql: string, p: unknown[] = []) => {
    const q = String(sql);
    if (q.includes("FROM he_model_param")) return [w.params ?? []];
    if (q.includes("FROM qualified_followup_call_batch")) return [w.pending ?? []];
    if (q.includes(SELECT_MARK)) return [w.rows ?? []];
    if (q.includes("AS started")) return [w.offers ?? []];
    if (q.startsWith("INSERT INTO qualified_followup_call_batch") && w.dupSlot) throw Object.assign(new Error("Duplicate entry"), { code: "ER_DUP_ENTRY", errno: 1062 });
    if (q.startsWith("UPDATE qualified_followup SET call_file_batch_id = ? WHERE id IN")) return [{ affectedRows: w.stampAffected ?? p.length - 1 }];
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
    expect(callFileCsv([row({ interviewDate: null, interviewTime: null, branchAddress: null })]).split("\r\n")[1])
      .toBe("9876543210,Asha,Support,,,,QF-0001,REQ-1,,Noida,Live Meta,Oct Noida,2026-10-07 08:10,sent,2026-10-07 08:30,sent,2026-10-07 09:30,1,P1");
  });

  it("the seven upload columns come first, so the bulk-call upload still reads the file", () => {
    const { map, missing } = mapHeaders(HEADER.split(","));
    expect(missing).toEqual([]);
    for (const c of HEADER7.split(",")) expect(map[c]).toBe(c);
    expect(callFileCsv([row({ otherRequisitions: ["REQ-2", "REQ-3"] })]).split("\r\n")[1]).toContain(",REQ-1,REQ-2 REQ-3,Noida,");
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
    world({ rows: [dbRow(1), dbRow(2)], stampAffected: 1 });
    const base = execute.getMockImplementation()!;
    execute.mockImplementation(async (sql: string, p?: unknown[]) =>
      (String(sql).startsWith("SELECT id FROM qualified_followup WHERE call_file_batch_id") ? [[{ id: "id-1" }]] : base(sql, p)));
    expect(await runCallFileBatch(readSwitches(liveEnv), "live", now)).toMatchObject({ status: "sent", rows: 1 });
    expect(String(send.mock.calls[0][0].attachments[0].content)).toContain("REQ-1");
    expect(String(send.mock.calls[0][0].attachments[0].content)).not.toContain("REQ-2");
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
    const [sql, params] = calls(new RegExp(SELECT_MARK))[0];
    expect(String(sql)).toContain("qf.source_type NOT IN (?,?)");
    expect(params).toEqual(["live", "meta_old", "he"]);
  });
  it("a slot dated before today (IST) is blanked, date and time together; today and later are kept", async () => {
    world({ rows: [{ ...dbRow(1), slot_date: "2026-10-06" }, { ...dbRow(2), slot_date: "2026-10-07" }, { ...dbRow(3), slot_date: "2026-10-09" }] });
    await runCallFileBatch(readSwitches(liveEnv), "live", now);
    const csv = String(send.mock.calls[0][0].attachments[0].content).slice(1).split("\r\n");
    const line = (m: string) => csv.find((l) => l.startsWith(m))!.split(",").slice(0, 7).join(",");
    expect(line("9876543211")).not.toContain("2026");
    expect(line("9876543211")).not.toContain("10:30");
    expect(line("9876543212")).toContain("2026");
    expect(line("9876543213")).toContain("2026");
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
    expect(String(calls(new RegExp(SELECT_MARK))[0][0])).toContain("qf.call_file_batch_id IS NULL");
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("the stale sweep only looks at pending batches", async () => {
    world({ pending: [] });
    await recoverStaleBatches(now);
    expect(String(calls(/FROM qualified_followup_call_batch/)[0][0])).toContain("WHERE status IN ('pending','sending')");
  });

  it("a SELECT error returns failed without throwing; SQL has collations and a scalar address lookup", async () => {
    execute.mockImplementation(async (sql: string) => {
      if (String(sql).includes(SELECT_MARK)) throw new Error("Illegal mix of collations");
      return [[]];
    });
    const res = await runCallFileBatch(readSwitches(liveEnv), "live", now);
    expect(res).toMatchObject({ status: "failed", error: "Illegal mix of collations" });
    const sql = String(calls(new RegExp(SELECT_MARK))[0][0]);
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
    expect(line.startsWith("9876543210,'=cmd(),'+1,08/10/2026,10:30 AM,'@x,'-2,")).toBe(true);
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
    const select = execute.mock.calls.findIndex(([sql]) => String(sql).includes(SELECT_MARK));
    expect(stale).toBeLessThan(select);
  });

  it("returns how many it cleared", async () => {
    world({ pending: [{ id: "a", age_min: 45 }] });
    expect(await recoverStaleBatches(now)).toBe(1);
  });
});

describe("recoverStaleBatches: an email that may have gone out is never re-filed", () => {
  it("a stale 'sending' batch becomes 'unknown' and keeps its rows stamped; a stale 'pending' one releases rows and its slot", async () => {
    world({ pending: [{ id: "s", age_min: 40, status: "sending" }, { id: "p", age_min: 40, status: "pending" }] });
    expect(await recoverStaleBatches(now)).toBe(2);
    expect(calls(/SET call_file_batch_id = NULL WHERE call_file_batch_id = \?/).map((c) => c[1])).toEqual([["p"]]);
    const unknown = calls(/status = 'unknown'/);
    expect(unknown.map((c) => c[1][1])).toEqual(["s"]);
    expect(String(calls(/error = 'stale'/)[0][0])).toContain("slot_claim = NULL");
  });
});

describe("one line per person, no person twice", () => {
  it("rows of one mobile from several requisitions and drive types become one line with the other codes; all are claimed", async () => {
    world({ rows: [dbRow(1, { mobile10: "9000000001" }), dbRow(2, { mobile10: "9000000001", source_type: "meta_old" }), dbRow(3)] });
    const res = await runCallFileBatch(readSwitches(liveEnv), "live", now);
    expect(res).toMatchObject({ status: "sent", rows: 2 });
    const csv = String(send.mock.calls[0][0].attachments[0].content).slice(1).split("\r\n").filter(Boolean);
    expect(csv).toHaveLength(3);
    expect(csv.filter((l) => l.startsWith("9000000001,"))).toHaveLength(1);
    expect(csv.find((l) => l.startsWith("9000000001,"))).toContain(",REQ-1,REQ-2,");
    expect(calls(/SET call_file_batch_id = \? WHERE id IN/)[0][1]).toEqual(expect.arrayContaining(["id-1", "id-2", "id-3"]));
    expect(res.summary).toMatchObject({ rows: 2, merged: 1 });
  });

  it("skipped people are written off with the reason before the email and counted in the summary; deferred ones are left queued", async () => {
    world({ rows: [
      dbRow(1, { lead_status: "opted_out" }), dbRow(2, { files_n: 1, last_file_at: "2026-10-01 10:00:00" }),
      dbRow(3, { calls_n: 1, calls_retryable: 1, last_call_at: "2026-10-07 09:30:00" }), dbRow(4),
    ] });
    const res = await runCallFileBatch(readSwitches(liveEnv), "live", now);
    expect(res).toMatchObject({ status: "sent", rows: 1 });
    const skips = calls(/SET call_state = 'skipped', call_error = \?/);
    expect(skips.map((c) => [c[1][0], ...c[1].slice(1)])).toEqual(expect.arrayContaining([["callfile:opted_out", "id-1"], ["callfile:already_in_file", "id-2"]]));
    for (const [sql] of skips) expect(String(sql)).toContain("call_state = 'in_file' AND call_file_batch_id IS NULL");
    expect(skips.flatMap((c) => c[1])).not.toContain("id-3");
    expect(execute.mock.invocationCallOrder[execute.mock.calls.indexOf(skips[0])]).toBeLessThan(send.mock.invocationCallOrder[0]);
    const html = send.mock.calls[0][0].html as string;
    expect(html).toContain("opted_out");
    expect(html).toContain("already_in_file");
    expect(html).not.toMatch(/\d{10}/);
    expect(res.summary).toMatchObject({ skipped: { opted_out: 1, already_in_file: 1 }, deferred: 1 });
  });

  it("the selection reads he_call, prior files of the same mobile and tag, STOP and match state", async () => {
    world();
    await runCallFileBatch(readSwitches(liveEnv), "live", now);
    const sql = String(calls(new RegExp(SELECT_MARK))[0][0]);
    expect(sql).toMatch(/FROM he_call c/);
    expect(sql).toMatch(/p\.mobile10 = qf\.mobile10 AND p\.mode_at_enqueue = qf\.mode_at_enqueue AND p\.call_file_batch_id IS NOT NULL/);
    expect(sql).toContain("consent_revoked");
    expect(sql).toContain("'confirmed','arrived','selected'");
  });

  it("the email starts with counts: rows, by drive type, by branch", async () => {
    world({ rows: [dbRow(1), dbRow(2, { branch_name: "Pune" }), dbRow(3, { source_type: "meta_old" })] });
    await runCallFileBatch(readSwitches(liveEnv), "live", now);
    const html = send.mock.calls[0][0].html as string;
    expect(html).toMatch(/3 people to call/);
    expect(html).toMatch(/Live Meta: 1/);
    expect(html).toMatch(/Hiring Engine: 1/);
    expect(html).toMatch(/Old Meta data: 1/);
    expect(html).toMatch(/Noida: 2/);
    expect(html).toMatch(/Pune: 1/);
  });
});

describe("slots: one batch per IST slot and tag", () => {
  it("claims the slot when the batch row is inserted; a second run for the same slot does nothing", async () => {
    world({ rows: [dbRow(1)] });
    await runCallFileBatch(readSwitches(liveEnv), "live", now, { slotKey: "2026-10-07 10:00" });
    const ins = calls(/INSERT INTO qualified_followup_call_batch/)[0];
    expect(String(ins[0])).toContain("slot_claim");
    expect(ins[1]).toEqual(expect.arrayContaining(["live", "2026-10-07 10:00"]));
    execute.mockReset(); send.mockReset();
    world({ rows: [dbRow(2)], dupSlot: true });
    expect(await runCallFileBatch(readSwitches(liveEnv), "live", now, { slotKey: "2026-10-07 10:00" })).toMatchObject({ status: "already_done" });
    expect(calls(new RegExp(SELECT_MARK))).toHaveLength(0);
    expect(send).not.toHaveBeenCalled();
  });

  it("a failed send releases the slot claim so the slot can be retried", async () => {
    world({ rows: [dbRow(1)] });
    send.mockRejectedValue(new Error("SMTP down"));
    await runCallFileBatch(readSwitches(liveEnv), "live", now, { slotKey: "2026-10-07 10:00" });
    expect(String(calls(/status = 'failed', error = \?/)[0][0])).toContain("slot_claim = NULL");
  });

  it("marks the batch 'sending' before the email goes out", async () => {
    world({ rows: [dbRow(1)] });
    await runCallFileBatch(readSwitches(liveEnv), "live", now, { slotKey: "2026-10-07 10:00" });
    const sending = calls(/SET status = 'sending'/)[0];
    expect(execute.mock.invocationCallOrder[execute.mock.calls.indexOf(sending)]).toBeLessThan(send.mock.invocationCallOrder[0]);
  });

  it("empty slot: recorded as 'empty', no email by default; one short line when the note is switched on", async () => {
    world();
    expect(await runCallFileBatch(readSwitches(liveEnv), "live", now, { slotKey: "2026-10-07 12:00" })).toMatchObject({ status: "empty" });
    expect(calls(/status = 'empty'/)).toHaveLength(1);
    expect(send).not.toHaveBeenCalled();
    world();
    const env = { ...liveEnv, QUAL_FOLLOWUP_CALL_FILE_EMPTY_NOTE: "true" } as NodeJS.ProcessEnv;
    await runCallFileBatch(readSwitches(env), "live", now, { slotKey: "2026-10-07 14:00", config: { slots: [], coolDays: 0, emptyNote: true } });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].subject).toMatch(/no new rows/);
    expect(send.mock.calls[0][0].attachments ?? []).toHaveLength(0);
  });

  it("dry run builds and counts the file but never emails, even with the empty note on", async () => {
    world({ rows: [dbRow(1), dbRow(2, { mobile10: "9000000002" })] });
    const res = await runCallFileBatch(readSwitches({ QUAL_FOLLOWUP_MODE: "dry_run" } as NodeJS.ProcessEnv), "dry_run", now, { slotKey: "2026-10-07 10:00" });
    expect(res).toMatchObject({ status: "dry_run", rows: 2, files: 2 });
    expect(calls(/status = 'dry_run'/)[0][1]).toEqual(expect.arrayContaining([2]));
    world();
    await runCallFileBatch(readSwitches({ QUAL_FOLLOWUP_MODE: "dry_run" } as NodeJS.ProcessEnv), "dry_run", now, { slotKey: "2026-10-07 12:00", config: { slots: [], coolDays: 0, emptyNote: true } });
    expect(send).not.toHaveBeenCalled();
  });

  it("the cool period from he_model_param lets an earlier-filed person back", async () => {
    world({ rows: [dbRow(1, { files_n: 1, last_file_at: "2026-09-01 10:00:00" })], params: [{ param_key: "policy.callfile_cool_days", value: "20.0000" }] });
    expect(await runCallFileBatch(readSwitches(liveEnv), "live", now)).toMatchObject({ status: "sent", rows: 1 });
    expect(String(send.mock.calls[0][0].attachments[0].content)).toMatch(/,2,P1\r\n/);
  });
});

describe("unified call file (Task 10)", () => {
  beforeEach(() => markExported.mockClear());
  it("file row carries the HRMS match reference of a booked journey; older rows keep QF-", async () => {
    world({ rows: [dbRow(0, { match_id: "M1" }), dbRow(1)] });
    await runCallFileBatch(readSwitches(liveEnv), "live", now, { slotKey: "2026-10-07 10:00" });
    const csv = (send.mock.calls[0][0].attachments as Array<{ filename: string; content: Buffer }>).find((a) => a.filename.endsWith(".csv"))!.content.toString("utf8");
    expect(csv).toContain(",HRMS-090,");
    expect(csv).toContain(",QF-ID1,");
  });
  it("a sent batch records exported_for_calling for its people, so HR's manual Prepare skips them for 18 h", async () => {
    world({ rows: [dbRow(0), dbRow(1)] });
    await runCallFileBatch(readSwitches(liveEnv), "live", now, { slotKey: "2026-10-07 10:00" });
    expect(markExported).toHaveBeenCalledWith(["9876543210", "9876543211"], expect.objectContaining({ userId: null, label: "follow-up batch 2026-10-07 10:00" }));
  });
  it("dry_run and test batches record no export", async () => {
    world({ rows: [dbRow(0)] });
    await runCallFileBatch(readSwitches({ QUAL_FOLLOWUP_MODE: "dry_run" } as NodeJS.ProcessEnv), "dry_run", now, { slotKey: "2026-10-07 10:00" });
    expect(markExported).not.toHaveBeenCalled();
  });
  it("selects HR's manual exports of the last 18 h (not our own batches) and the booking's slot", async () => {
    world({ rows: [] });
    await runCallFileBatch(readSwitches(liveEnv), "live", now, { slotKey: "2026-10-07 12:00" });
    const sel = calls(new RegExp(SELECT_MARK))[0][0] as string;
    expect(sel).toContain("ev.event_type = 'exported_for_calling' AND ev.created_at > DATE_SUB(NOW(), INTERVAL 18 HOUR) AND COALESCE(ev.detail, '') NOT LIKE 'follow-up batch%'");
    expect(sel).toContain("LEFT JOIN he_match hb ON hb.id = qf.match_id");
  });
  it("a manually exported person is skipped already_exported", async () => {
    world({ rows: [dbRow(0, { exported_recently: 1 })] });
    const r = await runCallFileBatch(readSwitches(liveEnv), "live", now, { slotKey: "2026-10-07 14:00" });
    expect(r.summary?.skipped).toEqual({ already_exported: 1 });
  });
});
