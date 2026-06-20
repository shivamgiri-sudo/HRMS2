import React from 'react';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

interface WeeklyData {
  day: string;
  avg: number;
  calls: number;
}

interface TrendPanelProps {
  weekly: WeeklyData[];
  cq_7day_avg: number;
  cq_30day_avg: number;
  trend_7day: { direction: string; change_pct: number };
  trend_30day: { direction: string; change_pct: number };
  isLoading?: boolean;
}

export const TrendPanel: React.FC<TrendPanelProps> = ({
  weekly,
  cq_7day_avg,
  cq_30day_avg,
  trend_7day,
  trend_30day,
  isLoading = false,
}) => {
  if (isLoading) {
    return (
      <div className="bg-white rounded-lg shadow p-6 md:p-8 animate-pulse">
        <div className="h-12 bg-gray-200 rounded mb-4 w-1/3"></div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {[...Array(2)].map((_, i) => (
            <div key={i} className="h-80 bg-gray-200 rounded"></div>
          ))}
        </div>
      </div>
    );
  }

  // Prepare 7-day line chart data
  const lineChartData = weekly.map((w) => ({
    day: w.day.substring(0, 3),
    score: w.avg,
    calls: w.calls,
  }));

  // Prepare 30-day comparison bar chart
  const barChartData = [
    { label: '7-Day Avg', score: cq_7day_avg, fill: '#3b82f6' },
    { label: '30-Day Avg', score: cq_30day_avg, fill: '#8b5cf6' },
    { label: 'Target', score: 90, fill: '#10b981' },
  ];

  // Calculate trend statistics
  const trendColor7 = trend_7day.direction === '↗' ? 'text-green-600' : trend_7day.direction === '↘' ? 'text-red-600' : 'text-gray-600';
  const trendColor30 = trend_30day.direction === '↗' ? 'text-green-600' : trend_30day.direction === '↘' ? 'text-red-600' : 'text-gray-600';

  return (
    <div className="bg-white rounded-lg shadow p-6 md:p-8">
      <h2 className="text-xl font-bold text-gray-900 mb-6">Performance Trends</h2>

      {weekly.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-gray-500 text-lg">No trend data available yet</p>
          <p className="text-gray-400 text-sm mt-2">Complete some calls to see your performance trends</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* 7-Day Trend Card */}
          <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-lg p-6">
            <div className="flex justify-between items-start mb-4">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">7-Day Trend</h3>
                <p className="text-sm text-gray-600 mt-1">Daily performance breakdown</p>
              </div>
              <div className={`text-2xl ${trendColor7}`}>
                <span>{trend_7day.direction}</span>
              </div>
            </div>

            <div className="mb-6">
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-white rounded p-3">
                  <p className="text-xs text-gray-600">7-Day Avg</p>
                  <p className="text-2xl font-bold text-blue-600">{cq_7day_avg}%</p>
                </div>
                <div className="bg-white rounded p-3">
                  <p className="text-xs text-gray-600">Change</p>
                  <p className={`text-2xl font-bold ${trend_7day.change_pct > 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {trend_7day.change_pct > 0 ? '+' : ''}{trend_7day.change_pct}%
                  </p>
                </div>
                <div className="bg-white rounded p-3">
                  <p className="text-xs text-gray-600">Calls</p>
                  <p className="text-2xl font-bold text-gray-900">
                    {weekly.reduce((sum, w) => sum + w.calls, 0)}
                  </p>
                </div>
              </div>
            </div>

            <div style={{ maxHeight: '350px', width: '100%' }}>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={lineChartData} margin={{ top: 5, right: 30, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="day" />
                  <YAxis domain={[0, 100]} label={{ value: 'Score (%)', angle: -90, position: 'insideLeft' }} />
                  <Tooltip formatter={(value) => `${value.toFixed(1)}%`} />
                  <Line type="monotone" dataKey="score" stroke="#3b82f6" strokeWidth={2} dot={{ r: 5 }} activeDot={{ r: 7 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* Weekly Breakdown Table */}
            <div className="mt-6 pt-6 border-t border-blue-200">
              <h4 className="text-sm font-semibold text-gray-900 mb-3">Weekly Breakdown</h4>
              <div className="space-y-2">
                {weekly.map((day, idx) => (
                  <div key={idx} className="flex justify-between items-center text-sm">
                    <span className="text-gray-700">{day.day}</span>
                    <div className="flex items-center gap-4">
                      <div className="w-24">
                        <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${
                              day.avg >= 80
                                ? 'bg-green-500'
                                : day.avg >= 70
                                ? 'bg-yellow-500'
                                : 'bg-red-500'
                            }`}
                            style={{ width: `${day.avg}%` }}
                          ></div>
                        </div>
                      </div>
                      <span className="font-semibold text-gray-900 w-12 text-right">{day.avg}%</span>
                      <span className="text-gray-500 w-8 text-right">({day.calls})</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* 30-Day Comparison Card */}
          <div className="bg-gradient-to-br from-purple-50 to-purple-100 rounded-lg p-6">
            <div className="flex justify-between items-start mb-4">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">30-Day Comparison</h3>
                <p className="text-sm text-gray-600 mt-1">Your score vs target & baseline</p>
              </div>
              <div className={`text-2xl ${trendColor30}`}>
                <span>{trend_30day.direction}</span>
              </div>
            </div>

            <div className="mb-6">
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-white rounded p-3">
                  <p className="text-xs text-gray-600">30-Day Avg</p>
                  <p className="text-2xl font-bold text-purple-600">{cq_30day_avg}%</p>
                </div>
                <div className="bg-white rounded p-3">
                  <p className="text-xs text-gray-600">Gap to Target</p>
                  <p className={`text-2xl font-bold ${90 - cq_30day_avg > 0 ? 'text-red-600' : 'text-green-600'}`}>
                    {90 - cq_30day_avg > 0 ? '+' : ''}{(90 - cq_30day_avg).toFixed(1)}%
                  </p>
                </div>
              </div>
            </div>

            <div style={{ maxHeight: '350px', width: '100%' }}>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={barChartData} margin={{ top: 20, right: 30, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="label" />
                  <YAxis domain={[0, 100]} label={{ value: 'Score (%)', angle: -90, position: 'insideLeft' }} />
                  <Tooltip formatter={(value) => `${value.toFixed(1)}%`} />
                  <Bar dataKey="score" radius={[8, 8, 0, 0]} fill="#3b82f6" />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Summary Card */}
            <div className="mt-6 pt-6 border-t border-purple-200">
              <div className="bg-white rounded p-4">
                <p className="text-sm text-gray-600">Performance Summary</p>
                <ul className="mt-3 space-y-2 text-sm">
                  <li className="flex justify-between">
                    <span className="text-gray-700">7-Day Average</span>
                    <span className="font-semibold text-gray-900">{cq_7day_avg}%</span>
                  </li>
                  <li className="flex justify-between">
                    <span className="text-gray-700">30-Day Average</span>
                    <span className="font-semibold text-gray-900">{cq_30day_avg}%</span>
                  </li>
                  <li className="flex justify-between">
                    <span className="text-gray-700">Target Score</span>
                    <span className="font-semibold text-gray-900">90%</span>
                  </li>
                  <li className="flex justify-between pt-2 border-t border-gray-200">
                    <span className="text-gray-700 font-medium">Current Status</span>
                    <span
                      className={`font-bold ${
                        cq_7day_avg >= 80
                          ? 'text-green-600'
                          : cq_7day_avg >= 70
                          ? 'text-yellow-600'
                          : 'text-red-600'
                      }`}
                    >
                      {cq_7day_avg >= 80 ? 'On Track' : cq_7day_avg >= 70 ? 'Below Target' : 'Risk'}
                    </span>
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TrendPanel;
