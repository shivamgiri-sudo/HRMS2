# Configuration Control Center — Phase 1 Design Spec

**Date:** 2026-07-31  
**Status:** Approved  
**Scope:** Read-only inventory hub + governance foundation migrations  
**Roles:** super_admin, admin  

---

## Context

HRMS 2 has 30+ configuration pages across six route modules with no central entry point, no health dashboard, and no consistent governance standard. This spec covers Phase 1: a read-only inventory hub at `/admin/configuration` and three additive SQL migrations.

---

## Architecture

### Frontend — `src/pages/NativeConfigurationCenter.tsx`

Single page, no API calls. All data is a static typed array of `ConfigDomainRecord[]` and `DbTableRecord[]` defined at module level. The page renders four tabs using existing shadcn `Tabs` / `Card` / `Badge` primitives matching the `NativePolicyEngine` pattern.

**No new backend endpoint is needed for Phase 1.**

### Backend — Three additive SQL migrations

| File | Purpose |
|---|---|
| `1030_configuration_center_page_catalog.sql` | Register `CONFIGURATION_CENTER` page code; grant to super_admin + admin |
| `1031_config_governance_foundation.sql` | ADD COLUMN IF NOT EXISTS governance fields on `leave_policy_config` and `kpi_master_config` |
| `1032_apr_eligibility_config.sql` | CREATE TABLE `apr_eligibility_config`; seed existing hard-coded rule |

---

## Page Structure

### Header
- Title: "Configuration Control Center"
- Subtitle: "Governance inventory for all HRMS configuration domains"
- Role badge showing super_admin / admin view

### Tab 1 — Overview
- **Health score bar**: % of config tables with at least `effective_from` column (currently 3/26 = 12%)
- **Summary stat tiles** (4): Total domains (13), Active config pages (31), Tables with versioning (3), Known hard-coded rules (7)
- **Risk breakdown table**: Critical / High / Medium / Low — domain names + what is at risk
- **Pending governance work** list: 7 confirmed gaps with proposed resolution phase

### Tab 2 — By Domain
- 13 domain cards in a responsive grid (3-col desktop, 2-col tablet, 1-col mobile)
- Each card: domain icon, domain name, page count badge, table count badge, governance level badge (None / Basic / Versioned / Good), "Open pages" dropdown button linking to each config page for that domain
- Domains: Attendance, Leave, WFM/Roster, Break, Payroll, KPI/Performance, Workflow, ATS, Communication, Finance/P&L, LMS Integration, Privacy/Compliance, System/Org

### Tab 3 — Gaps & Risks
- Sortable table: Domain | Config/Table | Gap Type | Risk Level | Proposed Fix | Phase
- 7 confirmed rows (see plan for full list)
- Risk level color-coded badges: Critical (red), High (amber), Medium (yellow), Low (slate)

### Tab 4 — DB Tables
- Searchable/sortable table: Table Name | Migration File | effective_from | History Table | Maker/Checker | Scope | Governance Level | Config Page Link
- 26 rows covering all confirmed config tables
- Search box narrows by table name or domain

---

## Component Breakdown

All within a single file to keep Phase 1 minimal:

| Section | Implementation |
|---|---|
| Static data arrays | Module-level `DOMAINS`, `DB_TABLES`, `GAPS` constants (typed) |
| Health score | Derived from `DB_TABLES` array — count rows where `hasEffectiveFrom = true` |
| Domain cards | `DomainCard` inner component — receives domain record, renders card |
| Tables tab | `useState` for search term; filtered slice of `DB_TABLES` |
| Gaps tab | Static render, badge color driven by `riskLevel` field |
| Nav links | `<a href="...">` tags — no react-router navigate needed (opens in same tab) |

---

## Data Types

```ts
type GovernanceLevel = 'none' | 'basic' | 'versioned' | 'good';
type RiskLevel = 'critical' | 'high' | 'medium' | 'low';
type GapType = 'hard-coded' | 'missing-columns' | 'no-versioning' | 'raw-json' | 'no-eligibility-type';

interface ConfigDomainRecord {
  key: string;
  name: string;
  icon: string;           // lucide icon name
  pages: { label: string; href: string }[];
  tables: string[];
  governanceLevel: GovernanceLevel;
  coverage: string;       // human description
}

interface DbTableRecord {
  tableName: string;
  migrationFile: string;
  hasEffectiveFrom: boolean;
  hasHistoryTable: boolean;
  hasMakerChecker: boolean;
  scopeType: string;
  governanceLevel: GovernanceLevel;
  configPageHref: string | null;
}

interface GapRecord {
  domain: string;
  configOrTable: string;
  gapType: GapType;
  riskLevel: RiskLevel;
  proposedFix: string;
  phase: string;
}
```

---

## Route & Nav Registration

**`src/config/routes/platform.routes.tsx`** — add:
```tsx
const NativeConfigurationCenter = lazy(() => import("@/pages/NativeConfigurationCenter"));
<Route path="/admin/configuration"
  element={<ProtectedRoute roles={['super_admin','admin']}>
    <Gate pageCode="CONFIGURATION_CENTER"><NativeConfigurationCenter /></Gate>
  </ProtectedRoute>}
/>
```

**`src/components/layout/navConfig.tsx`** — add to Admin → "Access & Settings" children:
```tsx
{ label: "Config Center", href: "/admin/configuration", icon: ic(LayoutDashboard),
  roles: ["super_admin","admin"], description: "Configuration inventory & governance" },
```

---

## What This Does NOT Change

- No existing route, page, service, or calculation is modified
- The APR service continues reading hard-coded values until Phase 2
- All SQL migrations are additive only (no DROP, no DELETE, no UPDATE to existing rows)
- The inventory page is read-only in Phase 1

---

## Verification Checklist

1. `npm run build` — zero TypeScript errors
2. `/admin/configuration` loads as super_admin — all 4 tabs render
3. `/admin/configuration` as employee — blocked by ProtectedRoute
4. Each domain card "Open" link navigates to the correct existing config page
5. DB Tables search box filters rows by table name
6. SQL migration 1030 — `page_catalog` entry present, `role_page_access` grants correct
7. SQL migration 1031 — `SHOW COLUMNS FROM leave_policy_config` and `kpi_master_config` show new columns
8. SQL migration 1032 — `SELECT * FROM apr_eligibility_config` returns the seeded row

---

## Phase 2 Preview (not in scope)

- Real backend API reading live counts and last-updated timestamps
- APR service wired to `apr_eligibility_config`
- Leave gender eligibility moved to `leave_type_master` column
- `leave_policy_config` extended with carry_forward, lapse, sandwich fields
- Scope hierarchy resolver
- Maker-checker workflow for high-risk domains
