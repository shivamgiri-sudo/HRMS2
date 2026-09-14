import { useExpenseSummary, useMonthlyTrends, useTopSpenders } from '../../integrations/expenses/hooks';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { TrendingUp, Users, Receipt, DollarSign } from 'lucide-react';

const COLORS = ['#6366f1', '#8b5cf6', '#a855f7', '#c084fc', '#d8b4fe', '#e9d5ff'];

export default function ExpenseReports() {
  const { data: summary, isLoading: loadingSummary } = useExpenseSummary({});
  const { data: trendsData, isLoading: loadingTrends } = useMonthlyTrends(6);
  const { data: spendersData, isLoading: loadingSpenders } = useTopSpenders(10);

  const trends = trendsData?.trends ?? [];
  const spenders = spendersData?.spenders ?? [];

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Expense Reports</h1>
        <p className="text-muted-foreground">Analytics and insights for expense management</p>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="p-6 flex items-center gap-4">
            <DollarSign className="h-8 w-8 text-primary" />
            <div>
              <p className="text-sm text-muted-foreground">Total Amount</p>
              <p className="text-2xl font-bold">
                ₹{(summary?.total_amount ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
              </p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6 flex items-center gap-4">
            <Receipt className="h-8 w-8 text-primary" />
            <div>
              <p className="text-sm text-muted-foreground">Total Claims</p>
              <p className="text-2xl font-bold">{summary?.claim_count ?? 0}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6 flex items-center gap-4">
            <TrendingUp className="h-8 w-8 text-primary" />
            <div>
              <p className="text-sm text-muted-foreground">Avg Claim</p>
              <p className="text-2xl font-bold">
                ₹{(summary?.avg_claim_amount ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Monthly Trends */}
        <Card>
          <CardHeader>
            <CardTitle>Monthly Trends (6 months)</CardTitle>
          </CardHeader>
          <CardContent>
            {loadingTrends ? (
              <p className="text-muted-foreground text-center py-8">Loading...</p>
            ) : (
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={trends}>
                  <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip formatter={(v: number) => [`₹${v.toLocaleString('en-IN')}`, 'Amount']} />
                  <Bar dataKey="total_amount" fill="#6366f1" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* By Category */}
        <Card>
          <CardHeader>
            <CardTitle>By Category</CardTitle>
          </CardHeader>
          <CardContent>
            {loadingSummary ? (
              <p className="text-muted-foreground text-center py-8">Loading...</p>
            ) : (
              <ResponsiveContainer width="100%" height={250}>
                <PieChart>
                  <Pie
                    data={summary?.by_category ?? []}
                    dataKey="amount"
                    nameKey="category"
                    cx="50%"
                    cy="50%"
                    outerRadius={80}
                    label={({ category }: { category: string }) => category}
                  >
                    {(summary?.by_category ?? []).map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: number) => [`₹${v.toLocaleString('en-IN')}`, 'Amount']} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Top Spenders */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Top Spenders
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loadingSpenders ? (
            <p className="text-muted-foreground">Loading...</p>
          ) : (
            <div className="space-y-3">
              {spenders.map((s, i) => (
                <div key={i} className="flex items-center justify-between py-2 border-b last:border-0">
                  <div>
                    <p className="font-medium">{s.employee_name}</p>
                    <p className="text-sm text-muted-foreground">
                      {s.employee_code} · {s.claim_count} claims
                    </p>
                  </div>
                  <span className="font-bold">
                    ₹{s.total_amount.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      </div>
    </DashboardLayout>
  );
}
