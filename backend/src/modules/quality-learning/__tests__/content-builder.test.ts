/**
 * MCN Content Builder (OpenMAIC tooling-link worklist) — content-builder.service.ts,
 * quality-learning.routes.ts, migration 1825.
 *
 * The properties this file protects:
 *   1. This module NEVER calls out to an external host (OpenMAIC) or to mcn_lms — it is a
 *      pure worklist against mas_hrms's own mcn_content_builder_request table.
 *   2. builder_url is genuinely just stored text — never fetched, parsed as a URL object,
 *      or validated against an allowlist server-side (that would imply an outbound call).
 *   3. Terminal states (mapped/cancelled) cannot be silently reopened by another action.
 *   4. Linking a mapping (markContentBuilderMapped) verifies the mapping belongs to the
 *      SAME skill category as the request, rather than trusting the client blindly.
 *
 * Source-level assertions, matching this repo's convention for modules with heavy pool
 * dependencies (see dialer-hold.test.ts, lms-provisioning.test.ts).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SERVICE = readFileSync(
  resolve(process.cwd(), "src/modules/quality-learning/content-builder.service.ts"),
  "utf8",
);
const ROUTES = readFileSync(
  resolve(process.cwd(), "src/modules/quality-learning/quality-learning.routes.ts"),
  "utf8",
);
const MIGRATION = readFileSync(
  resolve(process.cwd(), "sql/1825_mcn_content_builder_request.sql"),
  "utf8",
);

describe("content-builder.service never calls out to an external host", () => {
  it("does not import fetch, axios, http, or any outbound HTTP client", () => {
    expect(SERVICE).not.toMatch(/\bfetch\s*\(/);
    expect(SERVICE).not.toMatch(/from ["']axios["']/);
    expect(SERVICE).not.toMatch(/from ["']node:https?["']/);
    expect(SERVICE).not.toMatch(/from ["']https?["']/);
  });

  it("only imports the standard mas_hrms pool, no cross-DB or dialer helper", () => {
    expect(SERVICE).toMatch(/import \{ db \} from "\.\.\/\.\.\/db\/mysql\.js";/);
    const dbImports = [...SERVICE.matchAll(/from ["'][^"']*\/db\/[^"']+["']/g)].map((m) => m[0]);
    expect(dbImports).toEqual(['from "../../db/mysql.js"']);
  });

  it("builder_url is only ever bound as a plain SQL parameter, never parsed as a URL or fetched", () => {
    expect(SERVICE).not.toMatch(/new URL\(/);
    expect(SERVICE).not.toMatch(/\bfetch\(.*builderUrl/);
  });

  it("documents the no-write-to-LMS, no-call-OpenMAIC boundary explicitly", () => {
    expect(SERVICE).toMatch(/NEVER calls out to OpenMAIC/);
    expect(SERVICE).toMatch(/NEVER writes to mcn_lms/);
  });
});

describe("markContentBuilderMapped verifies the mapping's skill category before linking", () => {
  const fn = SERVICE.slice(
    SERVICE.indexOf("export async function markContentBuilderMapped"),
    SERVICE.indexOf("/** Abandoning a request"),
  );

  it("looks up the real skill_content_mapping row rather than trusting the client id blindly", () => {
    expect(fn).toMatch(/SELECT id, skill_category_id FROM skill_content_mapping WHERE id = \?/);
  });

  it("404s when the mapping does not exist", () => {
    expect(fn).toMatch(/Content mapping not found/);
    expect(fn).toMatch(/statusCode: 404/);
  });

  it("400s when the mapping belongs to a different skill category than the request", () => {
    expect(fn).toMatch(/mapping\.skill_category_id !== request\.skill_category_id/);
    expect(fn).toMatch(/belongs to a different skill category/);
    expect(fn).toMatch(/statusCode: 400/);
  });

  it("never creates a skill_content_mapping row itself — only links to an existing one", () => {
    expect(fn).not.toMatch(/INSERT INTO skill_content_mapping/);
  });
});

describe("terminal states cannot be silently reopened", () => {
  it("assertOpen refuses to modify a request already mapped or cancelled", () => {
    const fn = SERVICE.slice(
      SERVICE.indexOf("async function assertOpen"),
      SERVICE.indexOf("/** Coordinator marking"),
    );
    expect(fn).toMatch(/row\.status === "mapped" \|\| row\.status === "cancelled"/);
    expect(fn).toMatch(/statusCode: 409/);
  });

  it("every state-changing export (markContentBuilderInProgress/Built/Mapped) calls assertOpen first", () => {
    for (const name of ["markContentBuilderInProgress", "markContentBuilderBuilt", "cancelContentBuilderRequest"]) {
      const start = SERVICE.indexOf(`export async function ${name}`);
      expect(start).toBeGreaterThan(-1);
      const fn = SERVICE.slice(start, SERVICE.indexOf("\n}\n", start) + 3);
      expect(fn).toMatch(/assertOpen\(/);
    }
    // markContentBuilderMapped calls assertOpen too, but its slice above already confirmed the shape.
    const mappedFn = SERVICE.slice(
      SERVICE.indexOf("export async function markContentBuilderMapped"),
      SERVICE.indexOf("/** Abandoning a request"),
    );
    expect(mappedFn).toMatch(/await assertOpen\(/);
  });
});

describe("quality-learning.routes.ts — content-builder-requests routes", () => {
  const section = ROUTES.slice(ROUTES.indexOf("// ── MCN Content Builder"), ROUTES.indexOf("// ── Training Assignments"));

  it("registers create/list/start/built/mapped/cancel routes", () => {
    expect(section).toMatch(/router\.get\(\s*\n?\s*"\/content-builder-requests"/);
    expect(section).toMatch(/router\.post\(\s*\n?\s*"\/content-builder-requests"/);
    expect(section).toMatch(/"\/content-builder-requests\/:id\/start"/);
    expect(section).toMatch(/"\/content-builder-requests\/:id\/built"/);
    expect(section).toMatch(/"\/content-builder-requests\/:id\/mapped"/);
    expect(section).toMatch(/"\/content-builder-requests\/:id\/cancel"/);
  });

  it("every route is gated by requireRole or allowRolesOrManagers, none is open to any authenticated user", () => {
    // GET/POST list+create use allowRolesOrManagers (same shape as manager-dashboard, so a
    // manager who sees a content-missing gap on their own team can flag it); the rest use
    // requireRole directly.
    const declarations = [
      ...section.matchAll(/router\.(get|post)\(\s*\n?\s*"[^"]+",\s*\n?\s*(requireRole|allowRolesOrManagers)\(/g),
    ];
    expect(declarations.length).toBeGreaterThanOrEqual(6);
  });

  it("list+create (GET/POST content-builder-requests) use allowRolesOrManagers, matching manager-dashboard's own access shape", () => {
    const createStart = section.indexOf('"/content-builder-requests"');
    const createBlock = section.slice(createStart, createStart + 400);
    expect(createBlock).toMatch(/allowRolesOrManagers\(/);
  });

  it("the /mapped route is restricted to admin/hr — creating the LMS-side link is a stricter action than requesting/building", () => {
    const mappedStart = section.indexOf('"/content-builder-requests/:id/mapped"');
    const mappedBlock = section.slice(mappedStart, mappedStart + 200);
    expect(mappedBlock).toMatch(/requireRole\("admin", "hr"\)/);
  });

  it("does not import or reference dialerDb/dialerQuery in this section", () => {
    expect(section).not.toMatch(/dialerDb|dialerQuery|getDialerPool/);
  });
});

describe("migration 1825 — additive, no LMS write path", () => {
  it("creates the table as CREATE TABLE IF NOT EXISTS (idempotent, additive)", () => {
    expect(MIGRATION).toMatch(/CREATE TABLE IF NOT EXISTS mcn_content_builder_request/);
  });

  it("has no foreign key or reference to mcn_lms tables (trainee_master/content_master/module_master)", () => {
    expect(MIGRATION).not.toMatch(/trainee_master|content_master|module_master|batch_master/);
  });

  it("documents builder_url as informational-only, never fetched server-side", () => {
    expect(MIGRATION).toMatch(/[Nn]ever fetched.*server-side|never fetched or validated/s);
  });

  it("references the CS-04 governance boundary already established for this module", () => {
    expect(MIGRATION).toMatch(/CS-04/);
  });
});
