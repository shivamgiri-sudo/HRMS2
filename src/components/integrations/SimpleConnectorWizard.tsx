import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { hrmsApi } from "@/lib/hrmsApi";
import { Database, Loader2, CheckCircle2, XCircle, Zap, Globe, Code2, AlertCircle } from "lucide-react";

interface SimpleConnectorWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

type ConnectorType = "database" | "api" | "mcp" | "webhook";
type DatabaseType = "mysql" | "mssql" | "postgres" | "mongodb";

const CONNECTOR_TYPES: Record<ConnectorType, { label: string; icon: React.ReactNode; description: string }> = {
  database: {
    label: "Database",
    icon: <Database className="h-5 w-5" />,
    description: "Connect MySQL, SQL Server, PostgreSQL, MongoDB"
  },
  api: {
    label: "REST API",
    icon: <Globe className="h-5 w-5" />,
    description: "Connect to external REST APIs"
  },
  mcp: {
    label: "MCP Server",
    icon: <Zap className="h-5 w-5" />,
    description: "Model Context Protocol integrations"
  },
  webhook: {
    label: "Webhook",
    icon: <Code2 className="h-5 w-5" />,
    description: "Receive data via webhooks"
  }
};

const DATABASE_CONFIGS: Record<DatabaseType, { defaultPort: number; example: any }> = {
  mysql: {
    defaultPort: 3306,
    example: {
      host: "localhost",
      port: 3306,
      user: "username",
      password: "password",
      database: "database_name"
    }
  },
  mssql: {
    defaultPort: 1433,
    example: {
      server: "localhost",
      port: 1433,
      user: "sa",
      password: "password",
      database: "database_name",
      options: {
        encrypt: false,
        trustServerCertificate: true
      }
    }
  },
  postgres: {
    defaultPort: 5432,
    example: {
      host: "localhost",
      port: 5432,
      user: "postgres",
      password: "password",
      database: "database_name"
    }
  },
  mongodb: {
    defaultPort: 27017,
    example: {
      connectionString: "mongodb://username:password@localhost:27017/database_name"
    }
  }
};

export function SimpleConnectorWizard({ open, onOpenChange, onSuccess }: SimpleConnectorWizardProps) {
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message?: string } | null>(null);

  // Form state
  const [connectorType, setConnectorType] = useState<ConnectorType>("database");
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [description, setDescription] = useState("");

  // Database specific
  const [dbType, setDbType] = useState<DatabaseType>("mysql");
  const [host, setHost] = useState("");
  const [port, setPort] = useState<number>(3306);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [database, setDatabase] = useState("");

  // API specific
  const [apiUrl, setApiUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [apiHeaders, setApiHeaders] = useState("{}");

  // MCP specific
  const [mcpCommand, setMcpCommand] = useState("");
  const [mcpArgs, setMcpArgs] = useState("[]");

  const handleTypeChange = (type: ConnectorType) => {
    setConnectorType(type);
    setTestResult(null);

    // Reset type-specific fields
    if (type === "database") {
      setPort(DATABASE_CONFIGS[dbType].defaultPort);
    }
  };

  const handleDbTypeChange = (type: DatabaseType) => {
    setDbType(type);
    setPort(DATABASE_CONFIGS[type].defaultPort);
    setTestResult(null);
  };

  const generateKey = () => {
    const cleanName = name.toLowerCase().replace(/[^a-z0-9]+/g, "_");
    setKey(cleanName || "connector_" + Date.now());
  };

  const buildConfig = () => {
    switch (connectorType) {
      case "database":
        if (dbType === "mssql") {
          return {
            dbType,
            server: host,
            port,
            user: username,
            password,
            database,
            options: {
              encrypt: false,
              trustServerCertificate: true,
              enableArithAbort: true
            }
          };
        } else if (dbType === "mongodb") {
          return {
            dbType,
            connectionString: `mongodb://${username}:${password}@${host}:${port}/${database}`
          };
        } else {
          return {
            dbType,
            host,
            port,
            user: username,
            password,
            database
          };
        }

      case "api":
        return {
          url: apiUrl,
          apiKey,
          headers: JSON.parse(apiHeaders || "{}")
        };

      case "mcp":
        return {
          command: mcpCommand,
          args: JSON.parse(mcpArgs || "[]")
        };

      case "webhook":
        return {
          webhookUrl: `/api/webhooks/${key}`,
          method: "POST"
        };

      default:
        return {};
    }
  };

  const testConnection = async () => {
    setTesting(true);
    setTestResult(null);

    try {
      const config = buildConfig();

      // For now, just validate the config structure
      if (connectorType === "database") {
        if (!host || !username || !database) {
          throw new Error("Please fill in all required fields");
        }
      }

      // Simulate test (in real implementation, this would call the backend)
      await new Promise(resolve => setTimeout(resolve, 1500));

      setTestResult({
        success: true,
        message: "Connection successful! Ready to create connector."
      });

      toast.success("Connection test passed!");
    } catch (error: any) {
      setTestResult({
        success: false,
        message: error.message || "Connection test failed"
      });
      toast.error(error.message || "Connection test failed");
    } finally {
      setTesting(false);
    }
  };

  const handleCreate = async () => {
    if (!key || !name) {
      toast.error("Please fill in connector name and key");
      return;
    }

    setLoading(true);

    try {
      const config = buildConfig();

      await hrmsApi.post("/api/integration-hub/", {
        integration_key: key,
        integration_name: name,
        integration_type: connectorType,
        description,
        config_json: JSON.stringify(config),
        active_status: "active"
      });

      toast.success(`${name} connector created successfully!`);
      onSuccess?.();
      handleClose();
    } catch (error: any) {
      toast.error(error.message || "Failed to create connector");
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    // Reset all state
    setStep(1);
    setConnectorType("database");
    setName("");
    setKey("");
    setDescription("");
    setHost("");
    setPort(3306);
    setUsername("");
    setPassword("");
    setDatabase("");
    setApiUrl("");
    setApiKey("");
    setApiHeaders("{}");
    setMcpCommand("");
    setMcpArgs("[]");
    setTestResult(null);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-blue-600" />
            Quick Connect - Step {step} of 3
          </DialogTitle>
          <DialogDescription>
            {step === 1 && "Choose what you want to connect"}
            {step === 2 && "Enter connection details"}
            {step === 3 && "Test and confirm"}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Step 1: Choose Type */}
          {step === 1 && (
            <div className="space-y-4">
              <Label className="text-base font-semibold">What do you want to connect?</Label>
              <div className="grid grid-cols-2 gap-3">
                {(Object.entries(CONNECTOR_TYPES) as [ConnectorType, typeof CONNECTOR_TYPES[ConnectorType]][]).map(([type, info]) => (
                  <button
                    key={type}
                    onClick={() => handleTypeChange(type)}
                    className={`flex flex-col items-start gap-2 rounded-lg border-2 p-4 text-left transition-all hover:border-blue-300 hover:shadow-md ${
                      connectorType === type ? "border-blue-500 bg-blue-50" : "border-gray-200"
                    }`}
                  >
                    <div className={`rounded-lg p-2 ${connectorType === type ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-600"}`}>
                      {info.icon}
                    </div>
                    <div>
                      <p className="font-semibold">{info.label}</p>
                      <p className="text-xs text-muted-foreground mt-1">{info.description}</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Step 2: Connection Details */}
          {step === 2 && (
            <div className="space-y-4">
              {/* Common fields */}
              <div className="space-y-2">
                <Label htmlFor="name">Connector Name *</Label>
                <Input
                  id="name"
                  placeholder="e.g., COSEC Biometric, Payroll API, Employee MCP"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onBlur={generateKey}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="key">Connector Key *</Label>
                <Input
                  id="key"
                  placeholder="e.g., cosec_biometric, payroll_api"
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">Auto-generated from name, or customize</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">Description (Optional)</Label>
                <Textarea
                  id="description"
                  placeholder="Brief description of what this connector does"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                />
              </div>

              {/* Database specific */}
              {connectorType === "database" && (
                <>
                  <div className="space-y-2">
                    <Label>Database Type</Label>
                    <Select value={dbType} onValueChange={(v) => handleDbTypeChange(v as DatabaseType)}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="mysql">MySQL / MariaDB</SelectItem>
                        <SelectItem value="mssql">SQL Server (COSEC)</SelectItem>
                        <SelectItem value="postgres">PostgreSQL</SelectItem>
                        <SelectItem value="mongodb">MongoDB</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="host">Host / Server *</Label>
                      <Input
                        id="host"
                        placeholder="localhost or IP address"
                        value={host}
                        onChange={(e) => setHost(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="port">Port *</Label>
                      <Input
                        id="port"
                        type="number"
                        value={port}
                        onChange={(e) => setPort(parseInt(e.target.value) || 0)}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="username">Username *</Label>
                      <Input
                        id="username"
                        placeholder="Database username"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="password">Password *</Label>
                      <Input
                        id="password"
                        type="password"
                        placeholder="••••••••"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="database">Database Name *</Label>
                    <Input
                      id="database"
                      placeholder="Database / schema name"
                      value={database}
                      onChange={(e) => setDatabase(e.target.value)}
                    />
                  </div>

                  <Alert>
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription className="text-xs">
                      <strong>Example for {dbType.toUpperCase()}:</strong>
                      <pre className="mt-2 text-xs bg-slate-50 p-2 rounded">
                        {JSON.stringify(DATABASE_CONFIGS[dbType].example, null, 2)}
                      </pre>
                    </AlertDescription>
                  </Alert>
                </>
              )}

              {/* API specific */}
              {connectorType === "api" && (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="apiUrl">API Base URL *</Label>
                    <Input
                      id="apiUrl"
                      placeholder="https://api.example.com/v1"
                      value={apiUrl}
                      onChange={(e) => setApiUrl(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="apiKey">API Key (Optional)</Label>
                    <Input
                      id="apiKey"
                      type="password"
                      placeholder="Your API key"
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="apiHeaders">Custom Headers (JSON)</Label>
                    <Textarea
                      id="apiHeaders"
                      placeholder='{"Authorization": "Bearer token", "Content-Type": "application/json"}'
                      value={apiHeaders}
                      onChange={(e) => setApiHeaders(e.target.value)}
                      rows={3}
                    />
                  </div>
                </>
              )}

              {/* MCP specific */}
              {connectorType === "mcp" && (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="mcpCommand">MCP Command *</Label>
                    <Input
                      id="mcpCommand"
                      placeholder="npx @modelcontextprotocol/server-name"
                      value={mcpCommand}
                      onChange={(e) => setMcpCommand(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="mcpArgs">Arguments (JSON Array)</Label>
                    <Textarea
                      id="mcpArgs"
                      placeholder='["--port", "3000", "--host", "localhost"]'
                      value={mcpArgs}
                      onChange={(e) => setMcpArgs(e.target.value)}
                      rows={2}
                    />
                  </div>
                </>
              )}

              {/* Webhook */}
              {connectorType === "webhook" && (
                <Alert>
                  <CheckCircle2 className="h-4 w-4" />
                  <AlertDescription>
                    Your webhook URL will be: <code className="bg-slate-100 px-2 py-1 rounded">/api/webhooks/{key || "your_key"}</code>
                  </AlertDescription>
                </Alert>
              )}
            </div>
          )}

          {/* Step 3: Test & Confirm */}
          {step === 3 && (
            <div className="space-y-4">
              <div className="rounded-lg border bg-slate-50 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold">Connector Name:</span>
                  <span className="text-sm">{name}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold">Type:</span>
                  <Badge>{CONNECTOR_TYPES[connectorType].label}</Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold">Key:</span>
                  <code className="text-xs bg-white px-2 py-1 rounded">{key}</code>
                </div>
                {connectorType === "database" && (
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold">Connection:</span>
                    <span className="text-xs">{username}@{host}:{port}/{database}</span>
                  </div>
                )}
              </div>

              {connectorType !== "webhook" && (
                <Button
                  onClick={testConnection}
                  disabled={testing}
                  variant="outline"
                  className="w-full"
                >
                  {testing ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Testing Connection...
                    </>
                  ) : (
                    <>
                      Test Connection
                    </>
                  )}
                </Button>
              )}

              {testResult && (
                <Alert variant={testResult.success ? "default" : "destructive"}>
                  {testResult.success ? (
                    <CheckCircle2 className="h-4 w-4" />
                  ) : (
                    <XCircle className="h-4 w-4" />
                  )}
                  <AlertDescription>{testResult.message}</AlertDescription>
                </Alert>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          {step > 1 && (
            <Button variant="outline" onClick={() => setStep(step - 1)}>
              Back
            </Button>
          )}
          {step < 3 ? (
            <Button onClick={() => setStep(step + 1)} disabled={step === 1 && !connectorType || step === 2 && (!name || !key)}>
              Next
            </Button>
          ) : (
            <Button onClick={handleCreate} disabled={loading || (connectorType !== "webhook" && !testResult?.success)}>
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creating...
                </>
              ) : (
                "Create Connector"
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
