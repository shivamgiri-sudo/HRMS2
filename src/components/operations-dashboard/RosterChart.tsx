import React from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { ProcessUtilization } from '@/types/operations';

interface RosterChartProps {
  processes: ProcessUtilization[];
  overallUtilization: number;
}

export const RosterChart: React.FC<RosterChartProps> = ({ processes, overallUtilization }) => {
  const chartData = processes.map((p) => ({
    name: p.process_name,
    Planned: p.planned_headcount,
    'Logged In': p.actual_logged_in,
    Utilization: p.utilization_pct,
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Roster vs Actual Utilization</CardTitle>
        <p className="text-sm text-gray-600">
          Overall Utilization: <span className="font-bold text-lg">{overallUtilization}%</span>
        </p>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="name" />
            <YAxis />
            <Tooltip />
            <Legend />
            <Bar dataKey="Planned" fill="#3b82f6" />
            <Bar dataKey="Logged In" fill="#10b981" />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
};
