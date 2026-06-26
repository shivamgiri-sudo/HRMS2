import React from 'react';
import { formatIST, formatISTDate, formatISTTime } from '@/lib/utils';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { formatIST, formatISTDate, formatISTTime } from '@/lib/utils';

interface SubMetric {
  name: string;
  score: number;
  peer_avg: number;
  calls_weak: number;
}

interface RelatedCall {
  call_id: string;
  date: string;
  cq_pct: number;
}

interface WeaknessArea {
  category: string;
  score: number;
  peer_avg: number;
  gap: number;
  sub_metrics: SubMetric[];
  related_calls: RelatedCall[];
}

interface WeaknessPanelProps {
  weaknessAreas: WeaknessArea[];
  isLoading?: boolean;
  onCallClick?: (callId: string) => void;
}

export const WeaknessPanel: React.FC<WeaknessPanelProps> = ({
  weaknessAreas,
  isLoading = false,
  onCallClick,
}) => {
  if (isLoading) {
    return (
      <div className="bg-white rounded-lg shadow p-6 md:p-8 animate-pulse">
        <div className="h-12 bg-gray-200 rounded mb-4 w-1/3"></div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-64 bg-gray-200 rounded"></div>
          ))}
        </div>
      </div>
    );
  }

  // Get top 3 weaknesses for display
  const topWeaknesses = weaknessAreas.slice(0, 3);

  // Prepare chart data for comparison
  const chartData = topWeaknesses.map((w) => ({
    category: w.category.substring(0, 10),
    'Your Score': Math.round(w.score),
    'Peer Avg': Math.round(w.peer_avg),
  }));

  return (
    <div className="bg-white rounded-lg shadow p-6 md:p-8">
      <h2 className="text-xl font-bold text-gray-900 mb-6">Weakness Analysis</h2>

      {weaknessAreas.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-gray-500 text-lg">No weakness data available yet</p>
          <p className="text-gray-400 text-sm mt-2">Keep up the great work!</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left: Detailed Weakness Cards */}
          <div className="lg:col-span-2 space-y-4">
            {weaknessAreas.map((weakness, idx) => {
              const gapColor = weakness.gap > 0 ? 'text-red-600' : 'text-green-600';
              const gapBg = weakness.gap > 0 ? 'bg-red-50' : 'bg-green-50';

              return (
                <div
                  key={idx}
                  className="border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow"
                >
                  {/* Header */}
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <h3 className="font-semibold text-gray-900">{weakness.category}</h3>
                      <p className="text-sm text-gray-500">
                        {weakness.related_calls.length} calls with this weakness
                      </p>
                    </div>
                    <div className={`px-3 py-1 rounded ${gapBg} ${gapColor}`}>
                      <p className="text-xs font-semibold">
                        Gap: {weakness.gap > 0 ? '+' : ''}{Math.round(weakness.gap)}%
                      </p>
                    </div>
                  </div>

                  {/* Scores */}
                  <div className="grid grid-cols-3 gap-3 mb-4">
                    <div className="bg-gray-50 p-3 rounded">
                      <p className="text-xs text-gray-500">Your Score</p>
                      <p className="text-2xl font-bold text-gray-900">{Math.round(weakness.score)}%</p>
                    </div>
                    <div className="bg-blue-50 p-3 rounded">
                      <p className="text-xs text-blue-600">Peer Avg</p>
                      <p className="text-2xl font-bold text-blue-600">
                        {Math.round(weakness.peer_avg)}%
                      </p>
                    </div>
                    <div className="bg-purple-50 p-3 rounded">
                      <p className="text-xs text-purple-600">Target</p>
                      <p className="text-2xl font-bold text-purple-600">90%</p>
                    </div>
                  </div>

                  {/* Sub-metrics */}
                  {weakness.sub_metrics.length > 0 && (
                    <div className="mb-4">
                      <p className="text-xs font-semibold text-gray-700 mb-2">Sub-metrics</p>
                      <div className="space-y-2">
                        {weakness.sub_metrics.map((metric, midx) => (
                          <div key={midx} className="flex items-center justify-between text-sm">
                            <span className="text-gray-600">{metric.name}</span>
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-gray-900">
                                {Math.round(metric.score)}%
                              </span>
                              <span className="text-xs text-gray-500">
                                ({metric.calls_weak} calls)
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Related Calls */}
                  {weakness.related_calls.length > 0 && (
                    <div className="pt-3 border-t border-gray-200">
                      <p className="text-xs font-semibold text-gray-700 mb-2">
                        Problem Calls (Top 5)
                      </p>
                      <div className="space-y-2">
                        {weakness.related_calls.slice(0, 5).map((call) => (
                          <button
                            key={call.call_id}
                            onClick={() => onCallClick?.(call.call_id)}
                            className="w-full text-left px-3 py-2 bg-gray-50 hover:bg-gray-100 rounded text-sm transition-colors"
                          >
                            <div className="flex justify-between items-center">
                              <span className="text-gray-600 font-medium">Call #{call.call_id}</span>
                              <span
                                className={`font-semibold ${
                                  call.cq_pct < 50
                                    ? 'text-red-600'
                                    : call.cq_pct < 70
                                    ? 'text-yellow-600'
                                    : 'text-green-600'
                                }`}
                              >
                                {call.cq_pct}%
                              </span>
                            </div>
                            <p className="text-xs text-gray-500">
                              {formatISTDate(call.date)}
                            </p>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Right: Comparison Chart */}
          <div className="lg:col-span-1 flex items-center justify-center bg-gray-50 rounded-lg p-4">
            <div className="w-full" style={{ maxHeight: '400px' }}>
              {topWeaknesses.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={chartData} margin={{ top: 20, right: 30, left: 0, bottom: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="category" angle={-45} textAnchor="end" height={80} />
                    <YAxis domain={[0, 100]} />
                    <Tooltip formatter={(value) => `${value}%`} />
                    <Bar dataKey="Your Score" fill="#3b82f6" />
                    <Bar dataKey="Peer Avg" fill="#9ca3af" />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-full">
                  <p className="text-gray-500 text-sm">No comparison data</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default WeaknessPanel;
