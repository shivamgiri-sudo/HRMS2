/**
 * A person who arrives for a requisition whose end date has passed (an overflow drive, see walkin-booking lastBookableDay) is
 * carried over to the best open requisition at the same branch, so HR sees them on the roster they can actually select for.
 * The carry-over is an unplanned arrival (state 'arrived', no slot): it is not counted in the invited/arrived rates
 * (UNPLANNED_ARRIVAL). HR still decides the selection and the fulfilled count; nothing here touches headcount.
 * Never throws: an arrival must not fail because the carry-over could not be written.
 */
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { randomUUID } from "node:crypto";
import { db } from "../../db/mysql.js";
import { logger } from "../../logger.js";
import { rankSuccessors, type Candidate } from "../meta-campaign/campaign-successor.service.js";
import { closedReasonOf } from "../meta-campaign/campaign-requisition.service.js";
import { addEvent } from "./he-lead.service.js";
import { createDriveIfAbsent } from "./walkin-booking.service.js";

const IST_MS = 330 * 60_000;
const istDay = (now: Date): string => new Date(now.getTime() + IST_MS).toISOString().slice(0, 10);

const toCandidate = (r: RowDataPacket): Candidate => ({
  id: String(r.id), code: String(r.requisition_code ?? ""), designation: String(r.designation_name), branch: String(r.branch_name),
  process: String(r.process_id ?? r.process_name ?? ""), validity: r.requisition_validity ? String(r.requisition_validity).slice(0, 10) : null,
  seatsLeft: Number(r.requested_headcount) - Number(r.fulfilled_headcount), linked: false,
});

export type CarryResult = { status: "carried"; requisitionId: string; code: string } | { status: "skipped"; reason: string };

/** Carry one arrived match over. `matchId` is the he_match that just turned 'arrived'. */
export async function carryOverArrival(matchId: string, now: Date = new Date()): Promise<CarryResult> {
  try {
    const today = istDay(now);
    const [m] = await db.execute<RowDataPacket[]>(
      `SELECT m.lead_id, m.requisition_id, d.branch_name AS drive_branch, d.drive_date, j.designation_name, j.branch_name, j.process_id, j.process_name,
              j.requisition_validity, j.requisition_code
         FROM he_match m JOIN job_requisition j ON j.id = m.requisition_id LEFT JOIN he_drive d ON d.id = m.drive_id WHERE m.id = ? LIMIT 1`, [matchId]);
    const cur = m[0];
    if (!cur) return { status: "skipped", reason: "match_not_found" };
    const end = cur.requisition_validity ? String(cur.requisition_validity).slice(0, 10) : null;
    if (!end || end >= today) return { status: "skipped", reason: "requisition_running" };

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT j.* FROM job_requisition j WHERE j.id <> ? AND j.designation_name = ? AND j.active_status = 1 AND j.approval_status = 'approved'
          AND j.closed_at IS NULL AND j.fulfilled_headcount < j.requested_headcount AND (j.requisition_validity IS NULL OR j.requisition_validity >= ?)`,
      [String(cur.requisition_id), String(cur.designation_name), today]);
    const pick = rankSuccessors(
      { designation: String(cur.designation_name), branch: String(cur.branch_name), process: String(cur.process_id ?? cur.process_name ?? "") },
      rows.filter((r) => !closedReasonOf(r)).map(toCandidate), today)[0];
    if (!pick) return { status: "skipped", reason: "no_open_requisition" };

    const branch = String(cur.drive_branch ?? pick.branch);
    const drive = await createDriveIfAbsent({ requisitionId: pick.id, branchName: branch, driveDate: today });
    const [ex] = await db.execute<RowDataPacket[]>("SELECT id, state FROM he_match WHERE lead_id = ? AND requisition_id = ? LIMIT 1", [String(cur.lead_id), pick.id]);
    const reasons = JSON.stringify({ carriedOverFrom: String(cur.requisition_id), fromCode: String(cur.requisition_code ?? "") });
    if (ex[0]) {
      if (["arrived", "selected", "declined"].includes(String(ex[0].state))) return { status: "skipped", reason: "already_on_requisition" };
      const [u] = await db.execute<ResultSetHeader>("UPDATE he_match SET state = 'arrived', drive_id = ?, slot_at = NULL, reasons_json = ? WHERE id = ?", [drive.id, reasons, String(ex[0].id)]);
      if (!u.affectedRows) return { status: "skipped", reason: "not_updated" };
    } else {
      await db.execute("INSERT INTO he_match (id, lead_id, requisition_id, drive_id, score, state, slot_at, reasons_json) VALUES (?,?,?,?,0,'arrived',NULL,?)",
        [randomUUID(), String(cur.lead_id), pick.id, drive.id, reasons]);
    }
    await addEvent(String(cur.lead_id), "carried_over", {
      driveId: drive.id, channel: "branch", detail: `arrived for ${cur.requisition_code} (ended ${end}); carried over to ${pick.code}`,
      meta: { fromRequisitionId: String(cur.requisition_id), toRequisitionId: pick.id },
    });
    return { status: "carried", requisitionId: pick.id, code: String(pick.code ?? "") };
  } catch (err) {
    logger.warn({ err: (err as Error).message.slice(0, 160), matchId }, "[arrival-carryover] failed");
    return { status: "skipped", reason: "error" };
  }
}
