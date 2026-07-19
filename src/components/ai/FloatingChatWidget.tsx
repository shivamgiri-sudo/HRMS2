import { useState, useRef, useEffect } from "react";
import { useLocation } from "react-router-dom";
import { Loader2, MessageCircle, Send, Sparkles, X, AlertTriangle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/contexts/AuthContext";
import { hrmsApi } from "@/lib/hrmsApi";
import { cn } from "@/lib/utils";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  provider?: string;
  fallbackUsed?: boolean;
  insights?: Array<{
    key: string;
    label: string;
    count?: number;
    severity?: "low" | "medium" | "high" | "critical";
  }>;
  actions?: Array<{
    key: string;
    label: string;
    url: string;
    priority: "low" | "medium" | "high" | "critical";
  }>;
}

const WELCOME_MESSAGE: Message = {
  id: "welcome",
  role: "assistant",
  content: "Hi! I'm your PeopleOS Copilot. Ask me anything about employees, attendance, payroll, recruitment, or any HR data. I can help you find information quickly.",
  timestamp: new Date(),
};

const SUGGESTED_PROMPTS = [
  "What are my top risks today?",
  "Which employees need attention?",
  "Show me pending actions",
];

export function FloatingChatWidget() {
  const { user } = useAuth();
  const location = useLocation();
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([WELCOME_MESSAGE]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Hide on public pages or standalone copilot page
  const hiddenPaths = ["/login", "/register", "/forgot-password", "/peopleos/copilot", "/candidate-form"];
  const shouldHide = !user || hiddenPaths.some((p) => location.pathname.startsWith(p));

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  if (shouldHide) return null;

  const sendMessage = async (text?: string) => {
    const question = text ?? input.trim();
    if (!question || loading) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: question,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setLoading(true);

    try {
      const res = await hrmsApi.post<{ success: boolean; data: any; error?: string }>("/api/ai/ask", {
        question,
        context_type: "generic",
      });

      if (res.success && res.data) {
        const data = res.data;
        const assistantMessage: Message = {
          id: (Date.now() + 1).toString(),
          role: "assistant",
          content: data.answer ?? "I couldn't generate a response. Please try again.",
          timestamp: new Date(),
          provider: data.provider,
          fallbackUsed: data.fallbackUsed,
          insights: data.insights,
          actions: data.actions,
        };
        setMessages((prev) => [...prev, assistantMessage]);
      } else {
        setMessages((prev) => [
          ...prev,
          {
            id: (Date.now() + 1).toString(),
            role: "assistant",
            content: res.error ?? "Something went wrong. Please try again.",
            timestamp: new Date(),
          },
        ]);
      }
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          role: "assistant",
          content: "Failed to connect to the AI service. Please check your connection and try again.",
          timestamp: new Date(),
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <>
      {/* Floating bubble button */}
      {!isOpen && (
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          className="fixed z-50 flex h-14 w-14 items-center justify-center rounded-full bg-[color:var(--brand-600)] text-white shadow-lg transition-all hover:bg-[color:var(--brand-700)] hover:scale-105 bottom-20 right-4 md:bottom-6 md:right-6"
          aria-label="Open AI assistant"
        >
          <MessageCircle className="h-6 w-6" />
        </button>
      )}

      {/* Chat panel */}
      {isOpen && (
        <div className="fixed z-50 flex flex-col rounded-2xl border border-slate-200 bg-white shadow-2xl bottom-20 right-4 md:bottom-6 md:right-6 w-[calc(100vw-2rem)] max-w-[400px] h-[min(500px,70vh)]">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 bg-gradient-to-r from-[color:var(--brand-600)] to-[color:var(--brand-500)] rounded-t-2xl">
            <div className="flex items-center gap-2 text-white">
              <Sparkles className="h-5 w-5" />
              <span className="font-semibold">PeopleOS Copilot</span>
            </div>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="rounded-full p-1 text-white/80 hover:bg-white/10 hover:text-white transition"
              aria-label="Close chat"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Messages */}
          <ScrollArea className="flex-1 p-4" ref={scrollRef}>
            <div className="space-y-4">
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={cn(
                    "flex flex-col gap-1",
                    msg.role === "user" ? "items-end" : "items-start"
                  )}
                >
                  <div
                    className={cn(
                      "max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
                      msg.role === "user"
                        ? "bg-[color:var(--brand-600)] text-white rounded-br-md"
                        : "bg-slate-100 text-slate-800 rounded-bl-md"
                    )}
                  >
                    {msg.content}
                  </div>

                  {/* Insights */}
                  {msg.insights && msg.insights.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5 max-w-[85%]">
                      {msg.insights.slice(0, 3).map((insight) => (
                        <Badge
                          key={insight.key}
                          variant="outline"
                          className={cn(
                            "text-xs",
                            insight.severity === "critical" && "border-red-300 bg-red-50 text-red-700",
                            insight.severity === "high" && "border-amber-300 bg-amber-50 text-amber-700",
                            insight.severity === "medium" && "border-blue-300 bg-blue-50 text-blue-700",
                            insight.severity === "low" && "border-slate-300 bg-slate-50 text-slate-600"
                          )}
                        >
                          {insight.severity === "critical" || insight.severity === "high" ? (
                            <AlertTriangle className="mr-1 h-3 w-3" />
                          ) : (
                            <CheckCircle2 className="mr-1 h-3 w-3" />
                          )}
                          {insight.label}
                          {insight.count !== undefined && ` (${insight.count})`}
                        </Badge>
                      ))}
                    </div>
                  )}

                  {/* Actions */}
                  {msg.actions && msg.actions.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5 max-w-[85%]">
                      {msg.actions.slice(0, 2).map((action) => (
                        <a
                          key={action.key}
                          href={action.url}
                          className="inline-flex items-center gap-1 rounded-lg bg-[color:var(--brand-50)] px-2.5 py-1 text-xs font-medium text-[color:var(--brand-700)] hover:bg-[color:var(--brand-100)] transition"
                        >
                          {action.label} →
                        </a>
                      ))}
                    </div>
                  )}

                  {/* Fallback indicator */}
                  {msg.fallbackUsed && (
                    <span className="text-[10px] text-slate-400 mt-1">
                      Using local insights
                    </span>
                  )}
                </div>
              ))}

              {/* Loading indicator */}
              {loading && (
                <div className="flex items-start">
                  <div className="rounded-2xl rounded-bl-md bg-slate-100 px-4 py-3">
                    <Loader2 className="h-4 w-4 animate-spin text-slate-500" />
                  </div>
                </div>
              )}
            </div>
          </ScrollArea>

          {/* Suggested prompts (only show if no user messages yet) */}
          {messages.length === 1 && (
            <div className="border-t border-slate-100 px-3 py-2">
              <div className="flex flex-wrap gap-1.5">
                {SUGGESTED_PROMPTS.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    onClick={() => sendMessage(prompt)}
                    className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-600 hover:bg-slate-100 hover:border-slate-300 transition"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Input */}
          <div className="border-t border-slate-100 p-3 flex gap-2">
            <Input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask anything..."
              className="rounded-xl border-slate-200 focus-visible:ring-[color:var(--brand-500)]"
              disabled={loading}
            />
            <Button
              type="button"
              onClick={() => sendMessage()}
              disabled={loading || !input.trim()}
              className="rounded-xl bg-[color:var(--brand-600)] hover:bg-[color:var(--brand-700)] px-3"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
