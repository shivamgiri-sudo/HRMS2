import { describe, it, expect } from "vitest";
import { isOffRollType } from "../employee-code.service";

describe("isOffRollType", () => {
  // Confirmed live, 2026-09-09: Vijal Ramsingh Bhati's rehire (offer emp_type
  // "MGMT. TRAINEE") got MAS63510 instead of the historically-correct {n}C code,
  // because the exact-string check only matched bare "Trainee"/"OffRoll" -- the
  // real, dominant label for 13,833 existing employees is "MGMT. TRAINEE".
  it('recognizes "MGMT. TRAINEE", the real production label, not just bare "Trainee"', () => {
    expect(isOffRollType("MGMT. TRAINEE")).toBe(true);
  });

  it("still recognizes the original exact-match labels", () => {
    expect(isOffRollType("Trainee")).toBe(true);
    expect(isOffRollType("OffRoll")).toBe(true);
  });

  it("is case- and spacing-insensitive for OffRoll variants", () => {
    expect(isOffRollType("OFFROLL")).toBe(true);
    expect(isOffRollType("Off Roll")).toBe(true);
    expect(isOffRollType("off-roll")).toBe(true);
  });

  it("does not misclassify a genuinely on-roll type", () => {
    expect(isOffRollType("OnRoll")).toBe(false);
    expect(isOffRollType("ONROLL")).toBe(false);
  });

  it("leaves FIELD/ON SITE as on-roll, matching their existing 100% MAS-code history", () => {
    expect(isOffRollType("FIELD")).toBe(false);
    expect(isOffRollType("ON SITE")).toBe(false);
  });

  it("handles null/undefined/empty without throwing", () => {
    expect(isOffRollType(null)).toBe(false);
    expect(isOffRollType(undefined)).toBe(false);
    expect(isOffRollType("")).toBe(false);
  });
});

import { generateEmployeeCode } from '../employee-code.service';

/**
 * A fake connection modelling the part of InnoDB that caused MAS63701 to be issued twice:
 * a plain SELECT sees only a snapshot, but SELECT ... FOR UPDATE queues behind the holder
 * of the lock and then sees the latest committed sequence.
 */
function makeDb(startSeq: number, employeeMax: number) {
  const committed = { seq: startSeq };
  let holder: Promise<void> = Promise.resolve();
  const conn = () => {
    let release!: () => void;
    let waited = false;
    const done = new Promise<void>((r) => (release = r));
    const c: any = {
      async execute(sql: string, params: any[] = []) {
        if (/FOR UPDATE/.test(sql)) {
          if (!waited) { const prev = holder; holder = done; await prev; waited = true; }
          return [[{ id: 1, current_sequence: committed.seq }]];
        }
        if (/GREATEST\(/.test(sql) && /global_max/.test(sql)) return [[{ global_max: employeeMax }]];
        if (/UPDATE employee_code_sequence/.test(sql)) { committed.seq = Math.max(committed.seq, params[0]); return [{}]; }
        throw new Error('unexpected sql ' + sql);
      },
      commit: () => release(),
    };
    return c;
  };
  return { conn };
}

describe('generateEmployeeCode concurrency', () => {
  it('two overlapping transactions get different codes', async () => {
    const { conn } = makeDb(63700, 63700);
    const a = conn(), b = conn();
    const pa = generateEmployeeCode(a, 'OnRoll');
    const pb = generateEmployeeCode(b, 'OnRoll');
    const codeA = await pa;            // A holds the lock; B is still waiting
    a.commit();                        // A commits; B now reads A's number
    const codeB = await pb;
    expect(codeA).toBe('MAS63701');
    expect(codeB).toBe('MAS63702');
  });

  it('many overlapping transactions never repeat a code', async () => {
    const { conn } = makeDb(100, 100);
    const conns = Array.from({ length: 10 }, conn);
    const results = await Promise.all(conns.map(async (c) => {
      const code = await generateEmployeeCode(c, 'OnRoll');
      c.commit();
      return code;
    }));
    expect(new Set(results).size).toBe(10);
  });

  it('issues {n}C for off-roll from the same counter', async () => {
    const { conn } = makeDb(63700, 63700);
    expect(await generateEmployeeCode(conn(), 'MGMT. TRAINEE')).toBe('63701C');
  });

  it('uses the employees scan as a floor when it is ahead of the sequence', async () => {
    const { conn } = makeDb(10, 63705);
    expect(await generateEmployeeCode(conn(), 'OnRoll')).toBe('MAS63706');
  });
});
