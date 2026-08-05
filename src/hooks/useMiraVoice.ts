import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cleanForSpeech, takeSpeakableSentences } from '@/lib/speechChunks';
import { createVoiceActivityDetector, rmsFromByteTimeDomain, type VoiceActivityDetector } from '@/lib/voiceActivity';
import { apiBaseUrl } from '@/lib/apiBase';

// Mirrors ReceiptUpload.tsx's own local token lookup — no shared exported
// helper exists for this yet; matching the established precedent rather than
// introducing a new shared utility as a side effect of this feature.
function getAuthToken(): string | null {
  const mysqlToken = localStorage.getItem('hrms_access_token');
  if (mysqlToken) return mysqlToken;
  const demoRaw = import.meta.env.DEV && import.meta.env.VITE_ENABLE_DEMO_LOGIN === 'true'
    ? localStorage.getItem('hrms_demo_session')
    : null;
  if (demoRaw) {
    try {
      const demo = JSON.parse(demoRaw);
      return demo?.access_token ?? null;
    } catch {
      return null;
    }
  }
  return null;
}

// Safari's MediaRecorder primarily produces audio/mp4 (AAC), not the
// audio/webm most Chromium browsers default to — tried in this order so the
// backend's mime allowlist (ai-voice.routes.ts) always gets something it accepts.
const STT_FALLBACK_MIME_CANDIDATES = ['audio/mp4', 'audio/webm', 'audio/ogg', 'audio/mpeg', 'audio/wav'];

/** Exported for direct unit testing — the rest of the fallback flow needs a
 *  real browser (MediaRecorder, getUserMedia, an actual permission prompt),
 *  which this repo's Node-environment test harness cannot exercise. */
export function pickRecorderMimeType(): string | undefined {
  if (typeof window === 'undefined' || typeof window.MediaRecorder === 'undefined') return undefined;
  return STT_FALLBACK_MIME_CANDIDATES.find((type) => window.MediaRecorder.isTypeSupported?.(type));
}

interface SpeechRecognitionAlternativeLike { transcript: string }
interface SpeechRecognitionResultLike { isFinal: boolean; 0: SpeechRecognitionAlternativeLike }
interface SpeechRecognitionEventLike extends Event { results: ArrayLike<SpeechRecognitionResultLike> }
interface SpeechRecognitionErrorEventLike extends Event { error?: string }
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
}
type SpeechRecognitionConstructorLike = new () => SpeechRecognitionLike;

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructorLike;
    webkitSpeechRecognition?: SpeechRecognitionConstructorLike;
  }
}

export type MiraVoiceLanguage = 'en-IN' | 'hi-IN';

const PREFERRED_INDIAN_VOICE_NAMES = [
  'Neerja',
  'Prabhat',
  'Heera',
  'Ravi',
  'English India',
  'Hindi India',
] as const;
const PREFERRED_INDIAN_VOICE_NAMES_LOWER = PREFERRED_INDIAN_VOICE_NAMES.map((name) => name.toLowerCase());

function voiceScore(voice: SpeechSynthesisVoice, language: MiraVoiceLanguage): number {
  const name = voice.name.toLowerCase();
  const lang = voice.lang.toLowerCase();
  let score = 0;
  if (lang === language.toLowerCase()) score += 100;
  else if (language === 'en-IN' && lang.startsWith('en-')) score += 30;
  else if (language === 'hi-IN' && lang.startsWith('hi')) score += 40;
  if (PREFERRED_INDIAN_VOICE_NAMES_LOWER.some((preferred) => name.includes(preferred))) score += 80;
  if (/natural|online/.test(name)) score += 40;
  if (/microsoft|google/.test(name)) score += 20;
  if (voice.localService) score += 5;
  return score;
}

export function useMiraVoice() {
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  /** Text received but not yet closing a sentence. */
  const speechBufferRef = useRef('');
  /** Finalized speech-to-text accumulated across one recognition session.
   *  The browser can mark a segment `isFinal` mid-utterance on a natural
   *  pause even though the session (continuous = false) hasn't truly ended —
   *  dispatching on every such `onresult` sent only the first, often partial,
   *  phrase and silently dropped the rest of what the user said. Accumulate
   *  here and dispatch exactly once, from `onend`. */
  const finalTextRef = useRef('');
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState('');
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [language, setLanguageState] = useState<MiraVoiceLanguage>(() =>
    localStorage.getItem('mira_voice_language') === 'hi-IN' ? 'hi-IN' : 'en-IN',
  );
  const [selectedVoiceURI, setSelectedVoiceURIState] = useState(() => localStorage.getItem('mira_voice_uri') || '');
  const [autoSpeak, setAutoSpeak] = useState(() => localStorage.getItem('mira_auto_speak') === 'true');
  // Off by default and deliberately separate from autoSpeak: this opens a
  // microphone stream for as long as Mira is talking, which is a bigger
  // privacy footprint than press-to-talk and needs its own explicit consent.
  const [bargeInEnabled, setBargeInEnabledState] = useState(() => localStorage.getItem('mira_barge_in_enabled') === 'true');

  /** The most recent transcript callback passed to startListening, so an
   *  auto-triggered barge-in can resume the exact same capture flow the mic
   *  button uses, without the caller wiring a second path. */
  const lastOnFinalRef = useRef<((transcript: string) => void) | null>(null);

  const ambientStreamRef = useRef<MediaStream | null>(null);
  const ambientContextRef = useRef<AudioContext | null>(null);
  const ambientRafRef = useRef<number | null>(null);
  const ambientDetectorRef = useRef<VoiceActivityDetector | null>(null);

  // getUserMedia's permission prompt is asynchronous, so by the time it
  // resolves the state that justified opening the stream may be stale. These
  // mirror the latest values for that one post-await check.
  const speakingRef = useRef(false);
  const listeningRef = useRef(false);
  const bargeInEnabledRef = useRef(bargeInEnabled);

  const recognitionSupported = typeof window !== 'undefined' && !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  const speechSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;
  // Safari/iOS has no Web Speech API at all — recognitionSupported is false
  // there. This is the OpenAI Whisper fallback: record via MediaRecorder,
  // POST to the backend, feed the returned transcript into the same onFinal
  // callback the native path uses.
  const sttFallbackSupported = !recognitionSupported
    && typeof window !== 'undefined'
    && !!navigator.mediaDevices?.getUserMedia
    && typeof window.MediaRecorder !== 'undefined';
  const voiceInputSupported = recognitionSupported || sttFallbackSupported;
  const sttMode: 'native' | 'fallback' | 'unsupported' = recognitionSupported
    ? 'native'
    : sttFallbackSupported
      ? 'fallback'
      : 'unsupported';

  // Fallback-path recording state — separate from recognitionRef (native path).
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const sttAbortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => { localStorage.setItem('mira_auto_speak', String(autoSpeak)); }, [autoSpeak]);
  useEffect(() => { localStorage.setItem('mira_barge_in_enabled', String(bargeInEnabled)); bargeInEnabledRef.current = bargeInEnabled; }, [bargeInEnabled]);
  useEffect(() => { speakingRef.current = speaking; }, [speaking]);
  useEffect(() => { listeningRef.current = listening; }, [listening]);
  useEffect(() => { localStorage.setItem('mira_voice_language', language); }, [language]);
  useEffect(() => {
    if (selectedVoiceURI) localStorage.setItem('mira_voice_uri', selectedVoiceURI);
    else localStorage.removeItem('mira_voice_uri');
  }, [selectedVoiceURI]);

  useEffect(() => {
    if (!speechSupported) return;
    const load = () => setVoices(window.speechSynthesis.getVoices());
    load();
    window.speechSynthesis.addEventListener?.('voiceschanged', load);
    return () => window.speechSynthesis.removeEventListener?.('voiceschanged', load);
  }, [speechSupported]);

  const indianVoices = useMemo(() => voices
    .filter((voice) => voice.lang.toLowerCase().startsWith(language === 'hi-IN' ? 'hi' : 'en'))
    .sort((a, b) => voiceScore(b, language) - voiceScore(a, language)), [voices, language]);

  const selectedVoice = useMemo(() => {
    const explicit = voices.find((voice) => voice.voiceURI === selectedVoiceURI);
    if (explicit) return explicit;
    return [...voices].sort((a, b) => voiceScore(b, language) - voiceScore(a, language))[0];
  }, [language, selectedVoiceURI, voices]);

  const setLanguage = useCallback((value: MiraVoiceLanguage) => {
    setLanguageState(value);
    setSelectedVoiceURIState('');
  }, []);
  const setSelectedVoiceURI = useCallback((value: string) => setSelectedVoiceURIState(value), []);

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    // Fallback path: stop() triggers the recorder's onstop handler, which
    // tears down the stream and kicks off the transcribe-and-onFinal flow
    // asynchronously — listening flips false here immediately (matching the
    // native path's UX), but the transcript itself arrives a moment later
    // over the network. There is no distinct "transcribing" indicator in
    // this pass; a real limitation, not silently hidden.
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    setListening(false);
    setInterimTranscript('');
  }, []);

  const startListening = useCallback((onFinal: (transcript: string) => void) => {
    lastOnFinalRef.current = onFinal;
    if (listening) return;

    if (sttFallbackSupported) {
      setVoiceError(null);
      if (speechSupported) {
        speechBufferRef.current = '';
        window.speechSynthesis.cancel();
        setSpeaking(false);
      }
      navigator.mediaDevices.getUserMedia({ audio: true })
        .then((stream) => {
          const mimeType = pickRecorderMimeType();
          const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
          const chunks: BlobPart[] = [];
          recorder.ondataavailable = (event) => { if (event.data.size > 0) chunks.push(event.data); };
          recorder.onerror = () => {
            stream.getTracks().forEach((track) => track.stop());
            mediaStreamRef.current = null;
            mediaRecorderRef.current = null;
            setListening(false);
            setVoiceError('Voice input could not be started.');
          };
          recorder.onstop = () => {
            stream.getTracks().forEach((track) => track.stop());
            mediaStreamRef.current = null;
            mediaRecorderRef.current = null;
            const blob = new Blob(chunks, { type: recorder.mimeType || mimeType || 'audio/webm' });
            if (blob.size === 0) return; // stopped before anything was captured
            void (async () => {
              const controller = new AbortController();
              sttAbortControllerRef.current = controller;
              try {
                const extension = (blob.type.split('/')[1] || 'webm').split(';')[0];
                const formData = new FormData();
                formData.append('audio', blob, `voice.${extension}`);
                const token = getAuthToken();
                const headers: HeadersInit = {};
                if (token) headers['Authorization'] = `Bearer ${token}`;
                const res = await fetch(`${apiBaseUrl()}/api/ai/voice/transcribe`, {
                  method: 'POST', headers, body: formData, signal: controller.signal,
                });
                const payload = await res.json().catch(() => ({} as { data?: { text?: string }; error?: { message?: string } }));
                if (!res.ok) throw new Error(payload?.error?.message || 'Voice transcription failed');
                const text = String(payload?.data?.text ?? '').trim();
                if (text) onFinal(text);
              } catch (error) {
                if (error instanceof Error && error.name === 'AbortError') return;
                setVoiceError(error instanceof Error ? error.message : 'Voice transcription failed');
              } finally {
                sttAbortControllerRef.current = null;
              }
            })();
          };
          mediaRecorderRef.current = recorder;
          mediaStreamRef.current = stream;
          recorder.start();
          setListening(true);
        })
        .catch(() => setVoiceError('Microphone permission was denied.'));
      return;
    }

    if (!recognitionSupported) return;
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) return;
    // Barge-in: talking over Mira stops her rather than competing with her, and
    // it keeps her voice out of the microphone she is about to open.
    if (speechSupported) {
      speechBufferRef.current = '';
      window.speechSynthesis.cancel();
      setSpeaking(false);
    }
    setVoiceError(null);
    const recognition = new Recognition();
    recognition.lang = language;
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    finalTextRef.current = '';
    recognition.onresult = (event) => {
      let interim = '';
      let finalText = '';
      for (let index = 0; index < event.results.length; index += 1) {
        const result = event.results[index];
        const transcript = result?.[0]?.transcript ?? '';
        if (result?.isFinal) finalText += transcript;
        else interim += transcript;
      }
      setInterimTranscript(interim.trim());
      // Accumulate only — do not dispatch here. The browser can finalize a
      // segment mid-utterance; dispatching per-onresult sent the first
      // (possibly partial) phrase immediately and silently dropped anything
      // spoken afterward, because the resulting sendMessage() set `loading`
      // true and a later, fuller onresult's dispatch was ignored by the
      // `if (loading) return;` guard at the call site. Dispatch once, from
      // onend, with everything the session captured.
      if (finalText.trim()) finalTextRef.current = finalText.trim();
    };
    recognition.onerror = (event) => {
      const code = event.error || 'voice_error';
      setVoiceError(code === 'not-allowed' ? 'Microphone permission was denied.' : code === 'no-speech' ? 'No speech was detected.' : 'Voice input could not be started.');
      setListening(false);
      finalTextRef.current = ''; // don't leak a stale partial into the next session
    };
    recognition.onend = () => {
      recognitionRef.current = null;
      setListening(false);
      setInterimTranscript('');
      const finalText = finalTextRef.current.trim();
      finalTextRef.current = '';
      if (finalText) onFinal(finalText);
    };
    recognitionRef.current = recognition;
    setListening(true);
    try { recognition.start(); } catch { setListening(false); setVoiceError('Voice input could not be started.'); }
  }, [language, listening, recognitionSupported, speechSupported, sttFallbackSupported]);

  /** Release the ambient microphone stream. Safe to call whether or not one is open. */
  const stopAmbientMonitor = useCallback(() => {
    if (ambientRafRef.current !== null) {
      cancelAnimationFrame(ambientRafRef.current);
      ambientRafRef.current = null;
    }
    ambientStreamRef.current?.getTracks().forEach((track) => track.stop());
    ambientStreamRef.current = null;
    if (ambientContextRef.current && ambientContextRef.current.state !== 'closed') {
      void ambientContextRef.current.close().catch(() => undefined);
    }
    ambientContextRef.current = null;
    ambientDetectorRef.current = null;
  }, []);

  /**
   * Open a microphone stream purely to watch its loudness, so the user can
   * interrupt Mira by talking rather than pressing the mic button.
   *
   * This does not replace SpeechRecognition — webkitSpeechRecognition manages
   * its own audio capture internally and does not accept a caller-supplied
   * MediaStream, so its input cannot be echo-cancelled against Mira's own
   * voice directly. Instead a second, disposable stream is opened with
   * echoCancellation requested, used only to decide *whether* someone is
   * talking; once that decision fires, Mira is cancelled and the normal
   * startListening flow takes over for actually capturing what was said.
   *
   * Real limits, stated rather than hidden: browser echo cancellation targets
   * loopback from the page's own audio output, which speechSynthesis is, so
   * this works on a typical laptop mic+speaker pair — but it is not guaranteed
   * across every device, and a call-centre headset (this product's actual
   * environment) sidesteps the whole problem by keeping mic and speaker
   * acoustically separate in hardware.
   */
  const startAmbientMonitor = useCallback(async () => {
    if (ambientStreamRef.current || !navigator.mediaDevices?.getUserMedia) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      // Speaking may have already ended (or listening may have started some
      // other way) while permission was pending — do not keep a stream nobody needs.
      if (!speakingRef.current || listeningRef.current || !bargeInEnabledRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      const AudioContextCtor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextCtor) { stream.getTracks().forEach((track) => track.stop()); return; }

      const context = new AudioContextCtor();
      // Created from an async permission-prompt callback, not synchronously
      // inside the click that enabled the toggle — some browsers suspend an
      // AudioContext built outside a direct user-gesture handler. This is
      // capture, not playback, so it is unaffected on most browsers, but the
      // resume is a harmless no-op when already running and cheap insurance
      // against the ones where it matters.
      void context.resume().catch(() => undefined);
      const source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);

      ambientStreamRef.current = stream;
      ambientContextRef.current = context;
      ambientDetectorRef.current = createVoiceActivityDetector();

      const buffer = new Uint8Array(analyser.fftSize);
      const poll = () => {
        if (!ambientStreamRef.current || !ambientDetectorRef.current) return;
        analyser.getByteTimeDomainData(buffer);
        const triggered = ambientDetectorRef.current.feed(rmsFromByteTimeDomain(buffer), performance.now());
        if (triggered) {
          stopAmbientMonitor();
          if (speechSupported) { speechBufferRef.current = ''; window.speechSynthesis.cancel(); setSpeaking(false); }
          if (lastOnFinalRef.current) startListening(lastOnFinalRef.current);
          return;
        }
        ambientRafRef.current = requestAnimationFrame(poll);
      };
      ambientRafRef.current = requestAnimationFrame(poll);
    } catch {
      // Permission denied or no device — barge-in silently stays unavailable;
      // the mic button remains the fallback. Not surfaced as a voiceError
      // because the user did not take an action this failure should interrupt.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [speechSupported, startListening, stopAmbientMonitor]);

  const stopSpeaking = useCallback(() => {
    if (!speechSupported) return;
    speechBufferRef.current = '';
    window.speechSynthesis.cancel();
    setSpeaking(false);
  }, [speechSupported]);

  /** Queue one utterance without disturbing anything already queued. */
  const enqueueUtterance = useCallback((text: string) => {
    const spoken = cleanForSpeech(text);
    if (!spoken) return;
    const utterance = new SpeechSynthesisUtterance(spoken);
    utterance.lang = language;
    utterance.rate = language === 'hi-IN' ? 0.92 : 0.96;
    utterance.pitch = 1;
    if (selectedVoice) utterance.voice = selectedVoice;
    utterance.onstart = () => setSpeaking(true);
    utterance.onend = () => {
      // Only settle when nothing is left queued, or each sentence would flicker
      // the speaking state off and on again.
      if (!window.speechSynthesis.pending && !window.speechSynthesis.speaking) setSpeaking(false);
    };
    utterance.onerror = () => setSpeaking(false);
    window.speechSynthesis.speak(utterance);
  }, [language, selectedVoice]);

  /** Start a fresh spoken answer, discarding whatever was mid-flight. */
  const beginSpeechStream = useCallback(() => {
    if (!speechSupported) return;
    speechBufferRef.current = '';
    window.speechSynthesis.cancel();
  }, [speechSupported]);

  /**
   * Feed streamed text in. Complete sentences are spoken as they close, so the
   * voice starts a sentence after the first token rather than after the last.
   */
  const pushSpeech = useCallback((text: string) => {
    if (!speechSupported || !text) return;
    speechBufferRef.current += text;
    const { sentences, rest } = takeSpeakableSentences(speechBufferRef.current);
    speechBufferRef.current = rest;
    sentences.forEach(enqueueUtterance);
  }, [enqueueUtterance, speechSupported]);

  /** Speak whatever is left once the answer is complete. */
  const endSpeechStream = useCallback(() => {
    if (!speechSupported) return;
    const tail = speechBufferRef.current.trim();
    speechBufferRef.current = '';
    if (tail) enqueueUtterance(tail);
  }, [enqueueUtterance, speechSupported]);

  const speak = useCallback((text: string) => {
    if (!speechSupported || !text.trim()) return;
    window.speechSynthesis.cancel();
    // One-shot path still bounds length; the streaming path is bounded per sentence.
    const utterance = new SpeechSynthesisUtterance(cleanForSpeech(text).slice(0, 3000));
    utterance.lang = language;
    utterance.rate = language === 'hi-IN' ? 0.92 : 0.96;
    utterance.pitch = 1;
    if (selectedVoice) utterance.voice = selectedVoice;
    utterance.onstart = () => setSpeaking(true);
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    window.speechSynthesis.speak(utterance);
  }, [language, selectedVoice, speechSupported]);

  const setBargeInEnabled = useCallback((value: boolean) => setBargeInEnabledState(value), []);

  // The mic is open only for the window where it is actually useful: Mira is
  // talking, nobody is already listening, and the user opted in. Any other
  // state — she finishes, the user presses the mic themselves, or the toggle
  // goes off — tears the stream down within one render.
  useEffect(() => {
    if (bargeInEnabled && speaking && !listening && recognitionSupported && speechSupported) {
      void startAmbientMonitor();
    } else {
      stopAmbientMonitor();
    }
  }, [bargeInEnabled, speaking, listening, recognitionSupported, speechSupported, startAmbientMonitor, stopAmbientMonitor]);

  useEffect(() => () => {
    recognitionRef.current?.abort();
    stopAmbientMonitor();
    if (speechSupported) window.speechSynthesis.cancel();
    sttAbortControllerRef.current?.abort();
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
  }, [speechSupported, stopAmbientMonitor]);

  return {
    recognitionSupported, speechSupported, listening, speaking, interimTranscript, voiceError,
    sttFallbackSupported, voiceInputSupported, sttMode,
    autoSpeak, setAutoSpeak, bargeInEnabled, setBargeInEnabled,
    language, setLanguage, voices: indianVoices, selectedVoiceURI,
    selectedVoiceName: selectedVoice?.name || '', setSelectedVoiceURI, startListening, stopListening, speak, stopSpeaking,
    beginSpeechStream, pushSpeech, endSpeechStream,
  };
}
