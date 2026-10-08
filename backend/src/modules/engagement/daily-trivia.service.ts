import { randomUUID } from 'crypto';
import { sqlLimitOffset } from "../../db/pagination.js";
import { db } from '../../db/mysql.js';
import { addPoints } from './gamification.service.js';
import type { RowDataPacket, ResultSetHeader } from 'mysql2/promise';

export type TriviaCategory = 'company' | 'process' | 'industry' | 'general' | 'fun';

export interface TriviaQuestion {
  id: string;
  question_date: string;
  question_text: string;
  category: TriviaCategory;
  option_a: string;
  option_b: string;
  option_c: string | null;
  option_d: string | null;
  correct_option: string;
  explanation: string | null;
  points_correct: number;
  points_participate: number;
  created_at: string;
}

export interface TriviaQuestionPublic extends Omit<TriviaQuestion, 'correct_option'> {
  correct_option?: string; // only exposed after answering
}

export interface TriviaResponse {
  id: string;
  question_id: string;
  employee_id: string;
  selected_option: string;
  is_correct: boolean;
  time_taken_seconds: number | null;
  points_awarded: number;
  answered_at: string;
}

export interface TodayTriviaResult {
  question: TriviaQuestionPublic;
  myResponse: TriviaResponse | null;
  participantCount: number;
  correctCount: number;
}

export interface AnswerResult {
  correct: boolean;
  correctOption: string;
  explanation: string | null;
  pointsAwarded: number;
  rank: number | null;
}

interface QuestionRow extends RowDataPacket, TriviaQuestion {}
interface ResponseRow extends RowDataPacket, TriviaResponse {}

export async function getTodayQuestion(employeeId: string): Promise<TodayTriviaResult | null> {
  const today = new Date().toISOString().split('T')[0];

  const [qRows] = await db.execute<QuestionRow[]>(
    `SELECT * FROM daily_trivia_question WHERE question_date = ?`,
    [today]
  );
  if (qRows.length === 0) return null;

  const question = qRows[0];

  const [rRows] = await db.execute<ResponseRow[]>(
    `SELECT * FROM daily_trivia_response WHERE question_id = ? AND employee_id = ?`,
    [question.id, employeeId]
  );
  const myResponse = rRows[0] || null;

  const [statsRows] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) as total, SUM(is_correct) as correct_count
     FROM daily_trivia_response WHERE question_id = ?`,
    [question.id]
  );
  const stats = statsRows[0];

  // Only expose correct_option if already answered
  const publicQuestion: TriviaQuestionPublic = {
    ...question,
    correct_option: myResponse ? question.correct_option : undefined,
  };

  return {
    question: publicQuestion,
    myResponse,
    participantCount: Number(stats.total) || 0,
    correctCount: Number(stats.correct_count) || 0,
  };
}

export async function submitAnswer(
  employeeId: string,
  questionId: string,
  selectedOption: string,
  timeTakenSeconds?: number
): Promise<AnswerResult> {
  const [qRows] = await db.execute<QuestionRow[]>(
    `SELECT * FROM daily_trivia_question WHERE id = ?`,
    [questionId]
  );
  if (qRows.length === 0) throw new Error('Question not found');

  const question = qRows[0];

  // Check already answered
  const [existing] = await db.execute<ResponseRow[]>(
    `SELECT * FROM daily_trivia_response WHERE question_id = ? AND employee_id = ?`,
    [questionId, employeeId]
  );
  if (existing.length > 0) {
    const prev = existing[0];
    const [rankRow] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) + 1 as \`rank\` FROM daily_trivia_response
       WHERE question_id = ? AND is_correct = 1 AND answered_at < ?`,
      [questionId, prev.answered_at]
    );
    return {
      correct: prev.is_correct,
      correctOption: question.correct_option,
      explanation: question.explanation,
      pointsAwarded: 0,
      rank: prev.is_correct ? Number(rankRow[0].rank) : null,
    };
  }

  const isCorrect = selectedOption.toUpperCase() === question.correct_option.toUpperCase();
  const pointsToAward = isCorrect ? question.points_correct : question.points_participate;
  const responseId = randomUUID();

  await db.execute<ResultSetHeader>(
    `INSERT INTO daily_trivia_response
       (id, question_id, employee_id, selected_option, is_correct, time_taken_seconds, points_awarded, answered_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
    [responseId, questionId, employeeId, selectedOption.toUpperCase(), isCorrect ? 1 : 0, timeTakenSeconds ?? null, pointsToAward]
  );

  await addPoints(
    employeeId,
    pointsToAward,
    isCorrect ? 'trivia_correct' : 'trivia_participate',
    `Daily trivia: ${isCorrect ? 'correct answer' : 'participated'}`,
    responseId
  );

  // Get rank among correct answers
  let rank: number | null = null;
  if (isCorrect) {
    const [rankRow] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) as \`rank\` FROM daily_trivia_response
       WHERE question_id = ? AND is_correct = 1 AND answered_at <= NOW()`,
      [questionId]
    );
    rank = Number(rankRow[0].rank);
  }

  return {
    correct: isCorrect,
    correctOption: question.correct_option,
    explanation: question.explanation,
    pointsAwarded: pointsToAward,
    rank,
  };
}

export async function getTriviaLeaderboard(date?: string): Promise<Array<{
  employee_id: string;
  employee_name: string;
  is_correct: boolean;
  time_taken_seconds: number | null;
  answered_at: string;
}>> {
  const targetDate = date || new Date().toISOString().split('T')[0];
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT r.employee_id, e.full_name as employee_name, r.is_correct, r.time_taken_seconds, r.answered_at
     FROM daily_trivia_response r
     JOIN daily_trivia_question q ON q.id = r.question_id
     JOIN employees e ON e.id = r.employee_id
     WHERE q.question_date = ?
     ORDER BY r.is_correct DESC, r.time_taken_seconds ASC
     LIMIT 20`,
    [targetDate]
  );
  return rows as any[];
}

export async function createQuestion(
  data: {
    question_date: string;
    question_text: string;
    category: TriviaCategory;
    option_a: string;
    option_b: string;
    option_c?: string;
    option_d?: string;
    correct_option: string;
    explanation?: string;
    points_correct?: number;
    points_participate?: number;
  },
  createdBy: string
): Promise<TriviaQuestion> {
  const id = randomUUID();
  await db.execute<ResultSetHeader>(
    `INSERT INTO daily_trivia_question
       (id, question_date, question_text, category, option_a, option_b, option_c, option_d,
        correct_option, explanation, points_correct, points_participate, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id, data.question_date, data.question_text, data.category,
      data.option_a, data.option_b, data.option_c ?? null, data.option_d ?? null,
      data.correct_option.toUpperCase(), data.explanation ?? null,
      data.points_correct ?? 10, data.points_participate ?? 2, createdBy,
    ]
  );
  const [rows] = await db.execute<QuestionRow[]>(`SELECT * FROM daily_trivia_question WHERE id = ?`, [id]);
  return rows[0];
}

export async function getQuestionBank(
  options: { limit?: number; offset?: number; category?: TriviaCategory } = {}
): Promise<{ questions: TriviaQuestion[]; total: number }> {
  const { limit = 50, offset = 0, category } = options;
  const where = category ? 'WHERE category = ?' : '';
  const params: any[] = category ? [category] : [];

  const [countRows] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) as total FROM daily_trivia_question ${where}`, params
  );
  const [rows] = await db.execute<QuestionRow[]>(
    `SELECT * FROM daily_trivia_question ${where} ORDER BY question_date DESC ${sqlLimitOffset(limit, offset)}`,
    params
  );
  return { questions: rows, total: Number(countRows[0].total) };
}

export const dailyTriviaService = {
  getTodayQuestion,
  submitAnswer,
  getTriviaLeaderboard,
  createQuestion,
  getQuestionBank,
};
