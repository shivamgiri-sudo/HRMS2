/**
 * Pin of the calling-file live path: the batch schedule and every SQL statement one live batch runs, in order. A change to either shows
 * up here as a snapshot diff that has to be reviewed on purpose.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const execute = vi.hoisted(() => vi.fn());
const send = vi.hoisted(() => vi.fn());
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));
vi.mock("../../../logger.js", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock("../../communication/email.service.js", () => ({ emailService: { send } }));

import { readSwitches } from "../qualified-followup.policy.js";
import { runCallFileBatch } from "../qualified-followup.callfile.js";
import { CALL_FILE_SLOTS } from "../qualified-followup.rules.js";

const norm = (s: unknown) => String(s).replace(/\s+/g, " ").trim();
const dbRow = { id: "id-1", source_type: "meta_live", mobile10: "9876543210", full_name: "asha rao", role_name: "Support", address: "Sector 62", slot_date: "2026-10-08", slot_time: "10:30:00" };

beforeEach(() => {
  execute.mockReset(); send.mockReset(); send.mockResolvedValue({});
  execute.mockImplementation(async (sql: string) => {
    const q = String(sql);
    if (q.includes("FROM qualified_followup_call_batch")) return [[]];
    if (q.includes("FROM qualified_followup qf")) return [[dbRow]];
    return [{ affectedRows: 1 }];
  });
});

describe("calling file pin", () => {
  it("batch schedule", () => {
    expect([...CALL_FILE_SLOTS]).toMatchSnapshot();
  });
  it("SQL of one live batch, in order", async () => {
    await runCallFileBatch(readSwitches({ QUAL_FOLLOWUP_MODE: "live" } as NodeJS.ProcessEnv), "live", new Date("2026-10-07T10:00:00+05:30"));
    expect(execute.mock.calls.map(([sql]) => norm(sql))).toMatchSnapshot();
  });
});
