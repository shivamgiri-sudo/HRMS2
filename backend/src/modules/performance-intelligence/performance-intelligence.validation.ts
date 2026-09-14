import { z } from "zod";
import type { PerformanceQuery } from "./performance-intelligence.contracts.js";

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

function isCalendarDate(value: string): boolean {
  if (!ISO_DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;
}

const dateSchema = z.string()
  .regex(ISO_DATE_PATTERN, "Date must use YYYY-MM-DD")
  .refine(isCalendarDate, "Date must be a valid calendar date");

const optionalId = z.preprocess((value) => {
  if (value === null || value === undefined) return undefined;
  const trimmed = String(value).trim();
  return trimmed || undefined;
}, z.string().max(100).optional());

const performanceQuerySchema = z.object({
  from: dateSchema,
  to: dateSchema,
  branchId: optionalId,
  processId: optionalId,
  employeeId: optionalId,
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().default(25).transform((value) => Math.min(value, 100)),
}).superRefine((query, context) => {
  const from = Date.parse(`${query.from}T00:00:00.000Z`);
  const to = Date.parse(`${query.to}T00:00:00.000Z`);

  if (from > to) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["from"],
      message: "from must be on or before to",
    });
    return;
  }

  const inclusiveDays = Math.floor((to - from) / DAY_MS) + 1;
  if (inclusiveDays > 93) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["to"],
      message: "Date range cannot exceed 93 days",
    });
  }
});

export function parsePerformanceQuery(input: unknown): PerformanceQuery {
  return performanceQuerySchema.parse(input);
}
