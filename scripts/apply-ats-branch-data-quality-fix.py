from pathlib import Path

SERVICE_PATH = Path("backend/src/modules/ats/recruiter-hiring.service.ts")


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)


def main() -> None:
    service = SERVICE_PATH.read_text(encoding="utf-8")

    service = replace_once(
        service,
        '''    if (branch) {
      clauses.push("(arha.branch_name = ? OR arha.created_by = ? OR arha.recruiter_id = ?)");
      params.push(branch, userId, userId);
    } else {''',
        '''    if (branch) {
      clauses.push(`(
        LOWER(TRIM(COALESCE(arha.branch_name, ''))) = LOWER(TRIM(?))
        OR LOWER(TRIM(COALESCE(arha.location_name, ''))) = LOWER(TRIM(?))
        OR EXISTS (
          SELECT 1
            FROM branch_master bm_scope
           WHERE LOWER(TRIM(COALESCE(bm_scope.branch_name, ''))) = LOWER(TRIM(?))
             AND (
               LOWER(TRIM(COALESCE(arha.branch_name, ''))) IN (
                 LOWER(TRIM(COALESCE(bm_scope.branch_name, ''))),
                 LOWER(TRIM(COALESCE(bm_scope.branch_code, '')))
               )
               OR LOWER(TRIM(COALESCE(arha.location_name, ''))) IN (
                 LOWER(TRIM(COALESCE(bm_scope.branch_name, ''))),
                 LOWER(TRIM(COALESCE(bm_scope.branch_code, '')))
               )
             )
        )
        OR arha.created_by = ?
        OR arha.recruiter_id = ?
      )`);
      params.push(branch, branch, branch, userId, userId);
    } else {''',
        "canonical recruiter branch scope",
    )

    service = replace_once(
        service,
        '''              SUM(CASE WHEN ${IS_SELECTED}  THEN 1 ELSE 0 END) AS selected,
              SUM(CASE WHEN ${IS_JOINED}    THEN 1 ELSE 0 END) AS joined
         FROM ats_recruiter_hiring_activity arha WHERE ${W}''',
        '''              SUM(CASE WHEN ${IS_SELECTED}  THEN 1 ELSE 0 END) AS selected,
              SUM(CASE WHEN ${IS_JOINED}    THEN 1 ELSE 0 END) AS joined,
              SUM(CASE
                    WHEN COALESCE(arha.walkin_flag, 0) = 1
                     AND COALESCE(arha.contacted_flag, 0) = 0
                    THEN 1 ELSE 0
                  END) AS walkins_without_contact,
              SUM(CASE
                    WHEN COALESCE(arha.final_selection_flag, 0) = 1
                     AND COALESCE(arha.walkin_flag, 0) = 0
                    THEN 1 ELSE 0
                  END) AS selected_without_walkin,
              SUM(CASE
                    WHEN COALESCE(arha.joined_flag, 0) = 1
                     AND COALESCE(arha.final_selection_flag, 0) = 0
                    THEN 1 ELSE 0
                  END) AS joined_without_selection
         FROM ats_recruiter_hiring_activity arha WHERE ${W}''',
        "raw branch-stage issue aggregation",
    )

    service = replace_once(
        service,
        '''    selected: number;
    joined: number;
  }>();''',
        '''    selected: number;
    joined: number;
    walkinsWithoutContact: number;
    selectedWithoutWalkin: number;
    joinedWithoutSelection: number;
  }>();''',
        "branch accumulator validation fields",
    )

    service = replace_once(
        service,
        '''      selected: 0,
      joined: 0,
    };''',
        '''      selected: 0,
      joined: 0,
      walkinsWithoutContact: 0,
      selectedWithoutWalkin: 0,
      joinedWithoutSelection: 0,
    };''',
        "branch accumulator validation defaults",
    )

    service = replace_once(
        service,
        '''    current.selected += Number(row.selected) || 0;
    current.joined += Number(row.joined) || 0;
    branchAccumulator.set(preferred, current);''',
        '''    current.selected += Number(row.selected) || 0;
    current.joined += Number(row.joined) || 0;
    current.walkinsWithoutContact += Number(row.walkins_without_contact) || 0;
    current.selectedWithoutWalkin += Number(row.selected_without_walkin) || 0;
    current.joinedWithoutSelection += Number(row.joined_without_selection) || 0;
    branchAccumulator.set(preferred, current);''',
        "branch accumulator validation totals",
    )

    service = replace_once(
        service,
        '''      const dataQualityIssues: string[] = [];
      if (row.contacted > row.total) dataQualityIssues.push("Contacted exceeds logged");
      if (row.walkins > row.contacted) dataQualityIssues.push("Walk-ins exceed contacted");
      if (row.selected > row.walkins) dataQualityIssues.push("Selected exceeds walk-ins");
      if (row.joined > row.selected) dataQualityIssues.push("Joined exceeds selected");
      return {
        ...row,''',
        '''      const dataQualityIssues: string[] = [];
      if (row.walkinsWithoutContact > 0) {
        dataQualityIssues.push(`${row.walkinsWithoutContact} walk-in record(s) not marked contacted`);
      }
      if (row.selectedWithoutWalkin > 0) {
        dataQualityIssues.push(`${row.selectedWithoutWalkin} selected record(s) not marked walk-in`);
      }
      if (row.joinedWithoutSelection > 0) {
        dataQualityIssues.push(`${row.joinedWithoutSelection} joined record(s) not marked selected`);
      }
      const {
        walkinsWithoutContact: _walkinsWithoutContact,
        selectedWithoutWalkin: _selectedWithoutWalkin,
        joinedWithoutSelection: _joinedWithoutSelection,
        ...branchMetrics
      } = row;
      return {
        ...branchMetrics,''',
        "raw branch-stage issue mapping",
    )

    SERVICE_PATH.write_text(service, encoding="utf-8")


if __name__ == "__main__":
    main()
