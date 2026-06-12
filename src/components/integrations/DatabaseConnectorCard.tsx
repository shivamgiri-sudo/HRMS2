// src/components/integrations/DatabaseConnectorCard.tsx
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Database, Zap, Settings } from 'lucide-react';

export interface DbConnectorConfig {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  date_column: string;
  employee_code_column: string;
  tables: string[];
  db_type: 'mssql' | 'mysql';
}

export interface DatabaseConnectorCardProps {
  integrationKey: string;
  name: string;
  config: DbConnectorConfig;
  activeStatus: number;
  testOk: boolean | null;
  testError: string | null;
  testAt: string | null;
  onConfigure: () => void;
  onTest: () => void;
  isTesting: boolean;
}

export function DatabaseConnectorCard({
  name,
  config,
  activeStatus,
  testOk,
  testError,
  testAt,
  onConfigure,
  onTest,
  isTesting,
}: DatabaseConnectorCardProps) {
  const isConfigured = !!config.host;

  return (
    <Card className="border-2 border-primary/30 bg-card">
      <CardHeader className="pb-2">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-primary/10 p-2">
            <Database className="h-5 w-5 text-primary" />
          </div>
          <div className="flex-1">
            <p className="font-semibold text-sm">{name}</p>
            <p className="text-xs text-muted-foreground">
              {config.db_type.toUpperCase()} · Database
            </p>
          </div>
          <Badge variant={isConfigured && activeStatus ? 'default' : 'destructive'}>
            {isConfigured && activeStatus ? 'Active' : 'Not configured'}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {isConfigured && (
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="rounded bg-muted p-2">
              <p className="text-muted-foreground">HOST</p>
              <p className="font-mono truncate">{config.host}</p>
            </div>
            <div className="rounded bg-muted p-2">
              <p className="text-muted-foreground">PORT</p>
              <p className="font-mono">{config.port}</p>
            </div>
            <div className="rounded bg-muted p-2">
              <p className="text-muted-foreground">DATABASE</p>
              <p className="font-mono truncate">{config.database}</p>
            </div>
            <div className="rounded bg-muted p-2">
              <p className="text-muted-foreground">PASSWORD</p>
              <p className="font-mono">••••••••</p>
            </div>
          </div>
        )}

        {testAt && (
          <div className={`rounded p-2 text-xs flex items-center gap-2 ${testOk ? 'bg-green-950 text-green-400' : 'bg-red-950 text-red-400'}`}>
            <span>{testOk ? '✓' : '✗'}</span>
            <span>{testOk ? 'Connection successful' : testError ?? 'Connection failed'}</span>
          </div>
        )}

        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            onClick={onTest}
            disabled={!isConfigured || isTesting}
          >
            <Zap className="mr-1 h-3 w-3" />
            {isTesting ? 'Testing…' : 'Test'}
          </Button>
          <Button size="sm" className="flex-1" onClick={onConfigure}>
            <Settings className="mr-1 h-3 w-3" />
            Configure
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
