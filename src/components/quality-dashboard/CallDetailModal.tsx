import React from 'react';
import { BarChart, Bar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { X, Play, Volume2 } from 'lucide-react';

interface SubScores {
  opening: number;
  soft_skills: number;
  hold_procedure: number;
  resolution: number;
  closing: number;
}

interface PeerComparison {
  same_scenario_avg: number;
  your_score: number;
  gap: number;
  peer_note?: string;
}

interface CallDetailModalProps {
  isOpen: boolean;
  call: {
    call_id: string;
    date: string;
    lead: { id: string; name: string };
    scenario: string;
    cq_pct: number;
    has_fatal: boolean;
    duration_sec: number;
    sub_scores: SubScores;
    recording: { url: string; duration_sec: number };
    transcript: string;
    feedback: string;
    peer_comparison: PeerComparison;
  } | null;
  isLoading?: boolean;
  onClose?: () => void;
}

export const CallDetailModal: React.FC<CallDetailModalProps> = ({
  isOpen,
  call,
  isLoading = false,
  onClose,
}) => {
  if (!isOpen || !call) return null;

  const MiniGauge = ({ title, value }: { title: string; value: number }) => {
    const gaugeColor = value >= 70 ? '#10b981' : value >= 50 ? '#f59e0b' : '#ef4444';
    const radius = 55;
    const circumference = 2 * Math.PI * radius;
    const strokeDashoffset = circumference - (Math.min(value / 100, 1) * circumference);

    return (
      <div className="flex flex-col items-center">
        <svg width={140} height={140} viewBox="0 0 140 140" className="transform -rotate-90">
          <circle cx={70} cy={70} r={radius} fill="none" stroke="#f0f0f0" strokeWidth="15" />
          <circle
            cx={70}
            cy={70}
            r={radius}
            fill="none"
            stroke={gaugeColor}
            strokeWidth="15"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            style={{ transition: 'stroke-dashoffset 0.5s ease' }}
          />
          <text
            x={70}
            y={75}
            textAnchor="middle"
            fontSize="24"
            fontWeight="bold"
            fill="#111"
            className="transform rotate-90"
            style={{ transformOrigin: '70px 70px' }}
          >
            {Math.round(value)}
          </text>
        </svg>
        <p className="text-sm font-semibold text-gray-900 mt-2">{title}</p>
      </div>
    );
  };

  const getStatusColor = (hasFatal: boolean, cq: number) => {
    if (hasFatal) return 'text-red-600 bg-red-50';
    if (cq >= 80) return 'text-green-600 bg-green-50';
    if (cq >= 70) return 'text-yellow-600 bg-yellow-50';
    return 'text-orange-600 bg-orange-50';
  };

  const comparisonChartData = [
    { label: 'Your Score', score: call.cq_pct, fill: '#3b82f6' },
    { label: 'Peer Avg', score: call.peer_comparison.same_scenario_avg, fill: '#8b5cf6' },
    { label: 'Target', score: 90, fill: '#10b981' },
  ];

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-lg shadow-2xl w-full max-w-4xl my-8">
        {isLoading ? (
          <div className="p-8 text-center">
            <div className="inline-block animate-spin">
              <div className="w-8 h-8 border-4 border-gray-300 border-t-blue-600 rounded-full"></div>
            </div>
            <p className="mt-4 text-gray-600">Loading call details...</p>
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="bg-gradient-to-r from-blue-600 to-blue-700 px-6 py-6 flex justify-between items-start">
              <div className="text-white">
                <h2 className="text-2xl font-bold">Call Details</h2>
                <p className="text-blue-100 text-sm mt-1">Call ID: {call.call_id}</p>
              </div>
              <button
                onClick={onClose}
                className="p-2 hover:bg-blue-800 rounded-lg transition-colors text-white"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            <div className="overflow-y-auto max-h-[calc(100vh-200px)]">
              {/* Call Info Card */}
              <div className="p-6 border-b border-gray-200 bg-gray-50">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div>
                    <p className="text-xs font-semibold text-gray-600 uppercase">Lead</p>
                    <p className="text-lg font-bold text-gray-900 mt-1">{call.lead.name}</p>
                    <p className="text-sm text-gray-500">#{call.lead.id}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-gray-600 uppercase">Scenario</p>
                    <p className="text-lg font-bold text-gray-900 mt-1">{call.scenario}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-gray-600 uppercase">Date</p>
                    <p className="text-lg font-bold text-gray-900 mt-1">
                      {formatISTDate(call.date)}
                    </p>
                    <p className="text-sm text-gray-500">
                      {formatISTTime(call.date)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-gray-600 uppercase">Duration</p>
                    <p className="text-lg font-bold text-gray-900 mt-1">
                      {Math.floor(call.duration_sec / 60)}:{(call.duration_sec % 60).toString().padStart(2, '0')}
                    </p>
                  </div>
                </div>
              </div>

              {/* Overall Score */}
              <div className="p-6 border-b border-gray-200">
                <div className="flex items-center justify-between mb-6">
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900">Overall Score</h3>
                    <p className="text-sm text-gray-600 mt-1">CQ Percentage</p>
                  </div>
                  <div
                    className={`inline-flex items-center justify-center w-24 h-24 rounded-full font-bold text-3xl ${getStatusColor(
                      call.has_fatal,
                      call.cq_pct
                    )}`}
                  >
                    {call.cq_pct}%
                  </div>
                </div>
                {call.has_fatal && (
                  <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
                    <p className="text-sm font-semibold text-red-800">
                      ⚠️ Fatal Issue Detected
                    </p>
                    <p className="text-sm text-red-700 mt-1">
                      This call has critical issues that require immediate attention and coaching.
                    </p>
                  </div>
                )}
              </div>

              {/* Sub-Scores Gauges */}
              <div className="p-6 border-b border-gray-200">
                <h3 className="text-lg font-semibold text-gray-900 mb-6">Dimensional Scores</h3>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                  {[
                    { title: 'Opening', value: call.sub_scores.opening },
                    { title: 'Soft Skills', value: call.sub_scores.soft_skills },
                    { title: 'Hold Proc', value: call.sub_scores.hold_procedure },
                    { title: 'Resolution', value: call.sub_scores.resolution },
                    { title: 'Closing', value: call.sub_scores.closing },
                  ].map((score, idx) => (
                    <div key={idx} className="flex justify-center">
                      <MiniGauge title={score.title} value={score.value} />
                    </div>
                  ))}
                </div>
              </div>

              {/* Recording Section */}
              <div className="p-6 border-b border-gray-200 bg-gray-50">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Recording</h3>
                <div className="bg-white border border-gray-300 rounded-lg p-6 text-center">
                  <div className="flex justify-center mb-4">
                    <div className="w-16 h-16 bg-gradient-to-br from-blue-400 to-blue-600 rounded-full flex items-center justify-center">
                      <Play className="w-8 h-8 text-white" fill="white" />
                    </div>
                  </div>
                  <p className="text-gray-700 font-medium">Call Recording</p>
                  <p className="text-sm text-gray-600 mt-1">
                    Duration:{' '}
                    {Math.floor(call.recording.duration_sec / 60)}:
                    {(call.recording.duration_sec % 60).toString().padStart(2, '0')}
                  </p>
                  <button className="mt-4 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center justify-center gap-2 mx-auto">
                    <Volume2 className="w-4 h-4" />
                    Play Recording
                  </button>
                  <p className="text-xs text-gray-500 mt-3">
                    Mock recording (Phase 7.2 will integrate real storage)
                  </p>
                </div>
              </div>

              {/* Peer Comparison */}
              <div className="p-6 border-b border-gray-200">
                <h3 className="text-lg font-semibold text-gray-900 mb-6">Peer Comparison</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div style={{ maxHeight: '300px', width: '100%' }}>
                    <ResponsiveContainer width="100%" height={280}>
                      <BarChart data={comparisonChartData} margin={{ top: 20, right: 30, left: 0, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                        <XAxis dataKey="label" />
                        <YAxis domain={[0, 100]} />
                        <Tooltip formatter={(value) => `${value}%`} />
                        <Bar dataKey="score" fill="#3b82f6" radius={[8, 8, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="space-y-4">
                    <div className="bg-blue-50 p-4 rounded-lg">
                      <p className="text-xs font-semibold text-blue-600 uppercase">Your Score</p>
                      <p className="text-3xl font-bold text-blue-900 mt-2">{call.cq_pct}%</p>
                    </div>
                    <div className="bg-purple-50 p-4 rounded-lg">
                      <p className="text-xs font-semibold text-purple-600 uppercase">
                        Same Scenario Avg
                      </p>
                      <p className="text-3xl font-bold text-purple-900 mt-2">
                        {call.peer_comparison.same_scenario_avg}%
                      </p>
                    </div>
                    <div
                      className={`p-4 rounded-lg ${
                        call.peer_comparison.gap > 0
                          ? 'bg-red-50'
                          : 'bg-green-50'
                      }`}
                    >
                      <p className="text-xs font-semibold text-gray-600 uppercase">Gap</p>
                      <p
                        className={`text-3xl font-bold mt-2 ${
                          call.peer_comparison.gap > 0
                            ? 'text-red-900'
                            : 'text-green-900'
                        }`}
                      >
                        {call.peer_comparison.gap > 0 ? '+' : ''}{call.peer_comparison.gap}%
                      </p>
                    </div>
                    {call.peer_comparison.peer_note && (
                      <div className="bg-indigo-50 p-4 rounded-lg border border-indigo-200">
                        <p className="text-sm text-indigo-900">
                          <strong>Peer Note:</strong> {call.peer_comparison.peer_note}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Feedback Section */}
              <div className="p-6 border-b border-gray-200 bg-gray-50">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Coaching Feedback</h3>
                <div className="bg-white border border-gray-300 rounded-lg p-4">
                  <p className="text-gray-700 leading-relaxed">{call.feedback}</p>
                </div>
              </div>

              {/* Transcript Section */}
              <div className="p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Call Transcript</h3>
                <div className="bg-gray-100 border border-gray-300 rounded-lg p-4 max-h-64 overflow-y-auto">
                  <p className="text-sm text-gray-700 font-mono leading-relaxed">
                    {call.transcript}
                  </p>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="bg-gray-50 border-t border-gray-200 px-6 py-4 flex gap-3 justify-end">
              <button
                onClick={onClose}
                className="px-6 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-100 transition-colors font-medium"
              >
                Close
              </button>
              <button className="px-6 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors font-medium">
                Request Coaching
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default CallDetailModal;
