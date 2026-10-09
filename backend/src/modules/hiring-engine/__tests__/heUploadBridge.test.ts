import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
const h = vi.hoisted(() => ({
  sqls: [] as Array<{ sql: string; p: unknown[] }>,
  ats: [] as Row[],
  leads: [] as Row[],
  employees: [] as string[],
  exEmp: [] as Array<{ mobile10: string; clean_voluntary: number }>,
  tx: [] as string[],
  lock: 1,
}));
vi.mock("../../../db/mysql.js", () => {
  const exec = async (sql: string, p: unknown[] = []) => {
    const s = sql.replace(/\s+/g, " ").trim();
    h.sqls.push({ sql: s, p });
    if (s.startsWith("SELECT GET_LOCK")) return [[{ l: h.lock }], []];
    if (s.startsWith("SELECT RELEASE_LOCK")) return [[{ l: 1 }], []];
    if (s.includes("FROM ats_candidate ac WHERE ac.record_type = ?")) {
      const [rt, after, ...rest] = p as [string, string, ...unknown[]];
      const limit = Number(rest[rest.length - 1]);
      const details = rest.slice(0, -1);
      return [h.ats.filter((r) => r.record_type === rt && String(r.id) > after && (!details.length || details.includes(r.source_details))).sort((a, b) => String(a.id).localeCompare(String(b.id))).slice(0, limit), []];
    }
    if (s.startsWith("SELECT l.id, l.mobile10, l.is_employee, a.record_type AS linked_type FROM he_lead l")) return [h.leads.filter((l) => p.includes(l.mobile10)), []];
    // the employee list is read once per run, normalised in SQL (the mock returns it normalised)
    if (s.includes("FROM employees")) return [h.employees.map((m) => ({ m })), []];
    if (s.includes("FROM he_ex_employee")) return [h.exEmp.filter((x) => p.includes(x.mobile10) && x.clean_voluntary === 0), []];
    if (s.startsWith("SELECT id, mobile10 FROM he_lead WHERE mobile10 IN")) return [p.map((m, i) => ({ id: `lead-${String(m)}`, mobile10: m, i })), []];
    if (s.startsWith("SELECT UUID()")) return [[{ id: `batch-${h.sqls.filter((x) => x.sql.startsWith("SELECT UUID()")).length}` }], []];
    return [{ affectedRows: 1 }, []];
  };
  const conn = { execute: exec, query: exec, release: () => undefined,
    beginTransaction: async () => { h.tx.push("begin"); }, commit: async () => { h.tx.push("commit"); }, rollback: async () => { h.tx.push("rollback"); } };
  return { db: { execute: exec, query: exec, getConnection: async () => conn } };
});

import { bridgeAtsUpload } from "../he-upload-bridge.service.js";

const ats = (id: string, o: Row = {}): Row => ({ id, mobile: `98765${id.padStart(5, "0")}`, full_name: `Rig ${id}`, email: `r${id}@example.com`, record_type: "naukri_import", source_details: "SBI AHM_1.xlsx",
  education: "B.Com", date_of_birth: "2000-01-15", experience: "2 Year(s)", annual_salary: "INR 3 L", current_employer: "Teleperformance", current_designation: "Telecaller",
  current_address: "Ahmedabad", created_at: "2026-09-01 10:00:00", ...o });
const writes = () => h.sqls.filter((x) => /^(INSERT|UPDATE|DELETE)/.test(x.sql));
const leadInsert = () => h.sqls.filter((x) => x.sql.startsWith("INSERT INTO he_lead ("));

beforeEach(() => { h.sqls = []; h.leads = []; h.employees = []; h.exEmp = []; h.tx = []; h.lock = 1; h.ats = []; });

describe("bridge ATS imports into the pool (WS3 D2)", () => {
  it("dry run counts and writes nothing", async () => {
    h.ats = [ats("1"), ats("2"), ats("3", { mobile: "12345" })];
    const r = await bridgeAtsUpload({ recordTypes: ["naukri_import"], dryRun: true, actorId: "u1" });
    expect(r.totals).toMatchObject({ scanned: 3, inserted: 2, enriched: 0 });
    expect(r.totals.skipped.no_mobile).toBe(1);
    expect(writes()).toHaveLength(0);
  });

  it("never selects legacy or test records (record_type bound per statement)", async () => {
    await bridgeAtsUpload({ recordTypes: ["naukri_import", "workindia_import"], dryRun: true, actorId: "u1" });
    const reads = h.sqls.filter((x) => x.sql.includes("FROM ats_candidate ac WHERE ac.record_type = ?"));
    expect(reads.map((x) => x.p[0])).toEqual(["naukri_import", "workindia_import"]);
    await expect(bridgeAtsUpload({ recordTypes: ["legacy_employee" as never], dryRun: true, actorId: "u1" })).rejects.toMatchObject({ statusCode: 400 });
  });

  it("one import batch per source file, every bridged person linked to it", async () => {
    h.ats = [ats("1"), ats("2", { source_details: "TL_AM_161.xlsx" }), ats("3")];
    const r = await bridgeAtsUpload({ recordTypes: ["naukri_import"], dryRun: false, actorId: "u1" });
    expect(r.batches.map((b) => [b.sourceDetails, b.inserted])).toEqual([["SBI AHM_1.xlsx", 2], ["TL_AM_161.xlsx", 1]]);
    const batches = h.sqls.filter((x) => x.sql.startsWith("INSERT INTO he_import_batch"));
    expect(batches).toHaveLength(2);
    expect(batches[0].p).toEqual(expect.arrayContaining(["SBI AHM_1.xlsx (naukri_import)", "SBI AHM_1.xlsx", "naukri_import", 0, "u1"]));
    expect(h.sqls.filter((x) => x.sql.startsWith("INSERT IGNORE INTO he_lead_batch")).length).toBeGreaterThan(0);
  });

  it("an existing pool person is enriched with COALESCE only (never overwritten); legacy-linked and employees are skipped", async () => {
    h.ats = [ats("1"), ats("2"), ats("3")];
    h.leads = [{ id: "L1", mobile10: "9876500001", is_employee: 0, linked_type: null }, { id: "L2", mobile10: "9876500002", is_employee: 0, linked_type: "legacy_employee" }];
    h.employees = ["9876500003"];
    const r = await bridgeAtsUpload({ recordTypes: ["naukri_import"], dryRun: false, actorId: "u1" });
    expect(r.totals).toMatchObject({ inserted: 0, enriched: 1 });
    expect(r.totals.skipped).toMatchObject({ legacy_employee: 1, employee: 1 });
    const ins = leadInsert()[0];
    expect(ins.sql).toContain("ON DUPLICATE KEY UPDATE full_name = COALESCE(he_lead.full_name, VALUES(full_name))");
    expect(ins.sql).toContain("ats_candidate_id = COALESCE(he_lead.ats_candidate_id, VALUES(ats_candidate_id))");
    expect(ins.sql).not.toMatch(/primary_source = VALUES/);
    expect(ins.p).toContain("9876500001");
    expect(ins.p).not.toContain("9876500002");
    expect(ins.p).not.toContain("9876500003");
  });

  it("WorkIndia 'Graduate' and 'ccc' are unknown, never written as facts (S6 normaliser)", async () => {
    h.ats = [ats("1", { record_type: "workindia_import", source_details: "WorkIndia Data Base", education: "Graduate", current_address: "ccc", email: null, date_of_birth: null, annual_salary: null, current_employer: "ccc", current_designation: null })];
    await bridgeAtsUpload({ recordTypes: ["workindia_import"], dryRun: false, actorId: "u1" });
    const ins = leadInsert()[0];
    // (mobile10, full_name, email, age, education_rank, experience_years, primary_source, sources_json, ats_candidate_id)
    expect(ins.p.slice(0, 9)).toEqual(["9876500001", "Rig 1", null, null, null, 2, "workindia_import", JSON.stringify(["workindia_import"]), "1"]);
    const prof = h.sqls.find((x) => x.sql.startsWith("INSERT INTO he_lead_profile"));
    expect(prof?.p ?? []).not.toContain("ccc");
  });

  it("dedupes by mobile across files: the second row is counted, the person written once", async () => {
    h.ats = [ats("1"), ats("2", { mobile: "+91 98765 00001", source_details: "Other.xlsx" })];
    const r = await bridgeAtsUpload({ recordTypes: ["naukri_import"], dryRun: true, actorId: "u1" });
    expect(r.totals).toMatchObject({ inserted: 1 });
    expect(r.totals.skipped.duplicate_mobile).toBe(1);
  });

  it("chunks resume by the last id and stop at the row cap with a cursor", async () => {
    h.ats = Array.from({ length: 7 }, (_, i) => ats(String(i + 1)));
    const r = await bridgeAtsUpload({ recordTypes: ["naukri_import"], dryRun: true, actorId: "u1", chunk: 3, maxRows: 5 });
    const reads = h.sqls.filter((x) => x.sql.includes("FROM ats_candidate ac WHERE ac.record_type = ?"));
    expect(reads.map((x) => x.p[1])).toEqual(["", "3"]);
    expect(r.totals.scanned).toBe(5); // the last read asks only for what is left under the cap
    expect(r.next).toEqual({ recordType: "naukri_import", afterId: "5" });
    const again = await bridgeAtsUpload({ recordTypes: ["naukri_import"], dryRun: true, actorId: "u1", chunk: 3, after: r.next! });
    expect(again.totals.scanned).toBe(2);
    expect(again.next).toBeNull();
  });

  it("E3: current employees are matched on the normalised mobile (+91 / spaces / dashes), read once per run", async () => {
    h.ats = [ats("1"), ats("2")];
    h.employees = ["9876500002"];
    const r = await bridgeAtsUpload({ recordTypes: ["naukri_import"], dryRun: true, actorId: "u1" });
    expect(r.totals.skipped.employee).toBe(1);
    const emp = h.sqls.filter((x) => x.sql.includes("FROM employees"));
    expect(emp).toHaveLength(1);
    expect(emp[0].sql).toContain("RIGHT(REGEXP_REPLACE(mobile, '[^0-9]', ''), 10)");
  });
  it("E3: former employees not eligible for rehire (he_ex_employee, clean_voluntary = 0) are skipped; clean leavers are not", async () => {
    h.ats = [ats("1"), ats("2")];
    h.exEmp = [{ mobile10: "9876500001", clean_voluntary: 0 }, { mobile10: "9876500002", clean_voluntary: 1 }];
    const r = await bridgeAtsUpload({ recordTypes: ["naukri_import"], dryRun: true, actorId: "u1" });
    expect(r.totals.skipped.ex_employee).toBe(1);
    expect(r.totals.inserted).toBe(1);
  });
  it("E3: a real run is bounded per request (resumable cursor) and each chunk is one transaction", async () => {
    h.ats = Array.from({ length: 7 }, (_, i) => ats(String(i + 1)));
    const r = await bridgeAtsUpload({ recordTypes: ["naukri_import"], dryRun: false, actorId: "u1", chunk: 2, maxRows: 4 });
    expect(r.totals.scanned).toBe(4);
    expect(r.next).toEqual({ recordType: "naukri_import", afterId: "4" });
    expect(h.tx).toEqual(["begin", "commit", "begin", "commit", "begin", "commit"]); // two chunks + the batch counters
    const { REAL_RUN_MAX_ROWS } = await import("../he-upload-bridge.service.js");
    expect(REAL_RUN_MAX_ROWS).toBeLessThanOrEqual(5000);
  });
  it("E3: a real run never reads more than REAL_RUN_MAX_ROWS in one request, whatever maxRows asks", async () => {
    const { REAL_RUN_MAX_ROWS } = await import("../he-upload-bridge.service.js");
    h.ats = Array.from({ length: REAL_RUN_MAX_ROWS + 10 }, (_, i) => ats(String(i + 1).padStart(6, "0"), { mobile: `9${String(i + 1).padStart(9, "0")}` }));
    const r = await bridgeAtsUpload({ recordTypes: ["naukri_import"], dryRun: false, actorId: "u1", maxRows: 100_000 });
    expect(r.totals.scanned).toBe(REAL_RUN_MAX_ROWS);
    expect(r.next).not.toBeNull();
  });
  it("a second run while one is going is refused", async () => {
    h.lock = 0;
    await expect(bridgeAtsUpload({ recordTypes: ["naukri_import"], dryRun: false, actorId: "u1" })).rejects.toMatchObject({ statusCode: 409 });
  });
});
