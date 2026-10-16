/**
 * Which people does the Ops Control Tower list, by employment state? READ-ONLY.
 * Runs every drill-down the page offers for every branch, looks up each listed employee and prints, per block,
 * a tally of active_status / employment_status plus sample rows that are NOT plainly active staff.
 *
 *   npx tsx scripts/probe-ops-inactive.ts
 */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";
import * as svc from "../src/modules/ops-control-tower/ops-control-tower.service.js";

const q = async (sql: string, p: unknown[] = []) => (await db.execute<RowDataPacket[]>(sql, p))[0] as RowDataPacket[];
const EXIT_TRACKERS = new Set(["fnf-pending", "noc-pending", "absconder-hold-pending"]); // leavers are expected here

const BLOCKS: Record<string, (branchId: string) => Promise<unknown[]>> = {
  "attendance-mismatch": svc.getAttendanceMismatchDetail,
  "fnf-pending": svc.getFnfPendingDetail,
  "noc-pending": svc.getNocPendingDetail,
  "absconder-hold-pending": svc.getAbsconderHoldPendingDetail,
  "digilocker-pending": svc.getDigilockerPendingDetail,
  "esign-pending": svc.getEsignPendingDetail,
  "appointment-letter": svc.getAppointmentLetterDetail,
  "penny-drop-missing": svc.getPennyDropMissingDetail,
  "account-details-missing": svc.getAccountDetailsMissingDetail,
  "docs-pending": svc.getDocsPendingDetail,
  "bgv-pending": svc.getBgvPendingDetail,
  "address-review-pending": svc.getAddressReviewPendingDetail,
  "it-provisioning-pending": svc.getItProvisioningPendingDetail,
  "admin-provisioning-pending": svc.getAdminProvisioningPendingDetail,
  "wfm-provisioning-pending": svc.getWfmProvisioningPendingDetail,
};

(async () => {
  const branches = await svc.allBranches();
  console.log(`branches: ${branches.length}`);
  let flaggedTotal = 0;
  for (const [block, loader] of Object.entries(BLOCKS)) {
    const ids = new Set<string>();
    for (const b of branches) {
      try {
        for (const r of (await loader(b.branchId)) as Array<{ employeeId?: string }>) if (r.employeeId) ids.add(String(r.employeeId));
      } catch (e) { console.log(`  ${block} @ ${b.branchName}: ${(e as Error).message.slice(0, 80)}`); }
    }
    if (ids.size === 0) { console.log(`${block}: 0 people listed`); continue; }
    const list = [...ids];
    const emps: RowDataPacket[] = [];
    for (let i = 0; i < list.length; i += 500) {
      emps.push(...await q(`SELECT id, employee_code, active_status, COALESCE(employment_status,'(null)') AS st, DATE_FORMAT(date_of_exit,'%Y-%m-%d') AS exit_date FROM employees WHERE id IN (${list.slice(i, i + 500).map(() => "?").join(",")})`, list.slice(i, i + 500)));
    }
    const tally = new Map<string, number>();
    const odd: RowDataPacket[] = [];
    for (const e of emps) {
      const key = `active_status=${e.active_status} / ${e.st}`;
      tally.set(key, (tally.get(key) ?? 0) + 1);
      const plain = Number(e.active_status) === 1 && /^active$/i.test(String(e.st));
      const preboard = /^preboarding$/i.test(String(e.st));
      if (!plain && !preboard) odd.push(e);
    }
    const expectLeavers = EXIT_TRACKERS.has(block);
    console.log(`${block}: ${list.length} people | ${[...tally.entries()].map(([k, v]) => `${k}: ${v}`).join(" ; ")}${expectLeavers ? " (exit tracker: leavers expected)" : ""}`);
    if (!expectLeavers && odd.length) {
      flaggedTotal += odd.length;
      console.log(`  NOT plainly active, still listed: ${odd.length} e.g. ${odd.slice(0, 6).map((o) => `${o.employee_code}[${o.active_status}/${o.st}${o.exit_date ? " exit " + o.exit_date : ""}]`).join(", ")}`);
    }
  }
  console.log(`SUMMARY: non-exit blocks listing people who are not plainly active: ${flaggedTotal}`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
