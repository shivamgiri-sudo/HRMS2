# Process P&L Matrix Redesign

## Summary

Redesign the `Process P&L` page at `/finance/process-pnl` so it becomes easier to scan, filter, compare, and act on process-level financial performance without weakening the accounting depth already present in the module.

The current experience is financially rich but operationally heavy. The biggest usability issue is that the Process Matrix behaves like a full export sheet rendered in-browser, which makes routine review slower than it should be for finance and business users.

The redesign keeps the finance engine, data model, and export completeness intact. The change is primarily information architecture and interaction design:

- keep a strong executive overview
- turn the matrix into a working analysis surface
- preserve a full audit-grade matrix for power users
- make alerts and reconciliation easier to discover and work through

## Product Framing

### Subject

This page is the process-level finance control tower for a BPO/HRMS system.

### Primary audience

- `super_admin`
- `finance`
- `finance_head`
- `accounts_head`
- `ceo`
- `coo`
- `payroll_head`

### Single job of the page

Help a finance or business leader answer:

1. Which processes are healthy, at risk, or loss-making right now?
2. Why is a given process in that state?
3. What requires follow-up today?

## Current State

The page already has the right high-level structure:

- a filter bar
- a KPI strip
- `CEO Overview`
- `Process Matrix`
- `Charts & Quality`

The main UX problem sits inside the matrix:

- the matrix currently renders as a single very wide table
- it mixes executive signals and forensic details in one view
- it asks most users to scroll horizontally across too many columns before they can answer basic questions
- it does not distinguish between routine review and deep investigation

## Problems To Solve

### 1. Too many columns at once

The current matrix exposes all finance dimensions together:

- commercial and delivery
- revenue statement
- cost statement
- profitability
- budget control

This is complete, but not comfortable for repeated use.

### 2. Weak task orientation

A user usually comes with a task:

- review profitability
- review revenue risk
- review cost pressure
- review budget utilization
- investigate one bad process

The UI should let users enter one of those modes directly instead of forcing them through the same universal sheet every time.

### 3. Power-user depth is mixed with everyday scanning

The export-grade view is valuable and must stay. The issue is that it currently competes with the primary working surface instead of sitting behind a deliberate "full matrix" mode.

### 4. Alerts are present but not dominant enough

Data quality and finance exceptions are visible, but they are not yet shaped as a first-class operational workflow.

## Goals

- Make the default Process Matrix usable in meetings and daily review.
- Reduce visual overload without losing accounting completeness.
- Help users identify bad processes faster.
- Keep the deep full matrix available for advanced users and export.
- Preserve current backend calculations and data lineage.

## Non-Goals

- No finance calculation logic changes.
- No changes to revenue recognition logic.
- No changes to cost allocation logic.
- No downgrade in export completeness.
- No replacement of the process detail page.

## Design Options Considered

### Option A: Keep the current full matrix and add minor styling

Pros:

- least implementation effort
- zero conceptual change

Cons:

- does not solve scanability
- keeps users trapped in horizontal-scroll analysis
- only improves cosmetics, not usability

### Option B: Replace the matrix with only summarized cards and charts

Pros:

- simpler first impression
- easier executive consumption

Cons:

- removes real finance working depth
- forces export or drilldown too early
- not good for finance controllers or analysts

### Option C: Layered matrix with presets plus full matrix

Pros:

- best balance of speed and completeness
- supports both casual and advanced users
- uses existing data well
- lowest risk to the finance engine

Cons:

- more frontend work than cosmetic cleanup
- requires careful state and column management

### Recommendation

Choose **Option C**.

## Recommended Information Architecture

Keep the page as three top-level tabs:

1. `Overview`
2. `Process Matrix`
3. `Alerts & Reconciliation`

Rename current `Charts & Quality` to `Alerts & Reconciliation` because that is closer to the user's real task.

### Overview

Purpose:

- leadership snapshot
- portfolio health
- top exceptions
- fast jump into deeper views

### Process Matrix

Purpose:

- daily working analysis surface
- side-by-side process comparison
- filtered finance review

### Alerts & Reconciliation

Purpose:

- finance control exceptions
- delivery gaps
- configuration gaps
- receivable and budget risk

## Process Matrix Redesign

### Core principle

The matrix should no longer show every column by default.

Instead, it should support **view presets**:

1. `Summary`
2. `Revenue`
3. `Cost`
4. `Profitability`
5. `Budget & Risk`
6. `Full Matrix`

### Default preset

Default to `Summary`.

This is the view most users should land on when they open `Process Matrix`.

### Shared frozen columns

Every preset should keep these columns pinned:

- `Process`
- `Client`
- `Branch`
- `Status`

These are the anchor columns and should remain visible during horizontal scrolling.

### Summary preset

Columns:

- Process
- Client
- Branch
- Status
- Recognized revenue
- Agent salary %
- DSC %
- BMC %
- EBITDA
- EBITDA %
- Budget utilization
- Revenue at risk
- Data status

Why:

- this answers the most common "what is going wrong where?" question

### Revenue preset

Columns:

- Process
- Client
- Branch
- Status
- Billing model
- Mandated seats
- Delivered units
- Billable units
- Earned revenue
- Recognized revenue
- Invoiced
- Collected
- Outstanding
- Unbilled
- Revenue at risk
- Revenue variance

Why:

- focuses on commercial realization and cash conversion

### Cost preset

Columns:

- Process
- Client
- Branch
- Status
- Agent salary
- Avg agent salary
- Agent salary %
- DSC people
- DSC non-people
- Total DSC
- BMC people
- BMC non-people
- Total BMC
- GRN/vendor actual
- Total people cost %

Why:

- gives finance a clean cost pressure view without revenue clutter

### Profitability preset

Columns:

- Process
- Client
- Branch
- Status
- Recognized revenue
- Contribution
- Contribution %
- EBITDA
- EBITDA %
- EBIT
- Operating profit %
- PBT
- PAT

Why:

- supports business review and leadership discussion

### Budget & Risk preset

Columns:

- Process
- Client
- Branch
- Status
- Approved budget
- Reserved budget
- Consumed budget
- Available budget
- Budget utilization
- Revenue at risk
- Outstanding receivable
- Unbilled revenue
- Data status

Why:

- keeps budget and exposure in one working view

### Full Matrix preset

Purpose:

- expert mode
- audit mode
- export parity mode

Rules:

- available, but never default
- clearly labeled as advanced
- optimized for desktop use

## Interaction Model

### Filters

Keep:

- period
- branch
- client
- search

Add:

- status filter: `Profitable`, `At risk`, `Loss making`
- issue filter:
  - `Revenue at risk`
  - `Delivery missing`
  - `Budget exceeded`
  - `High receivable`
  - `Accounting fallback`

The issue filter should be available as one-click chips above the table.

### Search

Search should match across:

- process name
- client name
- branch name
- cost centre code

### Totals row

Add a sticky summary row above the table body that reflects the current filtered dataset.

This row should show totals or weighted totals for the active preset where applicable.

### Sorting

Each visible metric column should be sortable.

Default sorting by preset:

- Summary: `EBITDA ascending` or `Status severity`
- Revenue: `Revenue at risk descending`
- Cost: `Agent salary % descending`
- Profitability: `EBITDA ascending`
- Budget & Risk: `Budget utilization descending`

### Row inspection

Add a row-level right-side drawer or detail panel instead of forcing immediate navigation.

The drawer should show:

- process identity
- process status
- top 6-8 core KPIs
- alerts affecting the process
- quick links:
  - open process detail page
  - open budget page
  - open related ledgers if available

## Alerts & Reconciliation Redesign

Convert the current charts-and-quality area into an action-oriented workspace.

### Sections

1. `Critical alerts`
2. `Warnings`
3. `Reconciliation blockers`
4. `Data coverage gaps`

### Example alert types

- delivery configured but no delivery received
- accounting fallback being used
- budget utilization above threshold
- large outstanding receivable
- large unbilled revenue
- missing mapping or configuration

### Desired behavior

Users should be able to:

- filter alerts by severity
- group by branch, client, or process
- click into the affected process directly

## Visual Design Direction

### General direction

Quiet operational finance UI, not marketing-style finance UI.

### Principles

- dense but readable
- restrained color
- strong table ergonomics
- clear hierarchy
- action-first controls

### Color behavior

Use color as meaning, not decoration:

- emerald for healthy outcomes
- amber for caution
- rose for loss or exception
- slate for neutral structure

### Typography behavior

- compact, steady sizing
- no oversized hero treatment inside tables
- strong numeric emphasis for money and percentage cells

### Spacing behavior

- keep controls shallow and horizontal
- avoid deep card nesting
- keep the matrix area dominant

## Responsiveness

### Desktop

Desktop is the primary target for the matrix.

Requirements:

- sticky headers
- sticky first columns
- no layout jumping
- clean horizontal scrolling

### Tablet

Keep presets and filters, but reduce visible controls before the table.

### Mobile

The full matrix should not attempt to behave like desktop.

Mobile should:

- prioritize Overview
- allow process list in compact card rows
- let users open one process at a time

## State Persistence

Persist user preferences locally for:

- active matrix preset
- visible columns
- density mode
- last-used sorting

Optional later enhancement:

- save named views per user

## Implementation Notes

### Preferred frontend strategy

Refactor the existing `BpoPnlMatrixTable` into:

- shared column metadata
- preset definitions
- table toolbar
- totals row
- row detail drawer

This is safer than creating multiple unrelated table components.

### Backend impact

No backend contract change is required for the first pass if the current summary payload already provides the needed row fields.

Potential future enhancement:

- server-side sorting and filtering for very large datasets

## Rollout Plan

### Phase 1

- add matrix presets
- add issue chips
- add status filter
- add sticky totals row
- improve search behavior
- keep full matrix available

### Phase 2

- add row detail drawer
- add column chooser
- add density mode
- add local persistence for user view state

### Phase 3

- redesign `Charts & Quality` into `Alerts & Reconciliation`
- add workflow-oriented alert filtering and grouping

## Acceptance Criteria

- Users can switch between at least five matrix presets without route changes.
- Default matrix view is `Summary`, not `Full Matrix`.
- `Full Matrix` remains available and retains current accounting completeness.
- First identifying columns remain sticky.
- The active filtered set shows a visible summary/totals row.
- Users can filter by process health status and issue chips.
- The page remains desktop-friendly and does not regress export capability.

## Risks

### Risk: Hidden metrics may make some users feel information was removed

Mitigation:

- keep `Full Matrix`
- make preset labels explicit
- add column chooser later

### Risk: Table refactor may introduce sorting or rendering regressions

Mitigation:

- centralize column definitions
- keep row field usage typed
- verify each preset against current matrix values

### Risk: Too much UI at once

Mitigation:

- ship in phases
- keep first pass tightly focused on the matrix

## Open Questions

1. Should `Summary` default sorting be `status severity` or `EBITDA ascending`?
2. Should the row detail drawer open on row click or only from an explicit action icon?
3. Should `Alerts & Reconciliation` include inline actions in phase 1, or only navigation and filtering?

## Recommendation

Proceed with **Phase 1 first**. It will deliver the biggest usability win with the lowest risk:

- better scanability
- lower cognitive load
- no backend finance rework
- preserves the full matrix for audit users
