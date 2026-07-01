import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

export interface SalaryGovernanceInput {
  employeeId?: string;
  candidateId?: string;
  salarySlabId?: string | null;
  salaryProposalId?: string | null;
  approvalReferenceId?: string | null;
  ctcAnnual: number;
  actorUserId: string;
  actorRoles: string[];
  migrationMode?: boolean;
  reason?: string | null;
}

export interface SalaryGovernanceResult {
  allowed: boolean;
  mode: "STANDARD_SLAB" | "APPROVED_EXCEPTION" | "MIGRATION_OVERRIDE" | "BLOCKED";
  salarySlabId?: string | null;
  salaryProposalId?: string | null;
  salaryRegisterId?: string | null;
  approvedCtcAnnual?: number | null;
  blockCode?: "SALARY_BYPASS_BLOCKED";
  message?: string;
}

const BLOCKED: (msg: string) => SalaryGovernanceResult = (message) => ({
  allowed: false,
  mode: "BLOCKED",
  blockCode: "SALARY_BYPASS_BLOCKED",
  message,
});

// CTC tolerance: allow ±1 rupee for floating-point rounding
const CTC_TOLERANCE = 1.0;

async function writeAudit(
  actorUserId: string,
  actionType: string,
  entityId: string | null,
  summary: Record<string, unknown>
): Promise<void> {
  try {
    await db.execute(
      `INSERT INTO sensitive_action_log
         (id, actor_user_id, action_type, module_key, entity_type, entity_id, change_summary, created_at)
       VALUES (UUID(), ?, ?, 'payroll', 'salary_assignment', ?, ?, NOW())`,
      [actorUserId, actionType, entityId ?? null, JSON.stringify(summary)]
    );
  } catch {
    // Audit failure must not block salary assignment; log to console
    console.error("[salary-governance] audit write failed", actionType, summary);
  }
}

async function createSalaryRegister(
  input: SalaryGovernanceInput,
  mode: "STANDARD_SLAB" | "APPROVED_EXCEPTION" | "MIGRATION_OVERRIDE",
  slabId: string | null,
  proposalId: string | null
): Promise<string> {
  const registerId = randomUUID();
  await db.execute(
    `INSERT INTO salary_register
       (id, candidate_id, employee_id, salary_slab_id, salary_proposal_id,
        approved_ctc_annual, governance_mode, locked_status, locked_by, locked_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, NOW(), ?)`,
    [
      registerId,
      input.candidateId ?? null,
      input.employeeId ?? null,
      slabId,
      proposalId,
      input.ctcAnnual,
      mode,
      input.actorUserId,
      input.actorUserId,
    ]
  );
  await db.execute(
    `INSERT INTO salary_register_audit_log
       (id, salary_register_id, actor_user_id, action_type, change_summary)
     VALUES (UUID(), ?, ?, 'SALARY_REGISTER_CREATED', ?)`,
    [
      registerId,
      input.actorUserId,
      JSON.stringify({
        mode,
        ctc_annual: input.ctcAnnual,
        salary_slab_id: slabId,
        salary_proposal_id: proposalId,
        reason: input.reason ?? null,
      }),
    ]
  );
  return registerId;
}

export async function assertSalaryAssignmentAllowed(
  input: SalaryGovernanceInput
): Promise<SalaryGovernanceResult> {
  const { ctcAnnual, actorRoles, migrationMode, reason } = input;
  const effectiveSlabId = input.salarySlabId ?? null;
  const effectiveProposalId = input.salaryProposalId ?? input.approvalReferenceId ?? null;

  // ─── Path C: Migration override (super_admin only) ───────────────────────
  if (migrationMode === true) {
    if (!actorRoles.includes("super_admin")) {
      return BLOCKED(
        "migration_mode is restricted to super_admin. Only a super admin may bypass salary governance."
      );
    }
    if (!reason?.trim()) {
      return BLOCKED("A mandatory reason is required for migration-mode salary assignment.");
    }
    const registerId = await createSalaryRegister(
      input, "MIGRATION_OVERRIDE", effectiveSlabId, effectiveProposalId
    ).catch(() => null);
    await writeAudit(input.actorUserId, "SALARY_MIGRATION_OVERRIDE", registerId, {
      ctc_annual: ctcAnnual,
      reason,
      employee_id: input.employeeId ?? null,
      candidate_id: input.candidateId ?? null,
    });
    return {
      allowed: true,
      mode: "MIGRATION_OVERRIDE",
      salarySlabId: effectiveSlabId,
      salaryProposalId: effectiveProposalId,
      salaryRegisterId: registerId,
      approvedCtcAnnual: ctcAnnual,
    };
  }

  // ─── Path A: Standard slab ────────────────────────────────────────────────
  if (effectiveSlabId) {
    // Try payroll_salary_slabs first (exact CTC slabs)
    const [pssRows] = await db.execute<RowDataPacket[]>(
      `SELECT id, ctc_annual FROM payroll_salary_slabs
        WHERE id = ? AND active_status = 1 LIMIT 1`,
      [effectiveSlabId]
    ).catch(() => [[]] as any);

    if (Array.isArray(pssRows) && pssRows.length > 0) {
      const slab = pssRows[0] as any;
      const slabCtc = Number(slab.ctc_annual);
      if (Math.abs(slabCtc - ctcAnnual) > CTC_TOLERANCE) {
        await writeAudit(input.actorUserId, "SALARY_BYPASS_ATTEMPT_SLAB_CTC_MISMATCH", null, {
          slab_id: effectiveSlabId,
          slab_ctc: slabCtc,
          requested_ctc: ctcAnnual,
        });
        return BLOCKED(
          `CTC mismatch: slab '${effectiveSlabId}' allows ₹${slabCtc.toFixed(2)} per year ` +
          `but requested amount is ₹${ctcAnnual.toFixed(2)}. Amounts must match within ₹${CTC_TOLERANCE}.`
        );
      }
      const registerId = await createSalaryRegister(
        input, "STANDARD_SLAB", slab.id, null
      ).catch(() => null);
      await writeAudit(input.actorUserId, "SALARY_STANDARD_SLAB_ASSIGNED", registerId, {
        slab_id: slab.id,
        ctc_annual: ctcAnnual,
      });
      return {
        allowed: true,
        mode: "STANDARD_SLAB",
        salarySlabId: slab.id,
        salaryProposalId: null,
        salaryRegisterId: registerId,
        approvedCtcAnnual: slabCtc,
      };
    }

    // Fall back to salary_grade_master (code-based lookup)
    const [gradeRows] = await db.execute<RowDataPacket[]>(
      `SELECT id FROM salary_grade_master WHERE id = ? AND active_status = 1 LIMIT 1`,
      [effectiveSlabId]
    ).catch(() => [[]] as any);

    if (Array.isArray(gradeRows) && gradeRows.length > 0) {
      // Grade found — no CTC constraint (grade doesn't store ctc_annual)
      const registerId = await createSalaryRegister(
        input, "STANDARD_SLAB", effectiveSlabId, null
      ).catch(() => null);
      await writeAudit(input.actorUserId, "SALARY_GRADE_SLAB_ASSIGNED", registerId, {
        grade_id: effectiveSlabId,
        ctc_annual: ctcAnnual,
      });
      return {
        allowed: true,
        mode: "STANDARD_SLAB",
        salarySlabId: effectiveSlabId,
        salaryProposalId: null,
        salaryRegisterId: registerId,
        approvedCtcAnnual: ctcAnnual,
      };
    }

    // Slab ID provided but not found in any table
    await writeAudit(input.actorUserId, "SALARY_BYPASS_ATTEMPT_UNKNOWN_SLAB", null, {
      slab_id: effectiveSlabId,
      ctc_annual: ctcAnnual,
    });
    return BLOCKED(
      `Salary slab '${effectiveSlabId}' not found in payroll_salary_slabs or salary_grade_master. ` +
      `Add the slab to the salary master before assigning.`
    );
  }

  // ─── Path B: Approved exception/proposal ─────────────────────────────────
  if (effectiveProposalId) {
    // Try salary_proposal table first
    const [propRows] = await db.execute<RowDataPacket[]>(
      `SELECT id, proposed_ctc_annual, status FROM salary_proposal
        WHERE id = ? LIMIT 1`,
      [effectiveProposalId]
    ).catch(() => [[]] as any);

    if (Array.isArray(propRows) && propRows.length > 0) {
      const prop = propRows[0] as any;
      const approvedStatuses = ["final_approved", "approved", "locked"];
      if (!approvedStatuses.includes(String(prop.status))) {
        await writeAudit(input.actorUserId, "SALARY_BYPASS_ATTEMPT_UNAPPROVED_PROPOSAL", null, {
          proposal_id: effectiveProposalId,
          proposal_status: prop.status,
          ctc_annual: ctcAnnual,
        });
        return BLOCKED(
          `Salary proposal '${effectiveProposalId}' has status '${prop.status}'. ` +
          `Only final_approved/approved/locked proposals allow salary assignment.`
        );
      }
      const proposedCtc = Number(prop.proposed_ctc_annual);
      if (Math.abs(proposedCtc - ctcAnnual) > CTC_TOLERANCE) {
        await writeAudit(input.actorUserId, "SALARY_BYPASS_ATTEMPT_PROPOSAL_CTC_MISMATCH", null, {
          proposal_id: effectiveProposalId,
          proposal_ctc: proposedCtc,
          requested_ctc: ctcAnnual,
        });
        return BLOCKED(
          `CTC mismatch: approved proposal allows ₹${proposedCtc.toFixed(2)} per year ` +
          `but requested amount is ₹${ctcAnnual.toFixed(2)}.`
        );
      }
      const registerId = await createSalaryRegister(
        input, "APPROVED_EXCEPTION", null, prop.id
      ).catch(() => null);
      await writeAudit(input.actorUserId, "SALARY_APPROVED_EXCEPTION_ASSIGNED", registerId, {
        proposal_id: prop.id,
        ctc_annual: ctcAnnual,
      });
      return {
        allowed: true,
        mode: "APPROVED_EXCEPTION",
        salarySlabId: null,
        salaryProposalId: prop.id,
        salaryRegisterId: registerId,
        approvedCtcAnnual: proposedCtc,
      };
    }

    // Try salary_exception_proposal (ATS candidate flow)
    const [excRows] = await db.execute<RowDataPacket[]>(
      `SELECT id, proposed_gross_salary, status FROM salary_exception_proposal
        WHERE id = ? LIMIT 1`,
      [effectiveProposalId]
    ).catch(() => [[]] as any);

    if (Array.isArray(excRows) && excRows.length > 0) {
      const exc = excRows[0] as any;
      if (String(exc.status) !== "approved") {
        return BLOCKED(
          `Salary exception proposal '${effectiveProposalId}' status is '${exc.status}'. ` +
          `Only approved exceptions allow direct salary assignment.`
        );
      }
      const registerId = await createSalaryRegister(
        input, "APPROVED_EXCEPTION", null, effectiveProposalId
      ).catch(() => null);
      await writeAudit(input.actorUserId, "SALARY_EXCEPTION_PROPOSAL_ASSIGNED", registerId, {
        exception_proposal_id: effectiveProposalId,
        ctc_annual: ctcAnnual,
      });
      return {
        allowed: true,
        mode: "APPROVED_EXCEPTION",
        salarySlabId: null,
        salaryProposalId: effectiveProposalId,
        salaryRegisterId: registerId,
        approvedCtcAnnual: Number(exc.proposed_gross_salary),
      };
    }

    // proposal ID provided but not found
    await writeAudit(input.actorUserId, "SALARY_BYPASS_ATTEMPT_UNKNOWN_PROPOSAL", null, {
      proposal_id: effectiveProposalId,
      ctc_annual: ctcAnnual,
    });
    return BLOCKED(
      `Approval reference '${effectiveProposalId}' not found in salary_proposal or salary_exception_proposal. ` +
      `The reference must exist and be in approved/final_approved status.`
    );
  }

  // ─── No slab, no proposal, no migration mode → BLOCKED ───────────────────
  await writeAudit(input.actorUserId, "SALARY_BYPASS_ATTEMPT_NO_GOVERNANCE", null, {
    ctc_annual: ctcAnnual,
    employee_id: input.employeeId ?? null,
    candidate_id: input.candidateId ?? null,
  });
  return BLOCKED(
    "Manual salary amount is not allowed without approved salary slab or approved salary proposal. " +
    "Provide a salarySlabId from the salary master, a salaryProposalId from an approved proposal, " +
    "or contact a super admin for migration-mode override."
  );
}
