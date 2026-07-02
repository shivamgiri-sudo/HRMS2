import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { appendJourneyEvent } from "../employees/journeyLog.service.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

async function generateEmployeeCode(): Promise<string> {
  const [rows] = await db.execute<RowDataPacket[]>(
    "SELECT employee_code FROM employees WHERE employee_code LIKE 'MAS%' ORDER BY employee_code DESC LIMIT 1"
  );
  const last = (rows as { employee_code: string }[])[0]?.employee_code ?? null;
  if (!last) return "MAS00001";
  const num = parseInt(last.replace("MAS", ""), 10);
  return `MAS${String(isNaN(num) ? 1 : num + 1).padStart(5, "0")}`;
}

// ── Conversion ────────────────────────────────────────────────────────────────

export interface ConvertResult {
  employee_id: string;
  employee_code: string;
}

export async function convertCandidateToEmployee(
  candidateId: string,
  actorId: string
): Promise<ConvertResult> {
  // 1. Load candidate
  const [candRows] = await db.execute<RowDataPacket[]>(
    "SELECT * FROM ats_candidate WHERE id = ? AND active_status = 1 LIMIT 1",
    [candidateId]
  );
  const candidate = (candRows as RowDataPacket[])[0];
  if (!candidate) throw new Error("Candidate not found");

  if (candidate.current_stage === "converted") {
    throw new Error("Candidate has already been converted to an employee");
  }

  // 2. Load onboarding bridge record (optional — use what's available)
  const [bridgeRows] = await db.execute<RowDataPacket[]>(
    "SELECT * FROM ats_onboarding_bridge WHERE candidate_id = ? LIMIT 1",
    [candidateId]
  );
  const bridge = (bridgeRows as RowDataPacket[])[0] ?? null;

  // 3. Derive first_name / last_name from full_name
  const fullName: string = (candidate.full_name as string) ?? "";
  const nameParts = fullName.trim().split(/\s+/);
  const firstName = nameParts[0] ?? fullName;
  const lastName = nameParts.length > 1 ? nameParts.slice(1).join(" ") : null;

  // 4. Generate employee code
  const employeeCode = await generateEmployeeCode();
  const employeeId = randomUUID();

  const joiningDate: string =
    (bridge?.joining_date as string | null) ??
    new Date().toISOString().slice(0, 10);

  // 5. Insert employee
  await db.execute(
    `INSERT INTO employees
       (id, employee_code, first_name, last_name, email, mobile,
        date_of_joining, salary_start_date,
        branch_id, process_id, designation_id,
        employment_type, employment_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Full Time', 'Active')`,
    [
      employeeId,
      employeeCode,
      firstName,
      lastName,
      candidate.email ?? null,
      candidate.mobile ?? null,
      joiningDate,
      joiningDate,
      bridge?.branch_id ?? null,
      bridge?.process_id ?? null,
      bridge?.designation_id ?? null,
    ]
  );

  // 6. Mark candidate as converted (updated_at serves as conversion timestamp)
  await db.execute(
    "UPDATE ats_candidate SET current_stage = 'converted', updated_at = NOW() WHERE id = ?",
    [candidateId]
  );

  // 7. Update bridge record to link employee
  if (bridge) {
    await db.execute(
      "UPDATE ats_onboarding_bridge SET employee_id = ?, status = 'converted', updated_at = NOW() WHERE candidate_id = ?",
      [employeeId, candidateId]
    );
  }

  // 8. Log to employee journey
  await appendJourneyEvent({
    employeeId,
    eventType: "hiring",
    eventDate: joiningDate,
    description: `Converted from ATS candidate #${candidate.candidate_code as string}`,
    module: "ATS",
    triggeredBy: actorId,
    metadata: { candidate_id: candidateId, candidate_code: candidate.candidate_code },
  });

  return { employee_id: employeeId, employee_code: employeeCode };
}
