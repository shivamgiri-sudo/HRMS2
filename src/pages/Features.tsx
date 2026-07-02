import React from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { 
  Users, 
  Calendar, 
  BarChart3, 
  Shield, 
  Clock, 
  FileText,
  Package,
  CreditCard,
  Bell,
  Settings,
  Building2,
  Target,
  ArrowRight,
  CheckCircle,
  UserPlus,
  FolderOpen,
  History,
  PieChart,
  Wallet,
  FileCheck,
  Laptop,
  Wrench,
  Trophy,
  TrendingUp,
  LineChart,
  Mail,
  BellRing,
  CalendarCheck,
  Upload,
  Lock,
  Eye,
  UserCog,
  Sliders,
  Cog
} from "lucide-react";
import hrHubLogo from "@/assets/brand/mcn-logo.png";
import Footer from "@/components/layout/Footer";
import { isProductionDomain } from "@/lib/domain";
import employeeMgmtImg from "@/assets/features/employee-management.png";
import leaveAttendanceImg from "@/assets/features/leave-attendance.png";
import documentsImg from "@/assets/features/documents.png";
import securityImg from "@/assets/features/security.png";
import analyticsImg from "@/assets/features/analytics.png";
import settingsImg from "@/assets/features/settings.png";
import payrollImg from "@/assets/features/payroll.png";
import assetsImg from "@/assets/features/assets.png";
import performanceImg from "@/assets/features/performance.png";
import notificationsImg from "@/assets/features/notifications.png";

const featureSections = [
  {
    icon: <Users className="h-8 w-8" />,
    title: "Employee Management",
    description: "Centralized employee database with complete lifecycle management from onboarding to offboarding.",
    image: employeeMgmtImg,
    details: [
      { icon: <UserPlus className="h-5 w-5" />, text: "Complete employee profiles with personal and professional details" },
      { icon: <FolderOpen className="h-5 w-5" />, text: "Document storage for contracts, certificates, and compliance files" },
      { icon: <History className="h-5 w-5" />, text: "Employment history tracking and audit trails" },
      { icon: <Building2 className="h-5 w-5" />, text: "Organizational hierarchy and reporting structure visualization" }
    ],
    reversed: false
  },
  {
    icon: <Calendar className="h-8 w-8" />,
    title: "Leave & Attendance Management",
    description: "Streamlined time-off requests and real-time attendance tracking with automated workflows.",
    image: leaveAttendanceImg,
    details: [
      { icon: <CalendarCheck className="h-5 w-5" />, text: "Multiple leave types with customizable policies and accrual rules" },
      { icon: <Clock className="h-5 w-5" />, text: "Clock in/out with geolocation and IP-based verification" },
      { icon: <CheckCircle className="h-5 w-5" />, text: "Multi-level approval workflows with manager notifications" },
      { icon: <PieChart className="h-5 w-5" />, text: "Real-time leave balance tracking and forecasting" }
    ],
    reversed: true
  },
  {
    icon: <CreditCard className="h-8 w-8" />,
    title: "Payroll Processing",
    description: "Comprehensive payroll management with automatic calculations, tax handling, and detailed reporting.",
    image: payrollImg,
    details: [
      { icon: <Wallet className="h-5 w-5" />, text: "Flexible salary structures with allowances and deductions" },
      { icon: <FileCheck className="h-5 w-5" />, text: "Automated payslip generation and distribution" },
      { icon: <BarChart3 className="h-5 w-5" />, text: "Tax calculations and compliance reporting" },
      { icon: <History className="h-5 w-5" />, text: "Payment history and year-end summaries" }
    ],
    reversed: false
  },
  {
    icon: <Package className="h-8 w-8" />,
    title: "Asset Management",
    description: "Track company assets throughout their lifecycle from procurement to retirement.",
    image: assetsImg,
    details: [
      { icon: <Laptop className="h-5 w-5" />, text: "Comprehensive asset inventory with categories and serial tracking" },
      { icon: <Users className="h-5 w-5" />, text: "Employee assignment history and current allocations" },
      { icon: <Wrench className="h-5 w-5" />, text: "Maintenance scheduling and warranty tracking" },
      { icon: <FileText className="h-5 w-5" />, text: "Asset depreciation and value reports" }
    ],
    reversed: true
  },
  {
    icon: <Target className="h-8 w-8" />,
    title: "Performance Management",
    description: "Goal setting, continuous feedback, and structured performance reviews to drive employee growth.",
    image: performanceImg,
    details: [
      { icon: <Trophy className="h-5 w-5" />, text: "SMART goal setting with progress tracking and milestones" },
      { icon: <TrendingUp className="h-5 w-5" />, text: "Customizable review cycles (quarterly, semi-annual, annual)" },
      { icon: <LineChart className="h-5 w-5" />, text: "360-degree feedback and self-assessments" },
      { icon: <BarChart3 className="h-5 w-5" />, text: "Performance analytics and team comparisons" }
    ],
    reversed: false
  },
  {
    icon: <Bell className="h-8 w-8" />,
    title: "Notifications & Communication",
    description: "Stay informed with automated notifications for all important HR events and deadlines.",
    image: notificationsImg,
    details: [
      { icon: <Mail className="h-5 w-5" />, text: "Email notifications for leave approvals and status updates" },
      { icon: <BellRing className="h-5 w-5" />, text: "Review schedule reminders and deadline alerts" },
      { icon: <CalendarCheck className="h-5 w-5" />, text: "Company event and holiday announcements" },
      { icon: <Settings className="h-5 w-5" />, text: "Customizable notification preferences per user" }
    ],
    reversed: true
  },
  {
    icon: <FileText className="h-8 w-8" />,
    title: "Document Management",
    description: "Secure, centralized storage for all employee documents with easy access and organization.",
    image: documentsImg,
    details: [
      { icon: <Upload className="h-5 w-5" />, text: "Drag-and-drop document uploads with categorization" },
      { icon: <Lock className="h-5 w-5" />, text: "Role-based access control for sensitive documents" },
      { icon: <History className="h-5 w-5" />, text: "Version history and document expiry tracking" },
      { icon: <FileCheck className="h-5 w-5" />, text: "Digital signature integration for contracts" }
    ],
    reversed: false
  },
  {
    icon: <Shield className="h-8 w-8" />,
    title: "Security & Access Control",
    description: "Enterprise-grade security with granular permissions and comprehensive audit trails.",
    image: securityImg,
    details: [
      { icon: <UserCog className="h-5 w-5" />, text: "Role-based access for admins, HR, managers, and employees" },
      { icon: <Eye className="h-5 w-5" />, text: "Field-level permissions for sensitive data" },
      { icon: <History className="h-5 w-5" />, text: "Complete audit logs for compliance and accountability" },
      { icon: <Lock className="h-5 w-5" />, text: "Two-factor authentication and session management" }
    ],
    reversed: true
  },
  {
    icon: <BarChart3 className="h-8 w-8" />,
    title: "Analytics & Reporting",
    description: "Data-driven insights with customizable dashboards and exportable reports.",
    image: analyticsImg,
    details: [
      { icon: <PieChart className="h-5 w-5" />, text: "Real-time dashboards with key HR metrics" },
      { icon: <FileText className="h-5 w-5" />, text: "Pre-built reports for payroll, leave, and assets" },
      { icon: <TrendingUp className="h-5 w-5" />, text: "Trend analysis and workforce planning insights" },
      { icon: <FileCheck className="h-5 w-5" />, text: "Export to PDF and CSV for external sharing" }
    ],
    reversed: false
  },
  {
    icon: <Settings className="h-8 w-8" />,
    title: "Customizable Settings",
    description: "Flexible configuration options to adapt the platform to your organization's unique needs.",
    image: settingsImg,
    details: [
      { icon: <Sliders className="h-5 w-5" />, text: "Custom leave types with individual policies and limits" },
      { icon: <Calendar className="h-5 w-5" />, text: "Working days and holiday calendar configuration" },
      { icon: <Cog className="h-5 w-5" />, text: "Workflow customization for approvals and escalations" },
      { icon: <Building2 className="h-5 w-5" />, text: "Multi-location and department-specific settings" }
    ],
    reversed: true
  }
] as const;

const Features = () => {
  const isProduction = isProductionDomain();

  return (
    <div className="min-h-screen bg-background">
      {/* Navigation */}
      <nav className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <img src={hrHubLogo} alt="Mas Callnet HRMS" className="h-8 w-auto" />
            <span className="text-xl font-bold">Mas Callnet HRMS</span>
          </Link>
          <div className="hidden md:flex items-center gap-8">
            <Link to="/features" className="text-sm font-medium text-foreground transition-colors">
              Features
            </Link>
            <Link to="/how-it-works" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
              How It Works
            </Link>
            <Link to="/pricing" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
              Pricing
            </Link>
          </div>
          <div className="flex items-center gap-3">
            <Link to="/auth">
              <Button variant="ghost" size="sm">Sign In</Button>
            </Link>
            {isProduction && (
              <a href="https://cal.com/littlemissbot/business-consultancy" target="_blank" rel="noopener noreferrer">
                <Button size="sm">Request Demo</Button>
              </a>
            )}
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-primary/5" />
        <div className="container mx-auto px-4 py-20 lg:py-28 relative">
          <div className="max-w-4xl mx-auto text-center space-y-6">
            <Badge variant="secondary" className="px-4 py-1.5 text-sm font-medium">
              Platform Features
            </Badge>
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight leading-relaxed">
              Everything You Need to{" "}
              <span className="text-primary">Manage Your Workforce</span>
            </h1>
            <p className="text-lg md:text-xl text-muted-foreground max-w-3xl mx-auto leading-relaxed">
              A complete suite of HR tools designed to simplify your operations, 
              empower your team, and drive organizational success.
            </p>
          </div>
        </div>
      </section>

      {/* Feature Sections */}
      <section className="py-16">
        {featureSections.map((feature, index) => (
          <div 
            key={index} 
            className={`py-16 ${index % 2 === 1 ? 'bg-muted/30' : ''}`}
          >
            <div className="container mx-auto px-4">
              <div className={`grid lg:grid-cols-2 gap-12 lg:gap-16 items-center ${feature.reversed ? 'lg:flex-row-reverse' : ''}`}>
                <div className={feature.reversed ? 'lg:order-2' : ''}>
                  <div className="h-16 w-16 rounded-2xl bg-primary/10 text-primary flex items-center justify-center mb-6">
                    {feature.icon}
                  </div>
                  <h2 className="text-3xl md:text-4xl font-bold mb-4">{feature.title}</h2>
                  <p className="text-lg text-muted-foreground mb-8 leading-relaxed">
                    {feature.description}
                  </p>
                  <ul className="space-y-4">
                    {feature.details.map((detail, detailIndex) => (
                      <li key={detailIndex} className="flex items-start gap-4">
                        <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0 text-primary">
                          {detail.icon}
                        </div>
                        <span className="text-foreground pt-2">{detail.text}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className={`${feature.reversed ? 'lg:order-1' : ''}`}>
                  {('image' in feature) && feature.image ? (
                    <div className="rounded-2xl overflow-hidden border border-border shadow-2xl bg-muted">
                      <img
                        src={feature.image}
                        alt={`${feature.title} interface preview`}
                        loading="lazy"
                        className="w-full h-auto block"
                      />
                    </div>
                  ) : (
                    <div className="bg-gradient-to-br from-primary/10 via-primary/5 to-transparent rounded-3xl p-8 lg:p-12 aspect-square flex items-center justify-center">
                      <div className="text-primary opacity-20">
                        {React.cloneElement(feature.icon, { className: "h-48 w-48" })}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        ))}
      </section>

      {/* CTA Section */}
      <section className="bg-primary text-primary-foreground py-20">
        <div className="container mx-auto px-4 text-center">
          <div className="max-w-3xl mx-auto space-y-6">
            <h2 className="text-3xl md:text-4xl font-bold">
              Ready to Transform Your HR Operations?
            </h2>
            <p className="text-primary-foreground/80 text-lg">
              Join thousands of companies that have modernized their HR with Mas Callnet HRMS. 
              Start your free trial today — no credit card required.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center pt-4">
              <Link to="/auth">
                <Button size="lg" variant="secondary" className="gap-2 px-8 h-12">
                  Start Free Trial <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
              <a href="https://cal.com/littlemissbot/business-consultancy" target="_blank" rel="noopener noreferrer">
                <Button size="lg" variant="secondary" className="gap-2 px-8 h-12">
                  Talk to Sales
                </Button>
              </a>
            </div>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
};

export default Features;