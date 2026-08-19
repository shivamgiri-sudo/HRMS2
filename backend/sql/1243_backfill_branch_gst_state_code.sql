-- 1243_backfill_branch_gst_state_code.sql
--
-- Backfills branch_master.gst_state_code (added NULL-only by 1087_branch_master_gst_registration.sql,
-- which explicitly deferred population: "There is no existing GSTIN anywhere to derive from
-- ... Finance must fill these in"). This is now blocking the client-billing module's
-- createProforma/approveInvoice, which correctly 400 without it (place-of-supply requires
-- the billing branch's GST state code). gst_state_code is NULL on all 45 live branch_master
-- rows as of 2026-08-19.
--
-- WHAT THIS DOES NOT DO: it does not populate branch_master.gstin (no real GSTIN exists
-- anywhere in this schema to source that from — still a genuine gap, Finance must supply
-- actual registration numbers). It does not touch gst_type, tax calculation, or any
-- payroll/salary logic. Per 1087's own warning, these columns remain display/validation
-- inputs only — nothing here infers or changes intra-/inter-state tax treatment.
--
-- SOURCE OF THE VALUES: the GST state code is a fixed, public 2-digit reference table
-- published by the GST Council (unchanged since Ladakh/code 38 was added in 2019-2020) —
-- not a per-branch judgment call. It was matched against branch_master's OWN existing
-- `state` column (already populated on 27 of 45 rows) wherever present, and against
-- `city` or `branch_name` (city/state-name inference, cross-checked against sibling rows
-- with the same city already carrying a populated `state`) for the remaining rows where
-- `state` was NULL. cost_centre_master was checked as a possible higher-confidence
-- alternate source and REJECTED: cost_centre_master.vendor_gst_state is the CLIENT/vendor's
-- own GST state per billing relationship, not the branch's physical location — a single
-- branch_id (fea10538-... "AHMEDABAD-JALDARSHAN") carries over 50 different, often
-- contradictory vendor_gst_state values (Gujarat, Delhi, Maharashtra, Karnataka, Bihar,
-- Madhya Pradesh, Rajasthan, and garbage values like "UK", ".", "0", "xx") because it is
-- one row per client, not one row per branch. branch_master.state/city is the only clean,
-- trustworthy in-schema signal.
--
-- 40 of 45 branches are backfilled below with high confidence. 5 are deliberately left
-- untouched (gst_state_code stays NULL) and are NOT covered by this migration:
--   - 775447b8-5e88-11f1-adb1-00155d0ab410  HEAD_OFFICE       — no city/state signal at all,
--     and the org has two distinct, genuinely different head offices in this same table
--     (HQ / Mumbai / Maharashtra and CORP / Noida / Uttar Pradesh) — which one this legacy
--     row represents cannot be determined from any column.
--   - 777bf0aa-5e88-11f1-adb1-00155d0ab410  SCAN_N_SMILE      — no city/state signal, name
--     does not resemble any Indian place name.
--   - 47a2a2ff-024c-47ad-8e23-0164938a792c  TD-BR-113934      — synthetic smoke-test branch
--   - 01f15cac-fc60-4010-aa29-026cba7c392c  TD-BR-182710      — (city="Smoke City",
--   - 8b87b6e6-a7f0-4baf-84e5-a4645a8095ee  TD-BR-182842      —  state="Smoke State")
--
-- Explicit per-row UPDATEs, not a derived/computed statement, so every value is reviewable
-- line-by-line. Each WHERE clause is id-scoped (branch_master.id is the PK) so this cannot
-- touch a row it doesn't name. WHERE also requires gst_state_code IS NULL, so a re-run is a
-- no-op and this never overwrites a value Finance has since entered by hand. Read-only
-- verified against live mas_hrms (192.168.10.6) 2026-08-19: all 45 target ids exist, all 45
-- have gst_state_code IS NULL today.
--
-- NOT registered in MIGRATION_MANIFEST — pending human review of the state-code values
-- below (see the companion branch_gst_state_code_review.md table). Do not add this file to
-- runPendingMigrations.ts's MIGRATION_MANIFEST until that review is done.

-- Gujarat (24) — state already GUJARAT/Gujarat, or name-inferred and cross-validated by a
-- sibling row with the same city that already carries state=Gujarat.
UPDATE branch_master SET gst_state_code = '24' WHERE id = '7736f3f2-5e88-11f1-adb1-00155d0ab410' AND gst_state_code IS NULL; -- AHEMDABAD (name-inferred; cross-validated by AHMH/AHMHO/AHMH-JD siblings)
UPDATE branch_master SET gst_state_code = '24' WHERE id = '7741538a-5e88-11f1-adb1-00155d0ab410' AND gst_state_code IS NULL; -- AHEMDABAD HOUSE (name-inferred; duplicate of AHMH which has state=GUJARAT)
UPDATE branch_master SET gst_state_code = '24' WHERE id = '7746c6f9-5e88-11f1-adb1-00155d0ab410' AND gst_state_code IS NULL; -- AHEMDABAD OTHERS (name-inferred; duplicate of AHMHO which has state=GUJARAT)
UPDATE branch_master SET gst_state_code = '24' WHERE id = 'fe9c9d14-6583-11f1-adb1-00155d0ab410'  AND gst_state_code IS NULL; -- AHMH / AHMEDABAD HOUSE, state=GUJARAT
UPDATE branch_master SET gst_state_code = '24' WHERE id = 'fe9e502c-6583-11f1-adb1-00155d0ab410'  AND gst_state_code IS NULL; -- AHMHO / AHMEDABAD OTHERS, state=GUJARAT
UPDATE branch_master SET gst_state_code = '24' WHERE id = 'fea10538-6583-11f1-adb1-00155d0ab410'  AND gst_state_code IS NULL; -- AHMH-JD / AHMEDABAD-JALDARSHAN, state=Gujarat, address confirms "Ahmedabad, Gujarat"
UPDATE branch_master SET gst_state_code = '24' WHERE id = 'fea2c991-6583-11f1-adb1-00155d0ab410'  AND gst_state_code IS NULL; -- AHMEDABAD-NEELAKANTH, state=Gujarat

-- Karnataka (29)
UPDATE branch_master SET gst_state_code = '29' WHERE id = '6a8f88f1-5caf-11f1-adb1-00155d0ab410'  AND gst_state_code IS NULL; -- BLORE / Bangalore Office, city=Bengaluru, state=Karnataka

-- Delhi (07)
UPDATE branch_master SET gst_state_code = '07' WHERE id = '774b3ded-5e88-11f1-adb1-00155d0ab410'  AND gst_state_code IS NULL; -- DEL_OTHERS (name-inferred from "DEL" prefix; cross-validated by DELHI/07/DEL siblings, all Delhi)
UPDATE branch_master SET gst_state_code = '07' WHERE id = 'fea43dc9-6583-11f1-adb1-00155d0ab410'  AND gst_state_code IS NULL; -- branch_code "07" / DELHI, state=DELHI
UPDATE branch_master SET gst_state_code = '07' WHERE id = '6a8f81b1-5caf-11f1-adb1-00155d0ab410'  AND gst_state_code IS NULL; -- DELHI / Delhi Office, city=New Delhi, state=Delhi
UPDATE branch_master SET gst_state_code = '07' WHERE id = 'feb3ff2d-6583-11f1-adb1-00155d0ab410'  AND gst_state_code IS NULL; -- QUAL / MAYAPURI, state=DELHI (Mayapuri is a West Delhi industrial area — consistent)
UPDATE branch_master SET gst_state_code = '07' WHERE id = 'feb60126-6583-11f1-adb1-00155d0ab410'  AND gst_state_code IS NULL; -- QUAL-MP / MAYAPURI-MP, state=DELHI
UPDATE branch_master SET gst_state_code = '07' WHERE id = 'fea5b34a-6583-11f1-adb1-00155d0ab410'  AND gst_state_code IS NULL; -- DEL / VDF MANPOWER, state=DELHI

-- Uttar Pradesh (09)
UPDATE branch_master SET gst_state_code = '09' WHERE id = 'fea80658-6583-11f1-adb1-00155d0ab410'  AND gst_state_code IS NULL; -- branch_code "09" / GENLEAP, state=Uttar Pradesh
UPDATE branch_master SET gst_state_code = '09' WHERE id = 'fea9fdc3-6583-11f1-adb1-00155d0ab410'  AND gst_state_code IS NULL; -- CORP / HEAD OFFICE, state=Uttar Pradesh, address = Trapezoid IT Park, Sector 62, Noida
UPDATE branch_master SET gst_state_code = '09' WHERE id = 'feb1fdad-6583-11f1-adb1-00155d0ab410'  AND gst_state_code IS NULL; -- MAS_SKILL / MAS-SKILL DEVELOPMENT PROJECT, state=Uttar Pradesh
UPDATE branch_master SET gst_state_code = '09' WHERE id = 'feb79faa-6583-11f1-adb1-00155d0ab410'  AND gst_state_code IS NULL; -- MRT / MEERUT, state=Uttar Pradesh
UPDATE branch_master SET gst_state_code = '09' WHERE id = '776e35e3-5e88-11f1-adb1-00155d0ab410'  AND gst_state_code IS NULL; -- MEERUT (name-inferred; cross-validated by MRT sibling, state=Uttar Pradesh)
UPDATE branch_master SET gst_state_code = '09' WHERE id = '91f782f2-6577-11f1-adb1-00155d0ab410'  AND gst_state_code IS NULL; -- JALDARSHAN / Jaldarshan, city=Noida (state was NULL; city-inferred)
UPDATE branch_master SET gst_state_code = '09' WHERE id = '91f8d8fb-6577-11f1-adb1-00155d0ab410'  AND gst_state_code IS NULL; -- NEELKANTH / Neelkanth, city=Noida (state was NULL; city-inferred)
UPDATE branch_master SET gst_state_code = '09' WHERE id = '77769026-5e88-11f1-adb1-00155d0ab410'  AND gst_state_code IS NULL; -- NOIDA / NOIDA, city=Noida, state=Uttar Pradesh
UPDATE branch_master SET gst_state_code = '09' WHERE id = 'febb909f-6583-11f1-adb1-00155d0ab410'  AND gst_state_code IS NULL; -- NOIDA_ISPARK-2, state=Uttar Pradesh
UPDATE branch_master SET gst_state_code = '09' WHERE id = 'febd8777-6583-11f1-adb1-00155d0ab410'  AND gst_state_code IS NULL; -- NOIDA-2, state=Uttar Pradesh, address = Okaya Tower-1, Sector 62, Noida
UPDATE branch_master SET gst_state_code = '09' WHERE id = 'febeee54-6583-11f1-adb1-00155d0ab410'  AND gst_state_code IS NULL; -- NOIDA-DD / NOIDA-DIALDESK, state=Uttar Pradesh
UPDATE branch_master SET gst_state_code = '09' WHERE id = 'fec0d5da-6583-11f1-adb1-00155d0ab410'  AND gst_state_code IS NULL; -- NOI_ISPARK / NOIDA-ISPARK, state=Uttar Pradesh
UPDATE branch_master SET gst_state_code = '09' WHERE id = '6a90b9e7-5caf-11f1-adb1-00155d0ab410'  AND gst_state_code IS NULL; -- OKAYA / Okaya Operations, city=Noida, state=Uttar Pradesh
UPDATE branch_master SET gst_state_code = '09' WHERE id = 'fec24b2c-6583-11f1-adb1-00155d0ab410'  AND gst_state_code IS NULL; -- PAYPIK, state=Uttar Pradesh
UPDATE branch_master SET gst_state_code = '09' WHERE id = '91fdd4e7-6577-11f1-adb1-00155d0ab410'  AND gst_state_code IS NULL; -- TRAPEZOID / Trapezoid, city=Noida (state was NULL; city-inferred, matches CORP's "Trapezoid IT Park" address)

-- Maharashtra (27)
UPDATE branch_master SET gst_state_code = '27' WHERE id = '6a8c14d9-5caf-11f1-adb1-00155d0ab410'  AND gst_state_code IS NULL; -- HQ / Head Office, city=Mumbai, state=Maharashtra

-- Telangana (36)
UPDATE branch_master SET gst_state_code = '36' WHERE id = '6a90bb9d-5caf-11f1-adb1-00155d0ab410'  AND gst_state_code IS NULL; -- HYD / HYDERABAD, city=Hyderabad, state=TELANGANA
UPDATE branch_master SET gst_state_code = '36' WHERE id = '77591cda-5e88-11f1-adb1-00155d0ab410'  AND gst_state_code IS NULL; -- HYDERABAD (name-inferred; cross-validated by HYD sibling)

-- Rajasthan (08)
UPDATE branch_master SET gst_state_code = '08' WHERE id = '775ec387-5e88-11f1-adb1-00155d0ab410'  AND gst_state_code IS NULL; -- JAIPUR (name-inferred; cross-validated by JPR sibling)
UPDATE branch_master SET gst_state_code = '08' WHERE id = 'fead2650-6583-11f1-adb1-00155d0ab410'  AND gst_state_code IS NULL; -- JPR / JAIPUR, state=Rajasthan
UPDATE branch_master SET gst_state_code = '08' WHERE id = '7764b8ec-5e88-11f1-adb1-00155d0ab410'  AND gst_state_code IS NULL; -- JAIPUR_IDC (name-inferred; cross-validated by JAID sibling)
UPDATE branch_master SET gst_state_code = '08' WHERE id = 'feae8bc7-6583-11f1-adb1-00155d0ab410'  AND gst_state_code IS NULL; -- JAID / JAIPUR IDC, state=RAJASTHAN

-- Haryana (06)
UPDATE branch_master SET gst_state_code = '06' WHERE id = 'feb03b3a-6583-11f1-adb1-00155d0ab410'  AND gst_state_code IS NULL; -- KNL / KARNAL, state=HARYANA
UPDATE branch_master SET gst_state_code = '06' WHERE id = '77699469-5e88-11f1-adb1-00155d0ab410'  AND gst_state_code IS NULL; -- KARNAL (name-inferred; cross-validated by KNL sibling)

-- Punjab (03)
UPDATE branch_master SET gst_state_code = '03' WHERE id = 'feb94bca-6583-11f1-adb1-00155d0ab410'  AND gst_state_code IS NULL; -- CHD / MOHALI, state=PUNJAB (Mohali city is in Punjab despite the "CHD" branch_code)
UPDATE branch_master SET gst_state_code = '03' WHERE id = '7771d8a2-5e88-11f1-adb1-00155d0ab410'  AND gst_state_code IS NULL; -- MOHALI (name-inferred; cross-validated by CHD sibling)

-- Deliberately NOT updated (5 branches — see header): 775447b8-5e88-11f1-adb1-00155d0ab410
-- (HEAD_OFFICE), 777bf0aa-5e88-11f1-adb1-00155d0ab410 (SCAN_N_SMILE),
-- 47a2a2ff-024c-47ad-8e23-0164938a792c / 01f15cac-fc60-4010-aa29-026cba7c392c /
-- 8b87b6e6-a7f0-4baf-84e5-a4645a8095ee (TD-BR-* smoke-test branches).

SELECT '1243_backfill_branch_gst_state_code.sql applied' AS migration_status;
