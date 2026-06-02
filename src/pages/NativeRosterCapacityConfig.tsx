import React, { useState, useEffect } from 'react';
import { Calendar, Users, Clock, CheckCircle, XCircle, Settings } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';

interface Process {
  id: string;
  name: string;
}

interface CapacityConfig {
  id: string;
  process_id: string;
  day_of_week: number;
  max_weekoff_count: number;
  max_weekoff_percentage: number | null;
  auto_approve_enabled: number;
  auto_approve_threshold: number | null;
}

const DAYS = [
  { value: 0, label: 'Sunday' },
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
];

export default function NativeRosterCapacityConfig() {
  const { user } = useAuth();
  const [processes, setProcesses] = useState<Process[]>([]);
  const [selectedProcess, setSelectedProcess] = useState<string>('');
  const [configs, setConfigs] = useState<CapacityConfig[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // Fetch processes
  useEffect(() => {
    fetchProcesses();
  }, []);

  // Fetch configs when process selected
  useEffect(() => {
    if (selectedProcess) {
      fetchConfigs();
    }
  }, [selectedProcess]);

  const fetchProcesses = async () => {
    try {
      const response = await fetch('http://localhost:3002/api/processes', {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('token')}`,
        },
      });
      const data = await response.json();
      setProcesses(data);
      if (data.length > 0) {
        setSelectedProcess(data[0].id);
      }
    } catch (error) {
      console.error('Failed to fetch processes:', error);
    }
  };

  const fetchConfigs = async () => {
    if (!selectedProcess) return;

    setLoading(true);
    try {
      // Fetch all 7 days config
      const promises = DAYS.map(day =>
        fetch(`http://localhost:3002/api/roster-capacity/config/${selectedProcess}/${day.value}`, {
          headers: {
            Authorization: `Bearer ${localStorage.getItem('token')}`,
          },
        }).then(r => r.ok ? r.json() : null)
      );

      const results = await Promise.all(promises);
      setConfigs(results.filter(Boolean));
    } catch (error) {
      console.error('Failed to fetch configs:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleConfigChange = (dayOfWeek: number, field: string, value: any) => {
    setConfigs(prev => {
      const existing = prev.find(c => c.day_of_week === dayOfWeek);
      if (existing) {
        return prev.map(c =>
          c.day_of_week === dayOfWeek ? { ...c, [field]: value } : c
        );
      } else {
        // Create new config
        return [
          ...prev,
          {
            id: '',
            process_id: selectedProcess,
            day_of_week: dayOfWeek,
            max_weekoff_count: 5,
            max_weekoff_percentage: 20,
            auto_approve_enabled: 0,
            auto_approve_threshold: null,
            [field]: value,
          } as CapacityConfig,
        ];
      }
    });
  };

  const handleSave = async (dayOfWeek: number) => {
    const config = configs.find(c => c.day_of_week === dayOfWeek);
    if (!config) return;

    setSaving(true);
    try {
      const response = await fetch(
        `http://localhost:3002/api/roster-capacity/config/${selectedProcess}/${dayOfWeek}`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${localStorage.getItem('token')}`,
          },
          body: JSON.stringify({
            max_weekoff_count: config.max_weekoff_count,
            max_weekoff_percentage: config.max_weekoff_percentage,
            auto_approve_enabled: config.auto_approve_enabled === 1,
            auto_approve_threshold: config.auto_approve_threshold,
          }),
        }
      );

      if (response.ok) {
        alert('Configuration saved successfully');
        fetchConfigs(); // Refresh
      } else {
        alert('Failed to save configuration');
      }
    } catch (error) {
      console.error('Failed to save config:', error);
      alert('Error saving configuration');
    } finally {
      setSaving(false);
    }
  };

  const getConfig = (dayOfWeek: number): CapacityConfig | undefined => {
    return configs.find(c => c.day_of_week === dayOfWeek);
  };

  if (!user) return <div>Please login</div>;

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-3">
                <Settings className="w-8 h-8 text-blue-600" />
                Week-Off Capacity Configuration
              </h1>
              <p className="text-gray-600 mt-1">
                Configure daily week-off capacity limits and auto-approval rules per process
              </p>
            </div>
          </div>

          {/* Process Selection */}
          <div className="mt-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Select Process
            </label>
            <select
              value={selectedProcess}
              onChange={(e) => setSelectedProcess(e.target.value)}
              className="w-full md:w-96 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              {processes.map((proc) => (
                <option key={proc.id} value={proc.id}>
                  {proc.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Configuration Grid */}
        {loading ? (
          <div className="text-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
            <p className="mt-4 text-gray-600">Loading configurations...</p>
          </div>
        ) : (
          <div className="grid gap-4">
            {DAYS.map((day) => {
              const config = getConfig(day.value);
              const maxCount = config?.max_weekoff_count ?? 5;
              const maxPercentage = config?.max_weekoff_percentage ?? 20;
              const autoApprove = config?.auto_approve_enabled === 1;
              const autoThreshold = config?.auto_approve_threshold ?? null;

              return (
                <div key={day.value} className="bg-white rounded-lg shadow-sm p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                      <Calendar className="w-5 h-5 text-blue-600" />
                      {day.label}
                    </h3>
                    <button
                      onClick={() => handleSave(day.value)}
                      disabled={saving}
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                    >
                      {saving ? 'Saving...' : 'Save'}
                    </button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    {/* Max Count */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        <Users className="w-4 h-4 inline mr-1" />
                        Max Week-Off Count
                      </label>
                      <input
                        type="number"
                        min="0"
                        value={maxCount}
                        onChange={(e) =>
                          handleConfigChange(day.value, 'max_weekoff_count', parseInt(e.target.value))
                        }
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                      />
                      <p className="text-xs text-gray-500 mt-1">
                        Max employees who can take this day off
                      </p>
                    </div>

                    {/* Max Percentage */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Max Week-Off Percentage (%)
                      </label>
                      <input
                        type="number"
                        min="0"
                        max="100"
                        step="0.1"
                        value={maxPercentage ?? ''}
                        onChange={(e) =>
                          handleConfigChange(
                            day.value,
                            'max_weekoff_percentage',
                            e.target.value ? parseFloat(e.target.value) : null
                          )
                        }
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                      />
                      <p className="text-xs text-gray-500 mt-1">
                        Max % of process strength
                      </p>
                    </div>

                    {/* Auto-Approve Toggle */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        <CheckCircle className="w-4 h-4 inline mr-1" />
                        Auto-Approve
                      </label>
                      <div className="flex items-center space-x-3">
                        <button
                          onClick={() =>
                            handleConfigChange(day.value, 'auto_approve_enabled', autoApprove ? 0 : 1)
                          }
                          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                            autoApprove ? 'bg-green-600' : 'bg-gray-300'
                          }`}
                        >
                          <span
                            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                              autoApprove ? 'translate-x-6' : 'translate-x-1'
                            }`}
                          />
                        </button>
                        <span className="text-sm text-gray-700">
                          {autoApprove ? 'Enabled' : 'Disabled'}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500 mt-1">
                        Auto-approve preferences within limits
                      </p>
                    </div>

                    {/* Auto-Approve Threshold */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        <Clock className="w-4 h-4 inline mr-1" />
                        Auto-Approve Threshold
                      </label>
                      <input
                        type="number"
                        min="0"
                        value={autoThreshold ?? ''}
                        onChange={(e) =>
                          handleConfigChange(
                            day.value,
                            'auto_approve_threshold',
                            e.target.value ? parseInt(e.target.value) : null
                          )
                        }
                        disabled={!autoApprove}
                        placeholder="No limit"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
                      />
                      <p className="text-xs text-gray-500 mt-1">
                        Auto-approve first N requests (blank = all)
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
