import { LIVE_FROM_DEFAULT, fillTypeSql, liveFirstFillSql, metaDriveSql, metaOriginSql } from "../he-source-attribution.js";

/** The statement with the shared source rule's keyed subqueries folded away (they are tested in sourceAttribution.test.ts), so scan / key
 *  checks look at the statement's own tables. */
export const stripRule = (sql: string, liveFrom = LIVE_FROM_DEFAULT): string => {
  let out = sql.replaceAll(fillTypeSql("r", liveFrom), "<fill type>");
  for (const [lead, first] of [["al", "alf"], ["hl", "hlf"], ["pl", "plf"]]) out = out.replaceAll(liveFirstFillSql(lead, first, liveFrom), "<live>");
  for (const d of ["d", "qd"]) out = out.replaceAll(metaDriveSql(d), "<meta drive>");
  out = out.replaceAll(metaOriginSql("hl", "qf.meta_lead_id IS NOT NULL"), "<origin>");
  for (const l of ["al", "hl", "pl"]) out = out.replaceAll(metaOriginSql(l), "<origin>");
  return out;
};
