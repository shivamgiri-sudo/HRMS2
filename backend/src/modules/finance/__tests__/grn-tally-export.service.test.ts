import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Call = { sql: string; params: any[] };
const h = vi.hoisted(() => {
  const state = {
    calls: [] as { sql: string; params: any[] }[],
    candidateRows: [] as any[],
    exportedIds: [] as string[],
    failInsertFor: null as string | null,
  };
  const execute = vi.fn(async (sql: string, params: any[] = []) => {
    state.calls.push({ sql, params });
    if (/FROM grn_request g/.test(sql) && /bill_source_id IS NULL/.test(sql))
      return [state.candidateRows, undefined];
    if (/FROM grn_tally_export WHERE grn_request_id IN/.test(sql))
      return [
        state.exportedIds.map((id) => ({ grn_request_id: id })),
        undefined,
      ];
    if (/FROM vendor_master/.test(sql))
      return [[{ id: "v1", n: "OESPL Private Limited" }], undefined];
    if (/FROM branch_master/.test(sql))
      return [[{ id: "b1", n: "NOIDA" }], undefined];
    if (/FROM grn_tally_export_batch WHERE status = 'claimed'/.test(sql))
      return [[], undefined];
    if (
      /INSERT INTO grn_tally_export \(/.test(sql) &&
      state.failInsertFor &&
      params[0] === state.failInsertFor
    )
      throw new Error("Duplicate entry");
    return [[], undefined];
  });
  const connection = {
    beginTransaction: vi.fn(async () => undefined),
    commit: vi.fn(async () => undefined),
    rollback: vi.fn(async () => undefined),
    release: vi.fn(),
    execute,
  };
  return { state, execute, connection };
});
const calls = h.state.calls;
const connection = h.connection;
vi.mock("../../../db/mysql.js", () => ({
  db: { execute: h.execute, getConnection: async () => h.connection },
}));

import {
  missingConfig,
  readGrnTallyConfig,
  runGrnTallyExport,
} from "../grn-tally-export.service.js";

const row = (id: string, n: string) => ({
  id,
  grn_number: n,
  grn_type: "vendor",
  bill_date: "2026-09-01",
  invoice_number: "INV",
  vendor_id: "v1",
  vendor_name: "OESPL",
  head: "Office Rent",
  sub_head: "Office Rent",
  description: null,
  branch_id: "b1",
  amount: 118000,
  amount_without_tax: 100000,
  tax_amount: 18000,
  other_charges: 0,
  round_off_amount: 0,
  amount_with_tax: 118000,
  gst_type: "cgst_sgst",
  recoverable_tax_pct: 100,
  approved_on: "2026-10-06 18:00:00",
});

let dir = "";
beforeEach(() => {
  h.state.calls.length = 0;
  h.state.candidateRows = [];
  h.state.exportedIds = [];
  h.state.failInsertFor = null;
  Object.values(connection).forEach((f) => (f as any).mockClear?.());
  dir = mkdtempSync(path.join(tmpdir(), "grn-tally-"));
  process.env.GRN_TALLY_EXPORT_DIR = dir;
  process.env.GRN_TALLY_EXPORT_FROM = "2026-10-01";
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.GRN_TALLY_EXPORT_DIR;
  delete process.env.GRN_TALLY_EXPORT_FROM;
});

describe("config", () => {
  it("reports what is missing", () => {
    expect(missingConfig(readGrnTallyConfig({} as any))).toHaveLength(2);
    expect(
      missingConfig(
        readGrnTallyConfig({
          GRN_TALLY_EXPORT_DIR: "D:\\x",
          GRN_TALLY_EXPORT_FROM: "2026-10-01",
        } as any),
      ),
    ).toEqual([]);
    expect(
      readGrnTallyConfig({
        GRN_TALLY_EXPORT_DIR: "D:\\x",
        GRN_TALLY_EXPORT_FROM: "01-10-2026",
      } as any).from,
    ).toBeNull();
  });
});

describe("runGrnTallyExport", () => {
  it("does nothing and says so until it is configured", async () => {
    delete process.env.GRN_TALLY_EXPORT_DIR;
    const r = await runGrnTallyExport({ trigger: "manual" });
    expect(r.status).toBe("not_configured");
    expect(calls).toHaveLength(0);
  });

  it("writes one XML file, reserves each GRN, and leaves no .tmp behind", async () => {
    h.state.candidateRows = [
      row("g1", "Mas/10/26/1"),
      row("g2", "Mas/10/26/2"),
    ];
    const r = await runGrnTallyExport({ trigger: "manual", actorUserId: "u1" });
    expect(r.status).toBe("written");
    if (r.status !== "written") return;
    expect(r.vouchers).toBe(2);
    expect(r.totalAmount).toBe(236000);
    const files = readdirSync(dir);
    expect(files).toEqual([r.fileName]);
    const xml = readFileSync(path.join(dir, r.fileName), "utf8");
    expect(xml).toContain("<VOUCHERNUMBER>Mas/10/26/1</VOUCHERNUMBER>");
    expect(xml).toContain("<VOUCHERNUMBER>Mas/10/26/2</VOUCHERNUMBER>");
    const reservations = calls.filter((c) =>
      /INSERT INTO grn_tally_export \(/.test(c.sql),
    );
    expect(reservations.map((c) => c.params[0])).toEqual(["g1", "g2"]);
    expect(connection.commit).toHaveBeenCalledTimes(1);
  });

  it("skips GRNs that were already exported", async () => {
    h.state.candidateRows = [
      row("g1", "Mas/10/26/1"),
      row("g2", "Mas/10/26/2"),
    ];
    h.state.exportedIds = ["g1"];
    const r = await runGrnTallyExport({ trigger: "manual" });
    expect(r.status === "written" && r.vouchers).toBe(1);
    expect(
      calls
        .filter((c) => /INSERT INTO grn_tally_export \(/.test(c.sql))
        .map((c) => c.params[0]),
    ).toEqual(["g2"]);
  });

  it("exports nothing when every candidate is already exported", async () => {
    h.state.candidateRows = [row("g1", "Mas/10/26/1")];
    h.state.exportedIds = ["g1"];
    expect((await runGrnTallyExport({ trigger: "manual" })).status).toBe(
      "nothing_to_export",
    );
    expect(readdirSync(dir)).toHaveLength(0);
  });

  it("a GRN another run has reserved rolls the whole batch back and leaves no file", async () => {
    h.state.candidateRows = [
      row("g1", "Mas/10/26/1"),
      row("g2", "Mas/10/26/2"),
    ];
    h.state.failInsertFor = "g2";
    await expect(runGrnTallyExport({ trigger: "manual" })).rejects.toThrow(
      /Duplicate/,
    );
    expect(connection.rollback).toHaveBeenCalledTimes(1);
    expect(connection.commit).not.toHaveBeenCalled();
    expect(readdirSync(dir)).toHaveLength(0);
  });

  it("holds back a GRN whose figures do not add up and exports the rest", async () => {
    h.state.candidateRows = [
      row("g1", "Mas/10/26/1"),
      { ...row("g2", "Mas/10/26/2"), amount_without_tax: 50000 },
    ];
    const r = await runGrnTallyExport({ trigger: "manual" });
    expect(r.status === "written" && r.vouchers).toBe(1);
    expect(
      r.status === "written" && r.exceptions.map((e) => e.grnNumber),
    ).toEqual(["Mas/10/26/2"]);
  });

  it("a dry run writes nothing and reserves nothing", async () => {
    h.state.candidateRows = [row("g1", "Mas/10/26/1")];
    const r = await runGrnTallyExport({ trigger: "manual", dryRun: true });
    expect(r).toMatchObject({ status: "dry_run", wouldExport: 1 });
    expect(existsSync(dir) && readdirSync(dir)).toEqual([]);
    expect(calls.some((c) => /INSERT INTO/.test(c.sql))).toBe(false);
  });
});
