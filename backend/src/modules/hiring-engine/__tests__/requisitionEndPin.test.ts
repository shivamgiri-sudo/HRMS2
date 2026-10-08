/**
 * Pin (WS3 E1, snapshot-first): the statements of the stream auto-close and of the engine's first invites for a drive, taken before the
 * requisition end date could close streams or skip first contacts. With the end-date switch off they must stay the same.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ sqls: [] as string[], rows: (_s: string): unknown[] => [] }));
vi.mock("../../../db/mysql.js", () => {
  const exec = async (sql: string) => { h.sqls.push(sql.replace(/\s+/g, " ").trim()); return [h.rows(sql), []]; };
  const conn = { execute: exec, beginTransaction: async () => undefined, commit: async () => undefined, rollback: async () => undefined, release: () => undefined };
  return { db: { execute: exec, query: exec, getConnection: async () => conn } };
});

import { autoCloseStreams } from "../requisition-stream.service.js";
import { inviteForDrive } from "../he-engine.service.js";

beforeEach(() => { h.sqls = []; h.rows = () => []; delete process.env.REQ_END_DATE_ENFORCEMENT; });

describe("end-date pins (switch off)", () => {
  it("auto-close reads streams with their requisition and closes by the window", async () => {
    h.rows = (s) => (s.includes("FROM requisition_stream s") ? [{ id: "s1", requisition_id: "r1", branch_name: "NOIDA-2", source_type: "he", origin_id: "pool", origin_label: "Pool",
      open_from: "2026-09-01", open_days: 3, daily_invites: null, status: "open", closed_reason: null, version: 0, created_by: null, created_at: "2026-09-01",
      approval_status: "approved", active_status: 1, requested_headcount: 10, fulfilled_headcount: 0, jr_id: "r1" }] : []);
    const out = await autoCloseStreams("2026-10-09", true);
    expect({ out, statements: h.sqls }).toMatchSnapshot();
  });
  it("first invites of a drive: the statements before any send", async () => {
    const r = await inviteForDrive("d1", { dryRun: true, max: 10 });
    expect({ considered: r.considered, statements: h.sqls }).toMatchSnapshot();
  });
});
