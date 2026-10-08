import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { SELF_EDITABLE_PERSONAL_COLUMNS } from "../fieldOwnership.js";

// ── Task 1: employment_status case consistency ──────────────────────────────
describe("activateEmployee — employment_status case", () => {
  it("activation SQL must write capital-A Active, matching payroll/attendance filters", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "../employee-activation.service.ts"),
      "utf8",
    );
    expect(src).toContain("employment_status = 'Active'");
  });
});

// ── Task 2: userId must not be patchable via updateEmployee ──────────────────
describe("updateEmployeeSchema — userId not patchable", () => {
  it("updateEmployeeSchema must not contain userId field", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "../employee.validation.ts"),
      "utf8",
    );
    expect(src).not.toMatch(/userId\s*:\s*z\.string\(\)\.uuid\(\)/);
  });

  it("updateEmployee service must not build a user_id SET clause from input.userId", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "../employee.service.ts"),
      "utf8",
    );
    expect(src).not.toMatch(/input\.userId[^}]+user_id\s*=\s*\?/);
  });
});

/**
 * One routed handler in employee.routes.ts, from its registration to the next top-level
 * statement. The file is prettier-formatted, so a registration reads `router.put(\n  "/path",`
 * and a handler ends `  }),\n);` — the old `router.put("/path"` / `\n}));` markers match
 * nothing, and a missing start marker silently produced an EMPTY section, against which every
 * `not.toContain` assertion passes. This throws instead of returning ''.
 */
function routedHandler(verb: string, routePath: string): string {
  const src = fs.readFileSync(path.resolve(__dirname, '../employee.routes.ts'), 'utf8');
  const escaped = routePath.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  const start = src.search(new RegExp(`^router\\.${verb}\\(\\s*"${escaped}"`, 'm'));
  expect(start, `routed ${verb.toUpperCase()} ${routePath} handler not found in employee.routes.ts`).toBeGreaterThan(-1);
  const rest = src.slice(start + 1);
  const next = rest.search(/^(?:router\.|function |const |export |\/\/ )/m);
  const section = next === -1 ? src.slice(start) : src.slice(start, start + 1 + next);
  expect(section.length, 'handler section is empty').toBeGreaterThan(50);
  return section;
}

// ── Task 3: official_email is not freely self-serviceable ────────────────────
//
// Until 41311c0f5 (2026-09-28) PATCH /me refused official_email outright. It now lets an
// employee fill it in exactly ONCE, while employees.official_email is still empty, and only
// with a company-domain address that no other account holds; once set (by IT, HR or the
// employee) it locks and the 403 below applies again. What this block guards is unchanged in
// spirit: the login identity cannot be re-pointed by its owner, and never through the
// generic allowlist loop.
describe('PATCH /me — official_email is set-once, then locked', () => {
  // These assertions used to read employee.profile.service.ts, which has NO importer:
  // `updateMyProfile` exists in three places and only the inline router.patch("/me")
  // handler in employee.routes.ts is routed. The other two (employee.profile.service.ts,
  // employee.controller.ts) are unreachable, so guarding them proved nothing about the
  // live endpoint. Read the routed handler instead.
  /** The body of the routed PATCH /me handler, isolated from the rest of the file. */
  function patchMeHandler(): string {
    return routedHandler('patch', '/me');
  }

  /** The `if (req.body.official_email !== undefined) { ... }` guard block. */
  function officialEmailGuard(): string {
    const section = patchMeHandler();
    const start = section.search(/if\s*\(\s*req\.body\.official_email\s*!==\s*undefined\s*\)/);
    expect(start, 'official_email guard not found in PATCH /me').toBeGreaterThan(-1);
    const end = section.indexOf('officialEmailToSync = candidate', start);
    expect(end, 'guard must end by accepting the candidate').toBeGreaterThan(start);
    return section.slice(start, end);
  }

  it('rejects official_email with a 403 once one is already stored, before building any UPDATE', () => {
    const section = patchMeHandler();
    const guard = officialEmailGuard();
    // Reads the stored value for THIS employee and refuses when it is non-empty.
    expect(guard).toMatch(/SELECT official_email FROM employees WHERE id = \?/);
    expect(guard).toMatch(/if\s*\(\s*currentRows\[0\]\?\.official_email\s*\)\s*\{\s*return res\s*\.status\(403\)/);
    // ...and the whole guard runs before the first SET clause is built.
    expect(section.indexOf('officialEmailToSync = candidate'))
      .toBeLessThan(section.indexOf('updates.push('));
  });

  it('only accepts a company-domain address that no other account holds', () => {
    const guard = officialEmailGuard();
    expect(guard).toMatch(/if\s*\(\s*!isOfficialEmail\(candidate\)\s*\)\s*\{\s*return res\s*\.status\(400\)/);
    expect(guard).toMatch(/SELECT id FROM auth_user WHERE email = \? AND id != \?/);
    expect(guard).toMatch(/if\s*\(\s*conflictRows\.length\s*\)\s*\{\s*return res\s*\.status\(409\)/);
    // Domain check, then already-set check, then conflict check — all before acceptance.
    expect(guard.indexOf('isOfficialEmail(')).toBeLessThan(guard.indexOf('status(403)'));
    expect(guard.indexOf('status(403)')).toBeLessThan(guard.indexOf('status(409)'));
  });

  it('writes the official_email column only from the guarded, validated value', () => {
    const section = patchMeHandler();
    // Exactly one place writes the column, and it is gated on the guard's output — never on
    // req.body directly.
    const writes = [...section.matchAll(/official_email`?\s*=\s*\?/g)];
    expect(writes).toHaveLength(1);
    expect(section).toMatch(
      /if\s*\(\s*officialEmailToSync\s*\)\s*\{\s*updates\.push\("`official_email` = \?"\);\s*values\.push\(officialEmailToSync\);/,
    );
    expect(section).not.toMatch(/values\.push\(\s*req\.body\.official_email/);
    // The login identity moves with it, and the change is audited under its own action type.
    expect(section).toMatch(/UPDATE auth_user SET email = \? WHERE id = \?/);
    expect(section).toContain('EMPLOYEE_SELF_OFFICIAL_EMAIL_SET');
  });

  it("builds its UPDATE from an allowlist, not from arbitrary req.body keys", () => {
    const section = patchMeHandler();
    expect(section).toContain("ALLOWED_FIELDS");
    // The SET clause must iterate the allowlist. Iterating req.body directly would
    // let any column through, which is the defect the 403 above only partially covers.
    expect(section).toMatch(
      /for\s*\(\s*const\s+field\s+of\s+ALLOWED_FIELDS\s*\)/,
    );
    expect(section).not.toMatch(/Object\.keys\(\s*req\.body\s*\)/);
  });

  // ALLOWED_FIELDS is now sourced from fieldOwnership.ts's SELF_EDITABLE_PERSONAL_COLUMNS
  // (see that file — the single source of truth this replaced three disagreeing allowlists
  // with), rather than a literal array in this file, so this asserts against the real,
  // live-imported value instead of regex-slicing a moving target string.
  it("the live field-ownership matrix does not mark official_email as employee-editable", () => {
    expect(SELF_EDITABLE_PERSONAL_COLUMNS).not.toContain("official_email");
  });
});

// ── Task 4: statutory-details must go through approval ───────────────────────
describe('PUT /me/statutory-details — approval gate', () => {
  it('route handler must not directly write to employee_statutory_info', () => {
    const section = routedHandler('put', '/me/statutory-details');
    expect(section).not.toContain('employee_statutory_info');
    expect(section).toContain('submitStatutoryDetailsForApproval');
  });

  it("profile-approval.service must export submitStatutoryDetailsForApproval", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "../profile-approval.service.ts"),
      "utf8",
    );
    expect(src).toContain(
      "export async function submitStatutoryDetailsForApproval(",
    );
    expect(src).toContain("'statutory_details'");
  });
});

// ── Task 5: PUT /me/bank-details must not bypass approval ───────────────────
describe('PUT /me/bank-details — tombstoned', () => {
  it('route handler returns 410 and does not directly write to employee_bank_detail', () => {
    const section = routedHandler('put', '/me/bank-details');
    expect(section).toMatch(/status\(410\)/);
    expect(section).not.toContain('db.execute');
    expect(section).not.toContain('INSERT INTO employee_bank_detail');
    expect(section).not.toContain('UPDATE employee_bank_detail');
  });
});

// ── Task 6: promotion approval must be transactional ────────────────────────
describe("mobility.service — updatePromotion is transactional", () => {
  it("updatePromotion source must use a transaction", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "../../mobility/mobility.service.ts"),
      "utf8",
    );
    const promotionSection = src.slice(src.indexOf("async updatePromotion("));
    expect(promotionSection).toMatch(/beginTransaction|START TRANSACTION/);
    expect(promotionSection).toMatch(/commit|COMMIT/);
    expect(promotionSection).toMatch(/rollback|ROLLBACK/);
  });
});

// ── Task 7: transfer NULL-safe master lookup ────────────────────────────────
/**
 * The employee-row move moved out of applyTransferToEmployee into applyTransferOn(exec, ...)
 * on 2026-08-16, so that approval could run it inside its transaction while the deferred
 * worker keeps running it in autocommit — one implementation, two callers. These two cases
 * previously sliced from `async applyTransferToEmployee(` to end-of-file; the implementation
 * now sits ABOVE that method, so the slice no longer contained it and the assertions passed
 * over an empty region. They are repointed at the real implementation, unchanged in intent:
 * a master lookup that misses must throw, never write NULL into the FK.
 */
describe("mobility.service — the transfer master lookup is NULL-safe", () => {
  const applyImpl = () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "../../mobility/mobility.service.ts"),
      "utf8",
    );
    const start = src.indexOf("async function applyTransferOn(");
    expect(
      start,
      "applyTransferOn not found — has the transfer apply logic moved again?",
    ).toBeGreaterThan(-1);
    return src.slice(start);
  };

  it("must not use inline correlated subquery that could silently null the FK", () => {
    const applyFn = applyImpl();
    expect(applyFn).not.toMatch(
      /branch_id\s*=\s*\(SELECT\s+id\s+FROM\s+branch_master/,
    );
    expect(applyFn).not.toMatch(
      /department_id\s*=\s*\(SELECT\s+id\s+FROM\s+department_master/,
    );
    expect(applyFn).not.toMatch(
      /designation_id\s*=\s*\(SELECT\s+id\s+FROM\s+designation_master/,
    );
    expect(applyFn).not.toMatch(
      /process_id\s*=\s*\(SELECT\s+id\s+FROM\s+process_master/,
    );
  });

  it("must throw when master lookup returns null instead of silently nulling FK", () => {
    // The four messages are now produced by one shared resolver rather than written out
    // four times, so the guarantee is: a miss throws, the message names the master table,
    // and every transfer type still routes through it.
    const applyFn = applyImpl();
    expect(applyFn).toMatch(
      /if \(!masterId\) throw mobilityError\(\d+, `Transfer: \$\{label\} '\$\{to_value\}' not found in \$\{table\}`\)/,
    );
    for (const table of [
      "branch_master",
      "department_master",
      "designation_master",
      "process_master",
    ]) {
      expect(
        applyFn,
        `${table} is no longer resolved before the FK is written`,
      ).toContain(`"${table}"`);
    }
  });

  it("applyTransferToEmployee still delegates to it, so the worker path is covered too", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "../../mobility/mobility.service.ts"),
      "utf8",
    );
    const method = src.slice(src.indexOf("async applyTransferToEmployee("));
    expect(method).toMatch(/await applyTransferOn\(db,/);
  });
});

// ── Task 8: exit propagation completeness ───────────────────────────────────
/**
 * These three read the `exited` branch of exit.service.ts as source text.
 *
 * They used to slice a fixed character count from the anchor, which measures prose as well
 * as code: a later session added an explanatory comment inside the branch and pushed
 * `date_of_exit` from inside the 2,000-char window to 2,444 chars away, so the guard began
 * failing on main while the behaviour it protects was still perfectly correct. A test that
 * breaks when someone writes a comment trains people to ignore it.
 *
 * Comments are now stripped before the window is taken, so the distance measured is code,
 * and the window runs to the end of the file rather than a magic number.
 */
const exitedBranch = (): string => {
  const src = fs.readFileSync(
    path.resolve(__dirname, "../../exit/exit.service.ts"),
    "utf8",
  );
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  const i = code.indexOf('nextStatus === "exited"');
  expect(i, "the exited branch is gone from exit.service.ts").toBeGreaterThan(
    -1,
  );
  return code.slice(i);
};

describe("exit.service — exited status propagation", () => {
  it("exit.service must set date_of_exit on employees on exited", () => {
    // Asserts the actual write, not that the string appears somewhere nearby: the point is
    // that the employees row is stamped, and `date_of_exit` could otherwise be satisfied by
    // a SELECT or an unrelated table.
    expect(exitedBranch()).toMatch(
      /UPDATE\s+employees[\s\S]{0,400}?date_of_exit\s*=/,
    );
  });

  /**
   * These two asserted `leave_requests` and `employee_asset_assignment` appeared near the
   * anchor. Both did — inside a COMMENT, and specifically inside the comment explaining that
   * those very statements had been REMOVED because they named tables that do not exist. So
   * the guards went green off the removal note describing their own deletion. Stripping
   * comments exposed it: neither term occurs in the branch's code at all.
   *
   * They now assert the mechanism that actually replaced those statements —
   * deprovisionEmployeeAccess — so they fail if exit stops revoking access, rather than if
   * someone edits a comment.
   *
   * The behaviour itself was never lost, only moved: the inline statements named
   * `leave_requests` (plural) and `employee_asset_assignment`, neither of which exists, so
   * they had never worked. employeeDeprovisioning.ts does both properly against the real
   * `leave_request` (singular) table, and routes cancellation through the balance-restore
   * path rather than flipping status directly. Asserting the call therefore covers strictly
   * more than the two dead statements did.
   */
  it("exit.service revokes access on exited via deprovisionEmployeeAccess", () => {
    expect(exitedBranch()).toMatch(/await\s+deprovisionEmployeeAccess\s*\(/);
  });

  it("exit.service revokes live sessions on exited", () => {
    expect(exitedBranch()).toMatch(/await\s+revokeSessionsForEmployee\s*\(/);
  });

  it("exit.service must create clearance tasks for all exit paths including exited", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "../../exit/exit.service.ts"),
      "utf8",
    );
    // This used to look for one line gating on ["accepted","notice_serving","exited"]. Since
    // the 2026-09-15 owner ruling tasks are no longer created at accept time: they key off the
    // confirmed Last Working Day (in-request when it is already due, otherwise the daily
    // sweep). What must still hold is the second half of the title — an exit that reaches
    // "exited" always gets its tasks, because the sweep treats "exited" as terminal.
    const gate = src.match(
      /const clearanceDueNow = nextStatus === "exited";\s*if \(\(confirmedLwdInput \|\| clearanceDueNow\) && !isReversalOutcome\) \{([\s\S]*?)\n {4}\}\n/
    );
    expect(gate, 'updateExitStatus no longer creates clearance tasks on "exited"').toBeTruthy();
    // "exited" skips the LWD-due lookup; the LWD path keeps it.
    expect(gate![1]).toMatch(/clearanceDueNow\s*\?\s*\[\[\{ due: 1 \}\]\]/);
    expect(gate![1]).toContain('last_working_day_confirmed <= CURDATE()');
    expect(gate![1]).toMatch(/await createDefaultClearanceTasks\(id, employeeIdForExit\)/);
    // A reversed resignation never gets a clearance chain.
    expect(src).toMatch(
      /const isReversalOutcome = \[\s*"revoked",\s*"rejected",\s*"cancelled",\s*"withdrawn",?\s*\]\.includes\(nextStatus\)/
    );
    // Involuntary exits are created directly at "exited" and get theirs at creation.
    expect(src).toMatch(/if \(isInvoluntary\) \{[\s\S]{0,300}await createDefaultClearanceTasks\(id, input\.employeeId\)/);
  });
});

// ── Task 9: BGV scope — HR without branch_id must not see all ──────────────
describe("canViewEmployeeBgv — HR without branch_id", () => {
  it("HR without branch_id must return false, not true", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "../employee-bgv.service.ts"),
      "utf8",
    );
    expect(src).not.toContain("HR without branch restriction can view all");
    const canViewFn = src.slice(
      src.indexOf("export async function canViewEmployeeBgv("),
    );
    expect(canViewFn).not.toMatch(/return true;\s*\/\/ HR without/);
    expect(canViewFn).toMatch(
      /if\s*\(\s*!actorScope\.branch_id\s*\)\s*return false/,
    );
  });
});

// ── Task 10: createEmployee email duplicate guard ───────────────────────────
describe("employee.service — createEmployee duplicate guards", () => {
  it("createEmployee must check for duplicate email in employees table before INSERT", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "../employee.service.ts"),
      "utf8",
    );
    const createFn = src.slice(src.indexOf("async createEmployee("));
    const insertIdx = createFn.indexOf("INSERT INTO employees");
    const preamble = createFn.slice(0, insertIdx);
    expect(preamble).toMatch(/email.*employees|employees.*email/);
  });
});

// ── Task 11: Absconded/Terminated not settable via updateEmployee ────────────
describe("updateEmployeeSchema — no bypass of exit module", () => {
  it("Absconded and Terminated must not be in employmentStatus enum of updateEmployeeSchema", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "../employee.validation.ts"),
      "utf8",
    );
    const enumLine = src
      .split("\n")
      .find((l) => l.includes("employmentStatus") && l.includes("z.enum"));
    expect(enumLine).toBeDefined();
    expect(enumLine).not.toContain("Absconded");
    expect(enumLine).not.toContain("Terminated");
  });
});
