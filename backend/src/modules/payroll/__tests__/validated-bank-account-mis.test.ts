/**
 * Validated Bank Account MIS — bucket classification and summary arithmetic.
 *
 * Two things have to hold or the screen misleads:
 *
 *   1. Every employee lands in exactly ONE exclusive bucket, and faults outrank the verified flag.
 *      An account marked verified whose IFSC cannot be sent to a bank is not payable, and showing
 *      it green hides the only thing anyone has to fix.
 *
 *   2. The summary row cross-foots the way the legacy screen does:
 *        Total    = Uploaded + Not Uploaded
 *        Uploaded = Verified + Pending + Rejected
 *      If either identity breaks, a payroll user reconciling against the old screen sees a row
 *      that does not add up and no way to tell which number to trust.
 *
 * These are pure-function tests — classifyMisBucket does no I/O, so the precedence is pinned
 * without a database.
 */
import { describe, expect, it } from "vitest";
import {
  classifyMisBucket,
  classMatchesBucket,
  MIS_BUCKETS,
  MIS_BUCKET_LABELS,
  MIS_DETAIL_COLUMNS,
  PAYMENT_MODE,
  type ExclusiveBucket,
  type MisBucket,
  type MisClassifyInput,
} from "../validated-bank-account-mis.service.js";

/** A clean, payable, verified record. Each test overrides only what it is about. */
const CLEAN: MisClassifyInput = {
  active_primary_count: 1,
  account_number: "50100234567890",
  account_sources_conflict: false,
  ifsc_code: "HDFC0001234",
  verified: true,
  duplicate_of_employee_code: null,
  change_request_status: null,
};

const classify = (over: Partial<MisClassifyInput> = {}) => classifyMisBucket({ ...CLEAN, ...over });

describe("not uploaded", () => {
  it("reports an employee with no bank record", () => {
    const r = classify({ active_primary_count: 0, account_number: null, verified: false });
    expect(r.bucket).toBe("not_uploaded");
    expect(r.reasons).toContain("no_primary_bank_record");
  });

  it("distinguishes a record that exists but carries no account number", () => {
    // Different remediation: the row is there, someone just never filled the number in.
    const r = classify({ active_primary_count: 1, account_number: null });
    expect(r.bucket).toBe("not_uploaded");
    expect(r.reasons).toContain("account_number_empty");
  });

  it("treats a blank/whitespace account number as absent", () => {
    expect(classify({ account_number: "   " }).bucket).toBe("not_uploaded");
  });

  it("outranks everything — even a rejected request cannot move it", () => {
    // There is nothing to reject if there is nothing on file.
    const r = classify({
      active_primary_count: 0,
      account_number: null,
      change_request_status: "rejected",
    });
    expect(r.bucket).toBe("not_uploaded");
  });
});

describe("rejected", () => {
  it("reports an explicitly rejected bank change request", () => {
    const r = classify({ change_request_status: "rejected" });
    expect(r.bucket).toBe("rejected");
    expect(r.reasons).toContain("change_request_rejected");
  });

  it("reports two active primary records as unpayable", () => {
    const r = classify({ active_primary_count: 2 });
    expect(r.bucket).toBe("rejected");
    expect(r.reasons).toContain("multiple_active_primary_records");
  });

  it("reports encrypted and legacy columns disagreeing", () => {
    const r = classify({ account_sources_conflict: true });
    expect(r.bucket).toBe("rejected");
    expect(r.reasons).toContain("encrypted_and_legacy_columns_disagree");
  });

  it("reports an IFSC that fails the RBI format", () => {
    const r = classify({ ifsc_code: "HDFC001234" }); // 10 chars, missing the 0
    expect(r.bucket).toBe("rejected");
    expect(r.reasons).toContain("ifsc_invalid_format");
  });

  it("reports an empty IFSC", () => {
    const r = classify({ ifsc_code: "" });
    expect(r.bucket).toBe("rejected");
    expect(r.reasons).toContain("ifsc_invalid_format");
  });

  it("reports a spreadsheet-mangled account number", () => {
    const r = classify({ account_number: "6.276E+15" });
    expect(r.bucket).toBe("rejected");
    expect(r.reasons).toContain("account_number_corrupt");
  });

  it("reports an account shared with another employee", () => {
    const r = classify({ duplicate_of_employee_code: "MAS27845" });
    expect(r.bucket).toBe("rejected");
    expect(r.reasons).toContain("account_shared_with_another_employee");
    expect(r.detail).toContain("MAS27845");
  });

  it("never calls a corrupt account a duplicate", () => {
    // Every distinct number that rounds to the same mantissa collapses to the same string, so
    // corrupt values look identical to each other. Reporting that as a shared account sends
    // someone to investigate a fraud that does not exist; the real defect is destroyed digits.
    const r = classify({ account_number: "6.276E+15", duplicate_of_employee_code: "MAS27845" });
    expect(r.bucket).toBe("rejected");
    expect(r.reasons).toContain("account_number_corrupt");
    expect(r.reasons).not.toContain("account_shared_with_another_employee");
  });

  it("OUTRANKS the verified flag", () => {
    // The case that matters most: 3 active employees on this database are flagged verified with an
    // unusable IFSC. Reporting them as Verified would hide the only actionable defect they have.
    const r = classify({ verified: true, ifsc_code: "NOTANIFSC" });
    expect(r.bucket).toBe("rejected");
  });

  it("collects several faults on one record", () => {
    const r = classify({ account_number: "12345", ifsc_code: "bad" });
    expect(r.bucket).toBe("rejected");
    expect(r.reasons).toEqual(
      expect.arrayContaining(["account_number_corrupt", "ifsc_invalid_format"]),
    );
  });

  it("outranks a pending request — an in-flight change cannot mask a data fault", () => {
    const r = classify({ ifsc_code: "bad", change_request_status: "pending" });
    expect(r.bucket).toBe("rejected");
  });
});

describe("pending", () => {
  it("reports a clean record awaiting approval", () => {
    const r = classify({ change_request_status: "pending" });
    expect(r.bucket).toBe("pending");
    expect(r.reasons).toContain("change_request_awaiting_approval");
  });

  it("reports a clean record that is simply not verified yet", () => {
    const r = classify({ verified: false });
    expect(r.bucket).toBe("pending");
    expect(r.reasons).toContain("not_yet_verified");
  });
});

describe("verified", () => {
  it("reports a clean, verified, payable record", () => {
    const r = classify();
    expect(r.bucket).toBe("verified");
    expect(r.reasons).toContain("verified_in_hrms");
  });

  it("is unaffected by an already-approved past request", () => {
    expect(classify({ change_request_status: "approved" }).bucket).toBe("verified");
  });

  it("accepts a lowercase IFSC — it is uppercased before matching", () => {
    expect(classify({ ifsc_code: "hdfc0001234" }).bucket).toBe("verified");
  });
});

describe("bucket membership", () => {
  const EXCLUSIVE: ExclusiveBucket[] = ["verified", "pending", "not_uploaded", "rejected"];

  it("treats 'uploaded' as everyone except not_uploaded", () => {
    for (const b of EXCLUSIVE) {
      expect(classMatchesBucket(b, "uploaded")).toBe(b !== "not_uploaded");
    }
  });

  it("matches an exclusive bucket only for itself", () => {
    for (const b of EXCLUSIVE) {
      for (const req of EXCLUSIVE) {
        expect(classMatchesBucket(b, req)).toBe(b === req);
      }
    }
  });

  it("labels every bucket the screen can show", () => {
    for (const b of MIS_BUCKETS) {
      expect(MIS_BUCKET_LABELS[b as MisBucket]).toBeTruthy();
    }
  });

  it("exposes the five buckets in the legacy column order", () => {
    expect([...MIS_BUCKETS]).toEqual([
      "uploaded",
      "verified",
      "pending",
      "not_uploaded",
      "rejected",
    ]);
  });
});

describe("summary arithmetic", () => {
  /** The same counting buildValidatedBankAccountMisSummary does. */
  const tally = (buckets: ExclusiveBucket[]) => {
    const row = { uploaded: 0, verified: 0, pending: 0, not_uploaded: 0, rejected: 0, total: 0 };
    for (const b of buckets) {
      row[b]++;
      row.total++;
      if (b !== "not_uploaded") row.uploaded++;
    }
    return row;
  };

  it("cross-foots on a mixed population", () => {
    const row = tally([
      "verified", "verified", "verified",
      "pending", "pending",
      "rejected",
      "not_uploaded", "not_uploaded",
    ]);
    expect(row.total).toBe(8);
    expect(row.total).toBe(row.uploaded + row.not_uploaded);
    expect(row.uploaded).toBe(row.verified + row.pending + row.rejected);
  });

  /**
   * The AHMEDABAD-JALDARSHAN row from the live legacy screen:
   *   Uploaded 236, Verified 234, Pending 0, Not Uploaded 1, Rejected 2, Total 237.
   *
   * Reproducing it proves "Uploaded" is a union, not a sixth exclusive state — read as exclusive
   * this row would total 473.
   */
  it("reproduces the legacy AHMEDABAD-JALDARSHAN row", () => {
    const row = tally([
      ...Array<ExclusiveBucket>(234).fill("verified"),
      ...Array<ExclusiveBucket>(2).fill("rejected"),
      "not_uploaded",
    ]);
    expect(row).toEqual({
      uploaded: 236,
      verified: 234,
      pending: 0,
      not_uploaded: 1,
      rejected: 2,
      total: 237,
    });
  });

  it("counts an all-missing branch as zero uploaded", () => {
    const row = tally(["not_uploaded", "not_uploaded", "not_uploaded"]);
    expect(row.uploaded).toBe(0);
    expect(row.not_uploaded).toBe(3);
    expect(row.total).toBe(3);
  });

  it("cross-foots for every single-employee case the classifier can produce", () => {
    // Guards the identity itself rather than one hand-built population.
    for (const b of ["verified", "pending", "not_uploaded", "rejected"] as ExclusiveBucket[]) {
      const row = tally([b]);
      expect(row.total).toBe(row.uploaded + row.not_uploaded);
      expect(row.uploaded).toBe(row.verified + row.pending + row.rejected);
    }
  });
});

describe("detail column contract", () => {
  it("emits exactly the eleven legacy columns, in order", () => {
    // The format is fixed — people reconcile against the old screen, so a reordered or renamed
    // column is a defect even when the data behind it is right.
    expect(MIS_DETAIL_COLUMNS.map((c) => c.label)).toEqual([
      "EmpCode",
      "EmpName",
      "Branch",
      "CostCenter",
      "ACHolderName",
      "Account No",
      "Bank Name",
      "IFSC Code",
      "Account Type",
      "Payment Mode",
      "Remarks",
    ]);
  });

  it("states payment mode as bank transfer", () => {
    // employee_bank_detail has no payment_mode column; salary is paid by bank transfer.
    expect(PAYMENT_MODE).toBe("NEFT/Bank Transfer");
  });

  it("gives every classification a human-readable detail for the Remarks column", () => {
    const cases: Partial<MisClassifyInput>[] = [
      {},
      { verified: false },
      { active_primary_count: 0, account_number: null },
      { ifsc_code: "bad" },
      { change_request_status: "rejected" },
      { change_request_status: "pending" },
      { active_primary_count: 2 },
      { account_sources_conflict: true },
      { account_number: "6.276E+15" },
      { duplicate_of_employee_code: "MAS00001" },
    ];
    for (const c of cases) {
      const r = classify(c);
      expect(r.detail.trim().length, JSON.stringify(c)).toBeGreaterThan(0);
      expect(r.reasons.length, JSON.stringify(c)).toBeGreaterThan(0);
    }
  });

  it("never leaks a full account number into the remarks", () => {
    // Remarks is rendered on a general screen and goes into the CSV export.
    const r = classify({ duplicate_of_employee_code: "MAS00001" });
    expect(r.detail).not.toContain(CLEAN.account_number!);
  });
});
