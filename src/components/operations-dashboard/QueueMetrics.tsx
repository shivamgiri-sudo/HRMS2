import React from 'react';
import { Users, PhoneOff, User, Clock } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import type { OperationsSummary } from '@/types/operations';

interface QueueMetricsProps {
  summary: OperationsSummary;
}

const MetricCard: React.FC<{
  label: string;
  value: number | string;
  icon: React.ReactNode;
  color: string;
}> = ({ label, value, icon, color }) => (
  <Card className={`${color}`}>
    <CardContent className="p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-gray-600">{label}</p>
          <p className="text-2xl font-bold mt-1">{value}</p>
        </div>
        <div className="text-gray-400">{icon}</div>
      </div>
    </CardContent>
  </Card>
);

export const QueueMetrics: React.FC<QueueMetricsProps> = ({ summary }) => {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <MetricCard
        label="Total Agents"
        value={summary.total_agents}
        icon={<Users size={32} />}
        color="bg-blue-50"
      />
      <MetricCard
        label="Logged In"
        value={summary.logged_in}
        icon={<User size={32} className="text-green-500" />}
        color="bg-green-50"
      />
      <MetricCard
        label="On Break"
        value={summary.on_break}
        icon={<Clock size={32} className="text-yellow-500" />}
        color="bg-yellow-50"
      />
      <MetricCard
        label="Logged Out"
        value={summary.logged_out}
        icon={<PhoneOff size={32} className="text-gray-500" />}
        color="bg-gray-50"
      />
    </div>
  );
};
