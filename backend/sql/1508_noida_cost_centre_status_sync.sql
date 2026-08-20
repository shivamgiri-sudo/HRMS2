-- Migration 1508: Sync Noida cost centre active/inactive status
-- Source: user-provided master list of 15 active cost centres for Noida branch (2026-08-20)
-- All Noida cost centres NOT in the active list are set to inactive/closed.

-- Step 1: Mark the 15 active Noida cost centres
UPDATE cost_centre_master
SET
  active_status = 1,
  status        = 'active',
  updated_at    = NOW()
WHERE cost_centre_code IN (
  'BSS/BLD/Noida/630',
  'BSS/BO/Noida/754',
  'BSS/BO/Noida/768',
  'BSS/BO/Noida/795',
  'BSS/IB/Noida/534',
  'BSS/IB/Noida/647',
  'BSS/IB/Noida/654',
  'BSS/IB/Noida/756',
  'BSS/IB/Noida/892',
  'BSS/OB/Noida/592',
  'BSS/OB/Noida/1005',
  'BSS/OB/Noida/923',
  'BSS/OB/Noida/961',
  'BSS/OB/Noida/966',
  'BSS/OB/Noida/968'
);

-- Step 2: Mark all other Noida cost centres as inactive/closed
UPDATE cost_centre_master
SET
  active_status = 0,
  status        = 'closed',
  updated_at    = NOW()
WHERE cost_centre_code LIKE '%/Noida/%'
  AND cost_centre_code NOT IN (
    'BSS/BLD/Noida/630',
    'BSS/BO/Noida/754',
    'BSS/BO/Noida/768',
    'BSS/BO/Noida/795',
    'BSS/IB/Noida/534',
    'BSS/IB/Noida/647',
    'BSS/IB/Noida/654',
    'BSS/IB/Noida/756',
    'BSS/IB/Noida/892',
    'BSS/OB/Noida/592',
    'BSS/OB/Noida/1005',
    'BSS/OB/Noida/923',
    'BSS/OB/Noida/961',
    'BSS/OB/Noida/966',
    'BSS/OB/Noida/968'
  );
