# 🎯 Complete Implementation Guide - Performance & Engagement Portal

## ✅ Files Created

### 1. Badge System Components

#### `/src/components/engagement/BadgeIcon.tsx`
- Displays individual badge with shiny hover effect
- Tooltip shows badge details and earned date
- Color-coded by category (performance, activity, tenure, social)
- Sparkle animation on hover

#### `/src/components/engagement/BadgeCelebration.tsx`
- Full-screen confetti celebration
- Animated badge reveal with rotation
- Gradient background with celebration emoji
- Share button for social integration
- Auto-closes confetti after 5 seconds

#### `/src/components/engagement/AwardBadgeDialog.tsx`
- Manager interface to award badges to team members
- Badge selector with preview
- Employee selector (team members only)
- Reason textarea (required)
- Triggers celebration modal on success

### 2. Backend Updates

#### `/backend/src/modules/employees/employee.routes.ts`
- Added badges and recent_kudos to stat card endpoint
- Imports badge and kudos services
- Returns last 5 kudos received

#### `/backend/src/modules/engagement/badge.service.ts`
- Added `DISTINCT` and `GROUP BY` to fix duplicates
- Ensures unique badges in listing

#### `/backend/src/modules/engagement/kudos.service.ts`
- Added employee codes to display names
- Format: "Full Name (EMP_CODE)"
- Filters for active employees only

---

## 📦 Installation Requirements

Add these dependencies to `package.json`:

```bash
npm install react-confetti
npm install @types/react-confetti --save-dev
```

---

## 🔧 Implementation Steps

### Step 1: Update Employee Stat Card

Add to `/src/pages/NativeEmployeeStatCard.tsx`:

**A. Add interfaces:**
```typescript
interface BadgeEarned {
  badge_id: string;
  badge_name: string;
  badge_description: string | null;
  badge_icon: string | null;
  badge_category: string;
  points_value: number;
  earned_at: string;
  reason: string | null;
}

interface RecentKudos {
  kudos_id: string;
  sender_name: string;
  receiver_name: string;
  kudos_title: string | null;
  custom_message: string | null;
  points_awarded: number;
  sent_at: string;
}
```

**B. Update StatCardData:**
```typescript
interface StatCardData {
  // ... existing fields
  badges: BadgeEarned[];
  recent_kudos: RecentKudos[];
}
```

**C. Add imports:**
```typescript
import { BadgeIcon } from "@/components/engagement/BadgeIcon";
import { Heart } from "lucide-react";
```

**D. Add UI sections** (see code blocks in previous messages)

---

### Step 2: Add Badge Awarding to Team Views

Update any manager/team pages to include the award button:

```typescript
import { AwardBadgeDialog } from "@/components/engagement/AwardBadgeDialog";

// In component:
const [awardDialogOpen, setAwardDialogOpen] = useState(false);
const [selectedEmployee, setSelectedEmployee] = useState<{id: string, name: string} | null>(null);

// Button in team member card:
<Button onClick={() => {
  setSelectedEmployee({id: member.id, name: member.full_name});
  setAwardDialogOpen(true);
}}>
  <Award className="h-4 w-4 mr-2" />
  Award Badge
</Button>

// Dialog at bottom of component:
<AwardBadgeDialog
  isOpen={awardDialogOpen}
  onClose={() => setAwardDialogOpen(false)}
  employeeId={selectedEmployee?.id}
  employeeName={selectedEmployee?.name}
/>
```

---

## 🗄️ Database Analysis - APR & Quality Tables

### APR Tables Query Script

Create `/backend/scripts/analyze-apr-tables.sql`:

```sql
-- Show all APR-related tables
SHOW TABLES LIKE '%apr%';

-- Describe each APR table structure
-- (Run for each table found)
DESCRIBE apr_calls;
DESCRIBE apr_quality;
DESCRIBE apr_performance;

-- Sample data from APR tables
SELECT * FROM apr_calls LIMIT 10;
SELECT * FROM apr_quality LIMIT 10;

-- Get column names and types
SELECT 
  COLUMN_NAME,
  DATA_TYPE,
  COLUMN_TYPE,
  COLUMN_KEY,
  COLUMN_COMMENT
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = 'mas_hrms'
  AND TABLE_NAME LIKE '%apr%'
ORDER BY TABLE_NAME, ORDINAL_POSITION;
```

### Quality Database Query

```sql
-- Check available quality databases
SHOW DATABASES LIKE '%quality%';

-- Switch to quality database
USE quality_database_name;

-- Show tables
SHOW TABLES;

-- Analyze quality score tables
SELECT * FROM quality_scores LIMIT 10;
SELECT * FROM quality_audits LIMIT 10;

-- Get employee quality metrics
SELECT 
  employee_id,
  AVG(quality_score) as avg_quality,
  COUNT(*) as total_audits,
  SUM(CASE WHEN passed = 1 THEN 1 ELSE 0 END) as passed_audits
FROM quality_audits
WHERE DATE(audit_date) >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
GROUP BY employee_id;
```

---

## 📊 MyKpiDashboard Redesign

Create `/src/pages/MyKpiDashboard.tsx`:

```typescript
import { useQuery } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";
import { 
  TrendingUp, 
  TrendingDown,
  Phone,
  Clock,
  Target,
  Award,
  Activity,
  CheckCircle 
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

interface KPIData {
  operations: {
    calls_handled_today: number;
    calls_handled_week: number;
    calls_handled_month: number;
    avg_handle_time: number;
    first_call_resolution: number;
    conversion_rate: number;
    target_achievement: number;
  };
  quality: {
    quality_score: number;
    compliance_rate: number;
    csat_score: number;
    audit_pass_rate: number;
    improvement_trend: number;
  };
  trends: Array<{
    period: string;
    calls: number;
    quality: number;
  }>;
}

export default function MyKpiDashboard() {
  const { data: kpiData, isLoading } = useQuery({
    queryKey: ["my-kpi"],
    queryFn: async () => {
      const res = await hrmsApi.get<{ data: KPIData }>("/api/kpi/my-dashboard");
      return res.data;
    },
  });

  if (isLoading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="h-12 w-12 animate-spin rounded-full border-4 border-blue-100 border-t-blue-600" />
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6 p-6">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold text-slate-900">My KPI Dashboard</h1>
          <p className="text-slate-600 mt-1">Track your performance metrics and goals</p>
        </div>

        {/* Operations KPIs */}
        <div>
          <h2 className="text-xl font-bold text-slate-900 mb-4">Operations Performance</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            
            {/* Calls Handled */}
            <Card className="bg-gradient-to-br from-blue-50 to-indigo-50 border-blue-200">
              <CardContent className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <Phone className="h-8 w-8 text-blue-600" />
                  <TrendingUp className="h-5 w-5 text-green-600" />
                </div>
                <p className="text-sm font-semibold text-slate-600 mb-1">Calls Handled</p>
                <p className="text-3xl font-bold text-slate-900">{kpiData?.operations.calls_handled_today || 0}</p>
                <div className="mt-3 flex items-center gap-2 text-xs text-slate-500">
                  <span>Week: {kpiData?.operations.calls_handled_week || 0}</span>
                  <span>•</span>
                  <span>Month: {kpiData?.operations.calls_handled_month || 0}</span>
                </div>
              </CardContent>
            </Card>

            {/* Avg Handle Time */}
            <Card className="bg-gradient-to-br from-purple-50 to-pink-50 border-purple-200">
              <CardContent className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <Clock className="h-8 w-8 text-purple-600" />
                  <TrendingDown className="h-5 w-5 text-green-600" />
                </div>
                <p className="text-sm font-semibold text-slate-600 mb-1">Avg Handle Time</p>
                <p className="text-3xl font-bold text-slate-900">{kpiData?.operations.avg_handle_time || 0}s</p>
                <Progress value={75} className="mt-3 h-2" />
                <p className="text-xs text-slate-500 mt-2">Target: 180s</p>
              </CardContent>
            </Card>

            {/* First Call Resolution */}
            <Card className="bg-gradient-to-br from-green-50 to-emerald-50 border-green-200">
              <CardContent className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <CheckCircle className="h-8 w-8 text-green-600" />
                  <TrendingUp className="h-5 w-5 text-green-600" />
                </div>
                <p className="text-sm font-semibold text-slate-600 mb-1">First Call Resolution</p>
                <p className="text-3xl font-bold text-slate-900">{kpiData?.operations.first_call_resolution || 0}%</p>
                <Progress value={kpiData?.operations.first_call_resolution || 0} className="mt-3 h-2" />
                <p className="text-xs text-slate-500 mt-2">Target: 85%</p>
              </CardContent>
            </Card>

            {/* Conversion Rate */}
            <Card className="bg-gradient-to-br from-amber-50 to-orange-50 border-amber-200">
              <CardContent className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <Target className="h-8 w-8 text-amber-600" />
                  <TrendingUp className="h-5 w-5 text-green-600" />
                </div>
                <p className="text-sm font-semibold text-slate-600 mb-1">Conversion Rate</p>
                <p className="text-3xl font-bold text-slate-900">{kpiData?.operations.conversion_rate || 0}%</p>
                <Progress value={kpiData?.operations.conversion_rate || 0} className="mt-3 h-2" />
                <p className="text-xs text-slate-500 mt-2">Target: 20%</p>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Quality KPIs */}
        <div>
          <h2 className="text-xl font-bold text-slate-900 mb-4">Quality Performance</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            
            {/* Quality Score */}
            <Card className="bg-gradient-to-br from-indigo-50 to-blue-50 border-indigo-200">
              <CardContent className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <Award className="h-8 w-8 text-indigo-600" />
                  <div className="text-sm font-bold text-indigo-600">
                    {kpiData?.quality.improvement_trend || 0 > 0 ? "↑" : "↓"} 
                    {Math.abs(kpiData?.quality.improvement_trend || 0)}%
                  </div>
                </div>
                <p className="text-sm font-semibold text-slate-600 mb-1">Quality Score</p>
                <p className="text-3xl font-bold text-slate-900">{kpiData?.quality.quality_score || 0}%</p>
                <Progress value={kpiData?.quality.quality_score || 0} className="mt-3 h-2" />
                <p className="text-xs text-slate-500 mt-2">Target: 90%</p>
              </CardContent>
            </Card>

            {/* Compliance Rate */}
            <Card className="bg-gradient-to-br from-teal-50 to-cyan-50 border-teal-200">
              <CardContent className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <CheckCircle className="h-8 w-8 text-teal-600" />
                </div>
                <p className="text-sm font-semibold text-slate-600 mb-1">Compliance Rate</p>
                <p className="text-3xl font-bold text-slate-900">{kpiData?.quality.compliance_rate || 0}%</p>
                <Progress value={kpiData?.quality.compliance_rate || 0} className="mt-3 h-2" />
                <p className="text-xs text-slate-500 mt-2">Target: 95%</p>
              </CardContent>
            </Card>

            {/* CSAT Score */}
            <Card className="bg-gradient-to-br from-rose-50 to-pink-50 border-rose-200">
              <CardContent className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <Activity className="h-8 w-8 text-rose-600" />
                </div>
                <p className="text-sm font-semibold text-slate-600 mb-1">CSAT Score</p>
                <p className="text-3xl font-bold text-slate-900">{kpiData?.quality.csat_score || 0}%</p>
                <Progress value={kpiData?.quality.csat_score || 0} className="mt-3 h-2" />
                <p className="text-xs text-slate-500 mt-2">Target: 85%</p>
              </CardContent>
            </Card>

            {/* Audit Pass Rate */}
            <Card className="bg-gradient-to-br from-violet-50 to-purple-50 border-violet-200">
              <CardContent className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <CheckCircle className="h-8 w-8 text-violet-600" />
                </div>
                <p className="text-sm font-semibold text-slate-600 mb-1">Audit Pass Rate</p>
                <p className="text-3xl font-bold text-slate-900">{kpiData?.quality.audit_pass_rate || 0}%</p>
                <Progress value={kpiData?.quality.audit_pass_rate || 0} className="mt-3 h-2" />
                <p className="text-xs text-slate-500 mt-2">Target: 90%</p>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Trend Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          
          {/* Calls Trend */}
          <Card>
            <CardContent className="p-6">
              <h3 className="text-lg font-bold text-slate-900 mb-4">Calls Trend (Last 7 Days)</h3>
              <ResponsiveContainer width="100%" height={250}>
                <LineChart data={kpiData?.trends || []}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="period" stroke="#666" fontSize={11} />
                  <YAxis stroke="#666" fontSize={11} />
                  <Tooltip />
                  <Line type="monotone" dataKey="calls" stroke="#3b82f6" strokeWidth={3} />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Quality Trend */}
          <Card>
            <CardContent className="p-6">
              <h3 className="text-lg font-bold text-slate-900 mb-4">Quality Trend (Last 7 Days)</h3>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={kpiData?.trends || []}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="period" stroke="#666" fontSize={11} />
                  <YAxis stroke="#666" fontSize={11} />
                  <Tooltip />
                  <Bar dataKey="quality" fill="#8b5cf6" radius={[8, 8, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}
```

---

## 🔌 Backend API Endpoint for KPI

Create `/backend/src/modules/kpi/kpi.routes.ts`:

```typescript
import { Router } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";

const router = Router();
router.use(requireAuth);

router.get("/my-dashboard", async (req: any, res: any) => {
  try {
    const userId = req.authUser?.id;
    
    // Get employee ID
    const [empRows] = await db.execute<RowDataPacket[]>(
      "SELECT id FROM employees WHERE user_id = ? LIMIT 1",
      [userId]
    );
    
    if (!empRows.length) {
      return res.status(404).json({ error: "Employee not found" });
    }
    
    const employeeId = empRows[0].id;
    
    // TODO: Replace with actual APR table queries
    // This is mock data - replace with real queries
    const data = {
      operations: {
        calls_handled_today: 45,
        calls_handled_week: 234,
        calls_handled_month: 987,
        avg_handle_time: 165,
        first_call_resolution: 87,
        conversion_rate: 23,
        target_achievement: 92,
      },
      quality: {
        quality_score: 91,
        compliance_rate: 96,
        csat_score: 88,
        audit_pass_rate: 94,
        improvement_trend: 5,
      },
      trends: [
        { period: "Mon", calls: 42, quality: 89 },
        { period: "Tue", calls: 48, quality: 92 },
        { period: "Wed", calls: 51, quality: 88 },
        { period: "Thu", calls: 45, quality: 91 },
        { period: "Fri", calls: 47, quality: 93 },
        { period: "Sat", calls: 38, quality: 90 },
        { period: "Sun", calls: 35, quality: 87 },
      ],
    };
    
    res.json({ data });
  } catch (error) {
    console.error("KPI dashboard error:", error);
    res.status(500).json({ error: "Failed to fetch KPI data" });
  }
});

export { router as kpiRouter };
```

Add to main routes in `/backend/src/app.ts`:

```typescript
import { kpiRouter } from "./modules/kpi/kpi.routes.js";
app.use("/api/kpi", kpiRouter);
```

---

## ✅ Testing Checklist

- [ ] Install react-confetti: `npm install react-confetti`
- [ ] Badge duplicates removed from /engagement/badges
- [ ] Badges showing in employee stat card with shiny icons
- [ ] Kudos showing in employee stat card
- [ ] Badge awarding dialog works for managers
- [ ] Celebration modal appears with confetti
- [ ] MyKpiDashboard shows real/mock KPI data
- [ ] Performance page has meaningful content
- [ ] All animations work smoothly
- [ ] Responsive on mobile/tablet/desktop

---

## 🎨 UI/UX Features Implemented

✅ Shiny badge hover effects
✅ Confetti celebration animation
✅ Gradient backgrounds per card type
✅ Smooth transitions (300ms)
✅ Tooltip with badge details
✅ Color-coded badges by category
✅ Sparkle animations
✅ Progress bars for KPIs
✅ Trend charts (Line & Bar)
✅ Responsive grid layouts

---

## 📝 Next Steps

1. **Run APR analysis queries** to understand actual table structure
2. **Replace mock KPI data** with real queries
3. **Test badge awarding** with real team members
4. **Customize confetti colors** to match brand
5. **Add badge sharing** to social feeds
6. **Create Performance page** meaningful content

---

## 🐛 Troubleshooting

**Badges not showing:**
- Check backend returns badges array in stat card API
- Verify badge table has data: `SELECT * FROM gamification_badge_master;`
- Check console for errors

**Confetti not working:**
- Ensure `react-confetti` is installed
- Check browser console for errors
- Verify window dimensions are set

**KPI dashboard blank:**
- Check API endpoint `/api/kpi/my-dashboard`
- Verify mock data returns correctly
- Check network tab for API errors

---

END OF IMPLEMENTATION GUIDE
