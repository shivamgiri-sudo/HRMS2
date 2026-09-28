import { describe, it, expect } from "vitest";
import {
  IN_USE_LIMIT_PER_PROCESS, loadShiftOptions, mergeShiftOptions, normalizeTime, optionLabel, resolveShiftChoice, shiftProblem,
} from "../team-roster-shifts.js";
import { createFakeDb, rows } from "./__fixtures__/team-roster-fake-db.js";

const tpl = (id: string, code: string, start: string, end: string, extra: Record<string, unknown> = {}) => ({ id, shiftCode: code, shiftName: `${code} shift`, start, end, ...extra });

describe("mergeShiftOptions - three sources, de-duplicated by (start, end)", () => {
  it("offers time-only shifts that are merely in use, most used first, labelled HH:MM-HH:MM", () => {
    const out = mergeShiftOptions({
      templates: [], masters: [],
      inUse: [{ start: "09:30", end: "18:30", count: 5 }, { start: "10:00", end: "19:00", count: 40 }, { start: "08:00:00", end: "17:00:00", count: 12 }],
    });
    expect(out.map((o) => o.key)).toEqual(["10:00-19:00", "08:00-17:00", "09:30-18:30"]);
    expect(out[0]).toMatchObject({ label: "10:00–19:00", group: "In use", sources: ["in_use"], templateId: null, shiftMasterId: null, useCount: 40, night: false });
  });

  it("de-duplicates across sources on (start,end): one option, ids from template and master, usage counted, template group wins", () => {
    const out = mergeShiftOptions({
      templates: [tpl("t1", "GEN", "09:00:00", "18:00:00")],
      masters: [{ id: "sm1", shiftCode: "GEN-M", shiftName: "General master", start: "09:00", end: "18:00" }, { id: "sm2", shiftCode: "EVE", shiftName: "Evening", start: "14:00", end: "23:00" }],
      inUse: [{ start: "09:00", end: "18:00", count: 30 }, { start: "09:00:00", end: "18:00:00", count: 5 }],
    });
    expect(out).toHaveLength(2);
    const gen = out.find((o) => o.key === "09:00-18:00")!;
    expect(gen).toMatchObject({ group: "Templates", templateId: "t1", shiftMasterId: "sm1", useCount: 35, code: "GEN" });
    expect([...gen.sources].sort()).toEqual(["in_use", "shift_master", "template"]);
    expect(gen.label).toBe("09:00–18:00 - GEN shift");
    expect(out.find((o) => o.key === "14:00-23:00")).toMatchObject({ group: "Shift master", shiftMasterId: "sm2" });
    expect(out[0].group).toBe("Templates");
  });

  it("caps the in-use options per process, and drops empty or zero-length shifts", () => {
    const inUse = Array.from({ length: 30 }, (_, i) => ({ start: `${String(i % 24).padStart(2, "0")}:00`, end: `${String(((i % 24) + 1) % 24).padStart(2, "0")}:30`, count: 100 - i }));
    const out = mergeShiftOptions({ templates: [tpl("t0", "ZERO", "10:00", "10:00")], masters: [{ id: "m", shiftCode: "X", shiftName: "X", start: null, end: null }], inUse: [...inUse, { start: "11:00", end: "11:00", count: 999 }] });
    expect(out).toHaveLength(IN_USE_LIMIT_PER_PROCESS);
    expect(out.some((o) => o.start === o.end)).toBe(false);
  });

  it("flags a night shift (end before start)", () => {
    expect(mergeShiftOptions({ templates: [], masters: [], inUse: [{ start: "22:00", end: "06:00", count: 3 }] })[0].night).toBe(true);
  });

  it("normalizes times and labels", () => {
    expect(normalizeTime("9:05:00")).toBe("09:05");
    expect(normalizeTime("24:00")).toBeNull();
    expect(normalizeTime("abc")).toBeNull();
    expect(optionLabel("10:00", "19:00", null, null)).toBe("10:00–19:00");
  });
});

describe("resolveShiftChoice - the server never trusts client times", () => {
  const options = mergeShiftOptions({
    templates: [tpl("t1", "GEN", "09:00", "18:00", { effectiveFrom: "2026-10-05", effectiveTo: "2026-10-20" })], masters: [],
    inUse: [{ start: "10:00", end: "19:00", count: 9 }],
  });

  it("returns the server's own option for matching times, taking ids from it and not from the client", () => {
    const o = resolveShiftChoice({ shiftStart: "9:00", shiftEnd: "18:00", shiftTemplateId: "forged", shiftMasterId: "forged" }, options, "2026-10-10");
    expect(o).toMatchObject({ key: "09:00-18:00", templateId: "t1", shiftMasterId: null });
  });

  it("resolves a template id (legacy client) to its times", () => {
    expect(resolveShiftChoice({ shiftTemplateId: "t1" }, options, "2026-10-10").key).toBe("09:00-18:00");
  });

  it("refuses forged / foreign times, zero-length and missing shifts", () => {
    expect(() => resolveShiftChoice({ shiftStart: "03:15", shiftEnd: "11:45" }, options, "2026-10-10")).toThrowError(expect.objectContaining({ code: "SHIFT_NOT_ALLOWED" }));
    expect(() => resolveShiftChoice({ shiftStart: "10:00", shiftEnd: "10:00" }, options, "2026-10-10")).toThrowError(expect.objectContaining({ code: "SHIFT_ZERO_LENGTH" }));
    expect(() => resolveShiftChoice({}, options, "2026-10-10")).toThrowError(expect.objectContaining({ code: "SHIFT_REQUIRED" }));
    expect(shiftProblem({ shiftStart: "03:15", shiftEnd: "11:45" }, options, "2026-10-10")).toMatch(/not one of the shifts available/);
  });

  it("enforces a template-only option's effective window, but not once the same times are in use", () => {
    expect(() => resolveShiftChoice({ shiftStart: "09:00", shiftEnd: "18:00" }, options, "2026-10-01")).toThrowError(expect.objectContaining({ code: "SHIFT_NOT_EFFECTIVE" }));
    expect(() => resolveShiftChoice({ shiftStart: "09:00", shiftEnd: "18:00" }, options, "2026-10-25")).toThrowError(expect.objectContaining({ code: "SHIFT_NOT_EFFECTIVE" }));
    expect(resolveShiftChoice({ shiftStart: "10:00", shiftEnd: "19:00" }, options, "2026-10-01").key).toBe("10:00-19:00");
    const both = mergeShiftOptions({ templates: [tpl("t1", "GEN", "09:00", "18:00", { effectiveFrom: "2026-10-05" })], masters: [], inUse: [{ start: "09:00", end: "18:00", count: 2 }] });
    expect(resolveShiftChoice({ shiftStart: "09:00", shiftEnd: "18:00" }, both, "2026-10-01").key).toBe("09:00-18:00");
  });
});

describe("loadShiftOptions - three queries, per process", () => {
  it("merges the template, in-use and shift-master queries for each process", async () => {
    const fake = createFakeDb();
    fake.on(/FROM process_master WHERE id IN/, () => rows([{ id: "p1", process_name: "BACK OFFICE" }, { id: "p2", process_name: "GS1" }]));
    fake.on(/FROM wfm_shift_template\s+WHERE process_id IN/, () => rows([
      { id: "t2", shift_code: "GEN", shift_name: "General v2", process_id: "p1", start_time: "09:00:00", end_time: "18:00:00", effective_from: null, effective_to: null },
      { id: "t1", shift_code: "GEN", shift_name: "General v1", process_id: "p1", start_time: "08:00:00", end_time: "17:00:00", effective_from: null, effective_to: null },
    ]));
    fake.on(/FROM wfm_roster_assignment wra JOIN employees e/, () => rows([
      { process_id: "p1", shift_start_time: "10:00", shift_end_time: "19:00", uses: 40 },
      { process_id: "p1", shift_start_time: "10:00:00", shift_end_time: "19:00:00", uses: 2 },
      { process_id: "p2", shift_start_time: "09:30", shift_end_time: "18:30", uses: 7 },
    ]));
    fake.on(/FROM wfm_shift_master/, () => rows([
      { id: "sm1", shift_code: "GS", shift_name: "GS1 day", process_name: "GS1", start_time: "09:30:00", end_time: "18:30:00" },
      { id: "smX", shift_code: "OTHER", shift_name: "Other", process_name: "SOMEWHERE ELSE", start_time: "01:00", end_time: "02:00" },
    ]));
    const out = await loadShiftOptions(["p1", "p2"], "2026-10-01", fake);
    expect(out.get("p1")!.map((o) => o.key)).toEqual(["09:00-18:00", "10:00-19:00"]);
    expect(out.get("p1")![1]).toMatchObject({ group: "In use", useCount: 42 });
    expect(out.get("p2")![0]).toMatchObject({ key: "09:30-18:30", group: "Shift master", shiftMasterId: "sm1", useCount: 7 });
    const inUse = fake.statements(/FROM wfm_roster_assignment wra JOIN employees e/)[0];
    expect(inUse.sql).toMatch(/INTERVAL 60 DAY/);
    expect(inUse.sql).toMatch(/is_week_off = 0/);
    expect(inUse.sql).toMatch(/assignment_type IS NULL OR wra\.assignment_type IN \('SHIFT', 'REGULAR'\)/);
    expect(inUse.sql).toMatch(/shift_start_time IS NOT NULL AND wra\.shift_end_time IS NOT NULL/);
    const master = fake.statements(/FROM wfm_shift_master/)[0];
    expect(master.params.slice(0, 2)).toEqual(["BACK OFFICE", "GS1"]);
    expect(master.sql).toMatch(/active_status = 1/);
    expect(fake.log).toHaveLength(4);
  });

  it("does nothing for no processes", async () => {
    const fake = createFakeDb();
    expect((await loadShiftOptions([], "2026-10-01", fake)).size).toBe(0);
    expect(fake.log).toHaveLength(0);
  });
});
