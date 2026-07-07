# Task 2: Backend Service - Core Tracker Data Fetching

**Files:**
- Create: `backend/src/modules/ats/ats.joiningDocumentsTracker.service.ts`
- Create: `backend/src/modules/ats/__tests__/ats.joiningDocumentsTracker.service.test.ts`

**Interfaces:**
- Consumes: `db` (mysql2), `getUserRoleKeys`, `getEmployeeForUser`
- Produces:
  - `parseKeyDocuments(keyDocumentsRaw: string | null): KeyDocumentStatus[]`
  - `calculateTrackerSummary(employees: EmployeeDocumentRow[]): TrackerSummary`
  - `getJoiningDocumentsTracker(actorUserId: string, filters: TrackerQueryParams): Promise<TrackerResponse>`

**Complete task steps are in plan lines 115-585.**

Key implementation details:
- TDD: write test first, see it fail, implement, see it pass
- Three functions with unit tests
- SQL query with GROUP_CONCAT for key documents
- Branch head scoping (if role=branch_head, filter by user's branch)
- All filters from TrackerQueryParams applied dynamically

See full plan for exact test cases, SQL query, and TypeScript interfaces.
