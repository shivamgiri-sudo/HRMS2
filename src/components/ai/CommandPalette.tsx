import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  Ear,
  EarOff,
  Loader2,
  Mic,
  MicOff,
  RotateCcw,
  Send,
  ShieldCheck,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { hrmsApi } from '@/lib/hrmsApi';
import { useMiraVoice } from '@/hooks/useMiraVoice';
import { MiraAvatar, type MiraMood } from './MiraAvatar';

type AISeverity = 'critical' | 'high' | 'medium' | 'low';

interface AIResponse {
  answer: string;
  provider?: string;
  model?: string;
  insights?: Array<{ key: string; label: string; severity?: AISeverity; count?: number; value?: string | number }>;
  actions?: Array<{ key: string; label: string; url: string; priority?: AISeverity }>;
  pendingAction?: { type: string; summary: string; confirmLabel: string; cancelLabel: string };
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
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
  };
}

const DEFAULT_PROMPTS = [
  'Give me my account summary',
  'Show my latest salary breakup',
  'How many leaves do I have left?',
  'Summarize my attendance this month',
];

const SEVERITY_CLASS: Record<AISeverity, string> = {
  critical: 'border-red-200 bg-red-50 text-red-700',
  high: 'border-amber-200 bg-amber-50 text-amber-700',
  medium: 'border-blue-200 bg-blue-50 text-blue-700',
  low: 'border-slate-200 bg-slate-50 text-slate-600',
};

function isSafeInternalUrl(url: string): boolean {
  try {
    const parsed = new URL(url, window.location.origin);
    return parsed.origin === window.location.origin && parsed.pathname.startsWith('/');
  } catch {
    return false;
  }
}

export function CommandPalette({
  open,
  onClose,
  contextType,
}: {
  open: boolean;
  onClose: () => void;
  contextType: string;
}) {
  const navigate = useNavigate();
  const [session, setSession] = useState<MiraSession | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
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
    if (!open) {
      voice.stopListening();
      voice.stopSpeaking();
      return;
    }
    window.setTimeout(() => inputRef.current?.focus(), 80);
  }, [open, voice.stopListening, voice.stopSpeaking]);

  useEffect(() => {
    if (!open || briefingLoaded || messages.length > 0) return;
    setBriefingLoaded(true);

    // Same greeting priority as PeopleOSCopilot.tsx: a greeting primed right after
    // sign-in wins over the generic account briefing and is consumed once.
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
            response: {
              answer: data.greeting,
              insights: (data.updatesPreview ?? []).map((update) => ({ key: update.key, label: update.label, severity: 'medium' as AISeverity })),
            },
          }]);
          return;
        }
      } catch {
        // Malformed/stale value — fall through to the normal briefing fetch below.
      }
    }

    void hrmsApi.get<{ success: boolean; data: AIResponse }>('/api/ai/briefing')
      .then((response) => setMessages([{ id: `${Date.now()}-briefing`, role: 'assistant', content: response.data.answer, response: response.data }]))
      .catch(() => undefined);
  }, [briefingLoaded, messages.length, open]);

  useEffect(() => {
    if (!open) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, loading]);

  const sendMessage = useCallback(async (text?: string) => {
    const question = (text ?? input).trim();
    if (!question || loading) return;

    const userMessage: ChatMessage = {
      id: `${Date.now()}-user`,
      role: 'user',
      content: question,
    };
    setMessages((previous) => [...previous, userMessage]);
    setInput('');
    setError(null);
    setLoading(true);

    const assistantId = `${Date.now()}-assistant`;
    try {
      // Locally answered questions arrive as a single chunk; only the provider
      // path paints progressively.
      let streamed = '';
      let settled: AIResponse | null = null;
      if (voice.autoSpeak) voice.beginSpeechStream();

      await hrmsApi.postStream('/api/ai/ask/stream', {
        question,
        context_type: contextType || 'generic',
      }, {
        onChunk: (text) => {
          streamed += text;
          if (voice.autoSpeak) voice.pushSpeech(text);
          setMessages((previous) => {
            const partial: ChatMessage = { id: assistantId, role: 'assistant', content: streamed };
            return previous.some((message) => message.id === assistantId)
              ? previous.map((message) => (message.id === assistantId ? partial : message))
              : [...previous, partial];
          });
        },
        // The server may replace a streamed answer after the fact, so `done`
        // overwrites what the chunks built rather than appending to it.
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

      const assistantMessage: ChatMessage = {
        id: assistantId,
        role: 'assistant',
        content: result.answer,
        response: result,
      };
      setMessages((previous) => (
        previous.some((message) => message.id === assistantId)
          ? previous.map((message) => (message.id === assistantId ? assistantMessage : message))
          : [...previous, assistantMessage]
      ));
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
        content: 'I could not complete that request. Please try again or rephrase the question.',
      }]);
    } finally {
      setLoading(false);
    }
  }, [contextType, input, loading, voice.autoSpeak, voice.speak, voice.beginSpeechStream, voice.pushSpeech, voice.endSpeechStream]);

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
    voice.stopSpeaking();
    setMessages([]);
    setBriefingLoaded(false);
    setInput('');
    setError(null);
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

  if (!open) return null;

  const prompts = session?.prompts?.length ? session.prompts : DEFAULT_PROMPTS;
  const assistantName = session?.assistant.name ?? 'Mira';

  return (
    <div className="fixed inset-0 z-[70]" role="dialog" aria-modal="true" aria-label={`${assistantName} private HR assistant`}>
      <button type="button" className="absolute inset-0 bg-slate-950/25 backdrop-blur-[1px]" onClick={onClose} aria-label="Close Mira" />

      <section className="absolute inset-x-2 bottom-2 flex h-[min(720px,calc(100vh-16px))] flex-col overflow-hidden rounded-3xl border border-white/80 bg-white shadow-[0_24px_80px_rgba(15,23,42,0.28)] sm:inset-x-auto sm:bottom-6 sm:right-6 sm:w-[430px]">
        <header className="relative overflow-hidden border-b border-slate-100 bg-gradient-to-br from-slate-950 via-indigo-950 to-blue-900 px-4 py-4 text-white">
          <div className="absolute -right-10 -top-12 h-40 w-40 rounded-full bg-cyan-400/15 blur-2xl" />
          <div className="relative flex items-center gap-3">
            <MiraAvatar mood={mood} size="md" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold tracking-tight">{assistantName}</h2>
                <span className="rounded-full border border-emerald-300/30 bg-emerald-300/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-100">PRIVATE</span>
              </div>
              <p className="truncate text-xs text-blue-100">{session?.assistant.tagline ?? 'Your private HR assistant'}</p>
              <div className="mt-1 flex items-center gap-1 text-[10px] text-slate-300">
                <ShieldCheck className="h-3 w-3" />
                Live HRMS self-data · Approved company knowledge
              </div>
            </div>
            <button type="button" onClick={clearConversation} className="rounded-full p-2 text-white/70 hover:bg-white/10 hover:text-white" aria-label="Clear conversation">
              <RotateCcw className="h-4 w-4" />
            </button>
            <button type="button" onClick={onClose} className="rounded-full p-2 text-white/70 hover:bg-white/10 hover:text-white" aria-label="Close">
              <X className="h-4 w-4" />
            </button>
          </div>
        </header>

        <div ref={scrollRef} className="flex-1 overflow-y-auto bg-slate-50/80 px-4 py-4">
          {messages.length === 0 ? (
            <div className="space-y-4">
              <div className="rounded-2xl border border-indigo-100 bg-white p-4 shadow-sm">
                <div className="flex items-start gap-3">
                  <MiraAvatar mood="happy" size="sm" />
                  <div>
                    <p className="text-sm font-semibold text-slate-900">Hello, I’m {assistantName}.</p>
                    <p className="mt-1 text-sm leading-relaxed text-slate-600">
                      Ask about your salary, leave, attendance, shift, documents, pending tasks, loans, reimbursements, or profile. I will not disclose another employee’s personal information.
                    </p>
                  </div>
                </div>
              </div>

              <div>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Try asking</p>
                <div className="grid gap-2">
                  {prompts.slice(0, 6).map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      onClick={() => void sendMessage(prompt)}
                      className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-left text-sm text-slate-700 shadow-sm transition hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-800"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {messages.map((message) => (
                <div key={message.id} className={cn('flex', message.role === 'user' ? 'justify-end' : 'justify-start')}>
                  <div className={cn('max-w-[88%]', message.role === 'assistant' && 'flex items-start gap-2')}>
                    {message.role === 'assistant' && <MiraAvatar mood="happy" size="sm" className="mt-1" />}
                    <div className={cn(
                      'rounded-2xl px-3.5 py-3 text-sm leading-relaxed shadow-sm',
                      message.role === 'user'
                        ? 'rounded-br-md bg-indigo-600 text-white'
                        : 'rounded-bl-md border border-slate-200 bg-white text-slate-700',
                    )}>
                      <div className="whitespace-pre-wrap">{message.content}</div>

                      {(message.response?.insights ?? []).length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-1.5 border-t border-slate-100 pt-3">
                          {(message.response?.insights ?? []).slice(0, 4).map((insight) => (
                            <span key={insight.key} className={cn('rounded-full border px-2 py-0.5 text-[11px] font-medium', SEVERITY_CLASS[insight.severity ?? 'low'])}>
                              {insight.label}{insight.count !== undefined ? ` (${insight.count})` : ''}
                            </span>
                          ))}
                        </div>
                      )}

                      {/* Only the most recent message may still have an unresolved draft —
                          see PeopleOSCopilot.tsx's identical guard for why. */}
                      {message.response?.pendingAction && message.id === messages[messages.length - 1]?.id && (
                        <div className="mt-3 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
                          <button
                            type="button"
                            onClick={() => void sendMessage(message.response!.pendingAction!.confirmLabel)}
                            disabled={loading}
                            className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            {message.response.pendingAction.confirmLabel}
                          </button>
                          <button
                            type="button"
                            onClick={() => void sendMessage(message.response!.pendingAction!.cancelLabel)}
                            disabled={loading}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            {message.response.pendingAction.cancelLabel}
                          </button>
                        </div>
                      )}

                      {(message.response?.actions ?? []).filter((action) => isSafeInternalUrl(action.url)).length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {(message.response?.actions ?? []).filter((action) => isSafeInternalUrl(action.url)).slice(0, 2).map((action) => (
                            <button
                              key={action.key}
                              type="button"
                              onClick={() => {
                                navigate(action.url);
                                onClose();
                              }}
                              className="inline-flex items-center gap-1 rounded-lg bg-indigo-50 px-2.5 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-100"
                            >
                              {action.label} <ArrowRight className="h-3 w-3" />
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}

              {loading && (
                <div className="flex items-start gap-2">
                  <MiraAvatar mood="thinking" size="sm" />
                  <div className="flex items-center gap-2 rounded-2xl rounded-bl-md border border-slate-200 bg-white px-3.5 py-3 text-sm text-slate-500 shadow-sm">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Checking your HRMS account…
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {(error || voice.voiceError) && (
          <div className="border-t border-rose-100 bg-rose-50 px-4 py-2 text-xs text-rose-700">{voice.voiceError ?? error}</div>
        )}

        {voice.interimTranscript && (
          <div className="border-t border-cyan-100 bg-cyan-50 px-4 py-2 text-xs italic text-cyan-800">“{voice.interimTranscript}”</div>
        )}

        <footer className="border-t border-slate-200 bg-white p-3">
          <div className="mb-2 flex items-center gap-2 text-[10px] text-slate-500">
            <select value={voice.language} onChange={(event) => voice.setLanguage(event.target.value as 'en-IN' | 'hi-IN')} className="rounded-md border border-slate-200 bg-white px-2 py-1">
              <option value="en-IN">Indian English</option>
              <option value="hi-IN">Hindi</option>
            </select>
            <select value={voice.selectedVoiceURI} onChange={(event) => voice.setSelectedVoiceURI(event.target.value)} className="min-w-0 flex-1 rounded-md border border-slate-200 bg-white px-2 py-1" title="Indian voice">
              <option value="">Best available Indian voice</option>
              {voice.voices.map((item) => <option key={item.voiceURI} value={item.voiceURI}>{item.name}</option>)}
            </select>
          </div>
          <div className="flex items-end gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-2 focus-within:border-indigo-300 focus-within:ring-2 focus-within:ring-indigo-100">
            <button
              type="button"
              onClick={startVoice}
              disabled={!voice.voiceInputSupported}
              className={cn(
                'flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition',
                voice.listening ? 'bg-rose-500 text-white' : 'bg-white text-slate-500 hover:bg-indigo-50 hover:text-indigo-700',
                // Not gated on `loading` — see PeopleOSCopilot.tsx's mic button for the same fix
                // and rationale: it must stay clickable during Mira's reply so barge-in works.
                !voice.voiceInputSupported && 'cursor-not-allowed opacity-40',
              )}
              aria-label={voice.listening ? 'Stop listening' : 'Speak to Mira'}
              title={
                voice.sttMode === 'native' ? 'Speak to Mira'
                  : voice.sttMode === 'fallback' ? 'Tap to record, tap again to send'
                  : 'Voice input is not supported in this browser'
              }
            >
              {voice.listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
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
              placeholder="Ask about your HRMS data or MAS Callnet…"
              rows={1}
              maxLength={1000}
              disabled={loading}
              className="max-h-28 min-h-9 flex-1 resize-none bg-transparent px-1 py-2 text-sm text-slate-800 outline-none placeholder:text-slate-400"
            />

            <button
              type="button"
              onClick={() => voice.setAutoSpeak(!voice.autoSpeak)}
              disabled={!voice.speechSupported}
              className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-slate-500 hover:bg-indigo-50 hover:text-indigo-700', !voice.speechSupported && 'cursor-not-allowed opacity-40')}
              aria-label={voice.autoSpeak ? 'Turn spoken replies off' : 'Turn spoken replies on'}
              title={voice.autoSpeak ? 'Spoken replies on' : 'Spoken replies off'}
            >
              {voice.autoSpeak ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
            </button>

            {voice.recognitionSupported && voice.speechSupported && (
              <button
                type="button"
                onClick={() => voice.setBargeInEnabled(!voice.bargeInEnabled)}
                className={cn(
                  'flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-slate-500 hover:bg-indigo-50 hover:text-indigo-700',
                  voice.bargeInEnabled && 'text-indigo-600',
                )}
                aria-label={voice.bargeInEnabled ? 'Stop listening for interruptions' : 'Let me interrupt by talking'}
                title={voice.bargeInEnabled
                  ? 'Listening while Mira talks — opens the mic only while she speaks, so you can cut in'
                  : 'Off — press the mic to talk instead'}
              >
                {voice.bargeInEnabled ? <Ear className="h-4 w-4" /> : <EarOff className="h-4 w-4" />}
              </button>
            )}

            <button
              type="button"
              onClick={() => void sendMessage()}
              disabled={!input.trim() || loading}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-white shadow-sm transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="Send message"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </button>
          </div>

          <div className="mt-2 flex items-center justify-between px-1 text-[10px] text-slate-400">
            <span>Voice uses your browser microphone only when activated.</span>
            <button type="button" onClick={() => { navigate('/peopleos/copilot'); onClose(); }} className="font-semibold text-indigo-600 hover:underline">
              Full chat
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
