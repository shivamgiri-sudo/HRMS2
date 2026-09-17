/**
 * Bulk import dispatcher — shared by the HTTP route (enqueueing) and the
 * bulk-import worker (executing). Extracted here so both sides import the
 * same code without a circular dependency.
 */

export async function assertGatedUploader(rpc_name: string, userId: string): Promise<void> {
  const gated = new Set([
    "import_attendance_regularization_batch",
    "import_leave_application_batch",
    "import_incentive_bulk_batch",
    "import_deduction_bulk_batch",
  ]);
  if (!gated.has(rpc_name)) return;
  const { hasAnyRole } = await import("../../shared/scopeAccess.js");
  const { UPLOADER_ROLES } = await import("./bulk-approval.service.js");
  if (!(await hasAnyRole(userId, ...UPLOADER_ROLES))) {
    throw Object.assign(
      new Error("Only a Super Admin or branch WFM can upload leave, regularization, incentive or deduction batches."),
      { statusCode: 403 },
    );
  }
}

export async function assertDepartmentStructureUploader(rpc_name: string, userId: string): Promise<void> {
  if (rpc_name !== "import_department_upload_batch") return;
  const { hasAnyRole } = await import("../../shared/scopeAccess.js");
  if (!(await hasAnyRole(userId, "super_admin"))) {
    throw Object.assign(
      new Error("Only a Super Admin can create or rename departments, including by upload."),
      { statusCode: 403 },
    );
  }
}

export async function dispatchImport(
  rpc_name: string,
  id: string,
  userId: string,
): Promise<Record<string, unknown>> {
  await assertGatedUploader(rpc_name, userId);
  await assertDepartmentStructureUploader(rpc_name, userId);

  if (rpc_name === "import_attendance_regularization_batch") {
    const { importRegularizationBatch } = await import("./attendance-regularization-bulk.service.js");
    const data = await importRegularizationBatch(id, userId);
    return { success: true, requires_approval: true, data };
  }

  if (rpc_name === "import_leave_application_batch") {
    const { importLeaveBatch } = await import("./leave-application-bulk.service.js");
    const data = await importLeaveBatch(id, userId);
    return { success: true, requires_approval: true, data };
  }

  if (rpc_name === "import_incentive_bulk_batch") {
    const { importIncentiveBatch } = await import("./incentive-bulk.service.js");
    const data = await importIncentiveBatch(id, userId);
    return { success: true, requires_approval: true, data };
  }

  if (rpc_name === "import_deduction_bulk_batch") {
    const { importDeductionBatch } = await import("./deduction-bulk.service.js");
    const data = await importDeductionBatch(id, userId);
    return { success: true, requires_approval: true, data };
  }

  if (rpc_name === "import_official_email_update_batch") {
    const { importOfficialEmailBatch } = await import("../it-provisioning/it-provisioning.bulk.service.js");
    const data = await importOfficialEmailBatch(id, userId);
    return { success: true, data };
  }

  if (rpc_name === "import_pf_uan_batch") {
    const { importPfUanBatch } = await import("./pf-uan-bulk.service.js");
    const data = await importPfUanBatch(id, userId);
    return { success: true, data };
  }

  if (rpc_name === "import_reporting_manager_update_batch") {
    const { importReportingManagerBatch } = await import("./reporting-manager-bulk.service.js");
    const data = await importReportingManagerBatch(id, userId);
    return { success: true, data };
  }

  if (rpc_name === "import_roster_assignment_batch") {
    const { importRosterAssignmentBatch } = await import("./roster-assignment-bulk.service.js");
    const data = await importRosterAssignmentBatch(id, userId);
    return { success: true, data };
  }

  if (rpc_name === "import_weekoff_preference_batch") {
    const { importWeekOffPreferenceBatch } = await import("./weekoff-preference-bulk.service.js");
    const data = await importWeekOffPreferenceBatch(id, userId);
    return { success: true, data };
  }

  if (rpc_name === "import_shift_rotation_type_batch") {
    const { importShiftRotationTypeBatch } = await import("./shift-rotation-type-bulk.service.js");
    const data = await importShiftRotationTypeBatch(id, userId);
    return { success: true, data };
  }

  if (rpc_name === "import_shift_roster_batch") {
    const { importShiftRosterBatch } = await import("./shift-roster-bulk.service.js");
    const data = await importShiftRosterBatch(id, userId);
    return { success: true, data };
  }

  if (rpc_name === "import_upload_batch") {
    const { importEmployeeMasterBatch } = await import("./employee-master-bulk.service.js");
    const data = await importEmployeeMasterBatch(id, userId);
    return { success: true, data };
  }

  if (rpc_name === "import_process_upload_batch") {
    const { importProcessMasterBatch } = await import("./process-master-bulk.service.js");
    const data = await importProcessMasterBatch(id, userId);
    return { success: true, data };
  }

  if (rpc_name === "import_department_upload_batch") {
    const { importDepartmentMasterBatch } = await import("./department-master-bulk.service.js");
    const data = await importDepartmentMasterBatch(id, userId);
    return { success: true, data };
  }

  if (rpc_name === "import_asset_upload_batch") {
    const { importAssetMasterBatch } = await import("./asset-master-bulk.service.js");
    const data = await importAssetMasterBatch(id, userId);
    return { success: true, data };
  }

  if (rpc_name === "import_branch_upload_batch") {
    const { importBranchMasterBatch } = await import("./branch-master-bulk.service.js");
    const data = await importBranchMasterBatch(id, userId);
    return { success: true, data };
  }

  if (rpc_name === "import_lob_upload_batch") {
    const { importLobMasterBatch } = await import("./lob-master-bulk.service.js");
    const data = await importLobMasterBatch(id, userId);
    return { success: true, data };
  }

  if (rpc_name === "import_designation_upload_batch") {
    const { importDesignationMasterBatch } = await import("./designation-master-bulk.service.js");
    const data = await importDesignationMasterBatch(id, userId);
    return { success: true, data };
  }

  if (rpc_name.startsWith("import_onfido_")) {
    const { importOnfidoRawBatch, findOnfidoConfig } = await import("./onfido-raw-bulk.service.js");
    const config = findOnfidoConfig(rpc_name);
    if (!config) {
      throw new Error(`No Onfido report config registered for rpc_name '${rpc_name}'.`);
    }
    const data = await importOnfidoRawBatch(config, id, userId);
    return { success: true, data };
  }

  if (rpc_name === "import_email_ticket_daily_batch") {
    const { importEmailTicketDailyBatch } = await import("./email-ticket-daily-bulk.service.js");
    const data = await importEmailTicketDailyBatch(id, userId);
    return { success: true, data };
  }

  if (rpc_name === "import_lp_apr_daily_batch") {
    const { importLpAprDailyBatch } = await import("./lp-apr-daily-bulk.service.js");
    const data = await importLpAprDailyBatch(id, userId);
    return { success: true, data };
  }

  if (rpc_name === "import_clovia_crm_disposition_batch") {
    const { importCloviaCrmDispositionBatch } = await import("./clovia-crm-disposition-bulk.service.js");
    const data = await importCloviaCrmDispositionBatch(id, userId);
    return { success: true, data };
  }

  if (rpc_name === "import_clovia_feedback_batch") {
    const { importCloviaFeedbackBatch } = await import("./clovia-feedback-bulk.service.js");
    const data = await importCloviaFeedbackBatch(id, userId);
    return { success: true, data };
  }

  if (rpc_name === "import_housing_premium_sale_raw_batch") {
    const { importHousingPremiumSaleRawBatch } = await import("./housing-premium-sale-raw-bulk.service.js");
    const data = await importHousingPremiumSaleRawBatch(id, userId);
    return { success: true, data };
  }

  if (rpc_name === "import_lp_leads_regional_batch") {
    const { importLpLeadsRegionalBatch } = await import("./lp-leads-bulk.service.js");
    const data = await importLpLeadsRegionalBatch(id, userId);
    return { success: true, data };
  }

  if (rpc_name === "import_lp_leads_non_regional_batch") {
    const { importLpLeadsNonRegionalBatch } = await import("./lp-leads-bulk.service.js");
    const data = await importLpLeadsNonRegionalBatch(id, userId);
    return { success: true, data };
  }

  if (rpc_name === "import_gnc_apr_batch") {
    const { importGncAprMasmisBatch } = await import("./gnc-apr-masmis-bulk.service.js");
    const data = await importGncAprMasmisBatch(id, userId);
    return { success: true, data };
  }

  if (rpc_name === "import_lp_cr_report_regional_batch") {
    const { importLpCrReportRegionalBatch } = await import("./lp-cdr-cr-report-bulk.service.js");
    const data = await importLpCrReportRegionalBatch(id, userId);
    return { success: true, data };
  }

  if (rpc_name === "import_lp_cr_report_non_regional_batch") {
    const { importLpCrReportNonRegionalBatch } = await import("./lp-cdr-cr-report-bulk.service.js");
    const data = await importLpCrReportNonRegionalBatch(id, userId);
    return { success: true, data };
  }

  if (rpc_name === "import_housing_premium_agent_target_batch") {
    const { importHousingPremiumAgentTargetBatch } = await import("./housing-premium-agent-target-bulk.service.js");
    const data = await importHousingPremiumAgentTargetBatch(id, userId);
    return { success: true, data };
  }

  if (rpc_name === "import_housing_owner_incentive_batch") {
    const { importHousingOwnerIncentiveBatch } = await import("./housing-owner-incentive-bulk.service.js");
    const data = await importHousingOwnerIncentiveBatch(id, userId);
    return { success: true, data };
  }

  if (rpc_name === "import_housing_owner_lead_pipeline_batch") {
    const { importHousingOwnerLeadPipelineBatch } = await import("./housing-owner-lead-pipeline-bulk.service.js");
    const data = await importHousingOwnerLeadPipelineBatch(id, userId);
    return { success: true, data };
  }

  if (rpc_name === "import_bla_bli_blu_dd_tagging_batch") {
    const { importBlaBliBluDdTaggingBatch } = await import("./bla-bli-blu-dd-tagging-bulk.service.js");
    const data = await importBlaBliBluDdTaggingBatch(id, userId);
    return { success: true, data };
  }

  if (rpc_name === "import_gnc_sale_masmis_batch") {
    const { importGncSaleMasmisBatch } = await import("./gnc-sale-masmis-bulk.service.js");
    const data = await importGncSaleMasmisBatch(id, userId);
    return { success: true, data };
  }

  if (rpc_name === "import_reginald_abandoned_cart_sales_batch") {
    const { importReginaldAbandonedCartSalesBatch } = await import("./reginald-abandoned-cart-sales-bulk.service.js");
    const data = await importReginaldAbandonedCartSalesBatch(id, userId);
    return { success: true, data };
  }

  if (rpc_name === "import_bla_bli_blu_auto_callback_batch") {
    const { importBlaBliBluAutoCallbackBatch } = await import("./bla-bli-blu-auto-callback-bulk.service.js");
    const data = await importBlaBliBluAutoCallbackBatch(id, userId);
    return { success: true, data };
  }

  if (rpc_name === "import_bla_bli_blu_after_hour_batch") {
    const { importBlaBliBluAfterHourBatch } = await import("./bla-bli-blu-after-hour-bulk.service.js");
    const data = await importBlaBliBluAfterHourBatch(id, userId);
    return { success: true, data };
  }

  if (rpc_name === "import_bla_bli_blu_call_disposition_batch") {
    const { importBlaBliBluCallDispositionBatch } = await import("./bla-bli-blu-call-disposition-bulk.service.js");
    const data = await importBlaBliBluCallDispositionBatch(id, userId);
    return { success: true, data };
  }

  if (rpc_name === "import_bla_bli_blu_shopify_sales_batch") {
    const { importBlaBliBluShopifySalesBatch } = await import("./bla-bli-blu-shopify-sales-bulk.service.js");
    const data = await importBlaBliBluShopifySalesBatch(id, userId);
    return { success: true, data };
  }

  if (rpc_name === "import_bb_sale_masmis_batch") {
    const { importBbSaleMasmisBatch } = await import("./bb-sale-masmis-bulk.service.js");
    const data = await importBbSaleMasmisBatch(id, userId);
    return { success: true, data };
  }

  if (rpc_name === "import_bb_apr_masmis_batch") {
    const { importBbAprMasmisBatch } = await import("./bb-apr-masmis-bulk.service.js");
    const data = await importBbAprMasmisBatch(id, userId);
    return { success: true, data };
  }

  if (rpc_name === "import_bb_cart_masmis_batch") {
    const { importBbCartMasmisBatch } = await import("./bb-cart-masmis-bulk.service.js");
    const data = await importBbCartMasmisBatch(id, userId);
    return { success: true, data };
  }

  if (rpc_name === "import_bb_chat_masmis_batch") {
    const { importBbChatMasmisBatch } = await import("./bb-chat-masmis-bulk.service.js");
    const data = await importBbChatMasmisBatch(id, userId);
    return { success: true, data };
  }

  if (rpc_name === "import_process_manual_kpi_batch") {
    const { importProcessManualKpiBatch } = await import("./process-manual-kpi-bulk.service.js");
    const data = await importProcessManualKpiBatch(id, userId);
    return { success: true, data };
  }

  if (rpc_name === "import_bla_bli_blu_overall_sales_batch") {
    const { importBlaBliBluOverallSalesBatch } = await import("./bla-bli-blu-overall-sales-bulk.service.js");
    const data = await importBlaBliBluOverallSalesBatch(id, userId);
    return { success: true, data };
  }

  if (rpc_name === "import_clovia_team_alignment_batch") {
    const { importCloviaTeamAlignmentBatch } = await import("./clovia-team-alignment-bulk.service.js");
    const data = await importCloviaTeamAlignmentBatch(id, userId);
    return { success: true, data };
  }

  if (rpc_name === "import_dalmia_after_hour_batch") {
    const { importDalmiaAfterHourBatch } = await import("./dalmia-after-hour-bulk.service.js");
    const data = await importDalmiaAfterHourBatch(id, userId);
    return { success: true, data };
  }

  if (rpc_name === "import_dalmia_dd_batch") {
    const { importDalmiaDdBatch } = await import("./dalmia-dd-bulk.service.js");
    const data = await importDalmiaDdBatch(id, userId);
    return { success: true, data };
  }

  if (rpc_name === "import_dalmia_outbound_batch") {
    const { importDalmiaOutboundBatch } = await import("./dalmia-outbound-bulk.service.js");
    const data = await importDalmiaOutboundBatch(id, userId);
    return { success: true, data };
  }

  if (rpc_name === "import_domestic_billing_approved_hc_batch") {
    const { importDomesticBillingApprovedHcBatch } = await import("./domestic-billing-approved-hc-bulk.service.js");
    const data = await importDomesticBillingApprovedHcBatch(id, userId);
    return { success: true, data };
  }

  if (rpc_name === "import_gs1_email_daily_batch") {
    const { importGs1EmailDailyBatch } = await import("./gs1-email-daily-bulk.service.js");
    const data = await importGs1EmailDailyBatch(id, userId);
    return { success: true, data };
  }

  if (rpc_name === "import_gs1_datakart_daily_batch") {
    const { importGs1DatakartDailyBatch } = await import("./gs1-datakart-daily-bulk.service.js");
    const data = await importGs1DatakartDailyBatch(id, userId);
    return { success: true, data };
  }

  if (rpc_name === "import_gs1_approval_audit_batch") {
    const { importGs1ApprovalAuditBatch } = await import("./gs1-approval-audit-bulk.service.js");
    const data = await importGs1ApprovalAuditBatch(id, userId);
    return { success: true, data };
  }

  if (rpc_name.startsWith("import_bella_")) {
    const { importBellaRawBatch, findBellaConfig } = await import("./bella-raw-bulk.service.js");
    const config = findBellaConfig(rpc_name);
    if (!config) {
      throw new Error(`No Bella Vita report config registered for rpc_name '${rpc_name}'.`);
    }
    const data = await importBellaRawBatch(config, id, userId);
    return { success: true, data };
  }

  // Housing Owner, Pre, Clovia raw-format, Birlanu, Satya, LP Feedback/Onboarding and GNC Chat --
  // all built and wired into KNOWN_IMPORT_RPCS below, but never wired into this dispatcher, so
  // every one of these 24 types 501'd on Process Performance V2 despite having a real,
  // already-tested importer sitting right here unreachable.
  if (rpc_name === "import_owner_sale_batch") {
    const { importOwnerSaleBatch } = await import("./owner-sale-bulk.service.js");
    const data = await importOwnerSaleBatch(id, userId);
    return { success: true, data };
  }

  if (rpc_name === "import_owner_cdr_batch") {
    const { importOwnerCdrBatch } = await import("./owner-cdr-bulk.service.js");
    const data = await importOwnerCdrBatch(id, userId);
    return { success: true, data };
  }

  if (rpc_name === "import_owner_agent_details_batch") {
    const { importOwnerAgentDetailsBatch } = await import("./owner-agent-details-bulk.service.js");
    const data = await importOwnerAgentDetailsBatch(id, userId);
    return { success: true, data };
  }

  if (rpc_name === "import_pre_sale_batch") {
    const { importPreSaleBatch } = await import("./pre-sale-bulk.service.js");
    const data = await importPreSaleBatch(id, userId);
    return { success: true, data };
  }

  if (rpc_name === "import_pre_cdr_batch") {
    const { importPreCdrBatch } = await import("./pre-cdr-bulk.service.js");
    const data = await importPreCdrBatch(id, userId);
    return { success: true, data };
  }

  if (rpc_name === "import_pre_agent_details_batch") {
    const { importPreAgentDetailsBatch } = await import("./pre-agent-details-bulk.service.js");
    const data = await importPreAgentDetailsBatch(id, userId);
    return { success: true, data };
  }

  if (rpc_name === "import_cl_apr_batch") {
    const { importClAprBatch } = await import("./cl-apr-bulk.service.js");
    const data = await importClAprBatch(id, userId);
    return { success: true, data };
  }

  if (rpc_name === "import_cl_chat_batch") {
    const { importClChatBatch } = await import("./cl-chat-bulk.service.js");
    const data = await importClChatBatch(id, userId);
    return { success: true, data };
  }

  if (rpc_name === "import_cl_dispo_batch") {
    const { importClDispoBatch } = await import("./cl-dispo-bulk.service.js");
    const data = await importClDispoBatch(id, userId);
    return { success: true, data };
  }

  if (rpc_name === "import_cl_email_raw_batch") {
    const { importClEmailRawBatch } = await import("./cl-email-raw-bulk.service.js");
    const data = await importClEmailRawBatch(id, userId);
    return { success: true, data };
  }

  if (rpc_name === "import_cl_feedback_batch") {
    const { importClFeedbackBatch } = await import("./cl-feedback-bulk.service.js");
    const data = await importClFeedbackBatch(id, userId);
    return { success: true, data };
  }

  if (rpc_name === "import_cl_ib_cdr_batch") {
    const { importClIbCdrBatch } = await import("./cl-ib-cdr-bulk.service.js");
    const data = await importClIbCdrBatch(id, userId);
    return { success: true, data };
  }

  if (rpc_name === "import_cl_outbound_batch") {
    const { importClOutboundBatch } = await import("./cl-outbound-bulk.service.js");
    const data = await importClOutboundBatch(id, userId);
    return { success: true, data };
  }

  if (rpc_name === "import_cl_quality_batch") {
    const { importClQualityBatch } = await import("./cl-quality-bulk.service.js");
    const data = await importClQualityBatch(id, userId);
    return { success: true, data };
  }

  if (rpc_name === "import_cl_rechurn_call_batch") {
    const { importClRechurnCallBatch } = await import("./cl-rechurn-call-bulk.service.js");
    const data = await importClRechurnCallBatch(id, userId);
    return { success: true, data };
  }

  if (rpc_name === "import_birlanu_sale_batch") {
    const { importBirlanuSaleBatch } = await import("./birlanu-sale-bulk.service.js");
    const data = await importBirlanuSaleBatch(id, userId);
    return { success: true, data };
  }

  if (rpc_name === "import_birlanu_apr_batch") {
    const { importBirlanuAprBatch } = await import("./birlanu-apr-bulk.service.js");
    const data = await importBirlanuAprBatch(id, userId);
    return { success: true, data };
  }

  if (rpc_name === "import_satya_allocation_batch") {
    const { importSatyaAllocationBatch } = await import("./satya-allocation-bulk.service.js");
    const data = await importSatyaAllocationBatch(id, userId);
    return { success: true, data };
  }

  if (rpc_name === "import_satya_cdr_batch") {
    const { importSatyaCdrBatch } = await import("./satya-cdr-bulk.service.js");
    const data = await importSatyaCdrBatch(id, userId);
    return { success: true, data };
  }

  if (rpc_name === "import_lp_feedback_apr_batch") {
    const { importLpFeedbackAprBatch } = await import("./lp-feedback-apr-bulk.service.js");
    const data = await importLpFeedbackAprBatch(id, userId);
    return { success: true, data };
  }

  if (rpc_name === "import_lp_feedback_cdr_batch") {
    const { importLpFeedbackCdrBatch } = await import("./lp-feedback-cdr-bulk.service.js");
    const data = await importLpFeedbackCdrBatch(id, userId);
    return { success: true, data };
  }

  if (rpc_name === "import_lp_onboarding_apr_batch") {
    const { importLpOnboardingAprBatch } = await import("./lp-onboarding-apr-bulk.service.js");
    const data = await importLpOnboardingAprBatch(id, userId);
    return { success: true, data };
  }

  if (rpc_name === "import_lp_onboarding_cdr_batch") {
    const { importLpOnboardingCdrBatch } = await import("./lp-onboarding-cdr-bulk.service.js");
    const data = await importLpOnboardingCdrBatch(id, userId);
    return { success: true, data };
  }

  if (rpc_name === "import_gnc_chat_batch") {
    const { importGncChatBatch } = await import("./gnc-chat-bulk.service.js");
    const data = await importGncChatBatch(id, userId);
    return { success: true, data };
  }

  throw new Error(`Import function '${rpc_name}' for batch ${id} is not yet implemented in the MySQL backend.`);
}
