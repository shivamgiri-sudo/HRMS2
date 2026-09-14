import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Shield, Lock, Server, Eye, CheckCircle, AlertTriangle, Key, RefreshCw } from "lucide-react";
import hrHubLogo from "@/assets/brand/mcn-logo.png";
import Footer from "@/components/layout/Footer";
import { isProductionDomain } from "@/lib/domain";

const Security = () => {
  const securityFeatures = [
    {
      icon: Lock,
      title: "Encryption",
      description: "All data is encrypted at rest and in transit using industry-standard AES-256 encryption and TLS 1.3 protocols."
    },
    {
      icon: Server,
      title: "Secure Infrastructure",
      description: "Our infrastructure is hosted on enterprise-grade cloud platforms with SOC 2 Type II certification and 99.9% uptime SLA."
    },
    {
      icon: Key,
      title: "Access Controls",
      description: "Role-based access controls, multi-factor authentication, and single sign-on (SSO) to protect your accounts."
    },
    {
      icon: Eye,
      title: "Monitoring & Logging",
      description: "24/7 security monitoring with comprehensive audit logs and real-time threat detection systems."
    },
    {
      icon: RefreshCw,
      title: "Regular Backups",
      description: "Automated daily backups with point-in-time recovery and geo-redundant storage across multiple regions."
    },
    {
      icon: AlertTriangle,
      title: "Incident Response",
      description: "Dedicated security team with established incident response procedures and communication protocols."
    }
  ];

  const certifications = [
    "SOC 2 Type II Compliant",
    "GDPR Compliant",
    "ISO 27001 Standards",
    "CCPA Compliant",
    "HIPAA Ready",
    "PCI DSS Standards"
  ];

  const securityPractices = [
    {
      title: "Vulnerability Management",
      items: [
        "Regular security assessments and penetration testing",
        "Automated vulnerability scanning of all systems",
        "Responsible disclosure program for security researchers",
        "Timely patching and updates of all software components"
      ]
    },
    {
      title: "Employee Security",
      items: [
        "Background checks for all employees",
        "Regular security awareness training",
        "Strict access controls based on role and need",
        "Secure development practices and code reviews"
      ]
    },
    {
      title: "Data Protection",
      items: [
        "Data minimization and purpose limitation",
        "Secure data deletion upon request",
        "Data processing agreements with all vendors",
        "Regular data protection impact assessments"
      ]
    },
    {
      title: "Business Continuity",
      items: [
        "Disaster recovery plans and procedures",
        "Regular backup testing and validation",
        "Multi-region availability options",
        "Incident communication procedures"
      ]
    }
  ];

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
            <Link to="/features" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">Features</Link>
            <Link to="/how-it-works" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">How It Works</Link>
            <Link to="/pricing" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">Pricing</Link>
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
      <section className="py-20 md:py-28">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 text-primary text-sm font-medium mb-6">
            <Shield className="h-4 w-4" />
            Enterprise-Grade Security
          </div>
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight mb-6">
            Security You Can Trust
          </h1>
          <p className="text-lg md:text-xl text-muted-foreground max-w-3xl mx-auto">
            We take the security of your data seriously. Learn about the measures we take to protect your information.
          </p>
        </div>
      </section>

      {/* Security Features Grid */}
      <section className="py-16">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold mb-4">Security Features</h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              Our platform is built with security at its core, implementing multiple layers of protection.
            </p>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-6xl mx-auto">
            {securityFeatures.map((feature, index) => (
              <Card key={index} className="h-full hover:shadow-lg transition-shadow">
                <CardContent className="p-6">
                  <div className="p-3 rounded-xl bg-primary/10 text-primary w-fit mb-4">
                    <feature.icon className="h-6 w-6" />
                  </div>
                  <h3 className="text-lg font-semibold mb-2">{feature.title}</h3>
                  <p className="text-muted-foreground text-sm">{feature.description}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Certifications */}
      <section className="py-16 bg-muted/30">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold mb-4">Compliance & Certifications</h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              We maintain compliance with industry standards and regulations to ensure your data is protected.
            </p>
          </div>
          <div className="flex flex-wrap justify-center gap-4 max-w-4xl mx-auto">
            {certifications.map((cert, index) => (
              <div key={index} className="flex items-center gap-2 px-4 py-3 bg-background rounded-lg border">
                <CheckCircle className="h-5 w-5 text-primary" />
                <span className="font-medium">{cert}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Security Practices */}
      <section className="py-16">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold mb-4">Our Security Practices</h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              We follow industry best practices and continuously improve our security posture.
            </p>
          </div>
          <div className="grid md:grid-cols-2 gap-8 max-w-5xl mx-auto">
            {securityPractices.map((practice, index) => (
              <Card key={index}>
                <CardContent className="p-6">
                  <h3 className="text-lg font-semibold mb-4">{practice.title}</h3>
                  <ul className="space-y-3">
                    {practice.items.map((item, itemIndex) => (
                      <li key={itemIndex} className="flex items-start gap-3 text-muted-foreground">
                        <CheckCircle className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Report Security Issue */}
      <section className="py-16">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <Card className="max-w-3xl mx-auto">
            <CardContent className="p-8 text-center">
              <AlertTriangle className="h-12 w-12 text-primary mx-auto mb-4" />
              <h2 className="text-2xl font-bold mb-4">Report a Security Issue</h2>
              <p className="text-muted-foreground mb-6">
                If you believe you have found a security vulnerability in our service, please report it to us 
                responsibly. We appreciate your help in keeping our platform and users safe.
              </p>
              <Button asChild>
                <a href="#" target="_blank" rel="noopener noreferrer">
                  Contact Security Team
                </a>
              </Button>
            </CardContent>
          </Card>
        </div>
      </section>

      <Footer />
    </div>
  );
};

export default Security;
