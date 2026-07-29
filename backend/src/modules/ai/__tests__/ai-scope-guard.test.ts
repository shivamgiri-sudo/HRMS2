import { describe, expect, it } from 'vitest';
import { detectMiraIntent } from '../ai-account.service.js';

/**
 * The cross-employee guard is a privacy control, so both directions matter: it
 * must refuse every attempt to read someone else's record, and it must not
 * refuse an employee asking about their own.
 */

describe('cross-employee guard refuses other people', () => {
  it.each([
    'attendance of Rahul',
    'salary for Priya',
    'attendance for employee MAS123',
    'leave for him',
    'payslip of another employee',
    'salary of someone else',
    'profile for Shivam',
    'documents for that guy',
    'payslip for the other employee',
    'salary for the employee Rahul',
    'attendance for a colleague',
    'leave for another person',
    'documents for the team member',
    'salary for each employee',
    'attendance for every staff',
    "show me his salary",
    'which employees were absent',
  ])('refuses %s', (question) => {
    expect(detectMiraIntent(question)).toBe('scope_violation');
  });
});

describe('cross-employee guard leaves self questions alone', () => {
  // A time qualifier after of/for must never be mistaken for another person.
  it.each([
    'show my attendance for today',
    'attendance for this month',
    'leave for tomorrow',
    'attendance for last 30 days',
    'my salary for June',
    'payslip for March 2026',
    'leave for the current quarter',
    'leave for the month',
    'attendance for Q2',
  ])('does not refuse %s', (question) => {
    expect(detectMiraIntent(question)).not.toBe('scope_violation');
  });

  // The ones the intent table actually claims should still route to their handler.
  it.each([
    ['show my attendance for today', 'attendance'],
    ['attendance for this month', 'attendance'],
    ['attendance for last 30 days', 'attendance'],
    ['my salary for June', 'salary'],
    ['payslip for March 2026', 'salary'],
    ['attendance for Q2', 'attendance'],
  ])('routes %s to the %s handler', (question, intent) => {
    expect(detectMiraIntent(question)).toBe(intent);
  });
});
