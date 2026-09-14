/**
 * Mobile Roster Dashboard — PWA optimized view for managers on the floor
 * Touch-friendly, quick actions, real-time team status
 * Follows MAS HRMS frozen design patterns with mobile-first approach
 */

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Users,
  UserCheck,
  UserX,
  Clock,
  AlertTriangle,
  ChevronRight,
  RefreshCw,
  Calendar,
  Phone,
  MessageSquare,
  CheckCircle,
  XCircle,
  Coffee,
  TrendingUp,
  Bell,
  Menu,
  Home,
  BarChart3,
  Settings,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { hrmsApi } from '@/lib/hrmsApi';

interface TeamMember {
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  status: 'present' | 'absent' | 'late' | 'on_leave' | 'week_off';
  shiftName: string;
  loginTime?: string;
  lateMinutes?: number;
  breakStatus?: 'on_break' | 'available';
}

interface QuickStat {
  label: string;
  value: number;
  total?: number;
  icon: React.ReactNode;
  color: string;
  bgColor: string;
}

const statusColors: Record<string, { bg: string; text: string; border: string }> = {
  present: { bg: 'bg-emerald-100', text: 'text-emerald-700', border: 'border-emerald-300' },
  absent: { bg: 'bg-red-100', text: 'text-red-700', border: 'border-red-300' },
  late: { bg: 'bg-amber-100', text: 'text-amber-700', border: 'border-amber-300' },
  on_leave: { bg: 'bg-purple-100', text: 'text-purple-700', border: 'border-purple-300' },
  week_off: { bg: 'bg-slate-100', text: 'text-slate-500', border: 'border-slate-300' },
  on_break: { bg: 'bg-blue-100', text: 'text-blue-700', border: 'border-blue-300' },
};

const statusLabels: Record<string, string> = {
  present: 'Present',
  absent: 'Absent',
  late: 'Late',
  on_leave: 'On Leave',
  week_off: 'Week Off',
};

export default function MobileRosterDashboard() {
  const [selectedFilter, setSelectedFilter] = useState<string>('all');
  const [showActions, setShowActions] = useState(false);

  const { data: teamData, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['mobile-team-status'],
    queryFn: async () => {
      const res = await hrmsApi.get('/roster-analytics/team-status-mobile');
      return res.data;
    },
    refetchInterval: 60000, // Auto-refresh every minute
    placeholderData: {
      teamSize: 24,
      present: 18,
      absent: 2,
      late: 3,
      onLeave: 1,
      weekOff: 0,
      onBreak: 4,
      adherencePct: 87,
      members: [] as TeamMember[],
    },
  });

  // Mock data for demo
  const mockMembers: TeamMember[] = [
    { employeeId: '1', employeeCode: 'EMP001', employeeName: 'Rahul Sharma', status: 'present', shiftName: 'Morning', loginTime: '09:02', breakStatus: 'available' },
    { employeeId: '2', employeeCode: 'EMP002', employeeName: 'Priya Singh', status: 'present', shiftName: 'Morning', loginTime: '08:58', breakStatus: 'on_break' },
    { employeeId: '3', employeeCode: 'EMP003', employeeName: 'Amit Kumar', status: 'late', shiftName: 'Morning', loginTime: '09:15', lateMinutes: 15 },
    { employeeId: '4', employeeCode: 'EMP004', employeeName: 'Sneha Patel', status: 'absent', shiftName: 'Morning' },
    { employeeId: '5', employeeCode: 'EMP005', employeeName: 'Vikram Reddy', status: 'present', shiftName: 'Morning', loginTime: '08:55', breakStatus: 'available' },
    { employeeId: '6', employeeCode: 'EMP006', employeeName: 'Neha Gupta', status: 'on_leave', shiftName: 'Morning' },
    { employeeId: '7', employeeCode: 'EMP007', employeeName: 'Karan Mehta', status: 'present', shiftName: 'Morning', loginTime: '09:00', breakStatus: 'available' },
    { employeeId: '8', employeeCode: 'EMP008', employeeName: 'Anita Verma', status: 'late', shiftName: 'Morning', loginTime: '09:22', lateMinutes: 22 },
  ];

  const stats = teamData || {
    teamSize: 24,
    present: 18,
    absent: 2,
    late: 3,
    onLeave: 1,
    weekOff: 0,
    onBreak: 4,
    adherencePct: 87,
  };

  const members = teamData?.members?.length ? teamData.members : mockMembers;

  const filteredMembers = selectedFilter === 'all'
    ? members
    : members.filter((m: TeamMember) => m.status === selectedFilter);

  const quickStats: QuickStat[] = [
    {
      label: 'Present',
      value: stats.present,
      total: stats.teamSize,
      icon: <UserCheck className="w-5 h-5" />,
      color: '#15803d',
      bgColor: '#eaf8ef',
    },
    {
      label: 'Absent',
      value: stats.absent,
      icon: <UserX className="w-5 h-5" />,
      color: '#dc2626',
      bgColor: '#fff0f1',
    },
    {
      label: 'Late',
      value: stats.late,
      icon: <Clock className="w-5 h-5" />,
      color: '#ea580c',
      bgColor: '#fff4e8',
    },
    {
      label: 'On Break',
      value: stats.onBreak,
      icon: <Coffee className="w-5 h-5" />,
      color: '#0b63e5',
      bgColor: '#edf4ff',
    },
  ];

  const handleCall = (phone: string) => {
    window.location.href = `tel:${phone}`;
  };

  const handleMessage = (employeeId: string) => {
    // Would integrate with internal messaging
    console.log('Message', employeeId);
  };

  return (
    <div className="min-h-screen bg-slate-50 pb-20">
      {/* Header - Fixed */}
      <div className="sticky top-0 z-50 bg-gradient-to-r from-indigo-600 to-purple-600 text-white px-4 py-4 safe-area-inset-top">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-white/70 uppercase tracking-wider">Team Roster</p>
            <h1 className="text-xl font-bold">Today's Status</h1>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => refetch()}
              disabled={isFetching}
              className="text-white hover:bg-white/20"
            >
              <RefreshCw className={`w-5 h-5 ${isFetching ? 'animate-spin' : ''}`} />
            </Button>
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="text-white hover:bg-white/20">
                  <Menu className="w-5 h-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="right" className="w-72">
                <SheetHeader>
                  <SheetTitle>Quick Navigation</SheetTitle>
                </SheetHeader>
                <div className="mt-6 space-y-2">
                  <Link to="/wfm/roster-command-center" className="flex items-center gap-3 p-3 rounded-lg hover:bg-slate-100">
                    <BarChart3 className="w-5 h-5 text-indigo-600" />
                    <span>Command Center</span>
                  </Link>
                  <Link to="/wfm/roster-view" className="flex items-center gap-3 p-3 rounded-lg hover:bg-slate-100">
                    <Calendar className="w-5 h-5 text-indigo-600" />
                    <span>Full Roster View</span>
                  </Link>
                  <Link to="/wfm/roster-interventions" className="flex items-center gap-3 p-3 rounded-lg hover:bg-slate-100">
                    <AlertTriangle className="w-5 h-5 text-amber-600" />
                    <span>At-Risk Employees</span>
                  </Link>
                  <Link to="/wfm/notification-hub" className="flex items-center gap-3 p-3 rounded-lg hover:bg-slate-100">
                    <Bell className="w-5 h-5 text-indigo-600" />
                    <span>Notifications</span>
                  </Link>
                  <Link to="/wfm/roster-audit" className="flex items-center gap-3 p-3 rounded-lg hover:bg-slate-100">
                    <Settings className="w-5 h-5 text-slate-600" />
                    <span>Audit Trail</span>
                  </Link>
                </div>
              </SheetContent>
            </Sheet>
          </div>
        </div>

        {/* Adherence Progress */}
        <div className="mt-4">
          <div className="flex items-center justify-between text-sm mb-1">
            <span className="text-white/80">Team Adherence</span>
            <span className="font-bold">{stats.adherencePct}%</span>
          </div>
          <Progress value={stats.adherencePct} className="h-2 bg-white/20" />
        </div>
      </div>

      {/* Quick Stats - Scrollable horizontal */}
      <div className="px-4 py-4 overflow-x-auto">
        <div className="flex gap-3" style={{ minWidth: 'max-content' }}>
          {quickStats.map((stat) => (
            <button
              key={stat.label}
              onClick={() => setSelectedFilter(stat.label.toLowerCase().replace(' ', '_'))}
              className={`flex-shrink-0 w-24 p-3 rounded-xl border transition-all ${
                selectedFilter === stat.label.toLowerCase().replace(' ', '_')
                  ? 'border-indigo-400 bg-indigo-50 shadow-sm'
                  : 'border-white/60 bg-white'
              }`}
            >
              <div
                className="w-9 h-9 rounded-lg flex items-center justify-center mb-2"
                style={{ backgroundColor: stat.bgColor }}
              >
                <div style={{ color: stat.color }}>{stat.icon}</div>
              </div>
              <p className="text-2xl font-bold text-gray-900">{stat.value}</p>
              <p className="text-xs text-gray-500">{stat.label}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Filter Pills */}
      <div className="px-4 pb-3">
        <div className="flex gap-2 overflow-x-auto">
          <button
            onClick={() => setSelectedFilter('all')}
            className={`px-4 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${
              selectedFilter === 'all'
                ? 'bg-indigo-600 text-white'
                : 'bg-white text-gray-600 border border-gray-200'
            }`}
          >
            All ({members.length})
          </button>
          {['present', 'absent', 'late', 'on_leave'].map((status) => (
            <button
              key={status}
              onClick={() => setSelectedFilter(status)}
              className={`px-4 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${
                selectedFilter === status
                  ? `${statusColors[status].bg} ${statusColors[status].text}`
                  : 'bg-white text-gray-600 border border-gray-200'
              }`}
            >
              {statusLabels[status]}
            </button>
          ))}
        </div>
      </div>

      {/* Team List */}
      <div className="px-4 space-y-2">
        {filteredMembers.map((member: TeamMember) => (
          <Card
            key={member.employeeId}
            className="rounded-xl border border-white/60 bg-white overflow-hidden"
          >
            <CardContent className="p-0">
              <div className="flex items-center p-4">
                {/* Avatar */}
                <div
                  className={`w-12 h-12 rounded-full flex items-center justify-center text-lg font-bold ${statusColors[member.status].bg} ${statusColors[member.status].text}`}
                >
                  {member.employeeName.split(' ').map(n => n[0]).join('').slice(0, 2)}
                </div>

                {/* Info */}
                <div className="flex-1 ml-3">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-gray-900">{member.employeeName}</p>
                    {member.breakStatus === 'on_break' && (
                      <Badge className="bg-blue-100 text-blue-700 text-[10px] px-1.5">
                        <Coffee className="w-3 h-3 mr-0.5" /> Break
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-gray-500">
                    {member.employeeCode} • {member.shiftName}
                  </p>
                  <div className="flex items-center gap-2 mt-1">
                    <Badge
                      className={`text-[10px] ${statusColors[member.status].bg} ${statusColors[member.status].text}`}
                    >
                      {statusLabels[member.status]}
                    </Badge>
                    {member.loginTime && (
                      <span className="text-xs text-gray-500">
                        <Clock className="w-3 h-3 inline mr-0.5" />
                        {member.loginTime}
                      </span>
                    )}
                    {member.lateMinutes && (
                      <span className="text-xs text-amber-600">
                        +{member.lateMinutes}m late
                      </span>
                    )}
                  </div>
                </div>

                {/* Quick Actions */}
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="w-10 h-10 rounded-full hover:bg-green-100"
                    onClick={() => handleCall('9876543210')}
                  >
                    <Phone className="w-4 h-4 text-green-600" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="w-10 h-10 rounded-full hover:bg-blue-100"
                    onClick={() => handleMessage(member.employeeId)}
                  >
                    <MessageSquare className="w-4 h-4 text-blue-600" />
                  </Button>
                </div>
              </div>

              {/* Absent/Late action row */}
              {(member.status === 'absent' || member.status === 'late') && (
                <div className="px-4 pb-3 flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1 text-xs h-8 border-amber-200 text-amber-700 hover:bg-amber-50"
                  >
                    <AlertTriangle className="w-3 h-3 mr-1" />
                    Log Reason
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1 text-xs h-8 border-indigo-200 text-indigo-700 hover:bg-indigo-50"
                  >
                    <Calendar className="w-3 h-3 mr-1" />
                    Apply Leave
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        ))}

        {filteredMembers.length === 0 && (
          <div className="text-center py-12 text-gray-500">
            <Users className="w-12 h-12 mx-auto mb-3 text-gray-300" />
            <p>No team members in this category</p>
          </div>
        )}
      </div>

      {/* Bottom Navigation - Fixed */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-6 py-2 safe-area-inset-bottom">
        <div className="flex items-center justify-around">
          <Link to="/wfm/mobile-roster" className="flex flex-col items-center py-2 px-4 text-indigo-600">
            <Home className="w-5 h-5" />
            <span className="text-[10px] mt-0.5 font-medium">Home</span>
          </Link>
          <Link to="/wfm/roster-view" className="flex flex-col items-center py-2 px-4 text-gray-400">
            <Calendar className="w-5 h-5" />
            <span className="text-[10px] mt-0.5">Schedule</span>
          </Link>
          <Link to="/wfm/roster-analytics" className="flex flex-col items-center py-2 px-4 text-gray-400">
            <TrendingUp className="w-5 h-5" />
            <span className="text-[10px] mt-0.5">Analytics</span>
          </Link>
          <Link to="/wfm/notification-hub" className="flex flex-col items-center py-2 px-4 text-gray-400 relative">
            <Bell className="w-5 h-5" />
            <span className="absolute top-1 right-3 w-2 h-2 bg-red-500 rounded-full" />
            <span className="text-[10px] mt-0.5">Alerts</span>
          </Link>
        </div>
      </div>
    </div>
  );
}
