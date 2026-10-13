import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  sqls: [] as string[],
  cur: null as Record<string, unknown> | null,
  open: [] as Record<string, unknown>[],
  existing: null as Record<string, unknown> | null,
}));

vi.mock("../../../db/mysql.js", () => ({
  db: {
    execute: vi.fn(async (sql: string) => {
      h.sqls.push(sql);
      if (sql.includes("FROM he_match m JOIN job_requisition")) return [h.cur ? [h.cur] : [], []];
      if (sql.includes("FROM job_requisition j WHERE")) return [h.open, []];
      if (sql.includes("SELECT id, state FROM he_match")) return [h.existing ? [h.existing] : [], []];
      if (sql.includes("INSERT INTO he_drive")) return [{ affectedRows: 1 }, []];
      if (sql.includes("FROM he_drive WHERE")) return [[{ id: "DRV", status: "active" }], []];
      return [{ affectedRows: 1 }, []];
    }),
  },
}));
vi.mock("../../../logger.js", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
const addEvent = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("../he-lead.service.js", () => ({ addEvent }));

import { carryOverArrival } from "../arrival-carryover.js";

const now = new Date("2026-10-12T05:00:00Z");
const base = { lead_id: "L1", requisition_id: "R-OLD", drive_branch: "NOIDA-2", drive_date: "2026-10-12", designation_name: "Agent", branch_name: "NOIDA-2",
  process_id: "P1", process_name: "Onfido", requisition_validity: "2026-10-01", requisition_code: "NOIDA-Onfido-17" };
const open = (id: string, code: string, v: string | null) => ({ id, requisition_code: code, designation_name: "Agent", branch_name: "NOIDA-2", process_id: "P1",
  requisition_validity: v, requested_headcount: 10, fulfilled_headcount: 2, approval_status: "approved", active_status: 1, closed_at: null });

beforeEach(() => { h.sqls = []; h.cur = { ...base }; h.open = []; h.existing = null; addEvent.mockClear(); });

describe("carryOverArrival", () => {
  it("running requisition: nothing to carry", async () => {
    h.cur = { ...base, requisition_validity: "2026-10-20" };
    expect(await carryOverArrival("M1", now)).toEqual({ status: "skipped", reason: "requisition_running" });
  });
  it("ended requisition: the nearest-deadline open requisition gets an unplanned arrival", async () => {
    h.open = [open("R-A", "NOIDA-Onfido-30", "2026-10-31"), open("R-B", "NOIDA-Onfido-22", "2026-10-24")];
    expect(await carryOverArrival("M1", now)).toEqual({ status: "carried", requisitionId: "R-B", code: "NOIDA-Onfido-22" });
    expect(h.sqls.some((s) => s.startsWith("INSERT INTO he_match") && s.includes("'arrived',NULL"))).toBe(true);
    expect(addEvent).toHaveBeenCalledWith("L1", "carried_over", expect.objectContaining({ driveId: "DRV" }));
  });
  it("no open requisition: skipped, nothing written", async () => {
    expect(await carryOverArrival("M1", now)).toEqual({ status: "skipped", reason: "no_open_requisition" });
    expect(h.sqls.some((s) => s.startsWith("INSERT INTO he_match"))).toBe(false);
  });
  it("already arrived there: idempotent", async () => {
    h.open = [open("R-B", "NOIDA-Onfido-22", "2026-10-24")];
    h.existing = { id: "M9", state: "arrived" };
    expect(await carryOverArrival("M1", now)).toEqual({ status: "skipped", reason: "already_on_requisition" });
  });
  it("an earlier invited match on the successor is moved to arrived", async () => {
    h.open = [open("R-B", "NOIDA-Onfido-22", "2026-10-24")];
    h.existing = { id: "M9", state: "invited" };
    expect((await carryOverArrival("M1", now)).status).toBe("carried");
    expect(h.sqls.some((s) => s.startsWith("UPDATE he_match SET state = 'arrived'"))).toBe(true);
  });
});
