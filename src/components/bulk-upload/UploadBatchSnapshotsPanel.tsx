import { useState } from "react";
import { useUploadBatchSnapshots, useUploadBatchSnapshot } from "@/hooks/useUploadBatchSnapshots";
import { FileText, CheckCircle, XCircle, AlertCircle, Calendar, Trash2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

export function UploadBatchSnapshotsPanel() {
  const [selectedType, setSelectedType] = useState<string | undefined>(undefined);
  const [selectedSnapshot, setSelectedSnapshot] = useState<string | null>(null);

  const { data, isLoading } = useUploadBatchSnapshots(selectedType, 50, 0);
  const { data: snapshotDetail } = useUploadBatchSnapshot(selectedSnapshot || "");

  const uploadTypes = [
    { code: "attendance", label: "Attendance" },
    { code: "salary", label: "Salary" },
    { code: "roster", label: "Roster" },
    { code: "kpi", label: "KPI" },
    { code: "performance", label: "Performance" },
    { code: "leave", label: "Leave" },
    { code: "reimbursement", label: "Reimbursement" },
  ];

  return (
    <div className="rounded-2xl border border-white/60 bg-white/95 backdrop-blur-sm p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
            <FileText className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-gray-800">Upload History (Archived)</h2>
            <p className="text-xs text-gray-500">Batches after automatic data cleanup</p>
          </div>
        </div>
      </div>

      {/* Type Filter */}
      <div className="flex gap-2 mb-6 overflow-x-auto pb-2">
        <button
          onClick={() => setSelectedType(undefined)}
          className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-all ${
            selectedType === undefined
              ? "bg-indigo-600 text-white shadow-md"
              : "bg-gray-100 text-gray-700 hover:bg-gray-200"
          }`}
        >
          All
        </button>
        {uploadTypes.map((type) => (
          <button
            key={type.code}
            onClick={() => setSelectedType(type.code)}
            className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-all whitespace-nowrap ${
              selectedType === type.code
                ? "bg-indigo-600 text-white shadow-md"
                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            }`}
          >
            {type.label}
          </button>
        ))}
      </div>

      {/* Snapshots List */}
      {isLoading ? (
        <div className="text-center py-8 text-gray-500">Loading archived batches...</div>
      ) : !data?.snapshots.length ? (
        <div className="text-center py-8 text-gray-500">No archived batches found</div>
      ) : (
        <div className="space-y-3">
          {data.snapshots.map((snapshot) => (
            <div
              key={snapshot.id}
              onClick={() => setSelectedSnapshot(snapshot.id)}
              className={`p-4 rounded-xl border transition-all cursor-pointer ${
                selectedSnapshot === snapshot.id
                  ? "border-indigo-300 bg-indigo-50/50 shadow-md"
                  : "border-gray-200 hover:border-gray-300 hover:shadow-sm"
              }`}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="font-semibold text-gray-800">{snapshot.upload_batch_no}</span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 font-medium">
                      {snapshot.upload_type_code}
                    </span>
                    {snapshot.batch_status === "completed" || snapshot.batch_status === "imported" ? (
                      <CheckCircle className="w-4 h-4 text-green-600" />
                    ) : snapshot.batch_status === "failed" ? (
                      <XCircle className="w-4 h-4 text-red-600" />
                    ) : null}
                    {snapshot.rows_purged_at && (
                      <div className="flex items-center gap-1 text-xs text-gray-500">
                        <Trash2 className="w-3 h-3" />
                        <span>Purged</span>
                      </div>
                    )}
                  </div>
                  <div className="text-sm text-gray-600 mb-2">
                    {snapshot.original_file_name || "No filename"}
                  </div>
                  <div className="flex gap-4 text-xs">
                    <span className="text-gray-600">
                      <span className="font-medium text-gray-800">{snapshot.total_rows}</span> rows
                    </span>
                    <span className="text-green-700">
                      <span className="font-medium">{snapshot.valid_rows}</span> valid
                    </span>
                    {snapshot.error_rows > 0 && (
                      <span className="text-red-700">
                        <span className="font-medium">{snapshot.error_rows}</span> errors
                      </span>
                    )}
                    {snapshot.rows_purged_at && (
                      <span className="text-gray-500">
                        <span className="font-medium">{snapshot.rows_deleted}</span> deleted
                      </span>
                    )}
                  </div>
                </div>
                <div className="text-right">
                  <div className="flex items-center gap-1 text-xs text-gray-500 mb-1">
                    <Calendar className="w-3 h-3" />
                    {snapshot.batch_created_at
                      ? formatDistanceToNow(new Date(snapshot.batch_created_at), { addSuffix: true })
                      : "Unknown"}
                  </div>
                  {snapshot.rows_purged_at && (
                    <div className="text-xs text-gray-400">
                      Purged: {new Date(snapshot.rows_purged_at).toLocaleDateString()}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Detail Modal */}
      {snapshotDetail && selectedSnapshot && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-auto">
            <div className="sticky top-0 bg-gradient-to-r from-indigo-600 to-purple-600 text-white p-6 rounded-t-2xl">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-xl font-bold">{snapshotDetail.upload_batch_no}</h3>
                  <p className="text-sm text-white/80">{snapshotDetail.original_file_name || "No filename"}</p>
                </div>
                <button
                  onClick={() => setSelectedSnapshot(null)}
                  className="w-8 h-8 rounded-lg bg-white/20 hover:bg-white/30 flex items-center justify-center transition-colors"
                >
                  ✕
                </button>
              </div>
            </div>

            <div className="p-6 space-y-6">
              {/* Summary Stats */}
              <div className="grid grid-cols-4 gap-4">
                <div className="p-4 rounded-xl bg-gray-50">
                  <div className="text-xs text-gray-500 mb-1">Total Rows</div>
                  <div className="text-2xl font-bold text-gray-800">{snapshotDetail.total_rows}</div>
                </div>
                <div className="p-4 rounded-xl bg-green-50">
                  <div className="text-xs text-green-700 mb-1">Valid</div>
                  <div className="text-2xl font-bold text-green-700">{snapshotDetail.valid_rows}</div>
                </div>
                <div className="p-4 rounded-xl bg-red-50">
                  <div className="text-xs text-red-700 mb-1">Errors</div>
                  <div className="text-2xl font-bold text-red-700">{snapshotDetail.error_rows}</div>
                </div>
                <div className="p-4 rounded-xl bg-blue-50">
                  <div className="text-xs text-blue-700 mb-1">Imported</div>
                  <div className="text-2xl font-bold text-blue-700">{snapshotDetail.imported_rows}</div>
                </div>
              </div>

              {/* Purge Info */}
              {snapshotDetail.rows_purged_at && (
                <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
                  <div className="flex items-center gap-2 mb-2">
                    <Trash2 className="w-4 h-4 text-slate-600" />
                    <h4 className="font-semibold text-slate-800">Data Cleanup</h4>
                  </div>
                  <div className="grid grid-cols-3 gap-4 text-sm">
                    <div>
                      <div className="text-slate-600">Rows at Purge</div>
                      <div className="font-bold text-slate-800">{snapshotDetail.rows_at_purge}</div>
                    </div>
                    <div>
                      <div className="text-slate-600">Rows Deleted</div>
                      <div className="font-bold text-slate-800">{snapshotDetail.rows_deleted}</div>
                    </div>
                    <div>
                      <div className="text-slate-600">Purged At</div>
                      <div className="font-bold text-slate-800">
                        {new Date(snapshotDetail.rows_purged_at).toLocaleString()}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Status Breakdown */}
              {snapshotDetail.status_breakdown && Object.keys(snapshotDetail.status_breakdown).length > 0 && (
                <div>
                  <h4 className="font-semibold text-gray-800 mb-3 flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 text-blue-600" />
                    Status Breakdown
                  </h4>
                  <div className="grid grid-cols-3 gap-2">
                    {Object.entries(snapshotDetail.status_breakdown).map(([status, count]) => (
                      <div key={status} className="p-3 rounded-lg bg-blue-50 border border-blue-200">
                        <div className="text-sm text-gray-700">{status}</div>
                        <div className="text-lg font-bold text-blue-700">{count}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Error Breakdown */}
              {snapshotDetail.error_breakdown && Object.keys(snapshotDetail.error_breakdown).length > 0 && (
                <div>
                  <h4 className="font-semibold text-gray-800 mb-3 flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 text-amber-600" />
                    Error Breakdown
                  </h4>
                  <div className="grid grid-cols-2 gap-2">
                    {Object.entries(snapshotDetail.error_breakdown).map(([field, count]) => (
                      <div key={field} className="p-3 rounded-lg bg-amber-50 border border-amber-200">
                        <div className="text-sm text-gray-700">{field || "Unknown"}</div>
                        <div className="text-lg font-bold text-amber-700">{count} errors</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Sample Errors (error text only, no row data) */}
              {snapshotDetail.sample_errors && snapshotDetail.sample_errors.length > 0 && (
                <div>
                  <h4 className="font-semibold text-gray-800 mb-3">Sample Errors</h4>
                  <div className="space-y-2">
                    {snapshotDetail.sample_errors.map((err: any, idx: number) => (
                      <div key={idx} className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm">
                        <div className="font-medium text-red-800 mb-1">Row {err.row_no}</div>
                        <div className="text-red-700">{err.errors || "Error details not available"}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
