import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

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

function cleanForSpeech(text: string): string {
  return text
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[•*_#`>|]/g, ' ')
    .replace(/₹/g, ' rupees ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 3000);
}

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

  const recognitionSupported = typeof window !== 'undefined' && !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  const speechSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;

  useEffect(() => { localStorage.setItem('mira_auto_speak', String(autoSpeak)); }, [autoSpeak]);
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
    setListening(false);
    setInterimTranscript('');
  }, []);

  const startListening = useCallback((onFinal: (transcript: string) => void) => {
    if (!recognitionSupported || listening) return;
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) return;
    setVoiceError(null);
    const recognition = new Recognition();
    recognition.lang = language;
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
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
      if (finalText.trim()) {
        setInterimTranscript('');
        onFinal(finalText.trim());
      }
    };
    recognition.onerror = (event) => {
      const code = event.error || 'voice_error';
      setVoiceError(code === 'not-allowed' ? 'Microphone permission was denied.' : code === 'no-speech' ? 'No speech was detected.' : 'Voice input could not be started.');
      setListening(false);
    };
    recognition.onend = () => {
      recognitionRef.current = null;
      setListening(false);
      setInterimTranscript('');
    };
    recognitionRef.current = recognition;
    setListening(true);
    try { recognition.start(); } catch { setListening(false); setVoiceError('Voice input could not be started.'); }
  }, [language, listening, recognitionSupported]);

  const stopSpeaking = useCallback(() => {
    if (!speechSupported) return;
    window.speechSynthesis.cancel();
    setSpeaking(false);
  }, [speechSupported]);

  const speak = useCallback((text: string) => {
    if (!speechSupported || !text.trim()) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(cleanForSpeech(text));
    utterance.lang = language;
    utterance.rate = language === 'hi-IN' ? 0.92 : 0.96;
    utterance.pitch = 1;
    if (selectedVoice) utterance.voice = selectedVoice;
    utterance.onstart = () => setSpeaking(true);
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    window.speechSynthesis.speak(utterance);
  }, [language, selectedVoice, speechSupported]);

  useEffect(() => () => {
    recognitionRef.current?.abort();
    if (speechSupported) window.speechSynthesis.cancel();
  }, [speechSupported]);

  return {
    recognitionSupported, speechSupported, listening, speaking, interimTranscript, voiceError,
    autoSpeak, setAutoSpeak, language, setLanguage, voices: indianVoices, selectedVoiceURI,
    selectedVoiceName: selectedVoice?.name || '', setSelectedVoiceURI, startListening, stopListening, speak, stopSpeaking,
  };
}
