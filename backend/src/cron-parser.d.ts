declare module "cron-parser" {
  export class CronExpressionParser {
    static parse(
      expression: string,
      options?: { currentDate?: Date; tz?: string }
    ): { next(): { toDate(): Date } };
  }
}
