# Branch Alias Setup — Interview Registration Page

## What This Does

Configures the ATS candidate registration page (`/interview-registration`) to:

1. **Show friendly names** to candidates:
   - "Okaya" → submits as "Noida 2"
   - "Trapezoid" → submits as "Noida"
   - "Jaldarshan" → submits as "AHM"

2. **Filter recruiters** by actual branch (Noida 2, Noida, AHM) — not the display alias

3. **Hide all other branches** from the dropdown (only these 3 remain active)

---

## Deployment Steps

### Step 1: Connect to Database Server

```powershell
# SSH to server (from your local machine)
ssh masadmin@192.168.11.225
# Password: Support#123
```

### Step 2: Run the Migration

```bash
# Navigate to HRMS directory
cd "C:\Users\shivamg\Upgraded HRMS"

# Pull latest code (contains the SQL file)
git pull origin main

# Run the migration
mysql -h 192.168.10.6 -u shivam_user -p mas_hrms < backend/sql/999_branch_alias_setup.sql
# Password: qwersdfg!@#hjk
```

### Step 3: Verify the Setup

```bash
mysql -h 192.168.10.6 -u shivam_user -p mas_hrms
```

```sql
-- Check active branches (should be ONLY 3)
SELECT branch_name, branch_code, active_status 
FROM branch_master 
WHERE active_status = 1;

-- Expected output:
-- +------------+-------------+---------------+
-- | branch_name| branch_code | active_status |
-- +------------+-------------+---------------+
-- | Noida 2    | ...         | 1             |
-- | Noida      | ...         | 1             |
-- | AHM        | ...         | 1             |
-- +------------+-------------+---------------+

-- Check branch aliases
SELECT canonical_key, display_name, alias_text, active_status 
FROM ats_branch_alias_master 
WHERE active_status = 1;

-- Expected output:
-- +---------------+--------------+-------------+---------------+
-- | canonical_key | display_name | alias_text  | active_status |
-- +---------------+--------------+-------------+---------------+
-- | Noida 2       | Okaya        | Okaya       | 1             |
-- | Noida         | Trapezoid    | Trapezoid   | 1             |
-- | AHM           | Jaldarshan   | Jaldarshan  | 1             |
-- +---------------+--------------+-------------+---------------+
```

---

## How It Works (No Code Changes Needed)

### Frontend (`/interview-registration`)

1. **Bootstrap API** (`/api/ats/form-config/bootstrap`) returns:
   ```json
   {
     "branchAliases": [
       {"canonical": "Noida 2", "display": "Okaya"},
       {"canonical": "Noida", "display": "Trapezoid"},
       {"canonical": "AHM", "display": "Jaldarshan"}
     ]
   }
   ```

2. **Branch dropdown** shows: "Okaya", "Trapezoid", "Jaldarshan"

3. **When candidate selects "Okaya":**
   - Frontend calls: `GET /api/ats/form-config/recruiters-by-branch?branch=Okaya`
   - Backend resolves: `Okaya` → `Noida 2`
   - Backend returns: recruiters assigned to `Noida 2` branch only

4. **On form submit:**
   - Frontend sends: `branchDisplayName: "Okaya"`
   - Backend resolves: `Okaya` → `Noida 2`
   - Database stores: `branch_name = "Noida 2"`

### Backend Resolution (Already Implemented)

File: `backend/src/modules/ats/ats-form-config.service.ts` (lines 233-243)

```ts
// Resolve display name → canonical branch name
const [aliasRows] = await db.execute(
  `SELECT canonical_key FROM ats_branch_alias_master 
   WHERE display_name = ? AND active_status = 1 LIMIT 1`,
  [branchDisplayName]
);
const canonicalKey = aliasRows[0]?.canonical_key ?? branchDisplayName;

// Use canonical key to filter recruiters
const [branchRows] = await db.execute(
  `SELECT branch_name FROM branch_master 
   WHERE active_status = 1 AND (branch_name = ? OR branch_code = ?) LIMIT 1`,
  [canonicalKey, canonicalKey]
);
const branchName = branchRows[0]?.branch_name ?? canonicalKey;
```

---

## Testing After Deployment

### 1. Open Registration Page
```
https://mcnhrms.teammas.in/interview-registration
```

### 2. Verify Branch Dropdown
- Should show ONLY: "Okaya", "Trapezoid", "Jaldarshan"
- Should NOT show: Mumbai, Delhi, Bangalore, etc.

### 3. Test Recruiter Filtering

**Test Case 1: Select "Okaya"**
- Branch dropdown → select "Okaya"
- Recruiter dropdown should populate with recruiters assigned to **Noida 2** branch only
- Submit form → verify database shows `branch_name = "Noida 2"`

**Test Case 2: Select "Trapezoid"**
- Branch dropdown → select "Trapezoid"
- Recruiter dropdown should populate with recruiters assigned to **Noida** branch only
- Submit form → verify database shows `branch_name = "Noida"`

**Test Case 3: Select "Jaldarshan"**
- Branch dropdown → select "Jaldarshan"
- Recruiter dropdown should populate with recruiters assigned to **AHM** branch only
- Submit form → verify database shows `branch_name = "AHM"`

### 4. Verify Database

```sql
-- Check latest candidate registration
SELECT 
  candidate_code,
  full_name,
  mobile,
  branch_name,
  recruiter_name,
  created_at
FROM ats_candidate
ORDER BY created_at DESC
LIMIT 5;

-- branch_name should be "Noida 2", "Noida", or "AHM" (NOT the display alias)
```

---

## Rollback (If Needed)

If you need to revert, run:

```sql
-- Reactivate all branches
UPDATE branch_master SET active_status = 1 WHERE active_status = 0;

-- Clear branch aliases
DELETE FROM ats_branch_alias_master;
```

---

## Current Status

- ✅ **Frontend code** — already handles branch aliases correctly
- ✅ **Backend code** — already resolves display → canonical correctly
- ⏳ **Database setup** — run `999_branch_alias_setup.sql` to activate

**No application restart needed** — changes take effect immediately after running the SQL migration.
