import React, { useEffect, useState, useCallback } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { HeatmapGrid } from './HeatmapGrid';
import { RosterChart } from './RosterChart';
import { RiskList } from './RiskList';
import { QueueMetrics } from './QueueMetrics';
import { getOperationsWebSocketClient } from '@/lib/operations-websocket';
import type {
  AgentStatus,
  OperationsSummary,
  ProcessUtilization,
  EmployeeAttritionRisk,
} from '@/types/operations';

interface DashboardState {
  agents: AgentStatus[];
  summary: OperationsSummary;
  processes: ProcessUtilization[];
  overallUtilization: number;
  attritionRisks: EmployeeAttritionRisk[];
  highRiskCount: number;
  mediumRiskCount: number;
  loading: boolean;
  error: string | null;
  lastUpdated: string;
}

const initialState: DashboardState = {
  agents: [],
  summary: {
    total_agents: 0,
    logged_in: 0,
    on_break: 0,
    logged_out: 0,
    absent: 0,
    avg_call_duration: 0,
  },
  processes: [],
  overallUtilization: 0,
  attritionRisks: [],
  highRiskCount: 0,
  mediumRiskCount: 0,
  loading: false,
  error: null,
  lastUpdated: new Date().toISOString(),
};

export const OperationsDashboard: React.FC = () => {
  const [state, setState] = useState<DashboardState>(initialState);
  const [processFilter, setProcessFilter] = useState<string>('');

  // Fetch initial data
  const fetchInitialData = useCallback(async () => {
    try {
      setState((prev) => ({ ...prev, loading: true, error: null }));

      const token = localStorage.getItem('auth_token') || sessionStorage.getItem('auth_token');
      const headers = token ? { Authorization: `Bearer ${token}` } : {};

      // Parallel fetch for all data
      const [liveRes, rosterRes, attritionRes] = await Promise.all([
        fetch('/api/operations/live-status', { headers }).then((r) => r.json()),
        fetch('/api/operations/roster-vs-actual', { headers }).then((r) => r.json()),
        fetch('/api/operations/attrition-risk', { headers }).then((r) => r.json()),
      ]);

      if (liveRes.success && rosterRes.success && attritionRes.success) {
        const liveData = liveRes.data;
        const rosterData = rosterRes.data;
        const attritionData = attritionRes.data;

        setState({
          agents: liveData.agents,
          summary: liveData.summary,
          processes: rosterData.processes,
          overallUtilization: rosterData.utilization_pct,
          attritionRisks: attritionData.employees,
          highRiskCount: attritionData.high_risk_count,
          mediumRiskCount: attritionData.medium_risk_count,
          loading: false,
          error: null,
          lastUpdated: new Date().toISOString(),
        });
      } else {
        throw new Error('Failed to fetch dashboard data');
      }
    } catch (error) {
      console.error('Dashboard fetch error:', error);
      setState((prev) => ({
        ...prev,
        loading: false,
        error: error instanceof Error ? error.message : 'Failed to load dashboard data',
      }));
    }
  }, []);

  // Initialize WebSocket connection and subscriptions
  useEffect(() => {
    const token = localStorage.getItem('auth_token') || sessionStorage.getItem('auth_token');
    if (!token) {
      setState((prev) => ({ ...prev, error: 'Not authenticated' }));
      return;
    }

    const wsClient = getOperationsWebSocketClient();

    // Connect and subscribe
    wsClient.connect(token).catch((error) => {
      console.error('WebSocket connection failed:', error);
      // Fallback to polling if WebSocket fails
      fetchInitialData();
    });

    // Subscribe to real-time updates
    const unsubscribeLive = wsClient.subscribe('live-status', (message) => {
      setState((prev) => ({
        ...prev,
        agents: message.data.agents,
        summary: message.data.summary,
        lastUpdated: new Date().toISOString(),
      }));
    });

    const unsubscribeRoster = wsClient.subscribe('roster-vs-actual', (message) => {
      setState((prev) => ({
        ...prev,
        processes: message.data.processes,
        overallUtilization: message.data.utilization_pct,
        lastUpdated: new Date().toISOString(),
      }));
    });

    const unsubscribeAttrition = wsClient.subscribe('attrition-risk', (message) => {
      setState((prev) => ({
        ...prev,
        attritionRisks: message.data.employees,
        highRiskCount: message.data.high_risk_count,
        mediumRiskCount: message.data.medium_risk_count,
        lastUpdated: new Date().toISOString(),
      }));
    });

    const unsubscribeError = wsClient.subscribe('error', (message) => {
      console.error('WebSocket error:', message.data);
    });

    // Fetch initial data if not connected
    if (!wsClient.isConnected()) {
      fetchInitialData();
    }

    // Cleanup
    return () => {
      unsubscribeLive();
      unsubscribeRoster();
      unsubscribeAttrition();
      unsubscribeError();
      wsClient.disconnect();
    };
  }, []);

  // Filter agents by process
  const filteredAgents = processFilter
    ? state.agents.filter((a) => a.process_name === processFilter)
    : state.agents;

  // Get unique process names for filter
  const processes = Array.from(new Set(state.agents.map((a) => a.process_name).filter(Boolean)));

  return (
    <div className="space-y-6 p-6 bg-gray-50 min-h-screen">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Operations Dashboard</h1>
          <p className="text-sm text-gray-600 mt-1">
            Last updated: {formatISTTime(state.lastUpdated)}
          </p>
        </div>
        <Button
          onClick={fetchInitialData}
          variant="outline"
          size="sm"
          disabled={state.loading}
        >
          <RefreshCw size={16} className={state.loading ? 'animate-spin mr-2' : 'mr-2'} />
          Refresh
        </Button>
      </div>

      {state.error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
          <AlertCircle className="text-red-600 mt-0.5" size={20} />
          <div>
            <p className="font-semibold text-red-800">{state.error}</p>
            <p className="text-sm text-red-700">
              WebSocket connection may have failed. Showing last known state.
            </p>
          </div>
        </div>
      )}

      {/* Summary Metrics */}
      <QueueMetrics summary={state.summary} />

      {/* Process Filter */}
      {processes.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          <Button
            variant={processFilter === '' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setProcessFilter('')}
          >
            All Processes
          </Button>
          {processes.map((proc) => (
            <Button
              key={proc}
              variant={processFilter === proc ? 'default' : 'outline'}
              size="sm"
              onClick={() => setProcessFilter(proc)}
            >
              {proc}
            </Button>
          ))}
        </div>
      )}

      {/* Heatmap Grid */}
      <HeatmapGrid agents={filteredAgents} />

      {/* Charts and Analytics */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <RosterChart
          processes={state.processes}
          overallUtilization={state.overallUtilization}
        />
        <RiskList
          employees={state.attritionRisks.slice(0, 10)}
          highRiskCount={state.highRiskCount}
          mediumRiskCount={state.mediumRiskCount}
        />
      </div>
    </div>
  );
};
