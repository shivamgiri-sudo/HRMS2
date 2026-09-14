import React from 'react';
import { AlertCircle, AlertTriangle, Info } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { EmployeeAttritionRisk } from '@/types/operations';

interface RiskListProps {
  employees: EmployeeAttritionRisk[];
  highRiskCount: number;
  mediumRiskCount: number;
}

const severityIcons: Record<string, React.ReactNode> = {
  high: <AlertCircle className="text-red-500" size={20} />,
  medium: <AlertTriangle className="text-yellow-500" size={20} />,
  low: <Info className="text-blue-500" size={20} />,
};

const severityBgColors: Record<string, string> = {
  high: 'bg-red-50 border-l-4 border-red-500',
  medium: 'bg-yellow-50 border-l-4 border-yellow-500',
  low: 'bg-blue-50 border-l-4 border-blue-500',
};

const getRiskBadgeColor = (score: number): string => {
  if (score >= 70) return 'bg-red-100 text-red-800';
  if (score >= 50) return 'bg-yellow-100 text-yellow-800';
  return 'bg-blue-100 text-blue-800';
};

const getSeverityLevel = (score: number): 'high' | 'medium' | 'low' => {
  if (score >= 70) return 'high';
  if (score >= 50) return 'medium';
  return 'low';
};

export const RiskList: React.FC<RiskListProps> = ({
  employees,
  highRiskCount,
  mediumRiskCount,
}) => {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Attrition Risk Assessment</CardTitle>
        <div className="grid grid-cols-2 gap-4 mt-2 text-sm">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-red-500 rounded-full"></div>
            <span>High Risk: {highRiskCount}</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-yellow-500 rounded-full"></div>
            <span>Medium Risk: {mediumRiskCount}</span>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-3 max-h-96 overflow-y-auto">
          {employees.length === 0 ? (
            <p className="text-center text-gray-500 py-4">No at-risk employees identified</p>
          ) : (
            employees.map((emp) => {
              const severity = getSeverityLevel(emp.risk_score);
              return (
                <div
                  key={emp.employee_id}
                  className={`p-3 rounded ${severityBgColors[severity]}`}
                >
                  <div className="flex items-start gap-3">
                    {severityIcons[severity]}
                    <div className="flex-1">
                      <div className="flex items-center justify-between mb-1">
                        <p className="font-semibold text-sm">{emp.employee_name}</p>
                        <span
                          className={`px-2 py-1 rounded text-xs font-semibold ${getRiskBadgeColor(
                            emp.risk_score
                          )}`}
                        >
                          {emp.risk_score}%
                        </span>
                      </div>
                      <p className="text-xs text-gray-600 mb-2">{emp.employee_code}</p>
                      {emp.signals.length > 0 && (
                        <div className="text-xs space-y-1">
                          {emp.signals.map((signal, idx) => (
                            <p key={idx} className="text-gray-700">
                              • {signal.description}
                            </p>
                          ))}
                        </div>
                      )}
                      {emp.retention_action && (
                        <p className="text-xs font-semibold text-red-600 mt-2">
                          Action: {emp.retention_action}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </CardContent>
    </Card>
  );
};
