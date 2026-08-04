/**
 * Name-consistency and the InfinitiAI hand-off must read real columns.
 *
 * Both of these compare or transmit a candidate's identity, and both were built
 * on columns and tables that do not exist — so neither had ever run.
 *
 * name-consistency /recalculate selected `ac.aadhar_name` and `ac.pan_name`.
 * ats_candidate has neither: it stores aadhar_number, pan_number and their
 * verified flags, never a name. The name a document was issued to is what the
 * provider returned, and it lives in candidate_bgv_check.matched_name keyed by
 * check_type — 59 Aadhaar, 8 PAN, 23 bank in production. It also queried
 * candidate_onboarding_education.applicant_name; neither the table nor any
 * person-name column on the real qualification table exists.
 *
 * The InfinitiAI portal hand-off had three faults at once, the first of which
 * meant the query never even parsed.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !l.trim().startsWith("//"))
    .join("\n");
}

const NAME_CONSISTENCY = code(read("src/modules/ats/name-consistency.routes.ts"));
const BGV_ROUTES = code(read("src/modules/ats/bgv-verification.routes.ts"));

describe("name-consistency reads names from where they are recorded", () => {
  it("does not select aadhar_name or pan_name off ats_candidate", () => {
    expect(NAME_CONSISTENCY).not.toMatch(/ac\.aadhar_name/);
    expect(NAME_CONSISTENCY).not.toMatch(/ac\.pan_name/);
  });

  it("takes the verified names from candidate_bgv_check.matched_name", () => {
    expect(NAME_CONSISTENCY).toContain("candidate_bgv_check");
    expect(NAME_CONSISTENCY).toContain("matched_name");
  });

  it("treats aadhaar_offline as the same identity as aadhaar", () => {
    // Befisc's XML route proves the same Aadhaar; its matched_name is the same
    // person. Dropping it would lose 12 of the 71 Aadhaar names.
    expect(NAME_CONSISTENCY).toMatch(/'aadhaar',\s*'aadhaar_offline'/);
  });

  it("no longer queries the education table or column, neither of which exists", () => {
    expect(NAME_CONSISTENCY).not.toMatch(/candidate_onboarding_education/);
    expect(NAME_CONSISTENCY).not.toMatch(/applicant_name/);
  });

  it("does not reference the removed education variable", () => {
    // Leaving `edu` behind would be a reference error at runtime.
    expect(NAME_CONSISTENCY).not.toMatch(/\bedu\?\./);
    expect(NAME_CONSISTENCY).not.toMatch(/const\s+edu\s*=/);
  });
});

describe("the InfinitiAI portal hand-off", () => {
  const query = (() => {
    const at = BGV_ROUTES.indexOf("initiateCandidateBgv");
    expect(at, "the InfinitiAI call has moved").toBeGreaterThan(-1);
    // The candidate query sits above the adapter call.
    const start = BGV_ROUTES.lastIndexOf("SELECT c.id, c.full_name", at);
    expect(start, "the candidate query has moved").toBeGreaterThan(-1);
    return BGV_ROUTES.slice(start, at);
  })();

  it("does not join candidate_onboarding_address, which does not exist", () => {
    expect(query).not.toMatch(/candidate_onboarding_address/);
  });

  it("reads the father's name from the column that holds it", () => {
    // candidate_onboarding_profile has father_husband_name, not father_name.
    expect(query).not.toMatch(/p\.father_name/);
    expect(query).toMatch(/father_husband_name\s+AS\s+father_name/);
  });

  it("puts LIMIT after WHERE, not between the JOIN and the WHERE", () => {
    // The original had `LIMIT 1` immediately after the JOIN's ON clause, which
    // is a parse error — the query failed before any table could be missing.
    const whereAt = query.indexOf("WHERE c.id");
    const limitAt = query.lastIndexOf("LIMIT 1");
    expect(whereAt).toBeGreaterThan(-1);
    expect(limitAt, "LIMIT must follow WHERE").toBeGreaterThan(whereAt);
  });

  it("sends null rather than bare punctuation when no address is recorded", () => {
    // CONCAT_WS with all-empty parts yields "", which would reach the provider
    // as an address. NULLIF makes the absence explicit.
    expect(query).toMatch(/NULLIF\(/);
  });

  it("builds the address from the onboarding profile", () => {
    expect(query).toMatch(/p\.permanent_address/);
  });
});
