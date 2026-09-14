import { Link, Navigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { 
  Users, 
  Calendar, 
  BarChart3, 
  Shield, 
  Clock, 
  FileText,
  ArrowRight,
  CheckCircle,
  Building2,
  Zap,
  Globe,
  Layers,
  TrendingUp,
  HeadphonesIcon,
  Award
} from "lucide-react";
import hrHubLogo from "@/assets/brand/mcn-logo.png";
import Footer from "@/components/layout/Footer";
import { isProductionDomain } from "@/lib/domain";

const Landing = () => {
  const { user, isLoading } = useAuth();
  const isProduction = isProductionDomain();

  if (!isLoading && user) {
    return <Navigate to="/dashboard" replace />;
  }

  const features = [
    {
      icon: <Users className="h-6 w-6" />,
      title: "Employee Management",
      description: "Centralized employee database with complete lifecycle management from onboarding to offboarding."
    },
    {
      icon: <Calendar className="h-6 w-6" />,
      title: "Leave & Attendance",
      description: "Automated time tracking, leave management, and attendance monitoring with real-time insights."
    },
    {
      icon: <BarChart3 className="h-6 w-6" />,
      title: "Performance Analytics",
      description: "Data-driven performance reviews, goal tracking, and comprehensive team analytics."
    },
    {
      icon: <FileText className="h-6 w-6" />,
      title: "Payroll Processing",
      description: "Streamlined payroll management with automatic calculations and detailed reporting."
    },
    {
      icon: <Shield className="h-6 w-6" />,
      title: "Compliance & Security",
      description: "Role-based access control, audit trails, and enterprise-grade data protection."
    },
    {
      icon: <Layers className="h-6 w-6" />,
      title: "Asset Management",
      description: "Track company assets, assignments, and maintenance schedules efficiently."
    }
  ];

  const benefits = [
    "Reduce HR administrative time by 60%",
    "Centralized employee data management",
    "Real-time analytics and reporting",
    "Automated workflow approvals",
    "Self-service employee portal",
    "Scalable for teams of any size"
  ];

  const stats = [
    { value: "99.9%", label: "Uptime SLA", icon: <Zap className="h-5 w-5" /> },
    { value: "50K+", label: "Employees Managed", icon: <Users className="h-5 w-5" /> },
    { value: "24/7", label: "Enterprise Support", icon: <HeadphonesIcon className="h-5 w-5" /> }
  ];

  const testimonials = [
    {
      quote: "Mas Callnet HRMS transformed how we manage our workforce. The automation alone saved us 20+ hours per week.",
      author: "Sarah Chen",
      role: "VP of People Operations",
      company: "TechScale Inc."
    },
    {
      quote: "Finally, an HR system that's powerful enough for enterprise but intuitive enough for everyone to use.",
      author: "Michael Torres",
      role: "Chief Human Resources Officer",
      company: "GlobalServe Corp."
    },
    {
      quote: "The analytics and reporting capabilities give us insights we never had before. Game changer.",
      author: "Emily Watson",
      role: "HR Director",
      company: "InnovateCo"
    }
  ];

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
            <Link to="/features" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
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

      {/* Hero Section */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-primary/5" />
        <div className="container mx-auto px-4 py-24 lg:py-32 relative">
          <div className="max-w-5xl mx-auto text-center space-y-8">
            <Badge variant="secondary" className="px-4 py-1.5 text-sm font-medium">
              <Building2 className="h-3.5 w-3.5 mr-2" />
              Enterprise-Grade HR Platform
            </Badge>
            
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight leading-relaxed">
              The Complete HR Platform for{" "}
              <span className="text-primary">Modern Enterprises</span>
            </h1>
            
            <p className="text-lg md:text-xl text-muted-foreground max-w-3xl mx-auto leading-relaxed">
              Streamline your entire HR operations with our comprehensive platform. 
              From recruitment to retirement, manage your workforce with enterprise-grade 
              security, powerful automation, and actionable insights.
            </p>
            
            <div className="flex flex-col sm:flex-row gap-4 justify-center pt-4">
              {isProduction ? (
                <>
                  <Link to="/auth">
                    <Button size="lg" className="gap-2 px-8 h-12 text-base">
                      Start Free Trial <ArrowRight className="h-4 w-4" />
                    </Button>
                  </Link>
                  <a href="https://cal.com/littlemissbot/business-consultancy" target="_blank" rel="noopener noreferrer">
                    <Button size="lg" variant="outline" className="gap-2 px-8 h-12 text-base">
                      Schedule Demo
                    </Button>
                  </a>
                </>
              ) : (
                <Link to="/auth">
                  <Button size="lg" className="gap-2 px-8 h-12 text-base">
                    Sign In <ArrowRight className="h-4 w-4" />
                  </Button>
                </Link>
              )}
            </div>

            {isProduction && (
              <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-4 pt-8 text-sm text-muted-foreground">
                <div className="flex items-center gap-2">
                  <CheckCircle className="h-4 w-4 text-primary" />
                  <span>No credit card required</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle className="h-4 w-4 text-primary" />
                  <span>14-day free trial</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle className="h-4 w-4 text-primary" />
                  <span>Cancel anytime</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Stats Section */}
      <section className="border-y bg-muted/30">
        <div className="container mx-auto px-4 py-12">
          <div className="grid grid-cols-3 gap-8 max-w-3xl mx-auto">
            {stats.map((stat, index) => (
              <div key={index} className="text-center">
                <div className="flex items-center justify-center gap-2 mb-2">
                  <span className="text-primary">{stat.icon}</span>
                  <span className="text-3xl md:text-4xl font-bold">{stat.value}</span>
                </div>
                <div className="text-sm text-muted-foreground font-medium">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features Grid */}
      <section className="container mx-auto px-4 py-24">
        <div className="text-center max-w-3xl mx-auto mb-16">
          <Badge variant="outline" className="mb-4">Features</Badge>
          <h2 className="text-3xl md:text-4xl font-bold mb-4">
            Everything You Need to Manage Your Workforce
          </h2>
          <p className="text-lg text-muted-foreground">
            A unified platform that brings together all your HR processes, 
            eliminating silos and improving efficiency across the organization.
          </p>
        </div>
        
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map((feature, index) => (
            <Card 
              key={index}
              className="group hover:shadow-lg transition-all duration-300 hover:border-primary/50"
            >
              <CardContent className="p-6">
                <div className="h-12 w-12 rounded-lg bg-primary/10 text-primary flex items-center justify-center mb-4 group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                  {feature.icon}
                </div>
                <h3 className="text-lg font-semibold mb-2">{feature.title}</h3>
                <p className="text-muted-foreground text-sm leading-relaxed">{feature.description}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* Benefits Section */}
      <section className="bg-muted/30 py-24">
        <div className="container mx-auto px-4">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <div>
              <Badge variant="outline" className="mb-4">Why Mas Callnet HRMS</Badge>
              <h2 className="text-3xl md:text-4xl font-bold mb-6">
                Built for Scale, Designed for Simplicity
              </h2>
              <p className="text-lg text-muted-foreground mb-8">
                Whether you're a growing startup or a global enterprise, Mas Callnet HRMS adapts 
                to your needs with flexible workflows and powerful automation.
              </p>
              <ul className="space-y-4">
                {benefits.map((benefit, index) => (
                  <li key={index} className="flex items-start gap-3">
                    <div className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <CheckCircle className="h-4 w-4 text-primary" />
                    </div>
                    <span className="text-foreground">{benefit}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Card className="p-6 text-center">
                <TrendingUp className="h-8 w-8 text-primary mx-auto mb-3" />
                <div className="text-2xl font-bold mb-1">60%</div>
                <div className="text-sm text-muted-foreground">Less Admin Time</div>
              </Card>
              <Card className="p-6 text-center">
                <Clock className="h-8 w-8 text-primary mx-auto mb-3" />
                <div className="text-2xl font-bold mb-1">5 min</div>
                <div className="text-sm text-muted-foreground">Avg. Response Time</div>
              </Card>
              <Card className="p-6 text-center">
                <Globe className="h-8 w-8 text-primary mx-auto mb-3" />
                <div className="text-2xl font-bold mb-1">50+</div>
                <div className="text-sm text-muted-foreground">Countries Supported</div>
              </Card>
              <Card className="p-6 text-center">
                <Award className="h-8 w-8 text-primary mx-auto mb-3" />
                <div className="text-2xl font-bold mb-1">4.9/5</div>
                <div className="text-sm text-muted-foreground">Customer Rating</div>
              </Card>
            </div>
          </div>
        </div>
      </section>

      {/* Testimonials */}
      <section className="container mx-auto px-4 py-24">
        <div className="text-center max-w-3xl mx-auto mb-16">
          <Badge variant="outline" className="mb-4">Testimonials</Badge>
          <h2 className="text-3xl md:text-4xl font-bold mb-4">
            Trusted by HR Leaders Worldwide
          </h2>
          <p className="text-lg text-muted-foreground">
            See how companies are transforming their HR operations with Mas Callnet HRMS.
          </p>
        </div>
        
        <div className="grid md:grid-cols-3 gap-6">
          {testimonials.map((testimonial, index) => (
            <Card key={index} className="p-6">
              <CardContent className="p-0">
                <p className="text-muted-foreground mb-6 italic">"{testimonial.quote}"</p>
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                    <span className="text-sm font-semibold text-primary">
                      {testimonial.author.split(' ').map(n => n[0]).join('')}
                    </span>
                  </div>
                  <div>
                    <div className="font-semibold text-sm">{testimonial.author}</div>
                    <div className="text-xs text-muted-foreground">{testimonial.role}</div>
                    <div className="text-xs text-muted-foreground">{testimonial.company}</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
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
              {isProduction ? (
                <>
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
                </>
              ) : (
                <Link to="/auth">
                  <Button size="lg" variant="secondary" className="gap-2 px-8 h-12">
                    Sign In <ArrowRight className="h-4 w-4" />
                  </Button>
                </Link>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <Footer />
    </div>
  );
};

export default Landing;
