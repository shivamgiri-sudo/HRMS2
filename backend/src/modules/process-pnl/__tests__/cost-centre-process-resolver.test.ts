import { describe, expect, it } from "vitest";
import {
  EXCLUDED_BRANCH_IDS,
  matchClientToProcess,
  type ProcessCandidate,
} from "../cost-centre-process-resolver.service.js";

function candidate(id: string, process_name: string): ProcessCandidate {
  return {
    id,
    process_name,
    tokens: process_name
      .toUpperCase()
      .replace(/[^A-Z0-9 ]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 3 && !["LTD", "LIMITED", "PVT", "PRIVATE", "INDIA"].includes(w)),
  };
}

describe("cost-centre-process-resolver: matchClientToProcess", () => {
  const processes: ProcessCandidate[] = [
    candidate("p1", "Godfrey Philips India Ltd"),
    candidate("p2", "Adani Wilmar Limited"),
    candidate("p3", "Finnable"),
    candidate("p4", "DIALDESK"),
    candidate("p5", "Reliance Back Office"),
    candidate("p6", "IT/System"),
  ];

  it("matches an exact client name (case/whitespace normalised)", () => {
    const m = matchClientToProcess("Adani Wilmar Ltd", processes);
    expect(m?.id).toBe("p2");
  });

  it("tolerates a one-character spelling slip on a long brand token (Phillips vs Philips)", () => {
    const m = matchClientToProcess("Godfrey Phillips India Ltd", processes);
    expect(m?.id).toBe("p1");
  });

  it("matches a client name that is a superset of a short single-word process name (Finnable)", () => {
    const m = matchClientToProcess("FINNABLE TECHNOLOGIES PRIVATE LIMITED", processes);
    expect(m?.id).toBe("p3");
  });

  it("refuses a match when no process name is contained in the client name", () => {
    const m = matchClientToProcess("ASPEYA INDIA PRIVATE LIMITED", processes);
    expect(m).toBeNull();
  });

  it("refuses a match for a bare null/empty client name", () => {
    expect(matchClientToProcess(null, processes)).toBeNull();
    expect(matchClientToProcess("", processes)).toBeNull();
  });

  it("refuses a match on 'System' alone — a generic word, not a client identifier", () => {
    // Regression case found live 2026-09-11: this used to match p6 ("IT/System") purely on the
    // shared word "System", attributing an unrelated client's revenue to an internal IT bucket.
    // GENERIC_WORDS now strips "System" from both sides before the containment check runs.
    const m = matchClientToProcess("Spheros Motherson Thermal System Limited", processes);
    expect(m).toBeNull();
  });
});

describe("cost-centre-process-resolver: DialDesk / Ispark exclusion", () => {
  it("carries the confirmed NOIDA-DIALDESK and both Ispark branch ids", () => {
    expect(EXCLUDED_BRANCH_IDS.has("febeee54-6583-11f1-adb1-00155d0ab410")).toBe(true); // NOIDA-DIALDESK
    expect(EXCLUDED_BRANCH_IDS.has("febb909f-6583-11f1-adb1-00155d0ab410")).toBe(true); // NOIDA ISPARK-2
    expect(EXCLUDED_BRANCH_IDS.has("fec0d5da-6583-11f1-adb1-00155d0ab410")).toBe(true); // NOIDA-ISPARK
  });

  it("refuses a match onto the DIALDESK process by name, independent of branch", () => {
    const processes = [candidate("dd", "DIALDESK"), candidate("gp", "Godfrey Philips India Ltd")];
    // Regression case found live 2026-09-11: client_name literally "DIALDESK" in an ordinary
    // NOIDA cost centre (branch NOT in EXCLUDED_BRANCH_IDS) must still never resolve.
    expect(matchClientToProcess("Dialdesk Outsource Noida", processes)).toBeNull();
    expect(matchClientToProcess("DIALDESK", processes)).toBeNull();
  });
});

describe("cost-centre-process-resolver: generic business-word false positives (2026-09-11 review)", () => {
  const processes = [
    candidate("hrcorp", "HR-CORPORATE"),
    candidate("wealth", "Appriciate Wealth"),
    candidate("itsys", "IT/System"),
    candidate("acq", "CUSTOMER ACQUISITION"),
    candidate("others", "OTHERS"),
    candidate("dudigital", "DU Digital"),
    candidate("mnprej", "MNP REJECTION"),
    candidate("inboundcs", "INBOUND CUSTOMER SERVICES"),
    candidate("exicom", "Exicom"),
  ];

  it("refuses a match built only on a shared generic function word", () => {
    expect(matchClientToProcess("Knowy Corprate", processes)).toBeNull(); // -> HR-CORPORATE
    expect(matchClientToProcess("Be wealthy", processes)).toBeNull(); // -> Appriciate Wealth
    expect(matchClientToProcess("Spheros Motherson Thermal System Limited", processes)).toBeNull(); // -> IT/System
    expect(matchClientToProcess("Acquisition", processes)).toBeNull(); // -> CUSTOMER ACQUISITION
    expect(matchClientToProcess("Bajaj Digital Collection", processes)).toBeNull(); // -> DU Digital
    expect(matchClientToProcess("RHD/MNP Rejection", processes)).toBeNull(); // -> MNP REJECTION
    expect(matchClientToProcess("Cloud walker Inbound Process", processes)).toBeNull(); // -> INBOUND CUSTOMER SERVICES
  });

  it("makes a process whose name is entirely generic permanently unmatchable", () => {
    expect(matchClientToProcess("Idea MNP Postpaid & Others", processes)).toBeNull(); // -> OTHERS
  });

  it("still matches a real distinctive brand alongside generic-named processes in the pool", () => {
    const m = matchClientToProcess("EXICOM ENERGY SYSTEMS PVT. LTD", processes);
    expect(m?.id).toBe("exicom");
  });
});
