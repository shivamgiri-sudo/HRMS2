import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Every process dropdown is fed by process_master, and by nothing else.
 *
 * The ATS previously offered ats_form_config.hiringProcessOptions — a separately
 * hand-maintained list of short names ("Housing", "LP", "BBB", "Neeman's") for clients
 * that process_master already held under their full names ("Housing.com", "Bla Bli Blu",
 * "Neemans Private Limited"). Measured on production before the change: 21 options, of
 * which only 6 matched an active process, 13 existed nowhere in process_master, and 59
 * active clients were not offered at all — so recruiters could not select most of the
 * live book of business, and the same client was recorded under two different names
 * depending on which screen was used.
 *
 * The rejected alternative was an alias table translating each short name to a process
 * id. It resolves to the same row, but keeps two names alive per client permanently and
 * requires every new process to be registered twice; whoever forgets the second one
 * creates a gap that still reads as complete.
 *
 * These tests pin the direction of the dependency: the master feeds the dropdown, and no
 * fallback to the config list survives.
 */

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../src/db/mysql.js", () => ({ db: { execute }, pingDb: vi.fn() }));

import { listActiveProcessNames } from "../src/modules/ats/process-options.js";

beforeEach(() => execute.mockReset());

describe("process options come from process_master", () => {
  it("queries process_master for active processes only", async () => {
    execute.mockResolvedValueOnce([[{ process_name: "Housing.com" }], []]);
    await listActiveProcessNames();

    const [sql] = execute.mock.calls[0];
    expect(String(sql)).toContain("FROM process_master");
    expect(String(sql)).toContain("active_status = 1");
    // A closed process must not be offered for a new interview.
    expect(String(sql)).not.toMatch(/ats_form_config/i);
  });

  it("returns the master's own names, untouched", async () => {
    execute.mockResolvedValueOnce([[
      { process_name: "Housing.com" },
      { process_name: "Neemans Private Limited" },
      { process_name: "Godfrey Philips India Ltd" },
    ], []]);

    // Full names, not the "Housing" / "Neeman's" / "GPI" the old list carried.
    expect(await listActiveProcessNames()).toEqual([
      "Housing.com", "Neemans Private Limited", "Godfrey Philips India Ltd",
    ]);
  });

  it("collapses names that differ only by case or padding", async () => {
    // The master carries near-duplicates; two visually identical dropdown entries are a
    // support call, and the second would resolve to a different row.
    execute.mockResolvedValueOnce([[
      { process_name: "Onfido" },
      { process_name: " Onfido " },
      { process_name: "ONFIDO" },
      { process_name: "Clovia" },
    ], []]);

    expect(await listActiveProcessNames()).toEqual(["Onfido", "Clovia"]);
  });

  it("drops blank names rather than offering an empty option", async () => {
    execute.mockResolvedValueOnce([[
      { process_name: "Onfido" },
      { process_name: "   " },
    ], []]);

    expect(await listActiveProcessNames()).toEqual(["Onfido"]);
  });
});

describe("the hand-maintained config list is no longer a source of process names", () => {
  const read = (path: string) => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { readFileSync } = require("node:fs");
    const { resolve } = require("node:path");
    return readFileSync(resolve(process.cwd(), path), "utf8");
  };

  it("the ATS form bootstrap serves process names from the master", () => {
    const source = read("src/modules/ats/ats-form-config.service.ts");
    expect(source).toContain("listActiveProcessNames");
    // The old expression read the stored config list straight through.
    expect(source).not.toMatch(/hiringProcessOptions:\s*Array\.isArray\(configMap\['hiringProcessOptions'\]\)/);
  });

  it("the recruiter workspace bootstrap serves process names from the master", () => {
    const source = read("src/modules/ats/recruiter-hiring.service.ts");
    expect(source).toContain("listActiveProcessNames");
    // processOptions must no longer be destructured out of the config lookup.
    expect(source).not.toMatch(/hiringProcessOptions:\s*processOptions/);
  });
});
