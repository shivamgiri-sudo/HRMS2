import { randomUUID } from 'crypto';
import { sqlLimitOffset } from "../../db/pagination.js";
import { db } from '../../db/mysql.js';
import { addPoints } from './gamification.service.js';
import type { RowDataPacket, ResultSetHeader } from 'mysql2/promise';

export type PollType = 'fun' | 'feedback' | 'decision';
export type PollStatus = 'pending' | 'active' | 'closed';

export interface QuickPoll {
  id: string;
  question: string;
  poll_type: PollType;
  option_1: string;
  option_2: string;
  option_3: string | null;
  option_4: string | null;
  created_by: string | null;
  approved_by: string | null;
  status: PollStatus;
  start_date: string | null;
  end_date: string | null;
  total_votes: number;
  created_at: string;
}

export interface PollWithResults extends QuickPoll {
  myVote: number | null;
  results: { option: number; text: string; count: number; percent: number }[];
}

interface PollRow extends RowDataPacket, QuickPoll {}

interface VoteRow extends RowDataPacket {
  id: string;
  poll_id: string;
  employee_id: string;
  selected_option: number;
  points_awarded: number;
  voted_at: string;
}

interface VoteCountRow extends RowDataPacket {
  selected_option: number;
  count: number;
}

function getOptions(poll: QuickPoll): { option: number; text: string }[] {
  const opts: { option: number; text: string }[] = [
    { option: 1, text: poll.option_1 },
    { option: 2, text: poll.option_2 },
  ];
  if (poll.option_3) opts.push({ option: 3, text: poll.option_3 });
  if (poll.option_4) opts.push({ option: 4, text: poll.option_4 });
  return opts;
}

async function enrichWithResults(poll: QuickPoll, employeeId: string): Promise<PollWithResults> {
  const [voteRows] = await db.execute<VoteRow[]>(
    `SELECT * FROM quick_poll_vote WHERE poll_id = ? AND employee_id = ?`,
    [poll.id, employeeId]
  );
  const myVote = voteRows[0]?.selected_option ?? null;

  const [countRows] = await db.execute<VoteCountRow[]>(
    `SELECT selected_option, COUNT(*) as count FROM quick_poll_vote WHERE poll_id = ? GROUP BY selected_option`,
    [poll.id]
  );
  const countMap: Record<number, number> = {};
  for (const row of countRows) countMap[row.selected_option] = Number(row.count);

  const total = poll.total_votes || Object.values(countMap).reduce((a, b) => a + b, 0);
  const results = getOptions(poll).map(o => ({
    option: o.option,
    text: o.text,
    count: countMap[o.option] ?? 0,
    percent: total > 0 ? Math.round(((countMap[o.option] ?? 0) / total) * 100) : 0,
  }));

  return { ...poll, myVote, results };
}

export async function getActivePolls(employeeId: string): Promise<PollWithResults[]> {
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const [rows] = await db.execute<PollRow[]>(
    `SELECT * FROM quick_poll
     WHERE status = 'active'
       AND (start_date IS NULL OR start_date <= ?)
       AND (end_date IS NULL OR end_date >= ?)
     ORDER BY created_at DESC
     LIMIT 10`,
    [now, now]
  );
  return Promise.all(rows.map(poll => enrichWithResults(poll, employeeId)));
}

export async function getPollById(pollId: string, employeeId: string): Promise<PollWithResults | null> {
  const [rows] = await db.execute<PollRow[]>(`SELECT * FROM quick_poll WHERE id = ?`, [pollId]);
  if (rows.length === 0) return null;
  return enrichWithResults(rows[0], employeeId);
}

export async function vote(
  employeeId: string,
  pollId: string,
  selectedOption: number
): Promise<{ alreadyVoted: boolean; pointsAwarded: number; poll: PollWithResults }> {
  const [pRows] = await db.execute<PollRow[]>(`SELECT * FROM quick_poll WHERE id = ?`, [pollId]);
  if (pRows.length === 0) throw new Error('Poll not found');
  const poll = pRows[0];

  if (poll.status !== 'active') throw new Error('Poll is not active');

  const opts = getOptions(poll);
  if (!opts.find(o => o.option === selectedOption)) throw new Error('Invalid option');

  const [existing] = await db.execute<VoteRow[]>(
    `SELECT * FROM quick_poll_vote WHERE poll_id = ? AND employee_id = ?`,
    [pollId, employeeId]
  );
  if (existing.length > 0) {
    const enriched = await enrichWithResults(poll, employeeId);
    return { alreadyVoted: true, pointsAwarded: 0, poll: enriched };
  }

  const voteId = randomUUID();
  const pts = 2;
  await db.execute<ResultSetHeader>(
    `INSERT INTO quick_poll_vote (id, poll_id, employee_id, selected_option, points_awarded) VALUES (?, ?, ?, ?, ?)`,
    [voteId, pollId, employeeId, selectedOption, pts]
  );
  await db.execute<ResultSetHeader>(
    `UPDATE quick_poll SET total_votes = total_votes + 1 WHERE id = ?`, [pollId]
  );
  await addPoints(employeeId, pts, 'poll_voted', `Voted on poll: ${poll.question}`, voteId);

  const [refreshed] = await db.execute<PollRow[]>(`SELECT * FROM quick_poll WHERE id = ?`, [pollId]);
  const enriched = await enrichWithResults(refreshed[0], employeeId);
  return { alreadyVoted: false, pointsAwarded: pts, poll: enriched };
}

export async function createPoll(
  data: {
    question: string;
    poll_type?: PollType;
    option_1: string;
    option_2: string;
    option_3?: string;
    option_4?: string;
    start_date?: string;
    end_date?: string;
    auto_approve?: boolean;
  },
  createdBy: string
): Promise<QuickPoll> {
  const id = randomUUID();
  const status = data.auto_approve ? 'active' : 'pending';
  await db.execute<ResultSetHeader>(
    `INSERT INTO quick_poll (id, question, poll_type, option_1, option_2, option_3, option_4,
       created_by, approved_by, status, start_date, end_date)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id, data.question, data.poll_type ?? 'fun',
      data.option_1, data.option_2, data.option_3 ?? null, data.option_4 ?? null,
      createdBy, data.auto_approve ? createdBy : null, status,
      data.start_date ?? null, data.end_date ?? null,
    ]
  );
  const [rows] = await db.execute<PollRow[]>(`SELECT * FROM quick_poll WHERE id = ?`, [id]);
  return rows[0];
}

export async function approvePoll(pollId: string, approvedBy: string): Promise<QuickPoll> {
  await db.execute<ResultSetHeader>(
    `UPDATE quick_poll SET status = 'active', approved_by = ? WHERE id = ?`,
    [approvedBy, pollId]
  );
  const [rows] = await db.execute<PollRow[]>(`SELECT * FROM quick_poll WHERE id = ?`, [pollId]);
  return rows[0];
}

export async function closePoll(pollId: string): Promise<QuickPoll> {
  await db.execute<ResultSetHeader>(`UPDATE quick_poll SET status = 'closed' WHERE id = ?`, [pollId]);
  const [rows] = await db.execute<PollRow[]>(`SELECT * FROM quick_poll WHERE id = ?`, [pollId]);
  return rows[0];
}

export async function getAllPolls(
  options: { status?: PollStatus; limit?: number; offset?: number } = {}
): Promise<{ polls: QuickPoll[]; total: number }> {
  const { status, limit = 20, offset = 0 } = options;
  const where = status ? 'WHERE status = ?' : '';
  const params: any[] = status ? [status] : [];
  const [countRows] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) as total FROM quick_poll ${where}`, params
  );
  const [rows] = await db.execute<PollRow[]>(
    `SELECT * FROM quick_poll ${where} ORDER BY created_at DESC ${sqlLimitOffset(limit, offset)}`,
    params
  );
  return { polls: rows, total: Number(countRows[0].total) };
}

export const quickPollService = {
  getActivePolls,
  getPollById,
  vote,
  createPoll,
  approvePoll,
  closePoll,
  getAllPolls,
};
