import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  CheckCircle2,
  Clock3,
  Ear,
  EarOff,
  Loader2,
  Mic,
  MicOff,
  RotateCcw,
  Send,
  ShieldCheck,
  Sparkles,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { hrmsApi } from '@/lib/hrmsApi';
import { cn } from '@/lib/utils';
import { useMiraVoice } from '@/hooks/useMiraVoice';
import { MiraAvatar, type MiraMood } from '@/components/ai/MiraAvatar';

type Severity = 'low' | 'medium' | 'high' | 'critical';

interface AIResponse {
  answer: string;
  provider?: string;
  model?: string;
  generatedAt?: string;
  sourceContexts?: string[];
  dataConfidence?: Record<string, number>;
  insights?: Array<{ key: string; label: string; count?: number; severity?: Severity; value?: string | number }>;
  actions?: Array<{ key: string; label: string; url: string; priority?: Severity }>;
  pendingAction?: { type: string; summary: string; confirmLabel: string; cancelLabel: string };
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  response?: AIResponse;
}

interface MiraSession {
  assistant: { name: string; tagline: string; description: string };
  roleKeys: string[];
  prompts: string[];
  capabilities: {
    selfAccount: boolean;
    voiceInput: boolean;
    spokenReplies: boolean;
    crossEmployeePersonalData: boolean;
    executesActions?: boolean;
  };
}

const DEFAULT_PROMPTS = [
  'Give me my account summary',
  'Show my latest salary breakup',
  'How many leaves do I have left?',
  'Summarize my attendance this month',
  'What is my shift for the next 7 days?',
  'Which documents are pending verification?',
  'What actions are pending from my side?',
  'Show my loan or reimbursement status',
];

const SEVERITY_CLASS: Record<Severity, string> = {
  critical: 'border-red-200 bg-red-50 text-red-700',
  high: 'border-amber-200 bg-amber-50 text-amber-700',
  medium: 'border-blue-200 bg-blue-50 text-blue-700',
  low: 'border-emerald-200 bg-emerald-50 text-emerald-700',
};

function safeInternalUrl(url: string): boolean {
  try {
    const parsed = new URL(url, window.location.origin);
    return parsed.origin === window.location.origin && parsed.pathname.startsWith('/');
  } catch {
    return false;
  }
}

export default function PeopleOSCopilot() {
  const navigate = useNavigate();
  const [session, setSession] = useState<MiraSession | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [briefingLoaded, setBriefingLoaded] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const voice = useMiraVoice();

  useEffect(() => {
    void hrmsApi.get<{ success: boolean; data: MiraSession }>('/api/ai/session')
      .then((response) => setSession(response.data))
      .catch(() => setSession(null));
  }, []);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, loading]);

  useEffect(() => {
    if (briefingLoaded || messages.length > 0) return;
    setBriefingLoaded(true);

    // A greeting primed right after sign-in (AuthContext.tsx's primeMiraGreeting)
    // takes priority over the generic account briefing — it's both a warmer opening
    // and already carries the critical-updates preview, so there is no need to also
    // fetch /api/ai/briefing on top of it. Consumed once: removed from storage so a
    // "New chat" click later in the same tab falls back to the plain briefing.
    const storedGreeting = sessionStorage.getItem('mira_greeting');
    if (storedGreeting) {
      sessionStorage.removeItem('mira_greeting');
      try {
        const data = JSON.parse(storedGreeting) as {
          greeting?: string;
          updatesPreview?: Array<{ key: string; label: string }>;
        };
        if (data.greeting) {
          setMessages([{
            id: `${Date.now()}-greeting`,
            role: 'assistant',
            content: data.greeting,
            timestamp: new Date(),
            response: {
              answer: data.greeting,
              insights: (data.updatesPreview ?? []).map((update) => ({ key: update.key, label: update.label, severity: 'medium' as Severity })),
            },
          }]);
          return;
        }
      } catch {
        // Malformed/stale value — fall through to the normal briefing fetch below.
      }
    }

    void hrmsApi.get<{ success: boolean; data: AIResponse }>('/api/ai/briefing')
      .then((response) => setMessages([{ id: `${Date.now()}-briefing`, role: 'assistant', content: response.data.answer, timestamp: new Date(), response: response.data }]))
      .catch(() => undefined);
  }, [briefingLoaded, messages.length]);

  const sendMessage = useCallback(async (text?: string) => {
    const question = (text ?? input).trim();
    if (!question || loading) return;

    setMessages((previous) => [...previous, {
      id: `${Date.now()}-user`,
      role: 'user',
      content: question,
      timestamp: new Date(),
    }]);
    setInput('');
    setError(null);
    setLoading(true);

    const assistantId = `${Date.now()}-assistant`;
    try {
      // Stream the answer in. Locally answered questions arrive as one chunk;
      // only the provider path actually paints progressively.
      let streamed = '';
      let settled: AIResponse | null = null;
      if (voice.autoSpeak) voice.beginSpeechStream();

      await hrmsApi.postStream('/api/ai/ask/stream', { question, context_type: 'generic' }, {
        onChunk: (text) => {
          streamed += text;
          if (voice.autoSpeak) voice.pushSpeech(text);
          setMessages((previous) => {
            const existing = previous.find((message) => message.id === assistantId);
            if (!existing) {
              return [...previous, {
                id: assistantId,
                role: 'assistant',
                content: streamed,
                timestamp: new Date(),
              }];
            }
            return previous.map((message) =>
              message.id === assistantId ? { ...message, content: streamed } : message);
          });
        },
        // `done` is authoritative, not the sum of the chunks: the server can
        // replace a streamed answer wholesale after the fact. Overwrite, never append.
        onDone: (payload) => {
          settled = (payload as { data: AIResponse })?.data ?? null;
        },
        onError: (payload) => {
          throw new Error((payload as { error?: { message?: string } })?.error?.message
            ?? 'Mira could not answer right now.');
        },
      });

      const result = settled;
      if (!result) throw new Error('Mira did not return an answer.');

      setMessages((previous) => {
        const rendered = previous.some((message) => message.id === assistantId);
        const settledMessage = {
          id: assistantId,
          role: 'assistant' as const,
          content: result.answer,
          timestamp: new Date(),
          response: result,
        };
        return rendered
          ? previous.map((message) => (message.id === assistantId ? settledMessage : message))
          : [...previous, settledMessage];
      });
      if (voice.autoSpeak) {
        // Sentences already spoken are not repeated; if the server replaced the
        // streamed answer, speak the settled one instead of the discarded text.
        if (result.answer.startsWith(streamed.trim().slice(0, 40)) && streamed.trim()) voice.endSpeechStream();
        else voice.speak(result.answer);
      }
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : 'Mira could not answer right now.';
      setError(message);
      setMessages((previous) => [...previous, {
        id: `${Date.now()}-error`,
        role: 'assistant',
        content: 'I could not complete that request. Please try again or use a more specific account question.',
        timestamp: new Date(),
      }]);
    } finally {
      setLoading(false);
      window.setTimeout(() => inputRef.current?.focus(), 80);
    }
  }, [input, loading, voice.autoSpeak, voice.speak, voice.beginSpeechStream, voice.pushSpeech, voice.endSpeechStream]);

  const startVoice = () => {
    if (voice.listening) {
      voice.stopListening();
      return;
    }
    voice.startListening((transcript) => {
      setInput(transcript);
      void sendMessage(transcript);
    });
  };

  const clearConversation = () => {
    voice.stopListening();
    voice.stopSpeaking();
    setMessages([]);
    setBriefingLoaded(false);
    setInput('');
    setError(null);
    inputRef.current?.focus();
  };

  const mood: MiraMood = voice.listening
    ? 'listening'
    : loading
      ? 'thinking'
      : voice.speaking
        ? 'speaking'
        : error || voice.voiceError
          ? 'error'
          : messages.length
            ? 'happy'
            : 'idle';

  const assistantName = session?.assistant.name ?? 'Mira';
  const prompts = session?.prompts?.length ? session.prompts : DEFAULT_PROMPTS;

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-[radial-gradient(circle_at_top_left,_rgba(99,102,241,0.12),_transparent_34%),linear-gradient(to_bottom,_#f8fafc,_#eef2ff)] p-3 sm:p-6">
      <div className="mx-auto flex min-h-[calc(100vh-7rem)] max-w-7xl flex-col overflow-hidden rounded-[28px] border border-white/80 bg-white/90 shadow-[0_30px_90px_rgba(30,41,59,0.18)] backdrop-blur-xl">
        <header className="relative overflow-hidden border-b border-slate-200 bg-gradient-to-r from-slate-950 via-indigo-950 to-blue-900 px-5 py-5 text-white sm:px-7">
          <div className="absolute -right-20 -top-24 h-64 w-64 rounded-full bg-cyan-400/15 blur-3xl" />
          <div className="absolute left-1/3 top-0 h-40 w-40 rounded-full bg-violet-500/10 blur-3xl" />
          <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-4">
              <MiraAvatar mood={mood} size="lg" />
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{assistantName}</h1>
                  <Badge className="border border-emerald-300/30 bg-emerald-300/15 text-emerald-100 hover:bg-emerald-300/15">Private HR Assistant</Badge>
                </div>
                <p className="mt-1 text-sm text-blue-100 sm:text-base">{session?.assistant.tagline ?? 'Your private HR assistant'}</p>
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-300">
                  <span className="inline-flex items-center gap-1"><ShieldCheck className="h-3.5 w-3.5" /> RBAC enforced</span>
                  <span className="inline-flex items-center gap-1"><Sparkles className="h-3.5 w-3.5" /> Live HRMS + approved company knowledge</span>
                  <span>Other employee personal data blocked</span>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
              <select value={voice.language} onChange={(event) => voice.setLanguage(event.target.value as 'en-IN' | 'hi-IN')} className="h-10 rounded-md border border-white/20 bg-white/10 px-2 text-xs text-white outline-none">
                <option className="text-slate-900" value="en-IN">Indian English</option>
                <option className="text-slate-900" value="hi-IN">Hindi</option>
              </select>
              <select value={voice.selectedVoiceURI} onChange={(event) => voice.setSelectedVoiceURI(event.target.value)} className="h-10 max-w-48 rounded-md border border-white/20 bg-white/10 px-2 text-xs text-white outline-none" title="Indian voice">
                <option className="text-slate-900" value="">Best Indian voice</option>
                {voice.voices.map((item) => <option className="text-slate-900" key={item.voiceURI} value={item.voiceURI}>{item.name}</option>)}
              </select>
              <Button
                type="button"
                variant="outline"
                onClick={() => voice.setAutoSpeak(!voice.autoSpeak)}
                disabled={!voice.speechSupported}
                className="border-white/20 bg-white/10 text-white hover:bg-white/20 hover:text-white"
              >
                {voice.autoSpeak ? <Volume2 className="mr-2 h-4 w-4" /> : <VolumeX className="mr-2 h-4 w-4" />}
                Voice replies {voice.autoSpeak ? 'on' : 'off'}
              </Button>
              {voice.recognitionSupported && voice.speechSupported && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => voice.setBargeInEnabled(!voice.bargeInEnabled)}
                  className={cn(
                    'border-white/20 bg-white/10 text-white hover:bg-white/20 hover:text-white',
                    voice.bargeInEnabled && 'border-indigo-300/50 bg-indigo-500/20',
                  )}
                  title={voice.bargeInEnabled
                    ? 'Listening while Mira talks — opens the mic only while she speaks, so you can cut in'
                    : 'Off — press the mic to talk instead'}
                >
                  {voice.bargeInEnabled ? <Ear className="mr-2 h-4 w-4" /> : <EarOff className="mr-2 h-4 w-4" />}
                  Interrupt by talking {voice.bargeInEnabled ? 'on' : 'off'}
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                onClick={clearConversation}
                className="border-white/20 bg-white/10 text-white hover:bg-white/20 hover:text-white"
              >
                <RotateCcw className="mr-2 h-4 w-4" /> New chat
              </Button>
            </div>
          </div>
        </header>

        <div className="grid min-h-0 flex-1 lg:grid-cols-[300px_minmax(0,1fr)]">
          <aside className="hidden border-r border-slate-200 bg-slate-50/80 p-5 lg:block">
            <div className="rounded-2xl border border-indigo-100 bg-white p-4 shadow-sm">
              <div className="flex items-center gap-3">
                <MiraAvatar mood="happy" size="sm" />
                <div>
                  <p className="text-sm font-semibold text-slate-900">What I can answer</p>
                  <p className="text-xs text-slate-500">Your own HRMS account only</p>
                </div>
              </div>
              <div className="mt-4 grid gap-2 text-xs text-slate-600">
                {['Salary & payslip', 'Leave balance', 'Attendance & LWP', 'Roster & shifts', 'Documents', 'Pending actions', 'Loans & claims', 'Profile & journey'].map((item) => (
                  <div key={item} className="flex items-center gap-2">
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> {item}
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-5">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Quick questions</p>
              <div className="space-y-2">
                {prompts.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    onClick={() => void sendMessage(prompt)}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-left text-sm text-slate-700 shadow-sm transition hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-800"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-800">
              {session?.capabilities.executesActions
                ? 'Mira can draft, and with your explicit confirmation submit, a leave request on your behalf. She still cannot approve leave, edit records, or take any action without asking you first.'
                : 'Mira provides information and recommendations. It does not approve, edit, delete, or execute HR actions.'}
            </div>
          </aside>

          <main className="flex min-h-0 flex-col bg-white">
            <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-7">
              {messages.length === 0 ? (
                <div className="mx-auto flex h-full max-w-2xl flex-col items-center justify-center py-10 text-center">
                  <MiraAvatar mood="idle" size="lg" showStatus />
                  <h2 className="mt-5 text-2xl font-semibold text-slate-900">Ask me about your HRMS account</h2>
                  <p className="mt-2 max-w-xl text-sm leading-relaxed text-slate-600">
                    You can type or speak naturally. Account questions are answered from HRMS through a self-only data path and are not sent to an external AI provider.
                  </p>
                  <div className="mt-6 grid w-full gap-2 sm:grid-cols-2 lg:hidden">
                    {prompts.slice(0, 6).map((prompt) => (
                      <button
                        key={prompt}
                        type="button"
                        onClick={() => void sendMessage(prompt)}
                        className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-left text-sm text-slate-700 hover:border-indigo-200 hover:bg-indigo-50"
                      >
                        {prompt}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="mx-auto max-w-3xl space-y-5">
                  {messages.map((message) => (
                    <div key={message.id} className={cn('flex gap-3', message.role === 'user' ? 'justify-end' : 'justify-start')}>
                      {message.role === 'assistant' && <MiraAvatar mood="happy" size="sm" className="mt-1" />}
                      <div className={cn('max-w-[88%] sm:max-w-[78%]', message.role === 'user' && 'order-first')}>
                        <div className={cn(
                          'rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-sm',
                          message.role === 'user'
                            ? 'rounded-br-md bg-indigo-600 text-white'
                            : 'rounded-bl-md border border-slate-200 bg-slate-50 text-slate-700',
                        )}>
                          <div className="whitespace-pre-wrap">{message.content}</div>

                          {(message.response?.insights ?? []).length > 0 && (
                            <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-200/70 pt-3">
                              {(message.response?.insights ?? []).map((insight) => (
                                <span key={insight.key} className={cn('rounded-full border px-2.5 py-1 text-xs font-medium', SEVERITY_CLASS[insight.severity ?? 'low'])}>
                                  {insight.label}{insight.count !== undefined ? ` (${insight.count})` : ''}
                                </span>
                              ))}
                            </div>
                          )}

                          {/* Only the most recent message may still have an unresolved draft —
                              once the user confirms/cancels, a new assistant message without
                              pendingAction becomes the last one, so an older draft's buttons
                              stop rendering rather than staying clickable after resolution. */}
                          {message.response?.pendingAction && message.id === messages[messages.length - 1]?.id && (
                            <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-200/70 pt-3">
                              <button
                                type="button"
                                onClick={() => void sendMessage(message.response!.pendingAction!.confirmLabel)}
                                disabled={loading}
                                className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
                              >
                                {message.response.pendingAction.confirmLabel}
                              </button>
                              <button
                                type="button"
                                onClick={() => void sendMessage(message.response!.pendingAction!.cancelLabel)}
                                disabled={loading}
                                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                              >
                                {message.response.pendingAction.cancelLabel}
                              </button>
                            </div>
                          )}

                          {(message.response?.actions ?? []).filter((action) => safeInternalUrl(action.url)).length > 0 && (
                            <div className="mt-4 flex flex-wrap gap-2">
                              {(message.response?.actions ?? []).filter((action) => safeInternalUrl(action.url)).map((action) => (
                                <button
                                  key={action.key}
                                  type="button"
                                  onClick={() => navigate(action.url)}
                                  className="inline-flex items-center gap-1 rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-indigo-700 ring-1 ring-indigo-100 hover:bg-indigo-50"
                                >
                                  {action.label} <ArrowRight className="h-3 w-3" />
                                </button>
                              ))}
                            </div>
                          )}
                        </div>

                        <div className={cn('mt-1 flex items-center gap-2 px-1 text-[10px] text-slate-400', message.role === 'user' && 'justify-end')}>
                          <Clock3 className="h-3 w-3" />
                          {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          {message.response?.provider && <span>· {message.response.provider}</span>}
                        </div>
                      </div>
                    </div>
                  ))}

                  {loading && (
                    <div className="flex items-start gap-3">
                      <MiraAvatar mood="thinking" size="sm" />
                      <div className="flex items-center gap-2 rounded-2xl rounded-bl-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500 shadow-sm">
                        <Loader2 className="h-4 w-4 animate-spin" /> Checking your HRMS account…
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {(error || voice.voiceError) && (
              <div className="border-t border-rose-100 bg-rose-50 px-5 py-2 text-sm text-rose-700">{voice.voiceError ?? error}</div>
            )}

            {voice.interimTranscript && (
              <div className="border-t border-cyan-100 bg-cyan-50 px-5 py-2 text-sm italic text-cyan-800">Listening: “{voice.interimTranscript}”</div>
            )}

            <div className="border-t border-slate-200 bg-white px-4 py-4 sm:px-7">
              <div className="mx-auto max-w-3xl">
                <div className="flex items-end gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-2 shadow-sm focus-within:border-indigo-300 focus-within:ring-2 focus-within:ring-indigo-100">
                  <button
                    type="button"
                    onClick={startVoice}
                    disabled={!voice.voiceInputSupported}
                    className={cn(
                      'flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition',
                      voice.listening ? 'bg-rose-500 text-white' : 'bg-white text-slate-500 hover:bg-indigo-50 hover:text-indigo-700',
                      // Not gated on `loading`: the button must stay clickable while Mira is
                      // answering/speaking so a user can barge in (voice.startListening()
                      // already cancels her in-flight TTS) — gating on `loading` here used to
                      // disable it for nearly the entire time a user would want to interrupt her.
                      !voice.voiceInputSupported && 'cursor-not-allowed opacity-40',
                    )}
                    title={
                      voice.sttMode === 'native' ? 'Speak to Mira'
                        : voice.sttMode === 'fallback' ? 'Tap to record, tap again to send'
                        : 'Voice input is not supported in this browser'
                    }
                    aria-label={voice.listening ? 'Stop listening' : 'Speak to Mira'}
                  >
                    {voice.listening ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
                  </button>

                  <textarea
                    ref={inputRef}
                    value={input}
                    onChange={(event) => setInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault();
                        void sendMessage();
                      }
                    }}
                    placeholder="Ask Mira about your HRMS data or MAS Callnet…"
                    rows={1}
                    maxLength={1000}
                    disabled={loading}
                    className="max-h-36 min-h-11 flex-1 resize-none bg-transparent px-2 py-3 text-sm text-slate-800 outline-none placeholder:text-slate-400"
                  />

                  <button
                    type="button"
                    onClick={() => void sendMessage()}
                    disabled={!input.trim() || loading}
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-white shadow-sm transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-40"
                    aria-label="Send message"
                  >
                    {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
                  </button>
                </div>

                <div className="mt-2 flex flex-col gap-1 text-[11px] text-slate-400 sm:flex-row sm:items-center sm:justify-between">
                  <span>Press Enter to send · Shift+Enter for a new line</span>
                  <span>Microphone activates only when you press the mic button.</span>
                </div>
              </div>
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
