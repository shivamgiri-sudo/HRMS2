import { randomUUID } from 'crypto';
import { db } from '../../db/mysql.js';
import { addPoints } from './gamification.service.js';
import type { RowDataPacket, ResultSetHeader } from 'mysql2/promise';

export type LetterState = 'correct' | 'present' | 'absent';

export interface LetterResult {
  letter: string;
  state: LetterState;
}

export interface GuessResult {
  guess: string;
  result: LetterResult[];
  solved: boolean;
}

export interface PuzzlePublic {
  id: string;
  puzzle_date: string;
  hint: string | null;
  category: string | null;
  difficulty: 'easy' | 'medium' | 'hard';
}

export interface PuzzleAttempt {
  id: string;
  puzzle_id: string;
  employee_id: string;
  guesses: string[]; // up to 6, non-null
  solved: boolean;
  attempts_used: number;
  points_awarded: number;
  completed_at: string | null;
  created_at: string;
}

export interface TodayPuzzleResult {
  puzzle: PuzzlePublic;
  attempt: PuzzleAttempt | null;
  guessResults: GuessResult[]; // evaluated results for all past guesses
  participantCount: number;
  solvedCount: number;
  // Points schedule
  pointsSchedule: Record<number, number>; // attemptNumber -> points
}

export interface SubmitGuessResult {
  guessResult: GuessResult;
  attemptsUsed: number;
  attemptsRemaining: number;
  gameOver: boolean;
  solved: boolean;
  word?: string; // only when game over
  pointsAwarded: number;
  guessResults: GuessResult[]; // all guesses so far
}

interface PuzzleRow extends RowDataPacket {
  id: string;
  puzzle_date: string;
  word: string;
  hint: string | null;
  category: string | null;
  difficulty: 'easy' | 'medium' | 'hard';
  created_at: string;
}

interface AttemptRow extends RowDataPacket {
  id: string;
  puzzle_id: string;
  employee_id: string;
  guess_1: string | null;
  guess_2: string | null;
  guess_3: string | null;
  guess_4: string | null;
  guess_5: string | null;
  guess_6: string | null;
  solved: number;
  attempts_used: number;
  points_awarded: number;
  completed_at: string | null;
  created_at: string;
}

const POINTS_SCHEDULE: Record<number, number> = {
  1: 50, 2: 30, 3: 20, 4: 15, 5: 10, 6: 5,
};
const PARTICIPATION_POINTS = 2;

function evaluateGuess(guess: string, word: string): LetterResult[] {
  const g = guess.toUpperCase().split('');
  const w = word.toUpperCase().split('');
  const result: LetterResult[] = Array(5).fill(null).map(() => ({ letter: '', state: 'absent' as LetterState }));

  // Pass 1: mark correct (green)
  const wordRemaining = [...w];
  for (let i = 0; i < 5; i++) {
    if (g[i] === w[i]) {
      result[i] = { letter: g[i], state: 'correct' };
      wordRemaining[i] = '';
    } else {
      result[i] = { letter: g[i], state: 'absent' };
    }
  }

  // Pass 2: mark present (yellow) from remaining letters
  for (let i = 0; i < 5; i++) {
    if (result[i].state === 'correct') continue;
    const idx = wordRemaining.indexOf(g[i]);
    if (idx !== -1) {
      result[i] = { letter: g[i], state: 'present' };
      wordRemaining[idx] = '';
    }
  }

  return result;
}

function rowToAttempt(row: AttemptRow): PuzzleAttempt {
  const guesses: string[] = [];
  for (const k of ['guess_1', 'guess_2', 'guess_3', 'guess_4', 'guess_5', 'guess_6'] as const) {
    if (row[k]) guesses.push(row[k]!);
  }
  return {
    id: row.id,
    puzzle_id: row.puzzle_id,
    employee_id: row.employee_id,
    guesses,
    solved: !!row.solved,
    attempts_used: row.attempts_used,
    points_awarded: row.points_awarded,
    completed_at: row.completed_at,
    created_at: row.created_at,
  };
}

export async function getTodayPuzzle(employeeId: string): Promise<TodayPuzzleResult | null> {
  const today = new Date().toISOString().split('T')[0];
  const [pRows] = await db.execute<PuzzleRow[]>(
    `SELECT * FROM daily_word_puzzle WHERE puzzle_date = ?`, [today]
  );
  if (pRows.length === 0) return null;
  const puzzle = pRows[0];

  const [aRows] = await db.execute<AttemptRow[]>(
    `SELECT * FROM daily_word_attempt WHERE puzzle_id = ? AND employee_id = ?`,
    [puzzle.id, employeeId]
  );
  const attemptRow = aRows[0] || null;
  const attempt = attemptRow ? rowToAttempt(attemptRow) : null;

  const guessResults: GuessResult[] = (attempt?.guesses ?? []).map(g => ({
    guess: g,
    result: evaluateGuess(g, puzzle.word),
    solved: g.toUpperCase() === puzzle.word.toUpperCase(),
  }));

  const [statsRows] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) as total, SUM(solved) as solved FROM daily_word_attempt WHERE puzzle_id = ?`,
    [puzzle.id]
  );
  const stats = statsRows[0];

  const publicPuzzle: PuzzlePublic = {
    id: puzzle.id,
    puzzle_date: puzzle.puzzle_date,
    hint: puzzle.hint,
    category: puzzle.category,
    difficulty: puzzle.difficulty,
  };

  return {
    puzzle: publicPuzzle,
    attempt,
    guessResults,
    participantCount: Number(stats.total) || 0,
    solvedCount: Number(stats.solved) || 0,
    pointsSchedule: POINTS_SCHEDULE,
  };
}

export async function submitGuess(
  employeeId: string,
  puzzleId: string,
  guess: string
): Promise<SubmitGuessResult> {
  const [pRows] = await db.execute<PuzzleRow[]>(
    `SELECT * FROM daily_word_puzzle WHERE id = ?`, [puzzleId]
  );
  if (pRows.length === 0) throw new Error('Puzzle not found');
  const puzzle = pRows[0];

  if (guess.length !== 5) throw new Error('Guess must be exactly 5 letters');

  // Get or create attempt
  const [aRows] = await db.execute<AttemptRow[]>(
    `SELECT * FROM daily_word_attempt WHERE puzzle_id = ? AND employee_id = ?`,
    [puzzleId, employeeId]
  );

  let attemptRow = aRows[0] || null;

  if (attemptRow?.solved || (attemptRow && attemptRow.attempts_used >= 6)) {
    throw new Error('Game already over');
  }

  const normalizedGuess = guess.toUpperCase();
  const guessResult: GuessResult = {
    guess: normalizedGuess,
    result: evaluateGuess(normalizedGuess, puzzle.word),
    solved: normalizedGuess === puzzle.word.toUpperCase(),
  };

  if (!attemptRow) {
    // Create new attempt row
    const attemptId = randomUUID();
    await db.execute<ResultSetHeader>(
      `INSERT INTO daily_word_attempt (id, puzzle_id, employee_id, guess_1, attempts_used, solved, points_awarded)
       VALUES (?, ?, ?, ?, 1, 0, 0)`,
      [attemptId, puzzleId, employeeId, normalizedGuess]
    );
    const [newRows] = await db.execute<AttemptRow[]>(
      `SELECT * FROM daily_word_attempt WHERE id = ?`, [attemptId]
    );
    attemptRow = newRows[0];
  } else {
    // Update existing attempt
    const nextSlot = attemptRow.attempts_used + 1;
    const col = `guess_${nextSlot}`;
    await db.execute<ResultSetHeader>(
      `UPDATE daily_word_attempt SET ${col} = ?, attempts_used = ? WHERE id = ?`,
      [normalizedGuess, nextSlot, attemptRow.id]
    );
    attemptRow = { ...attemptRow, [col]: normalizedGuess, attempts_used: nextSlot };
  }

  const attemptsUsed = attemptRow.attempts_used;
  const solved = guessResult.solved;
  const gameOver = solved || attemptsUsed >= 6;

  let pointsAwarded = 0;
  if (gameOver) {
    pointsAwarded = solved ? (POINTS_SCHEDULE[attemptsUsed] ?? PARTICIPATION_POINTS) : PARTICIPATION_POINTS;
    await db.execute<ResultSetHeader>(
      `UPDATE daily_word_attempt SET solved = ?, points_awarded = ?, completed_at = NOW() WHERE id = ?`,
      [solved ? 1 : 0, pointsAwarded, attemptRow.id]
    );
    if (pointsAwarded > 0) {
      await addPoints(
        employeeId, pointsAwarded,
        solved ? 'puzzle_solved' : 'puzzle_participate',
        `Word puzzle: ${solved ? `solved in ${attemptsUsed} attempt${attemptsUsed > 1 ? 's' : ''}` : 'participated'}`,
        attemptRow.id
      );
    }
  }

  // Reconstruct all guess results
  const allGuessesRaw: string[] = [];
  for (const k of ['guess_1', 'guess_2', 'guess_3', 'guess_4', 'guess_5', 'guess_6'] as const) {
    if ((attemptRow as any)[k]) allGuessesRaw.push((attemptRow as any)[k]);
  }
  const allGuessResults: GuessResult[] = allGuessesRaw.map(g => ({
    guess: g,
    result: evaluateGuess(g, puzzle.word),
    solved: g.toUpperCase() === puzzle.word.toUpperCase(),
  }));

  return {
    guessResult,
    attemptsUsed,
    attemptsRemaining: Math.max(0, 6 - attemptsUsed),
    gameOver,
    solved,
    word: gameOver ? puzzle.word : undefined,
    pointsAwarded,
    guessResults: allGuessResults,
  };
}

export async function createPuzzle(
  data: {
    puzzle_date: string;
    word: string;
    hint?: string;
    category?: string;
    difficulty?: 'easy' | 'medium' | 'hard';
  },
  createdBy: string
): Promise<PuzzlePublic> {
  if (data.word.length !== 5) throw new Error('Word must be exactly 5 letters');
  const id = randomUUID();
  await db.execute<ResultSetHeader>(
    `INSERT INTO daily_word_puzzle (id, puzzle_date, word, hint, category, difficulty, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, data.puzzle_date, data.word.toUpperCase(), data.hint ?? null, data.category ?? null, data.difficulty ?? 'medium', createdBy]
  );
  const [rows] = await db.execute<PuzzleRow[]>(`SELECT * FROM daily_word_puzzle WHERE id = ?`, [id]);
  const p = rows[0];
  return { id: p.id, puzzle_date: p.puzzle_date, hint: p.hint, category: p.category, difficulty: p.difficulty };
}

export async function getPuzzleBank(
  options: { limit?: number; offset?: number } = {}
): Promise<{ puzzles: PuzzlePublic[]; total: number }> {
  const { limit = 50, offset = 0 } = options;
  const [countRows] = await db.execute<RowDataPacket[]>(`SELECT COUNT(*) as total FROM daily_word_puzzle`);
  const [rows] = await db.execute<PuzzleRow[]>(
    `SELECT id, puzzle_date, hint, category, difficulty, created_at FROM daily_word_puzzle ORDER BY puzzle_date DESC LIMIT ? OFFSET ?`,
    [limit, offset]
  );
  return {
    puzzles: rows.map(p => ({ id: p.id, puzzle_date: p.puzzle_date, hint: p.hint, category: p.category, difficulty: p.difficulty })),
    total: Number(countRows[0].total),
  };
}

export const wordPuzzleService = {
  getTodayPuzzle,
  submitGuess,
  createPuzzle,
  getPuzzleBank,
};
