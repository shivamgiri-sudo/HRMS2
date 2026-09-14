import { CronExpressionParser } from "cron-parser";

export const DEFAULT_INTEGRATION_CRON = "0 * * * *";

export function nextCronRun(
  expression: string,
  currentDate = new Date(),
  timezone = "Asia/Kolkata",
): Date {
  return CronExpressionParser.parse(expression, {
    currentDate,
    tz: timezone,
  }).next().toDate();
}

export function validateCronExpression(
  expression: string,
  timezone = "Asia/Kolkata",
): string | null {
  try {
    nextCronRun(expression, new Date(), timezone);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : "Invalid cron expression";
  }
}
