import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { AgentStatus } from '@/types/operations';

interface HeatmapGridProps {
  agents: AgentStatus[];
  onAgentClick?: (agent: AgentStatus) => void;
}

const statusColors: Record<string, string> = {
  'Logged In': 'bg-green-500',
  'On Break': 'bg-yellow-500',
  'Logged Out': 'bg-gray-400',
  'Absent': 'bg-red-500',
};

const statusTextColors: Record<string, string> = {
  'Logged In': 'text-green-700',
  'On Break': 'text-yellow-700',
  'Logged Out': 'text-gray-700',
  'Absent': 'text-red-700',
};

export const HeatmapGrid: React.FC<HeatmapGridProps> = ({ agents, onAgentClick }) => {
  // Group agents by process
  const groupedByProcess = agents.reduce((acc, agent) => {
    const process = agent.process_name || 'Unassigned';
    if (!acc[process]) {
      acc[process] = [];
    }
    acc[process].push(agent);
    return acc;
  }, {} as Record<string, AgentStatus[]>);

  return (
    <div className="space-y-3">
      {/* Legend — the colour coding is otherwise unexplained. Driven off the same
          statusColors map as the tiles so the two can never drift apart. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {Object.entries(statusColors).map(([status, colorClass]) => (
          <div key={status} className="flex items-center gap-1.5">
            <span className={`h-2.5 w-2.5 rounded-sm ${colorClass}`} aria-hidden="true" />
            <span className="text-xs text-slate-600">{status}</span>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {Object.entries(groupedByProcess).map(([processName, processAgents]) => (
        <Card key={processName}>
          <CardHeader>
            <CardTitle className="text-lg">{processName}</CardTitle>
            <p className="text-sm text-gray-600">
              {processAgents.length} agents
            </p>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-4 gap-2">
              {processAgents.map((agent) => (
                <button
                  key={agent.agent_id}
                  onClick={() => onAgentClick?.(agent)}
                  className={`
                    p-2 rounded text-white text-xs font-semibold
                    transition-transform hover:scale-110
                    ${statusColors[agent.status] || 'bg-gray-400'}
                  `}
                  title={`${agent.agent_code}: ${agent.status} (${agent.duration}m)`}
                >
                  <div className="truncate">{agent.agent_code}</div>
                  <div className="text-xs">{agent.duration}m</div>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      ))}
      </div>
    </div>
  );
};
