-- 605_deactivate_closed_branch_ghost_employees.sql
--
-- Marks 192 employee records inactive. They are flagged active in HRMS but three
-- independent sources agree they are not currently employed:
--
--   1. Not one has EVER been marked present in attendance_daily_record. For comparison,
--      1,013 of 1,051 active employees at open branches have been, and 1,010 within the
--      last 90 days. This is not a coverage gap in one period — it is a total absence.
--   2. All are missing from db_bill.masjclrentry, the legacy joining/clearance register,
--      which is live: its newest rows carry DOJ 2026-07-30 and 2026-07-31. The join key is
--      sound — 1,049 of 1,342 HRMS actives were matched, and only 2 open-branch employees
--      were absent, against all 291 closed-branch ones.
--   3. Their branch is closed (branch_master.active_status <> 1).
--
-- Last payment for every employee below is 2026-03 or never — five months ago.
--
-- db_bill.employee_master was checked first and is NOT usable as evidence either way: its
-- Status column stopped being maintained (2,112 rows sit at NULL, including 74 for NOIDA
-- where HRMS has 406 active), EntryDate/CreateDate/lastUpdated are all 0000-00-00, and DOJ
-- is a varchar holding values like 'EXECUTIVE - BACKEND'. masjclrentry is the live register.
--
-- DELIBERATELY EXCLUDED, and left active:
--   * 51 Delhi Office employees paid in 2026-06. They share every other signal, but someone
--     paid them last month. Deactivating a person who is still being paid is a materially
--     worse error than leaving a stale record, so they need a human decision. Listed in the
--     session report.
--   * 48 test fixtures (TD*/EMP-* codes, TEST DEMO / Test names) — a separate cleanup.
--
-- The employee list is explicit rather than a criteria re-query on purpose: run next month,
-- a criteria-based UPDATE would silently select a different and larger population.
--
-- Reversible: the exact prior state was active_status = 1 and employment_status = 'active'
-- for every code below. The rollback at the foot of this file restores it exactly.

START TRANSACTION;

UPDATE employees
   SET active_status      = 0,
       employment_status  = 'inactive',
       updated_at         = CURRENT_TIMESTAMP
 WHERE employee_code IN (
  'ADMIN001',
  'KARNAL',
  'MAS-HR-001',
  '0918C',
  '10541C',
  '1566C',
  '11113C',
  '12186C',
  '18701C',
  '18786C',
  '19780C',
  '24354C',
  '24536C',
  '24870C',
  '25338C',
  '25461C',
  '25648C',
  '26363C',
  '26688C',
  '26780C',
  '27173C',
  '27217C',
  '27225C',
  '27292C',
  '27438C',
  '27544C',
  '27796C',
  '27801C',
  '27879C',
  '27882C',
  '28142C',
  '28960C',
  '29059C',
  '29261C',
  '29399C',
  '29435C',
  '29550C',
  '29854C',
  '29856C',
  '29903C',
  '30093C',
  '30319C',
  '8870C',
  'MAS02602',
  'MAS07861',
  'MAS07961',
  'MAS08057',
  'MAS25443',
  'MAS25615',
  'MAS27376',
  'MAS29633',
  'MAS30437',
  '29552C',
  'MAS02995',
  'MAS07320',
  'MAS28874',
  '10334C',
  '10626C',
  '10781C',
  '11822C',
  '23313C',
  '24161C',
  '24763C',
  '25231C',
  '25693C',
  '26118C',
  '26580C',
  '27507C',
  '27530C',
  '28332C',
  '28573C',
  '29335C',
  '29342C',
  '29772C',
  '29791C',
  '29884C',
  '29885C',
  '30091C',
  '9958C',
  '10512C',
  '11191C',
  '11502C',
  '11948C',
  '12162C',
  '18951C',
  '19169C',
  '21861C',
  '22794C',
  '23717C',
  '24690C',
  '25852C',
  '26239C',
  '26825C',
  '28214C',
  '29103C',
  '29238C',
  '29328C',
  '29406C',
  '29688C',
  '8409C',
  'MAS24309',
  'MAS25279',
  'MAS25340',
  '23103C',
  '23437C',
  '23445C',
  '23656C',
  '23792C',
  '24171C',
  '24419C',
  '25124C',
  '25362C',
  '25819C',
  '26009C',
  '26367C',
  '26472C',
  '26879C',
  '27101C',
  '27591C',
  '27651C',
  '27929C',
  '28028C',
  '28321C',
  '28438C',
  '28524C',
  '29199C',
  '29244C',
  '29294C',
  '29513C',
  '29606C',
  '29699C',
  '29776C',
  '29864C',
  '29865C',
  '29866C',
  '30025C',
  '30118C',
  '30120C',
  '30301C',
  '30362C',
  'MAS04012',
  'MAS19262',
  'MAS19492',
  'MAS19906',
  'MAS29812',
  'MAS29832',
  'MAS29835',
  'MAS29859',
  'MAS29867',
  'MAS29874',
  'MAS29879',
  'MAS30115',
  'MAS30405',
  'MAS32164',
  '27946C',
  '29106C',
  '29107C',
  '29848C',
  '29916C',
  '29945C',
  'MAS07068',
  'MAS07761',
  'MAS27747',
  'MAS28108',
  '11860C',
  '12124C',
  '21622C',
  '26886C',
  '28450C',
  '28907C',
  '29097C',
  '29578C',
  '29619C',
  '29736C',
  '30395C',
  '8624C',
  '8628C',
  '8633C',
  '8651C',
  '9744C',
  'MAS07926',
  'MAS21222',
  'MAS22752',
  'MAS22774',
  'MAS26838',
  'MAS27848',
  'MAS29092',
  'MAS29630',
  'MAS29677',
  'MAS29973',
  'MAS30032',
  'MAS30367'
 )
   AND active_status = 1
   AND LOWER(employment_status) = 'active';

COMMIT;

-- Expected: 192 rows affected.
-- Distribution: (none) 3, AHEMDABAD 3, AHEMDABAD HOUSE 46, Delhi Office 1, HEAD OFFICE 3, HYDERABAD 23, JAIPUR 24, KARNAL 51, MEERUT 10, MOHALI 28
--
-- Rollback:
--   UPDATE employees SET active_status = 1, employment_status = 'active'
--    WHERE employee_code IN ( <the same list above> );
