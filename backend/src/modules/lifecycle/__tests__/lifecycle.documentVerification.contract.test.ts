import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// GET /employees/:id/documents used to log access under the literal string
// "list:<employeeId>", while GET /documents/:id/access-log looks up by a real
// document id — the two id formats could never match, so the Access Log tab
// always returned zero rows regardless of how many times a document was
// actually viewed. Fixed by logging one real row per document returned.
//
// The three read-only document-verification routes (/documents/expiring,
// /documents/unverified, /documents/:id/access-log) were also admin,hr-only
// while the page-code gate they sit behind (EMPLOYEE_MANAGEMENT) grants view
// access to more roles live (branch_hr, it_head, branch_head, super_admin) —
// those users got 403s on every tab despite the page letting them in. Widened
// to match; the write action (/documents/:id/verify) intentionally stays
// admin,hr-only.
const routes = readFileSync(resolve(process.cwd(), "src/modules/lifecycle/lifecycle.routes.ts"), "utf8");

describe("Document verification — access log id consistency", () => {
  it("no longer logs a synthetic non-lookupable list: access id", () => {
    expect(routes).not.toContain('logDocumentAccess(`list:${req.params.id}`');
  });

  it("logs one real document id per document returned", () => {
    const listDocsRoute = routes.slice(routes.indexOf('router.get("/employees/:id/documents"'));
    expect(listDocsRoute).toContain("docs.map((d)");
    expect(listDocsRoute).toContain("logDocumentAccess(String(d.id)");
  });
});

describe("Document verification — read-route role gate matches live page grant", () => {
  it("widens /documents/expiring, /documents/unverified, /documents/:id/access-log beyond admin,hr", () => {
    expect(routes).toContain("DOC_VERIFICATION_READ_ROLES");
    expect(routes).toContain('"branch_hr"');
    expect(routes).toContain('"it_head"');
    expect(routes).toContain('"branch_head"');
  });

  it("keeps the write action /documents/:id/verify restricted to admin,hr", () => {
    const verifyRoute = routes.slice(
      routes.indexOf('router.post("/documents/:id/verify"'),
      routes.indexOf('router.get("/documents/expiring"')
    );
    expect(verifyRoute).toContain('requireRole("admin", "hr")');
  });
});
