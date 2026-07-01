import React from 'react';

interface CQScoreData {
  cq_score_current: number;
  cq_score_7day_avg: number;
  cq_score_30day_avg: number;
  cq_score_clean: number;
  rank: { position: number; total_agents: number };
  peer_avg: number;
  target: number;
  gap_pct: number;
  trend_7day: { direction: string; change_pct: number };
  trend_30day: { direction: string; change_pct: number };
  weekly: Array<{ day: string; avg: number; calls: number }>;
  status: 'On Track' | 'Below Target' | 'Risk';
  last_updated: Date;
}

interface HeroCardProps {
  data: CQScoreData;
  isLoading?: boolean;
}

export const HeroCard: React.FC<HeroCardProps> = ({ data, isLoading = false }) => {
  if (isLoading) {
    return (
      <div className="bg-white rounded-lg shadow p-6 md:p-8 animate-pulse">
        <div className="h-12 bg-gray-200 rounded mb-4 w-1/3"></div>
        <div className="h-64 bg-gray-200 rounded"></div>
      </div>
    );
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'On Track':
        return 'text-green-600 bg-green-50';
      case 'Below Target':
        return 'text-yellow-600 bg-yellow-50';
      case 'Risk':
        return 'text-red-600 bg-red-50';
      default:
        return 'text-gray-600 bg-gray-50';
    }
  };

  const getGaugeColor = (score: number) => {
    if (score >= 80) return '#10b981';
    if (score >= 70) return '#f59e0b';
    return '#ef4444';
  };

  // Simple circular gauge component
  const GaugeChart = ({ value, max = 100, size = 280 }: { value: number; max?: number; size?: number }) => {
    const percentage = Math.min(value / max, 1);
    const radius = (size - 20) / 2;
    const circumference = 2 * Math.PI * radius;
    const strokeDashoffset = circumference - percentage * circumference;
    const gaugeColor = getGaugeColor(value);

    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="transform -rotate-90">
        {/* Background circle */}
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#f0f0f0" strokeWidth="20" />
        {/* Progress circle */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={gaugeColor}
          strokeWidth="20"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 0.5s ease' }}
        />
        {/* Center text */}
        <text
          x={size / 2}
          y={size / 2 - 20}
          textAnchor="middle"
          fontSize="48"
          fontWeight="bold"
          fill="#111"
          className="transform rotate-90"
          style={{ transformOrigin: `${size / 2}px ${size / 2}px` }}
        >
          {Math.round(value)}
        </text>
        <text
          x={size / 2}
          y={size / 2 + 25}
          textAnchor="middle"
          fontSize="16"
          fontWeight="600"
          fill="#666"
          className="transform rotate-90"
          style={{ transformOrigin: `${size / 2}px ${size / 2}px` }}
        >
          CQ Score
        </text>
      </svg>
    );
  };

  return (
    <div className="bg-white rounded-lg shadow p-6 md:p-8">
      <div className="flex flex-col md:flex-row gap-6">
        {/* Gauge Section */}
        <div className="md:w-1/3 flex items-center justify-center">
          <div className="w-full" style={{ maxWidth: '280px' }}>
            <GaugeChart value={data.cq_score_current} max={100} size={280} />
          </div>
        </div>

        {/* KPIs Section */}
        <div className="md:w-2/3 grid grid-cols-2 gap-4">
          {/* Status Indicator */}
          <div className={`p-4 rounded-lg ${getStatusColor(data.status)}`}>
            <p className="text-sm font-medium opacity-70">Status</p>
            <p className="text-2xl font-bold mt-2">{data.status}</p>
          </div>

          {/* Rank */}
          <div className="p-4 rounded-lg bg-blue-50">
            <p className="text-sm font-medium text-blue-600 opacity-70">Your Rank</p>
            <p className="text-2xl font-bold text-blue-600 mt-2">
              #{data.rank.position} / {data.rank.total_agents}
            </p>
          </div>

          {/* Peer Average */}
          <div className="p-4 rounded-lg bg-purple-50">
            <p className="text-sm font-medium text-purple-600 opacity-70">Peer Average</p>
            <p className="text-2xl font-bold text-purple-600 mt-2">{data.peer_avg}%</p>
          </div>

          {/* Gap to Target */}
          <div className="p-4 rounded-lg bg-indigo-50">
            <p className="text-sm font-medium text-indigo-600 opacity-70">Gap to Target</p>
            <p className={`text-2xl font-bold mt-2 ${data.gap_pct > 0 ? 'text-red-600' : 'text-green-600'}`}>
              {data.gap_pct > 0 ? '+' : ''}{data.gap_pct}%
            </p>
          </div>

          {/* 7-Day Trend */}
          <div className="p-4 rounded-lg bg-emerald-50">
            <p className="text-sm font-medium text-emerald-600 opacity-70">7-Day Trend</p>
            <div className="flex items-center gap-2 mt-2">
              <span className="text-2xl">{data.trend_7day.direction}</span>
              <span className="text-2xl font-bold text-emerald-600">{data.trend_7day.change_pct > 0 ? '+' : ''}{data.trend_7day.change_pct}%</span>
            </div>
          </div>

          {/* Target Score */}
          <div className="p-4 rounded-lg bg-orange-50">
            <p className="text-sm font-medium text-orange-600 opacity-70">Target</p>
            <p className="text-2xl font-bold text-orange-600 mt-2">{data.target}%</p>
          </div>

          {/* 7-Day Calls Count */}
          <div className="col-span-2 p-4 rounded-lg bg-gray-50">
            <p className="text-sm font-medium text-gray-600 opacity-70">7-Day Overview</p>
            <div className="grid grid-cols-2 gap-4 mt-2">
              <div>
                <p className="text-3xl font-bold text-gray-700">{data.cq_score_7day_avg}%</p>
                <p className="text-xs text-gray-500 mt-1">7-Day Avg</p>
              </div>
              <div>
                <p className="text-3xl font-bold text-gray-700">{data.cq_score_30day_avg}%</p>
                <p className="text-xs text-gray-500 mt-1">30-Day Avg</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Last Updated */}
      <div className="mt-4 pt-4 border-t border-gray-200">
        <p className="text-xs text-gray-500">
          Last updated: {new Date(data.last_updated).toLocaleTimeString()}
        </p>
      </div>
    </div>
  );
};

export default HeroCard;
