import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

/**
 * The API tells operators "Luckpay eSign is unavailable. Use the wet-sign fallback
 * workflow." That workflow did not exist: `wet_signed_uploaded` was READ in five
 * places — the allowed-status set, progress counting, the terminal-status set, the
 * awaiting count, and the payroll-governance joining-document gate — and WRITTEN
 * nowhere. Nothing in the codebase could put a checklist item into it.
 *
 * It was also missing from HR_ONLY_CHECKLIST_STATUSES while employees hold isSelf
 * access, so had anything been able to set it, a joiner could have marked their own
 * paperwork complete and cleared the payroll gate — the same self-approval hole
 * already closed for 'verified'.
 */

const SERVICE = path.resolve(__dirname, "..", "employeeJoiningDocuments.service.ts");
const ROUTES = path.resolve(__dirname, "..", "employee.compliance.routes.ts");

const service = () => fs.readFileSync(SERVICE, "utf8");
const routes = () => fs.readFileSync(ROUTES, "utf8");

describe("wet-sign fallback workflow", () => {
  it("wet_signed_uploaded is reachable — something writes it", () => {
    const src = service();
    const writes = src.match(/nextStatus\s*=\s*"wet_signed_uploaded"/g) ?? [];
    expect(writes.length, "no code path sets wet_signed_uploaded, so the advertised fallback cannot be used").toBeGreaterThan(0);
  });

  it("only HR may assert a wet-signed copy", () => {
    const src = service();
    const hrOnly = src.slice(
      src.indexOf("const HR_ONLY_CHECKLIST_STATUSES"),
      src.indexOf("]);", src.indexOf("const HR_ONLY_CHECKLIST_STATUSES")),
    );
    expect(hrOnly, "wet_signed_uploaded counts as complete and clears the payroll gate — it cannot be self-settable")
      .toContain("wet_signed_uploaded");
  });

  it("the upload path guards the wet-signed flag with the HR check", () => {
    const src = service();
    const fn = src.slice(src.indexOf("export async function uploadJoiningDocument"));
    const body = fn.slice(0, fn.indexOf("\nexport async function"));
    expect(body).toMatch(/params\.wetSigned/);
    expect(body, "the flag must be gated, not merely accepted").toMatch(/isHrReviewer/);
  });

  it("both upload routes forward the flag", () => {
    const src = routes();
    const calls = src.match(/uploadJoiningDocument\(\{/g) ?? [];
    const forwarded = src.match(/wetSigned:/g) ?? [];
    expect(calls.length).toBeGreaterThan(0);
    expect(forwarded.length, "every upload route must forward wetSigned or the flag is unreachable")
      .toBeGreaterThanOrEqual(calls.length);
  });

  it("wet_signed_uploaded remains an accepted status", () => {
    expect(service()).toMatch(/"wet_signed_uploaded"/);
  });
});
