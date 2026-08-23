/**
 * Mobile Team Attendance — Quick check-in view for managers
 * Swipe-friendly cards, quick mark present/absent, real-time sync
 */

import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Check,
  X,
  Clock,
  ChevronLeft,
  Search,
  Filter,
  RefreshCw,
  UserCheck,
  UserX,
  AlertCircle,
  CheckCircle2,
  Loader2,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { hrmsApi } from '@/lib/hrmsApi';

interface AttendanceEntry {
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  shiftName: string;
  shiftStart: string;
  expectedStatus: 'rostered' | 'week_off' | 'leave';
  actualStatus: 'present' | 'absent' | 'late' | 'pending' | null;
  loginTime?: string;
  markedBy?: string;
  markedAt?: string;
}

export default function MobileTeamAttendance() {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'pending' | 'present' | 'absent'>('pending');
  const queryClient = useQueryClient();

  const today = new Date().toISOString().slice(0, 10);
  const dayName = new Date().toLocaleDateString('en-IN', { weekday: 'long' });

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['mobile-team-attendance', today],
    queryFn: async () => {
      // Mock data - would come from API
      return {
        date: today,
        teamSize: 12,
        marked: 8,
        pending: 4,
        entries: [
          { employeeId: '1', employeeCode: 'MAS001', employeeName: 'Rahul Sharma', shiftName: 'Morning', shiftStart: '09:00', expectedStatus: 'rostered', actualStatus: 'present', loginTime: '08:58' },
          { employeeId: '2', employeeCode: 'MAS002', employeeName: 'Priya Singh', shiftName: 'Morning', shiftStart: '09:00', expectedStatus: 'rostered', actualStatus: 'late', loginTime: '09:12' },
          { employeeId: '3', employeeCode: 'MAS003', employeeName: 'Amit Kumar', shiftName: 'Morning', shiftStart: '09:00', expectedStatus: 'rostered', actualStatus: 'pending' },
          { employeeId: '4', employeeCode: 'MAS004', employeeName: 'Sneha Patel', shiftName: 'Morning', shiftStart: '09:00', expectedStatus: 'rostered', actualStatus: 'pending' },
          { employeeId: '5', employeeCode: 'MAS005', employeeName: 'Vikram Reddy', shiftName: 'Morning', shiftStart: '09:00', expectedStatus: 'rostered', actualStatus: 'absent' },
          { employeeId: '6', employeeCode: 'MAS006', employeeName: 'Neha Gupta', shiftName: 'Morning', shiftStart: '09:00', expectedStatus: 'leave', actualStatus: null },
          { employeeId: '7', employeeCode: 'MAS007', employeeName: 'Karan Mehta', shiftName: 'Morning', shiftStart: '09:00', expectedStatus: 'rostered', actualStatus: 'present', loginTime: '09:00' },
          { employeeId: '8', employeeCode: 'MAS008', employeeName: 'Anita Verma', shiftName: 'Morning', shiftStart: '09:00', expectedStatus: 'rostered', actualStatus: 'pending' },
          { employeeId: '9', employeeCode: 'MAS009', employeeName: 'Deepak Joshi', shiftName: 'Morning', shiftStart: '09:00', expectedStatus: 'week_off', actualStatus: null },
          { employeeId: '10', employeeCode: 'MAS010', employeeName: 'Kavita Rao', shiftName: 'Morning', shiftStart: '09:00', expectedStatus: 'rostered', actualStatus: 'pending' },
        ] as AttendanceEntry[],
      };
    },
    refetchInterval: 30000,
  });

  const markAttendance = useMutation({
    mutationFn: async ({ employeeId, status }: { employeeId: string; status: 'present' | 'absent' }) => {
      // Would call API
      await new Promise(r => setTimeout(r, 500));
      return { employeeId, status };
    },
    onSuccess: (data) => {
      toast.success(`Marked ${data.status} successfully`);
      queryClient.invalidateQueries({ queryKey: ['mobile-team-attendance'] });
    },
  });

  const entries = data?.entries || [];

  const filteredEntries = entries
    .filter((e: AttendanceEntry) => {
      if (e.expectedStatus !== 'rostered') return false;
      if (filter === 'pending') return e.actualStatus === 'pending';
      if (filter === 'present') return e.actualStatus === 'present' || e.actualStatus === 'late';
      if (filter === 'absent') return e.actualStatus === 'absent';
      return true;
    })
    .filter((e: AttendanceEntry) =>
      !search ||
      e.employeeName.toLowerCase().includes(search.toLowerCase()) ||
      e.employeeCode.toLowerCase().includes(search.toLowerCase())
    );

  const pendingCount = entries.filter((e: AttendanceEntry) => e.expectedStatus === 'rostered' && e.actualStatus === 'pending').length;
  const presentCount = entries.filter((e: AttendanceEntry) => e.actualStatus === 'present' || e.actualStatus === 'late').length;
  const absentCount = entries.filter((e: AttendanceEntry) => e.actualStatus === 'absent').length;

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="sticky top-0 z-50 bg-white border-b border-gray-200 px-4 py-3 safe-area-inset-top">
        <div className="flex items-center gap-3">
          <Link to="/wfm/mobile-roster">
            <Button variant="ghost" size="icon" className="w-9 h-9">
              <ChevronLeft className="w-5 h-5" />
            </Button>
          </Link>
          <div className="flex-1">
            <h1 className="text-lg font-bold text-gray-900">Team Attendance</h1>
            <p className="text-xs text-gray-500">{dayName}, {new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => refetch()}
            disabled={isFetching}
            className="w-9 h-9"
          >
            <RefreshCw className={`w-5 h-5 ${isFetching ? 'animate-spin' : ''}`} />
          </Button>
        </div>

        {/* Quick Stats Bar */}
        <div className="flex items-center gap-4 mt-3 px-1">
          <div className="flex items-center gap-1.5">
            <div className="w-7 h-7 rounded-full bg-amber-100 flex items-center justify-center">
              <Clock className="w-4 h-4 text-amber-600" />
            </div>
            <span className="text-sm font-medium text-amber-700">{pendingCount} pending</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-7 h-7 rounded-full bg-emerald-100 flex items-center justify-center">
              <UserCheck className="w-4 h-4 text-emerald-600" />
            </div>
            <span className="text-sm font-medium text-emerald-700">{presentCount} present</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-7 h-7 rounded-full bg-red-100 flex items-center justify-center">
              <UserX className="w-4 h-4 text-red-600" />
            </div>
            <span className="text-sm font-medium text-red-700">{absentCount} absent</span>
          </div>
        </div>

        {/* Search */}
        <div className="mt-3 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <Input
            placeholder="Search by name or code..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-10 rounded-xl bg-slate-50 border-slate-200"
          />
        </div>

        {/* Filter Tabs */}
        <div className="flex gap-2 mt-3 overflow-x-auto pb-1">
          {[
            { key: 'pending', label: 'Pending', count: pendingCount },
            { key: 'all', label: 'All', count: entries.filter((e: AttendanceEntry) => e.expectedStatus === 'rostered').length },
            { key: 'present', label: 'Present', count: presentCount },
            { key: 'absent', label: 'Absent', count: absentCount },
          ].map((tab) => (
            <button
              key={tab.key}
              onClick={() => setFilter(tab.key as any)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
                filter === tab.key
                  ? 'bg-indigo-600 text-white'
                  : 'bg-slate-100 text-gray-600'
              }`}
            >
              {tab.label} ({tab.count})
            </button>
          ))}
        </div>
      </div>

      {/* Attendance Cards */}
      <div className="px-4 py-4 space-y-3">
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
          </div>
        ) : filteredEntries.length === 0 ? (
          <div className="text-center py-16">
            <CheckCircle2 className="w-16 h-16 mx-auto text-emerald-300 mb-3" />
            <p className="text-gray-600 font-medium">
              {filter === 'pending' ? 'All attendance marked!' : 'No records found'}
            </p>
          </div>
        ) : (
          filteredEntries.map((entry: AttendanceEntry) => (
            <Card key={entry.employeeId} className="rounded-xl border-0 shadow-sm overflow-hidden">
              <CardContent className="p-0">
                <div className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`w-11 h-11 rounded-full flex items-center justify-center text-sm font-bold ${
                        entry.actualStatus === 'present' || entry.actualStatus === 'late'
                          ? 'bg-emerald-100 text-emerald-700'
                          : entry.actualStatus === 'absent'
                            ? 'bg-red-100 text-red-700'
                            : 'bg-slate-100 text-slate-600'
                      }`}>
                        {entry.employeeName.split(' ').map(n => n[0]).join('').slice(0, 2)}
                      </div>
                      <div>
                        <p className="font-semibold text-gray-900">{entry.employeeName}</p>
                        <p className="text-xs text-gray-500">{entry.employeeCode} • {entry.shiftName} ({entry.shiftStart})</p>
                      </div>
                    </div>
                    {entry.actualStatus && entry.actualStatus !== 'pending' && (
                      <Badge className={`text-xs ${
                        entry.actualStatus === 'present' ? 'bg-emerald-100 text-emerald-700' :
                        entry.actualStatus === 'late' ? 'bg-amber-100 text-amber-700' :
                        'bg-red-100 text-red-700'
                      }`}>
                        {entry.actualStatus === 'late' ? `Late (${entry.loginTime})` : entry.actualStatus}
                        {entry.actualStatus === 'present' && entry.loginTime && ` ${entry.loginTime}`}
                      </Badge>
                    )}
                  </div>
                </div>

                {/* Quick Action Buttons for pending */}
                {entry.actualStatus === 'pending' && (
                  <div className="flex border-t">
                    <button
                      onClick={() => markAttendance.mutate({ employeeId: entry.employeeId, status: 'present' })}
                      disabled={markAttendance.isPending}
                      className="flex-1 flex items-center justify-center gap-2 py-3 text-emerald-600 font-medium hover:bg-emerald-50 active:bg-emerald-100 transition-colors border-r"
                    >
                      {markAttendance.isPending && markAttendance.variables?.employeeId === entry.employeeId && markAttendance.variables?.status === 'present' ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Check className="w-5 h-5" />
                      )}
                      Present
                    </button>
                    <button
                      onClick={() => markAttendance.mutate({ employeeId: entry.employeeId, status: 'absent' })}
                      disabled={markAttendance.isPending}
                      className="flex-1 flex items-center justify-center gap-2 py-3 text-red-600 font-medium hover:bg-red-50 active:bg-red-100 transition-colors"
                    >
                      {markAttendance.isPending && markAttendance.variables?.employeeId === entry.employeeId && markAttendance.variables?.status === 'absent' ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <X className="w-5 h-5" />
                      )}
                      Absent
                    </button>
                  </div>
                )}
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {/* Mark All Present FAB */}
      {pendingCount > 0 && filter === 'pending' && (
        <div className="fixed bottom-6 left-4 right-4 safe-area-inset-bottom">
          <Button
            className="w-full h-12 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold shadow-lg shadow-emerald-500/30"
            onClick={() => {
              // Would batch mark all as present
              toast.success('All marked as present');
            }}
          >
            <CheckCircle2 className="w-5 h-5 mr-2" />
            Mark All Present ({pendingCount})
          </Button>
        </div>
      )}
    </div>
  );
}
