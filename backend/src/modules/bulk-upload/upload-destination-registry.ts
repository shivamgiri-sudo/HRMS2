/**
 * Explicit allowlist of upload_type_code -> the db_masmis destination table
 * each type's importer actually inserts into (verified against every
 * *-bulk.service.ts insertPrefix directly, 2026-09-19).
 *
 * DELETE /api/bulk-upload/batches/:id used to only delete upload_batch/
 * upload_batch_row -- the destination table rows an import already wrote
 * were never touched, so a "deleted" upload's raw data stayed in the
 * database forever and kept showing up in every dashboard reading these
 * tables. This registry lets the delete route cascade into the right
 * table, scoped to that one batch's upload_batch_id.
 *
 * Deliberately an allowlist, not a naming convention: any upload_type_code
 * NOT listed here (employee-master, leave-application, clovia/bla-bli-blu/
 * dalmia/du-* families, and the cross-database Bella/Onfido/BVO types) is
 * left exactly as before -- only the batch/log entry is removed, nothing
 * cascades. Only add an entry once the destination table and its
 * upload_batch_id column are confirmed.
 *
 * NEEMANS_MONTH_TARGET_MASMIS and NEEMANS_AGENT_DETAILS_MASMIS are
 * intentionally excluded: their destination tables (neemans_month_targets,
 * nms_Agent_Details) have no upload_batch_id or any other per-batch column
 * at all (confirmed live: "Unknown column 'upload_batch_id'"), so their
 * rows can't be identified for cascade deletion -- the delete route
 * surfaces this as a warning instead of silently leaving rows behind.
 *
 * Every entry below was checked with a live SELECT COUNT(upload_batch_id)
 * against the real table on 2026-09-19. Rows uploaded before batch
 * tracking existed have NULL upload_batch_id (e.g. bb_chat has ~154k) and
 * can never be matched by a delete -- only rows from tracked uploads can.
 *
 * GNC_SALE_MASMIS's importer does an ON DUPLICATE KEY UPDATE upsert that
 * re-points upload_batch_id to whichever batch most recently touched a
 * row, so "delete every row whose upload_batch_id is this batch" answers
 * "what does this batch currently own", not "what did this batch ever
 * insert" -- the best available semantic given the table's own design.
 */
export interface UploadDestination {
  table: string;
  batchIdColumn: string;
  /** Further tables the same upload type has written to over time (same
   * batch column), cleaned up on delete too -- e.g. Bellavita Chat moved
   * from bb_chat to new_bb_chat, and batches from both eras must delete. */
  alsoTables?: string[];
}

export const UPLOAD_DESTINATION_REGISTRY: Record<string, UploadDestination> = {
  AW_BILLING_MASMIS: { table: "db_masmis.aw_billing", batchIdColumn: "upload_batch_id" },
  AW_INBOUND_MASMIS: { table: "db_masmis.aw_inbound", batchIdColumn: "upload_batch_id" },
  AW_MANDATE_MASMIS: { table: "db_masmis.aw_mandate", batchIdColumn: "upload_batch_id" },
  AW_NEW_CDR_MASMIS: { table: "db_masmis.aw_new_cdr", batchIdColumn: "upload_batch_id" },
  AW_OUT_MASMIS: { table: "db_masmis.aw_out", batchIdColumn: "upload_batch_id" },

  BB_APR_MASMIS: { table: "db_masmis.bb_apr", batchIdColumn: "upload_batch_id" },
  BB_CART_MASMIS: { table: "db_masmis.bb_cart", batchIdColumn: "upload_batch_id" },
  BB_CHAT_MASMIS: { table: "db_masmis.new_bb_chat", batchIdColumn: "upload_batch_id", alsoTables: ["db_masmis.bb_chat"] },
  BB_SALE_MASMIS: { table: "db_masmis.bb_sale", batchIdColumn: "upload_batch_id" },

  BIRLANU_APR_MASMIS: { table: "db_masmis.birlanu_apr", batchIdColumn: "upload_batch_id" },
  BIRLANU_SALE_MASMIS: { table: "db_masmis.birlanu_sale", batchIdColumn: "upload_batch_id" },

  CL_APR_MASMIS: { table: "db_masmis.cl_apr", batchIdColumn: "upload_batch_id" },
  CL_CHAT_MASMIS: { table: "db_masmis.cl_chat", batchIdColumn: "upload_batch_id" },
  CL_DISPO_MASMIS: { table: "db_masmis.cl_dispo", batchIdColumn: "upload_batch_id" },
  CL_EMAIL_RAW_MASMIS: { table: "db_masmis.cl_email_raw", batchIdColumn: "upload_batch_id" },
  CL_FEEDBACK_MASMIS: { table: "db_masmis.cl_feedback", batchIdColumn: "upload_batch_id" },
  CL_IB_CDR_MASMIS: { table: "db_masmis.cl_ib_cdr", batchIdColumn: "upload_batch_id" },
  CL_OUTBOUND_MASMIS: { table: "db_masmis.cl_outbound", batchIdColumn: "upload_batch_id" },
  CL_QUALITY_MASMIS: { table: "db_masmis.cl_quality", batchIdColumn: "upload_batch_id" },
  CL_RECHURN_CALL_MASMIS: { table: "db_masmis.cl_rechurn_call", batchIdColumn: "upload_batch_id" },

  GNC_ALLOCATION_MASMIS: { table: "db_masmis.gnc_allocation", batchIdColumn: "upload_batch_id" },
  GNC_APR: { table: "db_masmis.gnc_apr", batchIdColumn: "upload_batch_id" },
  GNC_CHAT_MASMIS: { table: "db_masmis.gnc_chat", batchIdColumn: "upload_batch_id" },
  // See file header: upsert reassigns upload_batch_id on re-upload.
  GNC_SALE_MASMIS: { table: "db_masmis.gnc_sale", batchIdColumn: "upload_batch_id" },

  LP_FEEDBACK_APR_MASMIS: { table: "db_masmis.lp_feedback_apr", batchIdColumn: "upload_batch_id" },
  LP_FEEDBACK_CDR_MASMIS: { table: "db_masmis.lp_feedback_cdr", batchIdColumn: "upload_batch_id" },
  LP_ONBOARDING_APR_MASMIS: { table: "db_masmis.lp_onboarding_apr", batchIdColumn: "upload_batch_id" },
  LP_ONBOARDING_CDR_MASMIS: { table: "db_masmis.lp_onboarding_cdr", batchIdColumn: "upload_batch_id" },

  // NEEMANS_AGENT_DETAILS_MASMIS intentionally omitted -- see file header.
  NEEMANS_ALLOCATION_MASMIS: { table: "db_masmis.neemans_allocation", batchIdColumn: "upload_batch_id" },
  NEEMANS_APR_MASMIS: { table: "db_masmis.neemans_apr", batchIdColumn: "upload_batch_id" },
  NEEMANS_CART_MASMIS: { table: "db_masmis.neemans_cart", batchIdColumn: "upload_batch_id" },
  NEEMANS_CHAT_MASMIS: { table: "db_masmis.neemans_chat", batchIdColumn: "upload_batch_id" },
  NEEMANS_SALE_RAW_MASMIS: { table: "db_masmis.neemans_sale_raw", batchIdColumn: "upload_batch_id" },
  // NEEMANS_MONTH_TARGET_MASMIS intentionally omitted -- see file header.

  OWNER_AGENT_DETAILS_MASMIS: { table: "db_masmis.owner_agent_details", batchIdColumn: "upload_batch_id" },
  OWNER_CDR_MASMIS: { table: "db_masmis.Owner_cdr", batchIdColumn: "upload_batch_id" },
  OWNER_SALE_MASMIS: { table: "db_masmis.owner_sale", batchIdColumn: "upload_batch_id" },

  PRE_AGENT_DETAILS_MASMIS: { table: "db_masmis.pre_agent_details", batchIdColumn: "upload_batch_id" },
  PRE_CDR_MASMIS: { table: "db_masmis.Pre_cdr", batchIdColumn: "upload_batch_id" },
  PRE_SALE_MASMIS: { table: "db_masmis.pre_sale", batchIdColumn: "upload_batch_id" },

  SATYA_ALLOCATION_MASMIS: { table: "db_masmis.satya_allocation", batchIdColumn: "upload_batch_id" },
  SATYA_CDR_MASMIS: { table: "db_masmis.satya_cdr", batchIdColumn: "upload_batch_id" },
};

/** Upload types deliberately left out of the registry with a reason, so the
 *  delete route can tell the caller why raw rows weren't cleaned up instead
 *  of silently doing nothing. */
export const UPLOAD_DESTINATION_KNOWN_GAPS: Record<string, string> = {
  NEEMANS_MONTH_TARGET_MASMIS:
    "Month-target rows don't carry an upload_batch_id (or any per-batch column), so they can't be traced back to this specific upload and were not removed.",
  NEEMANS_AGENT_DETAILS_MASMIS:
    "Agent-details rows don't carry an upload_batch_id (or any per-batch column), so they can't be traced back to this specific upload and were not removed.",
};
