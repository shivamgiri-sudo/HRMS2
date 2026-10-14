/**
 * Penny drop for a bank account an HR / payroll user enters on an employee's behalf
 * (PUT /api/employees/:employeeId/bank-details, reached from Ops Control "Enter bank details").
 *
 * That route used to store the account as "pending verification" with nothing attached, so an HR
 * typo in the account number or holder name was only found when a salary payment bounced. This
 * runs the same Luckpay /verifyPennyDrop call the payroll bank-change flow uses and compares the
 * name the bank returns against BOTH the account holder name HR typed and the employee's name.
 *
 * The save is never blocked by the provider: a Luckpay outage returns status 'failed' and the row
 * stays unverified, so HR can retry. Only a clean pass sets employee_bank_detail.verified = 1.
 */
import { createHash, randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { classifyNameMatch } from "../ats/indian-name-match.js";
import { resolveLuckpayConfig } from "../integrations/luckpay/luckpay.config.js";
import { luckpayPostJson } from "../integrations/luckpay/luckpay.transport.js";
import { compactProviderReference } from "../ats/luckpay-reference.js";

export type EmployeePennyDropStatus = "success" | "name_mismatch" | "failed";

export interface EmployeePennyDropResult {
  status: EmployeePennyDropStatus;
  beneficiaryName: string | null;
  holderMatch: { tier: string; score: number } | null;
  employeeMatch: { tier: string; score: number } | null;
  message: string;
}

const failsMatch = (m: { tier: string; suspicious: boolean }) =>
  m.tier === "none" || m.tier === "unknown" || m.suspicious;

/** Pure judgement, kept separate so it can be tested without the provider. */
export function judgeBeneficiaryName(
  beneficiaryName: string | null,
  holderName: string | null,
  employeeName: string | null,
): Omit<EmployeePennyDropResult, "message"> & { message: string } {
  if (!beneficiaryName) {
    return {
      status: "failed", beneficiaryName: null, holderMatch: null, employeeMatch: null,
      message: "The bank did not return an account holder name, so the account could not be verified. Check the account number and IFSC and try again.",
    };
  }
  const holder = holderName ? classifyNameMatch(holderName, beneficiaryName) : null;
  const emp = employeeName ? classifyNameMatch(employeeName, beneficiaryName) : null;
  const holderBad = holder ? failsMatch(holder) : false;
  const empBad = emp ? failsMatch(emp) : false;
  const brief = (m: ReturnType<typeof classifyNameMatch> | null) => (m ? { tier: m.tier, score: m.score } : null);
  if (holderBad || empBad) {
    const which = holderBad && empBad
      ? "neither the account holder name entered nor the employee's name"
      : holderBad ? "the account holder name entered" : "the employee's name";
    return {
      status: "name_mismatch", beneficiaryName, holderMatch: brief(holder), employeeMatch: brief(emp),
      message: `The bank returned "${beneficiaryName}", which does not match ${which}. Correct the details or send for manual review.`,
    };
  }
  return {
    status: "success", beneficiaryName, holderMatch: brief(holder), employeeMatch: brief(emp),
    message: `Account verified. The bank holder name is "${beneficiaryName}".`,
  };
}

export async function runEmployeeBankPennyDrop(input: {
  employeeId: string;
  accountNumber: string;
  ifscCode: string;
  holderName: string | null;
}): Promise<EmployeePennyDropResult> {
  const account = input.accountNumber.replace(/\s/g, "");
  const ifsc = input.ifscCode.trim().toUpperCase();
  const [empRows] = await db.execute<RowDataPacket[]>(
    "SELECT full_name FROM employees WHERE id = ? LIMIT 1",
    [input.employeeId],
  );
  const employeeName = String((empRows as RowDataPacket[])[0]?.full_name ?? "").trim() || null;

  const logId = randomUUID();
  await db.execute(
    `INSERT INTO bank_penny_drop_log
       (id, employee_id, account_number_hash, ifsc_code, penny_drop_status, employee_name_at_request)
     VALUES (?, ?, ?, ?, 'initiated', ?)`,
    [logId, input.employeeId, createHash("sha256").update(account.toUpperCase()).digest("hex"), ifsc, employeeName ?? ""],
  );

  let beneficiary: string | null = null;
  let providerRef: string | null = null;
  let sanitized: unknown = null;
  let providerVerified = false;
  try {
    const cfg = await resolveLuckpayConfig("core");
    providerRef = compactProviderReference("PD");
    const response = await luckpayPostJson(cfg, "/verifyPennyDrop", {
      clientTransactionId: providerRef,
      customerAccountNumber: account,
      customerAccountName: input.holderName || employeeName || "",
      customerIfscCode: ifsc,
      verificationMode: "PENNY_DROP",
    });
    sanitized = response.sanitized;
    const d = response.data as Record<string, unknown>;
    const details = (d["details"] && typeof d["details"] === "object" ? d["details"] : {}) as Record<string, unknown>;
    const apiStatus = String(d["status"] ?? d["result"] ?? "").toLowerCase();
    providerVerified = Boolean(details["verified"] ?? details["status"]) ||
      ["valid", "verified", "success", "active"].includes(apiStatus);
    beneficiary = String(
      details["beneficiaryNameWithBank"] ?? details["beneficiaryName"] ??
      d["registered_name"] ?? d["account_holder_name"] ?? d["name"] ?? "",
    ).trim() || null;
  } catch (err) {
    console.error("[employee-bank-penny-drop] provider call failed:", err instanceof Error ? err.message : err);
  }

  const judged = providerVerified
    ? judgeBeneficiaryName(beneficiary, input.holderName, employeeName)
    : {
        status: "failed" as const, beneficiaryName: null, holderMatch: null, employeeMatch: null,
        message: "The bank could not verify this account (provider unavailable or account not found). The details are saved but unverified — check them and retry.",
      };

  await db.execute(
    `UPDATE bank_penny_drop_log
        SET penny_drop_status = ?, beneficiary_name_returned = ?, name_match_tier = ?, name_match_score = ?,
            penny_drop_ref = ?, settled_at = NOW(), provider_response_json = ?
      WHERE id = ?`,
    [
      judged.status, judged.beneficiaryName, judged.employeeMatch?.tier ?? judged.holderMatch?.tier ?? null,
      judged.employeeMatch?.score ?? judged.holderMatch?.score ?? null, providerRef,
      sanitized ? JSON.stringify(sanitized) : null, logId,
    ],
  );
  if (judged.status === "success") {
    await db.execute(
      "UPDATE employee_bank_detail SET verified = 1 WHERE employee_id = ? AND active_status = 1",
      [input.employeeId],
    );
  }
  return judged;
}
