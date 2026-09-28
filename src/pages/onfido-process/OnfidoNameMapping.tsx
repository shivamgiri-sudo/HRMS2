import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import { EmptyNote, SectionCard } from "./onfidoReportShared";
import {
  filterMappingRows,
  matchMethodBadge,
  sortMappingRows,
  type MappingListRow,
} from "./onfidoNameMappingShared";

/**
 * HR review screen for the Onfido AM/TL name-to-employee reconciliation
 * feature (see backend/sql/1869_onfido_name_employee_map.sql and
 * onfido-name-mapping.routes.ts). Every raw TL/AM name from the Onfido
 * dashboard's own filter dropdowns (getFilterOptions) gets matched here
 * against the active employee roster; HR confirms or corrects each match.
 *
 * Deliberately its own top-level view, not embedded inside
 * OnfidoProcessDashboard's Executive Filters flow — this screen is an
 * admin/HR data-quality task, not a reporting view, and its own API
 * (/api/onfido-process/name-mapping) is gated by requireRole("admin","hr"),
 * not the dashboard's VIEWER_ROLES + process-scope guard.
 */
export default function OnfidoNameMapping() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [showOnlyUnverified, setShowOnlyUnverified] = useState(true);
  const [editingRow, setEditingRow] = useState<MappingListRow | null>(null);
  const [employeeIdInput, setEmployeeIdInput] = useState("");

  const mappingsQuery = useQuery({
    queryKey: ["onfido-name-mapping", "list", showOnlyUnverified],
    queryFn: () =>
      hrmsApi.get<{ data: MappingListRow[] }>(
        `/api/onfido-process/name-mapping${showOnlyUnverified ? "?verified=false" : ""}`,
      ),
  });

  const verifyMutation = useMutation({
    mutationFn: (input: { id: string; employeeId: string | null }) =>
      hrmsApi.patch<{ data: MappingListRow }>(`/api/onfido-process/name-mapping/${input.id}`, {
        employeeId: input.employeeId,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["onfido-name-mapping", "list"] });
      setEditingRow(null);
    },
  });

  const rows = mappingsQuery.data?.data ?? [];
  const visibleRows = sortMappingRows(filterMappingRows(rows, search));

  function openEdit(row: MappingListRow) {
    setEditingRow(row);
    setEmployeeIdInput(row.employeeId ?? "");
  }

  function submitEdit() {
    if (!editingRow) return;
    const trimmed = employeeIdInput.trim();
    verifyMutation.mutate({ id: editingRow.id, employeeId: trimmed === "" ? null : trimmed });
  }

  return (
    <SectionCard
      title="Onfido AM/TL Name Mapping"
      accent="var(--purple)"
      subtitle="Every raw TL/AM name from Onfido reports, matched against the active employee roster. Confirm or correct each match — once verified, it will not be overwritten by the automated re-match run."
    >
      <div className="oc-filterbar" style={{ marginBottom: 12 }}>
        <div className="oc-field">
          <label htmlFor="nm-search">Search</label>
          <input
            id="nm-search"
            type="search"
            className="oc-input"
            placeholder="Name or employee code"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="oc-field">
          <label>
            <input
              type="checkbox"
              checked={showOnlyUnverified}
              onChange={(e) => setShowOnlyUnverified(e.target.checked)}
              style={{ marginRight: 6 }}
            />
            Show only unverified
          </label>
        </div>
      </div>

      {mappingsQuery.isLoading && <EmptyNote>Loading...</EmptyNote>}
      {mappingsQuery.error instanceof Error && (
        <EmptyNote>Could not load mappings: {mappingsQuery.error.message}</EmptyNote>
      )}
      {!mappingsQuery.isLoading && !mappingsQuery.error && (
        <div style={{ overflowX: "auto" }}>
          <table className="oc-table">
            <thead>
              <tr>
                <th>Raw Name</th>
                <th>Role</th>
                <th>Matched Employee</th>
                <th>Employee Code</th>
                <th>Match</th>
                <th>Verified</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.length === 0 && (
                <tr className="oc-empty-row">
                  <td colSpan={7}>
                    {showOnlyUnverified ? "Nothing left for HR to review." : "No mapping rows found."}
                  </td>
                </tr>
              )}
              {visibleRows.map((row) => {
                const badge = matchMethodBadge(row.matchMethod);
                return (
                  <tr key={row.id}>
                    <td>{row.rawName}</td>
                    <td className="oc-right">{row.rawRole.toUpperCase()}</td>
                    <td>{row.employeeName ?? "—"}</td>
                    <td>{row.employeeCode ?? "—"}</td>
                    <td>
                      <span className={badge.className ? `oc-badge-pill ${badge.className}` : undefined}>
                        {badge.label}
                      </span>
                    </td>
                    <td className="oc-right">{row.verifiedByHr ? "Yes" : "No"}</td>
                    <td className="oc-right">
                      <button type="button" className="oc-pill-btn" onClick={() => openEdit(row)}>
                        Review
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {editingRow && (
        <div className="oc-card" style={{ marginTop: 16 }}>
          <h4 style={{ marginBottom: 8 }}>
            Review: {editingRow.rawName} ({editingRow.rawRole.toUpperCase()})
          </h4>
          <p className="oc-card-sub" style={{ marginBottom: 8 }}>
            Current suggestion: {editingRow.employeeName ?? "no match"} ({editingRow.employeeCode ?? "—"})
          </p>
          <div className="oc-field">
            <label htmlFor="nm-employee-id">Employee ID (leave blank if no employee matches)</label>
            <input
              id="nm-employee-id"
              type="text"
              className="oc-input"
              value={employeeIdInput}
              onChange={(e) => setEmployeeIdInput(e.target.value)}
              placeholder="employee id, or leave blank"
            />
          </div>
          {verifyMutation.error instanceof Error && (
            <EmptyNote>Could not save: {verifyMutation.error.message}</EmptyNote>
          )}
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button
              type="button"
              className="oc-pill-btn active"
              onClick={submitEdit}
              disabled={verifyMutation.isPending}
            >
              {verifyMutation.isPending ? "Saving..." : "Confirm & Verify"}
            </button>
            <button type="button" className="oc-pill-btn" onClick={() => setEditingRow(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </SectionCard>
  );
}
