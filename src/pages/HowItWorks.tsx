import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { 
  Download,
  Settings,
  Users,
  Rocket,
  ArrowRight,
  CheckCircle,
  Database,
  Server,
  Cloud,
  Sparkles
} from "lucide-react";
import hrHubLogo from "@/assets/brand/mcn-logo.png";
import Footer from "@/components/layout/Footer";
import { isProductionDomain } from "@/lib/domain";

const steps = [
  {
    number: "01",
    icon: <Download className="h-8 w-8" />,
    title: "Deploy or Sign Up",
    description: "Choose to self-host on your infrastructure or use our hosted solution. Either way, you're up and running in minutes.",
    details: [
      "One-click deployment to local Docker or cloud platforms",
      "Or sign up for our managed cloud option",
      "Full control over your data and infrastructure"
    ]
  },
  {
    number: "02",
    icon: <Settings className="h-8 w-8" />,
    title: "Configure Your Organization",
    description: "Set up your company structure, departments, leave policies, and customize settings to match your workflow.",
    details: [
      "Define departments and reporting structure",
      "Configure leave types and policies",
      "Set up payroll components and deductions"
    ]
  },
  {
    number: "03",
    icon: <Users className="h-8 w-8" />,
    title: "Add Your Team",
    description: "Import or add employees, assign roles and managers, and set up their profiles with all necessary information.",
    details: [
      "Bulk import employees via CSV",
      "Assign roles: Admin, HR, Manager, or Employee",
      "Set up employee profiles and documents"
    ]
  },
  {
    number: "04",
    icon: <Rocket className="h-8 w-8" />,
    title: "Start Managing",
    description: "Your team can now clock attendance, request leaves, track goals, and more. HR has full visibility and control.",
    details: [
      "Employees self-serve for common requests",
      "Managers approve and oversee their teams",
      "HR gets comprehensive dashboards and reports"
    ]
  }
];

const deployOptions = [
  {
    icon: <Server className="h-6 w-6" />,
    title: "Self-Hosted",
    description: "Deploy on your own servers with Docker or directly on any Node.js hosting."
  },
  {
    icon: <Cloud className="h-6 w-6" />,
    title: "Cloud Platforms",
    description: "One-click deploy to Render, AWS, or any cloud platform."
  },
  {
    icon: <Database className="h-6 w-6" />,
    title: "MySQL Backend",
    description: "Uses MySQL for database with JWT authentication — scalable and secure."
  }
];

const HowItWorks = () => {
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
            <Link to="/features" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
              Features
            </Link>
            <Link to="/how-it-works" className="text-sm font-medium text-foreground transition-colors">
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
              <Sparkles className="h-3.5 w-3.5 mr-2" />
              Simple Setup
            </Badge>
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight leading-relaxed">
              Get Started in{" "}
              <span className="text-primary">Four Simple Steps</span>
            </h1>
            <p className="text-lg md:text-xl text-muted-foreground max-w-3xl mx-auto leading-relaxed">
              No complex setup required. Get your HR system up and running quickly 
              with our streamlined onboarding process.
            </p>
          </div>
        </div>
      </section>

      {/* Steps Timeline */}
      <section className="py-20">
        <div className="container mx-auto px-4">
          <div className="max-w-5xl mx-auto">
            {steps.map((step, index) => (
              <div key={index} className="relative">
                {/* Timeline connector */}
                {index < steps.length - 1 && (
                  <div className="absolute left-8 top-24 w-0.5 h-full bg-gradient-to-b from-primary/50 to-primary/10 hidden md:block" />
                )}
                
                <div className={`flex flex-col md:flex-row gap-8 mb-16 ${index % 2 === 1 ? 'md:flex-row-reverse' : ''}`}>
                  {/* Step Number & Icon */}
                  <div className="flex-shrink-0 flex flex-col items-center md:items-start">
                    <div className="relative">
                      <div className="h-16 w-16 rounded-2xl bg-primary text-primary-foreground flex items-center justify-center font-bold text-2xl shadow-lg">
                        {step.number}
                      </div>
                      <div className="absolute -bottom-2 -right-2 h-10 w-10 rounded-xl bg-background border-2 border-primary/20 flex items-center justify-center text-primary">
                        {step.icon}
                      </div>
                    </div>
                  </div>
                  
                  {/* Content Card */}
                  <Card className={`flex-1 hover:shadow-lg transition-all duration-300 hover:border-primary/30 ${index % 2 === 1 ? 'md:text-right' : ''}`}>
                    <CardContent className="p-8">
                      <h3 className="text-2xl md:text-3xl font-bold mb-3">{step.title}</h3>
                      <p className="text-muted-foreground text-lg mb-6 leading-relaxed">
                        {step.description}
                      </p>
                      <ul className={`space-y-3 ${index % 2 === 1 ? 'md:flex md:flex-col md:items-end' : ''}`}>
                        {step.details.map((detail, detailIndex) => (
                          <li 
                            key={detailIndex} 
                            className={`flex items-center gap-3 ${index % 2 === 1 ? 'md:flex-row-reverse' : ''}`}
                          >
                            <div className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                              <CheckCircle className="h-4 w-4 text-primary" />
                            </div>
                            <span className="text-foreground">{detail}</span>
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Deployment Options */}
      <section className="bg-muted/30 py-20">
        <div className="container mx-auto px-4">
          <div className="text-center mb-12">
            <Badge variant="outline" className="mb-4">Deployment</Badge>
            <h2 className="text-3xl md:text-4xl font-bold mb-4">Flexible Deployment Options</h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Choose how you want to run Mas Callnet HRMS. Your data, your rules, your infrastructure.
            </p>
          </div>
          <div className="grid md:grid-cols-3 gap-6 max-w-4xl mx-auto">
            {deployOptions.map((option, index) => (
              <Card 
                key={index}
                className="text-center hover:shadow-lg transition-all duration-300 hover:border-primary/30"
              >
                <CardContent className="p-8">
                  <div className="h-14 w-14 rounded-2xl bg-primary/10 text-primary flex items-center justify-center mx-auto mb-5">
                    {option.icon}
                  </div>
                  <h3 className="font-semibold text-lg mb-3">{option.title}</h3>
                  <p className="text-muted-foreground">{option.description}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="bg-primary text-primary-foreground py-20">
        <div className="container mx-auto px-4 text-center">
          <div className="max-w-3xl mx-auto space-y-6">
            <h2 className="text-3xl md:text-4xl font-bold">
              Ready to Simplify Your HR?
            </h2>
            <p className="text-primary-foreground/80 text-lg">
              Start managing your workforce effectively today. 
              No credit card required for your free trial.
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

export default HowItWorks;
