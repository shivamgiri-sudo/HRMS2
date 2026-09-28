import { describe, expect, it, vi } from "vitest";

type Handler = (sql: string, params: unknown[]) => Promise<unknown>;
const h = vi.hoisted(() => ({ run: null as unknown as (sql: string, params: unknown[]) => Promise<unknown> }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute: (sql: string, params: unknown[]) => h.run(sql, params) } }));
const setDb = (fn: Handler) => { h.run = fn; };

import { buildIdentityComparison, last4, maskMobile, maskPan } from "../fraud-identity.service.js";

describe("masking", () => {
  it("keeps only the last four of a mobile number", () => {
    expect(maskMobile("99368 75797")).toBe("XXXXXX5797");
    expect(maskMobile("123")).toBeNull();
    expect(maskMobile(null)).toBeNull();
  });
  it("keeps only the last four digits of an Aadhaar", () => {
    expect(last4("626441605556")).toBe("5556");
    expect(last4("XXXX-XXXX-5556")).toBe("5556");
    expect(last4("")).toBeNull();
  });
  it("hides the middle of a PAN and passes an already-masked one through", () => {
    expect(maskPan("abcde1234f")).toBe("ABCXXXX4F");
    expect(maskPan("EWLXXXX2D")).toBe("EWLXXXX2D");
    expect(maskPan("not a pan")).toBeNull();
  });
});

const govtJson = (name: string, dob: string, gender: string, id: string) =>
  JSON.stringify({ data: { documentList: [{ name, dob, gender, id_number: id, document_type: "AADHAAR" }] } });

function answerFor(candidate: Record<string, unknown>, opts: { govt?: string; employee?: Record<string, unknown>; selfie?: string }) {
  return (sql: string) => {
    if (sql.includes("FROM ats_candidate c")) return [[candidate]];
    if (sql.includes("candidate_bgv_check")) return [opts.govt ? [{ rj: opts.govt }] : []];
    if (sql.includes("FROM employees")) return [opts.employee ? [opts.employee] : []];
    if (sql.includes("candidate_onboarding_document")) return [opts.selfie ? [{ id: opts.selfie }] : []];
    return [[]];
  };
}

describe("buildIdentityComparison", () => {
  it("returns masked facts for both sides, the government record, the employee and shared-device evidence", async () => {
    const base = {
      candidate_code: "CND-1", full_name: "Rahul Verma", cand_dob: "2004-02-18", mobile: "9936873126",
      aadhar_number: "626441604821", pan_number: "ABCDE1234F", employee_name: "Rahul Verma", profile_gender: "Male",
      profile_dob: "2004-02-18", father_husband_name: "Suresh Verma", mobile_number: "9936873126",
      aadhaar_number_masked: null, pan_number_masked: null,
    };
    const answers: Record<string, ReturnType<typeof answerFor>> = {
      c1: answerFor(base, {}),
      c2: answerFor(
        { ...base, candidate_code: "CND-2", full_name: "Priya Nair", employee_name: "Priya Nair", profile_gender: "Male" },
        {
          govt: govtJson("Priya Nair", "10-09-2003", "F", "xxxxxxxx6556"),
          employee: { employee_code: "PN-1042", full_name: "Priya Nair", employment_status: "Active", joined_on: "2026-09-11" },
          selfie: "doc-9",
        },
      ),
    };
    setDb(async (sql: string, params: unknown[]) => {
      if (sql.includes("candidate_onboarding_submission_log")) {
        return [[
          { candidate_id: "c1", ip_address: "10.0.0.2", ua: "Chrome/151" },
          { candidate_id: "c2", ip_address: "10.0.0.2", ua: "Chrome/151" },
        ]];
      }
      return answers[String(params[0])](sql);
    });

    const cmp = await buildIdentityComparison("c1", "c2");
    expect(cmp).not.toBeNull();
    expect(cmp!.subject.mobileMasked).toBe("XXXXXX3126");
    expect(cmp!.subject.aadhaarLast4).toBe("4821");
    expect(cmp!.subject.panMasked).toBe("ABCXXXX4F");
    expect(cmp!.subject.govt).toBeNull();
    expect(cmp!.other!.govt).toEqual({ name: "Priya Nair", dob: "2003-09-10", gender: "Female", aadhaarLast4: "6556" });
    expect(cmp!.other!.employee).toEqual({ code: "PN-1042", name: "Priya Nair", status: "Active", joinedOn: "2026-09-11" });
    expect(cmp!.other!.selfieDocId).toBe("doc-9");
    expect(cmp!.sharedMobile).toBe(true);
    expect(cmp!.sharedDevice).toBe(true);
    // Full numbers never leave the server.
    expect(JSON.stringify(cmp)).not.toContain("626441604821");
    expect(JSON.stringify(cmp)).not.toContain("ABCDE1234F");
    expect(JSON.stringify(cmp)).not.toContain("9936873126");
  });

  it("returns null for an unknown candidate and no 'other' when nothing matched", async () => {
    setDb(async () => [[]]);
    expect(await buildIdentityComparison("missing", null)).toBeNull();

    setDb(async (sql: string) =>
      sql.includes("FROM ats_candidate c")
        ? [[{ candidate_code: "CND-1", full_name: "A B", mobile: "9999999999" }]]
        : [[]],
    );
    const solo = await buildIdentityComparison("c1", null);
    expect(solo!.other).toBeNull();
    expect(solo!.sharedDevice).toBeNull();
  });

  it("reports no shared device when there is no session data to compare", async () => {
    setDb(async (sql: string) =>
      sql.includes("FROM ats_candidate c")
        ? [[{ candidate_code: "CND-1", full_name: "A B", mobile: "9999999999" }]]
        : [[]],
    );
    const cmp = await buildIdentityComparison("c1", "c2");
    expect(cmp!.sharedDevice).toBeNull();
  });
});
