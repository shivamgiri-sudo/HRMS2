# ATS Interview Registration — Dynamic Form Config + Resume Scanning

**Date:** 2026-06-02
**Status:** Approved
**Scope:** Make `/interview-registration` form fully configurable by Admin/HR without code changes + add optional Tesseract.js resume scanning

---

## Problem

All dropdown options (recruiter names, branches, roles, education, experience, shifts) and all field definitions (visible, required, label, order) in `src/pages/NativeATSCandidateRegistration.tsx` are hardcoded. Any change requires a code deployment. Recruiters list is currently empty. Branch list shows generic cities instead of real MAS Callnet branches.

---

## Solution

1. Store form config in MySQL (`ats_form_config`, `ats_recruiter`)
2. Backend `/api/ats/form-config/bootstrap` returns all config to the form on load
3. Admin panel at `/ats/form-config` for live editing — no code changes needed after this
4. Optional Tesseract.js resume scanning pre-fills form fields from a photo/image

---

## Data Sources Per Field

| Config Item | Source |
|---|---|
| Recruiter Names | `ats_recruiter` table (manually managed) |
| Branch options | `branch_master` table (live, auto-synced) |
| Role options | `ats_form_config` row `roleOptions` |
| Education options | `ats_form_config` row `educationOptions` |
| Experience options | `ats_form_config` row `experienceOptions` |
| Preferred Shift options | `ats_form_config` row `preferredShiftOptions` |
| Night Shift Comfort options | `ats_form_config` row `nightShiftComfortOptions` |
| Field schema (visible/required/label/order) | `ats_form_config` row `formFields` |

---

## Database Schema

### `ats_form_config`
```sql
CREATE TABLE ats_form_config (
  id           CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  config_key   VARCHAR(100) NOT NULL UNIQUE,
  config_label VARCHAR(200) NOT NULL,
  config_type  ENUM('option_list','field_schema') NOT NULL,
  config_value JSON         NOT NULL,
  sort_order   INT          NOT NULL DEFAULT 0,
  updated_by   CHAR(36)     NULL,
  updated_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

**Seeded rows:**
- `roleOptions` — `["Inbound Agent","Outbound Agent","Back Office","Team Leader","Quality Analyst"]`
- `educationOptions` — `["10th Pass","12th Pass","Graduate","Post Graduate","Diploma"]`
- `experienceOptions` — `["Fresher","0-1 Year","1-2 Years","2-3 Years","3+ Years"]`
- `preferredShiftOptions` — `["Morning (6AM-2PM)","Afternoon (2PM-10PM)","Night (10PM-6AM)","Rotational"]`
- `nightShiftComfortOptions` — `["Comfortable","Not Comfortable","On Request"]`
- `formFields` — full field schema array (see Field Schema section below)

### `ats_recruiter`
```sql
CREATE TABLE ats_recruiter (
  id            CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  name          VARCHAR(255) NOT NULL,
  active_status TINYINT(1)   NOT NULL DEFAULT 1,
  sort_order    INT          NOT NULL DEFAULT 0,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

---

## Field Schema (stored in `formFields` JSON)

Each field object:
```json
{
  "k": "name",
  "lb": "Full Name",
  "t": "text",
  "ic": "👤",
  "ph": "Enter your full name",
  "ok": null,
  "section": "Basic Details",
  "visible": true,
  "required": true,
  "sort_order": 1
}
```

Fields: `name`, `mobile`, `email`, `address`, `education`, `experience`, `gender`, `roleApplied`, `recruiterName`, `branch`, `rotationalShift`, `preferredShift`, `nightShiftComfort`, `leavesRequired`, `ownTwoWheeler`, `idProofAvailable`, `educationProofAvailable`, `resumeFile`, `selfieFile`

Rules:
- `resumeFile` and `selfieFile` can never be `required: true` (file fields)
- `name` and `mobile` cannot be set `visible: false` (minimum required for registration)

---

## Backend API

**Module:** `backend/src/modules/ats/ats-form-config.service.ts`
Routes added to existing `backend/src/modules/ats/ats.routes.ts`

### Public Endpoints (no auth)
```
GET /api/ats/form-config/bootstrap
  → { fields, recruiterOptions, branchOptions, roleOptions, educationOptions,
      experienceOptions, preferredShiftOptions, nightShiftComfortOptions }
```

### Admin/HR Endpoints (requireRole admin, hr)
```
GET    /api/ats/form-config              → all config rows
PUT    /api/ats/form-config/:key         → update one option list (body: { values: string[] })
PUT    /api/ats/form-config/fields       → update full field schema (body: { fields: FieldDef[] })

GET    /api/ats/recruiters               → list all recruiters
POST   /api/ats/recruiters               → create { name }
PATCH  /api/ats/recruiters/:id           → update { name?, active_status?, sort_order? }
DELETE /api/ats/recruiters/:id           → soft-delete (active_status = 0)
```

---

## Admin Panel UI

**File:** `src/pages/NativeATSFormConfig.tsx`
**Route:** `/ats/form-config` (ProtectedRoute, adminOnly)
**Nav:** Added to DashboardLayout under ATS group

### Tab 1 — Fields
- Table: Field Label | Section | Type | Visible (toggle) | Required (toggle) | Order (↑↓)
- Inline label editing
- `name` and `mobile` rows have Visible toggle disabled (always on)
- File-type fields have Required toggle disabled (always optional)
- Single "Save Changes" button → `PUT /api/ats/form-config/fields`

### Tab 2 — Dropdown Options
- Left sidebar: option group list (Role Options, Education, Experience, Preferred Shift, Night Shift Comfort)
- Right panel: tag-style chips for selected group's values
- Add: text input + Add button; Remove: × on chip; Reorder: drag handle
- Auto-saves on each change → `PUT /api/ats/form-config/:key`

### Tab 3 — Recruiters
- Table: Name | Active (toggle) | Order (↑↓) | Delete (×)
- "Add Recruiter" button → inline input row at top
- Saves immediately on each action

---

## Registration Form Changes (`NativeATSCandidateRegistration.tsx`)

### Bootstrap Load
Replace hardcoded `setBootstrap({...})` call with:
```
GET /api/ats/form-config/bootstrap
```
Map response directly into bootstrap state. If API fails, fall back to current hardcoded defaults.

### Field Rendering
Replace static `SECTIONS` constant with dynamic field schema from bootstrap:
- Filter `visible: true` fields only
- Group by `section` property
- Sort by `sort_order`
- Use `lb` for label, `required` for validation

### Scan Resume Feature (Optional — above form sections)
- "Scan Resume" button shown before Section 1
- On click: two options appear — "Take Photo" (camera) or "Upload Image" (file picker)
- Image captured → preview shown → "Extract Details" button
- Tesseract.js loads on demand from CDN (`https://cdn.jsdelivr.net/npm/tesseract.js`)
- OCR runs in-browser → raw text → regex extraction:
  - Name: first non-empty line OR line after "Name:"
  - Mobile: `\b[6-9]\d{9}\b` (Indian mobile pattern)
  - Email: standard email regex
  - Education: keyword match against educationOptions
  - Experience: keyword match against experienceOptions
  - Address: line(s) after "Address:" keyword
- Extracted fields pre-fill form; unmatched fields left blank
- Candidate reviews all fields before submitting
- Manual entry always available — scan is 100% optional

### Tesseract.js Integration
- Not bundled — loaded dynamically only when candidate clicks Scan Resume
- `const { createWorker } = await import('https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.esm.min.js')`
- Worker terminated after extraction to free memory
- Language: English (`eng`)

---

## Migration File

`backend/sql/051_ats_form_config.sql` — creates both tables, seeds all default option lists and the default `formFields` JSON.

Added to `backend/sql/000_run_all.sql` after `050_auth_mysql.sql`.

---

## Files Changed

| File | Action |
|---|---|
| `backend/sql/051_ats_form_config.sql` | New |
| `backend/sql/000_run_all.sql` | Add SOURCE line |
| `backend/src/modules/ats/ats-form-config.service.ts` | New |
| `backend/src/modules/ats/ats.routes.ts` | Add new routes |
| `src/pages/NativeATSFormConfig.tsx` | New |
| `src/pages/NativeATSCandidateRegistration.tsx` | Update bootstrap + field rendering + scan feature |
| `src/App.tsx` | Add `/ats/form-config` route |
| `src/components/layout/DashboardLayout.tsx` | Add nav item |

---

## Constraints

- `name` and `mobile` fields cannot be hidden (enforced in both UI and API)
- File fields (`resumeFile`, `selfieFile`) cannot be marked required
- Bootstrap endpoint is public (no auth) — registration form is public-facing
- Tesseract.js loaded on-demand only — does not affect page load time
- If DB has no config rows yet (fresh deploy), bootstrap falls back to hardcoded defaults
- Manual form entry always works regardless of scan feature
