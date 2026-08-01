import { randomUUID } from 'crypto';
import { db } from '../../db/mysql.js';
import { addPoints } from './gamification.service.js';
import type { RowDataPacket, ResultSetHeader } from 'mysql2/promise';

export type TeaserCategory = 'logic' | 'math' | 'pattern' | 'riddle' | 'lateral';
export type TeaserDifficulty = 'easy' | 'medium' | 'hard';

export interface BrainTeaser {
  id: string;
  teaser_date: string;
  category: TeaserCategory;
  question: string;
  answer: string;
  hint_1: string | null;
  hint_2: string | null;
  explanation: string | null;
  difficulty: TeaserDifficulty;
  points_no_hint: number;
  points_one_hint: number;
  points_two_hints: number;
  created_at: string;
}

export interface BrainTeaserPublic extends Omit<BrainTeaser, 'answer' | 'hint_1' | 'hint_2'> {
  answer?: string; // only after attempt
  hint_1?: string | null;
  hint_2?: string | null;
}

export interface BrainTeaserAttempt {
  id: string;
  teaser_id: string;
  employee_id: string;
  submitted_answer: string | null;
  is_correct: boolean;
  hints_used: number;
  time_taken_secs: number | null;
  points_awarded: number;
  attempted_at: string;
}

export interface TodayTeaserResult {
  teaser: BrainTeaserPublic;
  myAttempt: BrainTeaserAttempt | null;
  participantCount: number;
  solvedCount: number;
}

export interface SubmitAnswerResult {
  correct: boolean;
  answer: string;
  explanation: string | null;
  pointsAwarded: number;
  hintsUsed: number;
}

export interface RevealHintResult {
  hint: string | null;
  hintNumber: 1 | 2;
  hintsUsed: number;
  maxPointsNow: number;
}

interface TeaserRow extends RowDataPacket, BrainTeaser {}
interface AttemptRow extends RowDataPacket, BrainTeaserAttempt {}

// Tracks hints used in current session (in-memory per process, sufficient for single-attempt per day)
// Stored in attempt table hints_used column on first submit
const sessionHints = new Map<string, number>(); // key: `${teaserId}:${employeeId}`

function sessionKey(teaserId: string, employeeId: string) {
  return `${teaserId}:${employeeId}`;
}

export async function getTodayTeaser(employeeId: string): Promise<TodayTeaserResult | null> {
  const today = new Date().toISOString().split('T')[0];

  const [rows] = await db.execute<TeaserRow[]>(
    `SELECT * FROM brain_teaser WHERE teaser_date = ?`, [today]
  );
  if (rows.length === 0) return null;

  const teaser = rows[0];

  const [attemptRows] = await db.execute<AttemptRow[]>(
    `SELECT * FROM brain_teaser_attempt WHERE teaser_id = ? AND employee_id = ?`,
    [teaser.id, employeeId]
  );
  const myAttempt = attemptRows[0] || null;

  const [statsRows] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) as total, SUM(is_correct) as solved FROM brain_teaser_attempt WHERE teaser_id = ?`,
    [teaser.id]
  );
  const stats = statsRows[0];

  const hintsUsed = myAttempt?.hints_used ?? sessionHints.get(sessionKey(teaser.id, employeeId)) ?? 0;

  const publicTeaser: BrainTeaserPublic = {
    ...teaser,
    answer: myAttempt ? teaser.answer : undefined,
    hint_1: hintsUsed >= 1 ? teaser.hint_1 : null,
    hint_2: hintsUsed >= 2 ? teaser.hint_2 : null,
  };

  return {
    teaser: publicTeaser,
    myAttempt,
    participantCount: Number(stats.total) || 0,
    solvedCount: Number(stats.solved) || 0,
  };
}

export async function revealHint(
  employeeId: string,
  teaserId: string,
  hintNumber: 1 | 2
): Promise<RevealHintResult> {
  const [rows] = await db.execute<TeaserRow[]>(`SELECT * FROM brain_teaser WHERE id = ?`, [teaserId]);
  if (rows.length === 0) throw new Error('Teaser not found');
  const teaser = rows[0];

  // Check not already attempted
  const [existing] = await db.execute<AttemptRow[]>(
    `SELECT * FROM brain_teaser_attempt WHERE teaser_id = ? AND employee_id = ?`,
    [teaserId, employeeId]
  );
  if (existing.length > 0) throw new Error('Already submitted — hints locked');

  const key = sessionKey(teaserId, employeeId);
  const currentHints = sessionHints.get(key) ?? 0;
  const newHints = Math.max(currentHints, hintNumber);
  sessionHints.set(key, newHints);

  const hint = hintNumber === 1 ? teaser.hint_1 : teaser.hint_2;
  const maxPointsNow = newHints === 0
    ? teaser.points_no_hint
    : newHints === 1
    ? teaser.points_one_hint
    : teaser.points_two_hints;

  return { hint, hintNumber, hintsUsed: newHints, maxPointsNow };
}

export async function submitAnswer(
  employeeId: string,
  teaserId: string,
  submittedAnswer: string,
  timeTakenSecs?: number
): Promise<SubmitAnswerResult> {
  const [rows] = await db.execute<TeaserRow[]>(`SELECT * FROM brain_teaser WHERE id = ?`, [teaserId]);
  if (rows.length === 0) throw new Error('Teaser not found');
  const teaser = rows[0];

  // Already attempted?
  const [existing] = await db.execute<AttemptRow[]>(
    `SELECT * FROM brain_teaser_attempt WHERE teaser_id = ? AND employee_id = ?`,
    [teaserId, employeeId]
  );
  if (existing.length > 0) {
    return {
      correct: existing[0].is_correct,
      answer: teaser.answer,
      explanation: teaser.explanation,
      pointsAwarded: 0,
      hintsUsed: existing[0].hints_used,
    };
  }

  // Case-insensitive fuzzy match (trim, lowercase)
  const normalize = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  const isCorrect = normalize(submittedAnswer) === normalize(teaser.answer);

  const hintsUsed = sessionHints.get(sessionKey(teaserId, employeeId)) ?? 0;
  sessionHints.delete(sessionKey(teaserId, employeeId));

  const pointsToAward = isCorrect
    ? (hintsUsed === 0 ? teaser.points_no_hint : hintsUsed === 1 ? teaser.points_one_hint : teaser.points_two_hints)
    : 0;

  const attemptId = randomUUID();
  await db.execute<ResultSetHeader>(
    `INSERT INTO brain_teaser_attempt
       (id, teaser_id, employee_id, submitted_answer, is_correct, hints_used, time_taken_secs, points_awarded)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [attemptId, teaserId, employeeId, submittedAnswer, isCorrect ? 1 : 0, hintsUsed, timeTakenSecs ?? null, pointsToAward]
  );

  if (pointsToAward > 0) {
    await addPoints(
      employeeId,
      pointsToAward,
      'teaser_correct',
      `Brain teaser solved${hintsUsed > 0 ? ` (${hintsUsed} hint${hintsUsed > 1 ? 's' : ''} used)` : ''}`,
      attemptId
    );
  }

  return {
    correct: isCorrect,
    answer: teaser.answer,
    explanation: teaser.explanation,
    pointsAwarded: pointsToAward,
    hintsUsed,
  };
}

export async function createTeaser(
  data: {
    teaser_date: string;
    category: TeaserCategory;
    question: string;
    answer: string;
    hint_1?: string;
    hint_2?: string;
    explanation?: string;
    difficulty?: TeaserDifficulty;
    points_no_hint?: number;
    points_one_hint?: number;
    points_two_hints?: number;
  },
  createdBy: string
): Promise<BrainTeaser> {
  const id = randomUUID();
  await db.execute<ResultSetHeader>(
    `INSERT INTO brain_teaser
       (id, teaser_date, category, question, answer, hint_1, hint_2, explanation,
        difficulty, points_no_hint, points_one_hint, points_two_hints, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id, data.teaser_date, data.category, data.question, data.answer,
      data.hint_1 ?? null, data.hint_2 ?? null, data.explanation ?? null,
      data.difficulty ?? 'medium',
      data.points_no_hint ?? 15, data.points_one_hint ?? 10, data.points_two_hints ?? 5,
      createdBy,
    ]
  );
  const [rows] = await db.execute<TeaserRow[]>(`SELECT * FROM brain_teaser WHERE id = ?`, [id]);
  return rows[0];
}

export async function getTeaserBank(
  options: { limit?: number; offset?: number; category?: TeaserCategory } = {}
): Promise<{ teasers: BrainTeaser[]; total: number }> {
  const { limit = 50, offset = 0, category } = options;
  const where = category ? 'WHERE category = ?' : '';
  const params: any[] = category ? [category] : [];

  const [countRows] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) as total FROM brain_teaser ${where}`, params
  );
  const [rows] = await db.execute<TeaserRow[]>(
    `SELECT * FROM brain_teaser ${where} ORDER BY teaser_date DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  return { teasers: rows, total: Number(countRows[0].total) };
}

export const brainTeaserService = {
  getTodayTeaser,
  revealHint,
  submitAnswer,
  createTeaser,
  getTeaserBank,
};
