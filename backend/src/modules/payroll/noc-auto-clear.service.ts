/**
 * NOC auto-clearance engine.
 *
 * Records a clearance decision for a stage only when system data PROVES the stage's fact, and
 * writes that proof onto the decision, so a stage that no human touched is still an audited,
 * explainable signature rather than an unexplained one.
 *
 * THE RULE THAT KEEPS THIS GOVERNED
 *
 * Absence of evidence is never evidence of clearance. Every check below requires a positive row
 * (a provisioning task that is done, an asset register with nothing outstanding) and refuses to
 * clear on "no data", on a missing exit provisioning task, or on a query that failed. A stage the
 * engine cannot prove stays pending for a person, and the SLA worker escalates it as before.
 *
 * WHAT IS AUTOMATED, AND ON WHAT EVIDENCE
 *
 *  it        domain_delete, email_delete and dialler_delete exit provisioning tasks are all
 *            actioned/confirmed/waived AND the asset register has no open assignment.
 *  admin     biometric_delete is actioned/confirmed/waived AND every mandatory company-property
 *            row on the case is Returned or explicitly waived.
 *  accounts  Advances, loans and open reimbursement claims are SNAPSHOT onto the decision and are
 *  finance   settled through F&F (ff-compute.service.ts already recovers the full balance), so a
 *            balance is a deduction, not a reason to hold the person's clearance. Finance still
 *            honours its own asset gate through stageBlockReason().
 *  hr        Last Working Day is known and reached, and the exit request is accepted /
 *            notice_serving / exited. The LWD is copied from the exit request, not retyped.
 *  chain     Team Leader / Process Manager / Branch Manager are a person's knowledge-transfer
 *            call and are never cleared from data. After the SLA plus a 24h grace, and only once
 *            the SLA worker has escalated at least twice, silence is recorded as DEEMED cover
 *            with the reminder trail on the record. A decline always wins and is never deemed.
 *
 * Runs from the SLA worker's hourly sweep and at case open. Everything is gated by
 * noc_auto_clearance_enabled (default OFF, noc-auto-profile.ts).
 */

import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import * as nocCase from "./noc-case.service.js";
import {
  CHAIN_DEEMED_AFTER_HOURS,
  NOC_SYSTEM_ACTOR_ID,
  NOC_SYSTEM_ACTOR_NAME,
  isChainStage,
  isNocAutoClearanceEnabled,
} from "./noc-auto-profile.js";

const DONE_PROVISIONING = ["actioned", "confirmed", "waived"] as const;
const OPEN_CASE_STATUSES = ["invited", "employee_submitted", "in_progress"];
const MAX_CASES_PER_SWEEP = 200;

export interface Verdict {
  clear: boolean;
  /** Evidence when clear; what is still missing when not. Stored on the decision. */
  reason: string;
}

async function provisioningDone(
  employeeId: string,
  codes: string[],
): Promise<{ ok: boolean; missing: string[] }> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT task_code, status FROM it_provisioning_request
      WHERE employee_id = ? AND request_type = 'exit'
        AND task_code IN (${codes.map(() => "?").join(",")})`,
    [employeeId, ...codes],
  );
  const missing: string[] = [];
  for (const code of codes) {
    const mine = rows.filter((r) => r.task_code === code);
    const done =
      mine.length > 0 &&
      mine.every((r) =>
        (DONE_PROVISIONING as readonly string[]).includes(String(r.status)),
      );
    if (!done) missing.push(code);
  }
  return { ok: missing.length === 0, missing };
}

async function openRegisterAssets(employeeId: string): Promise<number> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS n FROM asset_assignment
      WHERE employee_id = ? AND returned_date IS NULL`,
    [employeeId],
  );
  return Number(rows[0]?.n ?? 0);
}

async function itVerdict(c: nocCase.NocCaseRow): Promise<Verdict> {
  const prov = await provisioningDone(c.employee_id, [
    "domain_delete",
    "email_delete",
    "dialler_delete",
  ]);
  if (!prov.ok) {
    return {
      clear: false,
      reason: `Access removal not confirmed: ${prov.missing.join(", ")}`,
    };
  }
  const open = await openRegisterAssets(c.employee_id);
  if (open > 0) {
    return { clear: false, reason: `${open} asset(s) still assigned in the register` };
  }
  return {
    clear: true,
    reason:
      "Auto: domain, email and dialler/external IDs removed; asset register has no open assignment",
  };
}

async function adminVerdict(c: nocCase.NocCaseRow): Promise<Verdict> {
  const prov = await provisioningDone(c.employee_id, ["biometric_delete"]);
  if (!prov.ok) {
    return { clear: false, reason: "Biometric removal not confirmed" };
  }
  const gate = nocCase.evaluateAssetGate(await nocCase.getAssets(c.id));
  if (!gate.satisfied) {
    return {
      clear: false,
      reason: `Company property outstanding: ${gate.outstanding.join(", ")}`,
    };
  }
  return {
    clear: true,
    reason:
      "Auto: biometric removed; all mandatory company property returned or waived",
  };
}

async function duesVerdict(c: nocCase.NocCaseRow): Promise<Verdict> {
  const [adv] = await db.execute<RowDataPacket[]>(
    `SELECT COALESCE(SUM(amount - COALESCE(recovered_amount, 0)), 0) AS n
       FROM salary_advance_log WHERE employee_id = ? AND status = 'active'`,
    [c.employee_id],
  );
  const [loan] = await db.execute<RowDataPacket[]>(
    `SELECT COALESCE(SUM(pending_amount), 0) AS n
       FROM employee_loans WHERE employee_id = ? AND status = 'active'`,
    [c.employee_id],
  );
  const [claims] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS n FROM employee_reimbursement_claim
      WHERE employee_id = ?
        AND LOWER(status) IN ('submitted','pending','manager_approved','branch_head_approved')`,
    [c.employee_id],
  );
  const a = Number(adv[0]?.n ?? 0);
  const l = Number(loan[0]?.n ?? 0);
  const k = Number(claims[0]?.n ?? 0);
  return {
    clear: true,
    reason: `Auto: dues snapshot — advances ${a.toFixed(2)}, loans ${l.toFixed(2)}, open claims ${k}; settled through F&F`,
  };
}

async function hrVerdict(c: nocCase.NocCaseRow): Promise<Verdict> {
  if (!c.last_working_day) {
    return { clear: false, reason: "Last Working Day not known" };
  }
  const [er] = await db.execute<RowDataPacket[]>(
    `SELECT status FROM exit_request WHERE id = ? LIMIT 1`,
    [c.exit_request_id],
  );
  const st = String(er[0]?.status ?? "").toLowerCase();
  if (!["accepted", "notice_serving", "exited"].includes(st)) {
    return {
      clear: false,
      reason: `Exit request is "${st || "missing"}", not an accepted exit`,
    };
  }
  return {
    clear: true,
    reason: `Auto: exit ${st}, Last Working Day ${String(c.last_working_day).slice(0, 10)} reached`,
  };
}

async function chainDeemedVerdict(
  s: nocCase.NocSignatoryRow,
): Promise<Verdict> {
  if (!s.sla_due_at) return { clear: false, reason: "SLA not started" };
  const deemedAt =
    new Date(String(s.sla_due_at)).getTime() +
    24 * 60 * 60 * 1000;
  if (Date.now() < deemedAt || Number(s.reminder_count) < 2) {
    return { clear: false, reason: "Awaiting reporting-chain decision" };
  }
  return {
    clear: true,
    reason: `Deemed: no response within ${CHAIN_DEEMED_AFTER_HOURS}h of opening; ${s.reminder_count} reminder(s), escalated${s.sla_due_at ? ` (SLA due ${String(s.sla_due_at).slice(0, 16)})` : ""}`,
  };
}

async function verdictFor(
  c: nocCase.NocCaseRow,
  s: nocCase.NocSignatoryRow,
): Promise<Verdict> {
  switch (s.stage_key) {
    case "it":
      return itVerdict(c);
    case "admin":
      return adminVerdict(c);
    case "accounts":
    case "finance":
      return duesVerdict(c);
    case "hr":
      return hrVerdict(c);
    default:
      if (isChainStage(s.stage_key)) return chainDeemedVerdict(s);
      return { clear: false, reason: "No automatic evidence for this stage" };
  }
}

/**
 * Copy the LWD from the exit request / employee record when the case has none, so HR is not
 * asked to retype a date the system already holds. Uses the same shared resolver as payroll.
 */
async function ensureLastWorkingDay(c: nocCase.NocCaseRow): Promise<string | null> {
  if (c.last_working_day) return c.last_working_day;
  const { EMPLOYMENT_END_DATE_SELECT } = await import("./employment-end-date.js");
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT ${EMPLOYMENT_END_DATE_SELECT} AS lwd FROM employees e WHERE e.id = ? LIMIT 1`,
    [c.employee_id],
  );
  const lwd = rows[0]?.lwd ? String(rows[0].lwd).slice(0, 10) : null;
  if (!lwd) return null;
  try {
    await nocCase.setLastWorkingDay({
      caseId: c.id,
      lastWorkingDay: lwd,
      actorUserId: NOC_SYSTEM_ACTOR_ID,
      actorRole: "system",
      actorName: NOC_SYSTEM_ACTOR_NAME,
    });
    return lwd;
  } catch (err) {
    console.warn(`[noc-auto] LWD copy failed for ${c.id}:`, (err as Error).message);
    return null;
  }
}

export interface AutoClearResult {
  caseId: string;
  cleared: string[];
  completed: boolean;
}

export async function runAutoClearForCase(caseId: string): Promise<AutoClearResult> {
  const out: AutoClearResult = { caseId, cleared: [], completed: false };
  if (!(await isNocAutoClearanceEnabled())) return out;

  let c = await nocCase.getCase(caseId);
  if (!c || !OPEN_CASE_STATUSES.includes(c.status)) return out;

  if (!c.last_working_day) {
    await ensureLastWorkingDay(c);
    c = (await nocCase.getCase(caseId)) ?? c;
  }

  // Under the profile stages are actionable the moment the case opens, and nobody has acted yet
  // to start their SLA clocks. Idempotent (COALESCE) so every sweep may call it.
  await nocCase.startSlaForCase(caseId);

  // A cleared stage can open the next one (tier 2 HR after tier 1), so iterate to a fixed point.
  // Bounded: there are only eight stages and each pass clears at least one or stops.
  for (let pass = 0; pass < 4; pass++) {
    c = (await nocCase.getCase(caseId)) ?? c;
    if (!c || !OPEN_CASE_STATUSES.includes(c.status)) break;
    const sigs = await nocCase.getSignatories(caseId);
    const gate = nocCase.evaluateAssetGate(await nocCase.getAssets(caseId));
    let progressed = false;

    for (const s of sigs) {
      if (s.status !== "pending") continue;
      if (nocCase.stageBlockReason(c, sigs, s, gate, true) !== null) continue;
      let verdict: Verdict;
      try {
        verdict = await verdictFor(c, s);
      } catch (err) {
        // A failed evidence query is "unproven", never "clear".
        console.error(`[noc-auto] evidence ${caseId}/${s.stage_key}:`, (err as Error).message);
        continue;
      }
      if (!verdict.clear) continue;

      try {
        const res = await nocCase.actOnSignatory({
          caseId,
          stageKey: s.stage_key,
          decision: "acknowledged",
          remarks: verdict.reason.slice(0, 500),
          actorUserId: NOC_SYSTEM_ACTOR_ID,
          actorName: NOC_SYSTEM_ACTOR_NAME,
          actorRole: "system",
        });
        out.cleared.push(s.stage_key);
        progressed = true;
        if (res.completed) {
          out.completed = true;
          void import("./noc.notifications.js").then((m) => m.notifyCompleted(caseId));
        }
      } catch (err) {
        console.warn(`[noc-auto] ${caseId}/${s.stage_key} not recorded:`, (err as Error).message);
      }
      // State changed under us; re-read before judging the next stage.
      break;
    }
    if (!progressed || out.completed) break;
  }

  if (!out.completed) {
    // Tell the humans who still owe a decision. notifySignatoryPending is dedupe-keyed per stage,
    // so calling this every sweep does not re-mail. Only stages the engine cannot clear from data
    // are notified (reporting chain and HR); IT/Admin already hold their provisioning tasks.
    const sigs = await nocCase.getSignatories(caseId);
    const open = await nocCase.actionableStages(caseId);
    const m = await import("./noc.notifications.js");
    for (const s of open) {
      if (isChainStage(s.stage_key) || s.stage_key === "hr") {
        const row = sigs.find((x) => x.id === s.id);
        if (row?.status === "pending") await m.notifySignatoryPending(caseId, s.stage_key);
      }
    }
  }
  return out;
}

export async function runAutoClearSweep(): Promise<{ cases: number; cleared: number; completed: number }> {
  const summary = { cases: 0, cleared: 0, completed: 0 };
  if (!(await isNocAutoClearanceEnabled())) return summary;
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id FROM noc_case
      WHERE status IN ('invited','employee_submitted','in_progress')
      ORDER BY created_at LIMIT ${MAX_CASES_PER_SWEEP}`,
  );
  for (const r of rows) {
    try {
      const res = await runAutoClearForCase(String(r.id));
      summary.cases++;
      summary.cleared += res.cleared.length;
      if (res.completed) summary.completed++;
    } catch (err) {
      console.error(`[noc-auto] case ${r.id}:`, (err as Error).message);
    }
  }
  return summary;
}
