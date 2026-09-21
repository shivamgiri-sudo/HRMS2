// Escalation for missing weekly roster uploads (see roster-upload-tracker.logic.ts for the ladder).
//
// Recipients get a Work Inbox item. Each (branch, process, week, stage, recipient) is claimed in
// wfm_roster_upload_alert before the item is created, so a re-run or a second worker cannot send
// twice. While migration 1834 is not applied every claim fails, so nothing is delivered (and nothing can repeat).
import type { ResultSetHeader } from 'mysql2';
import { randomUUID } from 'crypto';
import { db } from '../../db/mysql.js';
import { logger } from '../../logger.js';
import {
  addDays,
  currentWeekStart,
  planEscalations,
  STAGE_RECIPIENTS,
  type EscalationStage,
  type RecipientKind,
} from './roster-upload-tracker.logic.js';
import {
  getCellDetail,
  loadGrid,
  loadSentStages,
  loadSkipLevel,
  type PersonRef,
  type TrackerProcessRow,
} from './roster-upload-tracker.service.js';

const INBOX_TYPE = 'roster_upload';
const INBOX_ENTITY = 'roster_upload';

export type SweepStage = EscalationStage | 'manual';

export interface SweepAction {
  branchName: string;
  processName: string;
  weekStart: string;
  stage: EscalationStage;
  recipients: { name: string; role: RecipientKind }[];
  /** True when the stage owed someone but nobody could be resolved for it. */
  unroutable: boolean;
}

export interface SweepResult {
  dryRun: boolean;
  weeks: string[];
  actions: SweepAction[];
  delivered: number;
  skippedAlreadySent: number;
}

const STAGE_TITLE: Record<SweepStage, (p: string, b: string, w: string) => string> = {
  reminder: (p, b, w) => `Roster for W/C ${w} not uploaded yet — ${p}, ${b}`,
  heads_up: (p, b, w) => `Roster for W/C ${w} due today by 18:00 — ${p}, ${b}`,
  missing: (p, b, w) => `Roster MISSING for W/C ${w} — ${p}, ${b}`,
  escalated: (p, b, w) => `Roster still missing, week has started — ${p}, ${b} (W/C ${w})`,
  late_upload: (p, b, w) => `Roster uploaded late for W/C ${w} — ${p}, ${b}`,
  manual: (p, b, w) => `Reminder: upload the roster for W/C ${w} — ${p}, ${b}`,
};

const STAGE_PRIORITY: Record<SweepStage, 'normal' | 'high' | 'urgent'> = {
  reminder: 'normal',
  heads_up: 'high',
  missing: 'urgent',
  escalated: 'urgent',
  late_upload: 'normal',
  manual: 'high',
};

const actionUrl = (branchId: string, processId: string, weekStart: string): string =>
  `/wfm/roster-import?tab=tracker&branchId=${branchId}&processId=${processId}&week=${weekStart}`;

interface Target {
  user: PersonRef;
  role: RecipientKind;
}

async function resolveTargets(row: TrackerProcessRow, wfm: PersonRef[], kinds: readonly RecipientKind[]): Promise<Target[]> {
  const targets: Target[] = [];
  const seen = new Set<string>();
  const add = (people: PersonRef[], role: RecipientKind) => {
    for (const person of people) {
      if (!person.userId || seen.has(person.userId)) continue;
      seen.add(person.userId);
      targets.push({ user: person, role });
    }
  };
  if (kinds.includes('wfm')) add(wfm, 'wfm');
  if (kinds.includes('manager')) add(row.managers, 'manager');
  if (kinds.includes('skip_level')) add(await loadSkipLevel(row.branchId, row.managers), 'skip_level');
  return targets;
}

/** Claims the alert row; false when this recipient already got this stage. */
async function claim(row: TrackerProcessRow, weekStart: string, stage: SweepStage, target: Target): Promise<boolean> {
  const params = [randomUUID(), row.branchId, row.processId, weekStart, stage, target.user.userId, target.role];
  const columns = `(id, branch_id, process_id, week_start, stage, recipient_user_id, recipient_role, sent_at)`;
  if (stage === 'manual') {
    // Manual reminders may repeat: refresh the timestamp instead of blocking.
    await db.execute(
      `INSERT INTO wfm_roster_upload_alert ${columns} VALUES (?, ?, ?, ?, ?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE sent_at = NOW()`,
      params,
    );
    return true;
  }
  // INSERT IGNORE reports 0 affected rows for a duplicate whatever the client's row-count flags.
  const [res] = await db.execute<ResultSetHeader>(
    `INSERT IGNORE INTO wfm_roster_upload_alert ${columns} VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
    params,
  );
  return res.affectedRows === 1;
}

async function deliver(row: TrackerProcessRow, weekStart: string, stage: SweepStage, target: Target): Promise<void> {
  const { inboxService } = await import('../inbox/inbox.service.js');
  await inboxService.createItem({
    user_id: target.user.userId as string,
    type: INBOX_TYPE,
    title: STAGE_TITLE[stage](row.processName, row.branchName, weekStart),
    description:
      `Weekly rosters are due by Sunday 18:00 for the week starting Monday ${weekStart}. ` +
      `Open the Roster Upload Tracker to see which employees are still missing.`,
    entity_type: INBOX_ENTITY,
    entity_id: row.processId,
    action_url: actionUrl(row.branchId, row.processId, weekStart),
    priority: STAGE_PRIORITY[stage],
  });
}

async function sendToTargets(
  row: TrackerProcessRow,
  weekStart: string,
  stage: SweepStage,
  targets: Target[],
): Promise<number> {
  let delivered = 0;
  for (const target of targets) {
    try {
      if (!(await claim(row, weekStart, stage, target))) continue;
      await deliver(row, weekStart, stage, target);
      delivered += 1;
    } catch (err) {
      logger.warn(
        { err: (err as Error).message, branchId: row.branchId, processId: row.processId, weekStart, stage },
        '[roster-upload-escalation] delivery failed',
      );
    }
  }
  return delivered;
}

export interface SweepOptions {
  nowMs?: number;
  /** Plan only: resolve who would be told, send nothing. */
  dryRun?: boolean;
}

/** Current and next week are the only weeks with live deadlines. */
export async function runRosterUploadEscalation(options: SweepOptions = {}): Promise<SweepResult> {
  const nowMs = options.nowMs ?? Date.now();
  const dryRun = options.dryRun ?? false;
  const thisWeek = currentWeekStart(nowMs);
  const weeks = [thisWeek, addDays(thisWeek, 7)];

  const sent = await loadSentStages(weeks);
  const { rows, directory } = await loadGrid(weeks, nowMs);
  const index = new Map<string, { row: TrackerProcessRow; weekStart: string }>();
  const candidates = rows.flatMap((row) =>
    row.cells.map((cell) => {
      const key = `${row.branchId}|${row.processId}|${cell.weekStart}`;
      index.set(key, { row, weekStart: cell.weekStart });
      return { key, weekStart: cell.weekStart, status: cell.status, sentStages: sent.get(key) ?? new Set<EscalationStage>() };
    }),
  );

  const result: SweepResult = { dryRun, weeks, actions: [], delivered: 0, skippedAlreadySent: 0 };
  for (const action of planEscalations(candidates, nowMs)) {
    const entry = index.get(action.key);
    if (!entry) continue;
    const targets = await resolveTargets(entry.row, directory.wfmByBranch.get(entry.row.branchId) ?? [], STAGE_RECIPIENTS[action.stage]);
    result.actions.push({
      branchName: entry.row.branchName,
      processName: entry.row.processName,
      weekStart: entry.weekStart,
      stage: action.stage,
      recipients: targets.map((t) => ({ name: t.user.name, role: t.role })),
      unroutable: targets.length === 0,
    });
    if (targets.length === 0) {
      logger.warn(
        { branch: entry.row.branchName, process: entry.row.processName, week: entry.weekStart, stage: action.stage },
        '[roster-upload-escalation] nobody to notify — map a branch WFM user / process manager',
      );
      continue;
    }
    if (!dryRun) result.delivered += await sendToTargets(entry.row, entry.weekStart, action.stage, targets);
  }
  return result;
}

export class ReminderError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

/** "Send reminder now" from the drawer: branch WFM and process manager, on demand. */
export async function sendManualReminder(
  branchId: string,
  processId: string,
  weekStart: string,
  nowMs = Date.now(),
): Promise<{ notified: string[] }> {
  const detail = await getCellDetail(branchId, processId, weekStart, nowMs);
  if (!detail) throw new ReminderError(404, 'That process has no active employees in this branch.');
  if (detail.cell.status === 'uploaded' || detail.cell.status === 'delayed') {
    throw new ReminderError(409, 'The roster for this week is already fully uploaded.');
  }
  const row: TrackerProcessRow = {
    branchId,
    branchName: detail.branchName,
    processId,
    processName: detail.processName,
    managers: detail.managers,
    cells: [detail.cell],
  };
  const targets = await resolveTargets(row, detail.wfm, ['wfm', 'manager']);
  if (targets.length === 0) {
    throw new ReminderError(422, 'No branch WFM user or process manager is mapped for this process, so nobody can be notified.');
  }
  const delivered = await sendToTargets(row, weekStart, 'manual', targets);
  if (delivered === 0) {
    // Every claim/delivery failed — most likely migration 1834 (the alert table) is not applied yet.
    throw new ReminderError(503, 'Reminders are not enabled yet: the alert log table (migration 1834) is missing or delivery failed.');
  }
  return { notified: targets.map((t) => t.user.name) };
}
