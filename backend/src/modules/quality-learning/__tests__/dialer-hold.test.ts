/**
 * Dialer-hold enforcement boundary (FR5 / US3.3) — quality-learning.routes.ts,
 * dialer-hold.service.ts, quality-gap-detector.worker.ts.
 *
 * The single property every test in this file protects: THIS FEATURE NEVER WRITES TO
 * VICIDIAL. backend/src/db/dialerDb.ts enforces that connection read-only at three layers
 * deliberately, and it would be very easy for a future edit to "helpfully" add a write call
 * against dialerDb/dialerQuery to actually pause the agent. These tests fail loudly if that
 * ever happens.
 *
 * Source-level assertions, matching this repo's convention for modules with heavy pool
 * dependencies (see lms-identity-no-fallback.test.ts, quality-gap-detection.test.ts).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SERVICE = readFileSync(
  resolve(process.cwd(), "src/modules/quality-learning/dialer-hold.service.ts"),
  "utf8",
);
const WORKER = readFileSync(
  resolve(process.cwd(), "src/workers/quality-gap-detector.worker.ts"),
  "utf8",
);
const ROUTES = readFileSync(
  resolve(process.cwd(), "src/modules/quality-learning/quality-learning.routes.ts"),
  "utf8",
);
const REGISTRY = readFileSync(
  resolve(process.cwd(), "src/modules/work-inbox/action-item-registry.ts"),
  "utf8",
);

describe("dialer-hold never writes to Vicidial/the dialer", () => {
  it("does not import dialerDb.js or call dialerQuery/getDialerPool anywhere in the service", () => {
    expect(SERVICE).not.toMatch(/from ["'][^"']*dialerDb[^"']*["']/);
    expect(SERVICE).not.toMatch(/\bdialerQuery\s*\(|\bgetDialerPool\s*\(/);
  });

  it("does not import dialerDb.js or call dialerQuery/getDialerPool in the worker that produces holds", () => {
    expect(WORKER).not.toMatch(/from ["'][^"']*dialerDb[^"']*["']/);
    expect(WORKER).not.toMatch(/\bdialerQuery\s*\(|\bgetDialerPool\s*\(/);
  });

  it("does not import dialerDb.js or call dialerQuery/getDialerPool in the routes that expose holds", () => {
    expect(ROUTES).not.toMatch(/from ["'][^"']*dialerDb[^"']*["']/);
    expect(ROUTES).not.toMatch(/\bdialerQuery\s*\(|\bgetDialerPool\s*\(/);
  });

  it("uses only the standard mas_hrms pool (db.execute), never a cross-DB write helper, in the service", () => {
    expect(SERVICE).toMatch(/import \{ db \} from "\.\.\/\.\.\/db\/mysql\.js";/);
    // No other db import at all — this module talks to exactly one connection.
    const dbImports = [...SERVICE.matchAll(/from ["'][^"']*\/db\/[^"']+["']/g)].map((m) => m[0]);
    expect(dbImports).toEqual(['from "../../db/mysql.js"']);
  });

  it("documents the read-only boundary explicitly, so the reason survives a future edit", () => {
    expect(SERVICE).toMatch(/never writes to Vicidial/);
    expect(SERVICE).toMatch(/READ ONLY/);
  });
});

describe("requestDialerHold — idempotent per assignment", () => {
  it("relies on a duplicate-key catch rather than a SELECT-then-INSERT race", () => {
    const fn = SERVICE.slice(
      SERVICE.indexOf("export async function requestDialerHold"),
      SERVICE.indexOf("/** WFM/Ops confirming"),
    );
    expect(fn).toMatch(/ER_DUP_ENTRY/);
    expect(fn).toMatch(/return null;/);
  });

  it("raises exactly one Work Inbox item type, TRAINING_DIALER_HOLD", () => {
    const fn = SERVICE.slice(
      SERVICE.indexOf("export async function requestDialerHold"),
      SERVICE.indexOf("/** WFM/Ops confirming"),
    );
    expect(fn).toMatch(/itemType: "TRAINING_DIALER_HOLD"/);
    expect(fn).toMatch(/createWorkItemIfNotExists/);
  });

  it("routes the item to wfm by role, not to a specific user — WFM decides who acts", () => {
    const fn = SERVICE.slice(
      SERVICE.indexOf("export async function requestDialerHold"),
      SERVICE.indexOf("/** WFM/Ops confirming"),
    );
    expect(fn).toMatch(/assignedToRole: "wfm"/);
  });
});

describe("action item registry — TRAINING_DIALER_HOLD is registered correctly", () => {
  const start = REGISTRY.indexOf('itemType:          "TRAINING_DIALER_HOLD"');
  const entry = REGISTRY.slice(start, start + 600);

  it("exists in the registry", () => {
    expect(REGISTRY).toMatch(/itemType:\s+"TRAINING_DIALER_HOLD"/);
  });

  it("is CRITICAL priority, matching a live compliance breach", () => {
    expect(entry).toMatch(/defaultPriority:\s+ACTION_PRIORITY\.CRITICAL/);
  });

  it("is assigned to roles that actually hold Vicidial admin access (wfm/ops), not admin/hr", () => {
    expect(entry).toMatch(/defaultAssigneeRoles:\s*\["wfm", "operations_head", "branch_head"\]/);
  });

  it("has a short TTL appropriate to a critical hold, not a multi-day one", () => {
    expect(entry).toMatch(/defaultTtlHours:\s+4/);
  });
});

describe("dialer-hold routes require a governance-shaped role", () => {
  it("every dialer-holds route is gated by requireRole, not open to any authenticated user", () => {
    const section = ROUTES.slice(ROUTES.indexOf("// ── Dialer Holds"));
    const routeDeclarations = [...section.matchAll(/router\.(get|post)\(\s*"\/dialer-holds[^,]*",\s*\n?\s*requireRole\(/g)];
    expect(routeDeclarations.length).toBeGreaterThanOrEqual(3);
  });

  it("includes wfm in the allowed roles for every dialer-holds route, since they are who actually acts", () => {
    const section = ROUTES.slice(ROUTES.indexOf("// ── Dialer Holds"));
    const requireRoleCalls = [...section.matchAll(/requireRole\(([^)]*)\)/g)].map((m) => m[1]);
    expect(requireRoleCalls.length).toBeGreaterThan(0);
    for (const call of requireRoleCalls) {
      expect(call).toMatch(/"wfm"/);
    }
  });
});

describe("quality-gap-detector worker's dialer-hold sweep only acts on real TAT breaches", () => {
  it("filters on task_tat_instance.due_at < NOW() and an open/breached status, not on assignment creation", () => {
    const fn = WORKER.slice(
      WORKER.indexOf("async function sweepDialerHoldCandidates"),
      WORKER.indexOf("async function tick"),
    );
    expect(fn).toMatch(/t\.due_at < NOW\(\)/);
    expect(fn).toMatch(/t\.status IN \('open', 'in_progress', 'sla_breached'\)/);
  });

  it("only considers assignments whose trigger rule opted into block_dialer", () => {
    const fn = WORKER.slice(
      WORKER.indexOf("async function sweepDialerHoldCandidates"),
      WORKER.indexOf("async function tick"),
    );
    expect(fn).toMatch(/qtr\.block_dialer = 1/);
  });

  it("skips assignments that already have a hold row, so re-polling cannot duplicate requests", () => {
    const fn = WORKER.slice(
      WORKER.indexOf("async function sweepDialerHoldCandidates"),
      WORKER.indexOf("async function tick"),
    );
    expect(fn).toMatch(/NOT EXISTS[\s\S]*?FROM training_dialer_hold h WHERE h\.training_assignment_id = ta\.id/);
  });

  it("one bad candidate does not abort the sweep", () => {
    const fn = WORKER.slice(
      WORKER.indexOf("async function sweepDialerHoldCandidates"),
      WORKER.indexOf("async function tick"),
    );
    expect(fn).toMatch(/try \{[\s\S]*?requestDialerHold[\s\S]*?\} catch \(err\) \{/);
  });
});
