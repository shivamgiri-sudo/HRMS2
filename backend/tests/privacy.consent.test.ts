/**
 * Guards DPDP consent recording.
 *
 * Two independent bugs meant no walk-in candidate's consent was ever
 * recorded, despite the registration form blocking submission on a consent
 * checkbox:
 *
 *   1. recordConsent() selected a column, version_tag, that does not exist on
 *      consent_text_version (the real column is version_code). Every call
 *      threw "Unknown column 'version_tag'" — for any purpose, any principal,
 *      including authenticated employees.
 *   2. Even with that fixed, there was no active consent_text_version row for
 *      purpose_code = 'recruitment' at all (only 'employment' had one), so the
 *      call would still fail with 422 CONSENT_VERSION_UNAVAILABLE.
 *
 * These tests pin the query shape directly, since a unit test cannot see a
 * live "Unknown column" error — the bug was in a string, not a type.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";

describe("privacy.service recordConsent — column name regression", () => {
  const source = readFileSync(
    new URL("../src/modules/privacy/privacy.service.ts", import.meta.url),
    "utf8",
  );

  it("TC-CONSENT-01: selects version_code, not the nonexistent version_tag", () => {
    const recordConsentBody = source.slice(
      source.indexOf("async recordConsent("),
      source.indexOf("async ", source.indexOf("async recordConsent(") + 10),
    );
    // The explanatory comment inside the function legitimately mentions the
    // old (wrong) name for context — strip comments before asserting it is
    // gone from the actual SQL and property access.
    const codeOnly = recordConsentBody.replace(/\/\/.*$/gm, "");
    expect(codeOnly, "reintroduces the column that does not exist")
      .not.toMatch(/\bversion_tag\b/);
    expect(codeOnly).toMatch(/SELECT id AS version_id, version_code, consent_text/);
    expect(codeOnly).toMatch(/version\.version_code/);
  });
});

describe("public consent-capture endpoint — scoped, not open", () => {
  const source = readFileSync(
    new URL("../src/modules/ats/registration.enhanced.routes.ts", import.meta.url),
    "utf8",
  );
  const routeBody = source.slice(
    source.indexOf("registrationEnhancedRouter.post('/:candidateId/consent'"),
  );

  it("TC-CONSENT-02: purpose_code is hardcoded, never taken from the request body", () => {
    expect(routeBody).toMatch(/purposeCode:\s*'recruitment'/);
    expect(routeBody, "purpose_code should not be read from req.body")
      .not.toMatch(/req\.body\.\s*purpose/);
  });

  it("TC-CONSENT-03: principalType is hardcoded to 'candidate', not client-supplied", () => {
    expect(routeBody).toMatch(/principalType:\s*'candidate'/);
  });

  it("TC-CONSENT-04: refuses when the candidate id doesn't resolve inside the eligibility window", () => {
    expect(routeBody).toMatch(/DATE_SUB\(NOW\(\),\s*INTERVAL\s*\?\s*MINUTE\)/);
    expect(routeBody).toMatch(/status\(404\)/);
  });
});
