import { LIVE_FROM_DEFAULT, liveFillSql, metaOriginSql } from "../he-source-attribution.js";

/** The statement with the shared source rule's keyed subqueries folded away (they are tested in sourceAttribution.test.ts), so scan / key
 *  checks look at the statement's own tables. */
export const stripRule = (sql: string, liveFrom = LIVE_FROM_DEFAULT, lead = "al"): string =>
  sql.replaceAll(metaOriginSql(lead), "<origin>").replaceAll(liveFillSql(lead, liveFrom), "<live>");
