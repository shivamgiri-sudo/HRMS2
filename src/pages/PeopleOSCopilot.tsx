import { useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Send, Sparkles, Shield, TrendingUp, AlertTriangle, Clock, CheckCircle2 } from 'lucide-react';
import { hrmsApi } from '@/lib/hrmsApi';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  provider?: string;
  model?: string;
  fallbackUsed?: boolean;
  dataConfidence?: Record<string, number>;
  sourceContexts?: string[];
  insights?: Array<{
    key: string;
    label: string;
    count?: number;
    severity?: 'low' | 'medium' | 'high' | 'critical';
  }>;
  actions?: Array<{
    key: string;
    label: string;
    url: string;
    priority: 'low' | 'medium' | 'high' | 'critical';
  }>;
}

const ROLE_PROMPTS: Record<string, string[]> = {
  ceo: [
    "What are my top risks today?",
    "Which branch has the highest people risk?",
    "Which process is blocking payroll?",
    "Show me the top 10 actions",
  ],
  admin: [
    "What are my top risks today?",
    "Which employees need HR attention?",
    "Show me critical action items",
  ],
  hr: [
    "Which employees need HR attention?",
    "Which onboarding cases are stuck?",
    "Which documents are missing?",
    "Which DPDP withdrawal requests are pending?",
  ],
  payroll: [
    "Why is payroll blocked?",
    "Which employees are not payroll-ready?",
    "Which employees require leave reversal?",
  ],
  wfm: [
    "Where is tomorrow's shortage?",
    "Which roster has conflict?",
    "Which employees have repeated late marks?",
  ],
  recruiter: [
    "Who should I call first?",
    "Which source is giving best walk-ins?",
    "Which candidates are stuck in onboarding?",
  ],
  employee: [
    "Why was my attendance marked absent?",
    "Which documents are pending?",
    "What actions are pending from my side?",
  ],
};

export default function PeopleOSCopilot() {
  const { toast } = useToast();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [activeProvider, setActiveProvider] = useState<string>('rule-based');
  const [userRole, setUserRole] = useState<string>('employee');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadActiveProvider();
    loadUserRole();
  }, []);

  useEffect(() => {
    // Auto-scroll to bottom on new messages
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const loadActiveProvider = async () => {
    try {
      const res = await hrmsApi.get<{ success: boolean; data: { providerKey: string } }>('/api/ai/providers/active');
      if (res.success && res.data) {
        setActiveProvider(res.data.providerKey);
      }
    } catch (error) {
      console.error('Failed to load active provider:', error);
    }
  };

  const loadUserRole = () => {
    // Get user role from auth context or local storage
    // For now, fallback to employee
    setUserRole('employee');
  };

  const sendMessage = async () => {
    if (!input.trim() || loading) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input.trim(),
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setLoading(true);

    try {
      const res = await hrmsApi.post<{ success: boolean; data: any }>('/api/ai/ask', {
        question: userMessage.content,
        context_type: 'generic',
      });

      if (res.success && res.data) {
        const data = res.data;
        const assistantMessage: Message = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: data.answer,
          timestamp: new Date(),
          provider: data.provider,
          model: data.model,
          fallbackUsed: data.fallbackUsed,
          dataConfidence: data.dataConfidence,
          sourceContexts: data.sourceContexts,
          insights: data.insights,
          actions: data.actions,
        };

        setMessages((prev) => [...prev, assistantMessage]);
      } else {
        throw new Error('Invalid response from AI');
      }
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to get AI response',
        variant: 'destructive',
      });

      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: 'I apologize, but I encountered an error processing your request. Please try again or rephrase your question.',
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setLoading(false);
    }
  };

  const useSuggestedPrompt = (prompt: string) => {
    setInput(prompt);
  };

  const getSeverityColor = (severity?: string) => {
    switch (severity) {
      case 'critical': return 'bg-red-500';
      case 'high': return 'bg-orange-500';
      case 'medium': return 'bg-yellow-500';
      case 'low': return 'bg-blue-500';
      default: return 'bg-gray-500';
    }
  };

  const getPriorityColor = (priority?: string) => {
    switch (priority) {
      case 'critical': return 'destructive';
      case 'high': return 'default';
      case 'medium': return 'secondary';
      case 'low': return 'outline';
      default: return 'outline';
    }
  };

  const suggestedPrompts = ROLE_PROMPTS[userRole] || ROLE_PROMPTS.employee;

  return (
    <div className="container mx-auto p-4 max-w-6xl h-[calc(100vh-4rem)]">
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="mb-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold flex items-center gap-2">
                <Sparkles className="h-8 w-8 text-blue-500" />
                PeopleOS Copilot
              </h1>
              <p className="text-muted-foreground">AI-powered insights and recommendations</p>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="flex items-center gap-1">
                <Shield className="h-3 w-3" />
                Safe Mode
              </Badge>
              <Badge variant={activeProvider === 'gemini' ? 'default' : 'secondary'}>
                {activeProvider === 'gemini' ? 'Gemini AI' : activeProvider === 'rule-based' ? 'Rule-Based' : activeProvider}
              </Badge>
            </div>
          </div>
        </div>

        {/* Suggested Prompts */}
        {messages.length === 0 && (
          <div className="mb-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Suggested Questions</CardTitle>
                <CardDescription>Quick shortcuts for common questions</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {suggestedPrompts.map((prompt, idx) => (
                    <Button
                      key={idx}
                      variant="outline"
                      size="sm"
                      onClick={() => useSuggestedPrompt(prompt)}
                    >
                      {prompt}
                    </Button>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Chat Messages */}
        <Card className="flex-1 flex flex-col">
          <CardContent className="flex-1 p-0 flex flex-col">
            <ScrollArea className="flex-1 p-4" ref={scrollRef}>
              {messages.length === 0 ? (
                <div className="flex items-center justify-center h-full text-center text-muted-foreground">
                  <div>
                    <Sparkles className="h-12 w-12 mx-auto mb-4 text-blue-500" />
                    <p className="text-lg font-medium">Ask me anything about PeopleOS</p>
                    <p className="text-sm">I can help you with insights, risks, and action items</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  {messages.map((message) => (
                    <div
                      key={message.id}
                      className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                    >
                      <div
                        className={`max-w-[80%] rounded-lg p-4 ${
                          message.role === 'user'
                            ? 'bg-blue-500 text-white'
                            : 'bg-muted'
                        }`}
                      >
                        <div className="whitespace-pre-wrap">{message.content}</div>

                        {/* Insights */}
                        {message.insights && message.insights.length > 0 && (
                          <div className="mt-4 space-y-2">
                            <div className="text-sm font-medium flex items-center gap-1">
                              <TrendingUp className="h-4 w-4" />
                              Insights
                            </div>
                            {message.insights.map((insight, idx) => (
                              <div
                                key={idx}
                                className="flex items-center justify-between p-2 bg-background rounded border"
                              >
                                <div className="flex items-center gap-2">
                                  <div className={`w-2 h-2 rounded-full ${getSeverityColor(insight.severity)}`} />
                                  <span className="text-sm">{insight.label}</span>
                                </div>
                                {insight.count !== undefined && (
                                  <Badge variant="secondary">{insight.count}</Badge>
                                )}
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Actions */}
                        {message.actions && message.actions.length > 0 && (
                          <div className="mt-4 space-y-2">
                            <div className="text-sm font-medium flex items-center gap-1">
                              <CheckCircle2 className="h-4 w-4" />
                              Recommended Actions
                            </div>
                            {message.actions.map((action, idx) => (
                              <a
                                key={idx}
                                href={action.url}
                                className="block"
                              >
                                <Button
                                  variant={getPriorityColor(action.priority) as any}
                                  size="sm"
                                  className="w-full justify-start"
                                >
                                  {action.label}
                                </Button>
                              </a>
                            ))}
                          </div>
                        )}

                        {/* Metadata */}
                        {message.role === 'assistant' && (
                          <div className="mt-3 pt-3 border-t border-border/50 flex items-center gap-2 text-xs text-muted-foreground">
                            <Clock className="h-3 w-3" />
                            {message.timestamp.toLocaleTimeString()}
                            {message.provider && (
                              <>
                                <span>•</span>
                                <span>{message.provider}</span>
                              </>
                            )}
                            {message.fallbackUsed && (
                              <>
                                <span>•</span>
                                <Badge variant="secondary" className="text-xs">Fallback</Badge>
                              </>
                            )}
                            {message.sourceContexts && message.sourceContexts.length > 0 && (
                              <>
                                <span>•</span>
                                <span>Sources: {message.sourceContexts.join(', ')}</span>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}

                  {loading && (
                    <div className="flex justify-start">
                      <div className="max-w-[80%] rounded-lg p-4 bg-muted">
                        <Loader2 className="h-5 w-5 animate-spin" />
                      </div>
                    </div>
                  )}
                </div>
              )}
            </ScrollArea>

            {/* Input */}
            <div className="p-4 border-t">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  sendMessage();
                }}
                className="flex gap-2"
              >
                <Input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Ask me anything about PeopleOS..."
                  disabled={loading}
                  className="flex-1"
                />
                <Button type="submit" disabled={loading || !input.trim()}>
                  {loading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                </Button>
              </form>
              <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                <Shield className="h-3 w-3" />
                All responses are AI-generated and PII-protected. Data confidence scores included.
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
