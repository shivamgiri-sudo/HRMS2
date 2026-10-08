import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const src = readFileSync(resolve(__dirname, "../wfm-ext.service.ts"), "utf8");
const listBody = src.slice(src.indexOf("export const rosterSwapService"), src.indexOf("async create(data: { requester_emp_id"));

describe("rosterSwapService.list exposes counterpart_status", () => {
  it("selects s.counterpart_status so the inbox can show the counterpart's answer", () => {
    expect(listBody).toContain("s.counterpart_status");
  });
  it("probes the column first so a DB without migration 1212 does not 500 the list", () => {
    expect(listBody).toContain('columnExists("wfm_roster_swap_request", "counterpart_status")');
    expect(listBody).toContain("NULL AS counterpart_status");
  });
});
