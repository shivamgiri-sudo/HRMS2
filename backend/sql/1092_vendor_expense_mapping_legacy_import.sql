-- 1092_vendor_expense_mapping_legacy_import.sql
-- Imports the vendor -> Head/Sub-head mappings Finance already maintains in I-Spark, so
-- Requirement 2 works on day one instead of asking them to re-key 1,700+ rows by hand.
--
-- Source: db_bill.vendor_expense_relation (1,885 rows, 1,191 distinct vendors), resolved
-- through tbl_vendormaster / tbl_bgt_expenseheadingmaster / tbl_bgt_expensesubheadingmaster.
--
-- WHY A STATIC SEED RATHER THAN A CROSS-DATABASE QUERY
-- db_bill is a separate MySQL 5.5 server. A migration running inside mas_hrms cannot reach
-- it, so the resolved triples are baked in as literals.
--
-- WHY CODES, NOT IDS OR NAMES
-- finance_expense_head_master.id is UUID() generated at migration-run time and therefore
-- differs in every environment; a hardcoded id would import garbage. Names drift with edits.
-- head_code and sub_head_code are stable, and vendor_code is UNIQUE on vendor_master, so the
-- INSERT resolves to whatever ids this environment happens to hold.
--
-- COVERAGE: 1273 of 1730 distinct legacy triples resolve (73.6%).
-- The 457 that do not are listed at the foot of this file rather than silently
-- dropped. They are overwhelmingly legacy's year-versioned capex sub-heads
-- (COMPUTERS-2022-23 COST, Computers 26-27 COST): I-Spark mints a new sub-head every
-- financial year for computers, which HRMS2 deliberately does not model. Importing those
-- would import the pattern with them. Finance can add any they still want through the
-- Vendor Master Expense Mapping tab.
--
-- Rows land with created_by 'LEGACY_IMPORT' so an imported mapping stays distinguishable
-- from one a person made. Idempotent: uq_vendor_expense_mapping makes a re-run a no-op, and
-- the INNER JOINs mean a vendor or head absent from this environment is skipped rather than
-- failing the migration.

INSERT INTO vendor_expense_mapping
  (id, vendor_id, head_id, head_code, sub_head_id, sub_head_code, active_status, created_by, created_at)
SELECT UUID(), v.id, h.id, h.head_code, s.id, s.sub_head_code, 1, 'LEGACY_IMPORT', NOW()
  FROM (
  SELECT 'DB_BILL_580' AS vendor_code, 'SECURITY_SERVICE' AS head_code, 'SECURITY_SERVICE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_662' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'COMPANY_DATA' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_663' AS vendor_code, 'HIRING_CHARGES' AS head_code, 'COMPUTER_HIRE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_664' AS vendor_code, 'PRINTING_STATIONERY' AS head_code, 'OFFICE_STATIONERY' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_664' AS vendor_code, 'PRINTING_STATIONERY' AS head_code, 'PHOTOCOPY' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_664' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'POSTAGE_COURIER' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_664' AS vendor_code, 'OFFICE_MAINTENANCE' AS head_code, 'CAFETERIA_MAINTENANCE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_664' AS vendor_code, 'OFFICE_MAINTENANCE' AS head_code, 'CLEANING_MATERIAL' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_664' AS vendor_code, 'STAFF_WELFARE' AS head_code, 'REFRESHMENT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_664' AS vendor_code, 'STAFF_WELFARE' AS head_code, 'DRINKING_WATER' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1332' AS vendor_code, 'ELECTRICITY' AS head_code, 'ELECTRICITY_GOVT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_666' AS vendor_code, 'OFFICE_RENT' AS head_code, 'OFFICE_RENT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_647' AS vendor_code, 'STAFF_WELFARE' AS head_code, 'FESTIVAL_EXPENSE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_523' AS vendor_code, 'HIRING_CHARGES' AS head_code, 'COMPUTER_HIRE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_173' AS vendor_code, 'PRINTING_STATIONERY' AS head_code, 'OFFICE_STATIONERY' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_173' AS vendor_code, 'PRINTING_STATIONERY' AS head_code, 'PHOTOCOPY' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_173' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'POSTAGE_COURIER' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_173' AS vendor_code, 'OFFICE_MAINTENANCE' AS head_code, 'CAFETERIA_MAINTENANCE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_173' AS vendor_code, 'OFFICE_MAINTENANCE' AS head_code, 'CLEANING_MATERIAL' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_173' AS vendor_code, 'STAFF_WELFARE' AS head_code, 'REFRESHMENT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_173' AS vendor_code, 'STAFF_WELFARE' AS head_code, 'DRINKING_WATER' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_322' AS vendor_code, 'OFFICE_RENT' AS head_code, 'OFFICE_RENT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_648' AS vendor_code, 'STAFF_WELFARE' AS head_code, 'FESTIVAL_EXPENSE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_78' AS vendor_code, 'PRINTING_STATIONERY' AS head_code, 'OFFICE_STATIONERY' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_78' AS vendor_code, 'PRINTING_STATIONERY' AS head_code, 'PHOTOCOPY' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_78' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'POSTAGE_COURIER' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_673' AS vendor_code, 'OFFICE_RENT' AS head_code, 'OFFICE_RENT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_674' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'COMPUTER_PERIPHERALS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_675' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'COMPANY_VOICE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_281' AS vendor_code, 'PRINTING_STATIONERY' AS head_code, 'OFFICE_STATIONERY' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_281' AS vendor_code, 'PRINTING_STATIONERY' AS head_code, 'PHOTOCOPY' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_281' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'POSTAGE_COURIER' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_281' AS vendor_code, 'OFFICE_MAINTENANCE' AS head_code, 'CAFETERIA_MAINTENANCE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_281' AS vendor_code, 'OFFICE_MAINTENANCE' AS head_code, 'CLEANING_MATERIAL' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_281' AS vendor_code, 'STAFF_WELFARE' AS head_code, 'REFRESHMENT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_281' AS vendor_code, 'STAFF_WELFARE' AS head_code, 'DRINKING_WATER' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_76' AS vendor_code, 'STAFF_WELFARE' AS head_code, 'DRINKING_WATER' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_679' AS vendor_code, 'OFFICE_RENT' AS head_code, 'OFFICE_RENT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_680' AS vendor_code, 'STAFF_WELFARE' AS head_code, 'REFRESHMENT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_600' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'COMPUTER_PERIPHERALS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_541' AS vendor_code, 'STAFF_TRAINING_RECRUITMENT' AS head_code, 'RECRUITMENT_ADVERTISEMENT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_643' AS vendor_code, 'STAFF_TRAINING_RECRUITMENT' AS head_code, 'RECRUITMENT_ADVERTISEMENT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_684' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'OFFICE_REPAIRS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_686' AS vendor_code, 'CONTRACT_FEES_FACILITIES' AS head_code, 'FACILITY_STAFF' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_543' AS vendor_code, 'STAFF_TRAINING_RECRUITMENT' AS head_code, 'RECRUITMENT_ADVERTISEMENT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_688' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'COMPANY_VOICE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_388' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'COMPANY_DATA' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_691' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'COMPANY_DATA' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_692' AS vendor_code, 'TOURS_TRAVELLING_CONVEYANCE' AS head_code, 'PARKING_CHARGES' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_38' AS vendor_code, 'OFFICE_MAINTENANCE' AS head_code, 'CLEANING_MATERIAL' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_694' AS vendor_code, 'HIRING_CHARGES' AS head_code, 'GENERATOR_HIRE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_695' AS vendor_code, 'ELECTRICITY' AS head_code, 'ELECTRICITY_GOVT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_19' AS vendor_code, 'STAFF_WELFARE' AS head_code, 'DRINKING_WATER' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_529' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'COMPUTER_PERIPHERALS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_139' AS vendor_code, 'HIRING_CHARGES' AS head_code, 'AC_HIRE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_611' AS vendor_code, 'PRINTING_STATIONERY' AS head_code, 'OFFICE_STATIONERY' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_29' AS vendor_code, 'OFFICE_MAINTENANCE' AS head_code, 'WATER_TANKER' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_212' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'COMPANY_DATA' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_702' AS vendor_code, 'ELECTRICITY' AS head_code, 'GENERATOR_DIESEL' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_203' AS vendor_code, 'OFFICE_RENT' AS head_code, 'OFFICE_RENT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_704' AS vendor_code, 'OFFICE_MAINTENANCE' AS head_code, 'CAFETERIA_MAINTENANCE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_616' AS vendor_code, 'SECURITY_SERVICE' AS head_code, 'SECURITY_SERVICE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_147' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'COMPUTER_PERIPHERALS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_709' AS vendor_code, 'TOURS_TRAVELLING_CONVEYANCE' AS head_code, 'LOCAL_CONVEYANCE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_64' AS vendor_code, 'OFFICE_MAINTENANCE' AS head_code, 'CAFETERIA_MAINTENANCE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_64' AS vendor_code, 'ELECTRICITY' AS head_code, 'ELECTRICITY_GOVT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_319' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'POSTAGE_COURIER' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_654' AS vendor_code, 'PRINTING_STATIONERY' AS head_code, 'OFFICE_STATIONERY' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_516' AS vendor_code, 'LEGAL_CONSULTANCY' AS head_code, 'LEGAL_PROFESSIONAL' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_612' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'COMPUTER_PERIPHERALS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_718' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'COMPANY_DATA' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_720' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'COMPANY_VOICE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_539' AS vendor_code, 'OFFICE_RENT' AS head_code, 'OFFICE_RENT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_539' AS vendor_code, 'OFFICE_MAINTENANCE' AS head_code, 'CAFETERIA_MAINTENANCE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_539' AS vendor_code, 'ELECTRICITY' AS head_code, 'GENERATOR_DIESEL' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_539' AS vendor_code, 'ELECTRICITY' AS head_code, 'ELECTRICITY_GOVT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_530' AS vendor_code, 'SECURITY_SERVICE' AS head_code, 'SECURITY_SERVICE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_725' AS vendor_code, 'HIRING_CHARGES' AS head_code, 'UPS_HIRE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_691' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'COMPANY_VOICE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_726' AS vendor_code, 'OFFICE_RENT' AS head_code, 'OFFICE_RENT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_727' AS vendor_code, 'STAFF_WELFARE' AS head_code, 'DRINKING_WATER' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1115' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'COMPANY_VOICE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_720' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'COMPANY_DATA' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_728' AS vendor_code, 'ELECTRICITY' AS head_code, 'ELECTRICITY_GOVT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_655' AS vendor_code, 'STAFF_TRAINING_RECRUITMENT' AS head_code, 'RECRUITMENT_ADVERTISEMENT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_196' AS vendor_code, 'SECURITY_SERVICE' AS head_code, 'SECURITY_SERVICE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_454' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'POSTAGE_COURIER' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_732' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'COMPANY_VOICE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_202' AS vendor_code, 'HIRING_CHARGES' AS head_code, 'GENERATOR_HIRE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_735' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'COMPANY_VOICE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_372' AS vendor_code, 'HIRING_CHARGES' AS head_code, 'GENERATOR_HIRE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_737' AS vendor_code, 'ELECTRICITY' AS head_code, 'ELECTRICITY_GOVT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_738' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'ELECTRICAL_REPAIRS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_567' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'COMPANY_DATA' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_740' AS vendor_code, 'SECURITY_SERVICE' AS head_code, 'SECURITY_SERVICE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1115' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'COMPANY_DATA' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_741' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'POSTAGE_COURIER' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_742' AS vendor_code, 'STAFF_TRAINING_RECRUITMENT' AS head_code, 'RECRUITMENT_ADVERTISEMENT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_743' AS vendor_code, 'OFFICE_MAINTENANCE' AS head_code, 'CAFETERIA_MAINTENANCE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_743' AS vendor_code, 'OFFICE_MAINTENANCE' AS head_code, 'CLEANING_MATERIAL' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_743' AS vendor_code, 'PRINTING_STATIONERY' AS head_code, 'OFFICE_STATIONERY' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_743' AS vendor_code, 'PRINTING_STATIONERY' AS head_code, 'PHOTOCOPY' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_744' AS vendor_code, 'OFFICE_RENT' AS head_code, 'OFFICE_RENT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_651' AS vendor_code, 'STAFF_WELFARE' AS head_code, 'FESTIVAL_EXPENSE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_746' AS vendor_code, 'ELECTRICITY' AS head_code, 'GENERATOR_DIESEL' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_747' AS vendor_code, 'OFFICE_MAINTENANCE' AS head_code, 'CAFETERIA_MAINTENANCE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_67' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'ELECTRICAL_REPAIRS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_649' AS vendor_code, 'STAFF_WELFARE' AS head_code, 'FESTIVAL_EXPENSE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_750' AS vendor_code, 'HIRING_CHARGES' AS head_code, 'COMPUTER_HIRE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_751' AS vendor_code, 'PRINTING_STATIONERY' AS head_code, 'OFFICE_STATIONERY' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_631' AS vendor_code, 'ELECTRICITY' AS head_code, 'GENERATOR_DIESEL' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_632' AS vendor_code, 'STAFF_WELFARE' AS head_code, 'DRINKING_WATER' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_630' AS vendor_code, 'OFFICE_MAINTENANCE' AS head_code, 'CAFETERIA_MAINTENANCE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_592' AS vendor_code, 'OFFICE_RENT' AS head_code, 'OFFICE_RENT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_574' AS vendor_code, 'PRINTING_STATIONERY' AS head_code, 'OFFICE_STATIONERY' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_575' AS vendor_code, 'STAFF_WELFARE' AS head_code, 'REFRESHMENT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_569' AS vendor_code, 'PRINTING_STATIONERY' AS head_code, 'OFFICE_STATIONERY' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_759' AS vendor_code, 'ELECTRICITY' AS head_code, 'ELECTRICITY_GOVT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_591' AS vendor_code, 'OFFICE_RENT' AS head_code, 'OFFICE_RENT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_576' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'POSTAGE_COURIER' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_762' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'COMPANY_DATA' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_603' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'COMPUTER_PERIPHERALS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_590' AS vendor_code, 'OFFICE_RENT' AS head_code, 'OFFICE_RENT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_68' AS vendor_code, 'STAFF_WELFARE' AS head_code, 'REFRESHMENT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1120' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'COMPANY_VOICE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_766' AS vendor_code, 'HIRING_CHARGES' AS head_code, 'GENERATOR_HIRE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_767' AS vendor_code, 'SECURITY_SERVICE' AS head_code, 'SECURITY_SERVICE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_768' AS vendor_code, 'ELECTRICITY' AS head_code, 'ELECTRICITY_GOVT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_20' AS vendor_code, 'PRINTING_STATIONERY' AS head_code, 'OFFICE_STATIONERY' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_770' AS vendor_code, 'STAFF_WELFARE' AS head_code, 'DRINKING_WATER' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_273' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'COMPUTER_PERIPHERALS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_61' AS vendor_code, 'ELECTRICITY' AS head_code, 'GENERATOR_DIESEL' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_773' AS vendor_code, 'OFFICE_RENT' AS head_code, 'OFFICE_RENT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_263' AS vendor_code, 'HIRING_CHARGES' AS head_code, 'GENERATOR_HIRE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_268' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'ELECTRICAL_REPAIRS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_776' AS vendor_code, 'ELECTRICITY' AS head_code, 'ELECTRICITY_GOVT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_777' AS vendor_code, 'OFFICE_RENT' AS head_code, 'OFFICE_RENT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_560' AS vendor_code, 'HIRING_CHARGES' AS head_code, 'UPS_HIRE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_779' AS vendor_code, 'OFFICE_RENT' AS head_code, 'OFFICE_RENT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_383' AS vendor_code, 'HIRING_CHARGES' AS head_code, 'AC_HIRE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1120' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'COMPANY_DATA' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_266' AS vendor_code, 'STAFF_WELFARE' AS head_code, 'DRINKING_WATER' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1119' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'COMPANY_VOICE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_782' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'POSTAGE_COURIER' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1119' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'COMPANY_DATA' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_783' AS vendor_code, 'OFFICE_RENT' AS head_code, 'OFFICE_RENT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_146' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'SMS_CHARGES' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_653' AS vendor_code, 'ELECTRICITY' AS head_code, 'GENERATOR_DIESEL' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_619' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'COMPUTER_PERIPHERALS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1118' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'COMPANY_VOICE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_646' AS vendor_code, 'STAFF_WELFARE' AS head_code, 'FESTIVAL_EXPENSE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_408' AS vendor_code, 'STAFF_WELFARE' AS head_code, 'REFRESHMENT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_554' AS vendor_code, 'OFFICE_RENT' AS head_code, 'OFFICE_RENT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_558' AS vendor_code, 'CONTRACT_FEES_FACILITIES' AS head_code, 'FACILITY_STAFF' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_796' AS vendor_code, 'ELECTRICITY' AS head_code, 'ELECTRICITY_GOVT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_613' AS vendor_code, 'HIRING_CHARGES' AS head_code, 'GENERATOR_HIRE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_594' AS vendor_code, 'STAFF_WELFARE' AS head_code, 'DRINKING_WATER' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_457' AS vendor_code, 'PRINTING_STATIONERY' AS head_code, 'OFFICE_STATIONERY' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_706' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'COMPUTER_PERIPHERALS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_735' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'COMPANY_DATA' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1118' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'COMPANY_DATA' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_801' AS vendor_code, 'OFFICE_RENT' AS head_code, 'OFFICE_RENT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_457' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'COMPUTER_PERIPHERALS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_100' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'COMPUTER_PERIPHERALS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_803' AS vendor_code, 'HIRING_CHARGES' AS head_code, 'COMPUTER_HIRE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1052' AS vendor_code, 'STAFF_TRAINING_RECRUITMENT' AS head_code, 'RECRUITMENT_ADVERTISEMENT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1052' AS vendor_code, 'SECURITY_SERVICE' AS head_code, 'SECURITY_SERVICE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1052' AS vendor_code, 'CONTRACT_FEES_FACILITIES' AS head_code, 'FACILITY_STAFF' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1052' AS vendor_code, 'BUSINESS_PROMOTION' AS head_code, 'BUSINESS_PROMOTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1052' AS vendor_code, 'TOUR_EXPENSES' AS head_code, 'TOUR_EXPENSES' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1052' AS vendor_code, 'SPOT_FLOOR_FIELD_INCENTIVE' AS head_code, 'SPOT_INCENTIVE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1052' AS vendor_code, 'HIRING_CHARGES' AS head_code, 'COMPUTER_HIRE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1052' AS vendor_code, 'HIRING_CHARGES' AS head_code, 'GENERATOR_HIRE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1052' AS vendor_code, 'HIRING_CHARGES' AS head_code, 'AC_HIRE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1052' AS vendor_code, 'PRINTING_STATIONERY' AS head_code, 'OFFICE_STATIONERY' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1052' AS vendor_code, 'PRINTING_STATIONERY' AS head_code, 'PHOTOCOPY' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1052' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'COMPANY_VOICE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1052' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'COMPANY_DATA' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1052' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'SMS_CHARGES' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1052' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'MOBILE_INTERNET_REIMBURSEMENT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1052' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'POSTAGE_COURIER' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1052' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'COMPANY_VOICE_REIMBURSEMENT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1052' AS vendor_code, 'OFFICE_MAINTENANCE' AS head_code, 'WATER_TANKER' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1052' AS vendor_code, 'OFFICE_MAINTENANCE' AS head_code, 'CAFETERIA_MAINTENANCE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1052' AS vendor_code, 'OFFICE_MAINTENANCE' AS head_code, 'CLEANING_MATERIAL' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1052' AS vendor_code, 'STAFF_WELFARE' AS head_code, 'FESTIVAL_EXPENSE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1052' AS vendor_code, 'STAFF_WELFARE' AS head_code, 'MEDICAL_EXPENSE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1052' AS vendor_code, 'STAFF_WELFARE' AS head_code, 'RNR_EXPENSES' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1052' AS vendor_code, 'STAFF_WELFARE' AS head_code, 'REFRESHMENT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1052' AS vendor_code, 'STAFF_WELFARE' AS head_code, 'DRINKING_WATER' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1052' AS vendor_code, 'ELECTRICITY' AS head_code, 'ELECTRICITY_GOVT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1052' AS vendor_code, 'ELECTRICITY' AS head_code, 'GENERATOR_DIESEL' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1052' AS vendor_code, 'OFFICE_RENT' AS head_code, 'OFFICE_RENT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1052' AS vendor_code, 'OFFICE_RENT' AS head_code, 'PROPERTY_TAX' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1052' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'COMPUTER_PERIPHERALS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1052' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'OFFICE_REPAIRS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1052' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'ELECTRICAL_REPAIRS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1052' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'VEHICLE_REPAIR' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1066' AS vendor_code, 'STAFF_TRAINING_RECRUITMENT' AS head_code, 'RECRUITMENT_ADVERTISEMENT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1065' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'COMPANY_DATA' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1064' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'COMPANY_DATA' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_181' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'UPS_NETWORKING' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_395' AS vendor_code, 'STAFF_WELFARE' AS head_code, 'DRINKING_WATER' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_103' AS vendor_code, 'HIRING_CHARGES' AS head_code, 'AC_HIRE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1070' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'COMPANY_VOICE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_342' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'ELECTRICAL_REPAIRS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1072' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'COMPANY_DATA' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1073' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'COMPUTER_PERIPHERALS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1074' AS vendor_code, 'TOURS_TRAVELLING_CONVEYANCE' AS head_code, 'LOCAL_CONVEYANCE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1075' AS vendor_code, 'TOUR_EXPENSES' AS head_code, 'TOUR_EXPENSES' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1077' AS vendor_code, 'TOUR_EXPENSES' AS head_code, 'TOUR_EXPENSES' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1078' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'MOBILE_INTERNET_REIMBURSEMENT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1079' AS vendor_code, 'CONTRACT_FEES_FACILITIES' AS head_code, 'FACILITY_STAFF' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1080' AS vendor_code, 'TOUR_EXPENSES' AS head_code, 'TOUR_EXPENSES' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1081' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'COMPANY_VOICE_REIMBURSEMENT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1088' AS vendor_code, 'SECURITY_SERVICE' AS head_code, 'SECURITY_SERVICE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1082' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'COMPANY_VOICE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1083' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'COMPANY_VOICE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1084' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'COMPANY_VOICE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1085' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'COMPANY_VOICE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1086' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'COMPANY_VOICE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1087' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'COMPANY_VOICE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1082' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'COMPANY_DATA' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1086' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'COMPANY_VOICE_REIMBURSEMENT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_635' AS vendor_code, 'ELECTRICITY' AS head_code, 'ELECTRICITY_GOVT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_664' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'MOBILE_INTERNET_REIMBURSEMENT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_281' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'MOBILE_INTERNET_REIMBURSEMENT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_173' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'MOBILE_INTERNET_REIMBURSEMENT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1090' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'COMPANY_VOICE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1091' AS vendor_code, 'LEGAL_CONSULTANCY' AS head_code, 'LEGAL_PROFESSIONAL' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1092' AS vendor_code, 'BUSINESS_PROMOTION' AS head_code, 'BUSINESS_PROMOTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1093' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'MOBILE_INTERNET_REIMBURSEMENT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_524' AS vendor_code, 'PRINTING_STATIONERY' AS head_code, 'OFFICE_STATIONERY' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_675' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'COMPANY_DATA' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_688' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'COMPANY_DATA' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_276' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'COMPANY_DATA' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1096' AS vendor_code, 'TOUR_EXPENSES' AS head_code, 'TOUR_EXPENSES' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1097' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'COMPANY_VOICE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1100' AS vendor_code, 'STAFF_TRAINING_RECRUITMENT' AS head_code, 'RECRUITMENT_ADVERTISEMENT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_345' AS vendor_code, 'OFFICE_MAINTENANCE' AS head_code, 'CAFETERIA_MAINTENANCE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1104' AS vendor_code, 'OFFICE_MAINTENANCE' AS head_code, 'CAFETERIA_MAINTENANCE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1105' AS vendor_code, 'FEE_SUBSCRIPTION' AS head_code, 'FEE_SUBSCRIPTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1086' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'COMPANY_DATA' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1106' AS vendor_code, 'HIRING_CHARGES' AS head_code, 'COMPUTER_HIRE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_384' AS vendor_code, 'CONTRACT_FEES_FACILITIES' AS head_code, 'FACILITY_STAFF' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1108' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'COMPANY_VOICE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1109' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'COMPANY_VOICE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1110' AS vendor_code, 'CONTRACT_FEES' AS head_code, 'PROCESS_OUTSOURCING' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1112' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'MOBILE_INTERNET_REIMBURSEMENT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_270' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'OFFICE_REPAIRS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1114' AS vendor_code, 'OFFICE_MAINTENANCE' AS head_code, 'CAFETERIA_MAINTENANCE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1083' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'COMPANY_DATA' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1084' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'COMPANY_DATA' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1085' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'COMPANY_DATA' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1097' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'COMPANY_DATA' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1087' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'COMPANY_DATA' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1116' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'COMPANY_DATA' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1116' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'COMPANY_VOICE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1117' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'COMPANY_VOICE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1117' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'COMPANY_DATA' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1122' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'COMPANY_VOICE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1123' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'COMPANY_VOICE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1124' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'COMPANY_VOICE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1125' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'COMPANY_VOICE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1126' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'COMPANY_VOICE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1127' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'COMPANY_VOICE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1128' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'COMPANY_VOICE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1129' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'COMPANY_VOICE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1130' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'COMPANY_VOICE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1131' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'COMPANY_VOICE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1132' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'COMPANY_VOICE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1133' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'COMPANY_VOICE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_335' AS vendor_code, 'FEE_SUBSCRIPTION' AS head_code, 'FEE_SUBSCRIPTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1135' AS vendor_code, 'STAFF_WELFARE' AS head_code, 'REFRESHMENT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1136' AS vendor_code, 'FEE_SUBSCRIPTION' AS head_code, 'FEE_SUBSCRIPTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1138' AS vendor_code, 'PRINTING_STATIONERY' AS head_code, 'OFFICE_STATIONERY' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1139' AS vendor_code, 'STAFF_WELFARE' AS head_code, 'RNR_EXPENSES' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1084' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'COMPANY_VOICE_REIMBURSEMENT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1140' AS vendor_code, 'PRINTING_STATIONERY' AS head_code, 'OFFICE_STATIONERY' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1140' AS vendor_code, 'OFFICE_MAINTENANCE' AS head_code, 'CLEANING_MATERIAL' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1141' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'VEHICLE_REPAIR' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1142' AS vendor_code, 'LEGAL_CONSULTANCY' AS head_code, 'LEGAL_PROFESSIONAL' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1144' AS vendor_code, 'TOUR_EXPENSES' AS head_code, 'TOUR_EXPENSES' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1145' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'VEHICLE_REPAIR' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1144' AS vendor_code, 'TOURS_TRAVELLING_CONVEYANCE' AS head_code, 'LOCAL_CONVEYANCE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1146' AS vendor_code, 'FEE_SUBSCRIPTION' AS head_code, 'FEE_SUBSCRIPTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1147' AS vendor_code, 'INSURANCE_EXPENSES' AS head_code, 'CAR_INSURANCE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_450' AS vendor_code, 'PRINTING_STATIONERY' AS head_code, 'OFFICE_STATIONERY' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1149' AS vendor_code, 'STAFF_TRAINING_RECRUITMENT' AS head_code, 'RECRUITMENT_ADVERTISEMENT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1150' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'ELECTRICAL_REPAIRS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1153' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'OFFICE_REPAIRS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1154' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'AC_REPAIRS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1155' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'OFFICE_REPAIRS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1136' AS vendor_code, 'OFFICE_RENT' AS head_code, 'PROPERTY_TAX' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1156' AS vendor_code, 'TOURS_TRAVELLING_CONVEYANCE' AS head_code, 'PARKING_CHARGES' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1157' AS vendor_code, 'STAFF_WELFARE' AS head_code, 'REFRESHMENT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1158' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'COMPANY_DATA' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_171' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'COMPANY_DATA' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1160' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'ELECTRICAL_REPAIRS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1161' AS vendor_code, 'LEGAL_CONSULTANCY' AS head_code, 'LEGAL_PROFESSIONAL' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1162' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'POSTAGE_COURIER' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1163' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'COMPUTER_PERIPHERALS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1166' AS vendor_code, 'STAFF_WELFARE' AS head_code, 'RNR_EXPENSES' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1166' AS vendor_code, 'STAFF_WELFARE' AS head_code, 'FESTIVAL_EXPENSE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1167' AS vendor_code, 'TOURS_TRAVELLING_CONVEYANCE' AS head_code, 'LOCAL_CONVEYANCE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1168' AS vendor_code, 'LEGAL_CONSULTANCY' AS head_code, 'LEGAL_PROFESSIONAL' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1169' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'COMPANY_VOICE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_136' AS vendor_code, 'HIRING_CHARGES' AS head_code, 'COMPUTER_HIRE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_512' AS vendor_code, 'LEGAL_CONSULTANCY' AS head_code, 'LEGAL_PROFESSIONAL' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_578' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'OFFICE_REPAIRS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1173' AS vendor_code, 'STAFF_WELFARE' AS head_code, 'REFRESHMENT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_277' AS vendor_code, 'STAFF_TRAINING_RECRUITMENT' AS head_code, 'RECRUITMENT_ADVERTISEMENT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1175' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'COMPANY_DATA' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1176' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'COMPANY_DATA' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_411' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'COMPUTER_PERIPHERALS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1178' AS vendor_code, 'BUSINESS_PROMOTION' AS head_code, 'BUSINESS_PROMOTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_510' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'UPS_NETWORKING' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1180' AS vendor_code, 'STAFF_WELFARE' AS head_code, 'DRINKING_WATER' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1181' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'COMPUTER_PERIPHERALS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1182' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'ELECTRICAL_REPAIRS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1183' AS vendor_code, 'SPOT_FLOOR_FIELD_INCENTIVE' AS head_code, 'SPOT_INCENTIVE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1185' AS vendor_code, 'LEGAL_CONSULTANCY' AS head_code, 'LEGAL_PROFESSIONAL' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1186' AS vendor_code, 'PRINTING_STATIONERY' AS head_code, 'OFFICE_STATIONERY' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1187' AS vendor_code, 'STAFF_TRAINING_RECRUITMENT' AS head_code, 'RECRUITMENT_ADVERTISEMENT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1188' AS vendor_code, 'BUSINESS_PROMOTION' AS head_code, 'BUSINESS_PROMOTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1192' AS vendor_code, 'LEGAL_CONSULTANCY' AS head_code, 'LEGAL_PROFESSIONAL' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_617' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'OFFICE_REPAIRS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_508' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'ELECTRICAL_REPAIRS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1197' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'COMPUTER_PERIPHERALS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1198' AS vendor_code, 'ELECTRICITY' AS head_code, 'ELECTRICITY_GOVT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_383' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'ELECTRICAL_REPAIRS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1201' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'COMPUTER_PERIPHERALS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1202' AS vendor_code, 'TOUR_EXPENSES' AS head_code, 'TOUR_EXPENSES' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1202' AS vendor_code, 'BUSINESS_PROMOTION' AS head_code, 'BUSINESS_PROMOTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1202' AS vendor_code, 'FEE_SUBSCRIPTION' AS head_code, 'FEE_SUBSCRIPTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1202' AS vendor_code, 'TOURS_TRAVELLING_CONVEYANCE' AS head_code, 'LOCAL_CONVEYANCE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1202' AS vendor_code, 'STAFF_WELFARE' AS head_code, 'RNR_EXPENSES' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1203' AS vendor_code, 'FEE_SUBSCRIPTION' AS head_code, 'FEE_SUBSCRIPTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1204' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'AC_REPAIRS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1205' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'AC_REPAIRS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_341' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'OFFICE_REPAIRS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1208' AS vendor_code, 'LEGAL_CONSULTANCY' AS head_code, 'LEGAL_PROFESSIONAL' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_434' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'COMPANY_DATA' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1210' AS vendor_code, 'FEE_SUBSCRIPTION' AS head_code, 'FEE_SUBSCRIPTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1211' AS vendor_code, 'BUSINESS_PROMOTION' AS head_code, 'BUSINESS_PROMOTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1211' AS vendor_code, 'LEGAL_CONSULTANCY' AS head_code, 'LEGAL_PROFESSIONAL' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1202' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'VEHICLE_REPAIR' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_529' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'COMPUTER_PERIPHERALS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_198' AS vendor_code, 'HIRING_CHARGES' AS head_code, 'COMPUTER_HIRE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1215' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'AC_REPAIRS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_181' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'UPS_NETWORKING' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1224' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'ELECTRICAL_REPAIRS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1225' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'COMPANY_DATA' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1229' AS vendor_code, 'PRINTING_STATIONERY' AS head_code, 'OFFICE_STATIONERY' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1191' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'COMPUTER_PERIPHERALS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1230' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'COMPUTER_PERIPHERALS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1231' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'COMPUTER_PERIPHERALS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1070' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'MOBILE_INTERNET_REIMBURSEMENT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1116' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'COMPANY_VOICE_REIMBURSEMENT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1070' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'COMPANY_VOICE_REIMBURSEMENT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1127' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'COMPANY_VOICE_REIMBURSEMENT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1144' AS vendor_code, 'BUSINESS_PROMOTION' AS head_code, 'BUSINESS_PROMOTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1232' AS vendor_code, 'BUSINESS_PROMOTION' AS head_code, 'BUSINESS_PROMOTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_688' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'COMPANY_VOICE_REIMBURSEMENT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1234' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'COMPUTER_PERIPHERALS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1235' AS vendor_code, 'SECURITY_SERVICE' AS head_code, 'SECURITY_SERVICE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1236' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'COMPANY_DATA' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1241' AS vendor_code, 'HIRING_CHARGES' AS head_code, 'COMPUTER_HIRE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1082' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'COMPANY_VOICE_REIMBURSEMENT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_351' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'ELECTRICAL_REPAIRS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1249' AS vendor_code, 'LEGAL_CONSULTANCY' AS head_code, 'LEGAL_PROFESSIONAL' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1250' AS vendor_code, 'BUSINESS_PROMOTION' AS head_code, 'BUSINESS_PROMOTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1251' AS vendor_code, 'OFFICE_MAINTENANCE' AS head_code, 'CLEANING_MATERIAL' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_616' AS vendor_code, 'CONTRACT_FEES_FACILITIES' AS head_code, 'FACILITY_STAFF' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1252' AS vendor_code, 'PRINTING_STATIONERY' AS head_code, 'OFFICE_STATIONERY' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1281' AS vendor_code, 'CONTRACT_FEES' AS head_code, 'PROCESS_OUTSOURCING' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1254' AS vendor_code, 'OFFICE_MAINTENANCE' AS head_code, 'CAFETERIA_MAINTENANCE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1255' AS vendor_code, 'HIRING_CHARGES' AS head_code, 'GENERATOR_HIRE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1232' AS vendor_code, 'TOURS_TRAVELLING_CONVEYANCE' AS head_code, 'LOCAL_CONVEYANCE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1203' AS vendor_code, 'LEGAL_CONSULTANCY' AS head_code, 'LEGAL_PROFESSIONAL' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_425' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'VEHICLE_REPAIR' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1259' AS vendor_code, 'STAFF_WELFARE' AS head_code, 'DRINKING_WATER' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1260' AS vendor_code, 'STAFF_TRAINING_RECRUITMENT' AS head_code, 'RECRUITMENT_ADVERTISEMENT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1261' AS vendor_code, 'LEGAL_CONSULTANCY' AS head_code, 'LEGAL_PROFESSIONAL' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1262' AS vendor_code, 'OFFICE_MAINTENANCE' AS head_code, 'CLEANING_MATERIAL' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1265' AS vendor_code, 'STAFF_TRAINING_RECRUITMENT' AS head_code, 'RECRUITMENT_ADVERTISEMENT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1266' AS vendor_code, 'CONTRACT_FEES' AS head_code, 'PROCESS_OUTSOURCING' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1267' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'COMPUTER_PERIPHERALS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1268' AS vendor_code, 'PRINTING_STATIONERY' AS head_code, 'OFFICE_STATIONERY' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1269' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'OFFICE_REPAIRS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1270' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'COMPUTER_PERIPHERALS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1271' AS vendor_code, 'BUSINESS_PROMOTION' AS head_code, 'BUSINESS_PROMOTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1272' AS vendor_code, 'CONTRACT_FEES_FACILITIES' AS head_code, 'FACILITY_STAFF' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1273' AS vendor_code, 'OFFICE_MAINTENANCE' AS head_code, 'CLEANING_MATERIAL' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1274' AS vendor_code, 'STAFF_TRAINING_RECRUITMENT' AS head_code, 'RECRUITMENT_ADVERTISEMENT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1275' AS vendor_code, 'CONTRACT_FEES_FACILITIES' AS head_code, 'FACILITY_STAFF' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1276' AS vendor_code, 'CONTRACT_FEES' AS head_code, 'PROCESS_OUTSOURCING' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1278' AS vendor_code, 'STAFF_TRAINING_RECRUITMENT' AS head_code, 'RECRUITMENT_ADVERTISEMENT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1279' AS vendor_code, 'STAFF_TRAINING_RECRUITMENT' AS head_code, 'RECRUITMENT_ADVERTISEMENT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_523' AS vendor_code, 'HIRING_CHARGES' AS head_code, 'COMPUTER_HIRE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1282' AS vendor_code, 'LEGAL_CONSULTANCY' AS head_code, 'LEGAL_PROFESSIONAL' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1992' AS vendor_code, 'TOURS_TRAVELLING_CONVEYANCE' AS head_code, 'PARKING_CHARGES' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1286' AS vendor_code, 'BUSINESS_PROMOTION' AS head_code, 'BUSINESS_PROMOTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1275' AS vendor_code, 'STAFF_WELFARE' AS head_code, 'REFRESHMENT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1287' AS vendor_code, 'CONTRACT_FEES' AS head_code, 'PROCESS_OUTSOURCING' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1289' AS vendor_code, 'CONTRACT_FEES' AS head_code, 'PROCESS_OUTSOURCING' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1290' AS vendor_code, 'STAFF_WELFARE' AS head_code, 'FESTIVAL_EXPENSE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1291' AS vendor_code, 'STAFF_WELFARE' AS head_code, 'FESTIVAL_EXPENSE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1292' AS vendor_code, 'CONTRACT_FEES' AS head_code, 'PROCESS_OUTSOURCING' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1295' AS vendor_code, 'BUSINESS_PROMOTION' AS head_code, 'BUSINESS_PROMOTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_583' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'ELECTRICAL_REPAIRS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1296' AS vendor_code, 'STAFF_TRAINING_RECRUITMENT' AS head_code, 'RECRUITMENT_ADVERTISEMENT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1296' AS vendor_code, 'LEGAL_CONSULTANCY' AS head_code, 'LEGAL_PROFESSIONAL' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_67' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'UPS_NETWORKING' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1297' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'ELECTRICAL_REPAIRS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1298' AS vendor_code, 'CONTRACT_FEES' AS head_code, 'PROCESS_OUTSOURCING' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1299' AS vendor_code, 'CONTRACT_FEES' AS head_code, 'PROCESS_OUTSOURCING' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1300' AS vendor_code, 'CONTRACT_FEES' AS head_code, 'PROCESS_OUTSOURCING' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1302' AS vendor_code, 'CONTRACT_FEES' AS head_code, 'PROCESS_OUTSOURCING' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1303' AS vendor_code, 'STAFF_TRAINING_RECRUITMENT' AS head_code, 'RECRUITMENT_ADVERTISEMENT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1304' AS vendor_code, 'CONTRACT_FEES' AS head_code, 'PROCESS_OUTSOURCING' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_384' AS vendor_code, 'STAFF_TRAINING_RECRUITMENT' AS head_code, 'RECRUITMENT_ADVERTISEMENT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1307' AS vendor_code, 'STAFF_TRAINING_RECRUITMENT' AS head_code, 'RECRUITMENT_ADVERTISEMENT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1309' AS vendor_code, 'STAFF_TRAINING_RECRUITMENT' AS head_code, 'RECRUITMENT_ADVERTISEMENT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1310' AS vendor_code, 'BUSINESS_PROMOTION' AS head_code, 'BUSINESS_PROMOTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1311' AS vendor_code, 'BUSINESS_PROMOTION' AS head_code, 'BUSINESS_PROMOTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_368' AS vendor_code, 'OFFICE_MAINTENANCE' AS head_code, 'CAFETERIA_MAINTENANCE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1213' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'AC_REPAIRS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1313' AS vendor_code, 'CONTRACT_FEES' AS head_code, 'PROCESS_OUTSOURCING' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1314' AS vendor_code, 'PRINTING_STATIONERY' AS head_code, 'OFFICE_STATIONERY' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1316' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'OFFICE_REPAIRS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_491' AS vendor_code, 'BUSINESS_PROMOTION' AS head_code, 'BUSINESS_PROMOTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1323' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'COMPANY_VOICE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1325' AS vendor_code, 'STAFF_TRAINING_RECRUITMENT' AS head_code, 'RECRUITMENT_ADVERTISEMENT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1327' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'ELECTRICAL_REPAIRS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1328' AS vendor_code, 'OFFICE_MAINTENANCE' AS head_code, 'CAFETERIA_MAINTENANCE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1330' AS vendor_code, 'STAFF_WELFARE' AS head_code, 'DRINKING_WATER' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1331' AS vendor_code, 'STAFF_WELFARE' AS head_code, 'REFRESHMENT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1332' AS vendor_code, 'ELECTRICITY' AS head_code, 'ELECTRICITY_GOVT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1334' AS vendor_code, 'INSURANCE_EXPENSES' AS head_code, 'CAR_INSURANCE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1335' AS vendor_code, 'CONTRACT_FEES' AS head_code, 'PROCESS_OUTSOURCING' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1336' AS vendor_code, 'CONTRACT_FEES' AS head_code, 'PROCESS_OUTSOURCING' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1401' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'COMPUTER_PERIPHERALS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1339' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'COMPUTER_PERIPHERALS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1319' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'OFFICE_REPAIRS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1337' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'ELECTRICAL_REPAIRS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1340' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'OFFICE_REPAIRS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1321' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'ELECTRICAL_REPAIRS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_181' AS vendor_code, 'HIRING_CHARGES' AS head_code, 'UPS_HIRE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1341' AS vendor_code, 'LEGAL_CONSULTANCY' AS head_code, 'LEGAL_PROFESSIONAL' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1340' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'ELECTRICAL_REPAIRS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1343' AS vendor_code, 'OFFICE_RENT' AS head_code, 'OFFICE_RENT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1343' AS vendor_code, 'OFFICE_RENT' AS head_code, 'PROPERTY_TAX' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1344' AS vendor_code, 'CONTRACT_FEES' AS head_code, 'PROCESS_OUTSOURCING' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1346' AS vendor_code, 'LEGAL_CONSULTANCY' AS head_code, 'LEGAL_PROFESSIONAL' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1348' AS vendor_code, 'OFFICE_MAINTENANCE' AS head_code, 'CAFETERIA_MAINTENANCE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1349' AS vendor_code, 'OFFICE_RENT' AS head_code, 'OFFICE_RENT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1394' AS vendor_code, 'OFFICE_RENT' AS head_code, 'OFFICE_RENT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1242' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'OFFICE_REPAIRS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1350' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'OFFICE_REPAIRS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1352' AS vendor_code, 'LEGAL_CONSULTANCY' AS head_code, 'LEGAL_PROFESSIONAL' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1358' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'SMS_CHARGES' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1361' AS vendor_code, 'OFFICE_MAINTENANCE' AS head_code, 'CAFETERIA_MAINTENANCE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1362' AS vendor_code, 'OFFICE_MAINTENANCE' AS head_code, 'CAFETERIA_MAINTENANCE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_165' AS vendor_code, 'STAFF_TRAINING_RECRUITMENT' AS head_code, 'RECRUITMENT_ADVERTISEMENT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1366' AS vendor_code, 'STAFF_TRAINING_RECRUITMENT' AS head_code, 'RECRUITMENT_ADVERTISEMENT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1363' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'COMPUTER_PERIPHERALS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1367' AS vendor_code, 'CONTRACT_FEES' AS head_code, 'PROCESS_OUTSOURCING' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1368' AS vendor_code, 'SECURITY_SERVICE' AS head_code, 'SECURITY_SERVICE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_328' AS vendor_code, 'HIRING_CHARGES' AS head_code, 'COMPUTER_HIRE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1370' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'COMPUTER_PERIPHERALS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1394' AS vendor_code, 'ELECTRICITY' AS head_code, 'ELECTRICITY_GOVT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1372' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'COMPANY_VOICE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1373' AS vendor_code, 'OFFICE_RENT' AS head_code, 'OFFICE_RENT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1343' AS vendor_code, 'OFFICE_MAINTENANCE' AS head_code, 'CAFETERIA_MAINTENANCE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1379' AS vendor_code, 'HIRING_CHARGES' AS head_code, 'GENERATOR_HIRE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1380' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'ELECTRICAL_REPAIRS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1324' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'OFFICE_REPAIRS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1326' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'ELECTRICAL_REPAIRS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1376' AS vendor_code, 'STAFF_TRAINING_RECRUITMENT' AS head_code, 'RECRUITMENT_ADVERTISEMENT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1243' AS vendor_code, 'OFFICE_MAINTENANCE' AS head_code, 'CAFETERIA_MAINTENANCE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1377' AS vendor_code, 'OFFICE_MAINTENANCE' AS head_code, 'CAFETERIA_MAINTENANCE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1378' AS vendor_code, 'OFFICE_MAINTENANCE' AS head_code, 'CAFETERIA_MAINTENANCE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1379' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'ELECTRICAL_REPAIRS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1380' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'OFFICE_REPAIRS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1381' AS vendor_code, 'HIRING_CHARGES' AS head_code, 'GENERATOR_HIRE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1382' AS vendor_code, 'CONTRACT_FEES' AS head_code, 'PROCESS_OUTSOURCING' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1383' AS vendor_code, 'TOURS_TRAVELLING_CONVEYANCE' AS head_code, 'LOCAL_CONVEYANCE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1384' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'COMPUTER_PERIPHERALS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1394' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'ELECTRICAL_REPAIRS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1305' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'OFFICE_REPAIRS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1386' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'ELECTRICAL_REPAIRS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1408' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'OFFICE_REPAIRS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1388' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'OFFICE_REPAIRS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1389' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'MOBILE_INTERNET_REIMBURSEMENT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1390' AS vendor_code, 'CONTRACT_FEES' AS head_code, 'PROCESS_OUTSOURCING' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1392' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'COMPUTER_PERIPHERALS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_203' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'OFFICE_REPAIRS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1394' AS vendor_code, 'OFFICE_MAINTENANCE' AS head_code, 'CAFETERIA_MAINTENANCE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1408' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'ELECTRICAL_REPAIRS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1397' AS vendor_code, 'STAFF_WELFARE' AS head_code, 'DRINKING_WATER' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1398' AS vendor_code, 'PRINTING_STATIONERY' AS head_code, 'OFFICE_STATIONERY' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1399' AS vendor_code, 'CONTRACT_FEES' AS head_code, 'PROCESS_OUTSOURCING' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1400' AS vendor_code, 'CONTRACT_FEES' AS head_code, 'PROCESS_OUTSOURCING' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1401' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'COMPUTER_PERIPHERALS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1403' AS vendor_code, 'CONTRACT_FEES' AS head_code, 'PROCESS_OUTSOURCING_FIELD' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1404' AS vendor_code, 'CONTRACT_FEES' AS head_code, 'PROCESS_OUTSOURCING_FIELD' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1405' AS vendor_code, 'CONTRACT_FEES' AS head_code, 'PROCESS_OUTSOURCING_FIELD' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1406' AS vendor_code, 'CONTRACT_FEES' AS head_code, 'PROCESS_OUTSOURCING_FIELD' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1407' AS vendor_code, 'CONTRACT_FEES' AS head_code, 'PROCESS_OUTSOURCING_FIELD' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1407' AS vendor_code, 'CONTRACT_FEES' AS head_code, 'PROCESS_OUTSOURCING' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1408' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'AC_REPAIRS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1408' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'AC_REPAIRS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_435' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'OFFICE_REPAIRS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1315' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'ELECTRICAL_REPAIRS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1410' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'POSTAGE_COURIER' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1412' AS vendor_code, 'BUSINESS_PROMOTION' AS head_code, 'BUSINESS_PROMOTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1415' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'ELECTRICAL_REPAIRS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1082' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'MOBILE_INTERNET_REIMBURSEMENT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1416' AS vendor_code, 'BUSINESS_PROMOTION' AS head_code, 'BUSINESS_PROMOTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1417' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'COMPANY_VOICE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1419' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'ELECTRICAL_REPAIRS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1420' AS vendor_code, 'STAFF_WELFARE' AS head_code, 'REFRESHMENT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1421' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'AC_REPAIRS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1422' AS vendor_code, 'STAFF_WELFARE' AS head_code, 'DRINKING_WATER' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1424' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'ELECTRICAL_REPAIRS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1426' AS vendor_code, 'OFFICE_MAINTENANCE' AS head_code, 'CAFETERIA_MAINTENANCE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1427' AS vendor_code, 'OFFICE_RENT' AS head_code, 'PROPERTY_TAX' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1428' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'COMPANY_DATA' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1429' AS vendor_code, 'OFFICE_RENT' AS head_code, 'OFFICE_RENT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1429' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'MOBILE_INTERNET_REIMBURSEMENT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1429' AS vendor_code, 'ELECTRICITY' AS head_code, 'ELECTRICITY_GOVT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1429' AS vendor_code, 'STAFF_WELFARE' AS head_code, 'REFRESHMENT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1429' AS vendor_code, 'STAFF_WELFARE' AS head_code, 'DRINKING_WATER' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1429' AS vendor_code, 'OFFICE_MAINTENANCE' AS head_code, 'CAFETERIA_MAINTENANCE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1430' AS vendor_code, 'HIRING_CHARGES' AS head_code, 'COMPUTER_HIRE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1431' AS vendor_code, 'LEGAL_CONSULTANCY' AS head_code, 'LEGAL_PROFESSIONAL' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1433' AS vendor_code, 'CONTRACT_FEES' AS head_code, 'PROCESS_OUTSOURCING_FIELD' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1434' AS vendor_code, 'CONTRACT_FEES' AS head_code, 'PROCESS_OUTSOURCING_FIELD' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1400' AS vendor_code, 'CONTRACT_FEES' AS head_code, 'PROCESS_OUTSOURCING_FIELD' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1292' AS vendor_code, 'CONTRACT_FEES' AS head_code, 'PROCESS_OUTSOURCING_FIELD' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1399' AS vendor_code, 'CONTRACT_FEES' AS head_code, 'PROCESS_OUTSOURCING_FIELD' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1435' AS vendor_code, 'BUSINESS_PROMOTION' AS head_code, 'BUSINESS_PROMOTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1436' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'OFFICE_REPAIRS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1437' AS vendor_code, 'CONTRACT_FEES' AS head_code, 'PROCESS_OUTSOURCING_FIELD' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1438' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'COMPUTER_PERIPHERALS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1437' AS vendor_code, 'CONTRACT_FEES' AS head_code, 'PROCESS_OUTSOURCING' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1429' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'COMPANY_VOICE_REIMBURSEMENT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1439' AS vendor_code, 'STAFF_WELFARE' AS head_code, 'RNR_EXPENSES' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1440' AS vendor_code, 'CONTRACT_FEES' AS head_code, 'PROCESS_OUTSOURCING_FIELD' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1441' AS vendor_code, 'PRINTING_STATIONERY' AS head_code, 'OFFICE_STATIONERY' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1440' AS vendor_code, 'CONTRACT_FEES' AS head_code, 'PROCESS_OUTSOURCING' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1302' AS vendor_code, 'CONTRACT_FEES' AS head_code, 'PROCESS_OUTSOURCING_FIELD' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1444' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'COMPUTER_PERIPHERALS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1445' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'COMPUTER_PERIPHERALS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1446' AS vendor_code, 'BUSINESS_PROMOTION' AS head_code, 'BUSINESS_PROMOTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1447' AS vendor_code, 'STAFF_TRAINING_RECRUITMENT' AS head_code, 'RECRUITMENT_ADVERTISEMENT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1448' AS vendor_code, 'BUSINESS_PROMOTION' AS head_code, 'BUSINESS_PROMOTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1449' AS vendor_code, 'STAFF_TRAINING_RECRUITMENT' AS head_code, 'RECRUITMENT_ADVERTISEMENT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1450' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'COMPUTER_PERIPHERALS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1341' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'SMS_CHARGES' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1451' AS vendor_code, 'CONTRACT_FEES' AS head_code, 'PROCESS_OUTSOURCING' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1373' AS vendor_code, 'TOURS_TRAVELLING_CONVEYANCE' AS head_code, 'PARKING_CHARGES' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1344' AS vendor_code, 'CONTRACT_FEES' AS head_code, 'PROCESS_OUTSOURCING_FIELD' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1367' AS vendor_code, 'CONTRACT_FEES' AS head_code, 'PROCESS_OUTSOURCING_FIELD' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1451' AS vendor_code, 'CONTRACT_FEES' AS head_code, 'PROCESS_OUTSOURCING_FIELD' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1452' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'COMPUTER_PERIPHERALS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1453' AS vendor_code, 'CONTRACT_FEES' AS head_code, 'PROCESS_OUTSOURCING_FIELD' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1454' AS vendor_code, 'CONTRACT_FEES' AS head_code, 'PROCESS_OUTSOURCING_FIELD' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1455' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'COMPANY_VOICE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1456' AS vendor_code, 'STAFF_WELFARE' AS head_code, 'DRINKING_WATER' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1458' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'AC_REPAIRS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1459' AS vendor_code, 'DONATION_CHARITABLE' AS head_code, 'DONATION_CHARITABLE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1460' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'OFFICE_REPAIRS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1462' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'COMPUTER_PERIPHERALS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1464' AS vendor_code, 'STAFF_WELFARE' AS head_code, 'FESTIVAL_EXPENSE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1465' AS vendor_code, 'CONTRACT_FEES' AS head_code, 'PROCESS_OUTSOURCING_FIELD' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1466' AS vendor_code, 'STAFF_WELFARE' AS head_code, 'FESTIVAL_EXPENSE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1468' AS vendor_code, 'STAFF_WELFARE' AS head_code, 'FESTIVAL_EXPENSE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1417' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'COMPANY_DATA' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_633' AS vendor_code, 'LEGAL_CONSULTANCY' AS head_code, 'LEGAL_PROFESSIONAL' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1289' AS vendor_code, 'CONTRACT_FEES' AS head_code, 'PROCESS_OUTSOURCING_FIELD' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1470' AS vendor_code, 'LEGAL_CONSULTANCY' AS head_code, 'LEGAL_PROFESSIONAL' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1472' AS vendor_code, 'FEE_SUBSCRIPTION' AS head_code, 'FEE_SUBSCRIPTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1282' AS vendor_code, 'FEE_SUBSCRIPTION' AS head_code, 'FEE_SUBSCRIPTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1448' AS vendor_code, 'LEGAL_CONSULTANCY' AS head_code, 'LEGAL_PROFESSIONAL' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1473' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'MOBILE_INTERNET_REIMBURSEMENT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1474' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'MOBILE_INTERNET_REIMBURSEMENT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1474' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'SMS_CHARGES' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1473' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'SMS_CHARGES' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1475' AS vendor_code, 'STAFF_WELFARE' AS head_code, 'FESTIVAL_EXPENSE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_709' AS vendor_code, 'STAFF_WELFARE' AS head_code, 'FESTIVAL_EXPENSE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1476' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'VEHICLE_REPAIR' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1477' AS vendor_code, 'FEE_SUBSCRIPTION' AS head_code, 'FEE_SUBSCRIPTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1478' AS vendor_code, 'BUSINESS_PROMOTION' AS head_code, 'BUSINESS_PROMOTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1144' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'COMPUTER_PERIPHERALS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1479' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'POSTAGE_COURIER' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1479' AS vendor_code, 'INSURANCE_EXPENSES' AS head_code, 'INFRA_INSURANCE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1482' AS vendor_code, 'CONTRACT_FEES' AS head_code, 'PROCESS_OUTSOURCING_FIELD' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1483' AS vendor_code, 'LEGAL_CONSULTANCY' AS head_code, 'LEGAL_PROFESSIONAL' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1484' AS vendor_code, 'LEGAL_CONSULTANCY' AS head_code, 'LEGAL_PROFESSIONAL' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1488' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'COMPANY_VOICE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1485' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'AC_REPAIRS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1489' AS vendor_code, 'ELECTRICITY' AS head_code, 'ELECTRICITY_GOVT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1489' AS vendor_code, 'OFFICE_MAINTENANCE' AS head_code, 'CAFETERIA_MAINTENANCE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1491' AS vendor_code, 'INSURANCE_EXPENSES' AS head_code, 'CAR_INSURANCE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1492' AS vendor_code, 'TOUR_EXPENSES' AS head_code, 'TOUR_EXPENSES' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1493' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'COMPUTER_PERIPHERALS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1498' AS vendor_code, 'STAFF_WELFARE' AS head_code, 'DRINKING_WATER' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1372' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'COMPANY_DATA' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1499' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'COMPANY_DATA' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1501' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'COMPANY_VOICE_REIMBURSEMENT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1501' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'MOBILE_INTERNET_REIMBURSEMENT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1504' AS vendor_code, 'CONTRACT_FEES' AS head_code, 'PROCESS_OUTSOURCING_FIELD' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1506' AS vendor_code, 'CONTRACT_FEES' AS head_code, 'PROCESS_OUTSOURCING_FIELD' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1144' AS vendor_code, 'FEE_SUBSCRIPTION' AS head_code, 'FEE_SUBSCRIPTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1509' AS vendor_code, 'STAFF_WELFARE' AS head_code, 'MEDICAL_EXPENSE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1511' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'COMPANY_DATA' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1512' AS vendor_code, 'FEE_SUBSCRIPTION' AS head_code, 'FEE_SUBSCRIPTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1513' AS vendor_code, 'TOUR_EXPENSES' AS head_code, 'TOUR_EXPENSES' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1514' AS vendor_code, 'STAFF_WELFARE' AS head_code, 'MEDICAL_EXPENSE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1515' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'COMPANY_DATA' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1516' AS vendor_code, 'STAFF_WELFARE' AS head_code, 'MEDICAL_EXPENSE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1517' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'COMPANY_DATA' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1519' AS vendor_code, 'STAFF_WELFARE' AS head_code, 'MEDICAL_EXPENSE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1520' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'OFFICE_REPAIRS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1521' AS vendor_code, 'BUSINESS_PROMOTION' AS head_code, 'BUSINESS_PROMOTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1524' AS vendor_code, 'OFFICE_MAINTENANCE' AS head_code, 'CAFETERIA_MAINTENANCE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1526' AS vendor_code, 'OFFICE_MAINTENANCE' AS head_code, 'CAFETERIA_MAINTENANCE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1527' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'COMPANY_DATA' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1528' AS vendor_code, 'OFFICE_MAINTENANCE' AS head_code, 'CAFETERIA_MAINTENANCE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1529' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'COMPANY_DATA' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1530' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'COMPANY_DATA' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1531' AS vendor_code, 'STAFF_WELFARE' AS head_code, 'RNR_EXPENSES' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_725' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'ELECTRICAL_REPAIRS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1533' AS vendor_code, 'LEGAL_CONSULTANCY' AS head_code, 'LEGAL_PROFESSIONAL' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1534' AS vendor_code, 'FEE_SUBSCRIPTION' AS head_code, 'FEE_SUBSCRIPTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1534' AS vendor_code, 'LEGAL_CONSULTANCY' AS head_code, 'LEGAL_PROFESSIONAL' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1536' AS vendor_code, 'FEE_SUBSCRIPTION' AS head_code, 'FEE_SUBSCRIPTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1537' AS vendor_code, 'OFFICE_MAINTENANCE' AS head_code, 'CAFETERIA_MAINTENANCE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1538' AS vendor_code, 'LEGAL_CONSULTANCY' AS head_code, 'LEGAL_PROFESSIONAL' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1542' AS vendor_code, 'LEGAL_CONSULTANCY' AS head_code, 'LEGAL_PROFESSIONAL' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1547' AS vendor_code, 'STAFF_WELFARE' AS head_code, 'MEDICAL_EXPENSE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1549' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'COMPANY_VOICE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1550' AS vendor_code, 'STAFF_WELFARE' AS head_code, 'MEDICAL_EXPENSE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1553' AS vendor_code, 'STAFF_WELFARE' AS head_code, 'MEDICAL_EXPENSE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1556' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'COMPUTER_PERIPHERALS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1558' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'COMPANY_DATA' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1537' AS vendor_code, 'OFFICE_RENT' AS head_code, 'OFFICE_RENT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1537' AS vendor_code, 'ELECTRICITY' AS head_code, 'ELECTRICITY_GOVT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1537' AS vendor_code, 'HIRING_CHARGES' AS head_code, 'GENERATOR_HIRE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1560' AS vendor_code, 'SECURITY_SERVICE' AS head_code, 'SECURITY_SERVICE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1561' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'COMPANY_DATA' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1562' AS vendor_code, 'ELECTRICITY' AS head_code, 'ELECTRICITY_GOVT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1517' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'COMPANY_VOICE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1564' AS vendor_code, 'BUSINESS_PROMOTION' AS head_code, 'BUSINESS_PROMOTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1565' AS vendor_code, 'BUSINESS_PROMOTION' AS head_code, 'BUSINESS_PROMOTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1566' AS vendor_code, 'ELECTRICITY' AS head_code, 'ELECTRICITY_GOVT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1567' AS vendor_code, 'BUSINESS_PROMOTION' AS head_code, 'BUSINESS_PROMOTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1568' AS vendor_code, 'FEE_SUBSCRIPTION' AS head_code, 'FEE_SUBSCRIPTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1569' AS vendor_code, 'PRINTING_STATIONERY' AS head_code, 'OFFICE_STATIONERY' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1537' AS vendor_code, 'TOURS_TRAVELLING_CONVEYANCE' AS head_code, 'PARKING_CHARGES' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1570' AS vendor_code, 'FEE_SUBSCRIPTION' AS head_code, 'FEE_SUBSCRIPTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1573' AS vendor_code, 'STAFF_WELFARE' AS head_code, 'DRINKING_WATER' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1574' AS vendor_code, 'STAFF_WELFARE' AS head_code, 'DRINKING_WATER' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1575' AS vendor_code, 'BUSINESS_PROMOTION' AS head_code, 'BUSINESS_PROMOTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1575' AS vendor_code, 'STAFF_WELFARE' AS head_code, 'FESTIVAL_EXPENSE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1576' AS vendor_code, 'STAFF_WELFARE' AS head_code, 'FESTIVAL_EXPENSE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1577' AS vendor_code, 'BUSINESS_PROMOTION' AS head_code, 'BUSINESS_PROMOTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1578' AS vendor_code, 'FEE_SUBSCRIPTION' AS head_code, 'FEE_SUBSCRIPTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1579' AS vendor_code, 'FEE_SUBSCRIPTION' AS head_code, 'FEE_SUBSCRIPTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1580' AS vendor_code, 'FEE_SUBSCRIPTION' AS head_code, 'FEE_SUBSCRIPTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_345' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'OFFICE_REPAIRS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1583' AS vendor_code, 'BUSINESS_PROMOTION' AS head_code, 'BUSINESS_PROMOTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1411' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'OFFICE_REPAIRS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_181' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'COMPUTER_PERIPHERALS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_65' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'COMPUTER_PERIPHERALS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_181' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'COMPUTER_PERIPHERALS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1585' AS vendor_code, 'PRINTING_STATIONERY' AS head_code, 'OFFICE_STATIONERY' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1587' AS vendor_code, 'BUSINESS_PROMOTION' AS head_code, 'BUSINESS_PROMOTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1588' AS vendor_code, 'FEE_SUBSCRIPTION' AS head_code, 'FEE_SUBSCRIPTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1484' AS vendor_code, 'CONTRACT_FEES' AS head_code, 'PROCESS_OUTSOURCING' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1590' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'UPS_NETWORKING' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1591' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'SMS_CHARGES' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1593' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'COMPANY_DATA' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1202' AS vendor_code, 'DONATION_CHARITABLE' AS head_code, 'DONATION_CHARITABLE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1202' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'POSTAGE_COURIER' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1202' AS vendor_code, 'PRINTING_STATIONERY' AS head_code, 'OFFICE_STATIONERY' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1202' AS vendor_code, 'SPOT_FLOOR_FIELD_INCENTIVE' AS head_code, 'SPOT_INCENTIVE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1202' AS vendor_code, 'STAFF_WELFARE' AS head_code, 'REFRESHMENT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_691' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'MOBILE_INTERNET_REIMBURSEMENT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1534' AS vendor_code, 'BUSINESS_PROMOTION' AS head_code, 'BUSINESS_PROMOTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_165' AS vendor_code, 'BUSINESS_PROMOTION' AS head_code, 'BUSINESS_PROMOTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1596' AS vendor_code, 'TOUR_EXPENSES' AS head_code, 'TOUR_EXPENSES' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1286' AS vendor_code, 'TOURS_TRAVELLING_CONVEYANCE' AS head_code, 'LOCAL_CONVEYANCE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1286' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'COMPANY_DATA' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1596' AS vendor_code, 'BUSINESS_PROMOTION' AS head_code, 'BUSINESS_PROMOTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1596' AS vendor_code, 'TOURS_TRAVELLING_CONVEYANCE' AS head_code, 'LOCAL_CONVEYANCE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1596' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'COMPANY_DATA' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1596' AS vendor_code, 'FEE_SUBSCRIPTION' AS head_code, 'FEE_SUBSCRIPTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1286' AS vendor_code, 'FEE_SUBSCRIPTION' AS head_code, 'FEE_SUBSCRIPTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1286' AS vendor_code, 'TOUR_EXPENSES' AS head_code, 'TOUR_EXPENSES' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1603' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'ELECTRICAL_REPAIRS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_709' AS vendor_code, 'TOUR_EXPENSES' AS head_code, 'TOUR_EXPENSES' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1604' AS vendor_code, 'SECURITY_SERVICE' AS head_code, 'SECURITY_SERVICE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1605' AS vendor_code, 'OFFICE_MAINTENANCE' AS head_code, 'CAFETERIA_MAINTENANCE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1491' AS vendor_code, 'INSURANCE_EXPENSES' AS head_code, 'INFRA_INSURANCE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1606' AS vendor_code, 'BUSINESS_PROMOTION' AS head_code, 'BUSINESS_PROMOTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1608' AS vendor_code, 'OFFICE_MAINTENANCE' AS head_code, 'CAFETERIA_MAINTENANCE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1585' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'COMPUTER_PERIPHERALS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1610' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'POSTAGE_COURIER' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1286' AS vendor_code, 'OFFICE_MAINTENANCE' AS head_code, 'CAFETERIA_MAINTENANCE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1624' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'OFFICE_REPAIRS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1501' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'COMPANY_DATA' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1625' AS vendor_code, 'STAFF_WELFARE' AS head_code, 'REFRESHMENT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1626' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'POSTAGE_COURIER' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1627' AS vendor_code, 'LEGAL_CONSULTANCY' AS head_code, 'LEGAL_PROFESSIONAL' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1628' AS vendor_code, 'OFFICE_MAINTENANCE' AS head_code, 'CAFETERIA_MAINTENANCE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1629' AS vendor_code, 'STAFF_TRAINING_RECRUITMENT' AS head_code, 'RECRUITMENT_ADVERTISEMENT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1630' AS vendor_code, 'OFFICE_MAINTENANCE' AS head_code, 'CLEANING_MATERIAL' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1631' AS vendor_code, 'FEE_SUBSCRIPTION' AS head_code, 'FEE_SUBSCRIPTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1512' AS vendor_code, 'REPAIRS_MAINTENANCE_CAPEX' AS head_code, 'CAPEX_FURNITURE_FIXTURE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1131' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'COMPANY_DATA' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1110' AS vendor_code, 'HIRING_CHARGES' AS head_code, 'COMPUTER_HIRE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1611' AS vendor_code, 'REPAIRS_MAINTENANCE_CAPEX' AS head_code, 'CAPEX_FURNITURE_FIXTURE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1632' AS vendor_code, 'BUSINESS_PROMOTION' AS head_code, 'BUSINESS_PROMOTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1633' AS vendor_code, 'BUSINESS_PROMOTION' AS head_code, 'BUSINESS_PROMOTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1609' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'COMPUTER_PERIPHERALS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1634' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'OFFICE_REPAIRS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1635' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'AC_REPAIRS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1636' AS vendor_code, 'BUSINESS_PROMOTION' AS head_code, 'BUSINESS_PROMOTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1637' AS vendor_code, 'BUSINESS_PROMOTION' AS head_code, 'BUSINESS_PROMOTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1638' AS vendor_code, 'HIRING_CHARGES' AS head_code, 'COMPUTER_HIRE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1611' AS vendor_code, 'REPAIRS_MAINTENANCE_CAPEX' AS head_code, 'CAPEX_FURNITURE_FIXTURE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1639' AS vendor_code, 'FEE_SUBSCRIPTION' AS head_code, 'FEE_SUBSCRIPTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1640' AS vendor_code, 'FEE_SUBSCRIPTION' AS head_code, 'FEE_SUBSCRIPTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1641' AS vendor_code, 'BUSINESS_PROMOTION' AS head_code, 'BUSINESS_PROMOTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1642' AS vendor_code, 'LEGAL_CONSULTANCY' AS head_code, 'LEGAL_PROFESSIONAL' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1643' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'OFFICE_REPAIRS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1581' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'COMPUTER_PERIPHERALS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1644' AS vendor_code, 'FEE_SUBSCRIPTION' AS head_code, 'FEE_SUBSCRIPTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1645' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'AC_REPAIRS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1646' AS vendor_code, 'INSURANCE_EXPENSES' AS head_code, 'INFRA_INSURANCE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1647' AS vendor_code, 'OFFICE_RENT' AS head_code, 'OFFICE_RENT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1648' AS vendor_code, 'ELECTRICITY' AS head_code, 'ELECTRICITY_GOVT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1649' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'OFFICE_REPAIRS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1650' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'COMPUTER_PERIPHERALS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1629' AS vendor_code, 'LEGAL_CONSULTANCY' AS head_code, 'LEGAL_PROFESSIONAL' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1579' AS vendor_code, 'REPAIRS_MAINTENANCE_CAPEX' AS head_code, 'CAPEX_OTHER' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1653' AS vendor_code, 'PRINTING_STATIONERY' AS head_code, 'OFFICE_STATIONERY' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1655' AS vendor_code, 'LEGAL_CONSULTANCY' AS head_code, 'LEGAL_PROFESSIONAL' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1656' AS vendor_code, 'LEGAL_CONSULTANCY' AS head_code, 'LEGAL_PROFESSIONAL' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1619' AS vendor_code, 'REPAIRS_MAINTENANCE_CAPEX' AS head_code, 'CAPEX_FURNITURE_FIXTURE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1590' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'ELECTRICAL_REPAIRS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1653' AS vendor_code, 'STAFF_WELFARE' AS head_code, 'RNR_EXPENSES' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1552' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'OFFICE_REPAIRS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1581' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'COMPANY_DATA' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1657' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'COMPUTER_PERIPHERALS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1658' AS vendor_code, 'REPAIRS_MAINTENANCE_CAPEX' AS head_code, 'CAPEX_OTHER' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1659' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'COMPUTER_PERIPHERALS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1557' AS vendor_code, 'REPAIRS_MAINTENANCE_CAPEX' AS head_code, 'CAPEX_ELECTRICAL' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1652' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'COMPUTER_PERIPHERALS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1660' AS vendor_code, 'OFFICE_MAINTENANCE' AS head_code, 'CAFETERIA_MAINTENANCE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1662' AS vendor_code, 'STAFF_WELFARE' AS head_code, 'RNR_EXPENSES' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1663' AS vendor_code, 'BUSINESS_PROMOTION' AS head_code, 'BUSINESS_PROMOTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1665' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'COMPUTER_PERIPHERALS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1666' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'ELECTRICAL_REPAIRS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1669' AS vendor_code, 'FEE_SUBSCRIPTION' AS head_code, 'FEE_SUBSCRIPTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1671' AS vendor_code, 'FEE_SUBSCRIPTION' AS head_code, 'FEE_SUBSCRIPTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1673' AS vendor_code, 'BUSINESS_PROMOTION' AS head_code, 'BUSINESS_PROMOTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1674' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'OFFICE_REPAIRS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1675' AS vendor_code, 'FEE_SUBSCRIPTION' AS head_code, 'FEE_SUBSCRIPTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1676' AS vendor_code, 'LEGAL_CONSULTANCY' AS head_code, 'LEGAL_PROFESSIONAL' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1678' AS vendor_code, 'FEE_SUBSCRIPTION' AS head_code, 'FEE_SUBSCRIPTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1679' AS vendor_code, 'STAFF_TRAINING_RECRUITMENT' AS head_code, 'RECRUITMENT_ADVERTISEMENT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1681' AS vendor_code, 'FEE_SUBSCRIPTION' AS head_code, 'FEE_SUBSCRIPTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1681' AS vendor_code, 'LEGAL_CONSULTANCY' AS head_code, 'LEGAL_PROFESSIONAL' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1681' AS vendor_code, 'LEGAL_CONSULTANCY' AS head_code, 'LEGAL_PROFESSIONAL' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1682' AS vendor_code, 'FEE_SUBSCRIPTION' AS head_code, 'FEE_SUBSCRIPTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1475' AS vendor_code, 'BUSINESS_PROMOTION' AS head_code, 'BUSINESS_PROMOTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1569' AS vendor_code, 'FEE_SUBSCRIPTION' AS head_code, 'FEE_SUBSCRIPTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1683' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'OFFICE_REPAIRS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1684' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'OFFICE_REPAIRS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1663' AS vendor_code, 'SPOT_FLOOR_FIELD_INCENTIVE' AS head_code, 'SPOT_INCENTIVE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1685' AS vendor_code, 'BUSINESS_PROMOTION' AS head_code, 'BUSINESS_PROMOTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1686' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'OFFICE_REPAIRS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1687' AS vendor_code, 'LEGAL_CONSULTANCY' AS head_code, 'LEGAL_PROFESSIONAL' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1688' AS vendor_code, 'LEGAL_CONSULTANCY' AS head_code, 'LEGAL_PROFESSIONAL' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1689' AS vendor_code, 'FEE_SUBSCRIPTION' AS head_code, 'FEE_SUBSCRIPTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1690' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'OFFICE_REPAIRS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1601' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'ELECTRICAL_REPAIRS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1692' AS vendor_code, 'STAFF_WELFARE' AS head_code, 'RNR_EXPENSES' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1691' AS vendor_code, 'STAFF_WELFARE' AS head_code, 'RNR_EXPENSES' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1693' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'VEHICLE_REPAIR' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1694' AS vendor_code, 'STAFF_TRAINING_RECRUITMENT' AS head_code, 'RECRUITMENT_ADVERTISEMENT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1695' AS vendor_code, 'STAFF_TRAINING_RECRUITMENT' AS head_code, 'RECRUITMENT_ADVERTISEMENT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1696' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'AC_REPAIRS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1697' AS vendor_code, 'STAFF_WELFARE' AS head_code, 'RNR_EXPENSES' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1698' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'OFFICE_REPAIRS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1699' AS vendor_code, 'PRINTING_STATIONERY' AS head_code, 'OFFICE_STATIONERY' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1471' AS vendor_code, 'STAFF_WELFARE' AS head_code, 'RNR_EXPENSES' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1700' AS vendor_code, 'FEE_SUBSCRIPTION' AS head_code, 'FEE_SUBSCRIPTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1702' AS vendor_code, 'REPAIRS_MAINTENANCE_CAPEX' AS head_code, 'CAPEX_FURNITURE_FIXTURE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1703' AS vendor_code, 'OFFICE_RENT' AS head_code, 'OFFICE_RENT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1704' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'COMPUTER_PERIPHERALS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1338' AS vendor_code, 'REPAIRS_MAINTENANCE_CAPEX' AS head_code, 'CAPEX_ELECTRICAL' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1348' AS vendor_code, 'REPAIRS_MAINTENANCE_CAPEX' AS head_code, 'CAPEX_OTHER' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1348' AS vendor_code, 'REPAIRS_MAINTENANCE_CAPEX' AS head_code, 'CAPEX_FURNITURE_FIXTURE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1701' AS vendor_code, 'REPAIRS_MAINTENANCE_CAPEX' AS head_code, 'CAPEX_ELECTRICAL' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1595' AS vendor_code, 'REPAIRS_MAINTENANCE_CAPEX' AS head_code, 'CAPEX_FURNITURE_FIXTURE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1705' AS vendor_code, 'BUSINESS_PROMOTION' AS head_code, 'BUSINESS_PROMOTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1707' AS vendor_code, 'REPAIRS_MAINTENANCE_CAPEX' AS head_code, 'CAPEX_FURNITURE_FIXTURE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1350' AS vendor_code, 'REPAIRS_MAINTENANCE_CAPEX' AS head_code, 'CAPEX_FURNITURE_FIXTURE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1706' AS vendor_code, 'REPAIRS_MAINTENANCE_CAPEX' AS head_code, 'CAPEX_FURNITURE_FIXTURE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1708' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'COMPANY_DATA' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1709' AS vendor_code, 'LEGAL_CONSULTANCY' AS head_code, 'LEGAL_PROFESSIONAL' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1710' AS vendor_code, 'LEGAL_CONSULTANCY' AS head_code, 'LEGAL_PROFESSIONAL' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1712' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'COMPUTER_PERIPHERALS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1713' AS vendor_code, 'REPAIRS_MAINTENANCE_CAPEX' AS head_code, 'CAPEX_FURNITURE_FIXTURE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1715' AS vendor_code, 'LEGAL_CONSULTANCY' AS head_code, 'LEGAL_PROFESSIONAL' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1716' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'OFFICE_REPAIRS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1337' AS vendor_code, 'REPAIRS_MAINTENANCE_CAPEX' AS head_code, 'CAPEX_FURNITURE_FIXTURE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1337' AS vendor_code, 'REPAIRS_MAINTENANCE_CAPEX' AS head_code, 'CAPEX_ELECTRICAL' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1711' AS vendor_code, 'REPAIRS_MAINTENANCE_CAPEX' AS head_code, 'CAPEX_ELECTRICAL' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1717' AS vendor_code, 'OFFICE_MAINTENANCE' AS head_code, 'CLEANING_MATERIAL' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1714' AS vendor_code, 'REPAIRS_MAINTENANCE_CAPEX' AS head_code, 'CAPEX_FURNITURE_FIXTURE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1714' AS vendor_code, 'REPAIRS_MAINTENANCE_CAPEX' AS head_code, 'CAPEX_ELECTRICAL' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1605' AS vendor_code, 'CONTRACT_FEES_FACILITIES' AS head_code, 'FACILITY_STAFF' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1711' AS vendor_code, 'REPAIRS_MAINTENANCE_CAPEX' AS head_code, 'CAPEX_FURNITURE_FIXTURE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1718' AS vendor_code, 'REPAIRS_MAINTENANCE_CAPEX' AS head_code, 'CAPEX_FURNITURE_FIXTURE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1723' AS vendor_code, 'REPAIRS_MAINTENANCE_CAPEX' AS head_code, 'CAPEX_FURNITURE_FIXTURE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1720' AS vendor_code, 'REPAIRS_MAINTENANCE_CAPEX' AS head_code, 'CAPEX_FURNITURE_FIXTURE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1725' AS vendor_code, 'STAFF_WELFARE' AS head_code, 'RNR_EXPENSES' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1724' AS vendor_code, 'REPAIRS_MAINTENANCE_CAPEX' AS head_code, 'CAPEX_FURNITURE_FIXTURE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_262' AS vendor_code, 'TOUR_EXPENSES' AS head_code, 'TOUR_EXPENSES' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1730' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'VEHICLE_REPAIR' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1731' AS vendor_code, 'PRINTING_STATIONERY' AS head_code, 'OFFICE_STATIONERY' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1732' AS vendor_code, 'LEGAL_CONSULTANCY' AS head_code, 'LEGAL_PROFESSIONAL' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1727' AS vendor_code, 'REPAIRS_MAINTENANCE_CAPEX' AS head_code, 'CAPEX_FURNITURE_FIXTURE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1733' AS vendor_code, 'REPAIRS_MAINTENANCE_CAPEX' AS head_code, 'CAPEX_FURNITURE_FIXTURE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1734' AS vendor_code, 'REPAIRS_MAINTENANCE_CAPEX' AS head_code, 'CAPEX_FURNITURE_FIXTURE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1548' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'COMPUTER_PERIPHERALS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1735' AS vendor_code, 'FEE_SUBSCRIPTION' AS head_code, 'FEE_SUBSCRIPTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1719' AS vendor_code, 'REPAIRS_MAINTENANCE_CAPEX' AS head_code, 'CAPEX_FURNITURE_FIXTURE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1468' AS vendor_code, 'OFFICE_MAINTENANCE' AS head_code, 'CAFETERIA_MAINTENANCE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1738' AS vendor_code, 'REPAIRS_MAINTENANCE_CAPEX' AS head_code, 'CAPEX_OTHER' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1739' AS vendor_code, 'PRINTING_STATIONERY' AS head_code, 'OFFICE_STATIONERY' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1741' AS vendor_code, 'PRINTING_STATIONERY' AS head_code, 'OFFICE_STATIONERY' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1742' AS vendor_code, 'REPAIRS_MAINTENANCE_CAPEX' AS head_code, 'CAPEX_FURNITURE_FIXTURE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1743' AS vendor_code, 'REPAIRS_MAINTENANCE_CAPEX' AS head_code, 'CAPEX_FURNITURE_FIXTURE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1744' AS vendor_code, 'REPAIRS_MAINTENANCE_CAPEX' AS head_code, 'CAPEX_FURNITURE_FIXTURE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1745' AS vendor_code, 'REPAIRS_MAINTENANCE_CAPEX' AS head_code, 'CAPEX_FURNITURE_FIXTURE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_648' AS vendor_code, 'PRINTING_STATIONERY' AS head_code, 'OFFICE_STATIONERY' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1468' AS vendor_code, 'REPAIRS_MAINTENANCE_CAPEX' AS head_code, 'CAPEX_OTHER' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1748' AS vendor_code, 'OFFICE_RENT' AS head_code, 'OFFICE_RENT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1750' AS vendor_code, 'REPAIRS_MAINTENANCE_CAPEX' AS head_code, 'CAPEX_ELECTRICAL' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1751' AS vendor_code, 'REPAIRS_MAINTENANCE_CAPEX' AS head_code, 'CAPEX_ELECTRICAL' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1638' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'COMPUTER_PERIPHERALS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1752' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'OFFICE_REPAIRS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1662' AS vendor_code, 'REPAIRS_MAINTENANCE_CAPEX' AS head_code, 'CAPEX_ELECTRICAL' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1753' AS vendor_code, 'CONTRACT_FEES_FACILITIES' AS head_code, 'FACILITY_STAFF' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1748' AS vendor_code, 'OFFICE_MAINTENANCE' AS head_code, 'CAFETERIA_MAINTENANCE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1754' AS vendor_code, 'STAFF_WELFARE' AS head_code, 'DRINKING_WATER' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1756' AS vendor_code, 'CONTRACT_FEES_FACILITIES' AS head_code, 'FACILITY_STAFF' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1755' AS vendor_code, 'REPAIRS_MAINTENANCE_CAPEX' AS head_code, 'CAPEX_ELECTRICAL' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1757' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'AC_REPAIRS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1758' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'COMPUTER_PERIPHERALS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1756' AS vendor_code, 'OFFICE_MAINTENANCE' AS head_code, 'CLEANING_MATERIAL' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1759' AS vendor_code, 'REPAIRS_MAINTENANCE_CAPEX' AS head_code, 'CAPEX_FURNITURE_FIXTURE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1760' AS vendor_code, 'REPAIRS_MAINTENANCE_CAPEX' AS head_code, 'CAPEX_FURNITURE_FIXTURE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1761' AS vendor_code, 'REPAIRS_MAINTENANCE_CAPEX' AS head_code, 'CAPEX_FURNITURE_FIXTURE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1756' AS vendor_code, 'OFFICE_MAINTENANCE' AS head_code, 'CAFETERIA_MAINTENANCE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1763' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'OFFICE_REPAIRS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1597' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'OFFICE_REPAIRS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1764' AS vendor_code, 'REPAIRS_MAINTENANCE_CAPEX' AS head_code, 'CAPEX_FURNITURE_FIXTURE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1765' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'COMPANY_DATA' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1767' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'OFFICE_REPAIRS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1768' AS vendor_code, 'SECURITY_SERVICE' AS head_code, 'SECURITY_SERVICE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1769' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'OFFICE_REPAIRS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1769' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'AC_REPAIRS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1770' AS vendor_code, 'STAFF_WELFARE' AS head_code, 'RNR_EXPENSES' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1771' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'VEHICLE_REPAIR' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1772' AS vendor_code, 'STAFF_WELFARE' AS head_code, 'REFRESHMENT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1773' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'OFFICE_REPAIRS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1494' AS vendor_code, 'REPAIRS_MAINTENANCE_CAPEX' AS head_code, 'CAPEX_ELECTRICAL' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1775' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'ELECTRICAL_REPAIRS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_633' AS vendor_code, 'FEE_SUBSCRIPTION' AS head_code, 'FEE_SUBSCRIPTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1772' AS vendor_code, 'BUSINESS_PROMOTION' AS head_code, 'BUSINESS_PROMOTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1776' AS vendor_code, 'STAFF_WELFARE' AS head_code, 'REFRESHMENT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1777' AS vendor_code, 'REPAIRS_MAINTENANCE_CAPEX' AS head_code, 'CAPEX_ELECTRICAL' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_583' AS vendor_code, 'REPAIRS_MAINTENANCE_CAPEX' AS head_code, 'CAPEX_ELECTRICAL' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1778' AS vendor_code, 'OFFICE_MAINTENANCE' AS head_code, 'CLEANING_MATERIAL' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1779' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'OFFICE_REPAIRS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1755' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'COMPUTER_PERIPHERALS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1338' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'ELECTRICAL_REPAIRS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_551' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'COMPUTER_PERIPHERALS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_551' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'COMPANY_DATA' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1781' AS vendor_code, 'FEE_SUBSCRIPTION' AS head_code, 'FEE_SUBSCRIPTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1782' AS vendor_code, 'REPAIRS_MAINTENANCE_CAPEX' AS head_code, 'CAPEX_OTHER' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1783' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'OFFICE_REPAIRS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1723' AS vendor_code, 'REPAIRS_MAINTENANCE_CAPEX' AS head_code, 'CAPEX_FURNITURE_FIXTURE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1784' AS vendor_code, 'PRINTING_STATIONERY' AS head_code, 'OFFICE_STATIONERY' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1785' AS vendor_code, 'STAFF_WELFARE' AS head_code, 'FESTIVAL_EXPENSE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1786' AS vendor_code, 'STAFF_WELFARE' AS head_code, 'FESTIVAL_EXPENSE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1787' AS vendor_code, 'FEE_SUBSCRIPTION' AS head_code, 'FEE_SUBSCRIPTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1788' AS vendor_code, 'OFFICE_MAINTENANCE' AS head_code, 'CLEANING_MATERIAL' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1789' AS vendor_code, 'REPAIRS_MAINTENANCE_CAPEX' AS head_code, 'CAPEX_FURNITURE_FIXTURE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1790' AS vendor_code, 'PRINTING_STATIONERY' AS head_code, 'OFFICE_STATIONERY' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1792' AS vendor_code, 'REPAIRS_MAINTENANCE_CAPEX' AS head_code, 'CAPEX_ELECTRICAL' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1791' AS vendor_code, 'OFFICE_MAINTENANCE' AS head_code, 'CAFETERIA_MAINTENANCE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1791' AS vendor_code, 'OFFICE_RENT' AS head_code, 'OFFICE_RENT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1793' AS vendor_code, 'BUSINESS_PROMOTION' AS head_code, 'BUSINESS_PROMOTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1794' AS vendor_code, 'STAFF_TRAINING_RECRUITMENT' AS head_code, 'RECRUITMENT_ADVERTISEMENT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1796' AS vendor_code, 'STAFF_WELFARE' AS head_code, 'FESTIVAL_EXPENSE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1797' AS vendor_code, 'REPAIRS_MAINTENANCE_CAPEX' AS head_code, 'CAPEX_FURNITURE_FIXTURE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1798' AS vendor_code, 'STAFF_WELFARE' AS head_code, 'FESTIVAL_EXPENSE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1326' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'COMPUTER_PERIPHERALS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1799' AS vendor_code, 'LEGAL_CONSULTANCY' AS head_code, 'LEGAL_PROFESSIONAL' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1800' AS vendor_code, 'LEGAL_CONSULTANCY' AS head_code, 'LEGAL_PROFESSIONAL' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1801' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'COMPUTER_PERIPHERALS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1791' AS vendor_code, 'ELECTRICITY' AS head_code, 'ELECTRICITY_GOVT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1802' AS vendor_code, 'LEGAL_CONSULTANCY' AS head_code, 'LEGAL_PROFESSIONAL' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1803' AS vendor_code, 'PRINTING_STATIONERY' AS head_code, 'OFFICE_STATIONERY' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1804' AS vendor_code, 'STAFF_WELFARE' AS head_code, 'DRINKING_WATER' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1805' AS vendor_code, 'STAFF_TRAINING_RECRUITMENT' AS head_code, 'RECRUITMENT_ADVERTISEMENT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1806' AS vendor_code, 'TOUR_EXPENSES' AS head_code, 'TOUR_EXPENSES' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1807' AS vendor_code, 'TOUR_EXPENSES' AS head_code, 'TOUR_EXPENSES' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1808' AS vendor_code, 'REPAIRS_MAINTENANCE_CAPEX' AS head_code, 'CAPEX_ELECTRICAL' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_709' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'COMPUTER_PERIPHERALS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1809' AS vendor_code, 'CONTRACT_FEES_FACILITIES' AS head_code, 'FACILITY_STAFF' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_363' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'COMPUTER_PERIPHERALS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1810' AS vendor_code, 'PRINTING_STATIONERY' AS head_code, 'OFFICE_STATIONERY' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1703' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'OFFICE_REPAIRS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1811' AS vendor_code, 'LEGAL_CONSULTANCY' AS head_code, 'LEGAL_PROFESSIONAL' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1812' AS vendor_code, 'LEGAL_CONSULTANCY' AS head_code, 'LEGAL_PROFESSIONAL' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1515' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'COMPANY_VOICE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1813' AS vendor_code, 'FEE_SUBSCRIPTION' AS head_code, 'FEE_SUBSCRIPTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1552' AS vendor_code, 'REPAIRS_MAINTENANCE_CAPEX' AS head_code, 'CAPEX_ELECTRICAL' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1814' AS vendor_code, 'FEE_SUBSCRIPTION' AS head_code, 'FEE_SUBSCRIPTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1719' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'ELECTRICAL_REPAIRS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1144' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'COMPANY_VOICE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1596' AS vendor_code, 'STAFF_TRAINING_RECRUITMENT' AS head_code, 'RECRUITMENT_ADVERTISEMENT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1794' AS vendor_code, 'FEE_SUBSCRIPTION' AS head_code, 'FEE_SUBSCRIPTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1815' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'OFFICE_REPAIRS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1816' AS vendor_code, 'LEGAL_CONSULTANCY' AS head_code, 'LEGAL_PROFESSIONAL' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1817' AS vendor_code, 'STAFF_TRAINING_RECRUITMENT' AS head_code, 'RECRUITMENT_ADVERTISEMENT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1818' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'COMPUTER_PERIPHERALS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1819' AS vendor_code, 'STAFF_WELFARE' AS head_code, 'RNR_EXPENSES' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1820' AS vendor_code, 'OFFICE_MAINTENANCE' AS head_code, 'CAFETERIA_MAINTENANCE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1821' AS vendor_code, 'OFFICE_MAINTENANCE' AS head_code, 'CLEANING_MATERIAL' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1805' AS vendor_code, 'FEE_SUBSCRIPTION' AS head_code, 'FEE_SUBSCRIPTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1144' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'COMPANY_DATA' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1822' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'COMPUTER_PERIPHERALS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1823' AS vendor_code, 'TOURS_TRAVELLING_CONVEYANCE' AS head_code, 'LOCAL_CONVEYANCE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1824' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'VEHICLE_REPAIR' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1825' AS vendor_code, 'STAFF_TRAINING_RECRUITMENT' AS head_code, 'RECRUITMENT_ADVERTISEMENT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1826' AS vendor_code, 'FEE_SUBSCRIPTION' AS head_code, 'FEE_SUBSCRIPTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1144' AS vendor_code, 'STAFF_WELFARE' AS head_code, 'RNR_EXPENSES' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1729' AS vendor_code, 'PRINTING_STATIONERY' AS head_code, 'OFFICE_STATIONERY' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1752' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'COMPUTER_PERIPHERALS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1144' AS vendor_code, 'PRINTING_STATIONERY' AS head_code, 'OFFICE_STATIONERY' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1144' AS vendor_code, 'PRINTING_STATIONERY' AS head_code, 'PHOTOCOPY' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1341' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'COMPANY_DATA' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1565' AS vendor_code, 'LEGAL_CONSULTANCY' AS head_code, 'LEGAL_PROFESSIONAL' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1827' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'AC_REPAIRS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1810' AS vendor_code, 'STAFF_WELFARE' AS head_code, 'RNR_EXPENSES' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1828' AS vendor_code, 'LEGAL_CONSULTANCY' AS head_code, 'LEGAL_PROFESSIONAL' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1829' AS vendor_code, 'LEGAL_CONSULTANCY' AS head_code, 'LEGAL_PROFESSIONAL' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1795' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'COMPUTER_PERIPHERALS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1830' AS vendor_code, 'STAFF_WELFARE' AS head_code, 'REFRESHMENT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1809' AS vendor_code, 'SECURITY_SERVICE' AS head_code, 'SECURITY_SERVICE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1830' AS vendor_code, 'STAFF_WELFARE' AS head_code, 'RNR_EXPENSES' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1831' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'COMPANY_DATA' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1832' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'COMPUTER_PERIPHERALS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1833' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'COMPUTER_PERIPHERALS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1834' AS vendor_code, 'STAFF_TRAINING_RECRUITMENT' AS head_code, 'RECRUITMENT_ADVERTISEMENT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1835' AS vendor_code, 'FEE_SUBSCRIPTION' AS head_code, 'FEE_SUBSCRIPTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1836' AS vendor_code, 'FEE_SUBSCRIPTION' AS head_code, 'FEE_SUBSCRIPTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1748' AS vendor_code, 'ELECTRICITY' AS head_code, 'ELECTRICITY_GOVT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1837' AS vendor_code, 'CONTRACT_FEES_FACILITIES' AS head_code, 'FACILITY_STAFF' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1837' AS vendor_code, 'OFFICE_MAINTENANCE' AS head_code, 'CLEANING_MATERIAL' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1838' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'COMPUTER_PERIPHERALS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1715' AS vendor_code, 'FEE_SUBSCRIPTION' AS head_code, 'FEE_SUBSCRIPTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1542' AS vendor_code, 'FEE_SUBSCRIPTION' AS head_code, 'FEE_SUBSCRIPTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1839' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'ELECTRICAL_REPAIRS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1832' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'UPS_NETWORKING' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1840' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'OFFICE_REPAIRS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1791' AS vendor_code, 'HIRING_CHARGES' AS head_code, 'GENERATOR_HIRE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1746' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'COMPUTER_PERIPHERALS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1841' AS vendor_code, 'PRINTING_STATIONERY' AS head_code, 'OFFICE_STATIONERY' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1842' AS vendor_code, 'BUSINESS_PROMOTION' AS head_code, 'BUSINESS_PROMOTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1774' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'COMPUTER_PERIPHERALS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1843' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'COMPANY_VOICE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1844' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'OFFICE_REPAIRS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1845' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'COMPUTER_PERIPHERALS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1846' AS vendor_code, 'FEE_SUBSCRIPTION' AS head_code, 'FEE_SUBSCRIPTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1825' AS vendor_code, 'FEE_SUBSCRIPTION' AS head_code, 'FEE_SUBSCRIPTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1847' AS vendor_code, 'TOUR_EXPENSES' AS head_code, 'TOUR_EXPENSES' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1202' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'COMPANY_VOICE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1848' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'COMPANY_DATA' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1144' AS vendor_code, 'STAFF_TRAINING_RECRUITMENT' AS head_code, 'RECRUITMENT_ADVERTISEMENT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1849' AS vendor_code, 'STAFF_WELFARE' AS head_code, 'FESTIVAL_EXPENSE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1850' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'COMPUTER_PERIPHERALS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1851' AS vendor_code, 'STAFF_WELFARE' AS head_code, 'FESTIVAL_EXPENSE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_551' AS vendor_code, 'FEE_SUBSCRIPTION' AS head_code, 'FEE_SUBSCRIPTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1853' AS vendor_code, 'INSURANCE_EXPENSES' AS head_code, 'CAR_INSURANCE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1854' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'COMPANY_DATA' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_551' AS vendor_code, 'FEE_SUBSCRIPTION' AS head_code, 'FEE_SUBSCRIPTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1855' AS vendor_code, 'FEE_SUBSCRIPTION' AS head_code, 'FEE_SUBSCRIPTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1144' AS vendor_code, 'STAFF_WELFARE' AS head_code, 'FESTIVAL_EXPENSE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1856' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'COMPUTER_PERIPHERALS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1857' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'COMPUTER_PERIPHERALS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1144' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'MOBILE_INTERNET_REIMBURSEMENT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1858' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'COMPUTER_PERIPHERALS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1859' AS vendor_code, 'FEE_SUBSCRIPTION' AS head_code, 'FEE_SUBSCRIPTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1555' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'COMPUTER_PERIPHERALS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1860' AS vendor_code, 'STAFF_WELFARE' AS head_code, 'REFRESHMENT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1861' AS vendor_code, 'STAFF_WELFARE' AS head_code, 'REFRESHMENT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1862' AS vendor_code, 'TOUR_EXPENSES' AS head_code, 'TOUR_EXPENSES' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1863' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'OFFICE_REPAIRS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1863' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'AC_REPAIRS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1864' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'VEHICLE_REPAIR' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1867' AS vendor_code, 'PRINTING_STATIONERY' AS head_code, 'OFFICE_STATIONERY' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1868' AS vendor_code, 'REPAIRS_MAINTENANCE_CAPEX' AS head_code, 'CAPEX_FURNITURE_FIXTURE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1202' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'ELECTRICAL_REPAIRS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1869' AS vendor_code, 'REPAIRS_MAINTENANCE_CAPEX' AS head_code, 'CAPEX_ELECTRICAL' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1872' AS vendor_code, 'PRINTING_STATIONERY' AS head_code, 'OFFICE_STATIONERY' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1873' AS vendor_code, 'STAFF_WELFARE' AS head_code, 'RNR_EXPENSES' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1867' AS vendor_code, 'OFFICE_MAINTENANCE' AS head_code, 'CLEANING_MATERIAL' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1874' AS vendor_code, 'LEGAL_CONSULTANCY' AS head_code, 'LEGAL_PROFESSIONAL' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1873' AS vendor_code, 'STAFF_WELFARE' AS head_code, 'REFRESHMENT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1875' AS vendor_code, 'REPAIRS_MAINTENANCE_CAPEX' AS head_code, 'CAPEX_FURNITURE_FIXTURE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1876' AS vendor_code, 'REPAIRS_MAINTENANCE_CAPEX' AS head_code, 'CAPEX_ELECTRICAL' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1543' AS vendor_code, 'REPAIRS_MAINTENANCE_CAPEX' AS head_code, 'CAPEX_ELECTRICAL' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1878' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'COMPUTER_PERIPHERALS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1202' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'COMPUTER_PERIPHERALS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1080' AS vendor_code, 'TOURS_TRAVELLING_CONVEYANCE' AS head_code, 'LOCAL_CONVEYANCE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1865' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'AC_REPAIRS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1867' AS vendor_code, 'STAFF_WELFARE' AS head_code, 'RNR_EXPENSES' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1879' AS vendor_code, 'BUSINESS_PROMOTION' AS head_code, 'BUSINESS_PROMOTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1880' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'AC_REPAIRS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1881' AS vendor_code, 'SECURITY_SERVICE' AS head_code, 'SECURITY_SERVICE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1601' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'UPS_NETWORKING' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1878' AS vendor_code, 'OFFICE_MAINTENANCE' AS head_code, 'CAFETERIA_MAINTENANCE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1883' AS vendor_code, 'BUSINESS_PROMOTION' AS head_code, 'BUSINESS_PROMOTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1882' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'ELECTRICAL_REPAIRS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1884' AS vendor_code, 'TOURS_TRAVELLING_CONVEYANCE' AS head_code, 'LOCAL_CONVEYANCE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1900' AS vendor_code, 'PRINTING_STATIONERY' AS head_code, 'OFFICE_STATIONERY' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1792' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'AC_REPAIRS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1886' AS vendor_code, 'STAFF_WELFARE' AS head_code, 'DRINKING_WATER' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1887' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'COMPUTER_PERIPHERALS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1654' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'UPS_NETWORKING' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1888' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'OFFICE_REPAIRS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1889' AS vendor_code, 'PRINTING_STATIONERY' AS head_code, 'OFFICE_STATIONERY' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1890' AS vendor_code, 'TOUR_EXPENSES' AS head_code, 'TOUR_EXPENSES' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1891' AS vendor_code, 'STAFF_WELFARE' AS head_code, 'RNR_EXPENSES' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1892' AS vendor_code, 'FEE_SUBSCRIPTION' AS head_code, 'FEE_SUBSCRIPTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1847' AS vendor_code, 'STAFF_WELFARE' AS head_code, 'RNR_EXPENSES' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1548' AS vendor_code, 'REPAIRS_MAINTENANCE_CAPEX' AS head_code, 'CAPEX_ELECTRICAL' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1893' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'COMPUTER_PERIPHERALS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1706' AS vendor_code, 'OFFICE_MAINTENANCE' AS head_code, 'CLEANING_MATERIAL' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1894' AS vendor_code, 'REPAIRS_MAINTENANCE_CAPEX' AS head_code, 'CAPEX_ELECTRICAL' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1895' AS vendor_code, 'REPAIRS_MAINTENANCE_CAPEX' AS head_code, 'CAPEX_FURNITURE_FIXTURE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1896' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'AC_REPAIRS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1897' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'AC_REPAIRS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1898' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'COMPUTER_PERIPHERALS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1899' AS vendor_code, 'BUSINESS_PROMOTION' AS head_code, 'BUSINESS_PROMOTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1900' AS vendor_code, 'PRINTING_STATIONERY' AS head_code, 'OFFICE_STATIONERY' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1901' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'COMPANY_DATA' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1902' AS vendor_code, 'BUSINESS_PROMOTION' AS head_code, 'BUSINESS_PROMOTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1903' AS vendor_code, 'BUSINESS_PROMOTION' AS head_code, 'BUSINESS_PROMOTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1904' AS vendor_code, 'BUSINESS_PROMOTION' AS head_code, 'BUSINESS_PROMOTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1905' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'AC_REPAIRS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1582' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'COMPUTER_PERIPHERALS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1906' AS vendor_code, 'BUSINESS_PROMOTION' AS head_code, 'BUSINESS_PROMOTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1907' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'COMPUTER_PERIPHERALS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1908' AS vendor_code, 'FEE_SUBSCRIPTION' AS head_code, 'FEE_SUBSCRIPTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1909' AS vendor_code, 'BUSINESS_PROMOTION' AS head_code, 'BUSINESS_PROMOTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1831' AS vendor_code, 'BUSINESS_PROMOTION' AS head_code, 'BUSINESS_PROMOTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1910' AS vendor_code, 'BUSINESS_PROMOTION' AS head_code, 'BUSINESS_PROMOTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1911' AS vendor_code, 'BUSINESS_PROMOTION' AS head_code, 'BUSINESS_PROMOTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1913' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'COMPANY_DATA' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1765' AS vendor_code, 'FEE_SUBSCRIPTION' AS head_code, 'FEE_SUBSCRIPTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1915' AS vendor_code, 'BUSINESS_PROMOTION' AS head_code, 'BUSINESS_PROMOTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1916' AS vendor_code, 'LEGAL_CONSULTANCY' AS head_code, 'LEGAL_PROFESSIONAL' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1917' AS vendor_code, 'BUSINESS_PROMOTION' AS head_code, 'BUSINESS_PROMOTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1918' AS vendor_code, 'BUSINESS_PROMOTION' AS head_code, 'BUSINESS_PROMOTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1919' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'COMPANY_DATA' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1920' AS vendor_code, 'FEE_SUBSCRIPTION' AS head_code, 'FEE_SUBSCRIPTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1921' AS vendor_code, 'BUSINESS_PROMOTION' AS head_code, 'BUSINESS_PROMOTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1922' AS vendor_code, 'BUSINESS_PROMOTION' AS head_code, 'BUSINESS_PROMOTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1923' AS vendor_code, 'BUSINESS_PROMOTION' AS head_code, 'BUSINESS_PROMOTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1924' AS vendor_code, 'BUSINESS_PROMOTION' AS head_code, 'BUSINESS_PROMOTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1925' AS vendor_code, 'FEE_SUBSCRIPTION' AS head_code, 'FEE_SUBSCRIPTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1926' AS vendor_code, 'BUSINESS_PROMOTION' AS head_code, 'BUSINESS_PROMOTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1927' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'MOBILE_INTERNET_REIMBURSEMENT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1928' AS vendor_code, 'BUSINESS_PROMOTION' AS head_code, 'BUSINESS_PROMOTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1927' AS vendor_code, 'BUSINESS_PROMOTION' AS head_code, 'BUSINESS_PROMOTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1927' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'COMPANY_VOICE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1929' AS vendor_code, 'BUSINESS_PROMOTION' AS head_code, 'BUSINESS_PROMOTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1930' AS vendor_code, 'BUSINESS_PROMOTION' AS head_code, 'BUSINESS_PROMOTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1844' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'AC_REPAIRS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1931' AS vendor_code, 'STAFF_WELFARE' AS head_code, 'RNR_EXPENSES' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1932' AS vendor_code, 'OFFICE_MAINTENANCE' AS head_code, 'CAFETERIA_MAINTENANCE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1791' AS vendor_code, 'FEE_SUBSCRIPTION' AS head_code, 'FEE_SUBSCRIPTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1933' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'AC_REPAIRS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1934' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'COMPANY_VOICE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1934' AS vendor_code, 'TOURS_TRAVELLING_CONVEYANCE' AS head_code, 'LOCAL_CONVEYANCE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1765' AS vendor_code, 'LEGAL_CONSULTANCY' AS head_code, 'LEGAL_PROFESSIONAL' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1131' AS vendor_code, 'FEE_SUBSCRIPTION' AS head_code, 'FEE_SUBSCRIPTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1935' AS vendor_code, 'OFFICE_MAINTENANCE' AS head_code, 'CLEANING_MATERIAL' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1936' AS vendor_code, 'HIRING_CHARGES' AS head_code, 'COMPUTER_HIRE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1937' AS vendor_code, 'BUSINESS_PROMOTION' AS head_code, 'BUSINESS_PROMOTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1938' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'COMPANY_VOICE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1939' AS vendor_code, 'FEE_SUBSCRIPTION' AS head_code, 'FEE_SUBSCRIPTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1940' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'COMPANY_DATA' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1941' AS vendor_code, 'BUSINESS_PROMOTION' AS head_code, 'BUSINESS_PROMOTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1942' AS vendor_code, 'BUSINESS_PROMOTION' AS head_code, 'BUSINESS_PROMOTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1943' AS vendor_code, 'FEE_SUBSCRIPTION' AS head_code, 'FEE_SUBSCRIPTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1944' AS vendor_code, 'STAFF_WELFARE' AS head_code, 'RNR_EXPENSES' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1945' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'COMPUTER_PERIPHERALS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1946' AS vendor_code, 'STAFF_WELFARE' AS head_code, 'RNR_EXPENSES' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1877' AS vendor_code, 'OFFICE_MAINTENANCE' AS head_code, 'CAFETERIA_MAINTENANCE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1947' AS vendor_code, 'STAFF_WELFARE' AS head_code, 'RNR_EXPENSES' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1948' AS vendor_code, 'LEGAL_CONSULTANCY' AS head_code, 'LEGAL_PROFESSIONAL' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1935' AS vendor_code, 'PRINTING_STATIONERY' AS head_code, 'OFFICE_STATIONERY' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1950' AS vendor_code, 'BUSINESS_PROMOTION' AS head_code, 'BUSINESS_PROMOTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1951' AS vendor_code, 'STAFF_WELFARE' AS head_code, 'RNR_EXPENSES' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1952' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'ELECTRICAL_REPAIRS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1953' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'COMPANY_VOICE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1954' AS vendor_code, 'STAFF_WELFARE' AS head_code, 'RNR_EXPENSES' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1955' AS vendor_code, 'OFFICE_MAINTENANCE' AS head_code, 'CAFETERIA_MAINTENANCE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1391' AS vendor_code, 'STAFF_WELFARE' AS head_code, 'RNR_EXPENSES' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1956' AS vendor_code, 'STAFF_WELFARE' AS head_code, 'RNR_EXPENSES' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1887' AS vendor_code, 'STAFF_WELFARE' AS head_code, 'RNR_EXPENSES' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1957' AS vendor_code, 'STAFF_WELFARE' AS head_code, 'REFRESHMENT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1958' AS vendor_code, 'BUSINESS_PROMOTION' AS head_code, 'BUSINESS_PROMOTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1959' AS vendor_code, 'FEE_SUBSCRIPTION' AS head_code, 'FEE_SUBSCRIPTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1960' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'COMPANY_VOICE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1961' AS vendor_code, 'BUSINESS_PROMOTION' AS head_code, 'BUSINESS_PROMOTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1962' AS vendor_code, 'BUSINESS_PROMOTION' AS head_code, 'BUSINESS_PROMOTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1963' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'UPS_NETWORKING' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1964' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'OFFICE_REPAIRS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1965' AS vendor_code, 'LEGAL_CONSULTANCY' AS head_code, 'LEGAL_PROFESSIONAL' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1966' AS vendor_code, 'FEE_SUBSCRIPTION' AS head_code, 'FEE_SUBSCRIPTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1968' AS vendor_code, 'BUSINESS_PROMOTION' AS head_code, 'BUSINESS_PROMOTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1241' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'COMPANY_DATA' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1412' AS vendor_code, 'TOUR_EXPENSES' AS head_code, 'TOUR_EXPENSES' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1970' AS vendor_code, 'INSURANCE_EXPENSES' AS head_code, 'INFRA_INSURANCE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1940' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'SMS_CHARGES' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1972' AS vendor_code, 'TOURS_TRAVELLING_CONVEYANCE' AS head_code, 'LOCAL_CONVEYANCE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1973' AS vendor_code, 'STAFF_TRAINING_RECRUITMENT' AS head_code, 'RECRUITMENT_ADVERTISEMENT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1974' AS vendor_code, 'BUSINESS_PROMOTION' AS head_code, 'BUSINESS_PROMOTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1975' AS vendor_code, 'BUSINESS_PROMOTION' AS head_code, 'BUSINESS_PROMOTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1202' AS vendor_code, 'STAFF_TRAINING_RECRUITMENT' AS head_code, 'RECRUITMENT_ADVERTISEMENT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1976' AS vendor_code, 'LEGAL_CONSULTANCY' AS head_code, 'LEGAL_PROFESSIONAL' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1977' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'POSTAGE_COURIER' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1979' AS vendor_code, 'LEGAL_CONSULTANCY' AS head_code, 'LEGAL_PROFESSIONAL' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1980' AS vendor_code, 'INSURANCE_EXPENSES' AS head_code, 'INFRA_INSURANCE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_376' AS vendor_code, 'INSURANCE_EXPENSES' AS head_code, 'INFRA_INSURANCE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1982' AS vendor_code, 'BUSINESS_PROMOTION' AS head_code, 'BUSINESS_PROMOTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1765' AS vendor_code, 'BUSINESS_PROMOTION' AS head_code, 'BUSINESS_PROMOTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1983' AS vendor_code, 'FEE_SUBSCRIPTION' AS head_code, 'FEE_SUBSCRIPTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1202' AS vendor_code, 'INSURANCE_EXPENSES' AS head_code, 'CAR_INSURANCE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1984' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'COMPANY_DATA' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_583' AS vendor_code, 'REPAIRS_MAINTENANCE_CAPEX' AS head_code, 'CAPEX_ELECTRICAL' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1805' AS vendor_code, 'BUSINESS_PROMOTION' AS head_code, 'BUSINESS_PROMOTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1987' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'AC_REPAIRS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1988' AS vendor_code, 'BUSINESS_PROMOTION' AS head_code, 'BUSINESS_PROMOTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1989' AS vendor_code, 'BUSINESS_PROMOTION' AS head_code, 'BUSINESS_PROMOTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1991' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'POSTAGE_COURIER' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1992' AS vendor_code, 'TOURS_TRAVELLING_CONVEYANCE' AS head_code, 'PARKING_CHARGES' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1993' AS vendor_code, 'BUSINESS_PROMOTION' AS head_code, 'BUSINESS_PROMOTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1994' AS vendor_code, 'PRINTING_STATIONERY' AS head_code, 'OFFICE_STATIONERY' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1995' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'COMPUTER_PERIPHERALS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1996' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'POSTAGE_COURIER' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1997' AS vendor_code, 'BUSINESS_PROMOTION' AS head_code, 'BUSINESS_PROMOTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1998' AS vendor_code, 'OFFICE_MAINTENANCE' AS head_code, 'CLEANING_MATERIAL' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1778' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'POSTAGE_COURIER' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1998' AS vendor_code, 'STAFF_WELFARE' AS head_code, 'REFRESHMENT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1999' AS vendor_code, 'LEGAL_CONSULTANCY' AS head_code, 'LEGAL_PROFESSIONAL' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1596' AS vendor_code, 'STAFF_WELFARE' AS head_code, 'RNR_EXPENSES' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1609' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'ELECTRICAL_REPAIRS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_2000' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'VEHICLE_REPAIR' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_2001' AS vendor_code, 'TOUR_EXPENSES' AS head_code, 'TOUR_EXPENSES' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_2002' AS vendor_code, 'BUSINESS_PROMOTION' AS head_code, 'BUSINESS_PROMOTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_2003' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'OFFICE_REPAIRS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_2004' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'OFFICE_REPAIRS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1998' AS vendor_code, 'PRINTING_STATIONERY' AS head_code, 'OFFICE_STATIONERY' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_2008' AS vendor_code, 'BUSINESS_PROMOTION' AS head_code, 'BUSINESS_PROMOTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_2009' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'AC_REPAIRS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_2010' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'ELECTRICAL_REPAIRS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_2011' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'COMPANY_VOICE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_2012' AS vendor_code, 'LEGAL_CONSULTANCY' AS head_code, 'LEGAL_PROFESSIONAL' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_2013' AS vendor_code, 'BUSINESS_PROMOTION' AS head_code, 'BUSINESS_PROMOTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_2006' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'COMPUTER_PERIPHERALS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_2007' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'COMPUTER_PERIPHERALS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_2014' AS vendor_code, 'BUSINESS_PROMOTION' AS head_code, 'BUSINESS_PROMOTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_2015' AS vendor_code, 'STAFF_WELFARE' AS head_code, 'REFRESHMENT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_2016' AS vendor_code, 'STAFF_WELFARE' AS head_code, 'DRINKING_WATER' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_2017' AS vendor_code, 'CONTRACT_FEES_FACILITIES' AS head_code, 'FACILITY_STAFF' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_2018' AS vendor_code, 'BUSINESS_PROMOTION' AS head_code, 'BUSINESS_PROMOTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_2019' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'OFFICE_REPAIRS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_2020' AS vendor_code, 'LEGAL_CONSULTANCY' AS head_code, 'LEGAL_PROFESSIONAL' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1998' AS vendor_code, 'STAFF_WELFARE' AS head_code, 'FESTIVAL_EXPENSE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1998' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'OFFICE_REPAIRS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_2021' AS vendor_code, 'INSURANCE_EXPENSES' AS head_code, 'CAR_INSURANCE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_2024' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'COMPUTER_PERIPHERALS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_2025' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'COMPUTER_PERIPHERALS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_2026' AS vendor_code, 'LEGAL_CONSULTANCY' AS head_code, 'LEGAL_PROFESSIONAL' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_2027' AS vendor_code, 'FEE_SUBSCRIPTION' AS head_code, 'FEE_SUBSCRIPTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1489' AS vendor_code, 'ELECTRICITY' AS head_code, 'GENERATOR_DIESEL' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_2017' AS vendor_code, 'OFFICE_MAINTENANCE' AS head_code, 'CLEANING_MATERIAL' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_2028' AS vendor_code, 'SPOT_FLOOR_FIELD_INCENTIVE' AS head_code, 'SPOT_INCENTIVE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_2029' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'AC_REPAIRS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_2031' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'VEHICLE_REPAIR' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_2032' AS vendor_code, 'FEE_SUBSCRIPTION' AS head_code, 'FEE_SUBSCRIPTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_2028' AS vendor_code, 'STAFF_TRAINING_RECRUITMENT' AS head_code, 'RECRUITMENT_ADVERTISEMENT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_2033' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'COMPUTER_PERIPHERALS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_2034' AS vendor_code, 'OFFICE_MAINTENANCE' AS head_code, 'CLEANING_MATERIAL' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_2036' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'OFFICE_REPAIRS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1928' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'COMPANY_DATA' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_2037' AS vendor_code, 'CONTRACT_FEES_FACILITIES' AS head_code, 'FACILITY_STAFF' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_2038' AS vendor_code, 'STAFF_WELFARE' AS head_code, 'FESTIVAL_EXPENSE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_2037' AS vendor_code, 'SECURITY_SERVICE' AS head_code, 'SECURITY_SERVICE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_2039' AS vendor_code, 'FEE_SUBSCRIPTION' AS head_code, 'FEE_SUBSCRIPTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_2028' AS vendor_code, 'BUSINESS_PROMOTION' AS head_code, 'BUSINESS_PROMOTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_2040' AS vendor_code, 'SECURITY_SERVICE' AS head_code, 'SECURITY_SERVICE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_2041' AS vendor_code, 'BUSINESS_PROMOTION' AS head_code, 'BUSINESS_PROMOTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_2042' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'OFFICE_REPAIRS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1988' AS vendor_code, 'PRINTING_STATIONERY' AS head_code, 'OFFICE_STATIONERY' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_2043' AS vendor_code, 'FEE_SUBSCRIPTION' AS head_code, 'FEE_SUBSCRIPTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_2044' AS vendor_code, 'INSURANCE_EXPENSES' AS head_code, 'CAR_INSURANCE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_2045' AS vendor_code, 'FEE_SUBSCRIPTION' AS head_code, 'FEE_SUBSCRIPTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_2046' AS vendor_code, 'STAFF_WELFARE' AS head_code, 'RNR_EXPENSES' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_100' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'ELECTRICAL_REPAIRS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_2047' AS vendor_code, 'FEE_SUBSCRIPTION' AS head_code, 'FEE_SUBSCRIPTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_100' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'UPS_NETWORKING' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_2011' AS vendor_code, 'FEE_SUBSCRIPTION' AS head_code, 'FEE_SUBSCRIPTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_2048' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'OFFICE_REPAIRS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1761' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'OFFICE_REPAIRS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_2028' AS vendor_code, 'STAFF_WELFARE' AS head_code, 'MEDICAL_EXPENSE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_2049' AS vendor_code, 'BUSINESS_PROMOTION' AS head_code, 'BUSINESS_PROMOTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_2050' AS vendor_code, 'BUSINESS_PROMOTION' AS head_code, 'BUSINESS_PROMOTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_2049' AS vendor_code, 'FEE_SUBSCRIPTION' AS head_code, 'FEE_SUBSCRIPTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_2051' AS vendor_code, 'BUSINESS_PROMOTION' AS head_code, 'BUSINESS_PROMOTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_2038' AS vendor_code, 'STAFF_WELFARE' AS head_code, 'RNR_EXPENSES' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_2028' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'COMPUTER_PERIPHERALS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_2053' AS vendor_code, 'BUSINESS_PROMOTION' AS head_code, 'BUSINESS_PROMOTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_2054' AS vendor_code, 'STAFF_WELFARE' AS head_code, 'REFRESHMENT' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_2055' AS vendor_code, 'FEE_SUBSCRIPTION' AS head_code, 'FEE_SUBSCRIPTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_2056' AS vendor_code, 'FEE_SUBSCRIPTION' AS head_code, 'FEE_SUBSCRIPTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_2057' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'VEHICLE_REPAIR' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_2058' AS vendor_code, 'FEE_SUBSCRIPTION' AS head_code, 'FEE_SUBSCRIPTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1144' AS vendor_code, 'TOURS_TRAVELLING_CONVEYANCE' AS head_code, 'PARKING_CHARGES' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_2059' AS vendor_code, 'STAFF_WELFARE' AS head_code, 'RNR_EXPENSES' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1998' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'COMPUTER_PERIPHERALS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_2060' AS vendor_code, 'BUSINESS_PROMOTION' AS head_code, 'BUSINESS_PROMOTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_2061' AS vendor_code, 'BUSINESS_PROMOTION' AS head_code, 'BUSINESS_PROMOTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_2062' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'ELECTRICAL_REPAIRS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_2063' AS vendor_code, 'SECURITY_SERVICE' AS head_code, 'SECURITY_SERVICE' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_2022' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'COMPUTER_PERIPHERALS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_2064' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'COMPUTER_PERIPHERALS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1928' AS vendor_code, 'FEE_SUBSCRIPTION' AS head_code, 'FEE_SUBSCRIPTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_2065' AS vendor_code, 'FEE_SUBSCRIPTION' AS head_code, 'FEE_SUBSCRIPTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_2066' AS vendor_code, 'FEE_SUBSCRIPTION' AS head_code, 'FEE_SUBSCRIPTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_2066' AS vendor_code, 'COMMUNICATION_CONNECTIVITY' AS head_code, 'COMPANY_DATA' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_2067' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'AC_REPAIRS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_2068' AS vendor_code, 'FEE_SUBSCRIPTION' AS head_code, 'FEE_SUBSCRIPTION' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_2069' AS vendor_code, 'TOUR_EXPENSES' AS head_code, 'TOUR_EXPENSES' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_583' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'OFFICE_REPAIRS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_2028' AS vendor_code, 'REPAIRS_MAINTENANCE' AS head_code, 'OFFICE_REPAIRS' AS sub_head_code
  UNION ALL
  SELECT 'DB_BILL_1537' AS vendor_code, 'FEE_SUBSCRIPTION' AS head_code, 'FEE_SUBSCRIPTION' AS sub_head_code
  ) AS src
  JOIN vendor_master v ON v.vendor_code = src.vendor_code
  JOIN finance_expense_head_master h ON h.head_code = src.head_code
  JOIN finance_expense_sub_head_master s
    ON s.head_id = h.id AND s.sub_head_code = src.sub_head_code
ON DUPLICATE KEY UPDATE vendor_expense_mapping.updated_at = vendor_expense_mapping.updated_at;

SELECT CONCAT('1092 vendor expense mappings present: ', COUNT(*)) AS migration_status
  FROM vendor_expense_mapping WHERE created_by = 'LEGACY_IMPORT';

-- ---------------------------------------------------------------------------
-- NOT IMPORTED (457 triples) - vendor | head | sub-head, as named in db_bill
-- ---------------------------------------------------------------------------
-- NEW GOLDEN FURNITURE WORKS | Repairs & Maintenance | FURNITURE & FIXTURE - COST   [sub-head sits under a different head]
-- LINTEL TECHNOLOGIES PVT LTD | Hiring Charges | GATEWAY HIRE
-- Corporate Telesystems Pvt Ltd. | Repairs & Maintenance | COMPUTERS-2017-18 COST
-- MICRO SYSTEMS WORLD | Repairs & Maintenance | COMPUTERS-2017-18 COST
-- SARGAM INDIA ELECTRONICS PVT LTD | Repairs & Maintenance | ELECTRICAL INSTALLATIONS - COST   [sub-head sits under a different head]
-- NAGAR GLASS & ALUMINIUM WORKS | Repairs & Maintenance | FURNITURE & FIXTURE - COST   [sub-head sits under a different head]
-- Expert Power Technology | Repairs & Maintenance | COMPUTERS-2017-18 COST
-- M.K.REFRIGERATION | Repairs & Maintenance | ELECTRICAL INSTALLATIONS - COST   [sub-head sits under a different head]
-- TECHCOM TECHNOLOGIES PVT LTD | Repairs & Maintenance | COMPUTERS-2017-18 COST
-- DEEPIJA TELECOM PVT. LTD. | Hiring Charges | GATEWAY HIRE
-- Heer Infotech | Repairs & Maintenance | COMPUTERS-2017-18 COST
-- OPERA GRATIA PRIVATE LIMITED | Repairs & Maintenance | ELECTRICAL INSTALLATIONS - COST   [sub-head sits under a different head]
-- CLOUD INFOTECH | Repairs & Maintenance | COMPUTERS-2017-18 COST
-- ALAM ENTERPRISES & CONTRACTOR | Repairs & Maintenance | FURNITURE & FIXTURE - COST   [sub-head sits under a different head]
-- ALAM ENTERPRISES & CONTRACTOR | Repairs & Maintenance | Furniture & Fixtures Repair A/c
-- Allied Communication Pvt.Ltd. | Repairs & Maintenance | COMPUTERS-2017-18 COST
-- Om Prakash Carpenter A/c | Repairs & Maintenance | FURNITURE & FIXTURE - COST   [sub-head sits under a different head]
-- Om Prakash Carpenter A/c | Repairs & Maintenance | Furniture & Fixtures Repair A/c
-- PARAS SERVICES | Repairs & Maintenance | ELECTRICAL INSTALLATIONS - COST   [sub-head sits under a different head]
-- SRI SANCHIA COMPUTRONICS | Repairs & Maintenance | COMPUTERS-2017-18 COST
-- Previous Entry | Others | CHURN PAYMENT   [sub-head sits under a different head]
-- Previous Entry | Tour Expenses | Local Conveyance A/c   [sub-head sits under a different head]
-- Previous Entry | Freight & Cargo Charges | Freight & Cargo Charges
-- Previous Entry | Freight & Cargo Charges | Fee & Subscription
-- Previous Entry | Staff Welfare | Business Promotion Expenses   [sub-head sits under a different head]
-- Previous Entry | Repairs & Maintenance | COMPUTERS-2017-18 COST
-- Previous Entry | Repairs & Maintenance | ELECTRICAL INSTALLATIONS - COST   [sub-head sits under a different head]
-- Previous Entry | Repairs & Maintenance | Furniture & Fixtures Repair A/c
-- ENERGY INDIA | Repairs & Maintenance | ELECTRICAL INSTALLATIONS - COST   [sub-head sits under a different head]
-- MEGHA COMMUNICATION | Repairs & Maintenance | COMPUTERS-2017-18 COST
-- Towards Vision Technologies Pvt Ltd | Repairs & Maintenance | COMPUTERS-2017-18 COST
-- Towards Vision Technologies Pvt Ltd | Repairs & Maintenance | COMPUTER SOFTWARE-2017-18-COST
-- Rakesh Kumar | Repairs & Maintenance | Furniture & Fixtures Repair A/c
-- JHA FURNITURE | Repairs & Maintenance | FURNITURE & FIXTURE - COST   [sub-head sits under a different head]
-- Harisons Furnishings  | Repairs & Maintenance | FURNITURE & FIXTURE - COST   [sub-head sits under a different head]
-- SM NETWORKS | Repairs & Maintenance | COMPUTERS-2017-18 COST
-- Towards Vision Technologies Pvt Ltd | Hiring Charges | COMPUTER SOFTWARE RENTAL 
-- Anjuman  Generator | Repairs & Maintenance | ELECTRICAL INSTALLATIONS - COST   [sub-head sits under a different head]
-- Rajesh Kumar Kushwaha | Repairs & Maintenance | Furniture & Fixtures Repair A/c
-- Balaji Interior | Repairs & Maintenance | FURNITURE & FIXTURE - COST   [sub-head sits under a different head]
-- SHREE GIRI RAJ ALUMINIUM | Repairs & Maintenance | FURNITURE & FIXTURE - COST   [sub-head sits under a different head]
-- SONU ELECTRICAL WORKS | Repairs & Maintenance | ELECTRICAL INSTALLATIONS - COST   [sub-head sits under a different head]
-- SIGNETIC COMPUTERS | Repairs & Maintenance | COMPUTERS-2018-19 COST
-- SRI SANCHIA COMPUTRONICS | Repairs & Maintenance | COMPUTERS-2018-19 COST
-- OM PRAKASH | Repairs & Maintenance | FURNITURE & FIXTURE - COST   [sub-head sits under a different head]
-- Vodafone P2p Collection Mohali | Others | SIM PURCHASE
-- Delta Lights | Repairs & Maintenance | ELECTRICAL INSTALLATIONS - COST   [sub-head sits under a different head]
-- GM ELECTRONICS | Repairs & Maintenance | ELECTRICAL INSTALLATIONS - COST   [sub-head sits under a different head]
-- SHRI BALAJI TRADING COMPANY | Repairs & Maintenance | FURNITURE & FIXTURE - COST   [sub-head sits under a different head]
-- Shrusti Freight Carriers | Freight & Cargo Charges | Freight & Cargo Charges
-- COOL CORNAR | Repairs & Maintenance | FURNITURE & FIXTURE - COST   [sub-head sits under a different head]
-- VIKAS GLASS ALUMINIUM HOUSE | Repairs & Maintenance | FURNITURE & FIXTURE - COST   [sub-head sits under a different head]
-- Raj Enterprise | Repairs & Maintenance | ELECTRICAL INSTALLATIONS - COST   [sub-head sits under a different head]
-- JAY SHREE ENTERPRISES | Repairs & Maintenance | ELECTRICAL INSTALLATIONS - COST   [sub-head sits under a different head]
-- SONY ELECTRICALS | Repairs & Maintenance | ELECTRICAL INSTALLATIONS - COST   [sub-head sits under a different head]
-- GOKUL PLYWOOD | Repairs & Maintenance | FURNITURE & FIXTURE - COST   [sub-head sits under a different head]
-- MAHESH ENGG.WORKS | Repairs & Maintenance | ELECTRICAL INSTALLATIONS - COST   [sub-head sits under a different head]
-- AGGARWAL TRADERS | Repairs & Maintenance | ELECTRICAL INSTALLATIONS - COST   [sub-head sits under a different head]
-- DEV ELECTRICALS | Repairs & Maintenance | ELECTRICAL INSTALLATIONS - COST   [sub-head sits under a different head]
-- VODAFONE SALES (P2P) AHM | Others | SIM PURCHASE
-- JKA HOMZ ENTERPRISES | Repairs & Maintenance | FURNITURE & FIXTURE - COST   [sub-head sits under a different head]
-- RAJDHANI TRANSPORT SERVICE | Freight & Cargo Charges | Freight & Cargo Charges
-- PUJA FURNITURE | Repairs & Maintenance | FURNITURE & FIXTURE - COST   [sub-head sits under a different head]
-- TC INFOTECH PVT LTD | Repairs & Maintenance | COMPUTERS-2018-19 COST
-- Hindustan Facilities Pvt.Ltd. | Repairs & Maintenance | FURNITURE & FIXTURE - COST   [sub-head sits under a different head]
-- CLOUD INFOTECH | Repairs & Maintenance | COMPUTERS-2018-19 COST
-- HUBRIS TECHNOLOGIES PRIVATE LIMITED | Repairs & Maintenance | COMPUTERS-2018-19 COST
-- JAY SHREE ENTERPRISES | Freight & Cargo Charges | Freight & Cargo Charges
-- A.S. CLASSIC DECOR | Repairs & Maintenance | FURNITURE & FIXTURE - COST   [sub-head sits under a different head]
-- GOYAL TRADING CO | Repairs & Maintenance | FURNITURE & FIXTURE - COST   [sub-head sits under a different head]
-- Cloudtail India Private Limited  | Repairs & Maintenance | ELECTRICAL INSTALLATIONS - COST   [sub-head sits under a different head]
-- A-One Chair Services | Repairs & Maintenance | Furniture & Fixtures Repair A/c
-- EXTERIORS AND HARDWARES | Repairs & Maintenance | Furniture & Fixtures Repair A/c
-- ALLIED COMMUNICATIONS PVT.LTD | Repairs & Maintenance | COMPUTERS-2018-19 COST
-- GOYAL TRADING CO | Repairs & Maintenance | Furniture & Fixtures Repair A/c
-- ZACO COMPUTERS PVT LTD | Repairs & Maintenance | COMPUTERS-2018-19 COST
-- Jai Durga Electricals | Repairs & Maintenance | ELECTRICAL INSTALLATIONS - COST   [sub-head sits under a different head]
-- Vodafone Mpesa Jaipur | Others | SIM PURCHASE
-- Garg Aqua Solutions | Repairs & Maintenance | FURNITURE & FIXTURE - COST   [sub-head sits under a different head]
-- SAI FIRE SAFETY | Repairs & Maintenance | FURNITURE & FIXTURE - COST   [sub-head sits under a different head]
-- Shaurya Enterprises  | Repairs & Maintenance | ELECTRICAL INSTALLATIONS - COST   [sub-head sits under a different head]
-- SAS ENTERPRISES | Repairs & Maintenance | ELECTRICAL INSTALLATIONS - COST   [sub-head sits under a different head]
-- COOL CORNAR | Repairs & Maintenance | ELECTRICAL INSTALLATIONS - COST   [sub-head sits under a different head]
-- MEGHA COMMUNICATION | Repairs & Maintenance | COMPUTERS-2018-19 COST
-- Mars Informatic Systems | Repairs & Maintenance | COMPUTERS-2018-19 COST
-- SAI PLYWOOD AND ELECTRONICS | Repairs & Maintenance | FURNITURE & FIXTURE - COST   [sub-head sits under a different head]
-- REENA ENTERPRISES  | Repairs & Maintenance | FURNITURE & FIXTURE - COST   [sub-head sits under a different head]
-- NIMAWAT ROADLINES | Freight & Cargo Charges | Freight & Cargo Charges
-- Shivam Tailors | Repairs & Maintenance | FURNITURE & FIXTURE - COST   [sub-head sits under a different head]
-- Rajesh Kumar Kushwaha | Repairs & Maintenance | FURNITURE & FIXTURE - COST   [sub-head sits under a different head]
-- Shivam Tailors | Repairs & Maintenance | Furniture & Fixtures Repair A/c
-- RAKASH KUMAR CONTRACTOR | Repairs & Maintenance | FURNITURE & FIXTURE - COST   [sub-head sits under a different head]
-- A K Interior | Repairs & Maintenance | FURNITURE & FIXTURE - COST   [sub-head sits under a different head]
-- Sun India Services  | Repairs & Maintenance | FURNITURE & FIXTURE - COST   [sub-head sits under a different head]
-- SAROJ ENGINEERING WORK | Repairs & Maintenance | ELECTRICAL INSTALLATIONS - COST   [sub-head sits under a different head]
-- PAL POWER SYSTEM & SERVICES | Repairs & Maintenance | ELECTRICAL INSTALLATIONS - COST   [sub-head sits under a different head]
-- JANTA BAG HOUSE | Repairs & Maintenance | FURNITURE & FIXTURE - COST   [sub-head sits under a different head]
-- Shree Lalguru Metal | Repairs & Maintenance | FURNITURE & FIXTURE - COST   [sub-head sits under a different head]
-- Supersil Architectural Products Pvt Ltd | Repairs & Maintenance | FURNITURE & FIXTURE - COST   [sub-head sits under a different head]
-- Mukesh Switchgears | Repairs & Maintenance | ELECTRICAL INSTALLATIONS - COST   [sub-head sits under a different head]
-- Anmol Interiors | Repairs & Maintenance | FURNITURE & FIXTURE - COST   [sub-head sits under a different head]
-- Hiteshpuri Ganeshpuri Goswami | Repairs & Maintenance | FURNITURE & FIXTURE - COST   [sub-head sits under a different head]
-- Rackzone Enterprise | Repairs & Maintenance | COMPUTERS-2018-19 COST
-- rucha refrigeration | Repairs & Maintenance | ELECTRICAL INSTALLATIONS - COST   [sub-head sits under a different head]
-- KARISHMA COMPUTERS PVT. LTD. | Repairs & Maintenance | COMPUTERS-2018-19 COST
-- Ambika Selection & Electrical | Repairs & Maintenance | ELECTRICAL INSTALLATIONS - COST   [sub-head sits under a different head]
-- Shree Ganesh Electricals | Repairs & Maintenance | ELECTRICAL INSTALLATIONS - COST   [sub-head sits under a different head]
-- Patil Crane Service | Freight & Cargo Charges | Freight & Cargo Charges
-- Mukesh Trading Company | Repairs & Maintenance | ELECTRICAL INSTALLATIONS - COST   [sub-head sits under a different head]
-- Patil Crane Service | Repairs & Maintenance | ELECTRICAL INSTALLATIONS - COST   [sub-head sits under a different head]
-- Mahavir & Mahavir  | Repairs & Maintenance | FURNITURE & FIXTURE - COST   [sub-head sits under a different head]
-- Adarsh Furniture | Repairs & Maintenance | FURNITURE & FIXTURE - COST   [sub-head sits under a different head]
-- Ashapuri Industries | Repairs & Maintenance | ELECTRICAL INSTALLATIONS - COST   [sub-head sits under a different head]
-- Micro Tech Systems | Repairs & Maintenance | ELECTRICAL INSTALLATIONS - COST   [sub-head sits under a different head]
-- Ashapuri Industries | Repairs & Maintenance | FURNITURE & FIXTURE - COST   [sub-head sits under a different head]
-- Rudra Home Decor | Repairs & Maintenance | FURNITURE & FIXTURE - COST   [sub-head sits under a different head]
-- Shreeji Traders | Repairs & Maintenance | FURNITURE & FIXTURE - COST   [sub-head sits under a different head]
-- A K Interior | Repairs & Maintenance | Furniture & Fixtures Repair A/c
-- PraveenKumar | Repairs & Maintenance | ELECTRICAL INSTALLATIONS - COST   [sub-head sits under a different head]
-- Maulesh dave | Repairs & Maintenance | FURNITURE & FIXTURE - COST   [sub-head sits under a different head]
-- Ajeet Parihar | Repairs & Maintenance | FURNITURE & FIXTURE - COST   [sub-head sits under a different head]
-- Ashok Sukhadev | Repairs & Maintenance | FURNITURE & FIXTURE - COST   [sub-head sits under a different head]
-- Yatendrasingh | Repairs & Maintenance | FURNITURE & FIXTURE - COST   [sub-head sits under a different head]
-- GOKUL PLYWOOD | Repairs & Maintenance | Furniture & Fixtures Repair A/c
-- Monika Fabrication Work | Repairs & Maintenance | FURNITURE & FIXTURE - COST   [sub-head sits under a different head]
-- Ramshankar Tiwari | Repairs & Maintenance | FURNITURE & FIXTURE - COST   [sub-head sits under a different head]
-- Vijay Dubey | Repairs & Maintenance | FURNITURE & FIXTURE - COST   [sub-head sits under a different head]
-- DOT COM COMPUTERS | Repairs & Maintenance | COMPUTERS-2018-19 COST
-- SRI NATRAJ COMPUTERS | Repairs & Maintenance | COMPUTERS-2018-19 COST
-- SRI NATRAJ COMPUTERS | Repairs & Maintenance | COMPUTERS-2019-20 COST
-- Allied Communications PVT .LTD | Repairs & Maintenance | ELECTRICAL INSTALLATIONS - COST   [sub-head sits under a different head]
-- ALLIED COMMUNICATIONS PVT.LTD | Repairs & Maintenance | ELECTRICAL INSTALLATIONS - COST   [sub-head sits under a different head]
-- GEN SERVICES | Freight & Cargo Charges | Freight & Cargo Charges
-- SRI SANCHIA COMPUTRONICS | Repairs & Maintenance | COMPUTERS-2019-20 COST
-- SIGNETIC COMPUTERS | Repairs & Maintenance | COMPUTERS-2019-20 COST
-- Vijay Sales | Repairs & Maintenance | COMPUTERS-2019-20 COST
-- Kavita Enterprises | Repairs & Maintenance | ELECTRICAL INSTALLATIONS - COST   [sub-head sits under a different head]
-- EKTA TRANSPORT CO. | Freight & Cargo Charges | Freight & Cargo Charges
-- KARISHMA COMPUTERS PVT. LTD. | Repairs & Maintenance | COMPUTERS-2019-20 COST
-- Othree Systems & Solutions Pvt. Ltd . | Repairs & Maintenance | COMPUTERS-2019-20 COST
-- MEGHA COMMUNICATION | Repairs & Maintenance | COMPUTERS-2019-20 COST
-- Saleem Khan | Repairs & Maintenance | FURNITURE & FIXTURE - COST   [sub-head sits under a different head]
-- F5 IT SERVICES | Hiring Charges | GATEWAY HIRE
-- MD.YOUSUF | Repairs & Maintenance | FURNITURE & FIXTURE - COST   [sub-head sits under a different head]
-- Darshita Aashiynana Private LImited | Repairs & Maintenance | COMPUTERS-2019-20 COST
-- JAGDAMBA MARBLE & TILES | Repairs & Maintenance | FURNITURE & FIXTURE - COST   [sub-head sits under a different head]
-- HARYANA SUPPLY AGENCIES | Repairs & Maintenance | ELECTRICAL INSTALLATIONS - COST   [sub-head sits under a different head]
-- M/S. LAKSHMI ELECTRONIC | Repairs & Maintenance | ELECTRICAL INSTALLATIONS - COST   [sub-head sits under a different head]
-- MD.YUSUF WOOD WORK | Repairs & Maintenance | Furniture & Fixtures Repair A/c
-- SHIVA TELECOM | Repairs & Maintenance | COMPUTERS-2019-20 COST
-- SHAN FABRICATION | Repairs & Maintenance | FURNITURE & FIXTURE - COST   [sub-head sits under a different head]
-- GALAXY PLUS SECURITY SOLUTIONS | Repairs & Maintenance | FURNITURE & FIXTURE - COST   [sub-head sits under a different head]
-- HUBRIS TECHNOLOGIES PRIVATE LIMITED | Repairs & Maintenance | COMPUTERS-2019-20 COST
-- CHETAN ENTERPRISES | Repairs & Maintenance | ELECTRICAL INSTALLATIONS - COST   [sub-head sits under a different head]
-- BHATIA ELECTRICALS | Repairs & Maintenance | COMPUTERS-2019-20 COST
-- CHAIR REPAIRING CENTRE | Repairs & Maintenance | Furniture & Fixtures Repair A/c
-- EBL Global | Repairs & Maintenance | ELECTRICAL INSTALLATIONS - COST   [sub-head sits under a different head]
-- Reliance Retail Limited | Repairs & Maintenance | COMPUTERS-2019-20 COST
-- GURU KRIPA TRADERS  | Repairs & Maintenance | FURNITURE & FIXTURE - COST   [sub-head sits under a different head]
-- SUN Power Solution | Repairs & Maintenance | ELECTRICAL INSTALLATIONS - COST   [sub-head sits under a different head]
-- U.K. COMPUTER | Repairs & Maintenance | COMPUTERS-2019-20 COST
-- CHANDRA DEEP TRANSPORT SERVICES AND STEEL FABRICATION  | Freight & Cargo Charges | Freight & Cargo Charges
-- UPPAL TEMPO SERVICE  | Freight & Cargo Charges | Freight & Cargo Charges
-- H.B. TOOLS & HARDWARE | Repairs & Maintenance | FURNITURE & FIXTURE - COST   [sub-head sits under a different head]
-- A-one Cargo Movers and Packers | Freight & Cargo Charges | Freighy & Cargo Charges
-- A-one Cargo Movers and Packers | Freight & Cargo Charges | Freight & Cargo Charges
-- EHI INTERNATIONAL PRIVATE LIMITED | Repairs & Maintenance | FURNITURE & FIXTURE - COST   [sub-head sits under a different head]
-- GREEN NETWORK TELECOM PRIVAE LIMITED | Repairs & Maintenance | COMPUTERS-2019-20 COST
-- AVS ENGINEERS & TRADERS | Repairs & Maintenance | ELECTRICAL INSTALLATIONS - COST   [sub-head sits under a different head]
-- BIRKAN ENGINEERING INDUSTRIES(P) LTD | Repairs & Maintenance | FURNITURE & FIXTURE - COST   [sub-head sits under a different head]
-- UNIQUE CONSTRUCTIONS | Repairs & Maintenance | FURNITURE & FIXTURE - COST   [sub-head sits under a different head]
-- AVIATION TECHNOLOGY | Repairs & Maintenance | ELECTRICAL INSTALLATIONS - COST   [sub-head sits under a different head]
-- DEV TRADERS | Repairs & Maintenance | FURNITURE & FIXTURE - COST   [sub-head sits under a different head]
-- AGGARWAL & SONS ELECTRIC CO | Repairs & Maintenance | ELECTRICAL INSTALLATIONS - COST   [sub-head sits under a different head]
-- RELIABLE POLYCOMPOUNDS PRIVATE LIMITED | Repairs & Maintenance | FURNITURE & FIXTURE - COST   [sub-head sits under a different head]
-- RDnetra Technologies Pvt. Ltd. | Repairs & Maintenance | COMPUTERS-2019-20 COST
-- GOYAL TRADING COMPANY | Repairs & Maintenance | FURNITURE & FIXTURE - COST   [sub-head sits under a different head]
-- AS TECHNOLOGY & INTERIOR | Repairs & Maintenance | FURNITURE & FIXTURE - COST   [sub-head sits under a different head]
-- MOHD. AZIZ | Repairs & Maintenance | ELECTRICAL INSTALLATIONS - COST   [sub-head sits under a different head]
-- GUPTA COMMUNICATION | Repairs & Maintenance | COMPUTERS-2019-20 COST
-- Navkar Distributors | Repairs & Maintenance | COMPUTERS-2020-21 COST
-- SARASWATI STUDY CENTRE (U.P) | Repairs & Maintenance | COMPUTERS-2020-21 COST
-- SARASWATI STUDY CENTRE | Repairs & Maintenance | COMPUTERS-2020-21 COST
-- MEGHA COMMUNICATION | Repairs & Maintenance | COMPUTERS-2020-21 COST
-- Jain Communication | Repairs & Maintenance | COMPUTERS-2020-21 COST
-- Mehta Brothers | Repairs & Maintenance | COMPUTERS-2020-21 COST
-- VARALIKA COMPU POWER SYSTEM PVT LTD. | Repairs & Maintenance | COMPUTERS-2020-21 COST
-- VARALIKA COMPU POWER SYSTEM PVT LTD. | Repairs & Maintenance | ELECTRICAL INSTALLATIONS - COST   [sub-head sits under a different head]
-- AFECTO LIGHTS & ELECTRICALS | Repairs & Maintenance | ELECTRICAL INSTALLATIONS - COST   [sub-head sits under a different head]
-- Jupiter Carpet & Floorings Pvt ltd | Repairs & Maintenance | FURNITURE & FIXTURE - COST   [sub-head sits under a different head]
-- Anand Furnishing | Repairs & Maintenance | FURNITURE & FIXTURE - COST   [sub-head sits under a different head]
-- GAGAN SALES | Repairs & Maintenance | FURNITURE & FIXTURE - COST   [sub-head sits under a different head]
-- EcoEarth Electric Pvt Ltd | Repairs & Maintenance | ELECTRICAL INSTALLATIONS - COST   [sub-head sits under a different head]
-- A.S Electricals  | Repairs & Maintenance | ELECTRICAL INSTALLATIONS - COST   [sub-head sits under a different head]
-- Shri Bala Jee paints & hardware Store | Repairs & Maintenance | FURNITURE & FIXTURE - COST   [sub-head sits under a different head]
-- S. K. Electric Company | Repairs & Maintenance | ELECTRICAL INSTALLATIONS - COST   [sub-head sits under a different head]
-- RS SAFETY SOLUTIONS | Repairs & Maintenance | COMPUTERS-2020-21 COST
-- Pankaj Sanitary | Repairs & Maintenance | FURNITURE & FIXTURE - COST   [sub-head sits under a different head]
-- Urgent Fire Safety | Repairs & Maintenance | FURNITURE & FIXTURE - COST   [sub-head sits under a different head]
-- Lifestyle Interior | Repairs & Maintenance | FURNITURE & FIXTURE - COST   [sub-head sits under a different head]
-- Perfect Computers | Repairs & Maintenance | COMPUTERS-2017-18 COST
-- Perfect Computers | Repairs & Maintenance | COMPUTERS-2020-21 COST
-- SIGNETIC COMPUTERS | Repairs & Maintenance | COMPUTERS-2020-21 COST
-- Zero Square Energy Solutions Pvt. Ltd | Repairs & Maintenance | ELECTRICAL INSTALLATIONS - COST   [sub-head sits under a different head]
-- ArtBoat Innovation | Repairs & Maintenance | COMPUTERS-2020-21 COST
-- ALLIED COMMUNICATIONS PVT.LTD | Repairs & Maintenance | COMPUTERS-2020-21 COST
-- K.K Boimetrics | Repairs & Maintenance | COMPUTERS-2020-21 COST
-- KK BIOMETRICS | Repairs & Maintenance | ELECTRICAL INSTALLATIONS - COST   [sub-head sits under a different head]
-- Enser Communications Pvt Ltd | Repairs & Maintenance | COMPUTERS-2020-21 COST
-- K.K Boimetrics | Repairs & Maintenance | ELECTRICAL INSTALLATIONS - COST   [sub-head sits under a different head]
-- krishan | Repairs & Maintenance | COMPUTERS-2020-21 COST
-- COMPUTECH SERVICES | Repairs & Maintenance | COMPUTERS-2020-21 COST
-- R R P Enterprise | Repairs & Maintenance | COMPUTERS-2020-21 COST
-- Dhariya Enterprises | Repairs & Maintenance | COMPUTERS-2020-21 COST
-- Krishna Computer  | Repairs & Maintenance | COMPUTERS-2020-21 COST
-- J.R.INFOTECH | Repairs & Maintenance | COMPUTERS-2020-21 COST
-- Ankur Timber | Repairs & Maintenance | FURNITURE & FIXTURE - COST   [sub-head sits under a different head]
-- Psychrometric Solutions | Repairs & Maintenance | FURNITURE & FIXTURE - COST   [sub-head sits under a different head]
-- RDnetra Technologies Pvt. Ltd. | Repairs & Maintenance | COMPUTERS-2020-21 COST
-- VARDHMAN TILES | Repairs & Maintenance | FURNITURE & FIXTURE - COST   [sub-head sits under a different head]
-- Yo Spaces Design &  Build Pvt Ltd | Repairs & Maintenance | FURNITURE & FIXTURE - COST   [sub-head sits under a different head]
-- J.R.INFOTECH | Repairs & Maintenance | ELECTRICAL INSTALLATIONS - COST   [sub-head sits under a different head]
-- SUPER FURNITURE AND OFFICE SYSTEMS PVT LTD | Repairs & Maintenance | FURNITURE & FIXTURE - COST   [sub-head sits under a different head]
-- GOODWILL COMPUTERS | Repairs & Maintenance | COMPUTERS-2020-21 COST
-- TM Airconditioning Work | Repairs & Maintenance | FURNITURE & FIXTURE - COST   [sub-head sits under a different head]
-- KRIVA ENTERPRISE  | Repairs & Maintenance | ELECTRICAL INSTALLATIONS - COST   [sub-head sits under a different head]
-- Lord of Gadgets Private Limited  | Repairs & Maintenance | ELECTRICAL INSTALLATIONS - COST   [sub-head sits under a different head]
-- Karamsar Electronics Pvt Ltd | Repairs & Maintenance | ELECTRICAL INSTALLATIONS - COST   [sub-head sits under a different head]
-- Datum Technologies  | Repairs & Maintenance | ELECTRICAL INSTALLATIONS - COST   [sub-head sits under a different head]
-- Monu Enterprises  | Repairs & Maintenance | FURNITURE & FIXTURE - COST   [sub-head sits under a different head]
-- Datum Technologies  | Repairs & Maintenance | COMPUTERS-2020-21 COST
-- P.M.S Enterprises | Repairs & Maintenance | ELECTRICAL INSTALLATIONS - COST   [sub-head sits under a different head]
-- ADARSH INFOTECH SYSTEMS | Repairs & Maintenance | COMPUTERS-2020-21 COST
-- Vu Videoconferencing Pvt Ltd | Repairs & Maintenance | COMPUTERS-2020-21 COST
-- Yo Spaces Design & Build Pvt Ltd | Repairs & Maintenance | FURNITURE & FIXTURE - COST   [sub-head sits under a different head]
-- Nasir Ali | Repairs & Maintenance | FURNITURE & FIXTURE - COST   [sub-head sits under a different head]
-- RSM INTERIORS | Repairs & Maintenance | FURNITURE & FIXTURE - COST   [sub-head sits under a different head]
-- Lumetiq Lighting | Repairs & Maintenance | ELECTRICAL INSTALLATIONS - COST   [sub-head sits under a different head]
-- We Print Media | Repairs & Maintenance | FURNITURE & FIXTURE - COST   [sub-head sits under a different head]
-- Khushi Publicity Services | Repairs & Maintenance | FURNITURE & FIXTURE - COST   [sub-head sits under a different head]
-- Karaj Trading Co. | Repairs & Maintenance | FURNITURE & FIXTURE - COST   [sub-head sits under a different head]
-- Decor Design | Repairs & Maintenance | FURNITURE & FIXTURE - COST   [sub-head sits under a different head]
-- JYOTI ADVERTISING | Repairs & Maintenance | FURNITURE & FIXTURE - COST   [sub-head sits under a different head]
-- GEEKEN SEATING COLLECTION PVT.LTD. | Repairs & Maintenance | FURNITURE & FIXTURE - COST   [sub-head sits under a different head]
-- GK Design Studio | Repairs & Maintenance | FURNITURE & FIXTURE - COST   [sub-head sits under a different head]
-- MEGHA COMMUNICATION | Repairs & Maintenance | COMPUTERS-2021-22 COST
-- AIRNET COMMUNICATION | Repairs & Maintenance | COMPUTERS-2021-22 COST
-- SHREE VINAYAK TECHNOLOGY  | Repairs & Maintenance | COMPUTERS-2021-22 COST
-- ADARSH INFOTECH SYSTEMS | Repairs & Maintenance | COMPUTERS-2021-22 COST
-- J.R.INFOTECH | Repairs & Maintenance | COMPUTERS-2021-22 COST
-- Dhariya Enterprises | Repairs & Maintenance | COMPUTERS-2021-22 COST
-- RDnetra Technologies Pvt. Ltd. | Repairs & Maintenance | COMPUTERS-2021-22 COST
-- J.R.INFOTECH | 	Repairs & Maintenance Capex | COMPUTERS-2020-1 COST
-- Dhariya Enterprises | 	Repairs & Maintenance Capex | COMPUTERS-2020-1 COST
-- K.K Boimetrics | Repairs & Maintenance | COMPUTERS-2021-22 COST
-- ZACO COMPUTERS PVT LTD | 	Repairs & Maintenance Capex | COMPUTERS-2021-22 COST
-- KARISHMA COMPUTERS PVT. LTD. | 	Repairs & Maintenance Capex | COMPUTERS-2021-22 COST
-- Datum Technologies  | 	Repairs & Maintenance Capex | COMPUTERS-2021-22 COST
-- ZACO COMPUTERS PVT LTD | 	Repairs & Maintenance Capex | COMPUTERS-2020-1 COST
-- KARISHMA COMPUTERS PVT. LTD. | 	Repairs & Maintenance Capex | COMPUTERS-2020-1 COST
-- Datum Technologies  | 	Repairs & Maintenance Capex | COMPUTERS-2020-1 COST
-- ArtBoat Innovation | 	Repairs & Maintenance Capex | COMPUTERS-2021-22 COST
-- ArtBoat Innovation | Repairs & Maintenance | COMPUTERS-2021-22 COST
-- Reliance Retail Limited | 	Repairs & Maintenance Capex | COMPUTERS-2021-22 COST
-- J.R.INFOTECH | 	Repairs & Maintenance Capex | COMPUTERS-2021-22 COST
-- RS SAFETY SOLUTIONS | Repairs & Maintenance | COMPUTERS-2021-22 COST
-- Perfect Computers | Repairs & Maintenance | COMPUTERS-2021-22 COST
-- DIGITEK NETWORK | 	Repairs & Maintenance Capex | COMPUTERS-2021-22 COST
-- OMNIVISIO TELECOM LLP | Repairs & Maintenance | COMPUTERS-2021-22 COST
-- CORPORATE TELESYSTEMS PVT.LTD. | 	Repairs & Maintenance Capex | COMPUTERS-2021-22 COST
-- CONNECT TELECOM SYSTEM | 	Repairs & Maintenance Capex | COMPUTERS-2021-22 COST
-- CONNECT TELECOM SYSTEM | Repairs & Maintenance | COMPUTERS-2021-22 COST
-- PJ Network Pvt Ltd | 	Repairs & Maintenance Capex | COMPUTERS-2021-22 COST
-- OMNIVISIO TELECOM LLP | 	Repairs & Maintenance Capex | COMPUTERS-2021-22 COST
-- JYOTI ADVERTISING | 	Repairs & Maintenance Capex | COMPUTERS-2021-22 COST
-- Perfect Computers | 	Repairs & Maintenance Capex | COMPUTERS-2021-22 COST
-- KHUSHI ENTERPRISES | Repairs & Maintenance | COMPUTERS-2021-22 COST
-- F5 IT SERVICES | 	Repairs & Maintenance Capex | COMPUTERS-2021-22 COST
-- PWM Enterprises | 	Repairs & Maintenance Capex | COMPUTERS-2021-22 COST
-- Access Computer | Repairs & Maintenance | COMPUTERS-2021-22 COST
-- Access Computer | Repairs & Maintenance | COMPUTERS-2021-22
-- CORPORATE TELESYSTEMS PVT.LTD. | Repairs & Maintenance | COMPUTERS-2021-22 COST
-- BANSAL STANMART INDIA PVT LTD | Repairs & Maintenance | COMPUTERS-2021-22 COST
-- Cloudtail India Private Limited  | Repairs & Maintenance | COMPUTERS-2021-22 COST
-- F5 IT SERVICES | 	Repairs & Maintenance Capex | COMPUTERS-2020-1 COST
-- Appario Retail Private ltd | Repairs & Maintenance | COMPUTERS-2021-22 COST
-- Reliance Retail Limited | Repairs & Maintenance | COMPUTERS-2021-22 COST
-- Gupta Telecom | Repairs & Maintenance | COMPUTERS-2021-22 COST
-- UK IT SOLUTIONS | Repairs & Maintenance | COMPUTERS-2021-22 COST
-- Dhariya Enterprises | 	Repairs & Maintenance Capex | COMPUTERS-2021-22 COST
-- MIRACLE FURNITURE | Repairs & Maintenance | FURNITURE & FIXTURE - COST   [sub-head sits under a different head]
-- SALARY A/C-AHM | Salary & Workman Compensation | AGENT
-- SALARY A/C-AHM | Salary & Workman Compensation | DSC
-- SALARY A/C-AHM | Salary & Workman Compensation | BMC
-- SM NETWORKS | Repairs & Maintenance | COMPUTERS-2021-22 COST
-- SM NETWORKS | Repairs & Maintenance | COMPUTERS-2022-23 COST
-- OMNIVISIO TELECOM LLP | Repairs & Maintenance | COMPUTERS-2022-23 COST
-- Vijay Sales | Repairs & Maintenance | COMPUTERS-2022-23 COST
-- Rackzone Enterprise | 	Repairs & Maintenance Capex | COMPUTERS-2022-23 COST
-- SM NETWORKS | 	Repairs & Maintenance Capex | COMPUTERS-2022-23 COST
-- CORPORATE TELESYSTEMS PVT.LTD. | Repairs & Maintenance | COMPUTERS-2022-23 COST
-- Shree Ganesh Electricals | 	Repairs & Maintenance Capex | COMPUTERS-2022-23 COST
-- Rajesh Trading Company | Repairs & Maintenance | Furniture & Fixtures Repair A/c
-- Raj Enterprise | 	Repairs & Maintenance Capex | AIRCONDITIONNG-COST
-- Jalpa Linening work | Repairs & Maintenance | FURNITURE & FIXTURE - COST   [sub-head sits under a different head]
-- Perfect Computers | 	Repairs & Maintenance Capex | COMPUTERS-2022-23 COST
-- Ajay Carpet Services | Repairs & Maintenance | FURNITURE & FIXTURE - COST   [sub-head sits under a different head]
-- Kataria Enterprise | Repairs & Maintenance | ELECTRICAL INSTALLATIONS - COST   [sub-head sits under a different head]
-- Ayansh Enterprise | Repairs & Maintenance | FURNITURE & FIXTURE - COST   [sub-head sits under a different head]
-- Roshanali Shaikh | 	Repairs & Maintenance Capex | COMPUTERS-2022-23 COST
-- J.B.N . Logistics Solution (REGD) | Freight & Cargo Charges | Freight & Cargo Charges
-- Genius Impex | Repairs & Maintenance | COMPUTERS-2022-23 COST
-- Geeken Seating Collection Pvt Ltd | Repairs & Maintenance | FURNITURE & FIXTURE - COST   [sub-head sits under a different head]
-- Satyanarayana Contractor  | Repairs & Maintenance | FURNITURE & FIXTURE - COST   [sub-head sits under a different head]
-- Genius Impex | 	Repairs & Maintenance Capex | COMPUTERS-2022-23 COST
-- Dhariya Enterprises | Repairs & Maintenance | COMPUTERS-2022-23 COST
-- RS SAFETY SOLUTIONS | Repairs & Maintenance | COMPUTERS-2022-23 COST
-- A.J Corporation | Repairs & Maintenance | FURNITURE & FIXTURE - COST   [sub-head sits under a different head]
-- Home Tech Digital Pvt.Ltd | Repairs & Maintenance | COMPUTERS-2022-23 COST
-- Home Tech Digital Pvt.Ltd | 	Repairs & Maintenance Capex | COMPUTERS-2022-23 COST
-- Photon Consumables & Marketing | 	Repairs & Maintenance Capex | COMPUTERS-2022-23 COST
-- F5 IT SERVICES | Repairs & Maintenance | COMPUTERS-2022-23 COST
-- PROFESSIONAL TAX 2022-23 | Duties and Taxes | Professional Tax 2022-23
-- Perfect Computers | Repairs & Maintenance | COMPUTERS-2022-23 COST
-- RX Infotech P Limited | 	Repairs & Maintenance Capex | COMPUTERS-2022-23 COST
-- Datum Technologies  | 	Repairs & Maintenance Capex | COMPUTERS-2022-23 COST
-- K.T.Logistic | Freight & Cargo Charges | Freight & Cargo Charges
-- Spectra Microtech | 	Repairs & Maintenance Capex | COMPUTERS-2022-23 COST
-- Access Computer | 	Repairs & Maintenance Capex | COMPUTERS-2022-23 COST
-- HOMETECH DIGITAL PVT.LTD. | Repairs & Maintenance | COMPUTERS-2022-23 COST
-- Mehta Brothers | 	Repairs & Maintenance Capex | COMPUTERS-2022-23 COST
-- J.R.INFOTECH | Repairs & Maintenance | COMPUTERS-2022-23 COST
-- Amit Networking & co. | 	Repairs & Maintenance Capex | COMPUTERS-2020-1 COST
-- RDnetra Technologies Pvt. Ltd. | 	Repairs & Maintenance Capex | COMPUTERS-2022-23 COST
-- Amit Networking & co. | 	Repairs & Maintenance Capex | COMPUTERS-2022-23 COST
-- Esconet Technologies Private Limited | 	Repairs & Maintenance Capex | COMPUTERS-2022-23 COST
-- K.H.Enterprises | Repairs & Maintenance | FURNITURE & FIXTURE - COST   [sub-head sits under a different head]
-- Esconet Technologies Private Limited | Repairs & Maintenance | COMPUTERS-2022-23 COST
-- Spectra Microtech | Repairs & Maintenance | COMPUTERS-2022-23 COST
-- MEGHA COMMUNICATION | Repairs & Maintenance | COMPUTERS-2022-23 COST
-- TELEKONNECTORS LIMITED | Repairs & Maintenance | COMPUTERS-2022-23 COST
-- RDnetra Technologies Pvt. Ltd. | Repairs & Maintenance | COMPUTERS-2022-23 COST
-- AVS ENGINEERS & TRADERS | 	Repairs & Maintenance Capex | COMPUTERS-2022-23 COST
-- Dhariya Enterprises | 	Repairs & Maintenance Capex | COMPUTERS-2022-23 COST
-- PJ Network Pvt Ltd | 	Repairs & Maintenance Capex | COMPUTERS-2022-23 COST
-- ADARSH INFOTECH SYSTEMS | 	Repairs & Maintenance Capex | COMPUTERS-2022-23 COST
-- ANIL ELECTRICALS | Repairs & Maintenance | ELECTRICAL INSTALLATIONS - COST   [sub-head sits under a different head]
-- M/S DB INFOWAYS | 	Repairs & Maintenance Capex | COMPUTERS-2022-23 COST
-- DEEPIJA TELECOM PVT. LTD. | 	Repairs & Maintenance Capex | COMPUTERS-2022-23 COST
-- SRI SANCHIA COMPUTRONICS | Repairs & Maintenance | COMPUTERS-2022-23 COST
-- Anuj kumar | 	Repairs & Maintenance Capex | COMPUTERS-2022-23 COST
-- J.R.INFOTECH | 	Repairs & Maintenance Capex | COMPUTERS-2022-23 COST
-- SRI SANCHIA COMPUTRONICS | 	Repairs & Maintenance Capex | COMPUTERS-2022-23 COST
-- Rajesh Trading Company | Repairs & Maintenance | FURNITURE & FIXTURE - COST   [sub-head sits under a different head]
-- GULLYBABD PUBLISHING HOUSE PVT LTD. | Printing & Stationery Expenses | Newspaper & Periodicals A/c 
-- PWM Enterprises | 	Repairs & Maintenance Capex | COMPUTERS-2022-23 COST
-- TRAVELLING A/C  PAYABLE- HO | Printing & Stationery Expenses | Newspaper & Periodicals A/c 
-- RDnetra Technologies Pvt. Ltd. | 	Repairs & Maintenance Capex | COMPUTERS-2023-24 COST
-- Dhariya Enterprises | 	Repairs & Maintenance Capex | COMPUTERS-2023-24 COST
-- SM NETWORKS | 	Repairs & Maintenance Capex | COMPUTERS-2023-24 COST
-- PWM Enterprises | 	Repairs & Maintenance Capex | COMPUTERS-2023-24 COST
-- Anuj kumar | 	Repairs & Maintenance Capex | COMPUTERS-2023-24 COST
-- SRI SANCHIA COMPUTRONICS | 	Repairs & Maintenance Capex | COMPUTERS-2023-24 COST
-- J.R.INFOTECH | 	Repairs & Maintenance Capex | COMPUTERS-2023-24 COST
-- Esconet Technologies Private Limited | Repairs & Maintenance | Computer Software Cost 2023 - 24
-- Deepak Kashyap Imp A/C | Finance Expenses | Bank Charges
-- PJ Network Pvt Ltd | Repairs & Maintenance | Computer Software Cost 2023 - 24
-- RDnetra Technologies Pvt. Ltd. | Repairs & Maintenance | Computer Software Cost 2023 - 24
-- AVION NETWORK | Repairs & Maintenance | COMPUTERS-2022-23 COST
-- Croma  | Repairs & Maintenance | COMPUTERS-2022-23 COST
-- Parth AC | 	Repairs & Maintenance Capex | AIRCONDITIONNG-COST
-- Spectra Microtech | 	Repairs & Maintenance Capex | COMPUTERS-2023-24 COST
-- TNS Refrigeration | 	Repairs & Maintenance Capex | AIRCONDITIONNG-COST
-- MANI EXPORTS | 	Repairs & Maintenance Capex | COMPUTERS-2023-24 COST
-- INFINITI RETAIL LIMITED (DELHI) | 	Repairs & Maintenance Capex | AIRCONDITIONNG-COST
-- UNICORN Infosolutions Pvt.Ltd. | Repairs & Maintenance | COMPUTERS-2022-23 COST
-- UNICORN Infosolutions Pvt.Ltd. | Repairs & Maintenance | Computer Software Cost 2023 - 24
-- PJ Network Pvt Ltd | Repairs & Maintenance | Computer Software Cost 2024 - 25
-- Avante Hospitality Services | Staff Welfare | Business Promotion Expenses   [sub-head sits under a different head]
-- Esconet Technologies Private Limited | Repairs & Maintenance | Computer Software Cost 2024 - 25
-- RDnetra Technologies Pvt. Ltd. | Repairs & Maintenance | Computer Software Cost 2024 - 25
-- ADARSH INFOTECH SYSTEMS | Repairs & Maintenance | Computers 24-25 COST
-- VEDTAM TECH SOLUTIONS | Repairs & Maintenance | Computers 24-25 COST
-- AVION NETWORK | Repairs & Maintenance | Computers 24-25 COST
-- Spectra Microtech | Repairs & Maintenance | Computers 24-25 COST
-- krishna Electricals & Hardware  | Repairs & Maintenance | ELECTRICAL INSTALLATIONS - COST   [sub-head sits under a different head]
-- Vikas Kumar Ray  ELECTRICITY | Repairs & Maintenance | ELECTRICAL INSTALLATIONS - COST   [sub-head sits under a different head]
-- MANI EXPORTS | Repairs & Maintenance | Computers 24-25 COST
-- OMNIVISIO TELECOM LLP | Repairs & Maintenance | Computers 24-25 COST
-- VEDTAM TECH SOLUTIONS | Repairs & Maintenance | Computer Software Cost 2024 - 25
-- PWM Enterprises | Repairs & Maintenance | Computers 24-25 COST
-- Dhariya Enterprises | Repairs & Maintenance | Computers 24-25 COST
-- SRI SANCHIA COMPUTRONICS | Repairs & Maintenance | Computers 24-25 COST
-- AMAZE ENTERPRISES | Repairs & Maintenance | FURNITURE & FIXTURE - COST   [sub-head sits under a different head]
-- ZACO COMPUTERS PVT LTD | Repairs & Maintenance | Computers 24-25 COST
-- Digitech Computers Pvt. Ltd. | Repairs & Maintenance | Computers 24-25 COST
-- DAILY WALLY INTERIOR & CONSTRUCTION | Repairs & Maintenance | FURNITURE & FIXTURE - COST   [sub-head sits under a different head]
-- VR INFOZONE PVT LTD | Repairs & Maintenance | Computers 24-25 COST
-- INFINITI RETAIL LIMITED (UP) | Repairs & Maintenance | Computers 24-25 COST
-- ASH INFORMATION TECHNOLOGIES PVT LTD | Repairs & Maintenance | Computers 24-25 COST
-- Dhariya Enterprises | Repairs & Maintenance | Computers 25-26 COST
-- TC INFOTECH PVT LTD | Repairs & Maintenance | Computers 25-26 COST
-- Vinod Home Appliance | Repairs & Maintenance | ELECTRICAL INSTALLATIONS - COST   [sub-head sits under a different head]
-- MANI EXPORTS | Repairs & Maintenance | Computers 25-26 COST
-- ASH INFORMATION TECHNOLOGIES PVT LTD | Repairs & Maintenance | Computers 25-26 COST
-- TELEKONNECTORS LIMITED | Repairs & Maintenance | Computers 25-26 COST
-- INTERRUPT CARE SERVICES | Repairs & Maintenance | ELECTRICAL INSTALLATIONS - COST   [sub-head sits under a different head]
-- P3S VENTURES PVT LTD | Repairs & Maintenance | Computers 25-26 COST
-- SRI SANCHIA COMPUTRONICS | Repairs & Maintenance | Computers 25-26 COST
-- ADARSH INFOTECH SYSTEMS | Repairs & Maintenance | Computers 25-26 COST
-- ZACO COMPUTERS PVT LTD | Repairs & Maintenance | Computers 25-26 COST
-- OMNIVISIO TELECOM LLP | Repairs & Maintenance | Computers 25-26 COST
-- Croma  | Repairs & Maintenance | ELECTRICAL INSTALLATIONS - COST   [sub-head sits under a different head]
-- Unicorn Infosolution Pvt Ltd | Repairs & Maintenance | Computer Software Cost 2025 - 26
-- UNICORN Infosolutions Pvt.Ltd. | Repairs & Maintenance | Computer Software Cost 2025 - 26
-- Ratan Singh | Repairs & Maintenance | FURNITURE & FIXTURE - COST   [sub-head sits under a different head]
-- UK ENTERPRISEES | Repairs & Maintenance | Computers 25-26 COST
-- UK ENTERPRISES | Repairs & Maintenance | Computers 25-26 COST
-- PJ Network Pvt Ltd | Repairs & Maintenance | Computer Software Cost 2025 - 26
-- Sharma Interior Designer | Repairs & Maintenance | FURNITURE & FIXTURE - COST   [sub-head sits under a different head]
-- Adobe Systems Software Ireland Ltd | Repairs & Maintenance | Computer Software Cost 2025 - 26
-- Paddle.com Markey Ltd. | Repairs & Maintenance | Computer Software Cost 2025 - 26
-- SURYA CHAUHAN ELECTRIC WORKS | Repairs & Maintenance | ELECTRICAL INSTALLATIONS - COST   [sub-head sits under a different head]
-- TPM GURU PRIVATE LIMITED | Repairs & Maintenance | Computers 25-26 COST
-- Accord Mobile Solution | Repairs & Maintenance | Computers 25-26 COST
-- M.K Battery Center | Repairs & Maintenance | ELECTRICAL INSTALLATIONS - COST   [sub-head sits under a different head]
-- Digitech Computers Pvt. Ltd. | Repairs & Maintenance | Computers 25-26 COST
-- SPS TECHNOLOGIES | Repairs & Maintenance | Computers 25-26 COST
-- J R M Infotech | Repairs & Maintenance | Computers 25-26 COST
-- MEGHA COMMUNICATION | Repairs & Maintenance | Computers 25-26 COST
-- SPS TECHNOLOGIES IDC | Repairs & Maintenance | Computers 25-26 COST
-- UNIQUE FACILITY SERVICE | Repairs & Maintenance | FURNITURE & FIXTURE - COST   [sub-head sits under a different head]
-- SRI SANCHIA COMPUTRONICS | Repairs & Maintenance | ELECTRICAL INSTALLATIONS - COST   [sub-head sits under a different head]
-- Deepak Kashyap Imp A/C | Repairs & Maintenance | Computers 25-26 COST
-- RDnetra Technologies Pvt. Ltd. | Repairs & Maintenance | Computer Software Cost 2025 - 26
-- SRI SANCHIA COMPUTRONICS | Repairs & Maintenance | Computers 26-27 COST
-- PJ Network Pvt Ltd | Repairs & Maintenance | Computer Software Cost 2026 - 27
-- TPM GURU PRIVATE LIMITED | Repairs & Maintenance | Computers 26-27 COST
-- TELEKONNECTORS LIMITED | Repairs & Maintenance | Computers 26-27 COST
-- SPS TECHNOLOGIES | Repairs & Maintenance | Computers 26-27 COST
-- MANI EXPORTS | Repairs & Maintenance | Computers 26-27 COST
-- VINOD ELECTRONICS | Repairs & Maintenance | Computers 26-27 COST
-- Accord Mobile Solution | Repairs & Maintenance | Computers 26-27 COST
-- J R M Infotech | Repairs & Maintenance | Computers 26-27 COST
-- OMNIVISIO TELECOM LLP | Repairs & Maintenance | Computer Software Cost 2026 - 27
-- OMNIVISION TELECOM LLP | Repairs & Maintenance | Computers 26-27 COST
-- Pooja (Vaishali) | Repairs & Maintenance | Computers 26-27 COST
-- WELCOME AIRCON | Repairs & Maintenance | ELECTRICAL INSTALLATIONS - COST   [sub-head sits under a different head]
-- RAJU KUMAR PANDIT | Repairs & Maintenance | ELECTRICAL INSTALLATIONS - COST   [sub-head sits under a different head]
-- ADARSH INFOTECH SYSTEMS | Repairs & Maintenance | Computers 26-27 COST
-- AFFABLE INFOTECH | Repairs & Maintenance | Computers 26-27 COST
-- Supreme Computers India | Repairs & Maintenance | Computers 26-27 COST
-- Cartesia AI, Inc. | Fee & Subscription | Fee & Subscription
-- OpenRouter, Inc | Fee & Subscription | Fee & Subscription
-- VSM Technologies Pvt Ltd. | Repairs & Maintenance | Computers 26-27 COST
-- Kapadia Global Actuaries | Fee & Subscription | Fee & Subscription
-- LOHAGARH FARMS PRIVATE LIMITED | Staff Welfare | R&R Expenses
