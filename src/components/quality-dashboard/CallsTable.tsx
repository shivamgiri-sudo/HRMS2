import React, { useState } from 'react';
import { formatIST, formatISTDate, formatISTTime } from '@/lib/utils';
import { ChevronUp, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { formatIST, formatISTDate, formatISTTime } from '@/lib/utils';

interface Call {
  call_id: string;
  date: string;
  lead_id: string;
  lead_name: string;
  scenario: string;
  cq_pct: number;
  has_fatal: boolean;
  fatal_reason?: string;
  duration_sec: number;
  agent_name?: string;
}

interface CallsTableProps {
  calls: Call[];
  totalCalls: number;
  currentPage: number;
  pageSize: number;
  sortBy?: 'date' | 'cq' | 'fatal';
  isLoading?: boolean;
  onPageChange?: (page: number) => void;
  onSortChange?: (sort: 'date' | 'cq' | 'fatal') => void;
  onCallClick?: (call: Call) => void;
}

export const CallsTable: React.FC<CallsTableProps> = ({
  calls,
  totalCalls,
  currentPage = 0,
  pageSize = 10,
  sortBy = 'date',
  isLoading = false,
  onPageChange,
  onSortChange,
  onCallClick,
}) => {
  const [hoveredRow, setHoveredRow] = useState<string | null>(null);

  const pageCount = Math.ceil(totalCalls / pageSize);
  const currentPageNum = Math.floor(currentPage / pageSize);
  const hasNext = currentPageNum < pageCount - 1;
  const hasPrev = currentPageNum > 0;

  const handleSort = (column: 'date' | 'cq' | 'fatal') => {
    if (onSortChange) {
      onSortChange(column);
    }
  };

  const SortIcon = ({ column }: { column: 'date' | 'cq' | 'fatal' }) => {
    if (sortBy !== column) {
      return <div className="w-4 h-4 text-gray-300" />;
    }
    return sortBy === 'date' ? (
      <ChevronDown className="w-4 h-4 text-blue-600" />
    ) : (
      <ChevronUp className="w-4 h-4 text-blue-600" />
    );
  };

  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const getCQColor = (cq: number): string => {
    if (cq >= 80) return 'text-green-600 bg-green-50';
    if (cq >= 70) return 'text-yellow-600 bg-yellow-50';
    return 'text-red-600 bg-red-50';
  };

  if (isLoading) {
    return (
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <div className="p-6">
          <div className="space-y-4">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-12 bg-gray-200 rounded animate-pulse" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow overflow-hidden">
      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="px-4 md:px-6 py-3 text-left">
                <button
                  onClick={() => handleSort('date')}
                  className="inline-flex items-center gap-2 text-xs font-semibold text-gray-700 hover:text-gray-900 transition-colors"
                >
                  Date
                  <SortIcon column="date" />
                </button>
              </th>
              <th className="px-4 md:px-6 py-3 text-left">
                <span className="text-xs font-semibold text-gray-700">Lead</span>
              </th>
              <th className="px-4 md:px-6 py-3 text-left hidden md:table-cell">
                <span className="text-xs font-semibold text-gray-700">Scenario</span>
              </th>
              <th className="px-4 md:px-6 py-3 text-left">
                <button
                  onClick={() => handleSort('cq')}
                  className="inline-flex items-center gap-2 text-xs font-semibold text-gray-700 hover:text-gray-900 transition-colors"
                >
                  CQ %
                  <SortIcon column="cq" />
                </button>
              </th>
              <th className="px-4 md:px-6 py-3 text-left">
                <button
                  onClick={() => handleSort('fatal')}
                  className="inline-flex items-center gap-2 text-xs font-semibold text-gray-700 hover:text-gray-900 transition-colors"
                >
                  Status
                  <SortIcon column="fatal" />
                </button>
              </th>
              <th className="px-4 md:px-6 py-3 text-center">
                <span className="text-xs font-semibold text-gray-700">Action</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {calls.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-6 py-12 text-center">
                  <p className="text-gray-500 text-sm">No calls found</p>
                </td>
              </tr>
            ) : (
              calls.map((call) => (
                <tr
                  key={call.call_id}
                  onMouseEnter={() => setHoveredRow(call.call_id)}
                  onMouseLeave={() => setHoveredRow(null)}
                  className="hover:bg-gray-50 transition-colors cursor-pointer"
                >
                  {/* Date */}
                  <td className="px-4 md:px-6 py-4 text-sm">
                    <div>
                      <p className="font-medium text-gray-900">
                        {formatISTDate(call.date)}
                      </p>
                      <p className="text-xs text-gray-500">
                        {new Date(call.date).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </p>
                    </div>
                  </td>

                  {/* Lead */}
                  <td className="px-4 md:px-6 py-4 text-sm">
                    <div>
                      <p className="font-medium text-gray-900">{call.lead_name}</p>
                      <p className="text-xs text-gray-500">#{call.lead_id}</p>
                    </div>
                  </td>

                  {/* Scenario */}
                  <td className="px-4 md:px-6 py-4 text-sm hidden md:table-cell">
                    <span className="px-3 py-1 bg-blue-50 text-blue-700 rounded-full text-xs font-medium">
                      {call.scenario}
                    </span>
                  </td>

                  {/* CQ % */}
                  <td className="px-4 md:px-6 py-4 text-sm">
                    <div
                      className={`inline-flex items-center justify-center w-12 h-12 rounded-lg font-bold ${getCQColor(
                        call.cq_pct
                      )}`}
                    >
                      {call.cq_pct}%
                    </div>
                  </td>

                  {/* Status / Fatal Flag */}
                  <td className="px-4 md:px-6 py-4 text-sm">
                    {call.has_fatal ? (
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-1 bg-red-100 text-red-800 rounded text-xs font-semibold">
                          Fatal
                        </span>
                        <div
                          className="text-red-600 cursor-help"
                          title={call.fatal_reason || 'Fatal issue detected'}
                        >
                          <svg
                            className="w-4 h-4"
                            fill="currentColor"
                            viewBox="0 0 20 20"
                          >
                            <path
                              fillRule="evenodd"
                              d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                              clipRule="evenodd"
                            />
                          </svg>
                        </div>
                      </div>
                    ) : (
                      <span className="px-2 py-1 bg-green-100 text-green-800 rounded text-xs font-semibold">
                        OK
                      </span>
                    )}
                  </td>

                  {/* Action */}
                  <td className="px-4 md:px-6 py-4 text-center">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onCallClick?.(call);
                      }}
                      className={`px-3 py-1 rounded text-sm font-medium transition-all ${
                        hoveredRow === call.call_id
                          ? 'bg-blue-600 text-white'
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }`}
                    >
                      Review
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Footer */}
      {pageCount > 1 && (
        <div className="bg-gray-50 border-t border-gray-200 px-4 md:px-6 py-4 flex items-center justify-between">
          <div className="text-sm text-gray-600">
            Showing {currentPageNum * pageSize + 1} to {Math.min((currentPageNum + 1) * pageSize, totalCalls)} of{' '}
            <span className="font-semibold">{totalCalls}</span> calls
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => onPageChange?.(currentPageNum - 1)}
              disabled={!hasPrev}
              className="p-2 rounded border border-gray-300 text-gray-700 hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>

            <div className="flex items-center gap-1">
              {Array.from({ length: Math.min(pageCount, 5) }).map((_, idx) => {
                const pageNum = idx;
                const isActive = pageNum === currentPageNum;
                return (
                  <button
                    key={pageNum}
                    onClick={() => onPageChange?.(pageNum)}
                    className={`px-3 py-2 rounded text-sm font-medium transition-colors ${
                      isActive
                        ? 'bg-blue-600 text-white'
                        : 'border border-gray-300 text-gray-700 hover:bg-gray-100'
                    }`}
                  >
                    {pageNum + 1}
                  </button>
                );
              })}
            </div>

            <button
              onClick={() => onPageChange?.(currentPageNum + 1)}
              disabled={!hasNext}
              className="p-2 rounded border border-gray-300 text-gray-700 hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default CallsTable;
