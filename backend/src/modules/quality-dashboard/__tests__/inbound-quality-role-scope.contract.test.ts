import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Section M RBAC audit, 2026-08-18 (user decision after verifying live data): inbound-quality
 * dashboard endpoints had NO per-caller client/process scoping — clientId was an optional
 * filter, and omitting it meant "all clients." process_manager and manager are role-titled as
 * scoped to one process/client, but this router silently gave them the same org-wide
 * visibility (call transcripts, KPI scores, VOC quotes, fraud/scam signals) as super_admin.
 *
 * The correct fix is real per-caller client scoping (mirroring client-drill.routes.ts). It
 * cannot be built yet: verified live 2026-08-18, both candidate mapping sources are completely
 * unpopulated in production (user_assignment_scope.client_id: 0 rows; process_master.client_id:
 * 0 of 131 processes), and process<->client is not a clean 1:1 even once populated.
 *
 * So this fails closed instead: process_manager and manager lose access to this router
 * entirely until real mapping data exists to scope them by. Every other role that had access
 * keeps it unchanged.
 */
const SRC = readFileSync(resolve(process.cwd(), "src/modules/quality-dashboard/inbound-quality.routes.ts"), "utf8");

describe("inbound-quality router role gate", () => {
  it("no longer grants process_manager or manager access", () => {
    const useBlock = SRC.slice(SRC.indexOf("router.use("), SRC.indexOf("router.use(") + 400);
    expect(useBlock).not.toMatch(/"process_manager"/);
    expect(useBlock).not.toMatch(/"manager"/);
  });

  it("still grants every genuinely org-wide role, unchanged", () => {
    const useBlock = SRC.slice(SRC.indexOf("router.use("), SRC.indexOf("router.use(") + 400);
    for (const role of ["super_admin", "admin", "ceo", "operations_manager", "qa", "quality_analyst"]) {
      expect(useBlock, `${role} must still have access`).toMatch(new RegExp(`"${role}"`));
    }
  });

  it("requires auth before the role check", () => {
    const useBlock = SRC.slice(SRC.indexOf("router.use("), SRC.indexOf("router.use(") + 400);
    expect(useBlock).toMatch(/requireAuth/);
  });
});
